"""Read only one exact failed iOS run's retained metadata; no native execution."""
import ast
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = 'ff3cc6b2721de986d9f6211ef333df57ebc3b1fa'
SOURCE_TREE = 'ee0c587945901788b4ad62ad28ed660ab656cb6a'
APP_INPUTS = '6112e0e18e093e5e65e754fc607aa7e44ee73682576a31a168a6ad01f06a2b85'
RUN, JOB, ARTIFACT = 40351735911, 121673312232, 12669375034
ZIP_SIZE = 88291
ZIP_SHA = 'f90a2788ff2ca7ab5ee83067a5d2ccbad0cf2b1a4abd7b439f1f74c302a305ca'
SIGNED_SHA = '97704a8960b4facceef54397a08fb5d0a456247c3627359215aa2a27df22656c'
APP_ARTIFACT, APP_ZIP_SHA = '12667427189', '89806c9d8d71dc032d2ce3ca8b444768705d1ca3ab565aa9ec0652f0277b76f5'
FRESH_SCOPE = 'FRESH_PRIVATE_SIMULATOR_BUILD_CURRENT_CONTROLLER_NO_RELEASE_ACCEPTANCE'
MAX_META = 4 * 1024 * 1024
SCOPE = 'EXACT_RETAINED_IOS_METADATA_READ_ONLY_NOT_NATIVE_ACCEPTANCE'
POLICIES = {
    'startup_diagnosis.py': 'c718224f948b68c6ce6a7ae22421d9ff7a913b40b807f521d50515efd5589bd7',
    'simulator_readiness.py': 'ddc8dfa4d2099d1dfffd92bef55160fb60fe7e0e275b53d2d25f1816453c789f',
    'ios_keychain_direct.py': '0f7dfc626141b017e3e83a2c2fafa73c3871982bebd7e2615ba8282d6496d0db',
    'keychain_evidence.py': '93385289e20144616b86f2a6a30184db7a531f91ee71e4a8ce7e7d17645907bb',
    'ios_launch_debug.py': '8ce157781e2a7b9e9c748d1a66b9f6dce5897f8994331a2ce0f4dcc5f39bf9e3',
    'hosted_native.py': 'bfaad2396681be811768b53df85189509830236a61d30d40fb8a4eae7bd2db1c',
    'ios_fresh_runtime.py': 'd5179c09df47cd85f4a9c1a68256089e533a0451815abf80bf95d1ad80c28db8',
}
MEMBERS = {'native-metadata.json', 'simulator-launch.log', 'host-simulator.log',
           'original-launch-error.json', 'owned-crash-reasons.json', 'summary.json'}
SECTIONS = ('startup_observation', 'metro_warmup', 'direct_keychain_bundle',
            'simulator_app_service_readiness', 'direct_keychain_diagnostic',
            'startup_cleanup_errors', 'startup_observation_cleanup', 'startup_observation_capture')
GATES = ('build', 'fresh_policy', 'fresh_checkpoint', 'fresh_checkpoint_uploaded',
         'smoke', 'native_keychain', 'native_probe', 'r5_features', 'hardware', 'signing')


def require(value):
    if not value:
        raise ValueError('EXACT_IOS_METADATA_REJECTED')


def strict(raw):
    def pairs(rows):
        result = {}
        for key, value in rows:
            require(key not in result)
            result[key] = value
        return result
    def invalid(_):
        raise ValueError('EXACT_IOS_METADATA_REJECTED')
    return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_constant=invalid)


