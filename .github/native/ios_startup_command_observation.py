"""Failure-only fixed Maestro command and simulator service observations.

No launch, app-state mutation, raw error, identifier, PID or hierarchy is
exported. These observations cannot establish launch cause or native acceptance.
"""
from datetime import datetime
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import tempfile

APP = 'io.hexawallet.hexakeeper.dev'
FLOW = 'Disposable startup and passcode input'
LIMIT = 1024 * 1024
KINDS = {
    'applyConfigurationCommand': 'CONFIGURATION',
    'launchAppCommand': 'LAUNCH_APP',
    'clearStateCommand': 'CLEAR_STATE',
    'stopAppCommand': 'STOP_APP',
    'assertConditionCommand': 'ASSERT_CONDITION',
    'tapOnElement': 'TAP_ELEMENT',
}
STATUSES = ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'WARNED', 'SKIPPED')
ERROR_MARKERS = {
    'APP_LAUNCH_TEXT': r'Unable to launch app|Failed to launch app|Cannot launch app',
    'APP_NOT_INSTALLED_TEXT': r'app(?:lication)? is not installed|Application not installed',
    'DEVICE_DISCONNECTED_TEXT': r'was requested, but it is not connected|No devices found|No connected devices',
    'DRIVER_CONNECTION_TEXT': r'Unable to connect|Failed to connect|Connection refused|ConnectException|DeviceConnectionException',
    'DRIVER_TIMEOUT_TEXT': r'IOSDriverTimeoutException|iOS driver not ready in time',
    'FBS_OPEN_APPLICATION_TEXT': r'\bFBSOpenApplicationServiceErrorDomain\b|\bFBSOpenApplicationErrorDomain\b',
    'SIMCTL_OPERATION_TEXT': r'An error was encountered processing the command',
    'ASSERTION_TEXT': r'Assertion is false:|Element not found:',
}
ERROR_DOMAINS = frozenset(('FBSOpenApplicationServiceErrorDomain', 'FBSOpenApplicationErrorDomain',
    'RBSRequestErrorDomain', 'RBSErrorDomain', 'NSPOSIXErrorDomain', 'NSCocoaErrorDomain',
    'NSOSStatusErrorDomain', 'NSMachErrorDomain'))
LAUNCH_SERVICES = frozenset(('SpringBoard', 'runningboardd', 'launchd', 'lsd'))
LAUNCH_MARKERS = {
    'CAPABILITY_TEXT': r'\b(?:UIRequiredDeviceCapabilities|capabilit(?:y|ies))\b',
    'ARCHITECTURE_TEXT': r'\b(?:architecture|armv7|arm64|x86_64|EBADARCH)\b',
    'SIGNATURE_TEXT': r'\b(?:signature|codesign|AMFI|entitlement|entitlements)\b',
    'NOT_FOUND_TEXT': r'\b(?:not found|NotFound|unknown to FrontBoard|no such file)\b',
    'PERMISSION_TEXT': r'\b(?:operation not permitted|permission denied|EPERM|EACCES)\b',
    'SPAWN_FAILURE_TEXT': r'\b(?:failed to (?:launch|spawn)|spawn failed|launch failed)\b',
    'DYLD_TEXT': r'\b(?:dyld|Library not loaded|Symbol not found)\b',
}


def launch_error_codes(error):
    """Project exact simctl header pairs, without descriptions or interpretation."""
    result = {'state': 'UNKNOWN', 'pairs': [], 'scope': 'RECORDED_CODES_NOT_INTERPRETED_CAUSE'}
    pairs = []
    if (type(error) is not dict or not set(error) <= {'message', 'debugMessage'} or
            any(type(value) is not str or len(value) > 65536 for value in error.values())):
        return result
    pattern = (r'(?:An error was encountered processing the command|Underlying error) '
               r'\(domain=([A-Za-z][A-Za-z0-9.]{0,95}), code=(-?(?:0|[1-9][0-9]{0,9}))\):')
    for text in error.values():
        for line in text.splitlines():
            if 'domain=' not in line and 'Error Domain=' not in line:
                continue
            match = re.fullmatch(pattern, line.strip(' \t'))
            if not match or match[1] not in ERROR_DOMAINS:
                return result
            code = int(match[2])
            if not -(2 ** 31) <= code < 2 ** 31:
                return result
            pair = {'domain': match[1], 'code': code}
            if pair not in pairs:
                pairs.append(pair)
            if len(pairs) > 8:
                return result
    if pairs:
        result.update(state='RECORDED', pairs=pairs)
    return result


def unknown():
    return {'schema': 1, 'state': 'UNKNOWN', 'rows': [],
            'scope': 'RECORDED_COMMAND_STATUS_NOT_COMPLETION_OR_LAUNCH_CAUSE'}


