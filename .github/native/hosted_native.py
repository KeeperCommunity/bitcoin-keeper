#!/usr/bin/env python3
"""Disposable hosted smoke harness; only allowlisted metadata leaves the runner.

Native and Maestro output stays under RUNNER_TEMP, never in an uploaded glob.
The gate trusts protected workflow/job provenance, never this writable artifact.
"""

import hashlib
import importlib.util
import json
import math
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
from types import SimpleNamespace
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
    """Classify observed tool failures; never return any part of a log line.

    Redaction cannot recognize arbitrary wallet, user or application text. Each
    result must come from this fixed vocabulary, including the fallback.
    """
    categories = (
        (r'lockfile needs to be updated|could not find compatible versions|^The sandbox is not in sync',
         'DEPENDENCY_LOCK_MISMATCH'),
        (r'no space left on device', 'DISK_SPACE_EXHAUSTED'),
        (r'command not found', 'REQUIRED_TOOL_UNAVAILABLE'),
        (r'requires a higher minimum deployment target', 'IOS_DEPLOYMENT_TARGET_UNSUPPORTED'),
        (r'^e: ', 'KOTLIN_COMPILER_ERROR'),
        (r'^\[!\]', 'COCOAPODS_ERROR'),
        (r'^FAILURE:|^A problem occurred|^Execution failed', 'BUILD_FAILURE'),
        (r'^Could not ', 'DEPENDENCY_OR_TOOL_FAILURE'),
        (r'\berror:|^error |^> (?!Task\b)|^Caused by:', 'TOOL_ERROR'),
    )
    selected = []
    for raw in log.splitlines():
        line = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', raw).strip()
        if re.match(r'^\d+\s*\|', line):
            continue
        for pattern, category in categories:
            if re.search(pattern, line, re.IGNORECASE):
                if category not in selected:
                    selected.append(category)
                break
    return selected


def maestro_failure_details(log):
    """Retain only fixed command labels, selectors and tool failure categories."""
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
        elif line.startswith(('Unable to launch app', 'Failed to launch app')):
            selected.append('Maestro app launch failed')
        elif line.startswith(('Unable to connect', 'Failed to connect')):
            selected.append('Maestro connection failed')
        elif line.startswith('Failed to start'):
            selected.append('Maestro driver start failed')
        elif line.startswith(('No devices found', 'No connected devices', 'Unable to find device')):
            selected.append('Maestro device unavailable')
        if len(selected) >= 10:
            break
    return list(dict.fromkeys(selected))[:10]


def android_startup_errors(log):
    categories = {'AndroidRuntime': 'ANDROID_RUNTIME_ERROR',
                  'ReactNativeJS': 'REACT_NATIVE_JS_ERROR', 'ReactNative': 'REACT_NATIVE_ERROR'}
    selected = []
    for line in log.splitlines():
        match = re.match(r'^[EF]/(AndroidRuntime|ReactNativeJS|ReactNative)\s*\(\s*\d+\):\s*(.*)', line)
        if not match:
            continue
        tag, message = match.groups()
        if re.search(r'(?:FATAL EXCEPTION|Caused by:|\b[\w.$]*(?:Exception|Error)\b|'
                     r'Invariant Violation|Unable to load script|Could not)', message):
            if categories[tag] not in selected:
                selected.append(categories[tag])
    return selected


def metro_startup_errors(log):
    selected = []
    for raw in log.splitlines():
        line = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', raw).strip()
        if re.match(r'^(?:error\b|(?:Syntax|Type|Reference)Error:|Unable to resolve module)', line, re.IGNORECASE):
            category = 'METRO_ERROR'
            for marker, known in [('Unable to resolve module', 'METRO_MODULE_RESOLUTION_ERROR'),
                                  ('SyntaxError:', 'METRO_SYNTAX_ERROR'),
                                  ('TypeError:', 'METRO_TYPE_ERROR'),
                                  ('ReferenceError:', 'METRO_REFERENCE_ERROR')]:
                if marker.lower() in line.lower():
                    category = known
                    break
            if category not in selected:
                selected.append(category)
    return selected


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


