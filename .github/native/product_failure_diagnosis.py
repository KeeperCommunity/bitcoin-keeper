"""Read existing failed-sample files; export fixed observations, never raw text."""
from itertools import islice
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import unicodedata
import xml.etree.ElementTree as ET

FILE_LIMIT = 1024 * 1024
METRO_LIMIT = 256 * 1024
SNAPSHOT_LIMIT = 8
NODE_LIMIT = 10000
FLOWS = ('product_first_wallet.yaml', 'product_retry.yaml')
IDS = {'btn_skip': 'onboarding_skip', 'view_startNewTile': 'start_new_tile',
       'view_recoverTile': 'recover_tile', 'btn_AppSettingsIcon': 'app_settings'}
TEXT = {'Start New': 'start_new_text', 'Welcome to Bitcoin Keeper': 'welcome',
        'Create a passcode': 'create_passcode', 'Confirm your passcode': 'confirm_passcode',
        'Enter your passcode': 'login', 'Welcome Back': 'welcome_back',
        'Unable to check your passcode. Please try again.': 'credential_error', 'Retry': 'retry',
        'Dismiss': 'dismiss_control', 'Minimize': 'minimize_control',
        'Allow': 'allow_control', "Don't Allow": 'dont_allow_control',
        'Don’t Allow': 'dont_allow_control'}
LOGBOX = ('Console Error', 'Uncaught Error', 'Syntax Error', 'Render Error', 'Failed to compile')
FLAGS = tuple(dict.fromkeys((*IDS.values(), *TEXT.values(), 'logbox_error_header',
    'logbox_warning_header', 'logbox_counter', 'logbox_controls', 'logbox_syntax_footer',
    'notification_prompt_phrase', 'notification_permission_controls')))
SELECTORS = {**{f'id: {key}': value for key, value in IDS.items()},
             **{f'"{key}"': value for key, value in TEXT.items()
                if value in ('create_passcode', 'confirm_passcode', 'login', 'retry')}}
FAULTS = {'JS_TYPE_ERROR': r'\bTypeError\b', 'JS_REFERENCE_ERROR': r'\bReferenceError\b',
    'JS_SYNTAX_ERROR': r'\bSyntaxError\b', 'MODULE_RESOLUTION_ERROR': r'Unable to resolve module|\bUnableToResolveError\b',
    'TRANSFORM_ERROR': r'\bTransformError\b', 'APP_NOT_REGISTERED': r'has not been registered',
    'NATIVE_MODULE_UNAVAILABLE': r'TurboModuleRegistry\.getEnforcing|requireNativeComponent|native module cannot be null',
    'MEMORY_EXHAUSTION': r'out of memory|heap limit|heap out of memory',
    'TRANSPORT_ERROR': r'\b(?:EADDRINUSE|ECONNREFUSED|ECONNRESET)\b',
    'FILESYSTEM_ERROR': r'\b(?:ENOENT|EACCES|ENOSPC)\b'}


def regular(path, root):
    root, path = Path(root), Path(path)
    if root.is_symlink() or not root.is_dir() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError()
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError()
        if part == root:
            break
    info = path.stat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError()
    return info


def read(path, root):
    regular(path, root)
    with path.open('rb') as source:
        payload = source.read(FILE_LIMIT + 1)
    if len(payload) > FILE_LIMIT:
        raise ValueError()
    return payload


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def junit(directory, flow):
    result = {'state': 'UNKNOWN', 'failed_selector': None, 'failure_kind': None}
    try:
        if flow not in FLOWS:
            return result
        payload = read(directory / 'junit.xml', directory).decode('utf-8-sig')
        if '<!DOCTYPE' in payload.upper() or '<!ENTITY' in payload.upper():
            return result
        root = ET.fromstring(payload)
        suites = list(root)
        cases = list(root.iter('testcase'))
        failures = list(root.iter('failure'))
        if (root.tag != 'testsuites' or len(suites) != 1 or suites[0].tag != 'testsuite' or
                len(list(root.iter('testsuite'))) != 1 or len(cases) != 1 or
                suites[0].findall('testcase') != cases or len(failures) != 1 or
                cases[0].get('file') != '.github/native/' + flow or cases[0].get('status') != 'ERROR' or
                list(cases[0]).count(failures[0]) != 1 or failures[0].attrib or list(failures[0])):
            return result
        # Maestro 2.11 JUnit stores the exception message as failure XML text.
        # A complete first line must equal the source-defined assertion format.
        first = [(failures[0].text or '').split('\n', 1)[0].removesuffix('\r')]
        result['state'] = 'ERROR_RECORDED'
        for selector, label in SELECTORS.items():
            if first == ['Assertion is false: ' + selector + ' is visible']:
                result.update(failed_selector=label, failure_kind='ASSERT_VISIBLE')
            elif first == ['Element not found: ' + ('Id matching regex: ' + selector[4:]
                         if selector.startswith('id: ') else 'Text matching regex: ' + selector[1:-1])]:
                result.update(failed_selector=label, failure_kind='ELEMENT_NOT_FOUND')
    except (OSError, ValueError, TypeError, ET.ParseError):
        pass
    return result


