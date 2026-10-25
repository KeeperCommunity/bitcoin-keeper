"""Observe one unchanged simulator install; export only fixed, bounded facts.

The caller supplies its live harness context. This module never imports another
hosted_native instance, changes the install deadline, retries, opens Simulator,
or changes simulator/app services. Raw process/log output stays private.
"""

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
import hashlib
import math
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import time


SNAPSHOT_SECONDS = 60
LIMIT = 1024 * 1024
APP_ID = 'io.hexawallet.hexakeeper.dev'
DOMAINS = {
    'CORE_SIMULATOR': 'com.apple.CoreSimulator.SimError',
    'MOBILE_INSTALLATION': 'MIInstallerErrorDomain',
    'INSTALL_COORDINATION': 'IXErrorDomain',
    'USER_PRESENTABLE_INSTALL': 'IXUserPresentableErrorDomain',
    'LAUNCH_SERVICES': 'LSApplicationWorkspaceErrorDomain',
    'COCOA': 'NSCocoaErrorDomain',
    'POSIX': 'NSPOSIXErrorDomain',
}
CATEGORIES = {
    'INSTALL_FAILED': r'failed to install|could not install|installation failed',
    'BUNDLE_VALIDATION_FAILED': r'bundle.*(?:invalid|validation failed)|invalid.*(?:bundle|executable)',
    'SIGNATURE_VERIFICATION_FAILED': r'applicationverificationfailed|invalid code signature|signature.*(?:invalid|verification failed)',
    'SERVICE_CONNECTION_FAILED': r'connection.*(?:invalidated|interrupted|refused|timed out)|failed to connect|service.*not available',
    'CONTAINER_SERVICE_FAILED': r'(?:container|containermanager).*\b(?:error|failed|unavailable)\b',
    'PERMISSION_DENIED': r'permission denied|operation not permitted|not authorized',
    'DISK_SPACE_EXHAUSTED': r'no space left on device|not enough (?:free )?(?:disk )?space',
    'RESOURCE_BUSY': r'resource busy|device busy|another installation.*in progress',
    'DEVICE_NOT_BOOTED': r'device.*(?:not booted|shutdown|unavailable)|invalid device state',
    'INSTALL_COORDINATION_REFERENCE': r'(?:install coordination|IXCoordinator|IXSClient|IXClient)',
}
STACK_MARKERS = {
    'CORE_SIMULATOR': r'CoreSimulator|SimDevice|SimServiceContext',
    'MOBILE_INSTALLATION': r'MobileInstallation|MIClient|installApplication|installBundle',
    'INSTALL_COORDINATION': r'InstallCoordination|IXCoordinator|IXSClient|IXClient',
    'CONTAINER_SERVICE': r'MobileContainerManager|MCMClient|containermanager',
    'LAUNCH_SERVICES': r'LaunchServices|LSApplication|_LSServer',
    'SIGNATURE_VERIFICATION': r'MISValidate|SecStaticCode|AMFI',
    'XPC_SYNC_WAIT': r'xpc_connection_send_message_with_reply_sync',
    'MACH_WAIT': r'mach_msg|mach_msg2_trap',
    'DISPATCH_WAIT': r'dispatch_sync|dispatch_semaphore_wait|dispatch_group_wait',
    'LOCK_WAIT': r'__psynch_mutexwait|__ulock_wait|pthread_mutex_lock',
}


def _error(error):
    name = type(error).__name__
    return name if name in {'RuntimeError', 'OSError', 'ValueError', 'TypeError',
                            'FileNotFoundError', 'PermissionError', 'TimeoutExpired'} else 'OTHER_ERROR'


def _classify(payload):
    categories = [name for name, pattern in CATEGORIES.items()
                  if re.search(pattern, payload, re.IGNORECASE)]
    codes = {}
    for name, domain in DOMAINS.items():
        matches = re.findall(r'Domain\s*=\s*' + re.escape(domain) + r'\s+Code\s*=\s*(-?\d+)\b',
                             payload, re.IGNORECASE)
        values = list(dict.fromkeys(int(value) for value in matches if len(value) <= 6
                                    and -65535 <= int(value) <= 65535))[:4]
        if values:
            codes[name] = values
    return {'categories': categories, 'error_domain_codes': codes}


