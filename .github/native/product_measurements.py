#!/usr/bin/env python3
"""Five full-product UI samples and one separate controlled Retry fixture.

Requires the hosted_native.py foundation and its successful exact-source build.
Normal Metro entrypoint is mandatory. The loopback responder is a controlled
createNewApp transport fixture, NEVER evidence of Relay compatibility.
"""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STAGES = ('startup_start', 'startup_ready', 'wallet_start', 'wallet_ready',
          'home_ready', 'relaunch_start', 'relaunch_login', 'relaunch_home',
          'version_history_verified', 'key_management_entry_verified', 'navigation_verified')
RETRY_STAGES = ('retry_fixture_start', 'retry_error_visible', 'retry_submit', 'retry_home_ready',
                'retry_relaunch_start', 'retry_relaunch_login', 'retry_relaunch_home')
PORT = 8765
SAMPLE_COUNT = 5
PIN_MARKERS = ('confirm_passcode_visible', 'confirmation_digits_tapped', 'create_tapped',
               'continue_visible', 'continue_tapped', 'cancel_visible', 'cancel_tapped',
               'skip_visible', 'skip_tapped', 'start_new_visible')


def native_module(name):
    if name not in ('product_metro', 'product_failure_diagnosis', 'product_credential_acceptance',
                    'product_history_acceptance', 'product_vault_acceptance'):
        raise RuntimeError('PRODUCT_UI_FIXED_COMPANION_REQUIRED')
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_post_key_companions(h, data, device, private, receipt, metro, installed_proof, result):
    """Ordering preserves the original one-account/one-wallet fixture until Vault."""
    for slot, name in (('credential_errors_ui', 'product_credential_acceptance'),
                       ('version_history_ui', 'product_history_acceptance'),
                       ('vault_references_ui', 'product_vault_acceptance')):
        metro.ensure_product()
        companion = native_module(name)
        argument = installed_proof if name == 'product_vault_acceptance' else metro.switch
        result[slot] = companion.run_companion(h, data, device, private, receipt, argument)
        metro.ensure_product()


