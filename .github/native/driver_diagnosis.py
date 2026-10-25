#!/usr/bin/env python3
"""Setup-only iOS driver diagnosis; export fixed facts, never private log text.

This deliberately keeps the pinned Maestro and existing hierarchy launch path.
There is no Keeper install/build, dependency install, functional correction or
timeout change. Capture happens before hosted_native.driver deletes its device.
"""

import hashlib
import http.client
import io
import json
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
import os
from pathlib import Path
import plistlib
import re
import socket
import subprocess
import sys
import time
import zipfile

import hosted_native as native


LIMIT = 1024 * 1024
POLL_SNAPSHOT_SECONDS = 60
RUNNER_ID = 'dev.mobile.maestro-driver-iosUITests.xctrunner'
RUNNER_NAME = 'maestro-driver-iosUITests-Runner'
CATEGORIES = {
    'DYLD_LIBRARY_MISSING': r'library not loaded:|reason: tried:|image not found',
    'DYLD_SYMBOL_MISSING': r'symbol not found:|symbol missing|missing symbol',
    'DYLD_INCOMPATIBLE_LIBRARY': r'incompatible library version|incompatible architecture|wrong architecture',
    'DYLD_LIBRPAC_REFERENCE': r'library not loaded:.*librpac|reason: tried:.*librpac',
    'DYLD_SWIFT_COMPATIBILITY_REFERENCE': r'library not loaded:.*swiftcompatibility|reason: tried:.*swiftcompatibility',
    'TEST_BUNDLE_LOAD_FAILED': r'failed to load (?:the )?test bundle|could not load (?:the )?test bundle|bundle.*couldn.t be loaded',
    'TEST_RUNNER_LAUNCH_FAILED': r'failed to launch|could not launch|application failed to launch|failed to start test runner',
    'TEST_RUNNER_INSTALL_FAILED': r'failed to install|could not install|applicationverificationfailed|installd.*error',
    'TEST_MANAGER_CONNECTION_FAILED': r'failed to establish.*connection|failed to connect to testmanagerd|lost connection to the test manager',
    'TEST_RUNNER_WAIT_TIMEOUT': r'timed out waiting for.*(?:test runner|testing process|testmanagerd)|test runner.*failed to initialize',
    'RUNTIME_OR_DEPLOYMENT_MISMATCH': r'requires (?:ios|a newer version)|minimum.*(?:ios|deployment)|built for.*(?:newer|later)|unsupported os version',
    'XCODE_COMPONENT_MISSING': r'xcode.*(?:component|platform).*(?:missing|not installed)|unable to find.*(?:platform|runtime)',
    'DESTINATION_UNAVAILABLE': r'unable to find a destination|ineligible destinations|device.*(?:not available|unavailable|disconnected)',
    'CODE_SIGNING_FAILED': r'code sign(?:ing)?.*(?:failed|error)|invalid code signature|codesign.*failed',
    'PERMISSION_DENIED': r'permission denied|operation not permitted|not authorized',
    'DISK_SPACE_EXHAUSTED': r'no space left on device|not enough (?:free )?(?:disk )?space',
    'PROCESS_CRASHED': r'exception type:|termination reason:|crashed thread:|"exception"\s*:\s*\{|"termination"\s*:\s*\{',
    'XCODE_TEST_EXECUTE_FAILED': r'\*\* test execute failed \*\*',
    'XCODE_TEST_FAILED': r'\*\* test failed \*\*|testing failed:',
    'XCODE_TEST_STARTED': r'test suite .* started|testing started|test case .* started',
    'XCODE_TEST_SUCCEEDED': r'\*\* test (?:execute )?succeeded \*\*',
    'DRIVER_SERVER_STARTED': r'(?:server|listening).*(?:7001|22087)|server started|server is running',
    'XCODE_COMMAND_INVOCATION': r'^Command line invocation:',
    'XCODE_USER_DEFAULTS': r'^User defaults from command line:',
    'XCODE_DESTINATION_PREPARATION': r'Preparing.*destination|Preparing.*simulator|destination.*prepar',
    'XCODE_RESULT_BUNDLE': r'Test session results, code coverage, and logs:',
    'LICENSE_NOT_ACCEPTED': r'license.*(?:not accepted|agree)|requires.*license',
    'FIRST_LAUNCH_REQUIRED': r'first launch.*(?:required|not complete)|runFirstLaunch|install.*additional components',
    'ERROR_DOMAIN_CORE_SIMULATOR': r'com\.apple\.CoreSimulator\.SimError',
    'ERROR_DOMAIN_DVT_DEVICE': r'DVTDevice\w*ErrorDomain|DVTiPhoneSimulator\w*ErrorDomain',
    'ERROR_DOMAIN_IDE_TEST': r'IDETest\w*ErrorDomain|IDEXCTest\w*ErrorDomain',
    'ERROR_DOMAIN_XPC': r'NSXPCConnection\w*ErrorDomain|NSCocoaErrorDomain[^\n]{0,80}Code=409[79]',
}

