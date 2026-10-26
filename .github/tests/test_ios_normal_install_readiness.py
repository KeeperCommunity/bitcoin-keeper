"""Actual-operation receipt ordering; no simulator or app is executed."""
import copy
import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('actual_install', ROOT / '.github/native/ios_normal_install_readiness.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
DEVICE = '12345678-1234-1234-1234-123456789ABC'


class ActualInstallProof(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.state = {'commands': self.boot(), 'installed_artifact_verified': False,
                      'installed_normal_signature_verified': False, 'smoke': 'NOT RUN', 'native_keychain': 'NOT RUN'}
        self.native = SimpleNamespace(PRIVATE=self.root, read=lambda: copy.deepcopy(self.state), save=self.save, command=mock.Mock())
        def verified(device):
            self.assertEqual(device, DEVICE)
            self.state.update(installed_artifact_verified=True, installed_normal_signature_verified=True)
            return {'method': 'FULL_SIMULATOR_BUNDLE_TREE_AND_EXECUTABLE_SHA256'}
        self.verify = mock.Mock(side_effect=verified)
        self.proof = m.ActualInstallReadiness(self.native, self.verify, 'startup')

    def save(self, state): self.state = copy.deepcopy(state)

    def boot(self, product=False):
        name = 'Keeper-product-ui-disposable' if product else 'Keeper-disposable-ci'
        labels = (('Create task-owned product UI simulator', 'Boot product UI simulator', 'Wait for product UI simulator')
                  if product else ('Create fresh iPhone 16 iOS 18.5 simulator', 'Boot disposable simulator', 'Wait for simulator boot'))
        commands = [['xcrun', 'simctl', 'create', name, 'com.apple.CoreSimulator.SimDeviceType.iPhone-16', 'com.apple.CoreSimulator.SimRuntime.iOS-18-5'],
                    ['xcrun', 'simctl', 'boot', DEVICE], ['xcrun', 'simctl', 'bootstatus', DEVICE, '-b']]
        return [{'command': row, 'label': label, 'exit_code': 0, 'timeout_seconds': 240 if index == 2 else 120,
                 'duration_seconds': 1.5} for index, (row, label) in enumerate(zip(commands, labels))]

    def install(self, code=0, product=False):
        self.state['commands'].append({'command': ['xcrun', 'simctl', 'install', DEVICE,
            str(self.root / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app')],
            'label': 'Install exact product UI app' if product else 'Install unsigned development app',
            'exit_code': code, 'timeout_seconds': 120, 'duration_seconds': 7.5})

    def entry(self): return self.state[m.FIELD][0]

    def test_successful_boot_is_pending_until_one_actual_install_and_full_signature_byte_verification(self):
        pending = self.proof.wait(DEVICE)
        self.assertEqual(pending['result'], 'PENDING_ACTUAL_INSTALL')
        self.assertEqual(pending['app_service_readiness'], 'NOT_ESTABLISHED')
        self.native.command.assert_not_called(); self.verify.assert_not_called()
        with self.assertRaises(RuntimeError): self.proof.verify(DEVICE)
        self.install()
        self.proof.verify(DEVICE)
        self.verify.assert_called_once_with(DEVICE)
        self.assertEqual(self.entry()['result'], 'PASS')
        self.assertEqual(self.entry()['install_command']['timeout_seconds'], 120)
        self.assertEqual(self.entry()['install_command']['command_index'], 4)
        self.assertEqual(self.entry()['listapps'], 'NOT_RUN_PRIVATE_ACTUAL_INSTALL_PATH')
        self.assertEqual(self.state['smoke'], 'NOT RUN'); self.assertEqual(self.state['native_keychain'], 'NOT RUN')

    def test_failed_missing_foreign_boolean_or_wrong_budget_boot_cannot_enter_standard_path(self):
        original = copy.deepcopy(self.state)
        for change in (lambda rows: rows[-1].update(exit_code=124), lambda rows: rows[-1].update(exit_code=True),
                lambda rows: rows[-1].update(timeout_seconds=300), lambda rows: rows[-1]['command'].__setitem__(3, 'foreign'),
                lambda rows: rows[0]['command'].__setitem__(3, 'Foreign simulator'), lambda rows: rows.pop(0)):
            self.state = copy.deepcopy(original); change(self.state['commands'])
            with self.assertRaises(RuntimeError): self.proof.wait(DEVICE)
            self.verify.assert_not_called(); self.native.command.assert_not_called()

    def test_install_timeout_is_failed_without_retry_or_positive_readiness(self):
        self.proof.wait(DEVICE); self.install(code=124)
        with self.assertRaises(RuntimeError): self.proof.verify(DEVICE)
        self.proof.finish()
        self.assertEqual(self.entry()['result'], 'FAIL')
        self.assertEqual(self.entry()['app_service_readiness'], 'NOT_ESTABLISHED')
        self.assertEqual(self.entry()['install_command']['exit_code'], 124)
        self.verify.assert_not_called(); self.native.command.assert_not_called()
        with self.assertRaises(RuntimeError): self.proof.wait(DEVICE)

    def test_multiple_installs_before_first_verification_or_foreign_target_are_rejected(self):
        self.proof.wait(DEVICE); self.install(); self.install()
        with self.assertRaises(RuntimeError): self.proof.verify(DEVICE)
        self.state['commands'].pop(); self.state['commands'][-1]['command'][3] = 'foreign'
        with self.assertRaises(RuntimeError): self.proof.verify(DEVICE)
        self.verify.assert_not_called()

    def test_failed_byte_or_signature_verifier_never_makes_readiness_pass(self):
        self.proof.wait(DEVICE); self.install()
        self.verify.side_effect = RuntimeError('SYNTHETIC_IDENTITY_FAILURE')
        with self.assertRaises(RuntimeError): self.proof.verify(DEVICE)
        self.proof.finish(); self.assertEqual(self.entry()['result'], 'FAIL')
        self.assertNotIn('normal_signature', self.entry())

    def test_successful_command_without_both_actual_identity_receipts_cannot_make_pass(self):
        self.proof.wait(DEVICE); self.install()
        for byte_flag, signature_flag in ((False, True), (True, False)):
            self.verify.side_effect = None
            self.state.update(installed_artifact_verified=byte_flag, installed_normal_signature_verified=signature_flag)
            with self.assertRaises(RuntimeError): self.proof.verify(DEVICE)
            self.assertEqual(self.entry()['result'], 'PENDING_ACTUAL_INSTALL')

    def test_existing_product_sample_reinstalls_keep_their_verification_without_borrowing_formal_credit(self):
        self.state['commands'] = self.boot(product=True)
        proof = m.ActualInstallReadiness(self.native, self.verify, 'product')
        proof.wait(DEVICE); self.install(product=True); proof.verify(DEVICE)
        initial = copy.deepcopy(self.entry())
        self.install(product=True); proof.verify(DEVICE)
        self.assertEqual(self.verify.call_count, 2)
        self.assertEqual(self.entry(), initial)
        self.assertIn('FIRST_REQUIRED_INSTALL', self.entry()['scope'])


if __name__ == '__main__': unittest.main()