def ios_startup_diagnostics(payload, executable, started_ms=None, ended_ms=None, input_partial=False):
    # Pure fixed-vocabulary classifier; no source message, stack or path leaves
    # the fresh owned simulator's private compact-log query.
    spec = importlib.util.spec_from_file_location(
        'ios_startup_errors', Path(__file__).with_name('ios_startup_errors.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.classify(payload, executable, started_ms, ended_ms, input_partial)


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


def maestro_preflight_diagnostics(directory=None, command_label='Assert startup and disposable passcode transition', owned_device=None):
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
    if PLATFORM == 'IOS':
        # Maestro 2.11 performs clearState and permissions inside launchApp.
        # These log markers establish observation only; in particular its
        # "reinstalled and launched" text does not prove an app launch.
        app = APP_IDS['IOS']
        markers.update({
            'app_clear_state_started_text': 'Clearing app %s state' % app,
            'app_reinstall_started_text': 'Reinstalling and launching %s' % app,
            'app_reinstall_returned_text': 'App %s reinstalled and launched' % app,
            'app_permissions_applesimutils_started_text': '[Start] Setting permissions all=deny through applesimutils',
            'app_permissions_applesimutils_returned_text': '[Done] Setting permissions through applesimutils',
            'app_permissions_simctl_started_text': '[Start] Setting Permissions all=deny through simctl',
            'app_permissions_simctl_returned_text': '[Done] Setting Permissions all=deny through simctl',
        })
        if type(owned_device) is str and re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', owned_device):
            markers['app_simctl_launch_invocation_text'] = (
                'Running command line operation: [xcrun, simctl, launch, %s, %s] with {}' % (owned_device, app))
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


def record_startup_failure(report, device, startup_started_ms=None):
    """Collect bounded diagnostics before destroying this job's fresh app state."""
    details = {'scope': 'Fresh startup only; no account or persisted PIN created.',
               'collection_errors': []}
    try:
        startup_ended_ms = int(time.time() * 1000)
    except Exception:
        startup_ended_ms = None

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
                # Pinned Maestro JUnit stores exception.message as failure XML
                # text, separately from UI hierarchy; it has no type attribute.
                first_line = ''.join(failure.itertext()).splitlines()[:1]
                result['testcase_failures'].extend(maestro_failure_details('\n'.join(first_line)))
        return result

    collect('maestro', maestro_details)
    collect('maestro_preflight', lambda: maestro_preflight_diagnostics(owned_device=device))
    collect('hierarchy_signals', lambda: startup_hierarchy_signals(PRIVATE / 'maestro-output'))
    collect('metro_errors', lambda: metro_startup_errors(private_text(PRIVATE / 'metro.log')))
    collect('metro_progress', lambda: metro_startup_progress(private_log_prefix(PRIVATE / 'metro.log')[0]))
    if PLATFORM == 'IOS' and device:
        def ios_command_observation():
            spec = importlib.util.spec_from_file_location('ios_startup_command_observation',
                Path(__file__).with_name('ios_startup_command_observation.py'))
            observer = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(observer)
            return observer.collect(PRIVATE, device)
        collect('command_observation', ios_command_observation)
        def ios_replacement_observation():
            spec = importlib.util.spec_from_file_location('ios_replacement_observation',
                Path(__file__).with_name('ios_replacement_observation.py'))
            observer = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(observer)
            return observer.collect(SimpleNamespace(PRIVATE=PRIVATE, PLATFORM=PLATFORM,
                read=read, artifact_identity=artifact_identity,
                _bundle_inventory=_bundle_inventory, owned_ios_bundle_path=owned_ios_bundle_path), device)
        collect('replacement_observation', ios_replacement_observation)
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
        def android_runtime_details():
            spec = importlib.util.spec_from_file_location(
                'android_startup_diagnosis', Path(__file__).with_name('android_startup_diagnosis.py'))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module.collect(PRIVATE, device)
        collect('android_runtime_diagnosis', android_runtime_details)
    elif PLATFORM == 'IOS' and device:
        def ios_details():
            executable = read()['built_artifact']['executable']
            if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*', executable):
                raise ValueError('Unsafe iOS executable selector.')
            predicate = ('process == "%s" AND (messageType == "error" OR messageType == "fault" '
                         'OR eventMessage CONTAINS[c] "error" OR eventMessage CONTAINS[c] "exception" '
                         'OR eventMessage CONTAINS[c] "fatal")') % executable
            # Retain INFO for existing bounded diagnostics. The single new
            # direct-hook failure marker uses RN's OS_LOG_TYPE_ERROR sink;
            # actual marker routing still needs exact-source native proof.
            args = ['xcrun', 'simctl', 'spawn', device, 'log', 'show', '--info', '--style', 'compact',
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
            result = {'command': args, 'exit_code': code, 'errors': [],
                      'query_status': 'SUCCESS' if code == 0 else 'TIMEOUT' if code == 124 else 'FAILED',
                      'parse_status': 'UNKNOWN', 'cause': 'UNDETERMINED', 'input_truncated': None,
                      'startup_failure_receipt': {'schema': 1, 'status': 'UNKNOWN', 'records': [],
                          'cause': 'UNDETERMINED', 'reasons': ['QUERY_UNAVAILABLE'],
                          'scope': 'OPTIONAL_ORIGINAL_STARTUP_MARKERS_NOT_CAUSE_OR_ACCEPTANCE'}}
            if code == 0:
                try:
                    payload, truncated = private_log_prefix(path)
                    result.update(ios_startup_diagnostics(payload, executable, startup_started_ms,
                                                         startup_ended_ms, input_partial=truncated))
                    result['input_truncated'] |= truncated
                    if truncated:
                        result['parse_status'] = 'PARTIAL' if result['matching_process_records'] else 'UNKNOWN'
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
                                    if needle in log.lower()), 'Inspect this command locally; raw output remains private to the runner.')
        # Keep the schema-1 field name for consumers; values are now fixed
        # categories, never redacted excerpts or arbitrary exception messages.
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
        'diagnostic_only': os.environ.get('KEEPER_DIAGNOSTIC') == 'true',
        'workflow_ref': os.environ.get('GITHUB_WORKFLOW_REF'),
        'workflow_sha': os.environ.get('GITHUB_WORKFLOW_SHA'),
        'run_id': os.environ.get('GITHUB_RUN_ID'), 'run_attempt': os.environ.get('GITHUB_RUN_ATTEMPT'),
        'runner': {key: os.environ.get(key) for key in
                   ['RUNNER_OS', 'RUNNER_ARCH', 'ImageOS', 'ImageVersion']},
        'os': platform.platform(), 'commands': [], 'build': 'NOT RUN', 'smoke': 'NOT RUN', 'native_probe': 'NOT RUN', 'r5_features': 'NOT RUN',
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
    disk_preflight('initial')


def fixtures():
    # Empty values would fall back to real development services in config.ts.
    overlays = ['.env.ci', 'firebase.json']
    (ROOT / '.env.ci').write_text('''ENVIRONMENT=DEVELOPMENT
RELAY=http://127.0.0.1:8765/
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
    disk_preflight('before_dependencies')
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


def _file_sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def _bundle_inventory(bundle):
    """Private typed tree; internal links must remain inside this bundle."""
    import plistlib
    if bundle.is_symlink() or not bundle.is_dir():
        raise ValueError('Invalid app bundle.')
    root = bundle.resolve(strict=True)
    with (bundle / 'Info.plist').open('rb') as source:
        info = plistlib.load(source)
    executable = info['CFBundleExecutable']
    if (info['CFBundleIdentifier'] != APP_IDS['IOS'] or
            not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*', executable)):
        raise ValueError('Unexpected app identity.')
    tree = {}
    for entry in sorted(bundle.rglob('*')):
        if not entry.resolve(strict=True).is_relative_to(root):
            raise ValueError('Bundle entry escaped app.')
        if entry.is_symlink():
            value = ['link', os.readlink(entry)]
        elif entry.is_file():
            value = ['file', _file_sha256(entry)]
        elif entry.is_dir():
            value = ['directory']
        else:
            raise ValueError('Unsupported bundle entry.')
        tree[entry.relative_to(bundle).as_posix()] = value
    if tree.get(executable, [None])[0] != 'file':
        raise ValueError('Missing regular app executable.')
    return tree, executable


def owned_ios_bundle_path(installed, device, built):
    """The same exact owned container policy for acceptance and observations."""
    uuid = r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}'
    if not re.fullmatch(uuid, device):
        raise ValueError('Expected owned simulator UUID.')
    installed = Path(installed)
    base = Path.home() / 'Library/Developer/CoreSimulator/Devices' / device / 'data/Containers/Bundle/Application'
    if (not installed.is_absolute() or installed.name != built.name or
            not re.fullmatch(uuid, installed.parent.name) or
            installed.parent.parent.resolve() != base.resolve() or
            installed.resolve(strict=True).parent.parent != base.resolve()):
        raise ValueError('Unexpected installed app container.')
    return installed


def verify_installed_artifact(device):
    """Attest owned installed bytes, never installation argv or app assertions."""
    data = read()
    data['installed_artifact_verified'] = False
    data['installed_artifact_scope'] = 'NOT VERIFIED: installed bytes require full comparison.'
    data.pop('installed_artifact', None)
    save(data)
    stage = 'ARTIFACT_METADATA'
    try:
        expected = data['built_artifact']
        if PLATFORM == 'IOS':
            uuid = r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}'
            if not re.fullmatch(uuid, device):
                raise ValueError('Expected owned simulator UUID.')
            built = PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
            original, executable = _bundle_inventory(built)
            installed = Path(command(['xcrun', 'simctl', 'get_app_container', device, APP_IDS['IOS'], 'app'],
                                     'Locate owned installed app bundle', capture=True, error_details=False))
            installed = owned_ios_bundle_path(installed, device, built)
            actual, installed_executable = _bundle_inventory(installed)
            if original != actual or executable != installed_executable:
                raise ValueError('Installed bundle differs; no installer normalization is accepted.')
            result = {'method': 'FULL_SIMULATOR_BUNDLE_TREE_AND_EXECUTABLE_SHA256',
                      'inventory_sha256': hashlib.sha256(json.dumps(original, sort_keys=True).encode()).hexdigest(),
                      'executable_sha256': actual[executable][1]}
        elif PLATFORM == 'ANDROID':
            stage = 'APK_DEVICE_POLICY'
            if not re.fullmatch(r'emulator-[0-9]+', device):
                raise ValueError('Expected owned emulator serial.')
            stage = 'APK_PACKAGE_QUERY'
            listing = command(['adb', '-s', device, 'shell', 'pm', 'path', APP_IDS['ANDROID']],
                              'Locate exact installed development package', capture=True, error_details=False)
            pattern = (r'package:(/data/app/(?:~~[A-Za-z0-9_=-]+/)?' + re.escape(APP_IDS['ANDROID']) +
                       r'-[A-Za-z0-9_=-]+/base\.apk)')
            stage = 'APK_PATH_POLICY'
            match = re.fullmatch(pattern, listing)
            if not match:
                raise ValueError('Expected one exact base APK; split or unexpected paths rejected.')
            built = ROOT / 'android/app/build/outputs/apk/development/debug/app-development-debug.apk'
            stage = 'APK_BUILT_FILE'
            if built.is_symlink() or not built.is_file():
                raise ValueError('Invalid built APK.')
            PRIVATE.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix='installed-artifact-', dir=PRIVATE) as temporary:
                pulled = Path(temporary) / 'base.apk'
                # Package paths and pulled bytes stay private, including tool output.
                stage = 'APK_PULL'
                copied = subprocess.run(['adb', '-s', device, 'pull', match[1], str(pulled)],
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                        timeout=120, check=False)
                stage = 'APK_PULL_RESULT'
                if copied.returncode or pulled.is_symlink() or not pulled.is_file():
                    raise ValueError('Installed APK bytes differ or are unavailable.')
                stage = 'APK_SIZE_COMPARISON'
                if pulled.stat().st_size != built.stat().st_size:
                    raise ValueError('Installed APK bytes differ or are unavailable.')
                stage = 'APK_HASH_COMPARISON'
                if _file_sha256(pulled) != expected['sha256']:
                    raise ValueError('Installed APK bytes differ or are unavailable.')
            result = {'method': 'SINGLE_INSTALLED_BASE_APK_SHA256', 'sha256': expected['sha256']}
        else:
            raise ValueError('Unsupported artifact platform.')
        stage = 'BUILT_ARTIFACT_STABILITY'
        if artifact_identity() != expected:
            raise ValueError('Built artifact changed during installed comparison.')
    except Exception:
        # Fixed labels distinguish a rejected path from pull/byte failures.
        # Never print pm output, installed paths, exception text or APK bytes.
        print('Installed artifact verification failed at ' + stage, flush=True)
        raise RuntimeError('Installed artifact bytes were not verified; no equivalence claimed.') from None
    data = read()
    data.update(installed_artifact_verified=True, installed_artifact=result,
                installed_artifact_scope='Full installed artifact byte comparison; no installer transformations accepted.')
    save(data)
    return result


def wait_for_simulator_app_services(device):
    """Boot completion alone did not establish app-service responsiveness."""
    if PLATFORM != 'IOS':
        raise ValueError('Simulator app-service readiness is iOS-only.')
    spec = importlib.util.spec_from_file_location('simulator_readiness', Path(__file__).with_name('simulator_readiness.py'))
    readiness = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(readiness)
    return readiness.wait_for_app_services(SimpleNamespace(PRIVATE=PRIVATE, read=read, save=save),
                                          device, timeout=120)


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
        wait_for_simulator_app_services(device)
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
        try:
            data = read()
            data['driver_preflight'] = details
            save(data)
        except Exception:
            if original_error is None:
                raise RuntimeError('Driver-preflight receipt failed.') from None
        if details['cleanup_errors'] and original_error is None:
            raise RuntimeError('Owned driver-preflight simulator cleanup failed.')


def disk_preflight(stage):
    free = shutil.disk_usage(ROOT).free
    minimum = 12 * 1024 ** 3
    data = read()
    data.setdefault('disk_preflight', []).append({
        'stage': stage, 'free_bytes': free, 'minimum_free_bytes': minimum,
        'result': 'PASS' if free >= minimum else 'FAIL',
    })
    save(data)
    if free < minimum:
        raise RuntimeError('Insufficient disposable-runner disk reserve; no cache or user data was removed.')


def sign_simulator_app():
    spec = importlib.util.spec_from_file_location('simulator_signing', Path(__file__).with_name('simulator_signing.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.sign(SimpleNamespace(PLATFORM=PLATFORM, PRIVATE=PRIVATE, read=read, save=save, command=command))


def build():
    disk_preflight('before_native_build')
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
        # Keychain rejects unsigned simulator executables with
        # errSecMissingEntitlement. This uses no certificate or release key;
        # record built/installed identities only after the ad-hoc signature.
        sign_simulator_app()
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


def warm_metro_bundle(suite='startup'):
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
        data['metro_warmup' if suite == 'startup' else suite + '_bundle'] = details
        save(data)


R5_SCENARIOS = [
    'production-setup-offline-retry-native-counts',
    'production-deletion-retained-native-references',
    'production-deletion-native-rollback',
    'production-worker-stale-session-rejection',
    'native-worker-process-relaunch-counts',
]
R5_LIMITS = [
    'controlled-transport-no-backend-acceptance',
    'synthetic-wallet-generation-no-crypto-acceptance',
    'injected-dispatch-selection-no-login-acceptance',
    'no-product-ui-navigation-pin-or-biometric-acceptance',
    'probe-and-worker-timings-not-product-startup-ux',
]
R5_SOURCES = {
    'src/utils/utilities.ts': ['getAccountFromSigner', 'getKeyUID'],
    'src/store/sagas/storage.ts': ['setupKeeperAppWorker'],
    'src/store/sagas/wallets.ts': ['currentWalletAccountId', 'assertWalletAccount', 'deleteSigningDeviceWorker'],
    'src/store/sagas/bhr.ts': ['currentBackupAppId', 'deleteAppImageEntityWorker'],
    'src/services/backup/transport.ts': ['observeBackupAccount', 'currentBackupAccountSession', 'clearVerifiedRemoteRevision'],
}


def validate_r5_feature_evidence(raw):
    if not isinstance(raw, str) or len(raw.encode()) > 65536:
        raise ValueError('Feature evidence absent or oversized.')
    def invalid_constant(value):
        raise ValueError('Non-finite feature measurement.')
    payload = json.loads(raw, parse_constant=invalid_constant)
    if (type(payload.get('schema')) is not int or payload.get('schema') != 1 or payload.get('scope') != 'production-worker-native-storage'
            or payload.get('status') != 'PASS' or payload.get('stage') != 'pass'
            or payload.get('scenarios') != [{'id': item, 'status': 'PASS'} for item in R5_SCENARIOS]
            or payload.get('limits') != R5_LIMITS):
        raise ValueError('Feature scenario evidence is incomplete or outside reviewed scope.')
    measurements = payload.get('measurements')
    if not isinstance(measurements, list) or len(measurements) != 5:
        raise ValueError('Five raw helper measurements are required.')
    for iteration, row in enumerate(measurements, 1):
        if not isinstance(row, dict) or set(row) != {'iteration', 'probe_ready_ms', 'setup_first_wallet_ms'} or type(row['iteration']) is not int or row['iteration'] != iteration:
            raise ValueError('Invalid feature measurement shape.')
        for field in ['probe_ready_ms', 'setup_first_wallet_ms']:
            value = row[field]
            if type(value) not in [int, float] or not math.isfinite(value) or not 0 <= value <= 600000:
                raise ValueError('Invalid bounded feature measurement.')
    sources = payload.get('source_functions')
    expected = []
    for path, names in R5_SOURCES.items():
        committed = subprocess.check_output(['git', 'show', 'HEAD:' + path], cwd=ROOT)
        if (ROOT / path).read_bytes() != committed:
            raise ValueError('Feature production source differs from committed candidate.')
        expected.append({'path': path, 'sha256': hashlib.sha256(committed).hexdigest(), 'names': names})
    if sources != expected:
        raise ValueError('Feature workers do not match exact-candidate production source.')
    # Export only fixed scope/status, public source digests and bounded numbers.
    # Never forward arbitrary payload fields or native failure messages.
    return {'schema': 1, 'scope': 'production-worker-native-storage', 'status': 'PASS',
            'scenarios': payload['scenarios'], 'measurements': measurements,
            'limits': R5_LIMITS, 'source_functions': sources}


def collect_r5_feature_evidence(device):
    filename = 'keeper-r5-native-evidence.json'
    if PLATFORM == 'IOS':
        container = Path(command(['xcrun', 'simctl', 'get_app_container', device, APP_IDS[PLATFORM], 'data'],
                                 'Locate disposable feature evidence', capture=True))
        path = container / 'Documents' / filename
        if path.stat().st_size > 65536:
            raise ValueError('Oversized native feature evidence.')
        raw = path.read_text()
    else:
        raw = command(['adb', '-s', device, 'exec-out', 'run-as', APP_IDS[PLATFORM],
                       'head', '-c', '65537', 'files/' + filename],
                      'Read bounded disposable feature evidence', capture=True, error_details=False)
    return validate_r5_feature_evidence(raw)


def smoke(suite='startup'):
    if suite not in ['startup', 'probe', 'features']:
        raise ValueError('Unknown disposable native suite.')
    is_probe = suite == 'probe'
    is_features = suite == 'features'
    result_key = 'r5_features' if is_features else 'native_probe' if is_probe else 'smoke'
    if (is_probe or is_features) and read()['smoke'] != 'PASS':
        raise RuntimeError('The real app startup smoke must pass before module probes.')
    if read()['build'] != 'PASS':
        raise RuntimeError('A successful native build is required before smoke testing.')
    if artifact_identity() != read()['built_artifact']:
        raise RuntimeError('Built artifact changed before the disposable startup smoke.')
    if is_features:
        command(['git', 'diff', '--exit-code', 'HEAD', '--', *R5_SOURCES],
                'Verify committed R5 worker source before extraction', error_details=False)
        command(['node', '.github/native/r5_prepare.cjs'], 'Prepare exact-source R5 production worker probe', timeout=60, error_details=False)
    report = PRIVATE / ('features-junit.xml' if is_features else 'probe-junit.xml' if is_probe else 'smoke-junit.xml')
    report.unlink(missing_ok=True)
    metro_output = (PRIVATE / 'metro.log').open('wb')
    metro_args = ['node', 'node_modules/react-native/cli.js', 'start', '--port', '8081']
    startup_observer = None
    startup_capture = None
    startup_context = SimpleNamespace(PRIVATE=PRIVATE, PLATFORM=PLATFORM)
    metro_env = os.environ.copy()
    try:
        if is_probe or is_features:
            metro_args += ['--config', str(ROOT / ('.github/native/r5_metro.cjs' if is_features else '.github/native/release_metro.cjs'))]
        else:
            # Observation retains the normal entrypoint/resolver/transformer and
            # response body on both platforms. Only fixed facts leave the window.
            spec = importlib.util.spec_from_file_location('startup_diagnosis', Path(__file__).with_name('startup_diagnosis.py'))
            startup_observer = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(startup_observer)
            observer_path = PRIVATE / 'startup-observer.jsonl'
            observer_path.unlink(missing_ok=True)
            metro_env['KEEPER_STARTUP_OBSERVER_PATH'] = str(observer_path)
            metro_args += ['--config', str(ROOT / '.github/native/startup_observer.cjs'),
                           '--custom-log-reporter-path', str(ROOT / '.github/native/startup_reporter.cjs')]
        metro = subprocess.Popen(metro_args,
                                 cwd=ROOT, stdout=metro_output, stderr=subprocess.STDOUT, start_new_session=True,
                                 env=metro_env)
    except Exception:
        try:
            metro_output.close()
        except Exception:
            pass
        raise
    device = None
    startup_error = None
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
        warm_metro_bundle(suite)
        if PLATFORM == 'IOS':
            device = command(['xcrun', 'simctl', 'create', 'Keeper-disposable-ci',
                              'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
                              'com.apple.CoreSimulator.SimRuntime.iOS-18-5'],
                             'Create fresh iPhone 16 iOS 18.5 simulator', capture=True)
            if not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', device):
                raise ValueError('Expected owned simulator UUID before installation.')
            command(['xcrun', 'simctl', 'boot', device], 'Boot disposable simulator')
            command(['xcrun', 'simctl', 'bootstatus', device, '-b'], 'Wait for simulator boot', timeout=240)
            wait_for_simulator_app_services(device)
            install_args = ['xcrun', 'simctl', 'install', device,
                            str(PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app')]
            if not (is_probe or is_features):
                spec = importlib.util.spec_from_file_location('install_diagnosis', Path(__file__).with_name('install_diagnosis.py'))
                installer = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(installer)
                installer.observe(SimpleNamespace(PRIVATE=PRIVATE, ROOT=ROOT, read=read, save=save, command=command),
                                  device, install_args, 'Install unsigned development app', timeout=120)
            else:
                command(install_args, 'Install unsigned development app', timeout=120)
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
            if not re.fullmatch(r'emulator-[0-9]+', device):
                raise ValueError('Expected owned emulator before installation.')
            command(['adb', '-s', device, 'reverse', 'tcp:8081', 'tcp:8081'], 'Connect emulator to Metro')
            command(['adb', '-s', device, 'install', '-r',
                     'android/app/build/outputs/apk/development/debug/app-development-debug.apk'],
                    'Install development debug APK', timeout=120)
            descriptor = command(['adb', '-s', device, 'shell', 'getprop', 'ro.build.fingerprint'],
                                 'Record Android emulator image', capture=True)
        data = read()
        data['device'] = {'id': device, 'image': descriptor, 'fresh_disposable_state': True}
        data['install_succeeded'] = True
        save(data)
        verify_installed_artifact(device)
        data = read()
        if startup_observer:
            try:
                startup_capture = startup_observer.start(startup_context, device)
            except Exception:
                data['startup_observation_capture'] = 'UNAVAILABLE'
                save(data)
        command([data['maestro']['binary'], '--device', device, 'test', '--env', 'APP_ID=' + APP_IDS[PLATFORM],
                 '--flatten-debug-output', '--debug-output', str(PRIVATE / 'maestro-output'),
                 '--format', 'junit', '--output', str(report), '--test-output-dir', str(PRIVATE / 'maestro-output'),
                 '.github/native/r5_features.yaml' if is_features else '.github/native/release_probe.yaml' if is_probe else '.github/native/startup.yaml'],
                'Assert R5 production workers over native storage' if is_features else 'Assert native persistence across process launches' if is_probe else
                'Assert startup and disposable passcode transition', timeout=660 if is_features else 300 if is_probe else 420,
                error_details=not (is_probe or is_features))
        cases = successful_junit(report)
        if artifact_identity() != read()['built_artifact']:
            raise RuntimeError('Built artifact changed during native execution.')
        verify_installed_artifact(device)
        data = read()
        data[result_key] = 'PASS'
        data[result_key + '_test_cases'] = cases
        if is_features:
            data['r5_feature_evidence'] = collect_r5_feature_evidence(device)
        if is_probe:
            data['probe_scope'] = ('CI-only Metro entrypoint; actual encrypted Realm/current schemas and production MMKV; '
                                   'three process launches, rollback, wrong-key rejection, targeted primitive deletion, '
                                   'separate database files and cleanup. NOT app key deletion, account isolation, '
                                   'setup/recovery or release performance acceptance.')
        save(data)
    except Exception as original_error:
        startup_error = original_error
        try:
            if not (is_probe or is_features):
                record_startup_failure(report, device, getattr(startup_capture, 'started_ms', None))
            else:
                data = read()
                data[result_key] = 'FAIL'
                data['probe_diagnostics'] = 'Native module or worker probe failed; raw output retained only on ephemeral runner.'
                save(data)
        except Exception as error:
            # Diagnostics never replace the original failed native/UI result.
            try:
                data = read()
                data['startup_diagnostics'] = {'collection_errors': [
                    {'stage': 'collector', 'error_type': type(error).__name__}]}
                save(data)
            except Exception:
                pass
        raise
    finally:
        # Receipt I/O is never allowed to skip owned-resource disposal or hide
        # the original native failure. Retain only fixed cleanup labels.
        cleanup_errors = []
        updates = {}

        def cleanup(label, action):
            try:
                action()
            except Exception:
                cleanup_errors.append(label)

        if startup_observer:
            try:
                updates['startup_observation'] = startup_observer.collect(startup_context, device, startup_capture) if device else {'scope': 'App launch NOT RUN; no owned device.'}
            except Exception:
                updates['startup_observation'] = {'collection_errors': ['collector']}
            cleanup('startup_capture', lambda: startup_observer.stop(startup_capture))
            if 'startup_capture' in cleanup_errors:
                updates['startup_observation_cleanup'] = 'FAIL'

        def stop_metro():
            if metro.poll() is None:
                os.killpg(metro.pid, signal.SIGTERM)
                try:
                    metro.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(metro.pid, signal.SIGKILL)
                    metro.wait(timeout=10)

        cleanup('metro_process', stop_metro)
        cleanup('metro_output', metro_output.close)
        if device and PLATFORM == 'IOS':
            for action in ['shutdown', 'delete']:
                cleanup('device_' + action, lambda action=action: subprocess.run(
                    ['xcrun', 'simctl', action, device], stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL, timeout=30, check=True))
        elif device:
            cleanup('device_uninstall', lambda: subprocess.run(
                ['adb', '-s', device, 'uninstall', APP_IDS[PLATFORM]], stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, timeout=30, check=True))
        if startup_observer:
            # Purge only this observer's raw files; other phases still need the
            # shared private build/tool directories on the ephemeral runner.
            observer_files = ['startup-logcat.log', 'startup-observer.jsonl', 'startup-foreground.log']
            if PLATFORM == 'IOS':
                observer_files += ['ios-startup-errors.log', 'ios-startup-errors-stderr.log']
            for name in observer_files:
                cleanup('private_' + name.split('.')[0], lambda name=name: (PRIVATE / name).unlink(missing_ok=True))
        if startup_error is not None or cleanup_errors:
            updates[result_key] = 'FAIL'
        if cleanup_errors:
            updates['startup_cleanup_errors'] = cleanup_errors.copy()
        try:
            data = read()
            data.update(updates)
            save(data)
        except Exception:
            cleanup_errors.append('metadata')
            # A transient write failure may allow one best-effort FAIL receipt.
            # A permanently unavailable receipt still causes a failing phase.
            try:
                data = read()
                data.update(updates)
                data.update({result_key: 'FAIL', 'startup_cleanup_errors': cleanup_errors.copy()})
                save(data)
            except Exception:
                pass
        if cleanup_errors and startup_error is None:
            raise RuntimeError('Startup cleanup or receipt failed; subsequent probes cannot run.') from None


def successful_junit(report):
    if not report.is_file() or report.stat().st_size > 1024 * 1024:
        raise RuntimeError('Missing or oversized native JUnit report.')
    root = ET.parse(report).getroot()
    for suite in root.iter():
        if suite.tag in ['testsuite', 'testsuites']:
            for attribute in ['failures', 'errors', 'skipped', 'disabled']:
                if int(suite.get(attribute, '0')) != 0:
                    raise RuntimeError('Native JUnit declares unsuccessful cases.')
    cases = list(root.iter('testcase'))
    if not cases or any(list(root.iter(tag)) for tag in ['failure', 'error', 'skipped']) or any(
            case.get('status', 'SUCCESS').upper() != 'SUCCESS' for case in cases):
        raise RuntimeError('Maestro did not produce a complete successful native report.')
    return len(cases)


def probe():
    smoke('probe')


def features():
    smoke('features')


def main():
    if PLATFORM not in APP_IDS or len(sys.argv) != 2 or sys.argv[1] not in ['record', 'prepare', 'driver', 'build', 'smoke', 'probe', 'features']:
        raise RuntimeError('Expected a hosted platform and record|prepare|driver|build|smoke|probe|features.')
    os.environ.update({'ENVFILE': '.env.ci', 'RCT_NO_LAUNCH_PACKAGER': '1',
                       'RCT_NEW_ARCH_ENABLED': '1', 'MAESTRO_CLI_NO_ANALYTICS': '1'})
    run_phase(sys.argv[1])


def run_phase(phase):
    try:
        globals()[phase]()
    except Exception:
        try:
            if EVIDENCE.exists():
                evidence = read()
                evidence['failed_phase'] = phase
                if phase in ['build', 'smoke', 'probe', 'features']:
                    evidence['r5_features' if phase == 'features' else 'native_probe' if phase == 'probe' else phase] = 'FAIL'
                save(evidence)
        except Exception:
            pass
        raise


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Unexpected exceptions can contain private paths or process output too.
        print('Hosted native validation failed; inspect phase status and fixed diagnostic categories.', file=sys.stderr)
        sys.exit(1)
