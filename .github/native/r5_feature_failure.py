"""Keep bounded existing probe results before failure cleanup; never acceptance."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import subprocess
import xml.etree.ElementTree as ET

SCOPE = 'FAILURE_ONLY_NATIVE_WORKER_OBSERVATIONS_NOT_ACCEPTANCE'
FRESHNESS = 'LAST_PERSISTED_PROCESS_UNKNOWN'
FAILURE_CODES = frozenset((
    'development-only', 'native-exception', 'schema-depth', 'unsupported-schema-property',
    'schema-missing', 'native-directory-missing', 'invalid-phase', 'relaunch-wallet-count',
    'relaunch-signer-count', 'relaunch-vault-count', 'fixture-not-fresh', 'offline-setup-ready',
    'key-failure-ready', 'retry-wallet-duplicate', 'retry-account-duplicate', 'first-wallet-clock',
    'retained-reference-accepted', 'retained-reference-deleted', 'partial-delete-accepted',
    'partial-delete-not-rolled-back', 'stale-session-accepted', 'stale-session-mutated',
    'unreferenced-delete-rejected', 'targeted-delete-wrong-record', 'other-native-account-mutated',
    'invalid-clock-measurement',
))
SELECTORS = ('r5-features-next', 'r5-features-pass', 'r5-features-failed')


def unknown_document(state='UNAVAILABLE'):
    return {'state': state, 'status': None, 'stage': None, 'failure_code': None,
            'measurement_count': None, 'last_persisted_iteration': None,
            'source_binding': 'UNVERIFIED'}


def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def project_document(raw, expected_sources, scenarios, limits):
    try:
        if (type(raw) is not str or len(raw.encode('utf-8')) > 65536 or '\ufffd' in raw or
                type(expected_sources) is not list or not expected_sources):
            raise ValueError()
        def invalid(_):
            raise ValueError()
        data = json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid)
        fields = {'schema', 'scope', 'status', 'stage', 'scenarios', 'measurements',
                  'limits', 'source_functions'}
        if (type(data) is not dict or not fields <= set(data) or
                not set(data) <= fields | {'failure'} or type(data['schema']) is not int or
                data['schema'] != 1 or data['scope'] != 'production-worker-native-storage' or
                data['stage'] not in ('failed', 'next', 'pass') or
                data['status'] != {'failed': 'FAIL', 'next': 'IN PROGRESS', 'pass': 'PASS'}[data['stage']] or
                data['limits'] != limits or data['source_functions'] != expected_sources):
            raise ValueError()
        stage = data['stage']
        expected = [{'id': name, 'status': 'FAIL' if stage == 'failed' else
                     'NOT RUN' if stage == 'next' and name == 'native-worker-process-relaunch-counts'
                     else 'PASS'} for name in scenarios]
        if data['scenarios'] != expected:
            raise ValueError()
        measurements = data['measurements']
        if (type(measurements) is not list or len(measurements) > 5 or
                stage == 'pass' and len(measurements) != 5 or
                stage == 'next' and not measurements or stage == 'failed' and measurements):
            raise ValueError()
        for index, row in enumerate(measurements, 1):
            if (type(row) is not dict or set(row) != {'iteration', 'probe_ready_ms', 'setup_first_wallet_ms'} or
                    type(row['iteration']) is not int or row['iteration'] != index):
                raise ValueError()
            for key in ('probe_ready_ms', 'setup_first_wallet_ms'):
                value = row[key]
                if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 600000:
                    raise ValueError()
        if ('failure' in data) != (stage == 'failed') or 'failure' in data and type(data['failure']) is not str:
            raise ValueError()
        return {'state': 'OBSERVED', 'status': data['status'], 'stage': stage,
                'failure_code': (data['failure'] if data['failure'] in FAILURE_CODES else 'UNKNOWN')
                    if stage == 'failed' else None,
                'measurement_count': len(measurements),
                # The failure wrapper replaces measurements with []; that
                # cannot identify which process/iteration failed.
                'last_persisted_iteration': None if stage == 'failed' else len(measurements),
                'source_binding': 'MATCH'}
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError):
        return unknown_document('INVALID')


def read_private(root, name, limit):
    """Single fixed leaf, no symlinks, bounded stable regular file owned by us."""
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        with os.fdopen(fd, 'rb') as source:
            before = os.fstat(source.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_size > limit:
                raise ValueError()
            raw = source.read(limit + 1)
            after = os.fstat(source.fileno())
            identity = lambda item: (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns)
            if len(raw) > limit or identity(before) != identity(after):
                raise ValueError()
            return raw.decode('utf-8')
    finally:
        os.close(directory)


def project_junit(raw):
    result = {'state': 'UNKNOWN', 'failed_selector': None, 'failure_kind': None}
    try:
        if len(raw.encode('utf-8')) > 1024 * 1024 or '<!DOCTYPE' in raw.upper() or '<!ENTITY' in raw.upper():
            return result
        root = ET.fromstring(raw)
        cases, failures = list(root.iter('testcase')), list(root.iter('failure'))
        if (root.tag != 'testsuites' or len(list(root)) != 1 or list(root)[0].tag != 'testsuite' or
                len(list(root.iter('testsuite'))) != 1 or len(cases) != 1 or
                list(root)[0].findall('testcase') != cases or
                cases[0].get('file') != '.github/native/r5_features.yaml' or len(failures) != 1 or
                cases[0].get('status') != 'ERROR' or list(cases[0]) != failures or
                failures[0].attrib or list(failures[0])):
            return result
        result['state'] = 'ERROR_RECORDED'
        first = (failures[0].text or '').split('\n', 1)[0].removesuffix('\r')
        for selector in SELECTORS:
            for description, kind in (
                    ('Assertion is false: id: ' + selector + ' is visible', 'ASSERT_VISIBLE'),
                    ('Assertion is false: id: ' + selector + ' is not visible', 'ASSERT_NOT_VISIBLE'),
                    ('Element not found: Id matching regex: ' + selector, 'ELEMENT_NOT_FOUND')):
                if first == description:
                    result.update(failed_selector=selector, failure_kind=kind)
        return result
    except (ValueError, TypeError, UnicodeError, ET.ParseError):
        return result


def expected_sources(h):
    result = []
    for path, names in h.R5_SOURCES.items():
        committed = subprocess.check_output(['git', 'show', 'HEAD:' + path], cwd=h.ROOT,
                                            timeout=10, stderr=subprocess.DEVNULL)
        if (h.ROOT / path).read_bytes() != committed:
            raise ValueError()
        result.append({'path': path, 'sha256': hashlib.sha256(committed).hexdigest(), 'names': names})
    return result


def read_document(h, device):
    filename = 'keeper-r5-native-evidence.json'
    if h.PLATFORM == 'ANDROID':
        if not re.fullmatch(r'emulator-[0-9]+', device):
            raise ValueError()
        return h.command(['adb', '-s', device, 'exec-out', 'run-as', h.APP_IDS['ANDROID'],
                          'head', '-c', '65537', 'files/' + filename],
                         'Read bounded failed R5 worker evidence', timeout=15,
                         capture=True, error_details=False)
    if h.PLATFORM != 'IOS' or not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', device):
        raise ValueError()
    container = Path(h.command(['xcrun', 'simctl', 'get_app_container', device, h.APP_IDS['IOS'], 'data'],
                               'Locate failed R5 worker evidence', timeout=15,
                               capture=True, error_details=False))
    base = Path.home() / 'Library/Developer/CoreSimulator/Devices' / device / 'data/Containers/Data/Application'
    if (not container.is_absolute() or container.parent.resolve() != base.resolve() or
            not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', container.name) or
            container.is_symlink()):
        raise ValueError()
    return read_private(container / 'Documents', filename, 65536)


def collect(h, device, report):
    result = {'schema': 1, 'scope': SCOPE, 'freshness': FRESHNESS, 'native_acceptance': False,
              'scenario_scope': 'APP_REPORTED_AGGREGATE_NOT_PER_CASE_EXECUTION',
              'document': unknown_document(),
              'junit': {'state': 'UNAVAILABLE', 'failed_selector': None, 'failure_kind': None}}
    try:
        if Path(report) != h.PRIVATE / 'features-junit.xml':
            raise ValueError()
        result['junit'] = project_junit(read_private(h.PRIVATE, 'features-junit.xml', 1024 * 1024))
    except (OSError, ValueError, TypeError, UnicodeError):
        pass
    try:
        sources = expected_sources(h)
        raw = read_document(h, device)
        result['document'] = project_document(raw, sources, h.R5_SCENARIOS, h.R5_LIMITS)
    except Exception:
        pass  # The original failed probe and its cleanup always remain in force.
    return result
