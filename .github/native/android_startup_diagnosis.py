"""Read-only Android startup facts. No raw device or application text escapes."""
from pathlib import Path
import re
import shutil
import subprocess

APP = 'io.hexawallet.keeper.development'
LIMIT = 256 * 1024
TYPES = ('TypeError', 'SyntaxError', 'ReferenceError', 'RangeError', 'EvalError',
         'URIError', 'AggregateError', 'TransformError', 'UnableToResolveError',
         'InternalError', 'RuntimeException', 'IllegalStateException',
         'IllegalArgumentException', 'NullPointerException', 'SecurityException',
         'UnsatisfiedLinkError', 'NoClassDefFoundError', 'ClassNotFoundException',
         'OutOfMemoryError', 'Error')
FAULTS = {
    'JS_TYPE_ERROR': r'\bTypeError\b|undefined is not a function',
    'JS_SYNTAX_ERROR': r'\bSyntaxError\b',
    'JS_REFERENCE_ERROR': r'\bReferenceError\b',
    'JS_RANGE_ERROR': r'\bRangeError\b',
    'MODULE_RESOLUTION_ERROR': r'Unable to resolve module|\bUnableToResolveError\b',
    'TRANSFORM_ERROR': r'\bTransformError\b',
    'APP_NOT_REGISTERED': r'has not been registered',
    'NATIVE_MODULE_UNAVAILABLE': r'TurboModuleRegistry\.getEnforcing|requireNativeComponent|native module cannot be null',
    'NATIVE_LIBRARY_LOAD_ERROR': r'\bUnsatisfiedLinkError\b|dlopen failed|could not load library',
    'NATIVE_FATAL_SIGNAL': r'Fatal signal \d+\b',
    'JAVA_FATAL_EXCEPTION': r'FATAL EXCEPTION:',
    'MEMORY_EXHAUSTION': r'\bOutOfMemoryError\b|out of memory',
    'TRANSPORT_ERROR': r'\b(?:EADDRINUSE|ECONNREFUSED|ECONNRESET)\b',
    'FILESYSTEM_ERROR': r'\b(?:ENOENT|EACCES|ENOSPC)\b',
    'WORKER_HEAP_EXHAUSTION': r'JavaScript heap out of memory|Reached heap limit|Ineffective mark-compacts',
    'PROCESS_KILLED_MARKER': r'\bSIGKILL\b|worker process.*terminated|worker.*killed',
}
EXIT_REASONS = {0: 'UNKNOWN', 1: 'EXIT_SELF', 2: 'SIGNALED', 3: 'LOW_MEMORY',
                4: 'JAVA_CRASH', 5: 'NATIVE_CRASH', 6: 'ANR', 7: 'INITIALIZATION_FAILURE',
                8: 'PERMISSION_CHANGE', 9: 'EXCESSIVE_RESOURCE_USAGE',
                10: 'USER_REQUESTED', 11: 'USER_STOPPED', 12: 'DEPENDENCY_DIED',
                13: 'OTHER', 14: 'FREEZER', 15: 'PACKAGE_STATE_CHANGE', 16: 'PACKAGE_UPDATED'}


def safe_error(error):
    name = type(error).__name__
    return name if name in {'OSError', 'FileNotFoundError', 'PermissionError',
                           'TimeoutExpired', 'ValueError', 'TypeError'} else 'OTHER_ERROR'


def bounded(path, private):
    if path.is_symlink() or not path.resolve().is_relative_to(private.resolve()):
        raise ValueError('Expected a private regular file.')
    size = path.stat().st_size
    with path.open('rb') as source:
        prefix = source.read(LIMIT)
        tail = b''
        if size > LIMIT:
            source.seek(max(LIMIT, size - LIMIT))
            tail = source.read(LIMIT)
    truncated = size > len(prefix) + len(tail)
    if truncated:
        prefix = prefix.rsplit(b'\n', 1)[0] if b'\n' in prefix else b''
        tail = tail.split(b'\n', 1)[1] if b'\n' in tail else b''
    return (prefix + (b'\n' if truncated else b'') + tail).decode(errors='replace'), {
        'bytes_observed': size, 'bytes_read': len(prefix) + len(tail),
        'input_truncated': truncated, 'read_scope': 'PREFIX_AND_TAIL' if truncated else 'FULL'}


def faults(payload):
    return {'exception_types': [kind for kind in TYPES if re.search(r'\b' + kind + r'\b', payload)],
            'fault_categories': [name for name, pattern in FAULTS.items()
                                 if re.search(pattern, payload, re.IGNORECASE)]}


