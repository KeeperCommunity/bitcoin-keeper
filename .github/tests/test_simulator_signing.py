"""Simulator-signing boundary contracts; these do not run macOS or Keychain."""
import copy
import importlib.util
from pathlib import Path
import plistlib
import tempfile
from types import SimpleNamespace
import unittest


SPEC = importlib.util.spec_from_file_location(
    'simulator_signing', Path(__file__).resolve().parents[1] / 'native/simulator_signing.py')
signing = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(signing)


class SimulatorSigningTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.private = Path(temporary.name)
        self.app = self.private / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
        self.app.mkdir(parents=True)
        self.info = {'CFBundleIdentifier': signing.APP_ID, 'CFBundleSupportedPlatforms': ['iPhoneSimulator']}
        self.write_info()
        self.state = {'toolchain': {}, 'signing': 'NOT RUN', 'build': 'NOT RUN'}
        self.calls = []
        self.effective = dict(signing.ENTITLEMENTS)
        self.identity = 'Executable=PRIVATE_PATH\nSignature=adhoc\nTeamIdentifier=not set\n'
        self.failure = None
        self.native = SimpleNamespace(PLATFORM='IOS', PRIVATE=self.private,
                                      read=lambda: copy.deepcopy(self.state), save=self.save, command=self.command)

    def write_info(self):
        (self.app / 'Info.plist').write_bytes(plistlib.dumps(self.info))

    def save(self, state):
        self.state = copy.deepcopy(state)

    def command(self, args, label, **kwargs):
        self.calls.append((args, label, kwargs))
        if label == self.failure:
            raise RuntimeError('ORIGINAL_FAILURE')
        if label == 'Read effective simulator entitlements':
            return 'Executable=PRIVATE_PATH\n' + plistlib.dumps(self.effective).decode()
        if label == 'Verify ad-hoc simulator signing identity':
            return self.identity

    def rejected(self):
        with self.assertRaises((RuntimeError, ValueError)):
            signing.sign(self.native)
        self.assertFalse(self.state['toolchain']['ios_simulator_signature']['verified'])
        self.assertEqual(self.state['signing'], 'NOT RUN')
        self.assertEqual(self.state['build'], 'NOT RUN')
        self.assertFalse((self.private / 'simulator-debug.entitlements').exists())

    def test_ad_hoc_app_keeps_release_signing_unrun_and_checks_actual_entitlements(self):
        signing.sign(self.native)
        proof = self.state['toolchain']['ios_simulator_signature']
        self.assertTrue(proof['verified'])
        self.assertEqual(proof['scope'], 'ADHOC_SIMULATOR_ONLY_NOT_RELEASE_SIGNING')
        self.assertEqual(proof['bundle_id'], signing.APP_ID)
        self.assertEqual(len(proof['entitlements_sha256']), 64)
        self.assertEqual(self.state['signing'], 'NOT RUN')
        self.assertEqual(self.calls[0][0][1:5], ['--force', '--sign', '-', '--timestamp=none'])
        self.assertTrue(all(row[2]['error_details'] is False for row in self.calls))
        self.assertNotIn('PRIVATE_PATH', str(self.state))
        self.assertFalse((self.private / 'simulator-debug.entitlements').exists())

    def test_nested_code_signed_first_without_app_keychain_entitlements(self):
        framework = self.app / 'Frameworks/Outer.framework'
        inner = framework / 'Frameworks/Inner.framework'
        inner.mkdir(parents=True)
        library = self.app / 'Frameworks/Other.dylib'
        library.write_bytes(b'UNSIGNED_FIXTURE')
        signing.sign(self.native)
        nested = [row[0] for row in self.calls if row[1] == 'Ad-hoc sign embedded simulator code']
        self.assertEqual(nested[0][-1], str(inner))
        self.assertEqual({row[-1] for row in nested}, {str(inner), str(framework), str(library)})
        self.assertTrue(all('--entitlements' not in row for row in nested))
        self.assertEqual(self.state['toolchain']['ios_simulator_signature']['embedded_code_count'], 3)

    def test_device_and_production_bundles_reject_before_codesign(self):
        for field, value in [('CFBundleSupportedPlatforms', ['iPhoneOS']),
                             ('CFBundleIdentifier', 'io.hexawallet.hexakeeper')]:
            with self.subTest(field=field):
                original = self.info[field]
                self.info[field] = value
                self.write_info()
                self.rejected()
                self.assertFalse(self.calls)
                self.info[field] = original
                self.write_info()

    def test_missing_or_extra_effective_entitlements_fail_closed(self):
        for value in [{}, dict(signing.ENTITLEMENTS, **{'aps-environment': 'production'}),
                      dict(signing.ENTITLEMENTS, **{'keychain-access-groups': ['FOREIGN_APP']})]:
            with self.subTest(value=value):
                self.effective = value
                self.rejected()

    def test_real_identity_or_missing_adhoc_marker_rejects(self):
        for identity in ['Signature=adhoc\nAuthority=Apple Development\n',
                         'Authority=Apple Distribution\n', 'Signature=adhoc_NOT_EXACT\n']:
            with self.subTest(identity=identity):
                self.identity = identity
                self.rejected()

    def test_sign_verify_and_read_errors_preserve_failure_and_revoke_stale_proof(self):
        for label in ['Ad-hoc sign development simulator app', 'Verify owned simulator code signature',
                      'Read effective simulator entitlements', 'Verify ad-hoc simulator signing identity']:
            with self.subTest(label=label):
                self.state['toolchain']['ios_simulator_signature'] = {'verified': True}
                self.failure = label
                with self.assertRaisesRegex(RuntimeError, '^ORIGINAL_FAILURE$'):
                    signing.sign(self.native)
                self.assertFalse(self.state['toolchain']['ios_simulator_signature']['verified'])
                self.assertFalse((self.private / 'simulator-debug.entitlements').exists())

    def test_aliases_extensions_and_preexisting_entitlement_file_reject(self):
        external = self.private / 'external'
        external.mkdir()
        frameworks = self.app / 'Frameworks'
        frameworks.symlink_to(external, target_is_directory=True)
        self.rejected()
        frameworks.unlink()
        plugins = self.app / 'PlugIns'
        plugins.mkdir()
        (plugins / 'Unknown.appex').mkdir()
        self.rejected()
        (plugins / 'Unknown.appex').rmdir()
        plugins.rmdir()
        target = self.private / 'simulator-debug.entitlements'
        target.symlink_to(external / 'untouched')
        with self.assertRaises(FileExistsError):
            signing.sign(self.native)
        self.assertFalse((external / 'untouched').exists())
        target.unlink()
        self.assertFalse(self.calls)


if __name__ == '__main__':
    unittest.main()
