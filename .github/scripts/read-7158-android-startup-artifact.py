#!/usr/bin/env python3
"""Project fixed 7158 Android startup failure facts using the unchanged 044 kernel."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import zipfile

ROOT = Path(__file__).parent
KERNEL_SHA256 = '1e9fc4370d733041fb5a48dc8c022e3461decafbf970ba030e90784208aed1d9'
SOURCE = '3f4e8127e3698accd3760a4a039448964a5285a4'
WORKFLOW = 'f83a9a8b182dd8276a732ee2b6338fb6f845640a'
WORKFLOW_REF = 'KeeperCommunity/bitcoin-keeper/.github/workflows/keeper-native-diagnostic.yml@refs/pull/7158/merge'
RUN, ATTEMPT = '40085793409', '1'
ZIP_SIZE = 6451
DIGEST = 'f3553f9632eff7bd25f2315c8fb0e5429132455ea0af7d5293d4e4c7cfd8fd40'
SCOPE = 'OBSERVATIONS_ONLY_NOT_NATIVE_ACCEPTANCE_OR_CAUSE'
PHASE = 'SELECTION'
FIELDS = frozenset(('schema', 'source_sha', 'workflow_sha', 'workflow_ref', 'run_id', 'run_attempt',
    'platform', 'diagnostic_only', 'build', 'smoke', 'native_probe', 'r5_features', 'hardware', 'signing',
    'app_id', 'install_succeeded', 'installed_artifact_verified', 'failed_phase',
    'startup_diagnostics', 'startup_observation_capture',
    'startup_observation_cleanup'))
OBSERVER_FIELDS = frozenset(('scope', 'collection_errors', 'logcat', 'metro', 'process', 'foreground'))
METRO_BOOLEAN_FIELDS = frozenset(('row_limit_reached', 'emitter_cap_observed'))
MAESTRO_TESTCASE_FAILURE = 'Maestro assertion failed: Create a passcode'
MAESTRO_FAILURE_PATH = ('startup_diagnostics', 'maestro', 'testcase_failures')


def require_binding():
    import re
    if (type(WORKFLOW) is not str or not re.fullmatch(r'[a-f0-9]{40}', WORKFLOW) or
            type(WORKFLOW_REF) is not str or not re.fullmatch(
                r'KeeperCommunity/bitcoin-keeper/\.github/workflows/keeper-native-diagnostic\.yml@refs/pull/[1-9][0-9]*/merge', WORKFLOW_REF) or
            type(ZIP_SIZE) is not int or not 0 < ZIP_SIZE <= 1024 * 1024 + 4096 or
            type(DIGEST) is not str or not re.fullmatch(r'[a-f0-9]{64}', DIGEST)):
        raise ValueError('Exact completed artifact bindings unavailable.')


def project(blob):
    global PHASE
    PHASE = 'SELECTION'
    require_binding()
    PHASE = 'KERNEL'
    source = ROOT / 'read-044-android-artifact.py'
    if hashlib.sha256(source.read_bytes()).hexdigest() != KERNEL_SHA256:
        raise ValueError('Fixed kernel changed.')
    spec = importlib.util.spec_from_file_location('fixed_044_android_kernel', source)
    kernel = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(kernel)
    literals = kernel.public_literals()  # Original hash-checked policy remains unchanged.
    kernel.SOURCE, kernel.WORKFLOW, kernel.WORKFLOW_REF = SOURCE, WORKFLOW, WORKFLOW_REF
    kernel.RUN, kernel.ATTEMPT = RUN, ATTEMPT
    kernel.public_literals = lambda: literals | {'onboarding-markers', 'row_limit_reached',
        'emitter_cap_observed', MAESTRO_TESTCASE_FAILURE, SOURCE, WORKFLOW, WORKFLOW_REF, RUN, ATTEMPT}
    PHASE = 'ZIP_IDENTITY'
    if type(blob) is not bytes or len(blob) != ZIP_SIZE or hashlib.sha256(blob).hexdigest() != DIGEST:
        kernel.rejected()
    PHASE = 'ZIP_LAYOUT'
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        members = archive.infolist()
        if len(members) != 1:
            kernel.rejected()
        entry = members[0]
        if (entry.filename != 'android/metadata.json' or entry.orig_filename != entry.filename or
                entry.flag_bits & 1 or stat.S_IFMT(entry.external_attr >> 16) not in (0, stat.S_IFREG) or
                entry.file_size > kernel.LIMIT or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
            kernel.rejected()
        raw = kernel.canonical_payload(blob, entry, archive.start_dir, archive.comment)
    PHASE = 'JSON'
    data = json.loads(raw, object_pairs_hook=kernel.pairs, parse_float=kernel.finite,
                      parse_constant=lambda _: kernel.rejected())
    PHASE = 'ROOT_KEYS'
    if type(data) is not dict or not set(data) <= kernel.ROOT_KEYS:
        kernel.rejected()
    projected = {key: value for key, value in data.items() if key in FIELDS}
    PHASE = 'STARTUP'
    if (data.get('build') != 'PASS' or data.get('smoke') != 'FAIL' or
            data.get('native_probe') != 'NOT RUN' or data.get('r5_features') != 'NOT RUN' or
            data.get('product_ui') is not None or
            type(data.get('startup_diagnostics')) is not dict or
            type(data.get('startup_observation')) is not dict):
        kernel.rejected()
    projected['startup_observation'] = {key: value for key, value in
        data['startup_observation'].items() if key in OBSERVER_FIELDS}
    if 'maestro' in projected['startup_diagnostics']:
        maestro = projected['startup_diagnostics']['maestro']
        if type(maestro) is not dict:
            kernel.rejected()
        if 'testcase_failures' in maestro:
            failures = maestro['testcase_failures']
            if (type(failures) is not list or len(failures) > 10 or
                    any(type(item) is not str or item != MAESTRO_TESTCASE_FAILURE for item in failures)):
                kernel.rejected()
    pending = [(projected, ())]
    nodes = 0
    while pending:
        value, path = pending.pop()
        nodes += 1
        if nodes > 25000 or len(path) > 24:
            kernel.rejected()
        if type(value) is dict:
            for key, item in value.items():
                if key in METRO_BOOLEAN_FIELDS and (
                        path != ('startup_observation', 'metro') or type(item) is not bool):
                    kernel.rejected()
                pending.append((item, (*path, key)))
        elif type(value) is list:
            pending.extend((item, path) for item in value)
        elif value == MAESTRO_TESTCASE_FAILURE and path != MAESTRO_FAILURE_PATH:
            kernel.rejected()
    if 'metro' in projected['startup_observation'] and type(
            projected['startup_observation']['metro']) is not dict:
        kernel.rejected()
    PHASE = 'PROJECTED_METADATA'
    kernel.validate_metadata(projected)
    return {'schema': 1, 'scope': SCOPE, 'original_zip_sha256': DIGEST,
            'metadata_sha256': hashlib.sha256(raw).hexdigest(), 'observations': projected}


def main(argv=None):
    global PHASE
    PHASE = 'SELECTION'
    try:
        require_binding()
        if argv:
            raise ValueError('No selectors.')
        PHASE = 'PRIVATE_FILE'
        path = Path(os.environ['RUNNER_TEMP']) / 'r5-7158-android-startup-fixed.zip'
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size != ZIP_SIZE:
                raise ValueError('Invalid private file.')
            result = project(source.read(ZIP_SIZE + 1))
    except Exception:
        print('STARTUP_7158_ANDROID_OBSERVATION_READOUT_FAILED:' + PHASE)
        return 1
    print('STARTUP_7158_ANDROID_OBSERVATIONS_BEGIN')
    print(json.dumps(result, sort_keys=True, separators=(',', ':')))
    print('STARTUP_7158_ANDROID_OBSERVATIONS_END')
    return 0


if __name__ == '__main__':
    import sys
    raise SystemExit(main(sys.argv[1:]))
