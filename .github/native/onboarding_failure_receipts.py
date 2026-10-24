"""Pure, bounded projection of reserved development-only Android receipts."""
from datetime import date
import re

LIMIT = 512 * 1024
MAX_RECORDS = 10000
MAX_MARKERS = 64
PREFIX = 'KEEPER_ONBOARDING_BOUNDARY|'
STAGES = ('ONBOARDING_EFFECT', 'SKIP_PRESS', 'SKIP_RESET_RETURNED',
          'SKIP_RESET_THROWN', 'NEW_KEEPER_EFFECT')
_FRAME = re.compile(
    r'(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01]) '
    r'(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}'
    r' +([1-9][0-9]{0,9}) +([1-9][0-9]{0,9}) +E +ReactNativeJS: (.*)')
_FORM = re.compile(re.escape(PREFIX) + r'(v[0-9]{1,4})\|([A-Z][A-Z0-9_]{0,63})')


def _frame(line):
    if not isinstance(line, str) or len(line) > LIMIT or '\n' in line:
        return None
    match = _FRAME.fullmatch(line)
    if not match or any(int(match[index]) > 2147483647 for index in (1, 2)):
        return None
    try:
        date(2000, int(line[:2]), int(line[3:5]))  # Year is absent; permit February 29.
    except ValueError:
        return None
    return match


def has_diagnostic_marker_prefix(line):
    """Reserve diagnostic frames for separate parsing, including rejected suffixes.

    This predicate establishes neither a valid receipt nor process attribution.
    It must not exclude ordinary errors that merely mention the marker later.
    """
    match = _frame(line)
    return bool(match and match[3].startswith(PREFIX))


def _clean(line):
    # Only LF is a record delimiter; CR is accepted solely as part of CRLF by
    # parse(). Reject replacement, C0/C1 controls and Unicode line separators.
    return not any(ord(char) < 32 or 127 <= ord(char) <= 159 or
                   char in '\ufffd\u2028\u2029' for char in line)


def _receipt(line):
    match = _frame(line)
    if not match or not _clean(line):
        return None
    form = _FORM.fullmatch(match[3])
    if form and form[1] == 'v1' and form[2] in STAGES:
        return int(match[1]), form[2]
    return None


def is_diagnostic_marker_record(line):
    """Recognize an exact valid enum record, independently of process ownership."""
    return _receipt(line) is not None


def parse(payload, owned_pids, *, usable=True, full_input=True):
    """Return positive receipts only; missing stages never establish absence.

    Inputs are an already-collected threadtime E/F payload and the existing
    current-process inventory. No guest-clock freshness, route, touch delivery,
    causal relationship or application success is inferred from these records.
    """
    result = {
        'schema': 1, 'scope': 'DEV_MARKERS_NOT_ROUTE_TAP_DELIVERY_OR_CAUSE_PROOF',
        'state': 'UNKNOWN', 'cause': 'UNDETERMINED',
        'freshness': 'GUEST_CLOCK_UNVERIFIED',
        'coverage': 'POSITIVE_ONLY_MISSING_STAGES_UNKNOWN',
        'producer_per_stage_limit': 4, 'producer_total_limit': 20,
        'consumer_marker_limit': MAX_MARKERS, 'input_byte_limit': LIMIT,
        'scan_record_limit': MAX_RECORDS,
        'input_usable': usable is True, 'full_input': full_input is True,
        'ownership_usable': False, 'stages': {stage: None for stage in STAGES},
        'scanned_records': 0, 'marker_records': 0, 'owned_marker_records': 0,
        'foreign_pid_records': 0, 'duplicate_records': 0,
        'malformed_marker_records': 0, 'unsupported_marker_records': 0,
        'invalid_text_records': 0, 'partial_records': 0,
        'input_limit_exceeded': False, 'record_limit_reached': False,
        'marker_limit_reached': False,
    }
    if not isinstance(owned_pids, (set, frozenset)) or any(
            type(pid) is not int or not 0 < pid <= 2147483647 for pid in owned_pids):
        owned_pids = set()
    result['ownership_usable'] = bool(owned_pids)
    if usable is not True or not isinstance(payload, str):
        return result
    # Reject over-budget input rather than accepting a potentially split prefix.
    if len(payload) > LIMIT:
        result['input_limit_exceeded'] = True
        return result
    try:
        if len(payload.encode('utf-8')) > LIMIT:
            result['input_limit_exceeded'] = True
            return result
    except UnicodeEncodeError:
        result['invalid_text_records'] = 1
        return result
    lines = payload.split('\n')
    if lines[-1]:
        result['partial_records'] = 1
    lines.pop()  # Never accept the terminal non-LF fragment as a complete record.
    for line in lines:
        if result['scanned_records'] >= MAX_RECORDS:
            result['record_limit_reached'] = True
            break
        result['scanned_records'] += 1
        if line.endswith('\r'):
            line = line[:-1]
        if PREFIX not in line:
            continue
        if result['marker_records'] >= MAX_MARKERS:
            result['marker_limit_reached'] = True
            break
        result['marker_records'] += 1
        if not _clean(line):
            result['invalid_text_records'] += 1
            result['malformed_marker_records'] += 1
            continue
        match = _frame(line)
        if not match or not match[3].startswith(PREFIX):
            result['malformed_marker_records'] += 1
            continue
        form = _FORM.fullmatch(match[3])
        if not form:
            result['malformed_marker_records'] += 1
            continue
        if form[1] != 'v1' or form[2] not in STAGES:
            result['unsupported_marker_records'] += 1
            continue
        if int(match[1]) not in owned_pids:
            result['foreign_pid_records'] += 1
            continue
        result['owned_marker_records'] += 1
        stage = form[2]
        if result['stages'][stage] is True:
            result['duplicate_records'] += 1
        result['stages'][stage] = True
    if result['owned_marker_records']:
        partial = (full_input is not True or result['partial_records'] or
                   result['record_limit_reached'] or result['marker_limit_reached'] or
                   result['malformed_marker_records'] or result['unsupported_marker_records'])
        result['state'] = 'PARTIAL' if partial else 'OBSERVED'
    return result
