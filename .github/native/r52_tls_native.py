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


def failure_receipt(raw, config, platform, progress=False):
    """Validate binding and project only fixed diagnostic fields, never raw app data."""
    if type(raw) is not str or len(raw.encode()) > 65536:
        raise ValueError('TLS_DIAGNOSTIC_RECEIPT_SIZE')
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('TLS_DIAGNOSTIC_DUPLICATE_KEY')
            result[key] = value
        return result
    payload = json.loads(raw, object_pairs_hook=unique_object)
    scope = 'ACTUAL_APP_RN_PRODUCTION_TLS_PROGRESS' if progress else 'ACTUAL_APP_RN_PRODUCTION_TLS_BRIDGE'
    if (type(payload) is not dict or type(payload.get('schema')) is not int or payload.get('schema') != 1 or payload.get('scope') != scope
            or payload.get('nonce') != config['nonce'] or payload.get('platform') != platform):
        raise ValueError('TLS_DIAGNOSTIC_RECEIPT_BINDING')
    rows = payload.get('cases')
    expected = config['cases']
    if (type(rows) is not list or len(rows) > len(expected)
            or (not progress and len(rows) != len(expected))):
        raise ValueError('TLS_DIAGNOSTIC_RECEIPT_CASES')
    outcomes = {'ACCEPT', 'REJECT', 'TIMEOUT', 'POST_CONNECT_ERROR', 'BAD_REPLY', 'CLOSED_WITHOUT_RESULT', 'JS_EXCEPTION'}
    safe = []
    for index, row in enumerate(rows):
        if (type(row) is not dict or set(row) != {'id', 'outcome', 'connected'}
                or row['id'] != expected[index]['id'] or row['outcome'] not in outcomes
                or type(row['connected']) is not bool):
            raise ValueError('TLS_DIAGNOSTIC_RECEIPT_CASE')
        safe.append(dict(id=expected[index]['id'], outcome=row['outcome'], connected=row['connected'],
                         matches_expected=row['outcome'] == expected[index]['expected']
                         and row['connected'] is (expected[index]['expected'] == 'ACCEPT')))
    result = dict(state='BOUND', completed_cases=safe, completed_case_count=len(safe))
    if progress:
        if (payload.get('state') not in ('RUNNING', 'COMPLETE', 'EXCEPTION')
                or payload.get('phase') not in ('TLS', 'RPC', 'WRITE')
                or (payload.get('phase') == 'TLS' and len(rows) >= len(expected))
                or (payload.get('phase') != 'TLS' and len(rows) != len(expected))
                or (payload.get('state') == 'COMPLETE' and payload.get('phase') != 'WRITE')
                or payload.get('active_case') != (expected[len(rows)]['id']
                    if payload.get('phase') == 'TLS' and len(rows) < len(expected) else None)):
            raise ValueError('TLS_DIAGNOSTIC_PROGRESS_STATE')
        result.update(probe_state=payload['state'], phase=payload['phase'], active_case=payload['active_case'])
    else:
        rpc = payload.get('rpc')
        if (payload.get('status') not in ('PASS', 'FAIL') or payload.get('transport_status') not in ('PASS', 'FAIL')
                or type(rpc) is not dict or rpc.get('status') not in ('PASS', 'FAIL', 'NOT RUN')):
            raise ValueError('TLS_DIAGNOSTIC_FINAL_STATE')
        result.update(probe_status=payload['status'], transport_status=payload['transport_status'], rpc_status=rpc['status'])
        # No arbitrary exception text, extra RPC fields, nonce, certificates or paths.
        rpc_cases = ['synthetic_headers', 'synthetic_utxo', 'synthetic_history', 'synthetic_fee',
                     'synthetic_fake_broadcast', 'forced_selected_socket_retry', 'other_endpoint_no_inherited_ca',
                     'other_endpoint_explicit_same_ca', 'explicit_disconnect_no_retry']
        cases = rpc.get('cases', [])
        if type(cases) is not list or len(cases) > len(rpc_cases) or any(
                type(row) is not dict or row.get('id') != rpc_cases[index] or row.get('status') != 'PASS'
                for index, row in enumerate(cases)):
            raise ValueError('TLS_DIAGNOSTIC_RPC_CASES')
        result['rpc_completed_cases'] = rpc_cases[:len(cases)]
        failures = {'RPC_APP_TIMEOUT', 'RPC_DEV_CONFIG', 'RPC_LOOPBACK_ONLY', 'RPC_DISPOSABLE_INPUT',
                    'RPC_REHYDRATION_REQUIRED', 'RPC_EMPTY_DISPOSABLE_APP_REQUIRED', 'RPC_SELECTED_PRIVATE_POLICY',
                    'RPC_SERVER_WITNESS_REJECTED', 'RPC_SERVER_WITNESS_REPLY', 'RPC_INITIAL_CONNECTION',
                    'RPC_HEADERS', 'RPC_UTXO', 'RPC_HISTORY', 'RPC_FEE', 'RPC_FAKE_BROADCAST',
                    'RPC_PRODUCTION_RETRY_REQUIRED', 'RPC_OTHER_INHERITED_TRUST', 'RPC_OTHER_EXPLICIT_TRUST',
                    'RPC_EXPLICIT_DISCONNECT', 'RPC_NATIVE_OR_APP_EXCEPTION', 'RPC_APP_CLEANUP_FAILED'}
        if 'failure' in rpc:
            result['rpc_failure'] = rpc['failure'] if type(rpc['failure']) is str and rpc['failure'] in failures else 'UNKNOWN_RPC_FAILURE'
    return result


