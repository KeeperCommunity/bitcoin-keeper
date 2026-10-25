"""Bounded optional startup markers from already validated compact records.

This module performs no native operation or raw compact-log parsing. The marker's
epoch is used only for relation to the supplied capture window; neither it nor
the compact timestamp, PID, process, or message is exported. Positive markers
are observations, never a cause, a successful read, or an acceptance predicate.
"""

import re


MARKER = 'KEEPER_STARTUP_FAILURE_V1'
COMPACT_PREFIX = '[com.facebook.react.log:javascript] '
MAX_RECORDS = 32
MAX_MESSAGE_CHARS = 16 * 1024
MAX_EPOCH_MS = 10 ** 14
PHASES = ('ACCOUNT_STATE', 'NATIVE_CREDENTIAL_READ', 'CREDENTIAL_JSON', 'NAVIGATION')
OUTCOMES = ('THREW', 'REJECTED')
ERROR_NAMES = ('Error', 'TypeError', 'SyntaxError', 'ReferenceError', 'RangeError',
               'EvalError', 'URIError', 'AggregateError', 'OTHER', 'UNKNOWN')
_REASONS = ('MISSING_WINDOW', 'INVALID_WINDOW', 'NO_MARKER_OBSERVED',
            'INVALID_COMPACT_RECORD', 'INVALID_RECORD_FIELDS', 'MALFORMED_MARKER',
            'UNSUPPORTED_FRAMING', 'FOREIGN_PROCESS_MARKER', 'OUTSIDE_WINDOW',
            'MULTIPLE_OWN_PIDS', 'DUPLICATE_MARKER', 'MULTIPLE_MARKERS',
            'OBSERVATION_LIMIT', 'PARTIAL_INPUT')


