"""Fake-action contracts only; never build, sign, upload or access a store."""
import base64
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import tempfile
import subprocess
import plistlib
import types
import unittest
from unittest import mock
import zipfile

spec = importlib.util.spec_from_file_location("worker", pathlib.Path(__file__).with_name("cloud_release_worker.py"))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def test_ios_restore_or_delete_failure_prevents_receipt_and_preserves_primary_failure(self):
        for failed_cleanup, primary_failure in [('delete-keychain', False), ('list-keychains', False), ('delete-keychain', True)]:
            with self.subTest(failed_cleanup=failed_cleanup, primary_failure=primary_failure), tempfile.TemporaryDirectory() as tmp:
                root = pathlib.Path(tmp); private = root / 'private'; private.mkdir()
                (root / 'android/app').mkdir(parents=True)
                (root / 'android/app/build.gradle').write_text('signingConfigs { release { storePassword System.getenv("STORE_PASSWORD") } }')
                overlay = root / 'overlay.json'; overlay.write_text('{}')
                cert = b'synthetic-public-cert'
                context = {'operation': 'ios-signed-build', 'sourceSha': 'a' * 40, 'driverSha': 'a' * 40, 'version': '2.6.5', 'build': '621',
                           'identitySha256': hashlib.sha256(cert).hexdigest(), 'configSha256': 'd' * 64,
                           'approvalExpiresAt': (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=3)).isoformat()}
                env = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted', 'KEEPER_EXPECTED_CERT_SHA256': context['identitySha256'],
                       'KEEPER_EXPECTED_CONFIG_SHA256': 'd' * 64, 'KEEPER_PACKAGE_OVERLAY_PATH': str(overlay),
                       'KEEPER_PRODUCTION_CONFIG_BASE64': base64.b64encode(b'synthetic-client-config').decode(),
                       'KEEPER_IOS_TEAM_ID': 'ABCDEFGHIJ', 'KEEPER_IOS_PROFILE_UUID': 'a' * 36, 'KEEPER_IOS_P12_PASSWORD': 'synthetic', 'RUNNER_TEMP': str(root)}
                def fake_run(args, **kwargs):
                    if primary_failure and str(args[0]) == 'xcodebuild': raise ValueError('synthetic-primary-failure')
                    if str(args[0]) == 'security' and args[1] == 'cms': return plistlib.dumps({})
                    if str(args[0]) == 'security' and args[1] == 'list-keychains': return b'"/tmp/original.keychain-db"'
                    if str(args[0]) == 'xcodebuild' and '-exportArchive' in args:
                        (private / 'export').mkdir(); (private / 'export/release.ipa').write_bytes(b'synthetic')
                    return b''
                def cleanup(args, **kwargs): return types.SimpleNamespace(returncode=1 if args[1] == failed_cleanup else 0)
                def decode(name, target): pathlib.Path(target).write_bytes(b'synthetic')
                with mock.patch.dict(os.environ, env), mock.patch.object(worker, 'run', side_effect=fake_run), mock.patch.object(worker, 'decode_secret', side_effect=decode), mock.patch.object(worker, 'cert_der_from_pem', return_value=cert), mock.patch.object(worker, 'validate_profile'), mock.patch.object(worker, 'validate_client_config'), mock.patch.object(worker, 'package_overlay'), mock.patch.object(worker, 'ruby_lock_compatibility'), mock.patch.object(worker, 'verify_artifact') as verify, mock.patch.object(worker.subprocess, 'run', side_effect=cleanup), mock.patch.object(worker.pathlib.Path, 'home', return_value=root / 'home'), mock.patch.object(worker, 'CLEANUP_FAILED', False):
                    with self.assertRaises(ValueError) as raised: worker.execute(context, root, private)
                    self.assertTrue(worker.CLEANUP_FAILED)
                    self.assertEqual(worker.CURRENT_STAGE, 'native-build' if primary_failure else 'signing-cleanup')
                    if primary_failure: self.assertEqual(str(raised.exception), 'synthetic-primary-failure')
                    verify.assert_not_called()
                self.assertFalse((root / 'keeper-release-output/receipt.json').exists())
                self.assertFalse((root / '.env.production').exists())
    def test_hash_bound_overlay_allows_only_recorded_mapping_and_rejects_staged_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            subprocess.run(['git', 'init', '-q', tmp], check=True)
            (root / 'package.json').write_text('{"version":"2.6.5","dependencies":{"known":"1"}}')
            (root / 'native.txt').write_text('canonical')
            subprocess.run(['git', '-C', tmp, 'add', '.'], check=True)
            subprocess.run(['git', '-C', tmp, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], check=True)
            (root / 'package.json').write_text('{"version":"2.6.5","dependencies":{"known":"1"},"browser":{"crypto":"approved-shim"}}')
            record = worker.package_overlay(root)
            worker.package_overlay(root, record)
            (root / 'package.json').write_text('{"version":"2.6.5","dependencies":{"known":"1"},"browser":{"crypto":"other-shim"}}')
            with self.assertRaises(ValueError): worker.package_overlay(root, record)
            (root / 'native.txt').write_text('staged-mutation')
            subprocess.run(['git', '-C', tmp, 'add', 'native.txt'], check=True)
            with self.assertRaises(ValueError): worker.package_overlay(root)

    def test_incompatible_frozen_ruby_lock_is_rejected_without_updating_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp); (root / 'ios').mkdir()
            (root / 'Gemfile').write_text("gem 'xcodeproj', '< 1.26.0'")
            (root / 'Gemfile.lock').write_text('    cocoapods (1.15.2)\n    xcodeproj (1.24.0)\n')
            (root / 'ios/Podfile.lock').write_text('COCOAPODS: 1.16.2\n')
            before = (root / 'Gemfile.lock').read_bytes()
            with self.assertRaises(ValueError): worker.ruby_lock_compatibility(root)
            self.assertEqual((root / 'Gemfile.lock').read_bytes(), before)

    def test_aligned_frozen_inputs_pass_and_each_lock_drift_fails_without_writes(self):
        inputs = {
            'Gemfile': "gem 'cocoapods', '1.16.2'\ngem 'xcodeproj', '1.27.0'\n",
            'Gemfile.lock': '    cocoapods (1.16.2)\n    xcodeproj (1.27.0)\n',
            'package.json': '{"dependencies":{"react-native-nitro-modules":"0.36.5"}}',
            'yarn.lock': 'react-native-nitro-modules@0.36.5:\n  version "0.36.5"\n',
            'ios/Podfile.lock': '  - NitroModules (0.36.5):\nCOCOAPODS: 1.16.2\n',
        }
        changes = [
            ('Gemfile.lock', '1.16.2', '1.15.2'),
            ('ios/Podfile.lock', '1.16.2', '1.15.2'),
            ('package.json', '0.36.5', '^0.36.5'),
            ('yarn.lock', 'version "0.36.5"', 'version "0.35.4"'),
            ('yarn.lock', '@0.36.5:', '@0.35.4:'),
            ('yarn.lock', '  version "0.36.5"\n', '  version "0.36.5"\n"react-native-nitro-modules@0.36.5":\n  version "0.35.4"\n'),
            ('yarn.lock', '@0.36.5:', '@0.36.5, "react-native-nitro-modules@^0.36.5":'),
            ('ios/Podfile.lock', '0.36.5', '0.35.4'),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp); (root / 'ios').mkdir()
            for name, value in inputs.items(): (root / name).write_text(value)
            worker.ruby_lock_compatibility(root)
            for name, old, new in changes:
                with self.subTest(name=name, old=old):
                    (root / name).write_text(inputs[name].replace(old, new))
                    before = {path: (root / path).read_bytes() for path in inputs}
                    with self.assertRaises(ValueError): worker.ruby_lock_compatibility(root)
                    self.assertEqual(before, {path: (root / path).read_bytes() for path in inputs})
                    (root / name).write_text(inputs[name])

    def test_client_config_requires_approved_digest_and_allowlist(self):
        valid = b'CHANNEL_URL=https://channel.bitcoinkeeper.app/\nENVIRONMENT=PRODUCTION\nRELAY=https://example.invalid/\nSIGNING_SERVER_TESTNET=https://test.example.invalid/\nSIGNING_SERVER_MAINNET=https://main.example.invalid/\nHEXA_ID_TESTNET=' + b'1' * 64 + b'\nHEXA_ID_MAINNET=' + b'2' * 64 + b'\n'
        worker.validate_client_config(valid, hashlib.sha256(valid).hexdigest())
        for data, expected in [(valid, '0' * 64), (valid + b'STORE_PASSWORD=synthetic-secret\n', None), (valid + b'RELAY=https://duplicate.invalid/\n', None)]:
            with self.assertRaises(ValueError):
                worker.validate_client_config(data, expected or hashlib.sha256(data).hexdigest())

    def test_zip_rejects_path_escape_symlink_extra_file_and_duplicate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            for i, names in enumerate([['../outside'], ['/absolute'], ['secret.env'], ['receipt.json', 'receipt.json']]):
                archive = root / f'{i}.zip'
                with zipfile.ZipFile(archive, 'w') as z:
                    for name in names:
                        z.writestr(name, b'synthetic')
                with self.assertRaises(ValueError):
                    worker.safe_unzip(archive, root / f'out{i}', exact_names=['release.ipa', 'receipt.json'])
            archive = root / 'symlink.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                item = zipfile.ZipInfo('link'); item.external_attr = 0o120777 << 16
                z.writestr(item, '../../outside')
            with self.assertRaises(ValueError):
                worker.safe_unzip(archive, root / 'out-link')
            self.assertFalse((root / 'outside').exists())

    def test_unpack_binds_real_bytes_not_just_receipt_claim(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            with zipfile.ZipFile(root / 'artifact.zip', 'w') as z:
                z.writestr('release.aab', b'actual-bytes')
                z.writestr('receipt.json', '{"schema":1}')
            context = {'operation': 'play-internal-upload', 'artifactSha256': '0' * 64}
            with self.assertRaises(ValueError):
                worker.unpack(context, root)

    def test_profile_rejects_wrong_identity_team_app_development_and_expiry(self):
        cert = b'public-synthetic-certificate'
        thumbprint = hashlib.sha256(cert).hexdigest()
        good = {'UUID': 'approved', 'TeamIdentifier': ['ABCDEFGHIJ'], 'ExpirationDate': datetime.datetime.now() + datetime.timedelta(days=1),
                'DeveloperCertificates': [cert], 'Entitlements': {'application-identifier': 'ABCDEFGHIJ.io.hexawallet.keeper', 'get-task-allow': False}}
        worker.validate_profile(good, thumbprint, 'ABCDEFGHIJ', 'approved')
        for change in [{'UUID': 'other'}, {'TeamIdentifier': ['OTHER']}, {'DeveloperCertificates': [b'other']},
                       {'ExpirationDate': datetime.datetime(2000, 1, 1)}, {'ProvisionedDevices': ['device']},
                       {'Entitlements': {'application-identifier': 'ABCDEFGHIJ.io.hexawallet.keeper', 'get-task-allow': True}}]:
            with self.assertRaises(ValueError):
                worker.validate_profile({**good, **change}, thumbprint, 'ABCDEFGHIJ', 'approved')

    def test_upload_only_calls_standalone_uploader_without_building(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp); private = root / 'private'; private.mkdir(); (private / 'input').mkdir()
            artifact = private / 'input/release.aab'; artifact.write_bytes(b'synthetic-signed-bytes')
            context = {'operation': 'play-internal-upload', 'sourceSha': 'a' * 40, 'driverSha': 'b' * 40, 'version': '2.6.5', 'build': '628',
                       'artifactSha256': worker.digest(artifact), 'identitySha256': 'c' * 64, 'configSha256': 'd' * 64, 'runId': '123', 'runAttempt': 1,
                       'approvalCommentId': '789', 'approvalExpiresAt': (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=3)).isoformat(),
                       'artifactId': '456', 'sourceRunId': '123', 'sourceRunAttempt': 1}
            env = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted', 'KEEPER_EXPECTED_CERT_SHA256': 'c' * 64,
                   'KEEPER_EXPECTED_CONFIG_SHA256': 'd' * 64, 'RUNNER_TEMP': str(root)}
            with mock.patch.dict(os.environ, env), mock.patch.object(worker, 'verify_artifact'), mock.patch.object(worker, 'upload') as upload, mock.patch.object(worker, 'run'), mock.patch.object(worker, 'build_ios') as ios, mock.patch.object(worker, 'build_android') as android:
                worker.execute(context, root, private)
                upload.assert_called_once(); ios.assert_not_called(); android.assert_not_called()
            receipt = json.loads((root / 'keeper-release-output/receipt.json').read_text())
            self.assertTrue(receipt['storeUploaded']); self.assertFalse(receipt['storeProcessingVerified'])
            self.assertEqual(list((root / 'keeper-release-output').iterdir()), [root / 'keeper-release-output/receipt.json'])

    def test_wrong_expected_fingerprint_stops_before_any_native_or_upload_action(self):
        with mock.patch.dict(os.environ, {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted', 'KEEPER_EXPECTED_CERT_SHA256': 'bad'}), mock.patch.object(worker, 'run') as run, mock.patch.object(worker, 'upload') as upload:
            with self.assertRaises(ValueError):
                worker.execute({'identitySha256': 'a' * 64}, pathlib.Path('.'), pathlib.Path('.'))
            run.assert_not_called(); upload.assert_not_called()

    def test_secret_file_is_private_exclusive_and_not_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = pathlib.Path(tmp) / 'credential'
            with mock.patch.dict(os.environ, {'SYNTHETIC_SECRET': base64.b64encode(b'not-real').decode()}):
                worker.decode_secret('SYNTHETIC_SECRET', target)
                self.assertEqual(target.stat().st_mode & 0o777, 0o600)
                with self.assertRaises(FileExistsError):
                    worker.decode_secret('SYNTHETIC_SECRET', target)


if __name__ == '__main__':
    unittest.main()