def vocabulary(root=ROOT):
    """Closed literal keys/values from unchanged exact original collectors."""
    allowed = {'UNPROJECTED', 'PASS', 'FAIL', 'NOT RUN', 'UNKNOWN', 'MISSING', 'NOT_RUN',
               'device_shutdown', 'device_delete', 'Warm IOS development bundle (setup only)',
               'http://127.0.0.1:8081/index.bundle?platform=ios&dev=true&minify=false'}
    for name, digest in POLICIES.items():
        # This completed historical readout stays tied to its original source
        # even when a later diagnostic changes the active collectors.
        try:
            raw = subprocess.check_output(['git', '--no-replace-objects', 'show',
                SOURCE_TREE + ':.github/native/' + name], cwd=root, stderr=subprocess.DEVNULL)
        except subprocess.CalledProcessError:
            require(False)
        require(hashlib.sha256(raw).hexdigest() == digest)
        for node in ast.walk(ast.parse(raw)):
            if isinstance(node, ast.Constant) and type(node.value) is str and len(node.value) <= 512:
                allowed.add(node.value)
    for number in range(1, 4):
        allowed.update({'Launch direct Keychain process %d' % number,
                        'Terminate direct Keychain process %d' % number})
    # Original direct collector constructs these from its three fixed stages.
    for stage in ('SEEDED', 'UPDATED', 'PASS'):
        allowed.update({'LAUNCH_' + stage, 'READ_NATIVE_' + stage})
    return allowed


def project(value, allowed, path=(), depth=0):
    require(depth <= 24)
    if value is None or type(value) is bool:
        return value
    if type(value) in (int, float):
        require(math.isfinite(value) and abs(value) < 2 ** 53)
        return value
    if type(value) is str:
        # Only digests in the known warmup schema bypass the source vocabulary.
        if path in {('metro_warmup', 'sha256'), ('direct_keychain_bundle', 'sha256')}:
            require(re.fullmatch('[a-f0-9]{64}', value) is not None)
            return value
        return value if value in allowed else 'UNPROJECTED'
    if type(value) is list:
        require(len(value) <= 1024)
        return [project(row, allowed, path + ('[]',), depth + 1) for row in value]
    require(type(value) is dict and len(value) <= 512)
    return {key: project(row, allowed, path + (key,), depth + 1)
            for key, row in value.items() if key in allowed}


def decode(raw, expected_sha=ZIP_SHA, expected_size=ZIP_SIZE):
    require(type(raw) is bytes and len(raw) == expected_size)
    require(hashlib.sha256(raw).hexdigest() == expected_sha)
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        rows = archive.infolist()
        names = [row.filename for row in rows]
        require(1 <= len(rows) <= len(MEMBERS) and len(names) == len(set(names)))
        require('native-metadata.json' in names and set(names) <= MEMBERS)
        require(sum(row.file_size for row in rows) <= 16 * 1024 * 1024)
        for row in rows:
            require(row.filename == row.orig_filename and not row.flag_bits & 1)
            require(stat.S_IFMT(row.external_attr >> 16) in (0, stat.S_IFREG))
            require(row.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED))
            require(0 <= row.file_size <= MAX_META)
        value = strict(archive.read('native-metadata.json'))
    require(type(value) is dict and type(value.get('schema')) is int and value['schema'] == 1)
    require(value.get('source_sha') == SOURCE and value.get('compiled_app_source_sha') == SOURCE)
    require(value.get('run_id') == str(RUN) and value.get('run_attempt') == '1')
    require(value.get('platform') == 'IOS' and value.get('diagnostic_only') is True)
    require(value.get('workflow_ref') == 'KeeperCommunity/bitcoin-keeper-private/.github/workflows/keeper-private-ios-fresh-runtime.yml@refs/pull/74/merge')
    require(value.get('build_execution_scope') == FRESH_SCOPE and value.get('native_acceptance') is False)
    require(value.get('app_inputs_sha256') == APP_INPUTS and value.get('build') == 'PASS')
    require(value.get('fresh_checkpoint') == value.get('fresh_checkpoint_uploaded') == 'PASS')
    signature = value.get('toolchain', {}).get('ios_simulator_signature', {})
    require(signature.get('verified') is True and signature.get('entitlements_sha256') == SIGNED_SHA)
    require(signature.get('entitlement_policy') == 'XCODE_GENERATED_SIGNED_AND_LINKER_EMBEDDED_SIMULATOR_ENTITLEMENTS')
    custody = value.get('fresh_checkpoint_artifact', {})
    require(custody == {'id': APP_ARTIFACT, 'archive_sha256': APP_ZIP_SHA,
                       'source_sha': SOURCE, 'run_id': str(RUN), 'run_attempt': 1})
    return value


