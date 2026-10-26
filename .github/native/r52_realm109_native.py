"""Private hosted native synthetic109 migration. No published-app upgrade claim."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import time
import urllib.request

SCOPE = 'ACTUAL_NATIVE_SYNTHETIC_REALM109_TO_110'
HISTORICAL = '2b6c3ce56857b5dc92f17cc37453ff308d5a3ae8'
MANIFEST = 'bc46b37001c423f96e8aff5ed3e8b63a3ac261224e5647a1dab13179eb54d4d2'
SOURCE_PATHS = ['.github/native', 'tests/recovery/fixtures/realm109-node-source.json', 'src',
                'package.json', 'yarn.lock', 'app.json', 'babel.config.js', 'metro.config.js',
                'shim.js', 'index.js', 'tsconfig.json', 'react-native.config.js']
CASES = [
    'historical109_encrypted_create_and_reopen', 'production_initializer_109_to_110',
    'node_identity_and_defaults_preserved', 'default_node_preserved_without_trust',
    'selected_public_ca_survives_close_reopen', 'same_host_other_port_has_no_trust',
    'onion_plaintext_preserved_without_trust', 'separate_database_has_no_inherited_trust',
    'wrong_key_rejected', 'omitted_key_rejected', 'correct_key_recovers_without_reset',
]


def validate(config, payload, platform, source):
    expected = dict(schema=1, scope=SCOPE, source_sha=source, platform=platform,
                    nonce=config['nonce'], historical_commit=HISTORICAL, manifest_sha256=MANIFEST,
                    status='PASS', old_version=109, new_version=110, schema_count=50,
                    synthetic_database_cleanup='PASS', cases=[dict(id=value, status='PASS') for value in CASES])
    if json.dumps(payload, sort_keys=True) != json.dumps(expected, sort_keys=True):
        raise ValueError('REALM109_NATIVE_EVIDENCE_INVALID')
    return expected['cases']


def verify_generated(generated, digest):
    config_file = generated / 'config.json'
    if (generated.resolve() != generated or generated.is_symlink() or config_file.is_symlink() or not config_file.is_file()
            or config_file.stat().st_size > 32768 or config_file.stat().st_nlink != 1):
        raise ValueError('REALM109_GENERATED_IDENTITY')
    raw = config_file.read_bytes()
    if hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError('REALM109_GENERATED_IDENTITY')
    config = json.loads(raw)
    names = [row['name'] for row in config['generated']]
    if len(names) != 16 or len(set(names)) != 16:
        raise ValueError('REALM109_GENERATED_CLOSURE')
    expected_directories = set()
    for row in config['generated']:
        relative = Path(row['name'])
        file = generated / relative
        if (relative.is_absolute() or '..' in relative.parts or relative.as_posix() != row['name']
                or file.is_symlink() or not file.is_file() or file.stat().st_nlink != 1
                or file.stat().st_size > 524288
                or file.resolve().is_relative_to(generated.resolve()) is not True
                or hashlib.sha256(file.read_bytes()).hexdigest() != row['sha256']):
            raise ValueError('REALM109_GENERATED_BYTES')
        expected_directories.update(parent.as_posix() for parent in relative.parents if parent != Path('.'))
    actual_files, actual_directories = set(), set()
    for entry in generated.rglob('*'):
        mode = entry.lstat().st_mode
        name = entry.relative_to(generated).as_posix()
        if stat.S_ISDIR(mode):
            actual_directories.add(name)
        elif stat.S_ISREG(mode) and entry.stat().st_nlink == 1:
            actual_files.add(name)
        else:
            raise ValueError('REALM109_GENERATED_INVENTORY')
    if actual_files != set(names) | {'config.json'} or actual_directories != expected_directories:
        raise ValueError('REALM109_GENERATED_INVENTORY')
    return config


def owned_device(candidate, platform):
    pattern = r'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}' if platform == 'IOS' else 'emulator-[0-9]+'
    if platform not in ['IOS', 'ANDROID'] or not re.fullmatch(pattern, candidate):
        raise RuntimeError('REALM109_OWNED_DEVICE_REQUIRED')
    return candidate


def require_free_metro_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        try:
            listener.bind(('127.0.0.1', 8081))
        except OSError as error:
            raise RuntimeError('REALM109_METRO_PORT_OCCUPIED') from error


def verify_package_overlay(original, installed, overlay):
    allowed = ['browser', 'react-native', 'browserify']
    if (not isinstance(overlay, dict) or overlay.get('path') != 'package.json'
            or overlay.get('allowed_fields') != allowed
            or overlay.get('before_sha256') != hashlib.sha256(original).hexdigest()
            or overlay.get('after_sha256') != hashlib.sha256(installed).hexdigest()):
        raise RuntimeError('REALM109_PACKAGE_OVERLAY_UNRECORDED')
    before, after = json.loads(original), json.loads(installed)
    for name in allowed:
        before.pop(name, None); after.pop(name, None)
    if json.dumps(before, sort_keys=True) != json.dumps(after, sort_keys=True):
        raise RuntimeError('REALM109_PACKAGE_PROTECTED_FIELDS')


def verify_source(root, source, overlay=None):
    """Compare immutable Git blob bytes, including files hidden from git diff."""
    environment = dict(PATH=os.environ.get('PATH', ''), GIT_CONFIG_NOSYSTEM='1',
                       GIT_CONFIG_GLOBAL=os.devnull, GIT_TERMINAL_PROMPT='0', GIT_ALLOW_PROTOCOL='')
    def git(*args):
        return subprocess.check_output(['git', '--no-replace-objects', *args], cwd=root, env=environment)
    if not re.fullmatch('[a-f0-9]{40}', source) or git('rev-parse', 'HEAD').decode().strip() != source:
        raise RuntimeError('REALM109_RAW_SOURCE_HEAD')
    entries = git('ls-tree', '-r', '-z', source, '--', *SOURCE_PATHS).split(b'\0')
    entries = [entry for entry in entries if entry]
    if not entries:
        raise RuntimeError('REALM109_RAW_SOURCE_EMPTY')
    for ignored in [[], ['--ignored']]:
        extra = git('ls-files', '--others', '--exclude-standard', *ignored, '-z', '--', *SOURCE_PATHS)
        for raw_name in extra.split(b'\0'):
            if not raw_name:
                continue
            name = raw_name.decode('utf8')
            if name.startswith('.github/native/.generated/'):
                continue  # its exact16-module/config inventory is verified independently
            if re.fullmatch(r'\.github/native/__pycache__/[A-Za-z0-9_]+\.cpython-[0-9]+\.pyc', name):
                continue
            raise RuntimeError('REALM109_UNTRACKED_SOURCE')
    process = subprocess.Popen(['git', '--no-replace-objects', 'cat-file', '--batch'], cwd=root,
                               env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        for entry in entries:
            metadata, name = entry.split(b'\t', 1)
            mode, kind, oid = metadata.split(b' ')
            relative = Path(name.decode('utf8'))
            file = root / relative
            if (mode not in [b'100644', b'100755'] or kind != b'blob' or relative.is_absolute()
                    or '..' in relative.parts or not file.is_file() or file.is_symlink()
                    or any((root / parent).is_symlink() for parent in relative.parents)
                    or file.stat().st_size > 32 * 1024 * 1024):
                raise RuntimeError('REALM109_RAW_SOURCE_PATH')
            process.stdin.write(oid + b'\n'); process.stdin.flush()
            header = process.stdout.readline(128).split()
            if len(header) != 3 or header[0] != oid or header[1] != b'blob':
                raise RuntimeError('REALM109_RAW_SOURCE_OBJECT')
            size = int(header[2])
            if size < 0 or size > 32 * 1024 * 1024:
                raise RuntimeError('REALM109_RAW_SOURCE_SIZE')
            raw = process.stdout.read(size)
            if len(raw) != size or process.stdout.read(1) != b'\n':
                raise RuntimeError('REALM109_RAW_SOURCE_BYTES')
            installed = file.read_bytes()
            if raw != installed:
                if relative.as_posix() != 'package.json':
                    raise RuntimeError('REALM109_RAW_SOURCE_BYTES')
                verify_package_overlay(raw, installed, overlay)
        process.stdin.close()
        if process.wait(timeout=10) != 0:
            raise RuntimeError('REALM109_RAW_SOURCE_GIT')
    finally:
        if not process.stdin.closed:
            process.stdin.close()
        if process.poll() is None:
            process.kill(); process.wait(timeout=10)
        process.stdout.close()
    if git('rev-parse', 'HEAD').decode().strip() != source:
        raise RuntimeError('REALM109_RAW_SOURCE_HEAD')


def run(h):
    data = h.read()
    if (os.environ.get('GITHUB_ACTIONS') != 'true'
            or os.environ.get('GITHUB_REPOSITORY') != 'KeeperCommunity/bitcoin-keeper-private'
            or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted'
            or h.PLATFORM not in ['IOS', 'ANDROID'] or data.get('build') != 'PASS'
            or data.get('smoke') != 'PASS' or h.artifact_identity() != data['built_artifact']):
        raise RuntimeError('REALM109_PRIVATE_HOSTED_EXACT_APP_STARTUP_REQUIRED')
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=h.ROOT, text=True).strip()
    if source != data['source_sha'] or source != os.environ.get('KEEPER_SOURCE_SHA'):
        raise RuntimeError('REALM109_EXACT_SOURCE_REQUIRED')
    h.command(['git', 'diff', '--exit-code', 'HEAD', '--', *[p for p in SOURCE_PATHS if p != 'package.json']],
              'Verify committed Realm fixture and production source', error_details=False)
    verify_source(h.ROOT, source, data.get('nodeify_overlay'))
    require_free_metro_port()
    generated = h.ROOT / '.github/native/.generated/r52_realm109'
    if generated.exists() or generated.is_symlink():
        raise RuntimeError('REALM109_STALE_GENERATED_SOURCE')
    output = h.PRIVATE / 'r52-realm109'
    output.mkdir(mode=0o700)
    metro_log = (output / 'metro.log').open('w')
    device = metro = None
    owned_generated = False
    result = dict(status='FAIL', scope=SCOPE, source_sha=source, platform=h.PLATFORM, cases=[],
                  published_app_upgrade='NOT RUN', full_r52_acceptance=False,
                  limits=['Synthetic encrypted native database from exact historical schema sources; no old APK/IPA or existing account.',
                          'CA assignment is a fixture write; normal UI persistence and physical devices are separate.'])
    error = None
    try:
        owned_generated = True
        prepared = json.loads(h.command(['node', '.github/native/r52_realm109_prepare.cjs', h.PLATFORM],
                              'Verify and prepare frozen historical Realm109 source', capture=True, error_details=False))
        config = verify_generated(generated, prepared['config_sha256'])
        if (prepared.get('generated_modules') != 16 or prepared.get('historical_files') != 17
                or config.get('scope') != SCOPE or config.get('schema') != 1
                or config.get('source_sha') != source or config.get('platform') != h.PLATFORM
                or config.get('historical_commit') != HISTORICAL or config.get('manifest_sha256') != MANIFEST
                or config.get('realm_package') != '12.15.0' or config.get('schema_count') != 50
                or not re.fullmatch('[a-f0-9]{48}', config.get('nonce', ''))):
            raise RuntimeError('REALM109_CONFIG_IDENTITY')
        if h.PLATFORM == 'IOS':
            candidate = h.command(['xcrun', 'simctl', 'create', 'Keeper-realm109-disposable',
                                'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
                                'com.apple.CoreSimulator.SimRuntime.iOS-18-5'], 'Create owned Realm109 simulator', capture=True)
            device = owned_device(candidate, h.PLATFORM)
            h.command(['xcrun', 'simctl', 'boot', device], 'Boot owned Realm109 simulator')
            h.command(['xcrun', 'simctl', 'bootstatus', device, '-b'], 'Wait for owned Realm109 simulator', timeout=240)
            h.wait_for_simulator_app_services(device)
            h.command(['xcrun', 'simctl', 'install', device,
                       str(h.PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app')],
                      'Install exact app for native Realm migration', timeout=120)
        else:
            candidate = h.command(['adb', 'get-serialno'], 'Identify owned Realm109 emulator', capture=True)
            device = owned_device(candidate, h.PLATFORM)
            h.command(['adb', '-s', device, 'reverse', 'tcp:8081', 'tcp:8081'], 'Connect owned emulator to Metro')
            h.command(['adb', '-s', device, 'install', '-r',
                       'android/app/build/outputs/apk/development/debug/app-development-debug.apk'],
                      'Install exact app for native Realm migration', timeout=120)
            cleared = h.command(['adb', '-s', device, 'shell', 'pm', 'clear', h.APP_IDS[h.PLATFORM]],
                                'Create disposable empty app state for Realm fixture', capture=True)
            if cleared != 'Success':
                raise RuntimeError('REALM109_EMPTY_DISPOSABLE_APP_REQUIRED')
        h.verify_installed_artifact(device)
        metro = subprocess.Popen(['node', 'node_modules/react-native/cli.js', 'start', '--port', '8081',
                                  '--config', '.github/native/r52_realm109_metro.cjs'], cwd=h.ROOT,
                                 stdout=metro_log, stderr=subprocess.STDOUT, start_new_session=True)
        for _ in range(60):
            if metro.poll() is not None:
                raise RuntimeError('REALM109_METRO_EXITED')
            try:
                with urllib.request.urlopen('http://127.0.0.1:8081/status', timeout=2) as response:
                    if response.read(1024) == b'packager-status:running':
                        break
            except OSError:
                time.sleep(1)
        else:
            raise RuntimeError('REALM109_METRO_TIMEOUT')
        h.warm_metro_bundle('r52_realm109')
        report = output / 'junit.xml'
        h.command([data['maestro']['binary'], '--device', device, 'test', '--env', 'APP_ID=' + h.APP_IDS[h.PLATFORM],
                   '--flatten-debug-output', '--debug-output', str(output), '--test-output-dir', str(output),
                   '--format', 'junit', '--output', str(report), '.github/native/r52_realm109_probe.yaml'],
                  'Execute actual native synthetic Realm109 migration', timeout=240, error_details=False)
        h.successful_junit(report)
        if h.PLATFORM == 'IOS':
            container = Path(h.command(['xcrun', 'simctl', 'get_app_container', device, h.APP_IDS[h.PLATFORM], 'data'],
                                       'Locate owned Realm109 app receipt', capture=True))
            expected = Path.home() / 'Library/Developer/CoreSimulator/Devices' / device / 'data/Containers/Data/Application'
            if (not container.is_absolute() or not re.fullmatch(r'[a-fA-F0-9-]{36}', container.name)
                    or container.resolve(strict=True).parent != expected.resolve(strict=True)):
                raise RuntimeError('REALM109_OWNED_DATA_CONTAINER_REQUIRED')
            receipt = container / 'Documents/keeper-r52-realm109-evidence.json'
            if receipt.is_symlink() or receipt.stat().st_size > 32768:
                raise RuntimeError('REALM109_RECEIPT_SIZE')
            payload = json.loads(receipt.read_text())
        else:
            raw = h.command(['adb', '-s', device, 'exec-out', 'run-as', h.APP_IDS[h.PLATFORM],
                             'head', '-c', '32769', 'files/keeper-r52-realm109-evidence.json'],
                            'Read bounded owned Realm109 app receipt', capture=True, error_details=False)
            if len(raw.encode()) > 32768:
                raise RuntimeError('REALM109_RECEIPT_SIZE')
            payload = json.loads(raw)
        result['cases'] = validate(config, payload, h.PLATFORM, source)
        verify_generated(generated, prepared['config_sha256'])
        verify_source(h.ROOT, source, data.get('nodeify_overlay'))
        if h.artifact_identity() != data['built_artifact']:
            raise RuntimeError('REALM109_BUILT_ARTIFACT_CHANGED')
        h.verify_installed_artifact(device)
        result.update(status='PASS', installed_bytes_verified=True, config_sha256=prepared['config_sha256'],
                      historical_commit=HISTORICAL, manifest_sha256=MANIFEST)
    except Exception as exc:
        error = exc
        raise
    finally:
        cleanup = []
        def attempt(label, action):
            try:
                action()
            except Exception:
                cleanup.append(label)
        if metro and metro.poll() is None:
            attempt('metro_stop', lambda: os.killpg(metro.pid, signal.SIGTERM))
            attempt('metro_wait', lambda: metro.wait(timeout=15))
            if metro.poll() is None:
                attempt('metro_kill', lambda: os.killpg(metro.pid, signal.SIGKILL))
                attempt('metro_reap', lambda: metro.wait(timeout=10))
        if owned_generated and generated.exists():
            attempt('generated_source', lambda: shutil.rmtree(generated))
        if device and h.PLATFORM == 'IOS':
            for action in ['shutdown', 'delete']:
                attempt('device_' + action, lambda action=action: subprocess.run(
                    ['xcrun', 'simctl', action, device], check=True, capture_output=True, timeout=30))
        elif device:
            attempt('reverse', lambda: subprocess.run(['adb', '-s', device, 'reverse', '--remove', 'tcp:8081'],
                                                     check=True, capture_output=True, timeout=10))
            attempt('device_uninstall', lambda: subprocess.run(['adb', '-s', device, 'uninstall', h.APP_IDS[h.PLATFORM]],
                                                              check=True, capture_output=True, timeout=30))
        metro_log.close()
        if error or cleanup:
            result['status'] = 'FAIL'
        result.update(cleanup='FAIL' if cleanup else 'PASS', cleanup_failures=cleanup)
        current = h.read(); current['r52_realm109_native'] = result; h.save(current)
        if cleanup and error is None:
            raise RuntimeError('REALM109_CLEANUP_FAILED')


if __name__ == '__main__':
    import hosted_native as harness
    os.environ.update(ENVFILE='.env.ci', RCT_NO_LAUNCH_PACKAGER='1', RCT_NEW_ARCH_ENABLED='1', MAESTRO_CLI_NO_ANALYTICS='1')
    try:
        run(harness)
    except Exception:
        print('Native synthetic Realm109 validation failed; inspect fixed phase metadata.', file=sys.stderr)
        sys.exit(1)