def _bounded(context, path):
    if path.is_symlink() or not path.resolve().is_relative_to(Path(context.PRIVATE).resolve()):
        raise ValueError('Expected private diagnostic file.')
    size_before = path.stat().st_size
    with path.open('rb') as source:
        payload = source.read(LIMIT)
    size_after = path.stat().st_size
    text = payload.decode(errors='replace')
    return text, {'bytes': size_after, 'prefix_bytes': len(payload),
                  'truncated': size_after > len(payload), 'grew_during_read': size_after != size_before,
                  'prefix_sha256': hashlib.sha256(payload).hexdigest(), **_classify(text)}


def _capture(context, args, label, prefix, timeout):
    path = Path(context.PRIVATE) / (prefix + '-' + label + '.log')
    facts = {'label': label}
    started = time.monotonic()
    try:
        if path.is_symlink():
            raise ValueError('Expected private diagnostic output.')
        with path.open('wb') as output:
            proc = subprocess.Popen(args, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                facts['exit_code'] = proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
                facts['exit_code'] = 124
        payload, result = _bounded(context, path)
        facts.update(result)
        return payload, facts
    except Exception as error:
        facts['error_type'] = _error(error)
        return '', facts
    finally:
        facts['duration_seconds'] = round(time.monotonic() - started, 2)


def _baseline(context, device, prefix):
    facts = {'commands': [], 'resource_errors': []}
    try:
        facts['disk_free_bytes'] = shutil.disk_usage(context.PRIVATE).free
    except Exception as error:
        facts['resource_errors'].append({'stage': 'disk', 'error_type': _error(error)})
    try:
        values = os.getloadavg()
        if len(values) != 3 or not all(math.isfinite(value) for value in values):
            raise ValueError('Expected finite host load observations.')
        facts['host_load_1_5_15m'] = [round(value, 2) for value in values]
    except Exception as error:
        facts['resource_errors'].append({'stage': 'host_load', 'error_type': _error(error)})
    for args, label in [
        (['xcrun', 'simctl', 'listapps', device], 'baseline-listapps'),
        (['xcrun', 'simctl', 'get_app_container', device, 'com.apple.Preferences', 'app'],
         'baseline-preferences-container'),
    ]:
        _, result = _capture(context, args, label, prefix, 5)
        facts['commands'].append(result)
    return facts


def _collect(context, device, prefix, command_log):
    facts = {'commands': [], 'collection_errors': []}

    def command(args, label, timeout):
        payload, result = _capture(context, args, label, prefix, timeout)
        facts['commands'].append(result)
        return payload, result

    ps, result = command(['ps', '-axo', 'pid=,stat=,args='], 'processes', 3)
    pattern = re.compile(r'^\s*(\d+)\s+(\S+)\s+(.*)$')
    owned = []
    for line in ps.splitlines():
        match = pattern.match(line)
        if match and re.search(r'(?:^|[/\s])simctl\s+install\s+' + re.escape(device) + r'(?=\s|$)', match[3]):
            owned.append((int(match[1]), match[2]))
    known = result.get('exit_code') == 0
    facts['owned_install_process_count'] = len(owned) if known else None
    facts['owned_install_running'] = any('Z' not in state for _, state in owned) if known else None
    if len(owned) == 1 and 'Z' not in owned[0][1]:
        sample_path = Path(context.PRIVATE) / (prefix + '-install.sample')
        command(['sample', str(owned[0][0]), '3', '1', '-file', str(sample_path)], 'install-sample', 8)
        try:
            payload, result = _bounded(context, sample_path)
            result['stack_categories'] = [name for name, marker in STACK_MARKERS.items()
                                           if re.search(marker, payload, re.IGNORECASE)]
            facts['install_sample'] = result
        except Exception as error:
            facts['collection_errors'].append({'stage': 'install_sample', 'error_type': _error(error)})
    launchctl, result = command(['xcrun', 'simctl', 'spawn', device, 'launchctl', 'list'], 'simulator-services', 4)
    facts['services'] = {}
    for name, identifier in [('installd', 'com.apple.mobile.installd'), ('appinstalld', 'com.apple.appinstalld'),
                             ('lsd', 'com.apple.lsd')]:
        rows = [line.split() for line in launchctl.splitlines() if line.split()[-1:] == [identifier]]
        facts['services'][name] = {
            'entries': len(rows) if result.get('exit_code') == 0 else None,
            'running': any(row[0].isdigit() and int(row[0]) > 0 for row in rows)
                       if result.get('exit_code') == 0 else None,
        }
    host_predicate = '(process == "CoreSimulatorService" OR process == "simctl") AND eventMessage CONTAINS "' + device + '"'
    command(['log', 'show', '--style', 'compact', '--last', '3m', '--predicate', host_predicate], 'owned-host-events', 5)
    command(['xcrun', 'simctl', 'spawn', device, 'log', 'show', '--style', 'compact', '--last', '3m',
             '--predicate', 'process == "installd" OR process == "appinstalld" OR process == "lsd"'],
            'simulator-install-events', 8)
    try:
        _, facts['install_command_output'] = _bounded(context, command_log)
    except Exception as error:
        facts['collection_errors'].append({'stage': 'install_command_output', 'error_type': _error(error)})
    return facts


def observe(context, device, args, label, timeout=120):
    """Call context.command once with the original install argv and deadline.

    Missing observation persistence blocks this diagnostic path after an install
    succeeds. It cannot replace an original install exception or grant UI credit.
    """
    if (not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', device)
            or list(args[:4]) != ['xcrun', 'simctl', 'install', device] or len(args) != 5):
        raise ValueError('Expected the owned simulator app install command.')
    index = len(context.read()['commands']) + 1
    prefix = 'install-diagnosis-%03d' % index
    command_log = Path(context.PRIVATE) / ('command-%03d.log' % index)
    facts = {'scope': 'Read-only install observation; no UI or installed-byte acceptance.',
             'command_index': index, 'collection_errors': []}
    original_error = None
    try:
        try:
            facts['baseline'] = _baseline(context, device, prefix)
        except Exception as error:
            facts['collection_errors'].append({'stage': 'baseline', 'error_type': _error(error)})
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(context.command, args, label, timeout=timeout)
            try:
                result = future.result(timeout=SNAPSHOT_SECONDS)
            except FutureTimeoutError:
                pass
            except Exception as error:
                original_error = error
            else:
                facts['command_returned'] = True
            facts['snapshot_phase'] = 'DURING_INSTALL' if not future.done() else 'AFTER_INSTALL_COMMAND'
            facts['install_running_before_collection'] = not future.done()
            try:
                facts['snapshot'] = _collect(context, device, prefix, command_log)
            except Exception as error:
                facts['collection_errors'].append({'stage': 'snapshot', 'error_type': _error(error)})
            facts['install_running_after_collection'] = not future.done()
            try:
                result = future.result()
            except Exception as error:
                original_error = error
                facts['command_error_type'] = _error(error)
                raise
            else:
                facts['command_returned'] = True
                return result
    finally:
        try:
            _, lookup = _capture(context, ['xcrun', 'simctl', 'get_app_container', device, APP_ID, 'app'],
                                 'post-install-container', prefix, 5)
            code = lookup.get('exit_code')
            lookup['state'] = 'SUCCESS' if code == 0 else 'TIMEOUT' if code == 124 else 'ERROR' if code is None else 'FAIL'
            facts['post_install_lookup'] = lookup
            data = context.read()
            data.setdefault('install_diagnoses', []).append(facts)
            context.save(data)
        except Exception:
            if original_error is None:
                raise RuntimeError('Bounded install diagnostics could not be saved.') from None
            # Never replace the original install failure with a collector error.
            print('Bounded install diagnostics could not be saved.', flush=True)
