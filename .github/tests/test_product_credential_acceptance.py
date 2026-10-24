"""Host safety contracts with fake driver/adapters, never native acceptance."""
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

SPEC = importlib.util.spec_from_file_location('product_credential_acceptance',
    Path(__file__).resolve().parents[1] / 'native/product_credential_acceptance.py')
product = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(product)


class ReceiptTests(unittest.TestCase):
    def test_native_phase_confirmation_and_order_are_required(self):
        receipt = product.Receipt()
        self.assertFalse(receipt.mark(product.STAGES[0]))
        with self.assertRaises(RuntimeError):
            receipt.phase('restored')
        receipt.phase('armed')
        for stage in product.STAGES[:3]:
            self.assertTrue(receipt.mark(stage))
            self.assertFalse(receipt.mark(stage))
        self.assertFalse(receipt.mark(product.STAGES[3]))
        receipt.phase('restored')
        for stage in product.STAGES[3:]:
            self.assertTrue(receipt.mark(stage))
        result = receipt.snapshot(passed=True)
        self.assertEqual(result['status'], 'PASS')
        self.assertEqual(result['os_keychain_denial_or_hardware_read_fault'], 'NOT RUN')
        self.assertEqual(result['same_process_retry_after_external_repair'], 'NOT RUN')

    def test_partial_blocking_ui_cannot_pass_or_advance_to_restore(self):
        receipt = product.Receipt()
        receipt.phase('armed')
        receipt.mark(product.STAGES[0])
        with self.assertRaises(RuntimeError):
            receipt.phase('restored')
        with self.assertRaises(RuntimeError):
            receipt.snapshot(passed=True)

    def test_fixed_endpoint_rejects_sensitive_extra_fields_or_unknown_stages(self):
        receipt = product.Receipt()
        receipt.phase('armed')
        server = product.make_server(receipt, port=0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            url = 'http://127.0.0.1:%d/metric' % server.server_port
            for payload in [{'stage': 'PRIVATE_SENTINEL'},
                            {'stage': product.STAGES[0], 'secret': 'PRIVATE_SENTINEL'},
                            {'stage': 'PRIVATE_SENTINEL' * 100}]:
                with self.assertRaises(urllib.error.HTTPError) as failure:
                    urllib.request.urlopen(urllib.request.Request(url,
                        data=json.dumps(payload).encode(), method='POST'))
                self.assertEqual(failure.exception.code, 422)
            with urllib.request.urlopen(urllib.request.Request(url,
                data=json.dumps({'stage': product.STAGES[0]}).encode(), method='POST')) as response:
                self.assertEqual(response.status, 200)
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(receipt.snapshot()))
        finally:
            server.shutdown()
            server.server_close()

    def test_ui_flows_never_export_and_all_finish_with_a_stopped_app(self):
        directory = Path(__file__).resolve().parents[1] / 'native'
        flows = [(directory / name).read_text() for name in
                 ('credential_fixture.yaml', 'product_credential_blocked.yaml', 'product_credential_recovered.yaml')]
        self.assertEqual(re.findall(r'STAGE: ([a-z_]+)', ''.join(flows)), list(product.STAGES))
        for flow in flows:
            self.assertTrue(flow.rstrip().endswith('- stopApp'))
            for forbidden in ['takeScreenshot:', 'copyTextFrom:', 'inputText:', 'setClipboard:', 'clearKeychain:']:
                self.assertNotIn(forbidden, flow)
        self.assertIn('- tapOn: Retry', flows[1])
        self.assertIn('- assertNotVisible: Create a passcode', flows[1])