STACK_MARKERS = {
    'XPC_SYNC_WAIT': r'xpc_connection_send_message_with_reply_sync',
    'MACH_WAIT': r'mach_msg|mach_msg2_trap',
    'DISPATCH_WAIT': r'dispatch_sync|dispatch_semaphore_wait|dispatch_group_wait',
    'CORE_SIMULATOR': r'CoreSimulator|SimDevice|SimServiceContext',
    'CORE_DEVICE': r'CoreDevice|CoreDeviceService',
    'DVT_DEVICE': r'DVTDevice|DVTiPhoneSimulator|DVTPlatform',
    'DVT_PLUGIN': r'DVTPlugIn|DVTPlugInManager',
    'IDE_TEST': r'IDETest|IDEXCTest|XCTest',
    'DEVICE_INSTALL': r'installApplication|installApp|installBundle',
    'DESTINATION_LOOKUP': r'findDestination|resolveDestination|availableDestinations|eligibleDestinations',
    'LOCK_WAIT': r'__psynch_mutexwait|__ulock_wait|pthread_mutex_lock',
}


def classify(payload):
    return [name for name, pattern in CATEGORIES.items()
            if re.search(pattern, payload, re.IGNORECASE | re.MULTILINE)]


def safe_error(error):
    return type(error).__name__ if type(error).__name__ in {
        'OSError', 'FileNotFoundError', 'PermissionError', 'TimeoutExpired',
        'ValueError', 'TypeError', 'KeyError', 'BadZipFile', 'InvalidFileException',
        'ConnectionRefusedError', 'TimeoutError', 'RemoteDisconnected',
    } else 'OTHER_ERROR'


def bounded(path):
    if path.is_symlink() or not path.resolve().is_relative_to(native.PRIVATE.resolve()):
        raise ValueError('Expected a private regular log.')
    size = path.stat().st_size
    with path.open('rb') as source:
        payload = source.read(LIMIT)
    return payload.decode('utf-8', errors='replace'), {
        'bytes': size, 'prefix_bytes': len(payload), 'truncated': size > LIMIT,
        'prefix_sha256': hashlib.sha256(payload).hexdigest(),
        'categories': classify(payload.decode('utf-8', errors='replace')),
    }


def capture(args, label, timeout=20):
    """Keep output private; return bounded text only to in-process classifiers."""
    path = native.PRIVATE / ('driver-diagnosis-' + label + '.log')
    result = {'label': label}
    try:
        with path.open('wb') as output:
            proc = subprocess.Popen(args, stdout=output, stderr=subprocess.STDOUT,
                                    start_new_session=True)
            try:
                result['exit_code'] = proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                import signal
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
                result['exit_code'] = 124
        payload, facts = bounded(path)
        result.update(facts)
        return payload, result
    except Exception as error:
        result['error_type'] = safe_error(error)
        return '', result


def numeric(value):
    value = str(value)
    return value if re.fullmatch(r'\d+(?:\.\d+){0,3}', value) else None


def version(value):
    return tuple(int(piece) for piece in value.split('.')) if value else ()


def process_inventory_known(payload, result):
    rows = [line for line in payload.splitlines() if line.strip()]
    return (bool(rows) and result.get('exit_code') == 0 and not result.get('truncated', False) and
            all(re.fullmatch(r'\s*\d+\s+\S+\s+\S.*', line) for line in rows))