def commands(directory):
    result = unknown()
    try:
        spec = importlib.util.spec_from_file_location('startup_private_json',
            Path(__file__).with_name('maestro_failure_snapshot.py'))
        reader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(reader)
        path = reader.commands_file(directory)
        if path.parent != directory / FLOW:
            return result
        source = reader.read_json(path, directory)
        if type(source) is not list or not 1 <= len(source) <= 64:
            return result
        rows, previous = [], -1
        fields = {'status', 'timestamp', 'duration', 'error', 'sequenceNumber',
                  'depth', 'evaluatedCommand', 'artifacts'}
        for item in source:
            if type(item) is not dict or set(item) != {'command', 'metadata'}:
                return result
            command, metadata = item['command'], item['metadata']
            if (type(command) is not dict or len(command) > 1 or
                    type(metadata) is not dict or not set(metadata) <= fields or
                    metadata.get('status') not in STATUSES):
                return result
            sequence = metadata.get('sequenceNumber')
            if type(sequence) is not int or not previous < sequence < 64:
                return result
            previous = sequence
            if type(metadata.get('depth', 0)) is not int or not 0 <= metadata.get('depth', 0) <= 8:
                return result
            for field in ('timestamp', 'duration'):
                if field in metadata and (type(metadata[field]) is not int or not 0 <= metadata[field] <= 10 ** 14):
                    return result
            error = metadata.get('error', {})
            if (type(error) is not dict or not set(error) <= {'message', 'debugMessage'} or
                    any(type(value) is not str for value in error.values())):
                return result
            text = '\n'.join(error.values())
            key = next(iter(command), None)
            kind = KINDS.get(key, 'OTHER')
            if key in ('launchAppCommand', 'clearStateCommand', 'stopAppCommand'):
                config = command[key]
                if type(config) is not dict or config.get('appId') not in (APP, '${APP_ID}'):
                    kind = 'OTHER'
                if 'evaluatedCommand' in metadata:
                    evaluated = metadata['evaluatedCommand']
                    if (type(evaluated) is not dict or set(evaluated) != {key} or
                            type(evaluated[key]) is not dict or evaluated[key].get('appId') != APP):
                        return result
            row = {'sequence': sequence, 'kind': kind,
                         'status': metadata['status'],
                         'error_markers': [label for label, pattern in ERROR_MARKERS.items()
                                           if re.search(pattern, text, re.IGNORECASE)]}
            if kind == 'LAUNCH_APP' and metadata['status'] == 'FAILED':
                row['launch_error_codes'] = launch_error_codes(error)
            rows.append(row)
        result.update(state='RECORDED', rows=rows)
    except (OSError, ValueError, TypeError, RecursionError):
        pass
    return result


def process_entries(payload):
    """Select only the exact owned app's UIKitApplication service label."""
    result = {'state': 'UNKNOWN', 'scope': 'POST_FAILURE_SERVICE_ENTRY_NOT_LAUNCH_HISTORY',
              'owned_entry_count': None}
    if type(payload) is not bytes or len(payload) > LIMIT:
        return result
    try:
        lines = payload.decode('utf-8').splitlines()
    except UnicodeDecodeError:
        return result
    if not lines or not re.fullmatch(r'PID\s+Status\s+Label', lines[0]):
        return result
    found = []
    label = r'UIKitApplication:' + re.escape(APP) + r'(?:\[[A-Za-z0-9_.:-]{1,128}\]){0,3}'
    for line in lines[1:]:
        row = re.fullmatch(r'(-|[1-9][0-9]{0,9})\s+(-?[0-9]{1,10})\s+(\S+)', line)
        if not row:
            return result
        if re.fullmatch(label, row[3]):
            found.append(row[1] != '-')
    if len(found) > 1:
        return result
    result.update(owned_entry_count=len(found), state=(
        'OWNED_RUNNING_ENTRY_OBSERVED' if found == [True] else
        'OWNED_NONRUNNING_ENTRY_OBSERVED' if found == [False] else
        'NO_OWNED_ENTRY_OBSERVED'))
    return result


def process(private, device):
    result = {'state': 'UNKNOWN', 'scope': 'POST_FAILURE_SERVICE_ENTRY_NOT_LAUNCH_HISTORY',
              'owned_entry_count': None, 'query': 'NOT_RUN'}
    if type(device) is not str or not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', device):
        return result
    try:
        # An unnamed private file is never in an upload glob and closes even
        # on timeout. Query the simulator service manager; do not launch an app.
        with tempfile.TemporaryFile(dir=private) as output:
            outcome = subprocess.run(['xcrun', 'simctl', 'spawn', device, 'launchctl', 'list'],
                stdout=output, stderr=subprocess.DEVNULL, timeout=15, check=False)
            if outcome.returncode != 0:
                return {**result, 'query': 'NONZERO_EXIT'}
            output.seek(0)
            return {**process_entries(output.read(LIMIT + 1)), 'query': 'EXIT_ZERO'}
    except subprocess.TimeoutExpired:
        return {**result, 'query': 'TIMEOUT'}
    except OSError:
        return {**result, 'query': 'UNAVAILABLE'}


