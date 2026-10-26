"""One original normal-Xcode app, preserved byte for byte; no app compilation."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import zipfile

SOURCE = 'ff3cc6b2721de986d9f6211ef333df57ebc3b1fa'
TREE = 'ee0c587945901788b4ad62ad28ed660ab656cb6a'
APP_INPUTS = '6112e0e18e093e5e65e754fc607aa7e44ee73682576a31a168a6ad01f06a2b85'
RUN, JOB, ARTIFACT = 40351735911, 121673312232, 12667427189
ZIP_BYTES = 33120781
ZIP_SHA = '89806c9d8d71dc032d2ce3ca8b444768705d1ca3ab565aa9ec0652f0277b76f5'
SIGNED_SHA = '97704a8960b4facceef54397a08fb5d0a456247c3627359215aa2a27df22656c'
LABEL = 'keeper/ios-normal-retained-runtime'
SCOPE = 'REUSED_EXACT_NORMAL_XCODE_APP_NO_CURRENT_COMPILATION_OR_RESIGNING'
STEPS = ('Compile simulator app once with existing build budget',
         'Verify Xcode-generated simulator entitlements and checkpoint exact app',
         'Save fresh exact app BEFORE every runtime diagnostic',
         'Bind successful checkpoint upload before runtime')


def module(name):
    spec = importlib.util.spec_from_file_location('normal_retained_' + name,
        Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


def require(value):
    if not value:
        raise RuntimeError('NORMAL_XCODE_RETAINED_RUNTIME_REJECTED')


def digest(value):
    return type(value) is str and re.fullmatch('[a-f0-9]{64}', value) is not None


def require_selection(native, preflight=False):
    env = os.environ
    require(all(env.get(k) == v for k, v in {'GITHUB_ACTIONS': 'true',
        'RUNNER_ENVIRONMENT': 'github-hosted', 'GITHUB_REPOSITORY': 'KeeperCommunity/bitcoin-keeper-private',
        'GITHUB_REPOSITORY_ID': '839671816', 'GITHUB_EVENT_NAME': 'pull_request',
        'GITHUB_RUN_ATTEMPT': '1', 'KEEPER_PRIVATE_IOS_NORMAL_RETAINED': '1'}.items()))
    event = module('ios_runtime_evidence_readout').strict(Path(env['GITHUB_EVENT_PATH']).read_bytes())
    host = (native.platform.system() == 'Linux' and native.platform.machine() == 'x86_64'
            if preflight else native.platform.system() == 'Darwin' and native.platform.machine() == 'arm64')
    require(native.PLATFORM == 'IOS' and host and
        event['repository']['id'] == 839671816 and event['repository']['private'] is True and
        event['pull_request']['number'] == 74 and event['pull_request']['head']['repo']['id'] == 839671816 and
        event['pull_request']['head']['sha'] == env['KEEPER_SOURCE_SHA'] and
        event['action'] == 'labeled' and event['label']['name'] == LABEL)
    require(re.fullmatch('[a-f0-9]{40}', env['KEEPER_SOURCE_SHA']) and
        subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=native.ROOT, text=True).strip() == env['KEEPER_SOURCE_SHA'])
    entries = subprocess.check_output(['git', '--no-replace-objects', 'ls-tree', '-rz', 'HEAD'], cwd=native.ROOT).split(b'\0')
    app = [row for row in entries if row and not row.split(b'\t', 1)[1].startswith(b'.github/')]
    require(hashlib.sha256(b'\0'.join(app) + b'\0').hexdigest() == APP_INPUTS)


def qualify(native):
    data = native.read()
    data.update(build='NOT RUN', current_source_compilation='NOT RUN', native_acceptance=False,
        build_execution_scope=SCOPE, controller_source_sha=os.environ['KEEPER_SOURCE_SHA'],
        compiled_app_source_sha=SOURCE, app_inputs_sha256=APP_INPUTS,
        scope='PRIVATE_RETAINED_NORMAL_XCODE_RUNTIME_NOT_CURRENT_BUILD_OR_NATIVE_ACCEPTANCE')
    native.save(data)


def require_state(native):
    data = native.read()
    require(data.get('source_sha') == data.get('controller_source_sha') == os.environ['KEEPER_SOURCE_SHA'] and
        data.get('run_id') == os.environ['GITHUB_RUN_ID'] and data.get('run_attempt') == '1' and
        data.get('workflow_sha') == os.environ['GITHUB_WORKFLOW_SHA'] and
        data.get('compiled_app_source_sha') == SOURCE and data.get('app_inputs_sha256') == APP_INPUTS and
        data.get('native_acceptance') is False and data.get('build_execution_scope') == SCOPE)
    return data


def read_proof():
    path = Path(os.environ['RUNNER_TEMP']) / 'keeper-normal-ios-origin.json'
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as source:
        before = os.fstat(source.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1 and
                0 < before.st_size <= 65536)
        raw = source.read(65537); after = os.fstat(source.fileno())
        require(all(getattr(before, k) == getattr(after, k) for k in
                ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')))
    proof = module('ios_runtime_evidence_readout').strict(raw)
    fixed = {'schema': 1, 'repository_id': 839671816, 'source_sha': SOURCE,
        'source_tree': TREE, 'run_id': RUN, 'run_attempt': 1, 'job_id': JOB,
        'artifact_id': ARTIFACT, 'artifact_zip_sha256': ZIP_SHA,
        'original_smoke': 'FAIL_PRESERVED', 'native_acceptance': False}
    require(type(proof) is dict and set(proof) == set(fixed) | {'steps'} and
            all(type(proof.get(k)) is type(v) and proof[k] == v for k, v in fixed.items()))
    require(type(proof.get('steps')) is list and len(proof['steps']) == len(STEPS))
    for row, name in zip(proof['steps'], STEPS):
        require(type(row) is dict and set(row) == {'name', 'status', 'conclusion', 'started_at', 'completed_at'} and
            row.get('name') == name and row.get('status') == 'completed' and row.get('conclusion') == 'success'
            and type(row.get('started_at')) is str and bool(row['started_at'])
            and type(row.get('completed_at')) is str and bool(row['completed_at']))
    return proof


def restore(native, input_zip, expected_sha=ZIP_SHA, expected_size=ZIP_BYTES):
    """Bound ZIP, manifest, tar and every app byte before accepting a path."""
    staging = None
    with os.fdopen(os.open(input_zip, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1 and info.st_size == expected_size)
        h = hashlib.sha256()
        for block in iter(lambda: source.read(1024 * 1024), b''): h.update(block)
        require(h.hexdigest() == expected_sha)
        source.seek(0)
        try:
            with zipfile.ZipFile(source) as archive:
                rows = archive.infolist()
                require(len(rows) == 2 and {r.filename for r in rows} == {'manifest.json', 'simulator-app.tar.gz'})
                require(all(r.filename == r.orig_filename and not r.flag_bits & 1 and
                    stat.S_IFMT(r.external_attr >> 16) == stat.S_IFREG and
                    r.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) for r in rows))
                require(0 < archive.getinfo('manifest.json').file_size <= 65536 and
                    0 < archive.getinfo('simulator-app.tar.gz').file_size <= 64 * 1024 * 1024)
                manifest_raw = archive.read('manifest.json')
                manifest = module('ios_runtime_evidence_readout').strict(manifest_raw)
                require(type(manifest) is dict and type(manifest.get('schema')) is int and manifest['schema'] == 1 and
                    manifest.get('source_sha') == SOURCE and manifest.get('source_tree') == TREE and
                    manifest.get('run_id') == str(RUN) and manifest.get('run_attempt') == '1' and
                    manifest.get('native_acceptance') is False and
                    manifest.get('scope') == 'SIMULATOR_BUILD_ONLY_NO_CONTAINERS_KEYCHAINS_USER_DATA_OR_RELEASE_SIGNING')
                require(all(digest(manifest.get(k)) for k in ('archive_sha256', 'executable_sha256',
                    'bundle_inventory_sha256', 'toolchain_sha256')))
                h = hashlib.sha256()
                with archive.open('simulator-app.tar.gz') as compressed:
                    for block in iter(lambda: compressed.read(1024 * 1024), b''): h.update(block)
                require(h.hexdigest() == manifest['archive_sha256'])
                staging = Path(tempfile.mkdtemp(prefix='normal-restore-', dir=native.PRIVATE))
                names, total = set(), 0
                with archive.open('simulator-app.tar.gz') as compressed, tarfile.open(fileobj=compressed, mode='r|gz') as tar:
                    for member in tar:
                        name = member.name.rstrip('/'); path = PurePosixPath(name)
                        require(len(names) < 1024 and name not in names and not path.is_absolute() and '..' not in path.parts and
                            path.as_posix() == name and path.parts and path.parts[0] == 'hexa_keeper_dev.app' and
                            (member.isdir() or member.isfile()) and not member.mode & 0o7000 and
                            0 <= member.size <= 256 * 1024 * 1024)
                        names.add(name); total += member.size
                        require(total <= 512 * 1024 * 1024)
                        destination = staging.joinpath(*path.parts)
                        if member.isdir(): destination.mkdir(mode=member.mode & 0o777)
                        else:
                            with tar.extractfile(member) as content, destination.open('xb') as target:
                                shutil.copyfileobj(content, target, 1024 * 1024)
                            destination.chmod(member.mode & 0o777)
                app = staging / 'hexa_keeper_dev.app'
                inventory, executable = native._bundle_inventory(app)
                require(hashlib.sha256(json.dumps(inventory, sort_keys=True).encode()).hexdigest() == manifest['bundle_inventory_sha256'] and
                    inventory[executable] == ['file', manifest['executable_sha256']])
                destination = native.PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
                destination.parent.mkdir(parents=True, mode=0o700)
                require(not destination.exists() and not destination.is_symlink())
                after = os.fstat(source.fileno())
                require(all(getattr(info, k) == getattr(after, k) for k in
                    ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')))
                app.rename(destination)
                return manifest
        finally:
            if staging is not None: shutil.rmtree(staging)


def verify_signature(native, app=None):
    signature = module('ios_fresh_runtime').verify_xcode_signature(native, app)
    require(signature['entitlements_sha256'] == SIGNED_SHA and signature['certificate_or_profile_used'] is False)
    return signature


def preflight(native):
    """Exercise the real hash-pinned original archive before any paid Mac job."""
    proof = read_proof()
    require(not native.PRIVATE.is_symlink())
    native.PRIVATE.mkdir(parents=True, mode=0o700, exist_ok=True)
    manifest = restore(native, Path(os.environ['RUNNER_TEMP']) / 'keeper-normal-ios-app.zip')
    app = native.PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
    inventory, executable = native._bundle_inventory(app)
    result = {'schema': 1, 'scope': 'ORIGINAL_IOS_ARCHIVE_BYTES_ONLY_NO_CODESIGN_OR_NATIVE_EXECUTION',
        'native_acceptance': False, 'native_execution': False, 'signature_validation': 'NOT RUN_REQUIRES_MAC',
        'controller_source_sha': os.environ['KEEPER_SOURCE_SHA'], 'compiled_app_source_sha': SOURCE,
        'app_inputs_sha256': APP_INPUTS, 'original_build_api_proof': proof, 'original_manifest': manifest,
        'archive_zip_sha256': ZIP_SHA, 'archive_zip_bytes': ZIP_BYTES,
        'tar_member_count': len(inventory) + 1,
        'expanded_file_bytes': sum(path.stat().st_size for path in app.rglob('*') if path.is_file()),
        'observed_executable_sha256': inventory[executable][1],
        'observed_inventory_sha256': hashlib.sha256(json.dumps(inventory, sort_keys=True).encode()).hexdigest(),
        'zip_member_modes': 'REGULAR_ONLY', 'tar_member_kinds': 'DIRECTORY_OR_REGULAR_FILE_ONLY',
        'archive_admission': 'PASS'}
    target = native.ROOT / 'artifacts/private-ios-normal-artifact-admission'
    target.mkdir(parents=True, mode=0o700)
    with (target / 'summary.json').open('x') as output:
        json.dump(result, output, sort_keys=True, indent=2); output.write('\n')
    print('KEEPER_NORMAL_IOS_ARTIFACT_ADMISSION=' + json.dumps(result, sort_keys=True), flush=True)
    return result


def source_bytes(native, prepared=True):
    """Reuse the reviewed owned-file reader; Git index flags cannot hide edits."""
    reader = module('android_apk_checkpoint')
    data = require_state(native)
    hashes = {}
    if prepared:
        overlays = data.get('configuration_overlays', [])
        require(len(overlays) == 4 and {row['path'] for row in overlays} == module('ios_fresh_runtime').OVERLAYS)
        hashes = {row['path']: row['sha256'] for row in overlays}
    base = reader.directory(native.ROOT)
    try:
        for path, digest in hashes.items():
            require(reader.read_file(base, path, 1024 * 1024)['sha256'] == digest)
        entries = reader.git(native.ROOT, 'ls-tree', '-rz', 'HEAD').split(b'\0')
        for entry in entries:
            if not entry:
                continue
            header, raw_path = entry.split(b'\t', 1)
            mode, kind, blob = header.split()
            path = raw_path.decode()
            require(kind == b'blob' and mode in (b'100644', b'100755'))
            if path in hashes:
                continue
            observed = reader.read_file(base, path, 64 * 1024 * 1024, minimum=0)
            require(observed['executable'] == (mode == b'100755'))
            if path == 'package.json' and prepared:
                original = reader.git(native.ROOT, 'cat-file', 'blob', blob.decode())
                overlay = data.get('nodeify_overlay', {})
                require(overlay.get('path') == path and overlay.get('allowed_fields') == ['browser', 'react-native', 'browserify'] and
                    overlay.get('before_sha256') == hashlib.sha256(original).hexdigest() and overlay.get('after_sha256') == observed['sha256'])
                before, after = reader.json_document(original), reader.json_document(observed['bytes'])
                for name in overlay['allowed_fields']:
                    before.pop(name, None); after.pop(name, None)
                require(json.dumps(before, sort_keys=True) == json.dumps(after, sort_keys=True))
            else:
                require(observed['git_blob'] == blob.decode())
    finally:
        os.close(base)
    # Metro and Python can load files hidden by .gitignore or .git/info/exclude.
    # Scan both classes of unknown source. Ignored Pods/build outputs cannot
    # change the frozen app and are deliberately outside the ignored-JS scan.
    paths = ('src', 'patches', '.github/native', 'App.*', 'AndroidFontFix.*',
             'index.*', 'shim.*', 'metro.config.*', 'babel.config.*', 'react-native.config.*')
    generated = {'.github/native/.generated/r5_workers.js',
                 '.github/native/.generated/r52_trust_ui.json'}
    for ignored, selected in (((), (*paths, 'ios', 'android')), (('--ignored',), paths)):
        extra = reader.git(native.ROOT, 'ls-files', '--others', '--exclude-standard', *ignored, '-z', '--', *selected)
        for raw_name in extra.split(b'\0'):
            if not raw_name: continue
            name = raw_name.decode('utf-8')
            if name in generated:
                # These exact outputs are regenerated/validated by their fixed
                # worker/trust producers. Platform variants and other files
                # under .generated remain rejected.
                descriptor = reader.directory(native.ROOT)
                try: reader.read_file(descriptor, name, 64 * 1024 * 1024, minimum=0)
                finally: os.close(descriptor)
                continue
            require(re.fullmatch(r'\.github/native/__pycache__/[A-Za-z0-9_]+\.cpython-[0-9]+\.pyc', name))


def restore_app(native):
    data = require_state(native)
    require(data.get('retained_runtime_dependencies') == 'PASS')
    source_bytes(native)
    proof = read_proof()
    manifest = restore(native, Path(os.environ['RUNNER_TEMP']) / 'keeper-normal-ios-app.zip')
    original = native.artifact_identity()
    signature = verify_signature(native)
    require(native.artifact_identity() == original)
    data = native.read()
    data['toolchain']['ios_simulator_signature'] = signature
    data.update(original_build={**proof, 'api_proof': proof, 'build': 'PASS', 'original_manifest': manifest},
        built_artifact=original, restored_bundle_identity=original, original_signature_preserved=True,
        retained_xcode_restore='PASS')
    native.save(data)


def verify_installed(native, original_verify, device):
    data = native.read(); data['installed_normal_signature_verified'] = False; native.save(data)
    result = original_verify(device)  # Existing full bytes and strict path gate.
    data = require_state(native)
    built = native.PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
    installed = native.owned_ios_bundle_path(native.command(
        ['xcrun', 'simctl', 'get_app_container', device, native.APP_IDS['IOS'], 'app'],
        'Locate normal-Xcode installed signature', capture=True, error_details=False), device, built)
    require(verify_signature(native, installed) == data['toolchain']['ios_simulator_signature'])
    require(native.artifact_identity() == data['restored_bundle_identity'])
    data = native.read(); data['installed_normal_signature_verified'] = True; native.save(data)
    return result


def require_restored(native):
    data = require_state(native)
    source_bytes(native)
    require(data.get('retained_xcode_restore') == 'PASS' and data.get('original_signature_preserved') is True and
        data.get('original_build', {}).get('api_proof') == read_proof() and
        native.artifact_identity() == data.get('restored_bundle_identity') == data.get('built_artifact'))
    require(verify_signature(native) == data['toolchain']['ios_simulator_signature'])
    return native.read()


def run_suite(native, suite):
    require(suite in ('startup', 'keychain', 'probe', 'features', 'product'))
    data = require_restored(native)
    if suite != 'startup': require(data.get('smoke') == 'PASS')
    if suite in ('probe', 'features', 'product'): require(data.get('native_keychain') == 'PASS')
    if suite in ('features', 'product'): require(data.get('native_probe') == 'PASS')
    if suite == 'product': require(data.get('r5_features') == 'PASS')
    key = {'startup': 'smoke', 'keychain': 'native_keychain', 'probe': 'native_probe',
           'features': 'r5_features', 'product': 'product_runtime'}[suite]
    # Internal precondition is the admitted original build only. Always export
    # current compilation NOT RUN; no old smoke or Keychain success is borrowed.
    data['build'] = 'PASS'; native.save(data)
    command, installed_verify = native.command, native.verify_installed_artifact
    wait = native.wait_for_simulator_app_services
    actual_install = module('ios_normal_install_readiness').ActualInstallReadiness(native,
        lambda device: verify_installed(native, installed_verify, device), suite)
    native.wait_for_simulator_app_services = actual_install.wait
    native.verify_installed_artifact = actual_install.verify
    try:
        if suite == 'startup':
            driver = module('ios_retained_driver_observation')
            native.command = lambda args, label, **kw: driver.observe(native, command, args, label, **kw)
            native.smoke(debug_session=module('ios_launch_debug').Session(native), normal_retained_install=True)
        elif suite == 'product':
            module('product_measurements').run(native)
            data = native.read(); require(data.get('product_ui', {}).get('status') == 'PASS')
            data['product_runtime'] = 'PASS'; native.save(data)
        else: native.smoke(suite)
    except Exception:
        data = native.read(); data[key] = 'FAIL'; native.save(data)
        raise
    finally:
        native.command, native.verify_installed_artifact = command, installed_verify
        native.wait_for_simulator_app_services = wait
        actual_install.finish()
        qualify(native)


def retain(native):
    if not native.EVIDENCE.is_file(): return
    qualify(native)
    require(native.EVIDENCE.stat().st_size <= 4 * 1024 * 1024)
    output = native.ROOT / 'artifacts/private-ios-normal-retained-runtime'
    output.mkdir(parents=True, mode=0o700)
    shutil.copyfile(native.EVIDENCE, output / 'native-metadata.json')
    for name in ('simulator-launch.log', 'host-simulator.log', 'original-launch-error.json', 'owned-crash-reasons.json', 'summary.json'):
        source = native.PRIVATE / 'ios-launch-debug' / name
        if source.is_file() and not source.is_symlink() and source.stat().st_size <= 2 * 1024 * 1024:
            shutil.copyfile(source, output / name)
    data = native.read()
    print('KEEPER_NORMAL_RETAINED_SUMMARY=' + json.dumps({k: data.get(k) for k in
        ('source_sha', 'controller_source_sha', 'compiled_app_source_sha', 'app_inputs_sha256',
         'build', 'current_source_compilation', 'build_execution_scope', 'retained_xcode_restore',
         'original_signature_preserved', 'smoke', 'native_keychain', 'native_probe', 'r5_features', 'product_runtime', 'product_ui',
         'startup_observation', 'metro_warmup', 'native_keychain_evidence', 'retained_live_driver_observation',
         'normal_retained_install_readiness', 'simulator_app_service_readiness', 'install_diagnoses',
         'installed_artifact_verified', 'installed_normal_signature_verified', 'startup_cleanup_errors',
         'native_acceptance')}, sort_keys=True), flush=True)


def main(phase):
    os.umask(0o077)
    native = module('ios_launch_debug').load_native()
    native.EVIDENCE = native.PRIVATE / 'normal-retained-runtime-metadata.json'
    require_selection(native, preflight=phase in ('preflight_verify', 'preflight'))
    if phase == 'preflight_verify': return
    if phase == 'preflight': return preflight(native)
    if phase == 'retain': return retain(native)
    if phase == 'verify': return
    os.environ.update(ENVFILE='.env.ci', RCT_NO_LAUNCH_PACKAGER='1', RCT_NEW_ARCH_ENABLED='1', MAESTRO_CLI_NO_ANALYTICS='1')
    command = native.command
    def read_only_app(args, *values, **kwargs):
        require(not (args and Path(args[0]).name == 'xcodebuild' and args != ['xcodebuild', '-version']))
        require(not (args and Path(args[0]).name == 'codesign' and any(x in args for x in ('--sign', '--force', '--remove-signature'))))
        return command(args, *values, **kwargs)
    native.command = read_only_app
    try:
        if phase == 'record':
            proof = read_proof()
            native.record(); qualify(native)
            data = native.read(); data['original_build'] = {**proof, 'build': 'PASS'}; native.save(data)
        elif phase == 'prepare':
            source_bytes(native, prepared=False)
            native.prepare()
            data = native.read(); data['retained_runtime_dependencies'] = 'PASS'; native.save(data)
            source_bytes(native)
        elif phase == 'restore': restore_app(native)
        elif phase in ('startup', 'keychain', 'probe', 'features', 'product'): run_suite(native, phase)
        else: raise ValueError('Unknown normal retained phase.')
    finally:
        if native.EVIDENCE.is_file(): qualify(native)


if __name__ == '__main__':
    main(sys.argv[1])