def android_failure_observation(private, device):
    """Best-effort fixed runtime facts; never replace the sample's failure."""
    scope = 'Failed sample runtime only; no current product Metro log is supplied. Cause remains undetermined.'
    try:
        spec = importlib.util.spec_from_file_location('product_android_failure_diagnosis',
            Path(__file__).with_name('android_startup_diagnosis.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return {'status': 'COLLECTED', 'scope': scope, 'facts': module.collect(private, device)}
    except Exception:
        return {'status': 'UNAVAILABLE', 'scope': scope}


def prepare_failure_observation(metro):
    try:
        module = native_module('product_failure_diagnosis')
        return module, module.bind_metro(metro)
    except Exception:
        return None


def sample_failure_observation(private, flow, metro, observer):
    try:
        module, binding = observer or (native_module('product_failure_diagnosis'), None)
        return module.collect(private, flow, metro, binding)
    except Exception:
        return {'status': 'UNKNOWN', 'scope': 'Failed-sample observation unavailable; original failure retained.'}


def sample_failed_assertion_snapshot(private, flow, failure_observation, observer):
    """Optional adjacent receipt; keep the existing four-field observation intact."""
    try:
        failure = failure_observation.get('junit')
        module, _ = observer or (native_module('product_failure_diagnosis'), None)
        return module.failed_assertion_snapshot(private, flow, failure)
    except Exception:
        return {'schema': 1, 'binding_state': 'UNKNOWN', 'reason': 'COLLECTOR_UNAVAILABLE',
                'scope': 'POST_FAILED_ASSERT_OUTCOME_NOT_TAP_TIME'}


class Receipt:
    """Fixed vocabulary and numbers only; never store a request body/identifier."""
    def __init__(self):
        self.lock = threading.Lock()
        self.reset(1)

    def reset(self, sample, retry=False):
        with self.lock:
            self.sample, self.times = sample, []
            self.create_calls, self.blocked_calls = 0, 0
            self.retry, self.stages = retry, RETRY_STAGES if retry else STAGES
            self.dropped, self.acknowledged, self.unexpected = 0, 0, 0
            self.pin_marker_count = 0

    def create_attempt(self):
        with self.lock:
            self.create_calls += 1
            if self.retry and self.create_calls == 1:
                self.dropped += 1
                return False
            if self.retry and self.stages[len(self.times) - 1] != 'retry_submit':
                self.unexpected += 1
            self.acknowledged += 1
            return True

    def mark(self, stage):
        with self.lock:
            if len(self.times) >= len(self.stages) or stage != self.stages[len(self.times)]:
                return False
            if self.retry and stage in ('retry_error_visible', 'retry_submit') and (
                    self.create_calls, self.dropped, self.acknowledged, self.unexpected) != (1, 1, 0, 0):
                return False
            self.times.append(time.monotonic_ns())
            return True

    def mark_pin(self, marker):
        """Record a fixed prefix independently of performance/backend state."""
        with self.lock:
            if (type(marker) is not str or self.pin_marker_count >= len(PIN_MARKERS)
                    or marker != PIN_MARKERS[self.pin_marker_count]):
                return False
            self.pin_marker_count += 1
            return True

    def snapshot(self, passed=False):
        with self.lock:
            pin_progress = {
                'scope': 'Host marker acknowledgements only; missing markers do not identify an app defect.',
                'completed_markers': list(PIN_MARKERS[:self.pin_marker_count]),
                'next_marker': PIN_MARKERS[self.pin_marker_count] if self.pin_marker_count < len(PIN_MARKERS) else None,
                'complete': self.pin_marker_count == len(PIN_MARKERS),
            }
            if self.retry:
                if passed and (len(self.times) != len(RETRY_STAGES) or
                               (self.create_calls, self.dropped, self.acknowledged, self.unexpected) != (2, 1, 1, 0)):
                    raise RuntimeError('PRODUCT_UI_RETRY_INCOMPLETE_OR_UNEXPECTED_REQUEST')
                stages = list(RETRY_STAGES[:len(self.times)])
                return {'sample': self.sample, 'status': 'PASS' if passed else 'FAIL',
                        'scenario': 'CONTROLLED_DISCONNECT_BEFORE_COMMIT_NOT_WAN_OFFLINE',
                        'completed_stages': stages, 'create_new_app_calls': self.create_calls,
                        'pin_onboarding_progress': pin_progress,
                        'transport_requests_dropped_without_commit': self.dropped,
                        'acknowledged_create_responses': self.acknowledged,
                        'unexpected_create_attempts': self.unexpected,
                        'other_backend_calls_rejected': self.blocked_calls,
                        'visible_wallet_count_before_relaunch': 1 if 'retry_home_ready' in stages else None,
                        'visible_wallet_count_after_relaunch': 1 if 'retry_relaunch_home' in stages else None,
                        'performance_sample': False}
            if passed and (len(self.times) != len(STAGES) or self.create_calls != 1):
                raise RuntimeError('PRODUCT_UI_INCOMPLETE_OR_DUPLICATE_SETUP')
            stamps = dict(zip(STAGES, self.times))
            pairs = {
                'startup_to_passcode_ms': ('startup_start', 'startup_ready'),
                'start_new_to_ready_ms': ('wallet_start', 'wallet_ready'),
                'start_new_to_home_ms': ('wallet_start', 'home_ready'),
                'cold_relaunch_to_login_ms': ('relaunch_start', 'relaunch_login'),
                'cold_relaunch_to_authenticated_home_ms': ('relaunch_start', 'relaunch_home'),
            }
            durations = {name: round((stamps[end] - stamps[start]) / 1_000_000, 3)
                         for name, (start, end) in pairs.items() if end in stamps and start in stamps}
            return {'sample': self.sample, 'status': 'PASS' if passed else 'FAIL',
                    'completed_stages': list(STAGES[:len(self.times)]), 'raw_durations': durations,
                    'pin_onboarding_progress': pin_progress,
                    'create_new_app_calls': self.create_calls, 'other_backend_calls_rejected': self.blocked_calls,
                    'visible_wallet_count_before_relaunch': 1 if 'home_ready' in stamps else None,
                    'visible_wallet_count_after_relaunch': 1 if 'relaunch_home' in stamps else None,
                    'installed_version_header_and_initial_history': 'PASS' if 'version_history_verified' in stamps else 'NOT RUN',
                    'key_management_entry_and_exit': 'PASS' if 'key_management_entry_verified' in stamps else 'NOT RUN',
                    'more_wallets_navigation': 'PASS' if 'navigation_verified' in stamps else 'NOT RUN'}


def make_server(receipt, port=PORT):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, status, value):
            raw = json.dumps(value).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_POST(self):
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if self.path == '/pin-progress' and not 0 < length <= 128:
                    self.close_connection = True
                    return self.reply(413, {'error': 'FIXED_PIN_PROGRESS_REJECTED'})
                if not 0 < length <= 8192:
                    self.close_connection = True
                    return self.reply(413, {'error': 'FIXTURE_BODY_REJECTED'})
                # createNewApp carries disposable public identifiers/FCM data.
                # Discard without parsing, logging, echoing or retaining them.
                raw = self.rfile.read(length)
                if self.path == '/createNewApp':
                    if not receipt.create_attempt():
                        # Controlled transport failure only: no account storage
                        # or simulated server commit exists in this responder.
                        self.close_connection = True
                        try:
                            self.connection.shutdown(socket.SHUT_RDWR)
                        except OSError:
                            pass
                        self.connection.close()
                        return
                    return self.reply(200, {'created': True})
                if self.path == '/pin-progress':
                    def unique_object(pairs):
                        if len(pairs) != len({key for key, _ in pairs}):
                            raise ValueError('Duplicate fields')
                        return dict(pairs)
                    try:
                        marker = json.loads(raw, object_pairs_hook=unique_object)
                        if (type(marker) is dict and set(marker) == {'marker'} and
                                receipt.mark_pin(marker['marker'])):
                            return self.reply(200, {'accepted': True})
                    except (ValueError, TypeError):
                        pass
                    return self.reply(422, {'error': 'FIXED_PIN_PROGRESS_REJECTED'})
                if self.path == '/metric' and length <= 128:
                    metric = json.loads(raw)
                    if (isinstance(metric, dict) and set(metric) == {'stage'} and
                            receipt.mark(metric['stage'])):
                        return self.reply(200, {'accepted': True})
                    return self.reply(422, {'error': 'FIXED_METRIC_REJECTED'})
            except (ValueError, TypeError):
                return self.reply(422, {'error': 'FIXED_METRIC_REJECTED'})
            with receipt.lock:
                receipt.blocked_calls += 1
            self.reply(503, {'error': 'DISPOSABLE_FIXTURE_UNSUPPORTED_ROUTE'})

        def do_GET(self):
            with receipt.lock:
                receipt.blocked_calls += 1
            self.reply(503, {'error': 'DISPOSABLE_FIXTURE_UNSUPPORTED_ROUTE'})

    class Server(ThreadingHTTPServer):
        allow_reuse_address = False
        daemon_threads = True

    return Server(('127.0.0.1', port), Handler)


def verify_package_overlay(original_bytes, installed_bytes, overlay):
    """Accept only the foundation's exact recorded module-mapping overlay."""
    allowed = ['browser', 'react-native', 'browserify']
    if (not isinstance(overlay, dict) or overlay.get('path') != 'package.json' or
            overlay.get('allowed_fields') != allowed or
            overlay.get('before_sha256') != hashlib.sha256(original_bytes).hexdigest() or
            overlay.get('after_sha256') != hashlib.sha256(installed_bytes).hexdigest()):
        raise RuntimeError('PRODUCT_UI_PACKAGE_OVERLAY_UNRECORDED')
    try:
        original, installed = json.loads(original_bytes), json.loads(installed_bytes)
        if not isinstance(original, dict) or not isinstance(installed, dict):
            raise ValueError('Expected manifest objects')
        for field in allowed:
            original.pop(field, None)
            installed.pop(field, None)
        if original != installed:
            raise ValueError('Protected manifest fields changed')
    except (ValueError, TypeError, UnicodeError):
        raise RuntimeError('PRODUCT_UI_PACKAGE_PROTECTED_FIELDS_CHANGED') from None


def version_expectation(manifest, platform):
    field = {'IOS': 'iosBuildNumber', 'ANDROID': 'androidVersionCode'}.get(platform)
    version = manifest.get('version')
    build = manifest.get(field)
    if (field is None or not isinstance(version, str) or
            not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version) or
            type(build) is not int or not 0 < build <= 2100000000):
        raise RuntimeError('PRODUCT_UI_SOURCE_VERSION_INVALID')
    escaped = version.replace('.', r'\.')
    return {'version': version, 'build': build,
            'installed_regex': '^' + escaped + r' \(' + str(build) + r'\)$',
            'history_regex': '^' + escaped + r'\(' + str(build) + r'\)$'}