def processes(payload, usable=True):
    lines = [line.strip() for line in payload.splitlines() if line.strip()]
    result = {'state': 'UNKNOWN', 'matching_process_count': None, 'parsed_records': 0,
              'unparsed_records': 0}
    owned = set()
    seen = set()
    if not usable or not lines or lines[0].split() != ['PID', 'NAME']:
        return result, owned
    for line in lines[1:]:
        match = re.fullmatch(r'([1-9]\d*)\s+(\S+)', line)
        if not match or int(match[1]) in seen:
            result['unparsed_records'] += 1
            continue
        seen.add(int(match[1]))
        result['parsed_records'] += 1
        if match[2] == APP or match[2].startswith(APP + ':'):
            owned.add(int(match[1]))
    if result['unparsed_records'] == 0 and result['parsed_records'] > 0:
        result.update(state='PRESENT' if owned else 'ABSENT', matching_process_count=len(owned))
    else:
        owned.clear()  # Malformed inventory cannot establish process attribution.
    return result, owned


def foreground(payload, usable=True):
    relations = set()
    parsed, unparsed = 0, 0
    if usable:
        for line in payload.splitlines():
            if not re.search(r'\b(?:topResumedActivity|mResumedActivity)\s*[:=]', line):
                continue
            if re.search(r'[:=]\s*(?:null|None)\s*$', line):
                relations.add('NONE')
                parsed += 1
            elif match := re.search(r'ActivityRecord\{.*?\bu\d+\s+([A-Za-z0-9_.]+)/(?:[^\s}]+)', line):
                relations.add('OWN_APP' if match[1] == APP else 'OTHER_APP')
                parsed += 1
            else:
                unparsed += 1
    return {'relation': next(iter(relations)) if len(relations) == 1 and not unparsed else 'UNKNOWN',
            'parsed_records': parsed, 'unparsed_records': unparsed,
            'scope': 'RESUMED_ACTIVITY_ONLY_NOT_WINDOW_VISIBILITY'}


def exit_history(payload, usable=True):
    reasons = []
    matched = 0
    if usable:
        for line in payload.splitlines():
            match = re.search(r'\bprocess=(\S+)\s+reason=(\d+)\s', line)
            if match and (match[1] == APP or match[1].startswith(APP + ':')):
                matched += 1
                reason = EXIT_REASONS.get(int(match[2]), 'UNRECOGNIZED_REASON')
                if reason not in reasons:
                    reasons.append(reason)
    return {'matching_records': matched, 'reason_categories': reasons,
            'parse_status': 'PARSED' if matched else 'UNKNOWN',
            'freshness': 'UNKNOWN', 'scope': 'APP_HISTORY_NOT_PROOF_OF_CURRENT_FAILURE_CAUSE'}


def android_log(payload, owned):
    result = {'parsed_error_records': 0, 'own_error_records': 0, 'unclassified_own_error_records': 0,
              'unparsed_nonempty_lines': 0, 'exception_types': [], 'fault_categories': [],
              'attribution': 'CURRENT_OWN_PID_MATCH_HISTORY_FRESHNESS_UNKNOWN' if owned
                             else 'UNKNOWN_NO_CURRENT_OWN_PROCESS'}
    pattern = r'^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+\s+(\d+)\s+\d+\s+[EF]\s+[^:]+:\s*(.*)$'
    for line in payload.splitlines():
        match = re.match(pattern, line)
        if not match:
            if line.strip() and not line.startswith('--------- beginning of '):
                result['unparsed_nonempty_lines'] += 1
            continue
        result['parsed_error_records'] += 1
        if int(match[1]) not in owned:
            continue
        result['own_error_records'] += 1
        observed = faults(match[2])
        if not any(observed.values()):
            result['unclassified_own_error_records'] += 1
        for key in observed:
            result[key] = list(dict.fromkeys(result[key] + observed[key]))
    return result


def metro(payload):
    selected = []
    headers, remaining = 0, 0
    for raw in payload.splitlines():
        line = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', raw).strip()
        if re.match(r'^(?:ERROR\b|FATAL ERROR:|(?:\w*Error):|Unable to resolve module)', line, re.IGNORECASE):
            headers += 1
            remaining = 4
        elif remaining:
            remaining -= 1
        else:
            continue
        if re.match(r'^(?:(?:>\s*)?\d+\s*\||\^|at\s)', line):
            continue
        selected.append(line)
    return {'observed_error_headers': headers, 'scanned_error_context_lines': len(selected),
            'unclassified_error_context_lines': sum(not faults(line)['fault_categories'] for line in selected),
            **faults('\n'.join(selected)), 'scope': 'ERROR_MARKERS_NOT_BUNDLE_OR_STARTUP_ACCEPTANCE'}


