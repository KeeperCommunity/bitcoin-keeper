#!/usr/bin/env python3
"""Disposable hosted smoke harness; only allowlisted metadata leaves the runner.

Native and Maestro output stays under RUNNER_TEMP, never in an uploaded glob.
The gate trusts protected workflow/job provenance, never this writable artifact.
"""

import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[2]
PLATFORM = os.environ.get('KEEPER_NATIVE_PLATFORM', '')
PRIVATE = Path(os.environ.get('RUNNER_TEMP', tempfile.gettempdir())) / 'keeper-native-private'
EVIDENCE = ROOT / 'artifacts' / 'native' / PLATFORM.lower() / 'metadata.json'
MAESTRO_VERSION = 'cli-2.11.0'
MAESTRO_SHA256 = '5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a'
APP_IDS = {'IOS': 'io.hexawallet.hexakeeper.dev', 'ANDROID': 'io.hexawallet.keeper.development'}


def save(data):
    EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE.write_text(json.dumps(data, indent=2) + '\n')


def read():
    return json.loads(EVIDENCE.read_text())


def failure_details(log):
    """Bounded tool errors from this fresh CI fixture, never raw process logs."""
    selected = []
    for line in log.splitlines():
        line = re.split(r'\b(?:UI\s+hierarchy|View\s+hierarchy|credentials?)\s*[:=]',
                        line, maxsplit=1, flags=re.IGNORECASE)[0].rstrip()
        if re.match(r'^\s*\d+\s*\|', line):
            continue
        if not re.search(r'(?:\berror:|^error |^e: |^\[!\]|^FAILURE:|^> (?!Task\b)|^Caused by:|^Could not |'
                         r'^A problem occurred|^Execution failed|^The sandbox is not in sync)', line):
            continue
        line = re.sub(r'https?://\S+', '[URL]', line)
        line = re.sub(r'(?i)\b(password|token|secret|api[_-]?key|authorization)\s*[:=]\s*\S+',
                      r'\1=[REDACTED]', line)
        line = re.sub(r'(?i)\bBearer\s+\S+', 'Bearer [REDACTED]', line)
        line = re.sub(r'\b[a-fA-F0-9]{24,}\b', '[HEX]', line)
        line = re.sub(r'/Users/[^/\s]+', '/Users/[runner]', line)
        selected.append(line[:500])
        if len(selected) == 20:
            break
    return selected


def maestro_failure_details(log):
    """Retain only this flow's fixed commands and bounded tool failure messages."""
    selected = []
    for raw in log.splitlines():
        line = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', raw).strip()
        if line.endswith('FAILED'):
            if line.startswith(('Launch app', 'Clear state', 'Stop app')) and any(app in line for app in APP_IDS.values()):
                selected.append('Maestro app launch/stop command FAILED')
            elif line.startswith(('Assert', 'Wait')) and 'Create a passcode' in line:
                selected.append('Maestro assertion: Create a passcode visible FAILED')
            elif line.startswith(('Assert', 'Wait')) and 'Confirm your passcode' in line:
                selected.append('Maestro assertion: Confirm your passcode state FAILED')
            elif line.startswith('Tap on'):
                match = re.search(r'\bkey_[1-4]\b', line)
                if match:
                    selected.append('Maestro tap %s FAILED' % match.group())
        elif line.startswith(('Assertion is false:', 'Element not found:')):
            # Emit only a category and fixed selector; even a first-line suffix
            # can contain a hierarchy or arbitrary device text.
            category = 'assertion failed' if line.startswith('Assertion is false:') else 'element not found'
            for target in ['Create a passcode', 'Confirm your passcode', 'key_1', 'key_2', 'key_3', 'key_4']:
                if target in line:
                    selected.append('Maestro %s: %s' % (category, target))
                    break
        elif line.startswith(('Unable to launch app', 'Failed to launch app', 'Unable to connect',
                              'Failed to connect', 'Failed to start', 'No devices found',
                              'No connected devices', 'Unable to find device')):
            selected.extend(failure_details('error: Maestro ' + line))
        if len(selected) >= 10:
            break
    return list(dict.fromkeys(selected))[:10]


def android_startup_errors(log):
    selected = []
    for line in log.splitlines():
        match = re.match(r'^[EF]/(AndroidRuntime|ReactNativeJS|ReactNative)\s*\(\s*\d+\):\s*(.*)', line)
        if not match:
            continue
        tag, message = match.groups()
        if re.search(r'(?:FATAL EXCEPTION|Caused by:|\b[\w.$]*(?:Exception|Error)\b|'
                     r'Invariant Violation|Unable to load script|Could not)', message):
            selected.append('error: %s %s' % (tag, message))
    return failure_details('\n'.join(selected))


def metro_startup_errors(log):
    selected = []
    for raw in log.splitlines():
        line = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', raw).strip()
        if re.match(r'^(?:error\b|(?:Syntax|Type|Reference)Error:|Unable to resolve module)', line, re.IGNORECASE):
            selected.append('error: Metro ' + line)
    return failure_details('\n'.join(selected))


