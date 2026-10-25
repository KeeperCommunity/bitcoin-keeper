"""One failure-only simulator launch; never retry a test or grant acceptance."""
import importlib.util
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile

APP = 'io.hexawallet.hexakeeper.dev'
LIMIT = 65536
DOMAINS = frozenset(('FBSOpenApplicationServiceErrorDomain', 'FBSOpenApplicationErrorDomain',
    'RBSRequestErrorDomain', 'RBSErrorDomain', 'NSPOSIXErrorDomain', 'NSCocoaErrorDomain',
    'NSOSStatusErrorDomain', 'NSMachErrorDomain', 'OSLaunchdErrorDomain',
    'BSServiceConnectionErrorDomain', 'FBProcessExit'))
PAIR = re.compile(r'(?:domain=|Error Domain=)([A-Za-z][A-Za-z0-9.]{0,95})'
    r'(?:, code=| Code=)(-?(?:0|[1-9][0-9]{0,9}))\b')
SCOPE = 'FAILURE_ONLY_LATER_LAUNCH_NOT_ORIGINAL_CAUSE_UI_OR_NATIVE_ACCEPTANCE'


def codes(payload):
    """Only allowlisted domain names and bounded integers leave private stderr."""
    result = {'pairs': [], 'input_partial': len(payload) > LIMIT, 'unknown_domain_observed': False}
    text = payload[:LIMIT].decode('utf-8', errors='replace')
    result['input_partial'] |= '\ufffd' in text
    for match in PAIR.finditer(text):
        domain, number = match.groups()
        if domain not in DOMAINS:
            result['unknown_domain_observed'] = True
            continue
        number = int(number)
        if not -(2 ** 31) <= number < 2 ** 31:
            result['input_partial'] = True
            continue
        pair = {'domain': domain, 'code': number}
        if pair not in result['pairs']:
            if len(result['pairs']) == 8:
                result['input_partial'] = True
                break
            result['pairs'].append(pair)
    return result


def process(private, device):
    result = {'state': 'UNKNOWN', 'query': 'UNAVAILABLE', 'owned_entry_count': None}
    try:
        with tempfile.TemporaryFile(dir=private) as output:
            outcome = subprocess.run(['xcrun', 'simctl', 'spawn', device, 'launchctl', 'list'],
                stdout=output, stderr=subprocess.DEVNULL, timeout=5, check=False)
            if outcome.returncode != 0:
                return {**result, 'query': 'NONZERO_EXIT'}
            output.seek(0)
            spec = importlib.util.spec_from_file_location('direct_launch_process_parser',
                Path(__file__).with_name('ios_startup_command_observation.py'))
            parser = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(parser)
            projected = parser.process_entries(output.read(1024 * 1024 + 1))
            return {**projected, 'query': 'EXIT_ZERO'}
    except subprocess.TimeoutExpired:
        return {**result, 'query': 'TIMEOUT'}
    except Exception:
        return result


def collect(native, device):
    """Run after original failure observations, before normal owned cleanup.

    No app-state reset, termination request, signing, timeout extension or test
    retry occurs. The original smoke remains FAIL, even if this later launch
    is accepted. An empty exclusive marker prevents a second diagnostic launch.
    """
    result = {'schema': 1, 'state': 'NOT_ELIGIBLE', 'command': 'NOT_RUN', 'timeout_seconds': 20,
        'launch_response': 'UNKNOWN', 'error_codes': {'pairs': [], 'input_partial': False,
        'unknown_domain_observed': False}, 'before_process': None, 'after_process': None,
        'cause': 'UNKNOWN', 'native_acceptance': False, 'scope': SCOPE}
    data = native.read()
    rows = data.get('startup_diagnostics', {}).get('command_observation', {}).get('commands', {}).get('rows', [])
    if (native.PLATFORM != 'IOS' or type(device) is not str or not re.fullmatch(
            r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', device) or
            data.get('build') != 'PASS' or data.get('smoke') not in ('NOT RUN', 'FAIL') or
            getattr(native, 'original_smoke_failed', False) is not True or
            data.get('install_succeeded') is not True or data.get('installed_artifact_verified') is not True or
            data.get('device', {}).get('id') != device or
            data.get('device', {}).get('fresh_disposable_state') is not True or
            type(rows) is not list or not any(type(row) is dict and row.get('kind') == 'LAUNCH_APP'
                and row.get('status') == 'FAILED' for row in rows)):
        return result
    try:
        descriptor = os.open(native.PRIVATE / 'ios-direct-launch.once',
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        os.close(descriptor)
    except FileExistsError:
        return {**result, 'state': 'ALREADY_ATTEMPTED'}
    result['state'] = 'OBSERVED'
    result['before_process'] = process(native.PRIVATE, device)
    try:
        with tempfile.TemporaryFile(dir=native.PRIVATE) as output, tempfile.TemporaryFile(dir=native.PRIVATE) as error:
            child = subprocess.Popen(['xcrun', 'simctl', 'launch', device, APP],
                stdout=output, stderr=error, start_new_session=True)
            try:
                exit_code = child.wait(timeout=20)
                result['command'] = 'EXIT_ZERO' if exit_code == 0 else 'NONZERO_EXIT'
            except subprocess.TimeoutExpired:
                result['command'] = 'TIMEOUT'
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
            finally:
                # Any exceptional wait path also disposes the owned command.
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=5)
            output.seek(0)
            response = output.read(LIMIT + 1)
            if result['command'] == 'EXIT_ZERO' and re.fullmatch(
                    re.escape(APP).encode() + rb': [1-9][0-9]{0,9}\n?', response):
                result['launch_response'] = 'ACCEPTED_AT_LATER_TIME'
            error.seek(0)
            result['error_codes'] = codes(error.read(LIMIT + 1))
    except Exception:
        result['command'] = 'UNAVAILABLE'
    finally:
        result['after_process'] = process(native.PRIVATE, device)
    return result
