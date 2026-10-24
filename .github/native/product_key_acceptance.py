"""Normal-app unused-key/PIN companion on the product runner's owned device.

No standalone device selector or fixture/database/credential injection is exposed.
This runs after the five healthy samples and separate setup Retry fixture, while
the same ordinary Metro process and disposable backend responder remain alive.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8766
STAGES = (
    'existing_disposable_home_verified', 'empty_deletion_entry_verified',
    'unused_mobile_key_created', 'delete_confirmation_scoped',
    'cancelled_confirmation_preserved_key', 'wrong_deletion_pin_rejected',
    'unused_mobile_key_deleted', 'unrelated_wallet_preserved',
    'cold_wrong_login_pin_rejected', 'deletion_persisted_after_relaunch',
    'final_wallet_verified',
)


def finalize_companion(result, save, operations, primary_failed, failure_code):
    """Visit every owned cleanup boundary and never replace a primary failure."""
    failures = []

    def failed(stage, error):
        category = type(error).__name__
        if category not in {'OSError', 'RuntimeError', 'FileNotFoundError',
                            'PermissionError', 'TimeoutError', 'TimeoutExpired'}:
            category = 'OTHER_ERROR'
        failures.append((stage, category))
        result.update(status='FAIL', cleanup='FAILED',
                      cleanup_failure_category=failures[0][1],
                      cleanup_failure_categories=sorted({kind for _, kind in failures}),
                      cleanup_failure_stages=sorted({name for name, _ in failures}))

    for stage, operation in operations:
        try:
            operation()
        except Exception as error:
            failed(stage, error)
    # Private UI output is disposed before any final receipt is persisted. If
    # writing itself fails, record that fixed failure and make one best effort
    # to persist FAIL; an earlier RUNNING receipt cannot become a stale PASS.
    try:
        save()
    except Exception as error:
        failed('evidence-save', error)
        try:
            save()
        except Exception as retry_error:
            failed('evidence-save', retry_error)
    if failures and not primary_failed:
        raise RuntimeError(failure_code)


def installed_proof(h, device):
    proof = h.verify_installed_artifact(device)
    method, hashes = {
        'ANDROID': ('SINGLE_INSTALLED_BASE_APK_SHA256', ['sha256']),
        'IOS': ('FULL_SIMULATOR_BUNDLE_TREE_AND_EXECUTABLE_SHA256',
                ['inventory_sha256', 'executable_sha256']),
    }[h.PLATFORM]
    metadata = h.read()
    if (not isinstance(proof, dict) or set(proof) != {'method', *hashes} or
            proof['method'] != method or
            any(not isinstance(proof[field], str) or not re.fullmatch(r'[a-f0-9]{64}', proof[field])
                for field in hashes) or metadata.get('installed_artifact_verified') is not True or
            metadata.get('installed_artifact') != proof):
        metadata['installed_artifact_verified'] = False
        metadata.pop('installed_artifact', None)
        h.save(metadata)
        raise RuntimeError('PRODUCT_UI_INSTALLED_BYTE_PROOF_REQUIRED')
    return proof


class Receipt:
    def __init__(self):
        self.lock = threading.Lock()
        self.completed = []

    def mark(self, stage):
        with self.lock:
            if len(self.completed) >= len(STAGES) or stage != STAGES[len(self.completed)]:
                return False
            self.completed.append(stage)
            return True

    def snapshot(self, passed=False):
        with self.lock:
            if passed and self.completed != list(STAGES):
                raise RuntimeError('PRODUCT_KEY_UI_INCOMPLETE')
            return {'status': 'PASS' if passed else 'FAIL',
                    'completed_stages': list(self.completed),
                    'entrypoint': 'index.js', 'network': 'TESTNET',
                    'scenario': 'UNUSED_MOBILE_KEY_UI_DELETE_AND_NATIVE_PIN',
                    'visible_eligible_keys_after_deletion': 0 if passed else None,
                    'unrelated_visible_wallet_count_after_relaunch': 1 if passed else None,
                    'referenced_vault_ui': 'NOT IMPLEMENTED',
                    'credential_store_read_fault': 'NOT RUN',
                    'physical_biometrics': 'NOT RUN',
                    'protected_backup_deletion': 'NOT TESTED',
                    'recovery_key_preservation': 'Not selected or exported; excluded by production deletion filters.'}


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


def run_companion(h, data, device, private, backend_receipt):
    if (os.environ.get('GITHUB_ACTIONS') != 'true' or
            os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted' or
            h.PLATFORM not in ['IOS', 'ANDROID'] or
            (h.PLATFORM == 'ANDROID' and not device.startswith('emulator-'))):
        raise RuntimeError('PRODUCT_KEY_UI_OWNED_HOSTED_DEVICE_REQUIRED')
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=h.ROOT, text=True).strip()
    if (data['build'] != 'PASS' or actual != data['source_sha'] or
            actual != os.environ.get('KEEPER_SOURCE_SHA') or
            h.artifact_identity() != data['built_artifact']):
        raise RuntimeError('PRODUCT_KEY_UI_EXACT_BUILD_REQUIRED')
    if subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--', '.github/native', 'src',
                       'index.js', 'App.tsx', 'metro.config.js', 'babel.config.js'],
                      cwd=h.ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        raise RuntimeError('PRODUCT_KEY_UI_COMMITTED_SOURCE_REQUIRED')
    # Do not adopt another installation or turn this companion into account setup.
    before = backend_receipt.snapshot(passed=True)
    if (before.get('status') != 'PASS' or before.get('sample') != 6 or
            before.get('scenario') != 'CONTROLLED_DISCONNECT_BEFORE_COMMIT_NOT_WAN_OFFLINE' or
            before.get('create_new_app_calls') != 2 or
            before.get('visible_wallet_count_after_relaunch') != 1):
        raise RuntimeError('PRODUCT_KEY_UI_DISPOSABLE_RETRY_FIXTURE_REQUIRED')
    output = Path(private) / 'key-ui'
    output.mkdir(mode=0o700)
    report = output / 'junit.xml'
    receipt = Receipt()
    result = receipt.snapshot()
    result['status'] = 'RUNNING'
    server = None

    def save():
        current = h.read()
        current['product_key_ui'] = result
        h.save(current)

    try:
        save()
        installed_before = installed_proof(h, device)
        server = make_server(receipt)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        h.command([data['maestro']['binary'], '--device', device, 'test',
                   '--env', 'APP_ID=' + h.APP_IDS[h.PLATFORM], '--flatten-debug-output',
                   '--debug-output', str(output), '--test-output-dir', str(output),
                   '--format', 'junit', '--output', str(report),
                   '.github/native/product_key_acceptance.yaml'],
                  'Normal-app unused-key deletion and native PIN rejection',
                  timeout=720, error_details=False)
        h.successful_junit(report)
        if h.artifact_identity() != data['built_artifact']:
            raise RuntimeError('PRODUCT_KEY_UI_ARTIFACT_CHANGED')
        installed_after = installed_proof(h, device)
        if installed_after != installed_before:
            raise RuntimeError('PRODUCT_KEY_UI_INSTALLED_BYTES_CHANGED')
        after = backend_receipt.snapshot(passed=True)
        if after['create_new_app_calls'] != before['create_new_app_calls']:
            raise RuntimeError('PRODUCT_KEY_UI_UNEXPECTED_ACCOUNT_SETUP')
        result = receipt.snapshot(passed=True)
        result['new_account_requests_during_key_flow'] = 0
        result['installed_artifact_verified'] = True
        result['installed_artifact'] = installed_after
    except Exception as error:
        result = receipt.snapshot()
        result['failure_category'] = type(error).__name__
        raise
    finally:
        operations = []
        if server:
            operations += [('server-shutdown', server.shutdown), ('server-close', server.server_close)]
        # Maestro output can contain transient screenshots/hierarchy/PIN actions;
        # retain no such files. The parent also deletes this suite's process logs.
        operations.append(('private-output', lambda: shutil.rmtree(output)))
        finalize_companion(result, save, operations, 'failure_category' in result,
                           'PRODUCT_KEY_UI_CLEANUP_FAILED')
    return result