def hierarchy(directory):
    result = {'state': 'UNKNOWN', 'snapshot_count': 0, 'node_count': 0,
              'rejected_snapshots': 0, 'snapshot_limit_exceeded': False,
              'scope': 'ANY_RETAINED_SNAPSHOT_NOT_FINAL_ROUTE_OR_VISIBILITY_PROOF',
              'flags': dict.fromkeys(FLAGS)}
    observed = dict.fromkeys(FLAGS, False)
    try:
        if directory.is_symlink() or not directory.is_dir():
            return result
        paths = list(islice(directory.glob('**/screen-hierarchy/step-*.json'), SNAPSHOT_LIMIT + 1))
        result['snapshot_limit_exceeded'] = len(paths) > SNAPSHOT_LIMIT
        for path in sorted(paths[:SNAPSHOT_LIMIT]):
            try:
                pending = [(json.loads(read(path, directory), object_pairs_hook=unique_object), 0)]
                count, found = 0, dict.fromkeys(FLAGS, False)
                while pending:
                    node, depth = pending.pop()
                    count += 1
                    if count > NODE_LIMIT or depth > 128 or not isinstance(node, dict):
                        raise ValueError()
                    attrs, children = node.get('attributes', {}), node.get('children', [])
                    if (not isinstance(attrs, dict) or not isinstance(children, list) or
                            any(not isinstance(key, str) or not isinstance(value, str) for key, value in attrs.items())):
                        raise ValueError()
                    resource = attrs.get('resource-id')
                    if isinstance(resource, str):
                        resource = resource.removeprefix('io.hexawallet.keeper.development:id/')
                        if resource in IDS:
                            found[IDS[resource]] = True
                    for key in ('text', 'accessibilityText', 'title', 'value'):
                        value = attrs.get(key)
                        if not isinstance(value, str):
                            continue
                        value = value.strip()
                        if value in TEXT:
                            found[TEXT[value]] = True
                        found['logbox_error_header'] |= value in LOGBOX
                        found['logbox_warning_header'] |= value == 'Console Warning'
                        found['logbox_counter'] |= bool(re.fullmatch(r'Log [1-9]\d* of [1-9]\d*', value))
                        found['logbox_syntax_footer'] |= value == 'This error cannot be dismissed.'
                        found['notification_prompt_phrase'] |= 'would like to send you notifications' in value.lower()
                    pending.extend((child, depth + 1) for child in children)
                found['logbox_controls'] = found['dismiss_control'] and found['minimize_control']
                found['notification_permission_controls'] = (found['notification_prompt_phrase'] and
                    found['allow_control'] and found['dont_allow_control'])
                result['snapshot_count'] += 1
                result['node_count'] += count
                observed = {key: observed[key] or found[key] for key in FLAGS}
            except (OSError, ValueError, TypeError, RecursionError):
                result['rejected_snapshots'] += 1
        if result['snapshot_count']:
            complete = not result['rejected_snapshots'] and not result['snapshot_limit_exceeded']
            result['state'] = 'COMPLETE' if complete else 'PARTIAL'
            result['flags'] = {key: value if value or complete else None for key, value in observed.items()}
    except OSError:
        pass
    return result


class MetroBinding:
    def __init__(self, metro):
        count = len(metro.events)
        if (metro.phase != 'product' or not count or metro.events[-1].get('phase') != 'product' or
                not any(child is metro.process for child in metro.owned)):
            raise ValueError()
        self.process, self.count, self.root = metro.process, count, Path(metro.private)
        self.path = self.root / ('metro-%02d.log' % count)
        regular(self.path, self.root)
        with self.path.open('rb') as source:
            info = os.fstat(source.fileno())
            self.identity, self.offset = (info.st_dev, info.st_ino), info.st_size
            source.seek(max(0, self.offset - 1))
            self.partial_start = bool(self.offset and source.read(1) != b'\n')


