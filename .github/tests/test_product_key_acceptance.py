"""Host-only normal-app companion contracts; no native acceptance credit."""
import contextlib
import copy
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import threading
import types
import unittest
from unittest import mock
import urllib.error
import urllib.request

SPEC = importlib.util.spec_from_file_location(
    'product_key_acceptance', Path(__file__).resolve().parents[1] / 'native/product_key_acceptance.py')
product = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(product)


class ReceiptTests(unittest.TestCase):
    def test_exact_stage_order_is_required_without_substitute_or_repeated_marks(self):
        receipt = product.Receipt()
        self.assertFalse(receipt.mark('unused_mobile_key_deleted'))
        for stage in product.STAGES:
            self.assertTrue(receipt.mark(stage))
            self.assertFalse(receipt.mark(stage))
        evidence = receipt.snapshot(passed=True)
        self.assertEqual(evidence['status'], 'PASS')
        self.assertEqual(evidence['referenced_vault_ui'], 'NOT IMPLEMENTED')
        self.assertEqual(evidence['credential_store_read_fault'], 'NOT RUN')

    def test_missing_checks_never_pass(self):
        receipt = product.Receipt()
        receipt.mark(product.STAGES[0])
        with self.assertRaisesRegex(RuntimeError, 'INCOMPLETE'):
            receipt.snapshot(passed=True)
        self.assertEqual(receipt.snapshot()['status'], 'FAIL')

    def test_loopback_server_rejects_extra_fields_oversize_and_unknown_stage_without_retaining_data(self):
        receipt = product.Receipt()
        server = product.make_server(receipt, port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = 'http://127.0.0.1:%d/metric' % server.server_port
            for payload in [{'stage': 'PRIVATE_SENTINEL'}, {'stage': product.STAGES[0], 'private': 'PRIVATE_SENTINEL'},
                            {'private': 'PRIVATE_SENTINEL' * 100}]:
                request = urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST')
                with self.assertRaises(urllib.error.HTTPError) as failure:
                    urllib.request.urlopen(request)
                self.assertEqual(failure.exception.code, 422)
            request = urllib.request.Request(url, data=json.dumps({'stage': product.STAGES[0]}).encode(), method='POST')
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 200)
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(receipt.snapshot()))
        finally:
            server.shutdown()
            server.server_close()

    def test_reviewed_flow_has_every_receipt_mark_and_no_export_or_credential_injection_path(self):
        flow = (Path(__file__).resolve().parents[1] / 'native/product_key_acceptance.yaml').read_text()
        self.assertEqual(re.findall(r'STAGE: ([a-z_]+)', flow), list(product.STAGES))
        self.assertIn('id: btn_MY_KEEPER', flow)
        self.assertIn('id: keys_add_key', flow)
        self.assertIn('id: btnDelete', flow)
        for command in ['takeScreenshot:', 'copyTextFrom:', 'inputText:', 'setClipboard:', 'clearKeychain:']:
            self.assertNotIn(command, flow)


