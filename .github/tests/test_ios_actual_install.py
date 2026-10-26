"""Operation readiness controls, with no simulator, install or UI execution."""
import copy
import importlib.util
import plistlib
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location('actual_' + name, ROOT / '.github/native' / (name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


m, h = load('ios_actual_install'), load('hosted_native')
DEVICE = '12345678-1234-1234-1234-123456789ABC'


class ActualInstall(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.state = {'commands': self.boot(), 'smoke': 'NOT RUN', 'native_keychain': 'NOT RUN',
            'installed_artifact_verified': False, 'installed_normal_signature_verified': False}
        self.native = SimpleNamespace(PRIVATE=self.root, read=lambda: copy.deepcopy(self.state),
            save=lambda value: setattr(self, 'state', copy.deepcopy(value)), command=mock.Mock())
        self.proof = m.ActualInstallReadiness(self.native, 'startup')

    def boot(self, product=False, suite=None):
        if suite == 'tls':
            name, labels = 'Keeper-r52-tls-disposable', ('Create owned TLS simulator', 'Boot owned TLS simulator', 'Wait for owned TLS simulator')
        elif suite == 'realm109':
            name, labels = 'Keeper-realm109-disposable', ('Create owned Realm109 simulator', 'Boot owned Realm109 simulator', 'Wait for owned Realm109 simulator')
        else:
            name = 'Keeper-product-ui-disposable' if product else 'Keeper-disposable-ci'
            labels = (('Create task-owned product UI simulator', 'Boot product UI simulator', 'Wait for product UI simulator')
                if product else ('Create fresh iPhone 16 iOS 18.5 simulator', 'Boot disposable simulator', 'Wait for simulator boot'))
        commands = [['xcrun', 'simctl', 'create', name, 'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
            'com.apple.CoreSimulator.SimRuntime.iOS-18-5'], ['xcrun', 'simctl', 'boot', DEVICE],
            ['xcrun', 'simctl', 'bootstatus', DEVICE, '-b']]
        return [{'command': row, 'label': label, 'exit_code': 0,
            'timeout_seconds': 240 if index == 2 else 120, 'duration_seconds': 1.5}
            for index, (row, label) in enumerate(zip(commands, labels))]

    def install(self, product=False, code=0, suite=None):
        self.state['commands'].append({'command': ['xcrun', 'simctl', 'install', DEVICE,
            str(self.root / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app')],
            'label': 'Install exact app for native TLS bridge' if suite == 'tls' else
                'Install exact app for native Realm migration' if suite == 'realm109' else
                'Install exact product UI app' if product else 'Install Xcode-signed development app',
            'exit_code': code, 'timeout_seconds': 120, 'duration_seconds': 7.5})

    def flags(self): self.state.update(installed_artifact_verified=True, installed_normal_signature_verified=True)

    def entry(self): return self.state[m.FIELD][0]

    def test_successful_boot_and_install_are_pending_until_full_bytes_and_signature(self):
        self.proof.wait(DEVICE); self.install()
        self.assertEqual(self.entry()['result'], 'PENDING_ACTUAL_INSTALL')
        for byte_flag, signature_flag in ((False, False), (True, False), (False, True), (1, True), (True, 1)):
            self.state.update(installed_artifact_verified=byte_flag, installed_normal_signature_verified=signature_flag)
            with self.assertRaises(RuntimeError): self.proof.verified(DEVICE)
        self.flags(); self.proof.verified(DEVICE)
        self.assertEqual(self.entry()['result'], 'PASS')
        self.assertEqual(self.entry()['install_command']['command_index'], 4)
        self.assertEqual(self.entry()['listapps'], 'NOT_RUN_ACTUAL_INSTALL_PATH')
        self.assertFalse(self.entry()['native_acceptance'])
        self.assertEqual(self.state['smoke'], 'NOT RUN')
        self.assertEqual(self.state['native_keychain'], 'NOT RUN')
        self.native.command.assert_not_called()

    def test_failed_missing_foreign_boolean_or_wrong_budget_boot_rejected(self):
        original = copy.deepcopy(self.state)
        for change in (lambda rows: rows.pop(0), lambda rows: rows[-1].update(exit_code=124),
            lambda rows: rows[-1].update(exit_code=True), lambda rows: rows[-1].update(timeout_seconds=300),
            lambda rows: rows[-1]['command'].__setitem__(3, 'foreign')):
            self.state = copy.deepcopy(original); change(self.state['commands'])
            with self.assertRaises(RuntimeError): self.proof.wait(DEVICE)
        self.native.command.assert_not_called()

    def test_failed_timedout_boolean_foreign_wrong_budget_or_multiple_installs_reject(self):
        self.proof.wait(DEVICE)
        original = copy.deepcopy(self.state)
        for code in (1, 124, True):
            self.state = copy.deepcopy(original); self.install(code=code); self.flags()
            with self.assertRaises(RuntimeError): self.proof.verified(DEVICE)
        for change in (lambda row: row['command'].__setitem__(3, 'foreign'),
            lambda row: row.update(timeout_seconds=121), lambda row: row.update(label='Other install')):
            self.state = copy.deepcopy(original); self.install(); self.flags(); change(self.state['commands'][-1])
            with self.assertRaises(RuntimeError): self.proof.verified(DEVICE)
        self.state = copy.deepcopy(original); self.install(); self.install(); self.flags()
        with self.assertRaises(RuntimeError): self.proof.verified(DEVICE)
        self.proof.finish(); self.assertEqual(self.entry()['result'], 'FAIL')
        self.native.command.assert_not_called()

    def test_missing_install_and_wrong_device_never_gain_readiness(self):
        self.proof.wait(DEVICE); self.flags()
        with self.assertRaises(RuntimeError): self.proof.verified(DEVICE)
        self.install()
        with self.assertRaises(RuntimeError): self.proof.verified('foreign')
        self.proof.finish(); self.assertEqual(self.entry()['result'], 'FAIL')

    def test_each_native_suite_and_product_uses_its_own_boot_and_actual_first_install(self):
        for suite in ('startup', 'keychain', 'probe', 'features', 'product', 'tls', 'realm109'):
            with self.subTest(suite=suite):
                self.state['commands'] = self.boot(product=suite == 'product', suite=suite)
                self.state.pop(m.FIELD, None)
                proof = m.ActualInstallReadiness(self.native, suite)
                proof.wait(DEVICE); self.install(product=suite == 'product', suite=suite); self.flags(); proof.verified(DEVICE)
                self.assertEqual(self.entry()['suite'], suite)
                initial = copy.deepcopy(self.entry())
                self.install(product=suite == 'product', suite=suite); proof.verified(DEVICE)
                self.assertEqual(self.entry(), initial)
        self.native.command.assert_not_called()

    def test_unknown_suite_and_product_boot_mismatch_reject(self):
        with self.assertRaises(RuntimeError): m.ActualInstallReadiness(self.native, 'unknown')
        with self.assertRaises(RuntimeError): m.ActualInstallReadiness(self.native, 'product').wait(DEVICE)

    def test_tls_and_realm_require_their_exact_boot_and_install_identity(self):
        for suite in ('tls', 'realm109'):
            self.state['commands'] = self.boot(suite=suite)
            with self.assertRaises(RuntimeError): m.ActualInstallReadiness(self.native).wait(DEVICE)
            proof = m.ActualInstallReadiness(self.native, suite); proof.wait(DEVICE)
            self.install(); self.flags()
            with self.assertRaises(RuntimeError): proof.verified(DEVICE)
            self.state['commands'].pop(); self.install(suite=suite); proof.verified(DEVICE)
            self.assertEqual(self.state[m.FIELD][-1]['result'], 'PASS')

    def test_harness_default_uses_proof_without_running_listapps(self):
        self.state['build_execution_scope'] = 'FRESH_CURRENT_SOURCE_NORMAL_XCODE_SIMULATOR'
        def signature_queries(native):
            self.state['commands'].append({'command': ['codesign', '--verify', 'controlled-app'],
                'label': 'Verify Xcode-generated simulator signature', 'exit_code': 0})
        helper = SimpleNamespace(require_runtime=mock.Mock(side_effect=signature_queries))
        with mock.patch.multiple(h, PRIVATE=self.root, PLATFORM='IOS', _IOS_ACTUAL_INSTALL_PROOF=None), \
            mock.patch.object(h, 'normal_ios', return_value=helper), mock.patch.object(h, 'read', self.native.read), \
            mock.patch.object(h, 'save', self.native.save), mock.patch.object(h, 'command') as command:
            h.wait_for_simulator_app_services(DEVICE, suite='startup')
            self.assertEqual(self.entry()['result'], 'PENDING_ACTUAL_INSTALL')
            command.assert_not_called()
            helper.require_runtime.assert_called_once()
            h.finish_ios_actual_install()
            self.assertEqual(self.entry()['result'], 'FAIL')

    def test_cli_keychain_dispatches_three_launch_native_suite(self):
        with mock.patch.object(h, 'smoke') as smoke:
            h.keychain()
        smoke.assert_called_once_with('keychain')

    def test_harness_installed_full_bytes_and_normal_signature_gate_readiness_together(self):
        built = self.root / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
        installed = self.root / 'installed/hexa_keeper_dev.app'
        for app in (built, installed):
            app.mkdir(parents=True)
            (app / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': h.APP_IDS['IOS'],
                'CFBundleExecutable': 'hexa_keeper_dev'}))
            (app / 'hexa_keeper_dev').write_bytes(b'controlled-artifact-bytes')
        self.state['build_execution_scope'] = 'FRESH_CURRENT_SOURCE_NORMAL_XCODE_SIMULATOR'
        def signature(native, device):
            self.assertEqual(device, DEVICE)
            self.state['installed_normal_signature_verified'] = True
        helper = SimpleNamespace(require_runtime=mock.Mock(), verify_installed=mock.Mock(side_effect=signature))
        with mock.patch.multiple(h, PRIVATE=self.root, PLATFORM='IOS', _IOS_ACTUAL_INSTALL_PROOF=None), \
            mock.patch.object(h, 'normal_ios', return_value=helper), mock.patch.object(h, 'read', self.native.read), \
            mock.patch.object(h, 'save', self.native.save), mock.patch.object(h, 'command', return_value=str(installed)), \
            mock.patch.object(h, 'owned_ios_bundle_path', return_value=installed):
            self.state['built_artifact'] = h.artifact_identity()
            h.wait_for_simulator_app_services(DEVICE, suite='startup'); self.install()
            h.verify_installed_artifact(DEVICE)
            self.assertEqual(self.entry()['result'], 'PASS')
            helper.verify_installed.assert_called_once()
            self.assertTrue(self.state['installed_artifact_verified'])
            self.assertTrue(self.state['installed_normal_signature_verified'])
            (installed / 'hexa_keeper_dev').write_bytes(b'mutated')
            with self.assertRaises(RuntimeError): h.verify_installed_artifact(DEVICE)
            self.assertFalse(self.state['installed_artifact_verified'])
            self.assertFalse(self.state['installed_normal_signature_verified'])

    def test_generic_probe_requires_formal_keychain_before_any_process_launch(self):
        self.state.update(build_execution_scope='FRESH_CURRENT_SOURCE_NORMAL_XCODE_SIMULATOR', build='PASS', smoke='PASS')
        helper = SimpleNamespace(require_runtime=mock.Mock())
        with mock.patch.object(h, 'PLATFORM', 'IOS'), mock.patch.object(h, 'read', self.native.read), \
            mock.patch.object(h, 'normal_ios', return_value=helper), mock.patch.object(h.subprocess, 'Popen') as process:
            for suite in ('probe', 'features'):
                with self.assertRaisesRegex(RuntimeError, 'three-launch native Keychain'): h.smoke(suite)
            process.assert_not_called()


if __name__ == '__main__': unittest.main()