def collect_android_failure(h, device, config, output, fixture=None):
    """Best-effort observation before owned-app cleanup; cannot supply acceptance."""
    import xml.etree.ElementTree as ET
    result = dict(scope='ANDROID_TLS_FAILURE_OBSERVATION_NOT_ACCEPTANCE', native_acceptance=False)
    if h.PLATFORM != 'ANDROID' or owned_device(device, h.PLATFORM) != device:
        raise ValueError('TLS_DIAGNOSTIC_OWNED_ANDROID_REQUIRED')
    for name, progress in [('final_receipt', False), ('progress_receipt', True)]:
        filename = 'keeper-r52-tls-' + ('progress' if progress else 'evidence') + '.json'
        try:
            raw = h.command(['adb', '-s', device, 'exec-out', 'run-as', h.APP_IDS[h.PLATFORM],
                             'head', '-c', '65537', 'files/' + filename],
                            'Read bounded owned TLS failure ' + name, timeout=15, capture=True, error_details=False)
        except Exception:
            result[name] = dict(state='ABSENT_OR_UNREADABLE')
        else:
            try:
                result[name] = failure_receipt(raw, config, h.PLATFORM, progress)
            except Exception:
                result[name] = dict(state='INVALID_OR_UNBOUND')
    def collect(name, action):
        try:
            result[name] = action()
        except Exception:
            result[name] = dict(state='COLLECTION_FAILED')
    def junit():
        report = output / 'junit.xml'
        if not report.exists():
            return dict(state='MISSING')
        if report.is_symlink() or report.stat().st_size > 1024 * 1024:
            raise ValueError('TLS_DIAGNOSTIC_JUNIT_SIZE')
        root = ET.fromstring(report.read_bytes())
        return dict(state='PRESENT', testcase_count=min(100, len(list(root.iter('testcase')))),
                    failure_count=min(100, len(list(root.iter('failure')))),
                    error_count=min(100, len(list(root.iter('error')))),
                    skipped_count=min(100, len(list(root.iter('skipped')))))
    collect('junit', junit)
    collect('maestro_preflight', lambda: h.maestro_preflight_diagnostics(output,
        'Execute actual production native TLS bridge and synthetic RPC matrix', device))
    collect('hierarchy_signals', lambda: h.startup_hierarchy_signals(output))
    def probe_ui():
        # RN LogBox footer IDs and this probe's IDs; no UI text is exported.
        ids = {'r52-tls-running', 'r52-tls-pass', 'r52-tls-failed', 'logbox_dismissable_text',
               'logbox_footer_button_dismiss', 'logbox_footer_button_minimize'}
        observed = set()
        import itertools
        paths = list(itertools.islice(output.glob('**/screen-hierarchy/step-*.json'), 9))
        for path in paths[:8]:
            if path.is_symlink() or not path.resolve().is_relative_to(output.resolve()) or path.stat().st_size > 1024 * 1024:
                raise ValueError('TLS_DIAGNOSTIC_UI_BOUNDARY')
            pending = [json.loads(path.read_text())]; visited = 0
            while pending:
                node = pending.pop(); visited += 1
                if type(node) is not dict or visited + len(pending) > 10000:
                    raise ValueError('TLS_DIAGNOSTIC_UI_NODES')
                attributes = node.get('attributes') or {}
                children = node.get('children') or []
                if type(attributes) is not dict or type(children) is not list or visited + len(pending) + len(children) > 10000:
                    raise ValueError('TLS_DIAGNOSTIC_UI_NODE')
                identifier = attributes.get('resource-id', '')
                if type(identifier) is str and identifier.rsplit(':id/', 1)[-1] in ids:
                    observed.add(identifier.rsplit(':id/', 1)[-1])
                pending.extend(children)
        return dict(observed_ids=sorted(observed), snapshots_read=min(8, len(paths)), truncated=len(paths) > 8)
    collect('probe_ui', probe_ui)
    collect('metro_errors', lambda: h.metro_startup_errors(h.private_log_prefix(output / 'metro.log')[0]))
    def android_errors():
        raw = h.command(['adb', '-s', device, 'logcat', '-d', '-t', '200', '-v', 'brief',
                         '*:S', 'AndroidRuntime:E', 'ReactNativeJS:E', 'ReactNative:E'],
                        'Classify bounded owned TLS Android runtime errors', timeout=15,
                        capture=True, error_details=False)
        return dict(scope='DEVICE_LOG_NOT_PROCESS_ATTRIBUTED', categories=h.android_startup_errors(raw))
    collect('android_errors', android_errors)
    def witnesses():
        fixture.stdin.write('snapshot\n'); fixture.stdin.flush()
        rows = receive(fixture, seconds=5)['tls']
        if type(rows) is not dict or set(rows) != {row['id'] for row in config['cases']}:
            raise ValueError('TLS_DIAGNOSTIC_WITNESSES')
        result = []
        for row in config['cases']:
            counts = rows[row['id']]
            if (type(counts) is not dict or set(counts) != {'connections', 'secure_connections', 'requests', 'invalid_payloads'}
                    or any(type(value) is not int or not 0 <= value <= 4 for value in counts.values())):
                raise ValueError('TLS_DIAGNOSTIC_WITNESS_COUNTERS')
            result.append(dict(id=row['id'], **counts))
        return result
    if fixture is not None:
        collect('server_witnesses', witnesses)
    return result


