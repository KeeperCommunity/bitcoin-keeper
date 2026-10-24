"""Private launch-window capture and fixed Android startup facts only."""
import json
import os
import re
import subprocess
import time

APP = 'io.hexawallet.keeper.development'
LOGBOX_IDS = {'redbox-error', 'redbox-dismiss', 'redbox-reload', 'rn_redbox_stack', 'catalyst_redbox_title'}
CATEGORIES = {
    'JS_TYPE': r'\bTypeError\b', 'JS_REFERENCE': r'\bReferenceError\b', 'JS_SYNTAX': r'\bSyntaxError\b',
    'JS_RANGE': r'\bRangeError\b', 'JS_INVARIANT': r'Invariant Violation|has not been registered',
    'MODULE_RESOLUTION': r'Unable to resolve module|Cannot find module',
    'NATIVE_MODULE_MISSING': r'TurboModuleRegistry.*could not be found|Native module cannot be null|Cannot find native module',
    'NATIVE_LIBRARY_LOAD': r'UnsatisfiedLinkError|dlopen failed|couldn.t find DSO',
    'BUNDLE_DOWNLOAD_FAILED': r'DebugServerException|Unable to load script|development server returned response error|Could not connect to development server',
    'CLEARTEXT_BLOCKED': r'CLEARTEXT communication.*not permitted',
    'CONNECTION_FAILED': r'ECONNREFUSED|Connection refused|SocketTimeoutException',
    'HOST_EXCEPTION': r'handleHostException|ReactNoCrashSoftException|Exception in native call',
    'FATAL_EXCEPTION': r'FATAL EXCEPTION|Fatal signal',
    'APP_ANR': r'ANR in ' + re.escape(APP),
}


def categories(text):
    return [name for name, pattern in CATEGORIES.items() if re.search(pattern, text, re.IGNORECASE)]


def _device(native, device):
    if native.PLATFORM != 'ANDROID' or not re.fullmatch(r'emulator-\d+', device):
        raise ValueError('Expected owned Android emulator.')


def _read(native, path):
    if path.is_symlink() or not path.resolve().is_relative_to(native.PRIVATE.resolve()):
        raise ValueError('Expected private diagnostic file.')
    with path.open('rb') as source:
        prefix = source.read(512 * 1024)
        source.seek(0, os.SEEK_END)
        size = source.tell()
        source.seek(max(len(prefix), size - 512 * 1024))
        tail = source.read(512 * 1024)
    return (prefix + (b'\n' if size > 1024 * 1024 else b'') + tail).decode(errors='replace'), size > 1024 * 1024


class Capture:
    def __init__(self, process, output, started_ms):
        self.process, self.output, self.started_ms = process, output, started_ms