class RunnerTests(unittest.TestCase):
    def exercise(self, *, missing_stage=False, phase_failure=False, switch_failure=False,
                 extra_create=False, installed_changed=False, source_dirty=False,
                 device='emulator-5554', prior_key_failure=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        private = root / 'private'
        private.mkdir()
        sha, artifact = '1' * 40, {'sha256': 'f' * 64}
        state = {'build': 'PASS', 'source_sha': sha, 'built_artifact': artifact,
                 'maestro': {'binary': 'fake-maestro'},
                 'product_key_ui': {'status': 'FAIL' if prior_key_failure else 'PASS'}}
        runtime = {'switches': [], 'calls': 0, 'proofs': 0}

        def backend_snapshot(passed=False):
            runtime['calls'] += 1
            return {'status': 'PASS', 'sample': 6, 'visible_wallet_count_after_relaunch': 1,
                    'scenario': 'CONTROLLED_DISCONNECT_BEFORE_COMMIT_NOT_WAN_OFFLINE',
                    'create_new_app_calls': 3 if extra_create and runtime['calls'] > 1 else 2}

        def command(arguments, _label, **kwargs):
            self.assertFalse(kwargs['error_details'])
            if arguments[0] == 'adb':
                return
            output = Path(arguments[arguments.index('--debug-output') + 1])
            (output / 'PRIVATE_SENTINEL.png').write_text('PRIVATE_SENTINEL')
            if arguments[-1].endswith('credential_fixture.yaml'):
                if phase_failure:
                    raise RuntimeError('PRIVATE_SENTINEL')
            else:
                stages = product.STAGES[:3] if arguments[-1].endswith('blocked.yaml') else product.STAGES[3:]
                for stage in stages:
                    if missing_stage and stage == product.STAGES[-1]:
                        continue
                    self.assertTrue(runtime['receipt'].mark(stage))

        def server(receipt):
            runtime['receipt'] = receipt
            return types.SimpleNamespace(serve_forever=lambda: None, shutdown=lambda: None, server_close=lambda: None)

        def verify_installed(_device):
            runtime['proofs'] += 1
            proof = {'method': 'SINGLE_INSTALLED_BASE_APK_SHA256',
                     'sha256': ('e' if installed_changed and runtime['proofs'] == 2 else 'f') * 64}
            state.update(installed_artifact_verified=True, installed_artifact=copy.deepcopy(proof))
            return proof

        def save(value):
            state.clear()
            state.update(copy.deepcopy(value))

        def switch(phase):
            runtime['switches'].append(phase)
            if switch_failure:
                raise RuntimeError('PRIVATE_SENTINEL')

        h = types.SimpleNamespace(ROOT=root, PLATFORM='ANDROID', APP_IDS={'ANDROID': 'owned.disposable'},
            read=lambda: copy.deepcopy(state), save=save, artifact_identity=lambda: artifact,
            verify_installed_artifact=verify_installed, command=command, successful_junit=lambda _report: 1)
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.dict(product.os.environ, {'GITHUB_ACTIONS': 'true',
                'RUNNER_ENVIRONMENT': 'github-hosted', 'KEEPER_SOURCE_SHA': sha}))
            stack.enter_context(mock.patch.object(product.subprocess, 'check_output', return_value=sha))
            stack.enter_context(mock.patch.object(product.subprocess, 'run',
                return_value=types.SimpleNamespace(returncode=1 if source_dirty else 0)))
            stack.enter_context(mock.patch.object(product, 'make_server', side_effect=server))
            try:
                value = product.run_companion(h, state, device, private,
                    types.SimpleNamespace(snapshot=backend_snapshot), switch)
            except Exception as error:
                value = error
        return value, state, runtime, private

    def test_complete_flow_switches_to_ordinary_app_for_all_acceptance_and_destroys_private_output(self):
        value, state, runtime, private = self.exercise()
        self.assertEqual(value['status'], 'PASS')
        self.assertEqual(runtime['switches'], ['arm', 'product', 'restore', 'product'])
        self.assertEqual(runtime['proofs'], 2)
        self.assertEqual(value['new_account_requests_during_credential_flow'], 0)
        self.assertTrue(value['backup_service_removed_after_verified_restore'])
        self.assertFalse((private / 'credential-ui').exists())
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(state))

    def test_missing_native_phase_ui_driver_receipt_or_source_proof_fails_without_leaking_diagnostics(self):
        for option in ['missing_stage', 'phase_failure', 'switch_failure', 'extra_create', 'installed_changed']:
            with self.subTest(option=option):
                value, state, _runtime, private = self.exercise(**{option: True})
                self.assertIsInstance(value, RuntimeError)
                self.assertEqual(state['product_credential_ui']['status'], 'FAIL')
                self.assertFalse((private / 'credential-ui').exists())
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(state))

    def test_prior_failure_real_device_and_dirty_sources_are_rejected_before_switching(self):
        for options in [{'prior_key_failure': True}, {'source_dirty': True}, {'device': 'real-phone'}]:
            with self.subTest(options=options):
                value, state, runtime, private = self.exercise(**options)
                self.assertIsInstance(value, RuntimeError)
                self.assertEqual(runtime['switches'], [])
                self.assertNotIn('product_credential_ui', state)
                self.assertFalse((private / 'credential-ui').exists())


if __name__ == '__main__':
    unittest.main()