def bind_metro(metro):
    try:
        return MetroBinding(metro)
    except Exception:
        return None


def metro_window(metro, binding):
    result = {'state': 'UNKNOWN', 'scope': 'Bound product-sample console window; markers are not cause or request proof.',
              'process_state': 'UNKNOWN', 'exit_code': None}
    try:
        if (binding is None or metro.phase != 'product' or metro.process is not binding.process or
                len(metro.events) != binding.count or metro.events[-1].get('phase') != 'product' or
                Path(metro.private) != binding.root or not any(child is binding.process for child in metro.owned)):
            return result
        try:
            code = binding.process.poll()
            if code is None:
                result['process_state'] = 'ALIVE'
            elif type(code) is int:
                result.update(process_state='EXITED', exit_code=code)
        except Exception:
            pass
        info = regular(binding.path, binding.root)
        if (info.st_dev, info.st_ino) != binding.identity or info.st_size < binding.offset:
            return result
        end, start = info.st_size, max(binding.offset, info.st_size - METRO_LIMIT)
        with binding.path.open('rb') as source:
            current = source.fileno()
            opened = os.fstat(current)
            if (opened.st_dev, opened.st_ino) != binding.identity:
                return result
            source.seek(start)
            payload = source.read(end - start)
            after = os.fstat(current)
        current = regular(binding.path, binding.root)
        if (len(payload) != end - start or min(after.st_size, current.st_size) < end or
                (current.st_dev, current.st_ino) != binding.identity):
            return result
        partial_start = binding.partial_start or start > binding.offset
        partial_end = bool(payload and not payload.endswith(b'\n'))
        if partial_end:
            payload = payload[:payload.rfind(b'\n') + 1] if b'\n' in payload else b''
        if partial_start:
            payload = payload.split(b'\n', 1)[1] if b'\n' in payload else b''
        grew = max(after.st_size, current.st_size) > end
        result.update(state='PARTIAL' if partial_start or partial_end or start > binding.offset or grew else 'COMPLETE',
            bytes_appended=end - binding.offset, bytes_read=end - start, bytes_scanned=len(payload),
            input_truncated=start > binding.offset, partial_start=partial_start, partial_end=partial_end,
            growth_detected=grew, complete_lines=payload.count(b'\n'))
        categories, headers, unknown, valid, invalid = set(), 0, 0, 0, 0
        for raw in payload.split(b'\n')[:-1]:
            try:
                line = raw.removesuffix(b'\r').decode('utf-8')
                line = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', line)
                if any(unicodedata.category(char) in ('Cc', 'Zl', 'Zp') and char != '\t' for char in line):
                    raise ValueError()
            except (UnicodeError, ValueError):
                invalid += 1
                continue
            valid += 1
            line = line.strip()
            if not re.match(r'^(?:ERROR\b|FATAL ERROR:|\w*Error:|Unable to resolve module)', line, re.IGNORECASE):
                continue
            headers += 1
            found = [key for key, pattern in FAULTS.items() if re.search(pattern, line, re.IGNORECASE)]
            categories.update(found)
            unknown += not bool(found)
        if invalid:
            result['state'] = 'PARTIAL' if valid else 'UNKNOWN'
        result.update(error_headers=headers, unclassified_error_headers=unknown,
                      valid_records=valid, invalid_records=invalid,
                      fault_categories=[key for key in FAULTS if key in categories])
    except Exception:
        pass
    return result


def failed_assertion_snapshot(directory, flow, failure):
    try:
        spec = importlib.util.spec_from_file_location('maestro_failure_snapshot',
            Path(__file__).with_name('maestro_failure_snapshot.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.collect(directory, flow, failure)
    except Exception:
        return {'schema': 1, 'binding_state': 'UNKNOWN', 'reason': 'COLLECTOR_UNAVAILABLE',
                'scope': 'POST_FAILED_ASSERT_OUTCOME_NOT_TAP_TIME'}


def collect(directory, flow, metro, binding=None):
    directory = Path(directory)
    return {'scope': 'Failed-sample files and bound owned Metro only; observations do not prove current visibility, route, tap delivery or cause.',
            'junit': junit(directory, flow), 'hierarchy': hierarchy(directory),
            'product_metro': metro_window(metro, binding)}
