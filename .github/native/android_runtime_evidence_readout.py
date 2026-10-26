"""One exact retained JSON artifact; no app execution or native acceptance."""
import ast
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = '84084981f66082c6d3d533e191d8270b81b842cf'
CONTROLLER = '68c7dad6b1190b8fb3608c0dd7cd8aace48bd144'
RUN, JOB, ARTIFACT = 40330947369, 121599903084, 12656541173
ZIP_SHA = '70e6757ea3af4ea6a9ac62e30e3971ae09cfca71333eb890fd18437f99834271'
ZIP_SIZE = 10349
MAX_META = 1024 * 1024
SCOPE = 'EXACT_RETAINED_ANDROID_RUNTIME_OBSERVATION_NOT_NATIVE_ACCEPTANCE'
POLICIES = ('product_measurements.py', 'product_failure_diagnosis.py',
    'maestro_failure_snapshot.py', 'maestro_skip_tap.py',
    'android_startup_diagnosis.py', 'startup_diagnosis.py',
    'onboarding_failure_receipts.py', 'startup_boundary_receipts.py', 'startup_failure_receipts.py')
GATES = ('build', 'smoke', 'native_keychain', 'native_probe', 'r5_features', 'hardware', 'signing')


def require(value):
    if not value:
        raise ValueError('EXACT_RUNTIME_EVIDENCE_REJECTED')


def strict(raw):
    def pairs(rows):
        value = {}
        for key, item in rows:
            require(key not in value)
            value[key] = item
        return value
    def invalid(_):
        raise ValueError('EXACT_RUNTIME_EVIDENCE_REJECTED')
    return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_constant=invalid)


def vocabulary(root=ROOT):
    """Only literal vocabulary from the exact existing committed collectors."""
    allowed = {'UNPROJECTED', 'PASS', 'FAIL', 'NOT RUN', 'UNKNOWN', 'MISSING', 'NOT_RUN'}
    for name in POLICIES:
        path = root / '.github/native' / name
        raw = path.read_bytes()
        require(raw == subprocess.check_output(['git', 'show', 'HEAD:.github/native/' + name], cwd=root))
        for node in ast.walk(ast.parse(raw)):
            if isinstance(node, ast.Constant) and type(node.value) is str and len(node.value) <= 512:
                allowed.add(node.value)
    return allowed


def project(value, allowed, depth=0):
    require(depth <= 16)
    if value is None or type(value) is bool:
        return value
    if type(value) in (int, float):
        require(math.isfinite(value) and abs(value) < 2 ** 53)
        return value
    if type(value) is str:
        return value if value in allowed else 'UNPROJECTED'
    if type(value) is list:
        require(len(value) <= 256)
        return [project(row, allowed, depth + 1) for row in value]
    require(type(value) is dict and len(value) <= 256)
    return {key: project(row, allowed, depth + 1) for key, row in value.items() if key in allowed}


def decode(raw, expected_sha=ZIP_SHA, expected_size=ZIP_SIZE):
    require(type(raw) is bytes and len(raw) == expected_size)
    require(hashlib.sha256(raw).hexdigest() == expected_sha)
    import io
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        rows = archive.infolist()
        require(len(rows) == 1)
        row = rows[0]
        require(row.filename == row.orig_filename == 'metadata.json' and not row.flag_bits & 1)
        require(stat.S_IFMT(row.external_attr >> 16) in (0, stat.S_IFREG))
        require(row.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) and 0 < row.file_size <= MAX_META)
        value = strict(archive.read(row))
    require(type(value) is dict and type(value.get('schema')) is int and value['schema'] == 1)
    require(value.get('source_sha') == SOURCE and value.get('run_id') == str(RUN) and value.get('run_attempt') == '1')
    require(value.get('platform') == 'ANDROID' and value.get('diagnostic_only') is True)
    require(value.get('workflow_ref') == 'KeeperCommunity/bitcoin-keeper-private/.github/workflows/keeper-private-android-runtime-reuse.yml@refs/pull/73/merge')
    require(value.get('build_execution_scope') == 'REUSED_EXACT_ORIGINAL_PRIVATE_DEBUG_APK_NO_CURRENT_RUN_COMPILATION_OR_RELEASE')
    return value


