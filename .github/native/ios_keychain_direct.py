"""Actual disposable RN Keychain bridge, independent of Maestro/UI acceptance."""
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time
import urllib.request

SCOPE = 'DIRECT_SIMCTL_NATIVE_KEYCHAIN_ONLY_NO_STARTUP_UI_OR_NATIVE_ACCEPTANCE'
UUID = r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}'
STAGES = ('seeded', 'updated', 'pass')
STAGE_TIMEOUT = 90


def module(name):
    spec = importlib.util.spec_from_file_location('direct_keychain_' + name,
        Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def witness(native, device, expected, previous):
    deadline = time.monotonic() + STAGE_TIMEOUT
    while time.monotonic() < deadline:
        try:
            value = module('keychain_evidence').collect(native, device)
        except (OSError, ValueError, RuntimeError):
            value = None
        if value is not None:
            if value['stage'] == 'failed':
                return value
            if value['stage'] == expected:
                return value
            if value['stage'] != previous:
                raise RuntimeError('Unexpected native Keychain stage.')
        time.sleep(1)
    raise RuntimeError('Native Keychain receipt deadline exceeded.')


def run(native):
    if native.PLATFORM != 'IOS':
        raise ValueError('Owned iOS simulator required.')
    expected_artifact = native.read()['built_artifact']
    if native.artifact_identity() != expected_artifact:
        raise RuntimeError('Exact restored app required.')
    result = {'schema': 1, 'scope': SCOPE, 'status': 'FAIL', 'native_acceptance': False,
              'launches': [], 'stages': [], 'cleanup_errors': [], 'phase': 'METRO_READY'}
    device = metro = None
    primary_error = None
    log = (native.PRIVATE / 'direct-keychain-metro.log').open('wb')
    try:
        metro = subprocess.Popen(['node', 'node_modules/react-native/cli.js', 'start', '--port', '8081',
            '--config', str(native.ROOT / '.github/native/keychain_metro.cjs')], cwd=native.ROOT,
            stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        for _ in range(60):
            if metro.poll() is not None:
                raise RuntimeError('Diagnostic Metro exited.')
            try:
                with urllib.request.urlopen('http://127.0.0.1:8081/status', timeout=2) as response:
                    if b'packager-status:running' in response.read(128):
                        break
            except OSError:
                pass
            time.sleep(1)
        else:
            raise RuntimeError('Diagnostic Metro readiness deadline exceeded.')
        result['phase'] = 'METRO_WARMUP'
        native.warm_metro_bundle('direct_keychain')
        result['phase'] = 'SIMULATOR_SETUP'
        device = native.command(['xcrun', 'simctl', 'create', 'Keeper-disposable-keychain-direct',
            'com.apple.CoreSimulator.SimDeviceType.iPhone-16', 'com.apple.CoreSimulator.SimRuntime.iOS-18-5'],
            'Create fresh direct Keychain simulator', capture=True)
        if not re.fullmatch(UUID, device):
            device = None
            raise ValueError('Owned simulator UUID required.')
        native.command(['xcrun', 'simctl', 'boot', device], 'Boot direct Keychain simulator')
        native.command(['xcrun', 'simctl', 'bootstatus', device, '-b'],
            'Wait for direct Keychain simulator boot', timeout=240)
        native.wait_for_simulator_app_services(device)
        result['phase'] = 'INSTALL_AND_VERIFY'
        native.command(['xcrun', 'simctl', 'install', device, expected_artifact['path']],
            'Install exact app for direct Keychain diagnostic', timeout=120, error_details=False)
        data = native.read()
        data.update(device={'id': device, 'fresh_disposable_state': True}, install_succeeded=True)
        native.save(data)
        native.verify_installed_artifact(device)
        app = native.APP_IDS['IOS']
        for index, stage in enumerate(STAGES):
            result['phase'] = 'LAUNCH_' + stage.upper()
            response = native.command(['xcrun', 'simctl', 'launch', device, app],
                'Launch direct Keychain process %d' % (index + 1), timeout=20,
                capture=True, error_details=False)
            match = re.fullmatch(re.escape(app) + r': ([1-9][0-9]{0,9})', response)
            if not match or int(match.group(1)) in result['launches']:
                raise RuntimeError('Distinct native process launch required.')
            result['launches'].append(int(match.group(1)))
            result['phase'] = 'READ_NATIVE_' + stage.upper()
            observation = witness(native, device, stage, STAGES[index - 1] if index else None)
            result['stages'].append(observation)
            if observation['stage'] != stage:
                raise RuntimeError('Disposable Keychain native operation failed.')
            if native.artifact_identity() != expected_artifact:
                raise RuntimeError('Original app changed during diagnostic.')
            native.verify_installed_artifact(device)
            native.command(['xcrun', 'simctl', 'terminate', device, app],
                'Terminate direct Keychain process %d' % (index + 1), timeout=20, error_details=False)
        result.update(status='PASS', phase='OBSERVED_THREE_PROCESS_COMPLETION')
    except Exception as error:
        primary_error = error
        raise
    finally:
        def cleanup(label, action):
            try:
                action()
            except Exception:
                result['cleanup_errors'].append(label)
        if device:
            for action in ('shutdown', 'delete'):
                cleanup('device_' + action, lambda action=action: subprocess.run(
                    ['xcrun', 'simctl', action, device], stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL, timeout=30, check=True))
        def stop_metro():
            if metro is not None and metro.poll() is None:
                os.killpg(metro.pid, signal.SIGTERM)
                try:
                    metro.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(metro.pid, signal.SIGKILL)
                    metro.wait(timeout=10)
        cleanup('metro_process', stop_metro)
        cleanup('metro_log', log.close)
        if primary_error is not None or result['cleanup_errors']:
            result['status'] = 'FAIL'
        try:
            data = native.read()
            data['direct_keychain_diagnostic'] = result
            native.save(data)
        except Exception:
            if primary_error is None:
                raise RuntimeError('Direct Keychain diagnostic receipt unavailable.') from None
        if primary_error is None and result['cleanup_errors']:
            raise RuntimeError('Direct Keychain diagnostic cleanup failed.')