def bundled_runner(metadata=None):
    """Read exact checksum-verified release JAR metadata without extracting code."""
    jars = list((native.PRIVATE / 'maestro').rglob('maestro-ios-driver.jar'))
    if len(jars) != 1:
        raise ValueError('Expected one pinned iOS driver JAR.')
    result = {'jar_sha256': hashlib.sha256(jars[0].read_bytes()).hexdigest(), 'bundles': []}
    with zipfile.ZipFile(jars[0]) as jar:
        name = 'driver-iPhoneSimulator/Debug-iphonesimulator/maestro-driver-iosUITests-Runner.zip'
        if jar.getinfo(name).file_size > 64 * 1024 * 1024:
            raise ValueError('Unexpected bundled runner size.')
        with zipfile.ZipFile(io.BytesIO(jar.read(name))) as runner:
            names = {
                'runner': RUNNER_NAME + '.app/Info.plist',
                'test_bundle': RUNNER_NAME + '.app/PlugIns/maestro-driver-iosUITests.xctest/Info.plist',
            }
            for kind, name in names.items():
                if runner.getinfo(name).file_size > LIMIT:
                    raise ValueError('Unexpected bundled plist size.')
                data = plistlib.loads(runner.read(name))
                sdk = re.fullmatch(r'iphonesimulator(\d+(?:\.\d+){0,2})(?:\.internal)?',
                                   str(data.get('DTSDKName', '')))
                result['bundles'].append({
                    'kind': kind, 'xcode_numeric': numeric(data.get('DTXcode')),
                    'sdk_version': sdk.group(1) if sdk else None,
                    'minimum_os_version': numeric(data.get('MinimumOSVersion')),
                })
    selected_sdk = numeric((metadata if metadata is not None else native.read()).get('toolchain', {}).get('sdk'))
    result['selected_sdk_version'] = selected_sdk
    for item in result['bundles']:
        item['built_with_newer_sdk_than_selected'] = (
            version(item['sdk_version']) > version(selected_sdk)) if selected_sdk and item['sdk_version'] else None
        item['minimum_os_exceeds_selected_sdk'] = (
            version(item['minimum_os_version']) > version(selected_sdk)) if selected_sdk and item['minimum_os_version'] else None
    return result


def baseline(device):
    """Check existing simulator app-service readiness before Maestro touches it."""
    facts = {'scope': 'Read-only simulator controls before hierarchy command.', 'commands': []}
    ps, result = capture(['ps', '-axo', 'pid=,stat=,args='], 'baseline-processes', 10)
    facts['commands'].append(result)
    frontend = [line for line in ps.splitlines() if '/Simulator.app/Contents/MacOS/Simulator' in line]
    known = process_inventory_known(ps, result)
    facts['simulator_frontend_process_count'] = len(frontend) if known else None
    selected = os.environ.get('DEVELOPER_DIR', '')
    # Export only a boolean comparison, never the process arguments or path.
    facts['selected_simulator_frontend_running'] = any(
        selected + '/Applications/Simulator.app/Contents/MacOS/Simulator' in line for line in frontend
    ) if selected and known else None
    for args, label in [
        (['xcrun', 'simctl', 'listapps', device], 'baseline-listapps'),
        (['xcrun', 'simctl', 'get_app_container', device, 'com.apple.Preferences', 'app'],
         'baseline-preferences-container'),
    ]:
        _, result = capture(args, label, 10)
        facts['commands'].append(result)
    return facts