def run_retained(h):
    # Explicit private diagnostic route; ordinary run(h) keeps its strict gates.
    spec = importlib.util.spec_from_file_location('r52_retained_admission', Path(__file__).with_name('r52_retained_admission.py'))
    retained = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(retained)
    _run(h, retained.admit(h))


def _run(h, retained=None):
    preparation_stage = 'HOSTED_ADMISSION'
    def stage(name):
        nonlocal preparation_stage
        preparation_stage = (name if name in ('SOURCE_IDENTITY', 'TRACKED_SOURCE_STATUS', 'RAW_SOURCE_BYTES',
            'RETAINED_SOURCE_BYTES', 'METRO_PORT', 'GENERATED_FIXTURE_PATH', 'OUTPUT_DIRECTORY',
            'PRIVATE_LOG_FILES') else 'UNKNOWN_PREPARATION_STAGE')
    try:
        _run_with_preparation(h, retained, stage)
    except BaseException as error:
        # Preparation precedes the fixture's try/finally. Preserve its failure
        # without exporting exception text, process output or private paths.
        try:
            current = h.read()
            previous = current.get('r52_tls_native', {})
            if previous.get('scope') != 'ACTUAL_APP_RN_PRODUCTION_TLS_BRIDGE':
                allowed = {'TLS_PRIVATE_HOSTED_EXACT_APP_STARTUP_REQUIRED', 'TLS_EXACT_SOURCE_REQUIRED',
                    'TLS_PACKAGE_OVERLAY_UNRECORDED', 'TLS_PACKAGE_PROTECTED_FIELDS',
                    'TLS_RAW_SOURCE_HEAD', 'TLS_RAW_SOURCE_EMPTY', 'TLS_UNTRACKED_SOURCE',
                    'TLS_RAW_SOURCE_PATH', 'TLS_RAW_SOURCE_OBJECT', 'TLS_RAW_SOURCE_SIZE',
                    'TLS_RAW_SOURCE_BYTES', 'TLS_RAW_SOURCE_GIT', 'TLS_METRO_PORT_OCCUPIED',
                    'TLS_STALE_FIXTURE_EXISTS'}
                category = (error.args[0] if type(error) is RuntimeError and len(error.args) == 1
                            and type(error.args[0]) is str and error.args[0] in allowed
                            else 'UNCLASSIFIED_PREPARATION_FAILURE')
                source = current.get('source_sha')
                current['r52_tls_native'] = dict(status='FAIL', scope='ACTUAL_APP_RN_PRODUCTION_TLS_BRIDGE',
                    phase='PREPARATION', preparation_stage=preparation_stage, preparation_failure=category,
                    source_sha=source if type(source) is str and re.fullmatch('[a-f0-9]{40}', source) else None,
                    platform=h.PLATFORM if h.PLATFORM in ('IOS', 'ANDROID') else None,
                    cases=[], full_r52_acceptance=False)
                h.save(current)
        except BaseException:
            pass  # Receipt collection must never replace the original error.
        raise


