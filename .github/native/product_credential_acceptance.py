"""Malformed native-credential companion. No standalone device or account setup.

The parent owns the device, normal Metro process, disposable backend and eventual
device erasure. switch_entrypoint accepts arm/restore/product, stops that app and
Metro group, and starts the corresponding committed config. It must return only
after the selected bundle is warm. PRODUCT means the ordinary index.js bundle.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8767
STAGES = ('malformed_startup_blocked', 'retry_remains_blocked', 'malformed_cold_start_blocked',
          'restored_login_available', 'restored_wallet_preserved', 'restored_cold_wallet_preserved')


class Receipt:
    def __init__(self):
        self.lock = threading.Lock()
        self.completed = []
        self.phases = []

    def phase(self, value):
        with self.lock:
            expected = ['armed', 'restored']
            if len(self.phases) >= 2 or value != expected[len(self.phases)]:
                raise RuntimeError('PRODUCT_CREDENTIAL_PHASE_ORDER')
            if value == 'restored' and self.completed != list(STAGES[:3]):
                raise RuntimeError('PRODUCT_CREDENTIAL_BLOCKING_CHECKS_REQUIRED')
            self.phases.append(value)

    def mark(self, stage):
        with self.lock:
            required = ['armed'] if len(self.completed) < 3 else ['armed', 'restored']
            if (self.phases != required or len(self.completed) >= len(STAGES) or
                    stage != STAGES[len(self.completed)]):
                return False
            self.completed.append(stage)
            return True

    def snapshot(self, passed=False):
        with self.lock:
            if passed and (self.completed != list(STAGES) or self.phases != ['armed', 'restored']):
                raise RuntimeError('PRODUCT_CREDENTIAL_INCOMPLETE')
            return {'status': 'PASS' if passed else 'FAIL', 'completed_stages': list(self.completed),
                    'fixture_phases': list(self.phases), 'entrypoint_under_test': 'index.js',
                    'scenario': 'ACTUAL_KEYCHAIN_CONTROLLED_MALFORMED_JSON',
                    'native_credential_api': 'react-native-keychain',
                    'original_credential_exported': False,
                    'backup_service_removed_after_verified_restore': passed,
                    'visible_wallet_count_after_recovery_and_cold_login': 1 if passed else None,
                    'successfully_empty_store': 'REJECTED_FIXTURE_PRECONDITION_NOT_A_READ_ERROR',
                    'retry_scope': 'User taps Retry while malformed value persists; blocking UI remains. Native read-call count is not instrumented.',
                    'os_keychain_denial_or_hardware_read_fault': 'NOT RUN',
                    'same_process_retry_after_external_repair': 'NOT RUN',
                    'physical_devices': 'NOT RUN', 'backend_compatibility': 'NOT TESTED'}


def make_server(receipt, port=PORT):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, status):
            self.send_response(status)
            self.send_header('Content-Length', '0')
            self.end_headers()

        def do_POST(self):
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if self.path != '/metric' or not 0 < length <= 128:
                    self.close_connection = True
                    return self.reply(422)
                metric = json.loads(self.rfile.read(length))
                if (isinstance(metric, dict) and set(metric) == {'stage'} and
                        receipt.mark(metric['stage'])):
                    return self.reply(200)
            except (ValueError, TypeError):
                pass
            self.reply(422)

        def do_GET(self):
            self.reply(405)

    class Server(ThreadingHTTPServer):
        allow_reuse_address = False
        daemon_threads = True
    return Server(('127.0.0.1', port), Handler)


def run_companion(h, data, device, private, backend_receipt, switch_entrypoint):
    if (os.environ.get('GITHUB_ACTIONS') != 'true' or
            os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted' or
            h.PLATFORM not in ('IOS', 'ANDROID') or
            not re.fullmatch(r'emulator-[0-9]+' if h.PLATFORM == 'ANDROID' else
                             r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', device)):
        raise RuntimeError('PRODUCT_CREDENTIAL_OWNED_HOSTED_DEVICE_REQUIRED')
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=h.ROOT, text=True).strip()
    if (data['build'] != 'PASS' or actual != data['source_sha'] or
            actual != os.environ.get('KEEPER_SOURCE_SHA') or
            h.artifact_identity() != data['built_artifact']):
        raise RuntimeError('PRODUCT_CREDENTIAL_EXACT_BUILD_REQUIRED')
    if subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--', '.github/native', 'src',
                       'index.js', 'App.tsx', 'metro.config.js', 'babel.config.js'],
                      cwd=h.ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        raise RuntimeError('PRODUCT_CREDENTIAL_COMMITTED_SOURCE_REQUIRED')
    before = backend_receipt.snapshot(passed=True)
    if (before.get('sample') != 6 or before.get('status') != 'PASS' or
            before.get('scenario') != 'CONTROLLED_DISCONNECT_BEFORE_COMMIT_NOT_WAN_OFFLINE' or
            before.get('create_new_app_calls') != 2 or
            before.get('visible_wallet_count_after_relaunch') != 1 or
            h.read().get('product_key_ui', {}).get('status') != 'PASS'):
        raise RuntimeError('PRODUCT_CREDENTIAL_PRIOR_DISPOSABLE_UI_REQUIRED')
    spec = importlib.util.spec_from_file_location('product_key_acceptance',
        Path(__file__).with_name('product_key_acceptance.py'))
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    receipt = Receipt()
    output = Path(private) / 'credential-ui'
    output.mkdir(mode=0o700)
    result = receipt.snapshot()
    result['status'] = 'RUNNING'
    server = None

    def save():
        current = h.read()
        current['product_credential_ui'] = result
        h.save(current)

    def flow(filename, stage=None):
        folder = output / (filename.removesuffix('.yaml') + ('-' + stage if stage else ''))
        folder.mkdir()
        report = folder / 'junit.xml'
        arguments = [data['maestro']['binary'], '--device', device, 'test',
                     '--env', 'APP_ID=' + h.APP_IDS[h.PLATFORM]]
        if stage:
            arguments += ['--env', 'FIXTURE_STAGE=' + stage]
        h.command([*arguments, '--flatten-debug-output', '--debug-output', str(folder),
                   '--test-output-dir', str(folder), '--format', 'junit', '--output', str(report),
                   '.github/native/' + filename], 'Disposable credential acceptance phase',
                  timeout=240, error_details=False)
        h.successful_junit(report)

    try:
        save()
        installed_before = helper.installed_proof(h, device)
        if h.PLATFORM == 'ANDROID':
            h.command(['adb', '-s', device, 'reverse', 'tcp:8767', 'tcp:8767'],
                      'Connect owned credential receipt endpoint', error_details=False)
        server = make_server(receipt)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        switch_entrypoint('arm')
        flow('credential_fixture.yaml', 'armed')
        receipt.phase('armed')
        switch_entrypoint('product')
        flow('product_credential_blocked.yaml')
        switch_entrypoint('restore')
        flow('credential_fixture.yaml', 'restored')
        receipt.phase('restored')
        switch_entrypoint('product')
        flow('product_credential_recovered.yaml')
        if h.artifact_identity() != data['built_artifact']:
            raise RuntimeError('PRODUCT_CREDENTIAL_ARTIFACT_CHANGED')
        installed_after = helper.installed_proof(h, device)
        if installed_after != installed_before:
            raise RuntimeError('PRODUCT_CREDENTIAL_INSTALLED_BYTES_CHANGED')
        after = backend_receipt.snapshot(passed=True)
        if after['create_new_app_calls'] != before['create_new_app_calls']:
            raise RuntimeError('PRODUCT_CREDENTIAL_UNEXPECTED_ACCOUNT_SETUP')
        result = receipt.snapshot(passed=True)
        result.update(new_account_requests_during_credential_flow=0,
                      installed_artifact_verified=True, installed_artifact=installed_after)
    except Exception as error:
        result = receipt.snapshot()
        result['failure_category'] = type(error).__name__
        raise
    finally:
        operations = []
        if server:
            operations += [('server-shutdown', server.shutdown), ('server-close', server.server_close)]
        # On any failure the parent destroys this owned device, including its
        # test-only backup service. Do not inspect, pull or print Keychain files.
        operations.append(('private-output', lambda: shutil.rmtree(output)))
        helper.finalize_companion(result, save, operations, 'failure_category' in result,
                                  'PRODUCT_CREDENTIAL_CLEANUP_FAILED')
    return result