def run(h):
    if (os.environ.get('GITHUB_ACTIONS') != 'true' or
            os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted'):
        raise RuntimeError('PRODUCT_UI_DISPOSABLE_HOSTED_RUNNER_REQUIRED')
    data = h.read()
    first_private_command = len(data.get('commands', [])) + 1
    actual_source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=h.ROOT, text=True).strip()
    if (data['build'] != 'PASS' or data['source_sha'] != os.environ.get('KEEPER_SOURCE_SHA') or
            actual_source != data['source_sha'] or h.artifact_identity() != data['built_artifact']):
        raise RuntimeError('PRODUCT_UI_EXACT_BUILD_REQUIRED')
    source_paths = ['.github/native', 'src', 'index.js', 'App.tsx', 'App.js', 'shim.js',
                    'AndroidFontFix.js', 'metro.config.js', 'babel.config.js', 'app.json',
                    'react-native.config.js', 'tsconfig.json', 'yarn.lock', 'release/version.json']
    if subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--', *source_paths],
                      cwd=h.ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        raise RuntimeError('PRODUCT_UI_COMMITTED_SOURCE_REQUIRED')
    verify_package_overlay(
        subprocess.check_output(['git', 'show', 'HEAD:package.json'], cwd=h.ROOT),
        (h.ROOT / 'package.json').read_bytes(), data.get('nodeify_overlay'))
    expected_version = version_expectation(json.loads((h.ROOT / 'release/version.json').read_text()), h.PLATFORM)
    expected_environment = {
        'ENVIRONMENT': 'DEVELOPMENT', 'RELAY': 'http://127.0.0.1:8765/',
        'SIGNING_SERVER_TESTNET': 'https://127.0.0.1:9/',
        'SIGNING_SERVER_MAINNET': 'https://127.0.0.1:9/',
        'CHANNEL_URL': 'https://127.0.0.1:9/',
        'SENTRY_DNS': 'https://public@127.0.0.1:9/1',
        'ENC_KEY_STORAGE_IDENTIFIER': 'KEEPER-HOSTED-DISPOSABLE',
    }
    environment_lines = (h.ROOT / '.env.ci').read_text().splitlines()
    if (len(environment_lines) != len(expected_environment) or
            dict(line.split('=', 1) for line in environment_lines) != expected_environment):
        raise RuntimeError('PRODUCT_UI_LOOPBACK_BUILD_REQUIRED')
    private = Path(tempfile.mkdtemp(prefix='keeper-product-ui-', dir=h.PRIVATE))
    private.chmod(0o700)
    receipt = Receipt()
    server, device = None, None
    metro_tools = native_module('product_metro')
    metro = metro_tools.OwnedMetro(h, private)
    reverse_ports = set()
    # Only app/test-specific data created here is removed. Never touch shared
    # caches, another worktree, an existing iOS simulator or a real phone.
    result = {'status': 'RUNNING', 'samples': [], 'requested_samples': SAMPLE_COUNT,
              'controlled_disconnect_retry': {'status': 'NOT RUN', 'performance_sample': False},
              'entrypoint': 'index.js', 'network': 'TESTNET', 'backend': 'CONTROLLED_LOOPBACK_CREATE_ONLY',
              'expected_installed_version': expected_version['version'],
              'expected_installed_build': expected_version['build'],
              'version_history_scope': 'Initial samples inspect the installed native tuple and initial row; controlled stale/empty cases have a separate companion receipt. Authentic historical migration is not tested.',
              'key_management_scope': 'Discoverable Keys→Manage Keys screen entry and back navigation only; no eligible disposable signer, deletion confirmation or seed view.',
              'backend_compatibility': 'NOT TESTED', 'physical_devices': 'NOT RUN',
              'r5_release_acceptance': 'NOT ESTABLISHED; these are scoped diagnostic companions.',
              'performance_scope': 'Development app with warm Metro bundle; cold process/UI timing includes Maestro driver overhead. Not release-build performance.',
              'count_scope': 'Actual rendered visible wallet list; disposable one-wallet account, not hidden/archived wallet counts.',
              'network_scope': 'Fresh production Splash selects Testnet for DEVELOPMENT. Account backend is loopback fixture; signing/channel/Sentry endpoints blocked. Public Testnet Electrum connectivity may fail or connect; no faucet, funded wallet, send, signing or backup opt-in.'}

    def save():
        current = h.read()
        current['product_ui'] = result
        h.save(current)

    try:
        save()
        server = make_server(receipt)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        # Only this manager starts/records the ordinary or fixed fixture Metro.
        metro.start('product', initial=True)
        if h.PLATFORM == 'IOS':
            device = h.command(['xcrun', 'simctl', 'create', 'Keeper-product-ui-disposable',
                                'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
                                'com.apple.CoreSimulator.SimRuntime.iOS-18-5'],
                               'Create task-owned product UI simulator', capture=True)
            h.command(['xcrun', 'simctl', 'boot', device], 'Boot product UI simulator')
            h.command(['xcrun', 'simctl', 'bootstatus', device, '-b'], 'Wait for product UI simulator', timeout=240)
            h.wait_for_simulator_app_services(device)
            artifact = str(h.PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app')
            result['device'] = {'profile': 'iPhone 16', 'runtime': 'iOS 18.5', 'kind': 'SIMULATOR'}
        else:
            device = h.command(['adb', 'get-serialno'], 'Select disposable CI emulator', capture=True)
            if not device.startswith('emulator-'):
                raise RuntimeError('PRODUCT_UI_REAL_ANDROID_DEVICE_REJECTED')
            for port in ('8081', str(PORT)):
                h.command(['adb', '-s', device, 'reverse', 'tcp:' + port, 'tcp:' + port],
                          'Connect disposable emulator to local fixture')
                reverse_ports.add(port)
            artifact = str(h.ROOT / 'android/app/build/outputs/apk/development/debug/app-development-debug.apk')
            result['device'] = {'kind': 'EMULATOR', 'image': h.command(
                ['adb', '-s', device, 'shell', 'getprop', 'ro.build.fingerprint'],
                'Record actual product UI emulator image', capture=True)}
        app = h.APP_IDS[h.PLATFORM]
        spec = importlib.util.spec_from_file_location(
            'product_key_acceptance', Path(__file__).with_name('product_key_acceptance.py'))
        key_companion = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(key_companion)
        for sample in range(1, SAMPLE_COUNT + 2):
            retry_fixture = sample == SAMPLE_COUNT + 1
            receipt.reset(sample, retry=retry_fixture)
            output = private / ('sample-%d' % sample)
            output.mkdir()
            report = output / 'junit.xml'
            if h.PLATFORM == 'IOS':
                # Uninstall plus reset of this newly-created simulator's
                # keychain prevents prior sample credentials persisting.
                subprocess.run(['xcrun', 'simctl', 'uninstall', device, app],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30, check=False)
                h.command(['xcrun', 'simctl', 'keychain', device, 'reset'], 'Reset task-owned simulator credentials')
                h.command(['xcrun', 'simctl', 'install', device, artifact], 'Install exact product UI app', timeout=120)
            else:
                h.command(['adb', '-s', device, 'install', '-r', artifact], 'Install exact product UI APK', timeout=120)
                h.command(['adb', '-s', device, 'shell', 'pm', 'clear', app], 'Clear only disposable development app')
            flow = 'product_retry.yaml' if retry_fixture else 'product_first_wallet.yaml'
            observer = None
            try:
                installed_before = key_companion.installed_proof(h, device)
                observer = prepare_failure_observation(metro)
                h.command([data['maestro']['binary'], '--device', device, 'test',
                           '--env', 'APP_ID=' + app,
                           '--env', 'EXPECTED_INSTALLED_REGEX=' + expected_version['installed_regex'],
                           '--env', 'EXPECTED_HISTORY_REGEX=' + expected_version['history_regex'],
                           '--flatten-debug-output',
                           '--debug-output', str(output), '--test-output-dir', str(output),
                           '--format', 'junit', '--output', str(report),
                           '.github/native/' + flow],
                          'Full-product controlled disconnect and Retry fixture' if retry_fixture else
                          'Full-product first-wallet and relaunch UI sample', timeout=600, error_details=False)
                h.successful_junit(report)
                if h.artifact_identity() != data['built_artifact']:
                    raise RuntimeError('PRODUCT_UI_ARTIFACT_CHANGED')
                installed_after = key_companion.installed_proof(h, device)
                if installed_before != installed_after:
                    raise RuntimeError('PRODUCT_UI_INSTALLED_BYTES_CHANGED')
                outcome = receipt.snapshot(passed=True)
                outcome['installed_artifact_verified'] = True
                outcome['installed_artifact'] = installed_after
                if retry_fixture:
                    result['controlled_disconnect_retry'] = outcome
                else:
                    result['samples'].append(outcome)
            except Exception:
                outcome = receipt.snapshot()
                outcome['failure_observation'] = sample_failure_observation(output, flow, metro, observer)
                outcome['failed_assertion_snapshot'] = sample_failed_assertion_snapshot(
                    output, flow, outcome['failure_observation'], observer)
                if h.PLATFORM == 'ANDROID':
                    outcome['android_runtime_diagnostic'] = android_failure_observation(output, device)
                if retry_fixture:
                    result['controlled_disconnect_retry'] = outcome
                else:
                    result['samples'].append(outcome)
                raise
            finally:
                # Maestro can capture automatic failure diagnostics. Keep no
                # screenshots, hierarchy, PIN actions or app output artifacts.
                shutil.rmtree(output, ignore_errors=True)
            save()
        # Separate normal-app UI companion; never part of the five latency
        # samples or the controlled setup-disconnect receipt vocabulary.
        # The facade grants switching only after the matching successful
        # JUnit from a committed allowlisted flow whose final command is stopApp.
        flow_harness = metro_tools.StoppedFlowHarness(h, data, device, private, metro, reverse_ports)
        result['key_management_ui'] = key_companion.run_companion(flow_harness, data, device, private, receipt)
        result['key_management_scope'] = (
            'Normal-app unused Mobile Key creation/deletion, cancellation, wrong PIN rejection, '
            'correct PIN retry, cold deletion persistence and unrelated wallet retention. '
            'Physical biometrics remain unverified; the following receipts have separate scopes.')
        run_post_key_companions(flow_harness, data, device, private, receipt,
                                metro, key_companion.installed_proof, result)
        result['version_history_scope'] = (
            'Installed native tuple/initial row plus controlled stale/empty actual native Realm histories, '
            'ordinary cold-login observation/provenance/date/idempotence and exact restoration. '
            'Authentic historical installation and migration remain unverified.')
        save()
        result['status'] = 'PASS'
    except Exception as error:
        result['status'] = 'FAIL'
        result['failure_category'] = type(error).__name__  # never raw error text
        raise
    finally:
        # Save original outcome before best-effort disposal so a cleanup issue
        # cannot erase a native failure or the completed raw numeric samples.
        original_failed = result['status'] == 'FAIL'
        cleanup_errors = []

        def attempt(operation):
            try:
                operation()
            except Exception as cleanup_error:
                cleanup_errors.append(type(cleanup_error).__name__)
                result.update(status='FAIL', cleanup='FAILED',
                              cleanup_failure_categories=sorted(set(cleanup_errors)))

        result['companion_metro_switches'] = list(metro.events)
        attempt(save)
        # Stop/reap every recorded child before device and private-log removal,
        # including the newest child when its readiness/warmup failed.
        attempt(metro.close)
        if server:
            attempt(server.shutdown)
            attempt(server.server_close)

        def cleanup(args):
            def execute():
                if subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  timeout=30, check=False).returncode:
                    raise RuntimeError('PRODUCT_UI_DISPOSABLE_CLEANUP_COMMAND_FAILED')
            attempt(execute)

        if device and h.PLATFORM == 'IOS':
            for action in ('shutdown', 'delete'):
                cleanup(['xcrun', 'simctl', action, device])
        elif device and device.startswith('emulator-'):
            cleanup(['adb', '-s', device, 'uninstall', h.APP_IDS[h.PLATFORM]])
            for port in sorted(reverse_ports):
                cleanup(['adb', '-s', device, 'reverse', '--remove', 'tcp:' + port])
        attempt(lambda: shutil.rmtree(private))
        # Foundation command metadata is safe/nonsecret; its process logs from
        # this suite are not retained even on the ephemeral runner.
        def remove_command_logs():
            for index in range(first_private_command, len(h.read().get('commands', [])) + 1):
                (h.PRIVATE / ('command-%03d.log' % index)).unlink(missing_ok=True)
        attempt(remove_command_logs)
        attempt(save)
        if cleanup_errors and not original_failed:
            raise RuntimeError('PRODUCT_UI_DISPOSABLE_CLEANUP_FAILED')


if __name__ == '__main__':
    import sys
    if sys.argv[1:] != ['run']:
        raise SystemExit('Expected run; hosted exact-source build prerequisite required.')
    spec = importlib.util.spec_from_file_location('hosted_native', Path(__file__).with_name('hosted_native.py'))
    foundation = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(foundation)
    if foundation.PLATFORM not in foundation.APP_IDS:
        raise SystemExit('Expected hosted IOS or ANDROID platform.')
    run(foundation)