def _run_with_preparation(h, retained, stage):
    data = h.read()
    context_spec = importlib.util.spec_from_file_location('native_phase_context', Path(__file__).with_name('native_phase_context.py'))
    context = importlib.util.module_from_spec(context_spec); context_spec.loader.exec_module(context)
    if (not context.hosted_context(h, data)
            or h.PLATFORM not in ['IOS', 'ANDROID'] or (retained is None and data.get('build') != 'PASS')
            or data.get('smoke') != 'PASS' or h.artifact_identity() != data['built_artifact']):
        raise RuntimeError('TLS_PRIVATE_HOSTED_EXACT_APP_STARTUP_REQUIRED')
    stage('SOURCE_IDENTITY')
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=h.ROOT, text=True).strip()
    if source != data['source_sha'] or source != os.environ.get('KEEPER_SOURCE_SHA'):
        raise RuntimeError('TLS_EXACT_SOURCE_REQUIRED')
    if retained is None:
        stage('TRACKED_SOURCE_STATUS')
        h.command(['git', 'diff', '--exit-code', 'HEAD', '--', *[p for p in SOURCE_PATHS if p != 'package.json']],
                  'Verify committed native driver and production source', error_details=False)
        stage('RAW_SOURCE_BYTES')
        verify_source(h.ROOT, source, data.get('nodeify_overlay'))
    else:
        stage('RETAINED_SOURCE_BYTES')
        retained.verify_source()
    stage('METRO_PORT')
    require_free_metro_port()
    stage('GENERATED_FIXTURE_PATH')
    generated = h.ROOT / '.github/native/.generated/r52_tls_fixture.json'
    if generated.exists() or generated.is_symlink():
        raise RuntimeError('TLS_STALE_FIXTURE_EXISTS')
    fixture = metro = device = None
    output = h.PRIVATE / 'r52-tls'
    stage('OUTPUT_DIRECTORY')
    output.mkdir(mode=0o700)
    stage('PRIVATE_LOG_FILES')
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
    def start_and_warm_metro():
        nonlocal metro
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
        before = len(h.read().get('commands', []))
        try:
            h.warm_metro_bundle('r52_tls')
        finally:
            if h.PLATFORM == 'IOS':
                capture_warm_order(before)

    def capture_warm_order(before):
        try:
            state = h.read(); rows = state['commands']; row = rows[-1]; details = state['r52_tls_bundle']
            if (len(rows) != before + 1 or row.get('label') != 'Warm IOS development bundle (setup only)'
                    or row.get('timeout_seconds') != 250 or type(row.get('exit_code')) is not int
                    or details.get('request_profile') not in ('PLATFORM_DEV_MINIFY', 'OBSERVED_RN_IOS_APP_REQUEST_OPTIONS_FF3CC6')
                    or details.get('timeout_seconds') != 240 or details.get('result') not in ('PASS', 'FAIL')
                    or type(details.get('duration_seconds')) not in (int, float)
                    or not 0 <= details['duration_seconds'] <= 280):
                raise ValueError('IOS_WARM_ORDER_UNAVAILABLE')
            result['ios_warm_before_device'] = dict(state='PRESENT',
                scope='IOS_METRO_WARM_BEFORE_OWNED_DEVICE_SETUP_ONLY', warm_command_index=len(rows),
                device_create_command_index=None, request_profile=details['request_profile'],
                request_profile_scope='REPORTED_PROFILE_ONLY_NOT_URL_VALIDATION',
                duration_seconds=details['duration_seconds'], timeout_seconds=240,
                result=details['result'], native_acceptance=False)
        except BaseException:
            result['ios_warm_before_device'] = dict(state='UNAVAILABLE', native_acceptance=False)

    def record_device_create_order():
        try:
            row = result['ios_warm_before_device']; commands = h.read()['commands']
            if (row['state'] != 'PRESENT' or commands[-1].get('label') != 'Create owned TLS simulator'
                    or row['warm_command_index'] >= len(commands)):
                raise ValueError('IOS_WARM_ORDER_UNAVAILABLE')
            row['device_create_command_index'] = len(commands)
        except BaseException:
            result['ios_warm_before_device'] = dict(state='UNAVAILABLE', native_acceptance=False)

    execution_stage = 'SETUP'
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
            start_and_warm_metro()
            candidate = h.command(['xcrun', 'simctl', 'create', 'Keeper-r52-tls-disposable',
                                'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
                                'com.apple.CoreSimulator.SimRuntime.iOS-18-5'], 'Create owned TLS simulator', capture=True)
            record_device_create_order()
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
        if h.PLATFORM == 'ANDROID':
            start_and_warm_metro()
        report = output / 'junit.xml'
        execution_stage = 'MAESTRO'
        h.command([data['maestro']['binary'], '--device', device, 'test', '--env', 'APP_ID=' + h.APP_IDS[h.PLATFORM],
                   '--flatten-debug-output', '--debug-output', str(output), '--test-output-dir', str(output),
                   '--format', 'junit', '--output', str(report), '.github/native/r52_tls_probe.yaml'],
                  'Execute actual production native TLS bridge and synthetic RPC matrix', timeout=480, error_details=False)
        execution_stage = 'JUNIT'
        h.successful_junit(report)
        execution_stage = 'APP_RECEIPT'
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
        execution_stage = 'SERVER_WITNESSES'
        fixture.stdin.write('snapshot\n'); fixture.stdin.flush()
        witness = receive(fixture)
        execution_stage = 'VALIDATION'
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
    except BaseException as exc:
        error = exc
        result['failure_stage'] = execution_stage
        if isinstance(exc, Exception) and h.PLATFORM == 'ANDROID' and device and 'config' in locals():
            try:
                result['failure_observation'] = collect_android_failure(h, device, config, output, fixture)
                result['failure_observation']['fixture_sha256'] = ready['config_sha256']
            except Exception:
                result['failure_observation'] = dict(state='COLLECTION_FAILED', native_acceptance=False)
        raise
    finally:
        cleanup = []
        def attempt(label, action):
            try:
                action()
            except BaseException:
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
        attempt('fixture_log', fixture_log.close)
        attempt('metro_log', metro_log.close)
        if error is not None or cleanup:
            result['status'] = 'FAIL'
        result['cleanup'] = 'FAIL' if cleanup else 'PASS'
        result['cleanup_failures'] = cleanup
        try:
            current = h.read(); current['r52_tls_native'] = result; h.save(current)
        except BaseException:
            if error is None:
                raise
        if cleanup and error is None:
            raise RuntimeError('TLS_CLEANUP_FAILED')