def host_memory(root=Path('/')):
    result = {'scope': 'HOST_SNAPSHOT_AND_HISTORICAL_CGROUP_EVENTS_NOT_FAILURE_CAUSE',
              'meminfo': {'lookup_status': 'UNKNOWN'}, 'cgroup': {}}

    def small(path):
        with path.open('rb') as source:
            value = source.read(8193)
        if len(value) > 8192:
            raise ValueError('Memory record exceeded size limit.')
        return value.decode('ascii').strip()

    try:
        payload = small(root / 'proc/meminfo')
        matches = re.findall(r'^(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+(\d+) kB$', payload, re.MULTILINE)
        fields = dict(matches)
        recognized = sum(bool(re.match(r'^(?:MemTotal|MemAvailable|SwapTotal|SwapFree)\b', line))
                         for line in payload.splitlines())
        if len(fields) == len(matches) == recognized == 4:
            result['meminfo'] = {'lookup_status': 'SUCCESS',
                                 'bytes': {name: int(value) * 1024 for name, value in fields.items()}}
    except Exception as error:
        result['meminfo']['error_type'] = safe_error(error)
    for name in ['memory.current', 'memory.max', 'memory.events']:
        observed = {'lookup_status': 'UNKNOWN'}
        try:
            value = small(root / 'sys/fs/cgroup' / name)
            if name == 'memory.events':
                matches = re.findall(r'^(oom|oom_kill) (\d+)$', value, re.MULTILINE)
                events = dict(matches)
                recognized = sum(bool(re.match(r'^(?:oom|oom_kill)\b', line)) for line in value.splitlines())
                if len(events) == len(matches) == recognized == 2:
                    observed = {'lookup_status': 'SUCCESS', 'counts': {k: int(v) for k, v in events.items()}}
            elif value.isascii() and value.isdecimal():
                observed = {'lookup_status': 'SUCCESS', 'bytes': int(value)}
            elif name == 'memory.max' and value == 'max':
                observed = {'lookup_status': 'SUCCESS', 'limit': 'UNLIMITED'}
        except Exception as error:
            observed['error_type'] = safe_error(error)
        result['cgroup'][name] = observed
    return result


def collect(private, device):
    private = Path(private)
    if not re.fullmatch(r'emulator-\d+', device):
        raise ValueError('Expected the owned emulator selector.')
    work = private / 'android-startup-diagnosis'
    work.mkdir(mode=0o700)
    result = {'diagnostic_only': True, 'cause': 'UNDETERMINED', 'host_memory': host_memory(), 'commands': [],
              'collection_errors': [], 'cleanup_status': 'UNKNOWN'}

    def capture(label, arguments):
        path = work / (label + '.log')
        facts = {'label': label, 'lookup_status': 'UNKNOWN', 'exit_code': None,
                 'bytes_observed': None, 'bytes_read': 0, 'input_truncated': None, 'read_scope': 'NOT_READ'}
        payload = ''
        try:
            with path.open('xb') as output:
                proc = subprocess.run(['adb', '-s', device, *arguments], stdout=output,
                                      stderr=subprocess.STDOUT, timeout=15, check=False)
            facts['exit_code'] = proc.returncode
            payload, observed = bounded(path, private)
            facts.update(observed)
            if proc.returncode == 0:
                facts['lookup_status'] = 'SUCCESS'
            else:
                payload = ''
        except Exception as error:
            facts['error_type'] = safe_error(error)
            payload = ''
        finally:
            path.unlink(missing_ok=True)
        result['commands'].append(facts)
        return payload, facts.get('lookup_status') == 'SUCCESS' and not facts.get('input_truncated', True)

    try:
        payload, usable = capture('processes', ['shell', 'ps', '-A', '-o', 'PID,NAME'])
        result['processes'], owned = processes(payload, usable)
        payload, usable = capture('foreground', ['shell', 'dumpsys', 'activity', 'activities'])
        result['foreground_activity'] = foreground(payload, usable)
        payload, usable = capture('exit-history', ['shell', 'dumpsys', 'activity', 'exit-info', APP])
        result['exit_history'] = exit_history(payload, usable)
        payload, _ = capture('runtime-errors', ['logcat', '-d', '-b', 'main', '-b', 'crash',
                                               '-t', '1200', '-v', 'threadtime', '*:E'])
        result['runtime_errors'] = android_log(payload, owned)
        result['runtime_errors'].update(
            lookup_status=result['commands'][-1]['lookup_status'],
            input_truncated=result['commands'][-1]['input_truncated'])
        try:
            payload, observed = bounded(private / 'metro.log', private)
            result['metro'] = {'lookup_status': 'SUCCESS', **observed, **metro(payload)}
        except Exception as error:
            result['collection_errors'].append({'stage': 'metro', 'error_type': safe_error(error)})
    finally:
        try:
            shutil.rmtree(work)
            result['cleanup_status'] = 'DELETED'
        except Exception as error:
            result['collection_errors'].append({'stage': 'cleanup', 'error_type': safe_error(error)})
    return result