def metro_startup_progress(log):
    # Metro's TerminalReporter uses the same bare BUNDLE line for done and
    # failed builds. Count observed markers without inferring completion.
    lines = [re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', line).strip() for line in log.splitlines()]
    bundles = sum(bool(re.match(r'^BUNDLE\s', line)) for line in lines)
    prebundles = sum(bool(re.match(r'^PREBUNDLE\s', line)) for line in lines)
    return {'bundle_marker_observed': bundles > 0, 'bundle_marker_count': bundles,
            'prebundle_marker_count': prebundles}


def private_log_prefix(path):
    """Read launch-time output, discarding a partially truncated final record."""
    limit = 1024 * 1024
    with path.open('rb') as source:
        payload = source.read(limit + 1)
    truncated = len(payload) > limit
    payload = payload[:limit]
    if truncated:
        payload = payload.rsplit(b'\n', 1)[0] + b'\n' if b'\n' in payload else b''
    return payload.decode(errors='replace'), truncated


def ios_startup_diagnostics(payload, executable):
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*', executable):
        raise ValueError('Unsafe iOS executable selector.')
    # log(1) compact: ISO timestamp, abbreviated type, process[PID:TID], message.
    # Only prefixed own-process records qualify; never retain continuation lines.
    pattern = re.compile(r'^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?'
                         r'(?:[+-]\d{2}:?\d{2}|Z)?\s+(\S+)\s+'
                         r'([A-Za-z0-9_.-]+)\[\d+:[A-Fa-f0-9x]+\]\s+(.*)$')
    selected = []
    matched = 0
    for line in payload.splitlines():
        match = pattern.match(line)
        if not match:
            continue
        severity, process, message = match.groups()
        if process != executable:
            continue
        matched += 1
        if severity.lower() in ['e', 'f', 'er', 'ft', 'error', 'fault'] or re.search(
                r'(?:\b(?:error|exception|fatal)\b|\b[\w.$]*(?:Exception|Error)\b)',
                message, re.IGNORECASE):
            selected.append('error: iOS ' + message)
    return {'format': 'compact', 'matching_process_records': matched,
            'errors': failure_details('\n'.join(selected))}


def startup_hierarchy_signals(directory):
    """Classify fixed public startup selectors; never export hierarchy content."""
    # Maestro cli-2.11.0 writes standalone TreeNode snapshots in this layout.
    flags = ['createPIN', 'confirmPIN', 'RNredbox', 'noScriptURL',
             'developmentServerError', 'unableLoadScript']
    result = {flag: False for flag in flags}
    result.update({'snapshot_count': 0, 'parse_error_types': []})
    redbox_ids = {'redbox-error', 'redbox-dismiss', 'redbox-reload', 'rn_redbox_stack',
                  'rn_redbox_dismiss_button', 'rn_redbox_reload_button', 'catalyst_redbox_title'}
    fixed_messages = {'noScriptURL': 'No script URL provided.',
                      'developmentServerError': 'Could not connect to development server.',
                      'unableLoadScript': 'Unable to load script.'}
    for index, path in enumerate(directory.glob('**/screen-hierarchy/step-*.json')):
        try:
            if index >= 8:
                raise ValueError('Hierarchy snapshot count exceeded limit.')
            result['snapshot_count'] += 1
            if path.is_symlink() or not path.resolve().is_relative_to(directory.resolve()):
                raise ValueError('Hierarchy snapshot must remain in private output.')
            with path.open('rb') as source:
                payload = source.read(1024 * 1024 + 1)
            if len(payload) > 1024 * 1024:
                raise ValueError('Hierarchy snapshot exceeded byte limit.')
            pending = [json.loads(payload)]
            snapshot = {flag: False for flag in flags}
            nodes = 0
            while pending:
                node = pending.pop()
                nodes += 1
                if nodes > 10000:
                    raise ValueError('Hierarchy snapshot exceeded node limit.')
                if not isinstance(node, dict):
                    raise TypeError('Unexpected hierarchy node format.')
                attributes = node.get('attributes') or {}
                children = node.get('children') or []
                if not isinstance(attributes, dict) or not isinstance(children, list):
                    raise TypeError('Unexpected hierarchy attributes or children format.')
                # iOS StaticText often exposes only accessibilityText. Android
                # resource IDs include the package prefix before :id/.
                identifier = attributes.get('resource-id', '')
                if isinstance(identifier, str) and identifier.rsplit(':id/', 1)[-1] in redbox_ids:
                    snapshot['RNredbox'] = True
                for key in ['accessibilityText', 'text', 'title', 'value']:
                    value = attributes.get(key)
                    if not isinstance(value, str):
                        continue
                    snapshot['createPIN'] |= value.strip() == 'Create a passcode'
                    snapshot['confirmPIN'] |= value.strip() == 'Confirm your passcode'
                    for flag, message in fixed_messages.items():
                        snapshot[flag] |= message in value
                if len(pending) + len(children) + nodes > 10000:
                    raise ValueError('Hierarchy snapshot exceeded node limit.')
                pending.extend(children)
            for flag in flags:
                result[flag] |= snapshot[flag]
        except Exception as error:
            kind = type(error).__name__
            if kind not in result['parse_error_types']:
                result['parse_error_types'].append(kind)
        if index >= 8:
            break
    return result


def maestro_preflight_diagnostics(directory=None, command_label='Assert startup and disposable passcode transition'):
    """Export fixed cli-2.11.0 driver markers, never subprocess error text."""
    markers = {
        'runner_install_started': '[Start] Install XCUITest runner on',
        'runner_install_launch_returned': '[Done] Install XCUITest runner on',
        'status_check_started': '[Start] Perform XCUITest driver status check on',
        'status_response_received': '[Done] Perform XCUITest driver status check on',
        'status_check_failed': '[Failed] Perform XCUITest driver status check on',
        'driver_startup_timeout': 'iOS driver not ready in time, consider increasing timeout by configuring MAESTRO_DRIVER_STARTUP_TIMEOUT env variable',
        'prebuilt_driver_selected': 'Installing pre built driver without xcodebuild',
        'xcodebuild_driver_selected': 'Installing driver with xcodebuild',
        'xctestrun_config_missing': 'xctestrun config does not exist',
        'ui_test_runner_missing': 'ui test runner does not exist',
        'xcode_test_execute_failed': '** TEST EXECUTE FAILED **',
        'xcode_test_failed': '** TEST FAILED **',
        'xcode_testing_failed': 'Testing failed:',
    }
    # The install/status "Done" markers precede readiness evaluation; they do
    # not prove that the runner installed successfully or became ready.
    result = {name: False for name in markers}
    result.update({'host_port_unavailable': False, 'requested_device_disconnected': False,
                   'exception_types': [], 'logs_read': 0, 'truncated_logs': 0,
                   'log_limit_reached': False, 'collection_error_types': []})
    known_types = ['IOSDriverTimeoutException', 'FileNotFoundException', 'CliError',
                   'IllegalStateException', 'IOException', 'ConnectException',
                   'SocketTimeoutException', 'TimeoutException', 'RuntimeException',
                   'UnknownHostException', 'SSLHandshakeException']
    paths = []
    for index, entry in enumerate(read()['commands'], 1):
        if entry['label'] == command_label:
            paths.append(PRIVATE / ('command-%03d.log' % index))
    directory = directory if directory is not None else PRIVATE / 'maestro-output'
    if not directory.resolve().is_relative_to(PRIVATE.resolve()):
        raise ValueError('Maestro diagnostic directory must remain private.')
    for pattern in ['**/maestro.log', '**/xctest_runner_*.log']:
        for path in directory.glob(pattern):
            paths.append(path)
            if len(paths) > 6:
                break
        if len(paths) > 6:
            break
    for path in paths[:6]:
        try:
            if path.is_symlink() or not path.resolve().is_relative_to(PRIVATE.resolve()):
                raise ValueError('Maestro log must remain in private output.')
            payload, truncated = private_log_prefix(path)
            result['logs_read'] += 1
            result['truncated_logs'] += int(truncated)
            for name, marker in markers.items():
                result[name] |= marker in payload
            for line in payload.splitlines():
                result['host_port_unavailable'] |= ('Requested driver host port ' in line
                                                   and ' is not available' in line)
                result['requested_device_disconnected'] |= (' was requested, but it is not connected.' in line)
            for kind in known_types:
                if re.search(r'(?<![\w])%s(?![\w])' % kind, payload) and kind not in result['exception_types']:
                    result['exception_types'].append(kind)
        except Exception as error:
            kind = type(error).__name__
            if kind not in result['collection_error_types']:
                result['collection_error_types'].append(kind)
    result['log_limit_reached'] = len(paths) > 6
    return result


def record_startup_failure(report, device):
    """Collect bounded diagnostics before destroying this job's fresh app state."""
    details = {'scope': 'Fresh startup only; no account or persisted PIN created.',
               'collection_errors': []}

    def collect(name, action):
        try:
            details[name] = action()
        except Exception as error:
            details['collection_errors'].append({'stage': name, 'error_type': type(error).__name__})

    def private_text(path):
        # No raw logs/reports are copied to the artifact directory.
        with path.open('rb') as source:
            source.seek(0, os.SEEK_END)
            source.seek(max(0, source.tell() - 1024 * 1024))
            return source.read().decode(errors='replace')

    def maestro_details():
        result = {'failed_commands': [], 'testcase_failures': [], 'report': 'MISSING'}
        for index, entry in enumerate(read()['commands'], 1):
            if entry['label'] == 'Assert startup and disposable passcode transition':
                result['failed_commands'] = maestro_failure_details(private_text(PRIVATE / ('command-%03d.log' % index)))
        if report.exists():
            if report.stat().st_size > 1024 * 1024:
                raise RuntimeError('Maestro report exceeded diagnostic size limit.')
            suite = ET.parse(report).getroot()
            result['report'] = 'PRESENT'
            result['testcase_statuses'] = [case.get('status') if case.get('status') in
                                            ['SUCCESS', 'ERROR', 'WARNING', 'SKIPPED'] else 'UNKNOWN'
                                           for case in list(suite.iter('testcase'))[:10]]
            for failure in list(suite.iter('failure'))[:10]:
                # Pinned Maestro JUnit stores failure.message separately from UI hierarchy.
                first_line = ''.join(failure.itertext()).splitlines()[:1]
                result['testcase_failures'].extend(maestro_failure_details('\n'.join(first_line)))
        return result

    collect('maestro', maestro_details)
    collect('maestro_preflight', maestro_preflight_diagnostics)
    collect('hierarchy_signals', lambda: startup_hierarchy_signals(PRIVATE / 'maestro-output'))
    collect('metro_errors', lambda: metro_startup_errors(private_text(PRIVATE / 'metro.log')))
    collect('metro_progress', lambda: metro_startup_progress(private_log_prefix(PRIVATE / 'metro.log')[0]))
    if PLATFORM == 'ANDROID' and device:
        def android_details():
            args = ['adb', '-s', device, 'logcat', '-d', '-t', '300', '-v', 'brief',
                    'AndroidRuntime:E', 'ReactNativeJS:E', 'ReactNative:E', '*:S']
            path = PRIVATE / 'android-startup-errors.log'
            with path.open('wb') as output:
                try:
                    result = subprocess.run(args, stdout=output, stderr=subprocess.STDOUT,
                                            timeout=20, check=False)
                    code = result.returncode
                except subprocess.TimeoutExpired:
                    code = 124
            return {'command': args, 'exit_code': code,
                    'errors': android_startup_errors(private_text(path)) if code == 0 else []}
        collect('android_errors', android_details)
    elif PLATFORM == 'IOS' and device:
        def ios_details():
            executable = read()['built_artifact']['executable']
            if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*', executable):
                raise ValueError('Unsafe iOS executable selector.')
            predicate = ('process == "%s" AND (messageType == "error" OR messageType == "fault" '
                         'OR eventMessage CONTAINS[c] "error" OR eventMessage CONTAINS[c] "exception" '
                         'OR eventMessage CONTAINS[c] "fatal")') % executable
            args = ['xcrun', 'simctl', 'spawn', device, 'log', 'show', '--style', 'compact',
                    '--last', '10m', '--predicate', predicate]
            path = PRIVATE / 'ios-startup-errors.log'
            # Keep log/xcrun notices private and separate from compact records.
            with path.open('wb') as output, (PRIVATE / 'ios-startup-errors-stderr.log').open('wb') as stderr:
                try:
                    result = subprocess.run(args, stdout=output, stderr=stderr,
                                            timeout=25, check=False)
                    code = result.returncode
                except subprocess.TimeoutExpired:
                    code = 124
            result = {'command': args, 'exit_code': code, 'errors': []}
            if code == 0:
                try:
                    payload, truncated = private_log_prefix(path)
                    result.update(ios_startup_diagnostics(payload, executable))
                    result['input_truncated'] = truncated
                except (ValueError, TypeError) as error:
                    result['parse_error'] = type(error).__name__
            return result
        collect('ios_errors', ios_details)
    data = read()
    data['startup_diagnostics'] = details
    save(data)
    print('Bounded startup diagnostics: ' + json.dumps(details), flush=True)


def command(args, label, timeout=120, cwd=ROOT, capture=False, error_details=True):
    """Record exact nonsecret argv and status; keep all process output private."""
    PRIVATE.mkdir(parents=True, exist_ok=True)
    data = read()
    entry = {'label': label, 'command': args, 'timeout_seconds': timeout}
    data['commands'].append(entry)
    save(data)
    started = time.monotonic()
    output_file = PRIVATE / ('command-%03d.log' % len(data['commands']))
    print(label, flush=True)
    try:
        with output_file.open('wb') as output:
            proc = subprocess.Popen(args, cwd=cwd, stdout=output, stderr=subprocess.STDOUT,
                                    start_new_session=True)
            try:
                code = proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
                code = 124
    except OSError:
        code = 127
    entry['exit_code'] = code
    entry['duration_seconds'] = round(time.monotonic() - started, 1)
    if code:
        # Fixed diagnostics expose install blockers without publishing arbitrary logs.
        log = output_file.read_text(errors='replace') if output_file.exists() else ''
        known = {
            'lockfile needs to be updated': 'Manifest and yarn.lock are inconsistent; repair the lockfile separately.',
            'could not find compatible versions': 'The native dependency lock is incompatible with the manifest.',
            'no space left on device': 'The hosted runner ran out of disk space.',
            'command not found': 'A required native tool is unavailable.',
            'requires a higher minimum deployment target': 'A pod requires a higher iOS deployment target.',
        }
        entry['diagnostic'] = next((message for needle, message in known.items()
                                    if needle in log.lower()), 'Inspect this command locally; private raw output was not retained.')
        entry['redacted_tool_errors'] = failure_details(log) if error_details else []
        for line in entry['redacted_tool_errors']:
            print(line, flush=True)
        save(data)
        raise RuntimeError('%s failed (exit %s). %s' % (label, code, entry['diagnostic']))
    save(data)
    return output_file.read_text(errors='replace').strip() if capture else None


def record():
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if source != os.environ.get('KEEPER_SOURCE_SHA'):
        raise RuntimeError('Checkout does not match the exact requested PR head.')
    save({
        'schema': 1, 'platform': PLATFORM, 'source_sha': source,
        'workflow_ref': os.environ.get('GITHUB_WORKFLOW_REF'),
        'workflow_sha': os.environ.get('GITHUB_WORKFLOW_SHA'),
        'run_id': os.environ.get('GITHUB_RUN_ID'), 'run_attempt': os.environ.get('GITHUB_RUN_ATTEMPT'),
        'runner': {key: os.environ.get(key) for key in
                   ['RUNNER_OS', 'RUNNER_ARCH', 'ImageOS', 'ImageVersion']},
        'os': platform.platform(), 'commands': [], 'build': 'NOT RUN', 'smoke': 'NOT RUN',
        'hardware': 'NOT RUN', 'signing': 'NOT RUN', 'app_id': APP_IDS[PLATFORM],
        'smoke_scope': 'Fresh install; render Create a passcode; type four disposable digits; assert Confirm your passcode; stop before persisting credentials.',
        'startup_timing_scope': 'Bounded cold development bundle/startup allowance; no release performance acceptance.',
        'artifact_policy': 'Metadata only. No raw logs, screenshots, app binaries, simulator data or credentials.',
    })
    versions = {
        'node': command(['node', '--version'], 'Record Node version', capture=True),
        'java': command(['java', '-version'], 'Record Java version', capture=True),
    }
    if PLATFORM == 'IOS':
        versions['xcode'] = command(['xcodebuild', '-version'], 'Record Xcode version', capture=True)
        versions['sdk'] = command(['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-version'],
                                  'Record iOS Simulator SDK', capture=True)
    else:
        versions['expected_sdk_build'] = 'compileSdk=36; buildTools=35.0.0; NDK=27.1.12297006'
        versions['expected_emulator_target'] = 'Android API 35; google_apis; x86_64; pixel_6'
    data = read()
    data['toolchain'] = versions
    save(data)


def fixtures():
    # Empty values would fall back to real development services in config.ts.
    overlays = ['.env.ci', 'firebase.json']
    (ROOT / '.env.ci').write_text('''ENVIRONMENT=DEVELOPMENT
RELAY=https://127.0.0.1:9/
SIGNING_SERVER_TESTNET=https://127.0.0.1:9/
SIGNING_SERVER_MAINNET=https://127.0.0.1:9/
CHANNEL_URL=https://127.0.0.1:9/
SENTRY_DNS=https://public@127.0.0.1:9/1
ENC_KEY_STORAGE_IDENTIFIER=KEEPER-HOSTED-DISPOSABLE
''')
    (ROOT / 'firebase.json').write_text(json.dumps({'react-native': {
        'app_data_collection_default_enabled': False,
        'analytics_auto_collection_enabled': False,
        'analytics_collection_deactivated': True,
        'messaging_auto_init_enabled': False,
    }}) + '\n')
    if PLATFORM == 'IOS':
        import plistlib
        for path, bundle in [('ios/GoogleService-Info.plist', 'io.hexawallet.keeper'),
                             ('ios/GoogleServices/dev/GoogleService-Info.plist', APP_IDS['IOS'])]:
            overlays.append(path)
            with (ROOT / path).open('wb') as output:
                plistlib.dump({'API_KEY': 'AIzaSy' + '0' * 33, 'GCM_SENDER_ID': '123456789012',
                               'PLIST_VERSION': '1', 'BUNDLE_ID': bundle,
                               'PROJECT_ID': 'keeper-disposable-ci',
                               'GOOGLE_APP_ID': '1:123456789012:ios:0000000000000000000000',
                               'IS_GCM_ENABLED': False, 'IS_ANALYTICS_ENABLED': False,
                               'IS_ADS_ENABLED': False, 'IS_SIGNIN_ENABLED': False}, output)
    else:
        overlays.append('android/app/google-services.json')
        (ROOT / 'android/app/google-services.json').write_text(json.dumps({
            'project_info': {'project_number': '123456789012', 'project_id': 'keeper-disposable-ci'},
            'client': [{'client_info': {'mobilesdk_app_id': '1:123456789012:android:0000000000000000',
                                       'android_client_info': {'package_name': APP_IDS['ANDROID']}},
                        'api_key': [{'current_key': 'AIzaSy' + '0' * 33}]}],
            'configuration_version': '1',
        }) + '\n')
    data = read()
    data['configuration'] = 'Synthetic Firebase project; DEVELOPMENT/testnet; loopback-only configured services; no production secrets.'
    data['configuration_overlays'] = [{'path': path, 'sha256': hashlib.sha256((ROOT / path).read_bytes()).hexdigest()}
                                      for path in overlays]
    save(data)


def install_maestro():
    archive = PRIVATE / 'maestro.zip'
    url = 'https://github.com/mobile-dev-inc/Maestro/releases/download/%s/maestro.zip' % MAESTRO_VERSION
    command(['curl', '--fail', '--location', '--silent', '--show-error', '--max-time', '120',
             '--output', str(archive), url], 'Download pinned Maestro', timeout=130)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != MAESTRO_SHA256:
        raise RuntimeError('Maestro archive checksum mismatch.')
    # unzip preserves executable modes for the bundled native iOS driver;
    # Python ZipFile extraction would silently strip those modes.
    command(['unzip', '-q', str(archive), '-d', str(PRIVATE / 'maestro')],
            'Extract verified Maestro including native executable modes', timeout=120)
    candidates = list((PRIVATE / 'maestro').rglob('bin/maestro'))
    if len(candidates) != 1:
        raise RuntimeError('Unexpected Maestro archive layout.')
    data = read()
    data['maestro'] = {'version': MAESTRO_VERSION, 'sha256': MAESTRO_SHA256, 'binary': str(candidates[0])}
    save(data)


def android_sdk_metadata(sdk, component):
    properties = (sdk / component / 'source.properties').read_text()
    values = dict((key.strip(), value.strip()) for line in properties.splitlines()
                  if '=' in line for key, value in [line.split('=', 1)])
    if not values.get('Pkg.Revision'):
        raise RuntimeError('Android SDK component %s has no Pkg.Revision metadata.' % component)
    return {key: value for key, value in values.items()
            if key in ['Pkg.Revision', 'AndroidVersion.ApiLevel']}


def prepare():
    command(['npm', 'install', '--global', 'yarn@1.22.22', '--ignore-scripts'], 'Install pinned Yarn', timeout=180)
    command(['yarn', 'install', '--frozen-lockfile', '--ignore-scripts', '--non-interactive'],
            'Install immutable JavaScript dependencies', timeout=900)
    command(['node_modules/.bin/patch-package', '--error-on-fail'], 'Apply repository dependency patches', timeout=180)
    original_manifest = (ROOT / 'package.json').read_bytes()
    command(['node', '.github/native/nodeify.cjs'],
            'Apply committed Node compatibility whitelist without installing dependencies', timeout=180)
    installed_manifest = (ROOT / 'package.json').read_bytes()
    original = json.loads(original_manifest)
    installed = json.loads(installed_manifest)
    for key in ['browser', 'react-native', 'browserify']:
        original.pop(key, None)
        installed.pop(key, None)
    if original != installed:
        raise RuntimeError('Node compatibility setup changed fields beyond module mappings.')
    data = read()
    data['nodeify_overlay'] = {
        'path': 'package.json', 'before_sha256': hashlib.sha256(original_manifest).hexdigest(),
        'after_sha256': hashlib.sha256(installed_manifest).hexdigest(),
        'diff_sha256': hashlib.sha256(subprocess.check_output(['git', 'diff', 'HEAD', '--', 'package.json'], cwd=ROOT)).hexdigest(),
        'allowed_fields': ['browser', 'react-native', 'browserify'],
    }
    save(data)
    command(['git', 'diff', '--exit-code', 'HEAD', '--', 'yarn.lock', 'ios/Podfile.lock'],
            'Verify dependency locks remain immutable')
    fixtures()
    install_maestro()
    if PLATFORM == 'IOS':
        command(['gem', 'install', 'cocoapods', '--version', '1.16.2', '--no-document'],
                'Install pinned CocoaPods', timeout=300)
        if os.environ.get('KEEPER_POD_LOCK_REPAIR') == '1':
            # Diagnostic bootstrap only. A candidate lock is reviewed/committed,
            # then a separate strict deployment run must build and test the app.
            command(['pod', 'update', 'NitroIap', 'NitroModules', 'openiap', '--no-repo-update'],
                    'Generate targeted CocoaPods lock candidate (not validation)',
                    timeout=900, cwd=ROOT / 'ios')
            shutil.copyfile(ROOT / 'ios/Podfile.lock', EVIDENCE.parent / 'Podfile.lock.candidate')
            raise RuntimeError('Pod lock candidate generated for review; no native validation performed.')
        command(['pod', 'install', '--deployment'], 'Install immutable CocoaPods dependencies',
                timeout=900, cwd=ROOT / 'ios')
        # Existing PBX build phases hardcode this path. Adapt the disposable host,
        # preserving the app project and the source commit being tested.
        command(['sudo', 'mkdir', '-p', '/opt/homebrew/bin'], 'Prepare existing Xcode Node path')
        command(['sudo', 'ln', '-sf', shutil.which('node'), '/opt/homebrew/bin/node'],
                'Connect existing Xcode Node path to pinned Node')
    else:
        command(['sdkmanager', 'platforms;android-36', 'build-tools;35.0.0', 'ndk;27.1.12297006'],
                'Install pinned Android build SDK and NDK', timeout=600)
        sdk = Path(os.environ.get('ANDROID_HOME', os.environ.get('ANDROID_SDK_ROOT', '')))
        observed = {}
        for component in ['platforms/android-36', 'build-tools/35.0.0', 'ndk/27.1.12297006']:
            observed[component] = android_sdk_metadata(sdk, component)
        data = read()
        data['toolchain']['observed_android_sdk'] = observed
        save(data)
    if (ROOT / 'package.json').read_bytes() != installed_manifest:
        raise RuntimeError('Native installation unexpectedly rewrote the installed manifest.')
    command(['git', 'diff', '--exit-code', 'HEAD', '--', 'yarn.lock', 'ios/Podfile.lock'],
            'Verify native installation did not rewrite locks')


def artifact_identity():
    if PLATFORM == 'IOS':
        import plistlib
        bundle = PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
        with (bundle / 'Info.plist').open('rb') as source:
            executable = plistlib.load(source)['CFBundleExecutable']
        binary = bundle / executable
        tree = hashlib.sha256()
        for file in sorted(path for path in bundle.rglob('*') if path.is_file()):
            tree.update(str(file.relative_to(bundle)).encode() + b'\0')
            tree.update(hashlib.sha256(file.read_bytes()).digest())
        return {'path': str(bundle), 'executable': executable,
                'executable_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
                'bundle_tree_sha256': tree.hexdigest()}
    apk = ROOT / 'android/app/build/outputs/apk/development/debug/app-development-debug.apk'
    return {'path': str(apk.relative_to(ROOT)), 'sha256': hashlib.sha256(apk.read_bytes()).hexdigest()}


def driver():
    """Fail early on iOS driver setup without installing or crediting the app."""
    if PLATFORM != 'IOS':
        raise ValueError('The disposable driver preflight is iOS-only.')
    state = PRIVATE / 'maestro-preflight-state'
    os.environ['XDG_STATE_HOME'] = str(state)
    details = {'scope': 'DRIVER PREFLIGHT/setup only; no app build, install or UI credit.',
               'result': 'FAIL', 'cleanup_errors': []}
    device = None
    original_error = None
    label = 'Check disposable iOS driver readiness'
    try:
        created = command(['xcrun', 'simctl', 'create', 'Keeper-driver-preflight-ci',
                           'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
                           'com.apple.CoreSimulator.SimRuntime.iOS-18-5'],
                          'Create owned driver-preflight simulator', timeout=120, capture=True)
        if not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', created):
            raise ValueError('simctl create did not return an owned simulator UUID.')
        device = created
        command(['xcrun', 'simctl', 'boot', device], 'Boot owned driver-preflight simulator', timeout=120)
        command(['xcrun', 'simctl', 'bootstatus', device, '-b'],
                'Wait for driver-preflight simulator boot', timeout=240)
        command([read()['maestro']['binary'], '--platform', 'ios', '--device', device, 'hierarchy'],
                label, timeout=300, error_details=False)
        details['result'] = 'PASS'
    except Exception as error:
        original_error = error
        details['error_type'] = type(error).__name__
        raise
    finally:
        if device:
            for action in ['shutdown', 'delete']:
                try:
                    subprocess.run(['xcrun', 'simctl', action, device], stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, timeout=30, check=True)
                except Exception as error:
                    details['cleanup_errors'].append({'action': action, 'error_type': type(error).__name__})
        try:
            details['diagnostics'] = maestro_preflight_diagnostics(state / 'maestro/tests', label)
        except Exception as error:
            details['diagnostics'] = {'collection_error_types': [type(error).__name__]}
        if details['cleanup_errors']:
            details['result'] = 'FAIL'
        data = read()
        data['driver_preflight'] = details
        save(data)
        if details['cleanup_errors'] and original_error is None:
            raise RuntimeError('Owned driver-preflight simulator cleanup failed.')


def build():
    if PLATFORM == 'IOS':
        architecture = platform.machine()
        if architecture not in ['arm64', 'x86_64']:
            raise RuntimeError('Unsupported hosted iOS simulator architecture: %s' % architecture)
        data = read()
        data.setdefault('toolchain', {})['ios_simulator_architecture'] = architecture
        save(data)
        command(['xcodebuild', '-workspace', 'ios/hexa_keeper.xcworkspace', '-scheme', 'hexa_keeper_dev',
                 '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator',
                 '-derivedDataPath', str(PRIVATE / 'DerivedData'), 'CODE_SIGNING_ALLOWED=NO',
                 'CODE_SIGNING_REQUIRED=NO', 'ARCHS=' + architecture, 'ONLY_ACTIVE_ARCH=YES', 'build'],
                'Build unsigned development simulator app', timeout=2400)
    else:
        observed = command(['./gradlew', '--version'], 'Record actual Gradle and JVM version',
                           capture=True, cwd=ROOT / 'android')
        data = read()
        data['toolchain']['gradle'] = observed
        save(data)
        command(['./gradlew', ':app:assembleDevelopmentDebug', '--no-daemon', '--max-workers=2',
                 '-PreactNativeArchitectures=x86_64'], 'Build debug-key-only development APK',
                timeout=2100, cwd=ROOT / 'android')
    data = read()
    data['built_artifact'] = artifact_identity()
    data['build'] = 'PASS'
    save(data)


def warm_metro_bundle():
    """Bound cold development bundling before starting either disposable app."""
    bundle_platform = {'IOS': 'ios', 'ANDROID': 'android'}.get(PLATFORM)
    if bundle_platform is None:
        raise ValueError('Unsupported native bundle platform.')
    url = 'http://127.0.0.1:8081/index.bundle?platform=%s&dev=true&minify=false' % bundle_platform
    body = PRIVATE / ('%s-development-warmup.bundle' % bundle_platform)
    details = {'scope': 'Development bundle setup only; not native or UI evidence.',
               'platform': bundle_platform, 'url': url, 'timeout_seconds': 240,
               'result': 'FAIL', 'http_status': None}
    started = time.monotonic()
    try:
        status = command(['curl', '--fail', '--silent', '--show-error', '--max-time', '240',
                          '--output', str(body), '--write-out', '%{http_code}', url],
                         'Warm %s development bundle (setup only)' % PLATFORM, timeout=250, capture=True)
        if re.fullmatch(r'\d{3}', status):
            details['http_status'] = int(status)
        if status != '200' or not body.is_file() or body.stat().st_size == 0:
            raise RuntimeError('Development bundle warmup did not return a nonempty HTTP 200 body.')
        digest = hashlib.sha256()
        with body.open('rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(chunk)
        details.update({'result': 'PASS', 'bytes': body.stat().st_size, 'sha256': digest.hexdigest()})
    finally:
        details['duration_seconds'] = round(time.monotonic() - started, 1)
        data = read()
        data['metro_warmup'] = details
        save(data)


def smoke():
    if read()['build'] != 'PASS':
        raise RuntimeError('A successful native build is required before smoke testing.')
    if artifact_identity() != read()['built_artifact']:
        raise RuntimeError('Built artifact changed before the disposable startup smoke.')
    metro_output = (PRIVATE / 'metro.log').open('wb')
    metro = subprocess.Popen(['node', 'node_modules/react-native/cli.js', 'start', '--port', '8081'],
                             cwd=ROOT, stdout=metro_output, stderr=subprocess.STDOUT, start_new_session=True)
    device = None
    report = PRIVATE / 'smoke-junit.xml'
    try:
        for _ in range(60):
            if metro.poll() is not None:
                raise RuntimeError('Metro exited before the disposable smoke.')
            try:
                with urllib.request.urlopen('http://127.0.0.1:8081/status', timeout=2) as response:
                    if b'packager-status:running' in response.read():
                        break
            except OSError:
                time.sleep(1)
        else:
            raise RuntimeError('Metro did not become ready within 60 attempts.')
        warm_metro_bundle()
        if PLATFORM == 'IOS':
            device = command(['xcrun', 'simctl', 'create', 'Keeper-disposable-ci',
                              'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
                              'com.apple.CoreSimulator.SimRuntime.iOS-18-5'],
                             'Create fresh iPhone 16 iOS 18.5 simulator', capture=True)
            command(['xcrun', 'simctl', 'boot', device], 'Boot disposable simulator')
            command(['xcrun', 'simctl', 'bootstatus', device, '-b'], 'Wait for simulator boot', timeout=240)
            command(['xcrun', 'simctl', 'install', device,
                     str(PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app')],
                    'Install unsigned development app', timeout=120)
            descriptor = 'iPhone 16; iOS 18.5'
        else:
            sdk = Path(os.environ.get('ANDROID_HOME', os.environ.get('ANDROID_SDK_ROOT', '')))
            # Query the installed SDK package without loading emulator GUI libraries
            # on the headless host. The emulator runner already booted this image.
            emulator_version = android_sdk_metadata(sdk, 'emulator')
            adb_version = command(['adb', 'version'], 'Record actual adb version', capture=True)
            data = read()
            data['toolchain']['emulator'] = {'source': 'emulator/source.properties', **emulator_version}
            data['toolchain']['adb'] = adb_version
            save(data)
            device = command(['adb', 'get-serialno'], 'Identify fresh emulator', capture=True)
            command(['adb', '-s', device, 'reverse', 'tcp:8081', 'tcp:8081'], 'Connect emulator to Metro')
            command(['adb', '-s', device, 'install', '-r',
                     'android/app/build/outputs/apk/development/debug/app-development-debug.apk'],
                    'Install development debug APK', timeout=120)
            descriptor = command(['adb', '-s', device, 'shell', 'getprop', 'ro.build.fingerprint'],
                                 'Record Android emulator image', capture=True)
        data = read()
        data['device'] = {'id': device, 'image': descriptor, 'fresh_disposable_state': True}
        data['installed_artifact_verified'] = True
        save(data)
        command([data['maestro']['binary'], '--device', device, 'test', '--env', 'APP_ID=' + APP_IDS[PLATFORM],
                 '--flatten-debug-output', '--debug-output', str(PRIVATE / 'maestro-output'),
                 '--format', 'junit', '--output', str(report), '--test-output-dir', str(PRIVATE / 'maestro-output'),
                 '.github/native/startup.yaml'], 'Assert startup and disposable passcode transition', timeout=420)
        suite = ET.parse(report).getroot()
        cases = list(suite.iter('testcase'))
        if not cases or any(list(case.iter('failure')) or list(case.iter('error')) or list(case.iter('skipped'))
                            for case in cases):
            raise RuntimeError('Maestro did not produce a complete successful smoke report.')
        data = read()
        data['smoke'] = 'PASS'
        data['smoke_test_cases'] = len(cases)
        save(data)
    except Exception:
        try:
            record_startup_failure(report, device)
        except Exception as error:
            # Diagnostics never replace the original failed native/UI result.
            data = read()
            data['startup_diagnostics'] = {'collection_errors': [
                {'stage': 'collector', 'error_type': type(error).__name__}]}
            save(data)
        raise
    finally:
        if metro.poll() is None:
            os.killpg(metro.pid, signal.SIGTERM)
            try:
                metro.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(metro.pid, signal.SIGKILL)
        metro_output.close()
        if device and PLATFORM == 'IOS':
            subprocess.run(['xcrun', 'simctl', 'shutdown', device], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=30, check=False)
            subprocess.run(['xcrun', 'simctl', 'delete', device], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=30, check=False)
        elif device:
            subprocess.run(['adb', '-s', device, 'uninstall', APP_IDS[PLATFORM]], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=30, check=False)


def main():
    if PLATFORM not in APP_IDS or len(sys.argv) != 2 or sys.argv[1] not in ['record', 'prepare', 'driver', 'build', 'smoke']:
        raise RuntimeError('Expected a hosted platform and record|prepare|driver|build|smoke.')
    os.environ.update({'ENVFILE': '.env.ci', 'RCT_NO_LAUNCH_PACKAGER': '1',
                       'RCT_NEW_ARCH_ENABLED': '1', 'MAESTRO_CLI_NO_ANALYTICS': '1'})
    run_phase(sys.argv[1])


def run_phase(phase):
    try:
        globals()[phase]()
    except Exception:
        if EVIDENCE.exists():
            evidence = read()
            evidence['failed_phase'] = phase
            if phase in ['build', 'smoke']:
                evidence[phase] = 'FAIL'
            save(evidence)
        raise


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Hosted native validation failed: %s' % error, file=sys.stderr)
        sys.exit(1)