def launch_services_unknown():
    return {'state': 'UNKNOWN', 'query': 'NOT_RUN', 'matching_records': 0, 'rows': [],
            'input_partial': False, 'scope': 'OWNED_TIME_BOUND_SYSTEM_LOG_MARKERS_NOT_CAUSE_OR_ACCEPTANCE'}


def launch_window(started_ms, ended_ms):
    return (type(started_ms) is int and type(ended_ms) is int and
            0 <= started_ms < ended_ms <= 10 ** 14 and ended_ms - started_ms <= 900000)


def launch_service_records(payload, started_ms, ended_ms):
    result = launch_services_unknown()
    if not launch_window(started_ms, ended_ms) or type(payload) is not bytes:
        return result
    if len(payload) > LIMIT:
        return {**result, 'input_partial': True}
    try:
        def unique(pairs):
            value = {}
            for key, item in pairs:
                if key in value:
                    raise ValueError('Duplicate log key.')
                value[key] = item
            return value
        records = json.loads(payload.decode('utf-8'), object_pairs_hook=unique,
            parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite log value.')))
        if type(records) is not list:
            return result
        result['input_partial'] = len(records) > 512
        for record in records[:512]:
            if type(record) is not dict:
                result['input_partial'] = True
                continue
            path, message, timestamp = (record.get(key) for key in
                ('processImagePath', 'eventMessage', 'timestamp'))
            if (type(path) is not str or not path.startswith('/') or
                    Path(path).name not in LAUNCH_SERVICES or type(message) is not str or
                    len(message) > 16384 or type(timestamp) is not str or
                    not re.fullmatch(r'\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})', timestamp)):
                continue
            try:
                instant = datetime.fromisoformat(timestamp.replace('Z', '+00:00')).timestamp() * 1000
            except (ValueError, OverflowError):
                continue
            if (not started_ms <= instant <= ended_ms or not re.search(
                    r'(?<![A-Za-z0-9_.-])' + re.escape(APP) + r'(?![A-Za-z0-9_.-])', message)):
                continue
            result['matching_records'] += 1
            pairs = []
            for domain, code in re.findall(
                    r'(?:Error Domain=|domain[=:]\s*)([A-Za-z][A-Za-z0-9.]{0,95})(?:;\s*|\s+|,\s*)[Cc]ode[=:]\s*(-?(?:0|[1-9][0-9]{0,9}))\b', message):
                if domain in ERROR_DOMAINS | {'OSLaunchdErrorDomain'} and -(2 ** 31) <= int(code) < 2 ** 31:
                    pair = {'domain': domain, 'code': int(code)}
                    if pair not in pairs and len(pairs) < 8:
                        pairs.append(pair)
            markers = [name for name, pattern in LAUNCH_MARKERS.items()
                if re.search(pattern, message, re.IGNORECASE)]
            if (pairs or markers) and len(result['rows']) < 32:
                result['rows'].append({'service': Path(path).name, 'codes': pairs, 'markers': markers})
            elif pairs or markers:
                result['input_partial'] = True
        if result['matching_records']:
            result['state'] = 'RECORDED'
    except (ValueError, UnicodeDecodeError, RecursionError):
        return launch_services_unknown()
    return result


def launch_services(private, device, started_ms, ended_ms):
    result = launch_services_unknown()
    if (not launch_window(started_ms, ended_ms) or type(device) is not str or
            not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', device)):
        return result
    predicate = '(' + ' OR '.join('process == "%s"' % value for value in sorted(LAUNCH_SERVICES))
    predicate += ') AND eventMessage CONTAINS "%s"' % APP
    try:
        args = ['xcrun', 'simctl', 'spawn', device, 'log', 'show', '--info', '--style', 'json',
            '--start', datetime.fromtimestamp(started_ms / 1000).strftime('%Y-%m-%d %H:%M:%S'),
            '--end', datetime.fromtimestamp((ended_ms + 999) // 1000).strftime('%Y-%m-%d %H:%M:%S'),
            '--predicate', predicate]
        with tempfile.TemporaryFile(dir=private) as output:
            outcome = subprocess.run(args, stdout=output, stderr=subprocess.DEVNULL, timeout=20, check=False)
            if outcome.returncode != 0:
                return {**result, 'query': 'NONZERO_EXIT'}
            output.seek(0)
            return {**launch_service_records(output.read(LIMIT + 1), started_ms, ended_ms), 'query': 'EXIT_ZERO'}
    except subprocess.TimeoutExpired:
        return {**result, 'query': 'TIMEOUT'}
    except (OSError, ValueError, OverflowError):
        return {**result, 'query': 'UNAVAILABLE'}


def collect(private, device, started_ms=None, ended_ms=None):
    return {'schema': 1, 'commands': commands(private / 'maestro-output'),
            'process': process(private, device),
            'launch_services': launch_services(private, device, started_ms, ended_ms),
            'scope': 'FAILURE_ONLY_OBSERVATIONS_NOT_NATIVE_ACCEPTANCE_OR_CAUSE'}