def summary(value, allowed):
    result = {'schema': 1, 'scope': SCOPE, 'native_acceptance': False,
        'app_source': SOURCE, 'app_inputs_sha256': APP_INPUTS, 'run': RUN, 'job': JOB,
        'artifact': ARTIFACT, 'archive_sha256': ZIP_SHA,
        'phase_results': {key: value.get(key) if value.get(key) in ('PASS', 'FAIL', 'NOT RUN') else 'UNKNOWN'
                          for key in GATES},
        'observations': {name: project(value.get(name), allowed, (name,)) for name in SECTIONS}}
    commands = value.get('commands', [])
    require(type(commands) is list and len(commands) <= 1024)
    # Never project argv, cwd, raw output, error messages or configuration bodies.
    result['recorded_commands'] = []
    for index, row in enumerate(commands, 1):
        require(type(row) is dict)
        result['recorded_commands'].append({'index': index, **project(
            {key: row[key] for key in ('label', 'exit_code', 'duration_seconds', 'timeout_seconds')
             if key in row}, allowed, ('commands',))})
    replacement = value.get('startup_diagnostics', {}).get('replacement_observation', {})
    require(type(replacement) is dict)
    result['entitlement_comparison_context'] = {
        'recorded_producer': 'XCODE_GENERATED_ADHOC_SIMULATOR_ONLY_NOT_RELEASE_SIGNING',
        'recorded_expected_canonical_entitlements_sha256': SIGNED_SHA, 'recorded_source': SOURCE,
        'recorded_full_installed_bytes': replacement.get('bytes') if replacement.get('bytes') in ('MATCH', 'MISMATCH') else 'UNKNOWN',
        'original_entitlements_field': replacement.get('entitlements') if replacement.get('entitlements') in ('MATCH', 'MISMATCH') else 'UNKNOWN',
        'original_field_policy': 'LEGACY_FIXED_MANUAL_SIGNING_DICTIONARY_ONLY',
        'observed_canonical_entitlements_sha256': None,
        'scope': 'ORIGINAL_LEGACY_COMPARISON_NOT_NORMAL_PROFILE_MUTATION_OR_NATIVE_ACCEPTANCE'}
    return result


def main():
    os.umask(0o077)
    require(os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_REPOSITORY_ID') == '839671816')
    require(os.environ.get('KEEPER_READ_ONLY_IOS_METADATA') == '1' and os.environ.get('GITHUB_RUN_ATTEMPT') == '1')
    require(subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() == os.environ.get('KEEPER_SOURCE_SHA'))
    path = Path(os.environ['RUNNER_TEMP']) / 'keeper-exact-ios-metadata.zip'
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.getuid() and info.st_size == ZIP_SIZE)
        raw = source.read(ZIP_SIZE + 1)
        after = os.fstat(source.fileno())
        require(all(getattr(info, key) == getattr(after, key) for key in
                    ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')))
    result = summary(decode(raw), vocabulary())
    encoded = json.dumps(result, sort_keys=True, indent=2) + '\n'
    require(len(encoded.encode()) <= 1024 * 1024)
    target = ROOT / 'artifacts/private-ios-metadata-readout/summary.json'
    parent = ROOT / 'artifacts'
    if parent.exists():
        require(not parent.is_symlink() and parent.is_dir())
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=False)
    target.write_text(encoded)
    os.chmod(target, 0o600)
    path.unlink()
    print('KEEPER_EXACT_IOS_METADATA ' + json.dumps(result, sort_keys=True), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('EXACT_IOS_METADATA_REJECTED') from None