def collect(device, metadata=None):
    facts = {'scope': 'Before owned simulator cleanup; driver setup only.',
             'collection_errors': [], 'commands': [], 'logs': []}
    metadata = metadata if metadata is not None else native.read()

    def command(args, label, timeout=20):
        payload, result = capture(args, label, timeout)
        facts['commands'].append(result)
        return payload, result

    try:
        facts['bundled_runner'] = bundled_runner(metadata)
    except Exception as error:
        facts['collection_errors'].append({'stage': 'bundled_runner', 'error_type': safe_error(error)})

    ps, process_result = command(['ps', '-axo', 'pid=,stat=,args='], 'processes')
    owned = [line for line in ps.splitlines()
             if 'xcodebuild' in line and device in line and 'test-without-building' in line]
    processes_known = process_inventory_known(ps, process_result)
    facts['owned_xcodebuild_process_count'] = len(owned) if processes_known else None
    facts['owned_xcodebuild_alive'] = bool(owned) if processes_known else None
    facts['owned_xcodebuild_zombie_count'] = sum(
        len(line.split(None, 2)) >= 2 and 'Z' in line.split(None, 2)[1] for line in owned) if processes_known else None
    pids = [int(line.split()[0]) for line in owned if re.match(r'^\s*\d+\s', line)] if processes_known else []
    # Sample only the exact owned-device xcodebuild; never all runner processes.
    if len(pids) == 1:
        sample_path = native.PRIVATE / 'driver-xcodebuild.sample'
        command(['sample', str(pids[0]), '3', '1', '-file', str(sample_path)], 'xcodebuild-sample', 15)
        try:
            payload, result = bounded(sample_path)
            result['stack_categories'] = [name for name, pattern in STACK_MARKERS.items()
                                          if re.search(pattern, payload, re.IGNORECASE)]
            facts['xcodebuild_sample'] = result
        except Exception as error:
            facts['collection_errors'].append({'stage': 'xcodebuild_sample', 'error_type': safe_error(error)})

    command(['xcodebuild', '-checkFirstLaunchStatus'], 'xcode-first-launch-status', 20)
    command(['xcrun', 'simctl', 'spawn', device, '/usr/bin/true'], 'simulator-spawn-control', 10)
    command(['xcrun', 'simctl', 'listapps', device], 'simulator-listapps', 20)
    command(['log', 'show', '--style', 'compact', '--last', '5m', '--predicate',
             'process == "xcodebuild" OR process == "CoreSimulatorService"'], 'host-xcode-simulator-events', 25)

    _, container = command(['xcrun', 'simctl', 'get_app_container', device, RUNNER_ID, 'app'], 'runner-installed')
    # Generic simctl failures do not establish that an app is absent.
    facts['runner_installed'] = True if container.get('exit_code') == 0 else None
    launchctl, launch_result = command(['xcrun', 'simctl', 'spawn', device, 'launchctl', 'list'], 'runner-running')
    runner_lines = [line for line in launchctl.splitlines() if RUNNER_ID in line]
    launch_rows = [line for line in launchctl.splitlines() if line.strip()]
    launch_known = (bool(launch_rows) and launch_result.get('exit_code') == 0 and not launch_result.get('truncated', False) and
                    all(re.fullmatch(r'\s*(?:\d+|-)\s+-?\d+\s+\S+\s*', line)
                        or re.fullmatch(r'\s*PID\s+Status\s+Label\s*', line) for line in launch_rows))
    facts['runner_launchctl_entries'] = len(runner_lines) if launch_known else None
    facts['runner_running'] = any(re.match(r'^\s*[1-9]\d*\s', line) for line in runner_lines) if launch_known else None
    facts['runner_last_exit_codes'] = [int(match.group(1)) for line in runner_lines
                                    if (match := re.match(r'^\s*(?:\d+|-)\s+(-?\d+)\s', line))][:4] if launch_known else []

    paths = []
    for index, entry in enumerate(metadata['commands'], 1):
        if entry['label'] == 'Check disposable iOS driver readiness':
            paths.append(('hierarchy-command', native.PRIVATE / ('command-%03d.log' % index)))
    state = native.PRIVATE / 'maestro-preflight-state' / 'maestro' / 'tests'
    for pattern, kind in [('**/maestro.log', 'maestro'), ('**/xctest_runner_*.log', 'xctest')]:
        paths.extend((kind, path) for path in sorted(state.glob(pattern))[:4])
    port = None
    for kind, path in paths[:9]:
        try:
            payload, result = bounded(path)
            facts['logs'].append({'kind': kind, **result})
            match = re.search(r'Running XcUITest with `xcodebuild test-without-building` with (\d+) and config:', payload)
            if match and 0 < int(match.group(1)) <= 65535:
                port = int(match.group(1))
        except Exception as error:
            facts['collection_errors'].append({'stage': kind, 'error_type': safe_error(error)})
    facts['driver_port'] = port
    if port is not None:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=2):
                facts['driver_tcp_connects'] = True
        except OSError:
            facts['driver_tcp_connects'] = False
        conn = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
        try:
            conn.request('GET', '/status')
            facts['driver_status_http_code'] = conn.getresponse().status
        except Exception as error:
            facts['driver_status_error_type'] = safe_error(error)
        finally:
            conn.close()

    predicate = 'process == "' + RUNNER_NAME + '" OR process == "testmanagerd"'
    command(['xcrun', 'simctl', 'spawn', device, 'log', 'show', '--style', 'compact',
             '--last', '5m', '--predicate', predicate], 'simulator-runner-events', 25)
    crash_dirs = [Path.home() / 'Library/Logs/DiagnosticReports',
                  Path.home() / 'Library/Developer/CoreSimulator/Devices' / device / 'data/Library/Logs/CrashReporter']
    crash_count = 0
    for directory in crash_dirs:
        if not directory.is_dir() or directory.is_symlink():
            continue
        for path in sorted(directory.glob('*'), key=lambda item: item.name):
            if crash_count >= 8:
                break
            if not path.is_file() or path.is_symlink() or not path.name.startswith((RUNNER_NAME, 'testmanagerd', 'xctest')):
                continue
            try:
                if time.time() - path.stat().st_mtime > 600:
                    continue
                with path.open('rb') as source:
                    payload = source.read(LIMIT)
                facts.setdefault('recent_crash_reports', []).append({
                    'prefix_bytes': len(payload), 'truncated': path.stat().st_size > LIMIT,
                    'categories': classify(payload.decode('utf-8', errors='replace')),
                })
                crash_count += 1
            except Exception as error:
                facts['collection_errors'].append({'stage': 'crash_report', 'error_type': safe_error(error)})
    return facts


