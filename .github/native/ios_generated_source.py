"""Finite source-bound generated inputs for the normal simulator phase guards.

Only the fixed R5 extractor and owned TLS/trust/Realm producers are admitted.
This does not run a fixture, rewrite source, or ignore the generated directory.
"""
import importlib.util
import os
from pathlib import Path
import re
import subprocess

PREFIX = '.github/native/.generated/'
FILES = {'tls': ('r52_tls_fixture.json', 262144), 'trust': ('r52_trust_ui.json', 16384),
         'realm109': ('r52_realm109/config.json', 32768)}
R5 = PREFIX + 'r5_workers.js'
R5_VERIFY = """const fs = require('node:fs'), crypto = require('node:crypto');
const [producer, target, root, expected] = process.argv.slice(1);
const {render} = require(producer);
if (typeof render !== 'function') process.exit(1);
const raw = fs.readFileSync(target);
if (crypto.createHash('sha256').update(raw).digest('hex') !== expected ||
    !raw.equals(Buffer.from(render(root).outputText))) process.exit(1);
"""


def require(value):
    if not value:
        raise RuntimeError('NORMAL_IOS_GENERATED_SOURCE_REJECTED')


def module(name):
    spec = importlib.util.spec_from_file_location('generated_' + name, Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


def allowed(native, names):
    names = {name for name in names if name.startswith(PREFIX)}
    if not names:
        return set()
    data = native.read()
    source = data.get('source_sha')
    require(native.PLATFORM == 'IOS' and re.fullmatch('[a-f0-9]{40}', source or ''))
    records = data.get('native_generated_inputs', {})
    require(type(records) is dict and set(records) <= set(FILES))
    reader = module('android_apk_checkpoint')
    base = reader.directory(native.ROOT)
    accepted = set()
    try:
        if R5 in names:
            raw = reader.read_file(base, R5, 1024 * 1024)
            require(not raw['executable'])
            # Pure deterministic regeneration from the already raw-verified
            # current source. The producer's no-argument writer is never called.
            result = subprocess.run(['node', '-e', R5_VERIFY,
                str(native.ROOT / '.github/native/r5_prepare.cjs'), str(native.ROOT / R5),
                str(native.ROOT), raw['sha256']], cwd=native.ROOT,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60, check=False)
            require(result.returncode == 0 and reader.read_file(base, R5, 1024 * 1024)['sha256'] == raw['sha256'])
            accepted.add(R5)
        for kind, (relative, maximum) in FILES.items():
            path = PREFIX + relative
            present = path in names or (kind == 'realm109' and any(
                name.startswith(PREFIX + 'r52_realm109/') for name in names))
            if not present:
                continue
            record = records.get(kind)
            require(type(record) is dict and set(record) == {'source_sha', 'path', 'sha256'} and
                record['source_sha'] == source and record['path'] == path and
                re.fullmatch('[a-f0-9]{64}', record['sha256'] or ''))
            observed = reader.read_file(base, path, maximum)
            require(not observed['executable'] and observed['sha256'] == record['sha256'])
            config = reader.json_document(observed['bytes'])
            require(type(config) is dict and config.get('platform') == 'IOS' and config.get('schema') == 1 and
                    re.fullmatch('[a-f0-9]{48}', config.get('nonce', '')))
            accepted.add(path)
            if kind == 'realm109':
                realm = module('r52_realm109_native')
                generated = native.ROOT / PREFIX / 'r52_realm109'
                verified = realm.verify_generated(generated, record['sha256'])
                require(verified.get('source_sha') == source and verified.get('scope') == realm.SCOPE and
                    verified.get('historical_commit') == realm.HISTORICAL and
                    verified.get('manifest_sha256') == realm.MANIFEST and
                    verified.get('realm_package') == '12.15.0' and verified.get('schema_count') == 50)
                accepted.update(PREFIX + 'r52_realm109/' + row['name'] for row in verified['generated'])
        require(names == accepted)
    finally:
        os.close(base)
    return accepted