def terminal_summary(value, allowed):
    result = {'schema': 1, 'scope': SCOPE, 'native_acceptance': False,
        'phase_results': {key: value.get(key) if value.get(key) in ('PASS', 'FAIL', 'NOT RUN') else 'UNKNOWN' for key in GATES},
        'case_counts': {key: value[key] for key in ('smoke_test_cases', 'native_probe_test_cases', 'r5_features_test_cases')
                        if type(value.get(key)) is int and 0 <= value[key] <= 4096}}
    product = value.get('product_ui', {})
    require(type(product) is dict)
    samples = product.get('samples', [])
    require(type(samples) is list and len(samples) <= 6)
    result['product_status'] = product.get('status') if product.get('status') in ('PASS', 'FAIL', 'NOT RUN') else 'UNKNOWN'
    result['product_samples'] = [project(row, allowed) for row in samples]
    return result


def summary(value, allowed):
    result = terminal_summary(value, allowed)
    result.update(app_source=SOURCE, runtime_controller=CONTROLLER, run=RUN, job=JOB,
        artifact=ARTIFACT, archive_sha256=ZIP_SHA)
    return result


def emit_terminal():
    require(all(os.environ.get(key) == value for key, value in {
        'GITHUB_ACTIONS': 'true', 'GITHUB_REPOSITORY_ID': '839671816',
        'KEEPER_NATIVE_PLATFORM': 'ANDROID', 'KEEPER_DIAGNOSTIC': 'true', 'GITHUB_RUN_ATTEMPT': '1',
    }.items()))
    source = os.environ.get('KEEPER_SOURCE_SHA', '')
    controller = os.environ.get('KEEPER_CONTROLLER_SHA', source)
    run = os.environ.get('GITHUB_RUN_ID', '')
    require(re.fullmatch('[0-9a-f]{40}', source) and re.fullmatch('[0-9a-f]{40}', controller) and
        re.fullmatch('[1-9][0-9]{0,15}', run) and int(run) < 2 ** 53)
    path = ROOT / 'artifacts/native/android/metadata.json'
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and 0 < info.st_size <= MAX_META)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        value = strict(stream.read(MAX_META + 1))
    require(type(value.get('schema')) is int and value['schema'] == 1 and
        value.get('source_sha') == source and value.get('run_id') == run and value.get('run_attempt') == '1' and
        value.get('platform') == 'ANDROID' and value.get('diagnostic_only') is True)
    result = terminal_summary(value, vocabulary())
    result.update(scope='CURRENT_PRIVATE_ANDROID_TERMINAL_OBSERVATIONS_NOT_NATIVE_ACCEPTANCE',
        app_source=source, runtime_controller=controller, run=int(run))
    print('KEEPER_PRIVATE_ANDROID_TERMINAL ' + json.dumps(result, sort_keys=True), flush=True)


def main():
    require(os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_REPOSITORY_ID') == '839671816')
    require(os.environ.get('KEEPER_READ_ONLY_RUNTIME_EVIDENCE') == '1')
    path = Path(os.environ['RUNNER_TEMP']) / 'keeper-exact-runtime-evidence.zip'
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid() and info.st_size == ZIP_SIZE)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as source:
        raw = source.read(ZIP_SIZE + 1)
    value = decode(raw)
    result = summary(value, vocabulary())
    target = ROOT / 'artifacts/private-runtime-evidence/summary.json'
    parent = ROOT / 'artifacts'
    if parent.exists():
        require(not parent.is_symlink() and parent.is_dir())
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=False)
    target.write_text(json.dumps(result, sort_keys=True, indent=2) + '\n')
    os.chmod(target, 0o600)
    path.unlink()
    print('KEEPER_EXACT_RUNTIME_EVIDENCE ' + json.dumps(result, sort_keys=True), flush=True)


if __name__ == '__main__':
    if sys.argv[1:] == ['terminal']:
        emit_terminal()
    else:
        require(not sys.argv[1:])
        main()
