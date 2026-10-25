"""Host byte/transport controls; no native acceptance credit."""
import importlib.util
import contextlib
import io
from pathlib import Path
import plistlib
import shutil
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location(
    'installed_native', Path(__file__).resolve().parents[1] / 'native/hosted_native.py')
h = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(h)


class InstalledArtifactTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.private = self.root / 'private'
        patch = mock.patch.multiple(h, ROOT=self.root, PRIVATE=self.private,
                                    EVIDENCE=self.root / 'metadata.json', PLATFORM='ANDROID')
        patch.start()
        self.addCleanup(patch.stop)
        apk = self.root / 'android/app/build/outputs/apk/development/debug/app-development-debug.apk'
        apk.parent.mkdir(parents=True)
        apk.write_bytes(b'PRIVATE_APK')
        self.pm = '/data/app/~~ABC==/io.hexawallet.keeper.development-XYZ==/base.apk'
        self.seed()

    def seed(self):
        h.save({'built_artifact': h.artifact_identity(), 'commands': [],
                'installed_artifact_verified': True, 'installed_artifact': {'stale': True}})

    def reject(self, device):
        with self.assertRaisesRegex(RuntimeError, 'not verified; no equivalence claimed'):
            h.verify_installed_artifact(device)
        self.assertFalse(h.read()['installed_artifact_verified'])
        self.assertNotIn('installed_artifact', h.read())
        self.assertNotIn('PRIVATE_', h.EVIDENCE.read_text())

    def reply(self, value):
        return mock.patch.object(h, 'command', return_value=value)

    def pull(self, content=b'PRIVATE_APK', code=0):
        def copy(args, **kwargs):
            self.assertEqual(args[:5], ['adb', '-s', 'emulator-5554', 'pull', self.pm])
            self.pulled = Path(args[5])
            if content is not None:
                self.pulled.write_bytes(content)
            for field in ['stdout', 'stderr']:
                self.assertEqual(kwargs[field], h.subprocess.DEVNULL)
            return mock.Mock(returncode=code)
        return mock.patch.object(h.subprocess, 'run', side_effect=copy)

    def test_android_match_and_private_cleanup(self):
        with self.reply('package:' + self.pm) as command, self.pull():
            proof = h.verify_installed_artifact('emulator-5554')
        self.assertEqual(command.call_args.args[0][-2:], ['path', h.APP_IDS['ANDROID']])
        self.assertEqual(proof['sha256'], h.artifact_identity()['sha256'])
        self.assertTrue(h.read()['installed_artifact_verified'])
        self.assertFalse(self.pulled.parent.exists())
        self.assertNotIn(self.pm, h.EVIDENCE.read_text())

    def test_android_corrupt_missing_failed_pull(self):
        for content, code in [(b'PRIVATE_APX', 0), (None, 0), (b'PRIVATE_APK', 1)]:
            with self.subTest(content=content), self.reply('package:' + self.pm), self.pull(content, code):
                self.reject('emulator-5554')
                self.assertFalse(self.pulled.parent.exists())

    def test_android_invalid_paths_or_splits(self):
        for value in ['', self.pm + '\npackage:/data/app/split.apk',
                      self.pm.replace('development', 'production'),
                      self.pm.replace('/data/app/', '/sdcard/'), self.pm.replace('base.apk', 'base\\xapk')]:
            with self.subTest(value=value), self.reply('package:' + value), mock.patch.object(h.subprocess, 'run') as pull:
                self.reject('emulator-5554')
                pull.assert_not_called()

    def test_android_failure_stage_is_fixed_and_does_not_export_package_output(self):
        for content, code, stage in [(b'PRIVATE_APX', 0, 'APK_HASH_COMPARISON'),
                                     (b'SHORT', 0, 'APK_SIZE_COMPARISON'),
                                     (None, 0, 'APK_PULL_RESULT'), (b'PRIVATE_APK', 1, 'APK_PULL_RESULT')]:
            output = io.StringIO()
            with self.subTest(stage=stage), self.reply('package:' + self.pm), self.pull(content, code), \
                    contextlib.redirect_stdout(output):
                self.reject('emulator-5554')
            self.assertEqual(output.getvalue(), 'Installed artifact verification failed at ' + stage + '\n')
        output = io.StringIO()
        with self.reply('PRIVATE_REJECTED_PACKAGE_OUTPUT'), contextlib.redirect_stdout(output):
            self.reject('emulator-5554')
        self.assertEqual(output.getvalue(), 'Installed artifact verification failed at APK_PATH_POLICY\n')

    def ios(self):
        h.PLATFORM = 'IOS'
        self.device = '12345678-1234-1234-1234-123456789ABC'
        self.home = self.root / 'home'
        self.bundle = self.private / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
        self.bundle.mkdir(parents=True)
        (self.bundle / 'Info.plist').write_bytes(plistlib.dumps(
            {'CFBundleIdentifier': h.APP_IDS['IOS'], 'CFBundleExecutable': 'hexa_keeper_dev'}))
        (self.bundle / 'hexa_keeper_dev').write_bytes(b'PRIVATE_EXE')
        (self.bundle / 'asset').write_bytes(b'PRIVATE_ASSET')
        self.app = (self.home / 'Library/Developer/CoreSimulator/Devices' / self.device /
                    'data/Containers/Bundle/Application/ABCDEFAB-1234-1234-1234-123456789ABC' / self.bundle.name)
        shutil.copytree(self.bundle, self.app)
        self.seed()
        patch = mock.patch.object(h.Path, 'home', return_value=self.home)
        patch.start()
        self.addCleanup(patch.stop)

    def test_ios_match(self):
        self.ios()
        with self.reply(str(self.app)) as command:
            proof = h.verify_installed_artifact(self.device)
        self.assertEqual(command.call_args.args[0][-2:], [h.APP_IDS['IOS'], 'app'])
        self.assertEqual(proof['executable_sha256'], h.artifact_identity()['executable_sha256'])
        self.assertTrue(h.read()['installed_artifact_verified'])
        self.assertNotIn(str(self.app), h.EVIDENCE.read_text())

    def test_ios_corrupt_missing_added_bytes(self):
        self.ios()
        for name, value in [('hexa_keeper_dev', b'PRIVATE_EXX'), ('asset', b'PRIVATE_ASSXT'),
                            ('asset', None), ('unexpected', b'PRIVATE_EXTRA')]:
            with self.subTest(name=name, value=value), self.reply(str(self.app)):
                shutil.rmtree(self.app)
                shutil.copytree(self.bundle, self.app)
                target = self.app / name
                target.unlink() if value is None else target.write_bytes(value)
                self.reject(self.device)

    def test_ios_foreign_paths_and_escaping_container(self):
        self.ios()
        for path in [str(self.bundle), str(self.app).replace(self.device, 'FOREIGN'), str(self.app) + '\n' + str(self.app)]:
            with self.subTest(path=path), self.reply(path):
                self.reject(self.device)
        outside = self.root / 'outside'
        shutil.move(str(self.app.parent), outside)
        self.app.parent.symlink_to(outside, target_is_directory=True)
        with self.reply(str(self.app)):
            self.reject(self.device)

    def test_ios_unsafe_tree(self):
        self.ios()
        (self.app / 'asset').unlink()
        (self.app / 'asset').symlink_to(self.bundle / 'asset')
        with self.reply(str(self.app)):
            self.reject(self.device)
        (self.bundle / 'Info.plist').write_bytes(plistlib.dumps(
            {'CFBundleIdentifier': h.APP_IDS['IOS'], 'CFBundleExecutable': '../outside'}))
        with mock.patch.object(h, 'command') as command:
            self.reject(self.device)
            command.assert_not_called()

    def test_non_owned_device(self):
        for platform, device in [('ANDROID', 'physical-serial'), ('IOS', 'booted')]:
            h.PLATFORM = platform
            with self.subTest(platform=platform), mock.patch.object(h, 'command') as command:
                self.reject(device)
                command.assert_not_called()