def run():
    if native.PLATFORM != 'IOS' or os.environ.get('KEEPER_DIAGNOSTIC') != 'true':
        raise ValueError('Expected explicit iOS diagnostic environment.')
    os.environ['MAESTRO_CLI_NO_ANALYTICS'] = '1'
    native.record()
    native.install_maestro()
    original = native.command

    def observed(args, label, **kwargs):
        if label != 'Check disposable iOS driver readiness':
            return original(args, label, **kwargs)
        # Device is supplied by the unchanged owned-device driver path.
        device = args[args.index('--device') + 1]
        if not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', device):
            raise ValueError('Expected owned simulator UUID.')
        metadata = native.read()
        # command() appends exactly this entry when its worker starts. Keep the
        # index locally so collection never races its metadata file writes.
        metadata['commands'].append({'label': label})
        baseline_facts = {'collection_errors': []}
        try:
            baseline_facts = baseline(device)
        except Exception as error:
            baseline_facts['collection_errors'].append({'stage': 'baseline', 'error_type': safe_error(error)})
        facts = {'collection_errors': []}

        def snapshot(phase, future):
            started_while_running = not future.done()
            try:
                result = collect(device, metadata)
            except Exception as error:
                result = {'collection_errors': [{'stage': 'pre_cleanup', 'error_type': safe_error(error)}]}
            result.update(snapshot_phase=phase,
                          hierarchy_running_before_collection=started_while_running,
                          hierarchy_running_after_collection=not future.done())
            return result

        primary_failed = False
        try:
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(original, args, label, **kwargs)
                try:
                    result = future.result(timeout=POLL_SNAPSHOT_SECONDS)
                except FutureTimeoutError:
                    # Sample the owned xcodebuild before Maestro's exception
                    # cleanup can delete its test products and derived data.
                    facts = snapshot('DURING_DRIVER_POLLING' if not future.done() else 'AFTER_DRIVER_COMMAND', future)
                    return future.result()
                except Exception:
                    facts = snapshot('AFTER_DRIVER_COMMAND', future)
                    raise
                else:
                    facts = snapshot('AFTER_DRIVER_COMMAND', future)
                    return result
        except Exception:
            primary_failed = True
            raise
        finally:
            # Executor exit waits for the bounded original command. Persist only
            # now, after command() has finished its own metadata writes.
            facts['baseline'] = baseline_facts
            try:
                data = native.read()
                data['driver_diagnosis'] = facts
                native.save(data)
            except Exception:
                if not primary_failed:
                    raise RuntimeError('Driver diagnostic receipt failed.') from None

    native.command = observed
    try:
        native.run_phase('driver')
    finally:
        native.command = original


if __name__ == '__main__':
    try:
        run()
    except Exception:
        print('iOS driver diagnosis failed; inspect fixed metadata categories.', file=sys.stderr)
        sys.exit(1)
