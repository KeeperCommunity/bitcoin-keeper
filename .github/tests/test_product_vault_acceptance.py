"""Host controls only: no emulator, native acceptance or backend credit."""
import contextlib
import copy
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import types
import unittest
from unittest import mock
import urllib.error
import urllib.request

SPEC = importlib.util.spec_from_file_location(
    'product_vault_acceptance', Path(__file__).resolve().parents[1] / 'native/product_vault_acceptance.py')
product = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(product)
NATIVE = Path(__file__).resolve().parents[1] / 'native'


class ReceiptTests(unittest.TestCase):
    def test_vault_ui_selectors_match_grouped_cards_and_mobile_row_controls(self):
        root = NATIVE.parents[1]
        flow = (NATIVE / 'product_vault_acceptance.yaml').read_text()
        home = (root / 'src/screens/Home/components/Wallet/HomeWallet.tsx').read_text()
        translations = json.loads((root / 'src/context/Localization/language/en.json').read_text())
        self.assertIn('title: walletText.createWallet', home)
        self.assertIn('subtitle: walletText.createWalletDesc', home)
        create_label = (translations['wallet']['createWallet'] + ', ' +
                        translations['wallet']['createWalletDesc'])
        create_pattern = re.search(r"- tapOn: '(Create Wallet[^']+)'", flow)
        self.assertIsNotNone(create_pattern)
        self.assertIsNotNone(re.fullmatch(create_pattern.group(1), create_label))
        self.assertIsNotNone(re.fullmatch(create_pattern.group(1), 'Create Wallet'))
        self.assertIsNone(re.fullmatch(create_pattern.group(1), 'Import Wallet'))

        home_label = 'Multi-key, 2 of 2, R5 Reference Vault'
        home_legacy_label = 'Multi-key, 2-of-2, R5 Reference Vault'
        self.assertIn('`${wallet.scheme.m} of ${wallet.scheme.n}`',
                      (root / 'src/hooks/useWalletAsset.ts').read_text())
        strict_scheme = '(?:Multi-key, )?2(?: of |-of-)2, R5 Reference Vault'
        self.assertIn("- assertVisible: '" + strict_scheme + "'", flow)
        self.assertIsNotNone(re.fullmatch(strict_scheme, home_label))
        self.assertIsNotNone(re.fullmatch(strict_scheme, home_legacy_label))
        self.assertIsNone(re.fullmatch(strict_scheme, 'Multi-key, 2 of 3, R5 Reference Vault'))
        home_card = re.search(r"- tapOn: '([^']*R5 Reference Vault)'", flow)
        self.assertIsNotNone(home_card)
        self.assertIsNotNone(re.fullmatch(home_card.group(1), home_label))
        self.assertIsNotNone(re.fullmatch(home_card.group(1), home_legacy_label))
        self.assertIsNotNone(re.fullmatch(home_card.group(1), 'R5 Reference Vault'))
        hidden_name = '.*R5 Reference Vault'
        self.assertEqual(flow.count("- assertNotVisible: '" + hidden_name + "'"), 3)
        self.assertIsNotNone(re.fullmatch(hidden_name, home_label))
        self.assertIsNotNone(re.fullmatch(hidden_name, 'Multi-key, 2 of 3, R5 Reference Vault'))
        self.assertIsNotNone(re.fullmatch(hidden_name, 'R5 Reference Vault'))

        self.assertIn('testID={`manage_key_type_${signer.type}`}',
                      (root / 'src/screens/SigningDevices/DeleteKeys.tsx').read_text())
        mobile_delete = ('- tapOn:\n    id: btnDelete\n    below:\n'
                         '      id: manage_key_type_MY_KEEPER\n    index: 0')
        self.assertEqual(flow.count(mobile_delete), 4)
        self.assertNotIn('childOf:\n      id: manage_key_type_MY_KEEPER', flow)
        self.assertIn('- assertVisible: Confirm your wallet details', flow)
        self.assertIn('- assertVisible:\n    id: btn_Mobile Key', flow)
        self.assertIn('- assertVisible:\n    id: btn_Seed Key', flow)

    def test_public_seed_field_ids_match_all_twelve_app_ordinals(self):
        helper = (NATIVE / 'product_vault_public_seed.yaml').read_text()
        root = NATIVE.parents[1]
        screen = (root / 'src/screens/Recovery/EnterSeedScreen.tsx').read_text()
        utilities = (root / 'src/utils/utilities.ts').read_text()
        self.assertIn('testID={`input_seedWord${getPlaceholder(index)}`}', screen)
        app_function = re.search(
            r'export const getPlaceholder = \(index: number\) => \{(.*?)\n\};', utilities, re.S)
        flow_expression = re.search(
            r'^\s*- evalScript: "\$\{(output\.wordId = [^\n]+)\}"\s*$', helper, re.M)
        self.assertIsNotNone(app_function)
        self.assertIsNotNone(flow_expression)
        self.assertEqual(helper.count('id: ${output.wordId}'), 2)
        script = ('const getPlaceholder = (index) => {' + app_function.group(1) + '\n};\n'
                  'const output = {}; const result = [];\n'
                  'for (let i = 0; i < 12; i++) { output.wordIndex = i; '
                  + flow_expression.group(1) + '; '
                  "result.push([output.wordId, 'input_seedWord' + getPlaceholder(i)]); }\n"
                  'process.stdout.write(JSON.stringify(result));')
        generated = json.loads(subprocess.check_output(['node', '-e', script], text=True))
        expected = ['input_seedWord' + str(i) + ('st' if i == 1 else 'nd' if i == 2
                    else 'rd' if i == 3 else 'th') for i in range(1, 13)]
        self.assertEqual([row[0] for row in generated], expected)
        self.assertEqual([row[0] for row in generated], [row[1] for row in generated])

    def test_all_stages_are_required_in_order_and_pass_remains_scoped(self):
        receipt = product.Receipt()
        self.assertFalse(receipt.mark(product.STAGES[-1]))
        for stage in product.STAGES:
            self.assertTrue(receipt.mark(stage))
            self.assertFalse(receipt.mark(stage))
        evidence = receipt.snapshot(passed=True)
        self.assertEqual(evidence['status'], 'PASS')
        self.assertEqual(evidence['archived_only_key_semantics'], 'LOGICAL_ARCHIVE_AND_REINSTATE_VERIFIED')
        self.assertEqual(evidence['final_visible_wallet_count'], 3)
        self.assertEqual(evidence['native_private_material_exactness'], 'NOT DIRECTLY INSPECTED BY UI')
        self.assertEqual(evidence['physical_biometrics'], 'NOT RUN')
        self.assertIn('NOT TESTED', evidence['backend_compatibility'])
        self.assertEqual(evidence['release_readiness'], 'NOT ESTABLISHED')

    def test_partial_work_does_not_become_native_acceptance(self):
        receipt = product.Receipt()
        for stage in product.STAGES[:-1]:
            receipt.mark(stage)
        with self.assertRaisesRegex(RuntimeError, 'INCOMPLETE'):
            receipt.snapshot(passed=True)
        self.assertEqual(receipt.snapshot()['visible_reference_ui'], 'NOT ESTABLISHED')
        self.assertIsNone(receipt.snapshot()['unrelated_mobile_wallet_retained'])

    def test_fixed_metric_protocol_discards_unexpected_private_values(self):
        receipt = product.Receipt()
        server = product.make_server(receipt, port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = 'http://127.0.0.1:%d/metric' % server.server_port
            for payload in [{'stage': 'PRIVATE_SENTINEL'}, {'stage': []},
                            {'stage': product.STAGES[0], 'identifier': 'PRIVATE_SENTINEL'},
                            {'value': 'PRIVATE_SENTINEL' * 100}]:
                request = urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST')
                with self.assertRaises(urllib.error.HTTPError) as failure:
                    urllib.request.urlopen(request)
                self.assertEqual(failure.exception.code, 422)
            request = urllib.request.Request(url, data=json.dumps({'stage': product.STAGES[0]}).encode(),
                                             method='POST')
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 200)
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(receipt.snapshot()))
        finally:
            server.shutdown()
            server.server_close()

    def test_reviewed_ui_has_real_vault_and_restore_operations_without_private_exports(self):
        flow = (NATIVE / 'product_vault_acceptance.yaml').read_text()
        helper = (NATIVE / 'product_vault_public_seed.yaml').read_text()
        self.assertEqual(re.findall(r'STAGE: ([a-z_]+)', flow), list(product.STAGES))
        for action in ['id: btn_MY_KEEPER', 'id: btn_Seed Key', 'id: btn_decreaseValue',
                       'tapOn: Replace Key', 'tapOn: Archived wallet versions', 'tapOn: Reinstate',
                       'WALLET_COUNT: \'3\'',
                       "assertNotVisible: '.*R5 Reference Vault'"]:
            self.assertIn(action, flow)
        for action in ['takeScreenshot:', 'copyTextFrom:', 'setClipboard:', 'clearKeychain:',
                       'clearState:', 'openLink:', 'tapOn: Send', 'tapOn: Receive',
                       'tapOn: Create\n', 'tapOn: Tip Now']:
            self.assertNotIn(action, flow + helper)
        self.assertEqual(re.findall(r'inputText: (.+)', flow), ['R5 Reference Vault'])
        self.assertIn('inputText: ${output.publicWords[output.wordIndex]}', helper)
        self.assertIn('tapOn: Import', helper)
        self.assertIn('tapOn: Skip', helper)
        # Imports are known public BIP39 vectors; no user input or generated
        # material is copied out. The app supplies all derivations/origins.
        self.assertEqual(re.findall(r'PUBLIC_WORDS: (.+)', flow), [
            'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            'legal winner thank year wave sausage worth useful legal winner thank yellow'])


class RunnerTests(unittest.TestCase):
    def exercise(self, *, missing_stage=False, driver_failure=False, bad_junit=False,
                 artifact_drift=False, installed_drift=False, predecessor_install_drift=False,
                 extra_account=False, dirty_source=False, predecessor_failure=False,
                 device='emulator-5554', platform='ANDROID', save_failure=False,
                 server_close_failure=False):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        private = root / 'private'
        private.mkdir()
        sha = '1' * 40
        artifact = {'sha256': 'f' * 64}
        proof = {'method': 'SINGLE_INSTALLED_BASE_APK_SHA256', 'sha256': 'f' * 64}
        predecessor = {
            'status': 'FAIL' if predecessor_failure else 'PASS',
            'scenario': 'UNUSED_MOBILE_KEY_UI_DELETE_AND_NATIVE_PIN',
            'visible_eligible_keys_after_deletion': 0,
            'unrelated_visible_wallet_count_after_relaunch': 1,
            'new_account_requests_during_key_flow': 0,
            'installed_artifact_verified': True,
            'installed_artifact': dict(proof, sha256='e' * 64) if predecessor_install_drift else proof,
        }
        state = {'build': 'PASS', 'source_sha': sha, 'built_artifact': artifact,
                 'maestro': {'binary': 'synthetic-maestro'}, 'product_key_ui': predecessor}
        runtime = {}
        backend_calls = 0
        installed_calls = 0

        def backend_snapshot(passed=False):
            nonlocal backend_calls
            backend_calls += 1
            return {'status': 'PASS', 'sample': 6, 'visible_wallet_count_after_relaunch': 1,
                    'scenario': 'CONTROLLED_DISCONNECT_BEFORE_COMMIT_NOT_WAN_OFFLINE',
                    'create_new_app_calls': 3 if extra_account and backend_calls > 1 else 2}

        def command(_args, _label, **kwargs):
            self.assertFalse(kwargs['error_details'])
            runtime['ui_started'] = True
            output = private / 'vault-ui'
            (output / 'PRIVATE_SCREENSHOT_SENTINEL.png').write_text('PRIVATE_SENTINEL')
            if driver_failure:
                raise RuntimeError('PRIVATE_SENTINEL')
            for stage in product.STAGES[:-1] if missing_stage else product.STAGES:
                self.assertTrue(runtime['receipt'].mark(stage))

        def close_server():
            if server_close_failure:
                raise RuntimeError('PRIVATE_SENTINEL')

        def server(receipt):
            runtime['receipt'] = receipt
            return types.SimpleNamespace(serve_forever=lambda: None, shutdown=lambda: None,
                                         server_close=close_server)

        def installed(_h, _device):
            nonlocal installed_calls
            installed_calls += 1
            return dict(proof, sha256='e' * 64) if installed_drift and installed_calls > 1 else proof

        def save(value):
            # Fail the final evidence save; raw output must already be disposed.
            if save_failure and runtime.get('ui_started'):
                raise RuntimeError('PRIVATE_SENTINEL')
            state.clear()
            state.update(copy.deepcopy(value))

        def junit(_report):
            if bad_junit:
                raise RuntimeError('PRIVATE_SENTINEL')

        identity = mock.Mock(side_effect=[artifact, {'sha256': 'changed'}] if artifact_drift else None,
                             return_value=artifact)
        h = types.SimpleNamespace(ROOT=root, PLATFORM=platform, APP_IDS={platform: 'disposable.app'},
            read=lambda: copy.deepcopy(state), save=save, artifact_identity=identity,
            command=command, successful_junit=junit)
        backend = types.SimpleNamespace(snapshot=backend_snapshot)
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.dict(product.os.environ, {'GITHUB_ACTIONS': 'true',
                'RUNNER_ENVIRONMENT': 'github-hosted', 'KEEPER_SOURCE_SHA': sha}))
            stack.enter_context(mock.patch.object(product.subprocess, 'check_output', return_value=sha))
            stack.enter_context(mock.patch.object(product.subprocess, 'run', return_value=types.SimpleNamespace(
                returncode=1 if dirty_source else 0)))
            stack.enter_context(mock.patch.object(product, 'make_server', side_effect=server))
            try:
                value = product.run_companion(h, state, device, private, backend, installed)
                return value, state, private, installed_calls
            except Exception as error:
                return error, state, private, installed_calls

    def test_complete_receipt_requires_junit_exact_install_and_no_extra_account(self):
        value, state, private, installed_calls = self.exercise()
        self.assertEqual(value['status'], 'PASS')
        self.assertEqual(installed_calls, 2)
        self.assertEqual(value['new_account_requests_during_vault_flow'], 0)
        self.assertTrue(value['installed_artifact_verified'])
        self.assertEqual(state['product_key_ui']['status'], 'PASS')
        self.assertFalse((private / 'vault-ui').exists())
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(state))

    def test_incomplete_ui_junit_drift_and_extra_account_never_pass(self):
        for option in ['missing_stage', 'driver_failure', 'bad_junit', 'artifact_drift',
                       'installed_drift', 'predecessor_install_drift', 'extra_account']:
            with self.subTest(option=option):
                value, state, private, _ = self.exercise(**{option: True})
                self.assertIsInstance(value, RuntimeError)
                self.assertEqual(state['product_vault_ui']['status'], 'FAIL')
                self.assertFalse((private / 'vault-ui').exists())
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(state))

    def test_unowned_device_dirty_source_or_incomplete_predecessor_never_runs(self):
        for options in [{'device': 'physical-device-id'}, {'dirty_source': True},
                        {'predecessor_failure': True}, {'platform': 'UNRECOGNIZED'}]:
            with self.subTest(options=options):
                value, state, private, installed_calls = self.exercise(**options)
                self.assertIsInstance(value, RuntimeError)
                self.assertEqual(installed_calls, 0)
                self.assertNotIn('product_vault_ui', state)
                self.assertFalse((private / 'vault-ui').exists())

    def test_private_output_is_purged_even_when_evidence_or_server_cleanup_fails(self):
        for option in ['save_failure', 'server_close_failure']:
            with self.subTest(option=option):
                value, state, private, _ = self.exercise(**{option: True})
                self.assertIsInstance(value, RuntimeError)
                self.assertFalse((private / 'vault-ui').exists())
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(state))
                self.assertNotEqual(state['product_vault_ui']['status'], 'PASS')


if __name__ == '__main__':
    unittest.main()