def _integer(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def _pid(value):
    if isinstance(value, str) and re.fullmatch(r'[1-9][0-9]{0,9}', value):
        value = int(value)
    return value if _integer(value, 1, 2147483647) else None


class Collector:
    """Collect fixed facts; observe() accepts the caller's validated fields.

    Supported grammar is an exact standalone marker or that marker after the
    fixed React JavaScript subsystem/category prefix. This grammar does not
    establish that either form has actually reached the hosted log query.
    Each counter and retained collection is bounded.
    """

    def __init__(self, executable, started_ms=None, ended_ms=None):
        if (not isinstance(executable, str) or
                not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}', executable)):
            raise ValueError('Expected a validated executable selector.')
        self._executable = executable
        if started_ms is None or ended_ms is None:
            self._window = 'UNKNOWN'
        elif (not _integer(started_ms, 0, MAX_EPOCH_MS) or
              not _integer(ended_ms, 0, MAX_EPOCH_MS) or ended_ms < started_ms):
            self._window = 'INVALID'
        else:
            self._window = 'BOUNDED'
        self._started_ms, self._ended_ms = started_ms, ended_ms
        self._rows, self._seen, self._pids = [], set(), set()
        self._pid_count_capped = False
        self._reasons = set()
        self._counts = {name: 0 for name in (
            'marker_records_seen', 'duplicate_records', 'malformed_markers',
            'invalid_compact_markers', 'invalid_record_fields',
            'foreign_process_markers', 'outside_window_markers')}

    def _count(self, name):
        if self._counts[name] < MAX_RECORDS:
            self._counts[name] += 1
        else:
            self._reasons.add('OBSERVATION_LIMIT')

    def _marker(self):
        if self._counts['marker_records_seen'] >= MAX_RECORDS:
            self._reasons.add('OBSERVATION_LIMIT')
            return False
        self._count('marker_records_seen')
        return True

    def _track_pid(self, pid):
        if len(self._pids) < 2:
            self._pids.add(pid)
        elif pid not in self._pids:
            self._pid_count_capped = True
        if len(self._pids) > 1:
            self._reasons.add('MULTIPLE_OWN_PIDS')

    def invalid_record(self, marker_present):
        """The existing compact parser found a marker in an invalid record."""
        if type(marker_present) is not bool:
            self._reasons.add('INVALID_RECORD_FIELDS')
            self._count('invalid_record_fields')
        elif marker_present and self._marker():
            self._reasons.add('INVALID_COMPACT_RECORD')
            self._count('invalid_compact_markers')

    def observe(self, timestamp, process, pid, message):
        # The compact timestamp is not interpreted as an epoch: compact output
        # may omit its timezone. The marker supplies its own bounded epoch.
        if not isinstance(message, str) or len(message) > MAX_MESSAGE_CHARS:
            self._reasons.add('INVALID_RECORD_FIELDS')
            self._count('invalid_record_fields')
            return
        if MARKER not in message:
            # The caller supplies all validated compact records, not just
            # markers. An ordinary record from another own PID also prevents
            # single-process attribution. Do not infer its timezone or export it.
            own_pid = _pid(pid)
            if (isinstance(timestamp, str) and timestamp and len(timestamp) <= 64 and
                    process == self._executable and own_pid is not None):
                self._track_pid(own_pid)
            return
        if not self._marker():
            return
        if (not isinstance(timestamp, str) or not timestamp or len(timestamp) > 64 or
                not isinstance(process, str)):
            self._reasons.add('INVALID_RECORD_FIELDS')
            self._count('invalid_record_fields')
            return
        if process != self._executable:
            self._reasons.add('FOREIGN_PROCESS_MARKER')
            self._count('foreign_process_markers')
            return
        pid = _pid(pid)
        if pid is None:
            self._reasons.add('INVALID_RECORD_FIELDS')
            self._count('invalid_record_fields')
            return
        self._track_pid(pid)
        if message.startswith(COMPACT_PREFIX):
            message = message[len(COMPACT_PREFIX):]
        if not message.startswith(MARKER + '|'):
            self._reasons.add('UNSUPPORTED_FRAMING')
            self._count('malformed_markers')
            return
        parts = message.split('|')
        if len(parts) != 6:
            self._reasons.add('MALFORMED_MARKER')
            self._count('malformed_markers')
            return
        _, epoch, phase, outcome, name, code = parts
        valid_epoch = bool(re.fullmatch(r'(?:0|[1-9][0-9]{0,14})', epoch))
        if (not valid_epoch or int(epoch) > MAX_EPOCH_MS or phase not in PHASES or
                outcome not in OUTCOMES or name not in ERROR_NAMES or
                (outcome == 'REJECTED' and phase != 'NATIVE_CREDENTIAL_READ')):
            self._reasons.add('MALFORMED_MARKER')
            self._count('malformed_markers')
            return
        status_code = None
        if code != 'NONE':
            if (phase != 'NATIVE_CREDENTIAL_READ' or outcome != 'REJECTED' or
                    not re.fullmatch(r'(?:0|-?[1-9][0-9]{0,9})', code)):
                self._reasons.add('MALFORMED_MARKER')
                self._count('malformed_markers')
                return
            status_code = int(code)
            if not -2147483648 <= status_code <= 2147483647:
                self._reasons.add('MALFORMED_MARKER')
                self._count('malformed_markers')
                return
        epoch = int(epoch)
        identity = (epoch, phase, outcome, name, status_code)
        if identity in self._seen:
            self._reasons.add('DUPLICATE_MARKER')
            self._count('duplicate_records')
            return
        self._seen.add(identity)
        if self._window != 'BOUNDED':
            return
        if not self._started_ms <= epoch <= self._ended_ms:
            self._reasons.add('OUTSIDE_WINDOW')
            self._count('outside_window_markers')
            return
        self._rows.append({'phase': phase, 'outcome': outcome, 'error_name': name,
                           'code': status_code, 'window_relation': 'IN_WINDOW'})

    def result(self, input_partial=False):
        reasons = set(self._reasons)
        if self._window == 'UNKNOWN':
            reasons.add('MISSING_WINDOW')
        elif self._window == 'INVALID':
            reasons.add('INVALID_WINDOW')
        if type(input_partial) is not bool or input_partial:
            reasons.add('PARTIAL_INPUT')
        if not self._counts['marker_records_seen']:
            reasons.add('NO_MARKER_OBSERVED')
        if len(self._rows) > 1:
            reasons.add('MULTIPLE_MARKERS')
        status = 'OBSERVED' if len(self._rows) == 1 and not reasons else (
            'AMBIGUOUS' if self._rows else 'UNKNOWN')
        return {
            'schema': 1, 'status': status, 'cause': 'UNDETERMINED',
            'window': self._window, 'records': [dict(row) for row in self._rows],
            **self._counts, 'own_process_count': len(self._pids),
            'own_process_count_capped': self._pid_count_capped,
            'limit_reached': 'OBSERVATION_LIMIT' in reasons,
            'input_partial': type(input_partial) is not bool or input_partial,
            'reasons': [reason for reason in _REASONS if reason in reasons],
            'scope': 'OPTIONAL_ORIGINAL_STARTUP_MARKERS_NOT_CAUSE_OR_ACCEPTANCE',
        }
