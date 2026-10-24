"""Bounded read-only readiness for the simulator app-service query surface.

A completed simulator boot does not establish that listapps can respond. This
gate requires its successful exit before the caller starts installation or the
driver. It retries only that read-only query; no output, app/driver operation,
frontend launch or service configuration is retained or changed here.
"""

import math
import re
import subprocess
import time


MAX_WINDOW_SECONDS = 120
QUERY_SECONDS = 5
POLL_SECONDS = 1


def _error_type(error):
    name = type(error).__name__
    return name if name in {'OSError', 'FileNotFoundError', 'PermissionError'} else 'OTHER_ERROR'


def _query(device, timeout):
    started = time.monotonic()
    attempt = {}
    try:
        result = subprocess.run(['xcrun', 'simctl', 'listapps', device],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                timeout=timeout, check=False)
        code = result.returncode
        if not isinstance(code, int) or isinstance(code, bool):
            attempt.update(state='ERROR', error_type='INVALID_EXIT_STATUS')
        else:
            attempt.update(state='SUCCESS' if code == 0 else 'FAIL', exit_code=code)
    except subprocess.TimeoutExpired:
        # TimeoutExpired can embed arbitrary subprocess output or argv. Export
        # neither; run() terminates and reaps its own timed-out query process.
        attempt['state'] = 'TIMEOUT'
    except Exception as error:
        attempt.update(state='ERROR', error_type=_error_type(error))
    attempt['duration_seconds'] = round(time.monotonic() - started, 3)
    return attempt


def wait_for_app_services(context, device, timeout=MAX_WINDOW_SECONDS):
    """Require one successful listapps response within the bounded deadline.

    context supplies read()/save() from the active harness instance. The caller
    invokes this between commands, so metadata writes cannot race an app build,
    install or driver. A missing receipt also fails closed.
    """
    if (not isinstance(device, str)
            or not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', device)):
        raise ValueError('Expected an owned simulator UUID.')
    if (not isinstance(timeout, (int, float)) or isinstance(timeout, bool)
            or not math.isfinite(timeout) or timeout <= 0 or timeout > MAX_WINDOW_SECONDS):
        raise ValueError('Expected a positive readiness window of at most 120 seconds.')
    try:
        initial = context.read()
    except Exception:
        raise RuntimeError('Simulator app-service readiness evidence could not be read.') from None
    record = {
        'scope': 'Read-only simulator app-service readiness; no app, driver or UI credit.',
        'criterion': 'SIMCTL_LISTAPPS_EXIT_ZERO', 'result': 'FAIL',
        'after_command_index': len(initial.get('commands', [])),
        'timeout_seconds': timeout, 'query_timeout_seconds': QUERY_SECONDS, 'attempts': [],
    }
    started = time.monotonic()
    deadline = started + timeout
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        attempt = _query(device, min(QUERY_SECONDS, remaining))
        record['attempts'].append(attempt)
        if attempt['state'] == 'SUCCESS':
            # Scheduling delays must not turn a response first observed after
            # the bounded window into a timely readiness receipt.
            if time.monotonic() <= deadline:
                record['result'] = 'PASS'
            else:
                attempt['observed_after_deadline'] = True
            break
        if attempt['state'] == 'ERROR':
            break
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(POLL_SECONDS, remaining))
    record['duration_seconds'] = round(time.monotonic() - started, 3)
    try:
        data = context.read()
        data.setdefault('simulator_app_service_readiness', []).append(record)
        context.save(data)
    except Exception:
        raise RuntimeError('Simulator app-service readiness evidence could not be saved.') from None
    if record['result'] != 'PASS':
        raise RuntimeError('Simulator app services did not respond successfully within the readiness window.')
    return record