def start(native, device):
    _device(native, device)
    native.PRIVATE.mkdir(parents=True, exist_ok=True)
    started_ms = int(time.time() * 1000)
    output = (native.PRIVATE / 'startup-logcat.log').open('wb')
    tags = ['AndroidRuntime:V', 'ReactNativeJS:V', 'ReactNative:V', 'ReactHost:V',
            'unknown:ReactHost:V', 'unknown:ReactNative:V', 'unknown:BridgelessReact:V',
            'ActivityManager:V', 'ActivityTaskManager:V', '*:S']
    try:
        process = subprocess.Popen(['adb', '-s', device, 'logcat', '-T', '1', '-v', 'brief',
                                    '-b', 'main', '-b', 'system', '-b', 'crash', *tags],
                                   stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        return Capture(process, output, started_ms)
    except Exception:
        output.close()
        raise


def stop(handle):
    if handle is None:
        return
    try:
        if handle.process.poll() is None:
            handle.process.terminate()
            try:
                handle.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                handle.process.kill()
                handle.process.wait(timeout=5)
    finally:
        handle.output.close()


def hierarchy(native, directory):
    flags = {'credential_error': False, 'retry': False, 'logbox_controls': False,
             'redbox_resource': False, 'loading': False, 'snapshot_count': 0}
    for path in list(directory.glob('**/screen-hierarchy/step-*.json'))[:8]:
        text, truncated = _read(native, path)
        if truncated:
            continue
        pending = [json.loads(text)]
        count, dismiss, minimize = 0, False, False
        while pending:
            node = pending.pop()
            count += 1
            if count > 10000 or not isinstance(node, dict):
                raise ValueError('Invalid bounded hierarchy.')
            attrs = node.get('attributes') or {}
            if not isinstance(attrs, dict) or not isinstance(node.get('children', []), list):
                raise ValueError('Invalid hierarchy shape.')
            resource = attrs.get('resource-id', '')
            flags['redbox_resource'] |= isinstance(resource, str) and resource.rsplit(':id/', 1)[-1] in LOGBOX_IDS
            for key in ['text', 'accessibilityText', 'title', 'value']:
                value = attrs.get(key)
                flags['credential_error'] |= value == 'Unable to check your passcode. Please try again.'
                flags['retry'] |= value == 'Retry'
                flags['loading'] |= value in ['please wait', 'loading']
                dismiss |= value == 'Dismiss'
                minimize |= value == 'Minimize'
            pending.extend(node.get('children', []))
        flags['snapshot_count'] += 1
        flags['logbox_controls'] |= dismiss and minimize
    return flags


def collect(native, device, handle=None):
    _device(native, device)
    started_ms = handle.started_ms if handle is not None else None
    facts = {'scope': 'Owned emulator launch window; fixed facts only.', 'collection_errors': []}
    def collect_one(name, action):
        try:
            facts[name] = action()
        except Exception:
            facts['collection_errors'].append(name)
    def logcat():
        text, truncated = _read(native, native.PRIVATE / 'startup-logcat.log')
        return {'categories': categories(text), 'input_truncated': truncated,
                'launch_window_started_ms': started_ms}
    def observer():
        # Fixed rows are regenerated, never forwarded from a writable JSON file.
        text, truncated = _read(native, native.PRIVATE / 'startup-observer.jsonl')
        rows, invalid = [], 0
        for line in text.splitlines()[:1024]:
            if not line.strip():
                continue
            try:
                row = json.loads(line)
                when = row.get('time_ms')
                if type(when) is not int or when < 0 or when > 10**14:
                    raise ValueError('Invalid timestamp.')
                result = {'stage': 'UNKNOWN' if started_ms is None else 'APP_WINDOW' if when >= started_ms else 'BEFORE_APP'}
                kind = row.get('kind')
                if (kind == 'BUILD' and row.get('event') in ['bundle_build_started', 'bundle_build_done', 'bundle_build_failed']) or (kind == 'ERROR' and row.get('event') in ['bundling_error', 'initialize_failed', 'transformer_load_failed', 'hmr_client_error', 'cache_read_error', 'cache_write_error', 'worker_stderr_chunk']):
                    result.update(kind=kind, event=row['event'])
                    result['error_type'] = row.get('error_type') if row.get('error_type') in ['SyntaxError', 'TypeError', 'ReferenceError', 'RangeError', 'TransformError', 'UnableToResolveError', 'ResolutionError', 'AmbiguousModuleResolutionError', 'NotFoundError', 'ResourceNotFoundError', 'GraphNotFoundError', 'RevisionNotFoundError', 'OTHER', None] else 'OTHER'
                    result['categories'] = [item for item in ['MODULE_RESOLUTION', 'SYNTAX', 'TYPE', 'REFERENCE', 'MEMORY', 'TRANSFORM', 'CONNECTION'] if item in row.get('categories', [])]
                elif kind in ['REQUEST', 'RESPONSE'] and row.get('request') in ['ENTRY_BUNDLE', 'SPLIT_BUNDLE', 'SYMBOLICATE']:
                    result.update(kind=kind, request=row['request'])
                    if kind == 'REQUEST':
                        options = row.get('options', {})
                        result['options'] = {key: options.get(key) if type(options.get(key)) is bool or options.get(key) in [None, 'OTHER'] else 'OTHER' for key in ['dev', 'lazy', 'minify', 'modulesOnly', 'runModule', 'excludeSource']}
                        for key, allowed in {'platform': ['android', 'ios'], 'sourcePaths': ['url-server', 'absolute'], 'engine': ['hermes', 'jsc'], 'app': ['EXPECTED']}.items():
                            result['options'][key] = options.get(key) if options.get(key) in [*allowed, None] else 'OTHER'
                    else:
                        code = row.get('outer_http_status')
                        result['outer_http_status'] = code if type(code) is int and 100 <= code <= 599 else None
                else:
                    raise ValueError('Invalid observation kind.')
                rows.append(result)
            except Exception:
                invalid += 1
        return {'rows': rows[:512], 'input_truncated': truncated, 'invalid_rows': invalid,
                'scope': 'Outer HTTP status only; multipart terminal status is not observed.'}
    def process():
        proc = subprocess.run(['adb', '-s', device, 'shell', 'pidof', APP], capture_output=True, timeout=10)
        present = proc.returncode == 0 and bool(re.fullmatch(rb'\s*\d+(?:\s+\d+)*\s*', proc.stdout))
        return {'exit_code': proc.returncode, 'alive': True if present else None,
                'scope': 'Positive observation only; failed or malformed queries do not establish absence.'}
    def foreground():
        path = native.PRIVATE / 'startup-foreground.log'
        with path.open('wb') as output:
            proc = subprocess.run(['adb', '-s', device, 'shell', 'dumpsys', 'activity', 'activities'], stdout=output, stderr=subprocess.STDOUT, timeout=10)
        text, truncated = _read(native, path)
        present = proc.returncode == 0 and not truncated and any(
            re.search(r'\b(?:mResumedActivity|topResumedActivity)\s*[:=]', line) and
            (match := re.search(r'ActivityRecord\{.*?\bu\d+\s+([A-Za-z0-9_.]+)/[^\s}]+', line)) and
            match[1] == APP for line in text.splitlines())
        return {'exit_code': proc.returncode, 'own_app_resumed': True if present else None,
                'input_truncated': truncated, 'scope': 'Positive observation only; absence is not inferred.'}
    for name, action in [('logcat', logcat), ('metro', observer), ('hierarchy', lambda: hierarchy(native, native.PRIVATE / 'maestro-output')), ('process', process), ('foreground', foreground)]:
        collect_one(name, action)
    return facts
