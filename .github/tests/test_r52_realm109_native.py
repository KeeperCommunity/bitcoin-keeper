import copy
import hashlib
import importlib.util
import json
import socket
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('realm109', Path(__file__).parents[1] / 'native/r52_realm109_native.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class NativeReceiptContracts(unittest.TestCase):
    def payload(self):
        return dict(schema=1, scope=fixture.SCOPE, source_sha='a' * 40, platform='IOS', nonce='b' * 48,
                    historical_commit=fixture.HISTORICAL, manifest_sha256=fixture.MANIFEST, status='PASS',
                    old_version=109, new_version=110, schema_count=50, synthetic_database_cleanup='PASS',
                    cases=[dict(id=value, status='PASS') for value in fixture.CASES])

    def validate(self, value):
        return fixture.validate({'nonce': 'b' * 48}, value, 'IOS', 'a' * 40)

    def test_complete_exact_native_receipt(self):
        self.assertEqual(len(self.validate(self.payload())), 11)

    def test_wrong_source_platform_nonce_and_historical_identity_are_rejected(self):
        for key, value in [('source_sha', 'c' * 40), ('platform', 'ANDROID'), ('nonce', 'd' * 48),
                           ('historical_commit', 'e' * 40), ('manifest_sha256', 'f' * 64),
                           ('scope', 'HOST_REALM'), ('old_version', 110), ('new_version', 109),
                           ('schema_count', 49), ('schema', True), ('synthetic_database_cleanup', 'FAIL')]:
            with self.subTest(key=key):
                payload = self.payload(); payload[key] = value
                with self.assertRaises(ValueError):
                    self.validate(payload)

    def test_missing_repeated_failed_or_extra_cases_are_rejected(self):
        for change in [lambda p: p['cases'].pop(), lambda p: p['cases'].append(p['cases'][0]),
                       lambda p: p['cases'][2].update(status='NOT RUN'), lambda p: p['cases'].reverse(),
                       lambda p: p.update(published_app_upgrade='PASS')]:
            payload = copy.deepcopy(self.payload()); change(payload)
            with self.assertRaises(ValueError):
                self.validate(payload)

    def test_local_context_cannot_execute_native_probe(self):
        class Harness:
            def read(self):
                return {'build': 'PASS', 'smoke': 'PASS'}
        with self.assertRaisesRegex(RuntimeError, 'PRIVATE_HOSTED'):
            fixture.run(Harness())

    def test_generated_bytes_digest_and_path_boundaries(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            rows = []
            for i in range(16):
                name = str(i) + '.js'; (root / name).write_bytes(b'fixture')
                rows.append(dict(name=name, sha256=hashlib.sha256(b'fixture').hexdigest()))
            raw = json.dumps({'generated': rows}).encode(); (root / 'config.json').write_bytes(raw)
            digest = hashlib.sha256(raw).hexdigest()
            self.assertEqual(len(fixture.verify_generated(root, digest)['generated']), 16)
            (root / '0.js').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'BYTES'):
                fixture.verify_generated(root, digest)
            (root / '0.js').unlink(); (root / '0.js').symlink_to(root / '1.js')
            with self.assertRaisesRegex(ValueError, 'BYTES'):
                fixture.verify_generated(root, digest)
            with self.assertRaisesRegex(ValueError, 'IDENTITY'):
                fixture.verify_generated(root, '0' * 64)

    def test_extra_platform_module_and_symlinked_parent_cannot_enter_metro_closure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'src').mkdir()
            rows = []
            for i in range(16):
                name = 'src/' + str(i) + '.js'; (root / name).write_bytes(b'fixture')
                rows.append(dict(name=name, sha256=hashlib.sha256(b'fixture').hexdigest()))
            raw = json.dumps({'generated': rows}).encode(); (root / 'config.json').write_bytes(raw)
            digest = hashlib.sha256(raw).hexdigest()
            fixture.verify_generated(root, digest)
            extra = root / 'src/0.ios.js'; extra.write_bytes(b'platform substitution')
            with self.assertRaisesRegex(ValueError, 'INVENTORY'):
                fixture.verify_generated(root, digest)
            extra.unlink(); (root / 'src').rename(root / 'other'); (root / 'src').symlink_to(root / 'other')
            with self.assertRaisesRegex(ValueError, 'INVENTORY'):
                fixture.verify_generated(root, digest)

    def test_rejected_device_identity_is_never_given_to_cleanup(self):
        for platform, candidate in [('ANDROID', 'physical-phone-serial'), ('IOS', 'unknown-device')]:
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); saved = []
                data = dict(build='PASS', smoke='PASS', source_sha='a' * 40, built_artifact={'hash': 'fixed'})
                config = dict(schema=1, scope=fixture.SCOPE, source_sha='a' * 40, platform=platform,
                              nonce='b' * 48, historical_commit=fixture.HISTORICAL, manifest_sha256=fixture.MANIFEST,
                              realm_package='12.15.0', schema_count=50)
                class Harness:
                    PLATFORM = platform
                    ROOT = root
                    PRIVATE = root
                    def read(self): return data
                    def save(self, value): saved.append(value)
                    def artifact_identity(self): return data['built_artifact']
                    def command(self, args, *_args, **_kwargs):
                        if args[0] == 'node':
                            return json.dumps(dict(config_sha256='f' * 64, generated_modules=16, historical_files=17))
                        return candidate if args[0] in ['adb', 'xcrun'] else ''
                with patch.dict('os.environ', dict(GITHUB_ACTIONS='true', RUNNER_ENVIRONMENT='github-hosted',
                                GITHUB_REPOSITORY='KeeperCommunity/bitcoin-keeper-private', KEEPER_SOURCE_SHA='a' * 40)), \
                     patch.object(fixture.subprocess, 'check_output', return_value='a' * 40), \
                     patch.object(fixture, 'verify_source'), patch.object(fixture, 'require_free_metro_port'), \
                     patch.object(fixture, 'verify_generated', return_value=config), \
                     patch.object(fixture.subprocess, 'run') as cleanup:
                    with self.assertRaisesRegex(RuntimeError, 'OWNED_DEVICE'):
                        fixture.run(Harness())
                    cleanup.assert_not_called()
                    self.assertEqual(saved[-1]['r52_realm109_native']['status'], 'FAIL')

    def test_existing_loopback_metro_listener_is_rejected(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(('127.0.0.1', 8081)); listener.listen()
            with self.assertRaisesRegex(RuntimeError, 'PORT_OCCUPIED'):
                fixture.require_free_metro_port()

    def test_raw_source_detects_assume_unchanged_and_untracked_platform_substitution(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'src').mkdir()
            file = root / 'src/row.js'; file.write_bytes(b'original')
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL).decode().strip()
            git('init', '-q'); git('add', 'src/row.js')
            git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
            source = git('rev-parse', 'HEAD')
            fixture.verify_source(root, source)
            git('update-index', '--assume-unchanged', 'src/row.js'); file.write_bytes(b'modified')
            self.assertEqual(git('diff'), '')
            with self.assertRaisesRegex(RuntimeError, 'RAW_SOURCE_BYTES'):
                fixture.verify_source(root, source)
            file.write_bytes(b'original'); (root / 'src/row.ios.js').write_bytes(b'substitution')
            with self.assertRaisesRegex(RuntimeError, 'UNTRACKED_SOURCE'):
                fixture.verify_source(root, source)

    def test_only_exact_recorded_nodeify_mapping_overlay_is_admitted(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = json.dumps({'private': True, 'dependencies': {'realm': '12.15.0'}, 'browser': {'crypto': 'react-native-crypto'}}).encode()
            file = root / 'package.json'; file.write_bytes(original)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL).decode().strip()
            git('init', '-q'); git('add', 'package.json')
            git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
            source = git('rev-parse', 'HEAD')
            modified = json.loads(original); modified['browser']['path'] = 'path-browserify'
            installed = json.dumps(modified).encode(); file.write_bytes(installed)
            overlay = dict(path='package.json', allowed_fields=['browser', 'react-native', 'browserify'],
                           before_sha256=hashlib.sha256(original).hexdigest(), after_sha256=hashlib.sha256(installed).hexdigest())
            fixture.verify_source(root, source, overlay)
            with self.assertRaisesRegex(RuntimeError, 'OVERLAY_UNRECORDED'):
                fixture.verify_source(root, source)
            modified['dependencies']['realm'] = '13.0.0'; installed = json.dumps(modified).encode(); file.write_bytes(installed)
            overlay['after_sha256'] = hashlib.sha256(installed).hexdigest()
            with self.assertRaisesRegex(RuntimeError, 'PROTECTED_FIELDS'):
                fixture.verify_source(root, source, overlay)
            modified['dependencies']['realm'] = '12.15.0'; modified['private'] = 1
            installed = json.dumps(modified).encode(); file.write_bytes(installed)
            overlay['after_sha256'] = hashlib.sha256(installed).hexdigest()
            with self.assertRaisesRegex(RuntimeError, 'PROTECTED_FIELDS'):
                fixture.verify_source(root, source, overlay)

    def test_generated_parent_alias_is_rejected_before_reading_config(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); actual = root / 'actual'; actual.mkdir(); (actual / 'child').mkdir()
            alias = root / 'alias'; alias.symlink_to(actual, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'IDENTITY'):
                fixture.verify_generated(alias / 'child', '0' * 64)


if __name__ == '__main__':
    unittest.main()
