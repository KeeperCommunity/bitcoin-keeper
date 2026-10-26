"""Actual installed-app TLS bridge matrix. Called after ordinary startup PASS.

Uses the existing hosted harness's exact artifact/device policies; does not build,
change trust on the host, modify app/native sources or declare full R5.2 acceptance.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import time
import urllib.request


_BOUNDARY_SPEC = importlib.util.spec_from_file_location('r52_source_boundary', Path(__file__).with_name('r52_source_boundary.py'))
_BOUNDARY = importlib.util.module_from_spec(_BOUNDARY_SPEC)
_BOUNDARY_SPEC.loader.exec_module(_BOUNDARY)
verify_source = _BOUNDARY.verify_source
owned_device = _BOUNDARY.owned_device
require_free_metro_port = _BOUNDARY.require_free_metro_port
SOURCE_PATHS = _BOUNDARY.SOURCE_PATHS


def receive(process, seconds=60):
    with selectors.DefaultSelector() as poll:
        poll.register(process.stdout, selectors.EVENT_READ)
        if not poll.select(seconds):
            raise RuntimeError('TLS_FIXTURE_TIMEOUT')
    raw = process.stdout.readline(65537)
    if not raw.endswith('\n') or len(raw) > 65536:
        raise RuntimeError('TLS_FIXTURE_REPLY_INVALID')
    return json.loads(raw)


def close_fixture(process):
    # A dead child before the requested close supplies no cleanup acknowledgement,
    # even when it never emitted ready or created the generated Metro JSON.
    if process.poll() is not None:
        raise RuntimeError('TLS_FIXTURE_CLEANUP_UNVERIFIED')
    process.stdin.write('close\n')
    process.stdin.flush()
    # readline can finish its loop while the parent's pipe still keeps Node alive.
    # EOF closes only this owned input; successful child exit still proves cleanup.
    process.stdin.close()
    process.wait(timeout=15)
    if process.returncode != 0:
        raise RuntimeError('TLS_FIXTURE_CLEANUP_FAILED')


def validate(config, payload, witnesses, platform):
    expected = config['cases']
    if (payload.get('schema') != 1 or payload.get('scope') != 'ACTUAL_APP_RN_PRODUCTION_TLS_BRIDGE'
            or payload.get('nonce') != config['nonce'] or payload.get('platform') != platform
            or payload.get('transport_status', payload.get('status')) != 'PASS' or len(payload.get('cases', [])) != len(expected)
            or set(witnesses) != {row['id'] for row in expected}):
        raise ValueError('TLS_APP_EVIDENCE_INVALID')
    result = []
    for want, actual in zip(expected, payload['cases']):
        witness = witnesses[want['id']]
        accepted = want['expected'] == 'ACCEPT'
        if (set(actual) != {'id', 'outcome', 'connected'} or actual['id'] != want['id']
                or actual['outcome'] != want['expected'] or actual['connected'] is not accepted
                or set(witness) != {'connections', 'secure_connections', 'requests', 'invalid_payloads'}
                or any(type(value) is not int or not 0 <= value <= 4 for value in witness.values())
                or witness['connections'] != 1 or witness['invalid_payloads'] != 0
                or witness['requests'] != (1 if accepted else 0)
                or (accepted and witness['secure_connections'] != 1)):
            raise ValueError('TLS_APP_SERVER_WITNESS_MISMATCH')
        result.append({'id': want['id'], 'status': 'PASS', 'expected': want['expected'],
                       'server_connection_observed': True, 'application_data_verified': accepted})
    return result


def run(h):
    _run(h)


def run_retained(h):
    # Explicit private diagnostic route; ordinary run(h) keeps its strict gates.
    spec = importlib.util.spec_from_file_location('r52_retained_admission', Path(__file__).with_name('r52_retained_admission.py'))
    retained = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(retained)
    _run(h, retained.admit(h))


def _run(h, retained=None):
    data = h.read()
    context_spec = importlib.util.spec_from_file_location('native_phase_context', Path(__file__).with_name('native_phase_context.py'))
    context = importlib.util.module_from_spec(context_spec); context_spec.loader.exec_module(context)
    if (not context.hosted_context(h, data)
            or h.PLATFORM not in ['IOS', 'ANDROID'] or (retained is None and data.get('build') != 'PASS')
            or data.get('smoke') != 'PASS' or h.artifact_identity() != data['built_artifact']):
        raise RuntimeError('TLS_PRIVATE_HOSTED_EXACT_APP_STARTUP_REQUIRED')
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=h.ROOT, text=True).strip()
    if source != data['source_sha'] or source != os.environ.get('KEEPER_SOURCE_SHA'):
        raise RuntimeError('TLS_EXACT_SOURCE_REQUIRED')
    if retained is None:
        h.command(['git', 'diff', '--exit-code', 'HEAD', '--', *[p for p in SOURCE_PATHS if p != 'package.json']],
                  'Verify committed native driver and production source', error_details=False)
        verify_source(h.ROOT, source, data.get('nodeify_overlay'))
    else:
        retained.verify_source()
    require_free_metro_port()
    generated = h.ROOT / '.github/native/.generated/r52_tls_fixture.json'
    if generated.exists() or generated.is_symlink():
        raise RuntimeError('TLS_STALE_FIXTURE_EXISTS')
    fixture = metro = device = None
    output = h.PRIVATE / 'r52-tls'
    output.mkdir(mode=0o700)
    fixture_log = (output / 'fixture.log').open('w')
    metro_log = (output / 'metro.log').open('w')
    result = {'status': 'FAIL', 'scope': 'ACTUAL_APP_RN_PRODUCTION_TLS_BRIDGE',
              'source_sha': source, 'platform': h.PLATFORM, 'cases': [],
              'full_r52_acceptance': False,
              'limits': ['Custom-trust UI, persistence, installed109to110 upgrade, Tor and physical devices are separate.',
                         'Withdrawn/SPKI explicit-anchor rejection is a bridge result, not isolated policy-method discrimination.',
                         'Android system-root positive is NOT RUN; no system trust configuration is changed.']}
    if retained is not None:
        result.update(retained.result_binding())
    error = None
    try:
        fixture = subprocess.Popen(['node', '.github/native/r52_tls_fixture.cjs', h.PLATFORM, str(generated)],
                                   cwd=h.ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=fixture_log, text=True)
        ready = receive(fixture)
        raw = generated.read_bytes()
        configuration_json = raw.decode()
        if len(raw) > 262144 or hashlib.sha256(raw).hexdigest() != ready.get('config_sha256'):
            raise RuntimeError('TLS_FIXTURE_BINDING')
        config = json.loads(raw)
        ports = [row['port'] for row in config['cases']] + [config['rpc']['selected']['port'],
            config['rpc']['other']['port'], config['rpc']['control_port']]
        if (ready.get('ready') is not True or ready.get('ports') != ports
                or len(set(ports)) != len(ports) or any(type(p) is not int or not 1024 < p < 65536 for p in ports)
                or config.get('platform') != h.PLATFORM or config.get('schema') != 1
                or not re.fullmatch('[a-f0-9]{48}', config.get('nonce', ''))):
            raise RuntimeError('TLS_FIXTURE_BINDING')
        if retained is None:
            context.register_generated(h, 'tls', ready['config_sha256'])
        if h.PLATFORM == 'IOS':
            candidate = h.command(['xcrun', 'simctl', 'create', 'Keeper-r52-tls-disposable',
                                'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
                                'com.apple.CoreSimulator.SimRuntime.iOS-18-5'], 'Create owned TLS simulator', capture=True)
            device = owned_device(candidate, h.PLATFORM)
            h.command(['xcrun', 'simctl', 'boot', device], 'Boot owned TLS simulator')
            h.command(['xcrun', 'simctl', 'bootstatus', device, '-b'], 'Wait for owned TLS simulator', timeout=240)
            if retained is None and data.get('toolchain', {}).get('ios_simulator_build_profile') == 'normal-xcode':
                h.wait_for_simulator_app_services(device, suite='tls')
            else:
                h.wait_for_simulator_app_services(device)
            # Only this newly created disposable simulator receives the fixture root.
            h.command(['xcrun', 'simctl', 'keychain', device, 'add-root-cert', ready['rootPath']],
                      'Trust disposable fixture root in owned simulator only', error_details=False)
            result['simulator_root_mutation'] = 'ADDED_ONLY_TO_NEW_OWNED_SIMULATOR_REMOVED_WITH_DEVICE'
            native_policy = h.command(['node', '.github/native/r52_ios_policy.cjs', device,
                                      str(Path(ready['rootPath']).parent)],
                                     'Execute exact Objective-C policy and delegate on Security.framework',
                                     capture=True, timeout=180, error_details=False)
            result['ios_security_framework'] = json.loads(native_policy)
            h.command(['xcrun', 'simctl', 'install', device,
                       str(h.PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app')],
                      'Install exact app for native TLS bridge', timeout=120)
        else:
            candidate = h.command(['adb', 'get-serialno'], 'Identify owned TLS emulator', capture=True)
            device = owned_device(candidate, h.PLATFORM)
            for port in [8081, *ports]:
                h.command(['adb', '-s', device, 'reverse', 'tcp:' + str(port), 'tcp:' + str(port)],
                          'Connect owned emulator to loopback TLS fixture', error_details=False)
            h.command(['adb', '-s', device, 'install', '-r',
                       'android/app/build/outputs/apk/development/debug/app-development-debug.apk'],
                      'Install exact app for native TLS bridge', timeout=120)
            cleared = h.command(['adb', '-s', device, 'shell', 'pm', 'clear', h.APP_IDS[h.PLATFORM]],
                                'Create empty owned app state for synthetic RPC', capture=True)
            if cleared != 'Success':
                raise RuntimeError('TLS_EMPTY_DISPOSABLE_APP_REQUIRED')
        h.verify_installed_artifact(device)
        metro = subprocess.Popen(['node', 'node_modules/react-native/cli.js', 'start', '--port', '8081',
                                  '--config', '.github/native/r52_tls_metro.cjs'], cwd=h.ROOT,
                                 stdout=metro_log, stderr=subprocess.STDOUT, start_new_session=True)
        for _ in range(60):
            if metro.poll() is not None:
                raise RuntimeError('TLS_METRO_EXITED')
            try:
                with urllib.request.urlopen('http://127.0.0.1:8081/status', timeout=2) as response:
                    if response.read(1024) == b'packager-status:running':
                        break
            except OSError:
                time.sleep(1)
        else:
            raise RuntimeError('TLS_METRO_TIMEOUT')
        h.warm_metro_bundle('r52_tls')
        report = output / 'junit.xml'
        h.command([data['maestro']['binary'], '--device', device, 'test', '--env', 'APP_ID=' + h.APP_IDS[h.PLATFORM],
                   '--flatten-debug-output', '--debug-output', str(output), '--test-output-dir', str(output),
                   '--format', 'junit', '--output', str(report), '.github/native/r52_tls_probe.yaml'],
                  'Execute actual production native TLS bridge and synthetic RPC matrix', timeout=480, error_details=False)
        h.successful_junit(report)
        if h.PLATFORM == 'IOS':
            container = Path(h.command(['xcrun', 'simctl', 'get_app_container', device, h.APP_IDS[h.PLATFORM], 'data'],
                                       'Locate owned TLS app receipt', capture=True))
            expected_parent = Path.home() / 'Library/Developer/CoreSimulator/Devices' / device / 'data/Containers/Data/Application'
            if (not container.is_absolute() or not re.fullmatch(r'[a-fA-F0-9-]{36}', container.name)
                    or container.resolve(strict=True).parent != expected_parent.resolve(strict=True)):
                raise RuntimeError('TLS_OWNED_DATA_CONTAINER_REQUIRED')
            receipt = container / 'Documents/keeper-r52-tls-evidence.json'
            if receipt.stat().st_size > 65536:
                raise RuntimeError('TLS_APP_RECEIPT_SIZE')
            payload = json.loads(receipt.read_text())
        else:
            raw = h.command(['adb', '-s', device, 'exec-out', 'run-as', h.APP_IDS[h.PLATFORM],
                             'head', '-c', '65537', 'files/keeper-r52-tls-evidence.json'],
                            'Read bounded owned TLS app receipt', capture=True, error_details=False)
            if len(raw.encode()) > 65536:
                raise RuntimeError('TLS_APP_RECEIPT_SIZE')
            payload = json.loads(raw)
        fixture.stdin.write('snapshot\n'); fixture.stdin.flush()
        witness = receive(fixture)
        result['cases'] = validate(config, payload, witness['tls'], h.PLATFORM)
        spec = importlib.util.spec_from_file_location('r52_rpc_evidence', Path(__file__).with_name('r52_rpc_evidence.py'))
        rpc_evidence = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(rpc_evidence)
        result['rpc'] = rpc_evidence.validate_rpc(config, payload.get('rpc', {}), witness.get('rpc', {}), h.PLATFORM)
        if retained is None:
            verify_source(h.ROOT, source, data.get('nodeify_overlay'))
        else:
            retained.verify_source()
        if h.artifact_identity() != data['built_artifact']:
            raise RuntimeError('TLS_BUILT_ARTIFACT_CHANGED')
        h.verify_installed_artifact(device)
        if retained is None:
            result['binding'] = context.result_binding(h)
            result['raw_evidence'] = dict(configuration_json=configuration_json, app_payload=payload, server_witnesses=witness)
        result.update(status='PASS', installed_bytes_verified=True, fixture_sha256=ready['config_sha256'])
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
        if fixture:
            attempt('fixture_close', lambda: close_fixture(fixture))
            if fixture.poll() is None:
                attempt('fixture_kill', fixture.kill)
                attempt('fixture_reap', lambda: fixture.wait(timeout=10))
            attempt('fixture_stdin', fixture.stdin.close)
            attempt('fixture_stdout', fixture.stdout.close)
        if generated.exists():
            cleanup.append('fixture_file_retained')
        if device and h.PLATFORM == 'IOS':
            for action in ['shutdown', 'delete']:
                attempt('device_' + action, lambda action=action: subprocess.run(
                    ['xcrun', 'simctl', action, device], check=True, capture_output=True, timeout=30))
        elif device:
            for port in [8081, *locals().get('ports', [])]:
                attempt('reverse_' + str(port), lambda port=port: subprocess.run(
                    ['adb', '-s', device, 'reverse', '--remove', 'tcp:' + str(port)],
                    check=True, capture_output=True, timeout=10))
            attempt('device_uninstall', lambda: subprocess.run(['adb', '-s', device, 'uninstall', h.APP_IDS[h.PLATFORM]],
                                                              check=True, capture_output=True, timeout=30))
        fixture_log.close(); metro_log.close()
        if error or cleanup:
            result['status'] = 'FAIL'
        result['cleanup'] = 'FAIL' if cleanup else 'PASS'
        result['cleanup_failures'] = cleanup
        current = h.read(); current['r52_tls_native'] = result; h.save(current)
        if cleanup and error is None:
            raise RuntimeError('TLS_CLEANUP_FAILED')