class RunnerTests(unittest.TestCase):
    def exercise(self, *, omit_last=False, artifact_changed=False, command_failure=False,
                 source_dirty=False, device='emulator-5554', extra_create=False,
                 installed_failure=False, installed_mismatch=False, installed_unverified=False,
                 installed_private_extra=False):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        private = root / 'private'
        private.mkdir()
        sha = '1' * 40
        artifact = {'sha256': 'f' * 64}
        state = {'build': 'PASS', 'source_sha': sha, 'built_artifact': artifact,
                 'maestro': {'binary': 'synthetic-maestro'}}
        runtime = {}
        backend_calls = 0

        def backend_snapshot(passed=False):
            nonlocal backend_calls
            backend_calls += 1
            return {'status': 'PASS', 'sample': 6, 'visible_wallet_count_after_relaunch': 1,
                    'scenario': 'CONTROLLED_DISCONNECT_BEFORE_COMMIT_NOT_WAN_OFFLINE',
                    'create_new_app_calls': 3 if extra_create and backend_calls > 1 else 2}

        def command(_args, _label, **kwargs):
            self.assertFalse(kwargs['error_details'])
            output = private / 'key-ui'
            (output / 'PRIVATE_SCREENSHOT_SENTINEL.png').write_text('PRIVATE_SENTINEL')
            if command_failure:
                raise RuntimeError('PRIVATE_SENTINEL')
            for stage in product.STAGES[:-1] if omit_last else product.STAGES:
                self.assertTrue(runtime['receipt'].mark(stage))

        def server(receipt):
            runtime['receipt'] = receipt
            return types.SimpleNamespace(serve_forever=lambda: None, shutdown=lambda: None,
                                         server_close=lambda: None)

        identity = mock.Mock(side_effect=[artifact, {'sha256': 'changed'}] if artifact_changed else None,
                             return_value=artifact)
        installed_calls = 0

        def verify_installed(device):
            nonlocal installed_calls
            installed_calls += 1
            state['installed_artifact_verified'] = False
            state.pop('installed_artifact', None)
            if installed_failure and installed_calls == 2:
                raise RuntimeError('PRIVATE_SENTINEL')
            proof = {'method': 'SINGLE_INSTALLED_BASE_APK_SHA256',
                     'sha256': ('e' if installed_mismatch and installed_calls == 2 else 'f') * 64}
            if installed_private_extra:
                proof['unreviewed'] = 'PRIVATE_SENTINEL'
            state['installed_artifact'] = copy.deepcopy(proof)
            state['installed_artifact_verified'] = not installed_unverified
            return proof

        def save(value):
            state.clear()
            state.update(copy.deepcopy(value))

        h = types.SimpleNamespace(ROOT=root, PLATFORM='ANDROID', APP_IDS={'ANDROID': 'disposable.app'},
            read=lambda: copy.deepcopy(state), save=save, artifact_identity=identity,
            verify_installed_artifact=verify_installed, command=command, successful_junit=lambda report: 1)
        backend = types.SimpleNamespace(snapshot=backend_snapshot)
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.dict(product.os.environ, {'GITHUB_ACTIONS': 'true',
                'RUNNER_ENVIRONMENT': 'github-hosted', 'KEEPER_SOURCE_SHA': sha}))
            stack.enter_context(mock.patch.object(product.subprocess, 'check_output', return_value=sha))
            stack.enter_context(mock.patch.object(product.subprocess, 'run', return_value=types.SimpleNamespace(
                returncode=1 if source_dirty else 0)))
            stack.enter_context(mock.patch.object(product, 'make_server', side_effect=server))
            try:
                value = product.run_companion(h, state, device, private, backend)
                return value, state, private, installed_calls
            except Exception as error:
                return error, state, private, installed_calls

    def test_complete_flow_keeps_scope_separate_and_removes_all_private_ui_output(self):
        value, state, private, installed_calls = self.exercise()
        self.assertEqual(value['status'], 'PASS')
        self.assertEqual(value['new_account_requests_during_key_flow'], 0)
        self.assertEqual(value['physical_biometrics'], 'NOT RUN')
        self.assertEqual(installed_calls, 2)
        self.assertTrue(value['installed_artifact_verified'])
        self.assertEqual(value['installed_artifact']['sha256'], 'f' * 64)
        self.assertFalse((private / 'key-ui').exists())
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(state))

    def test_missing_stage_artifact_drift_driver_failure_and_new_setup_each_fail_closed(self):
        for option in ['omit_last', 'artifact_changed', 'command_failure', 'extra_create',
                       'installed_failure', 'installed_mismatch', 'installed_unverified', 'installed_private_extra']:
            with self.subTest(option=option):
                value, state, private, _calls = self.exercise(**{option: True})
                self.assertIsInstance(value, RuntimeError)
                self.assertEqual(state['product_key_ui']['status'], 'FAIL')
                self.assertFalse((private / 'key-ui').exists())
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(state))

    def test_real_device_or_dirty_source_is_rejected_before_ui_execution(self):
        for options in [{'device': 'physical-device-id'}, {'source_dirty': True}]:
            with self.subTest(options=options):
                value, state, private, _calls = self.exercise(**options)
                self.assertIsInstance(value, RuntimeError)
                self.assertNotIn('product_key_ui', state)
                self.assertFalse((private / 'key-ui').exists())


if __name__ == '__main__':
    unittest.main()
