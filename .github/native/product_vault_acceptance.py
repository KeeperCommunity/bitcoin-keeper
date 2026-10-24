"""Real normal-app Vault reference UI companion, scheduled by product runner.

No device discovery, database/credential injection, build, standalone CLI or
native scheduling entrypoint. The coordinator owns the existing Metro/device.
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8769
STAGES = (
    'predecessor_fixture_verified', 'native_mobile_and_public_seed_created',
    'real_two_of_two_vault_created', 'visible_reference_blocks_mobile_deletion',
    'hidden_reference_blocks_without_name_after_relaunch',
    'vault_unhidden_with_correct_native_pin',
    'zero_balance_rotation_retained_original_archive',
    'archived_only_mobile_logically_archived',
    'archived_vault_reinstated_after_cold_restart',
    'retained_mobile_key_is_protected_again',
    'unrelated_wallet_preserved_final_count_three',
)


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
                raise RuntimeError('PRODUCT_VAULT_UI_INCOMPLETE')
            return {
                'status': 'PASS' if passed else 'FAIL',
                'completed_stages': list(self.completed),
                'entrypoint': 'index.js', 'network': 'TESTNET',
                'scenario': 'NORMAL_UI_TWO_OF_TWO_MOBILE_PUBLIC_SEED_VAULT_REFERENCES',
                'seed_fixture_origin': 'PUBLIC_BIP39_REFERENCE_VECTORS_DERIVED_BY_APP',
                'mobile_key_origin': 'NORMAL_MY_KEEPER_GENERATION_WITH_NATIVE_PIN',
                'visible_reference_ui': 'PASS' if passed else 'NOT ESTABLISHED',
                'hidden_reference_ui': 'PASS' if passed else 'NOT ESTABLISHED',
                'archived_only_key_semantics': (
                    'LOGICAL_ARCHIVE_AND_REINSTATE_VERIFIED' if passed else 'NOT ESTABLISHED'),
                'archived_signer_record_retention_ui': 'PASS' if passed else 'NOT ESTABLISHED',
                'native_private_material_exactness': 'NOT DIRECTLY INSPECTED BY UI',
                'unrelated_mobile_wallet_retained': True if passed else None,
                'final_visible_wallet_count': 3 if passed else None,
                'final_visible_wallet_composition': (
                    'ONE_MOBILE_WALLET_AND_TWO_REAL_VAULTS' if passed else None),
                'physical_biometrics': 'NOT RUN',
                'hardware_device_checks': 'NOT RUN',
                'backend_compatibility': 'NOT TESTED BY LOOPBACK_UI_FIXTURE',
                'protected_backup': 'DISABLED_FOR_DISPOSABLE_FIXTURE',
                'release_readiness': 'NOT ESTABLISHED',
            }


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


def run_companion(h, data, device, private, backend_receipt, installed_proof):
    """Called only after successful existing key UI on the same fixture/device.

    installed_proof is the reviewed product_key_acceptance.installed_proof helper;
    the source-owned parent must pass that existing helper without replacement.
    """
    if (os.environ.get('GITHUB_ACTIONS') != 'true' or
            os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted' or
            h.PLATFORM not in ['IOS', 'ANDROID'] or
            (h.PLATFORM == 'ANDROID' and not device.startswith('emulator-'))):
        raise RuntimeError('PRODUCT_VAULT_UI_OWNED_HOSTED_DEVICE_REQUIRED')
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=h.ROOT, text=True).strip()
    if (data['build'] != 'PASS' or actual != data['source_sha'] or
            actual != os.environ.get('KEEPER_SOURCE_SHA') or
            h.artifact_identity() != data['built_artifact']):
        raise RuntimeError('PRODUCT_VAULT_UI_EXACT_BUILD_REQUIRED')
    if subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--', '.github/native', 'src',
                       'index.js', 'App.tsx', 'metro.config.js', 'babel.config.js'],
                      cwd=h.ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        raise RuntimeError('PRODUCT_VAULT_UI_COMMITTED_SOURCE_REQUIRED')
    before = backend_receipt.snapshot(passed=True)
    predecessor = h.read().get('product_key_ui', {})
    if (before.get('status') != 'PASS' or before.get('sample') != 6 or
            before.get('scenario') != 'CONTROLLED_DISCONNECT_BEFORE_COMMIT_NOT_WAN_OFFLINE' or
            before.get('create_new_app_calls') != 2 or
            before.get('visible_wallet_count_after_relaunch') != 1 or
            predecessor.get('status') != 'PASS' or
            predecessor.get('scenario') != 'UNUSED_MOBILE_KEY_UI_DELETE_AND_NATIVE_PIN' or
            predecessor.get('visible_eligible_keys_after_deletion') != 0 or
            predecessor.get('unrelated_visible_wallet_count_after_relaunch') != 1 or
            predecessor.get('new_account_requests_during_key_flow') != 0 or
            predecessor.get('installed_artifact_verified') is not True):
        raise RuntimeError('PRODUCT_VAULT_UI_COMPLETED_DISPOSABLE_PREDECESSOR_REQUIRED')
    spec = importlib.util.spec_from_file_location('product_key_acceptance',
        Path(__file__).with_name('product_key_acceptance.py'))
    key_ui = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(key_ui)
    output = Path(private) / 'vault-ui'
    output.mkdir(mode=0o700)
    report = output / 'junit.xml'
    receipt = Receipt()
    result = receipt.snapshot()
    result['status'] = 'RUNNING'
    server = None

    def save():
        current = h.read()
        current['product_vault_ui'] = result
        h.save(current)

    try:
        save()
        installed_before = installed_proof(h, device)
        if predecessor.get('installed_artifact') != installed_before:
            raise RuntimeError('PRODUCT_VAULT_UI_PREDECESSOR_INSTALLATION_CHANGED')
        server = make_server(receipt)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        h.command([data['maestro']['binary'], '--device', device, 'test',
                   '--env', 'APP_ID=' + h.APP_IDS[h.PLATFORM], '--flatten-debug-output',
                   '--debug-output', str(output), '--test-output-dir', str(output),
                   '--format', 'junit', '--output', str(report),
                   '.github/native/product_vault_acceptance.yaml'],
                  'Normal-app genuine Vault visible hidden and archived key references',
                  timeout=1800, error_details=False)
        h.successful_junit(report)
        if h.artifact_identity() != data['built_artifact']:
            raise RuntimeError('PRODUCT_VAULT_UI_ARTIFACT_CHANGED')
        installed_after = installed_proof(h, device)
        if installed_after != installed_before:
            raise RuntimeError('PRODUCT_VAULT_UI_INSTALLED_BYTES_CHANGED')
        after = backend_receipt.snapshot(passed=True)
        if after['create_new_app_calls'] != before['create_new_app_calls']:
            raise RuntimeError('PRODUCT_VAULT_UI_UNEXPECTED_ACCOUNT_SETUP')
        result = receipt.snapshot(passed=True)
        result['new_account_requests_during_vault_flow'] = 0
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
        # Failure diagnostics can contain PIN actions and app hierarchy. Visit
        # disposal even when another boundary fails, then persist safe evidence.
        operations.append(('private-output', lambda: shutil.rmtree(output)))
        key_ui.finalize_companion(result, save, operations, 'failure_category' in result,
                                  'PRODUCT_VAULT_UI_CLEANUP_FAILED')
    return result
