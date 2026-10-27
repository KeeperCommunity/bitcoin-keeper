import copy
import errno
import hashlib
import io
import json
import socket
import subprocess
import tempfile
from unittest.mock import Mock, patch
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('tls_native', Path(__file__).parents[1] / 'native/r52_tls_native.py')
matrix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(matrix)


class EvidenceControls(unittest.TestCase):
    def fixture(self):
        config = {'nonce': 'c' * 48, 'cases': [
            {'id': 'valid', 'expected': 'ACCEPT'}, {'id': 'expired', 'expected': 'REJECT'}]}
        app = {'schema': 1, 'scope': 'ACTUAL_APP_RN_PRODUCTION_TLS_BRIDGE', 'nonce': config['nonce'],
               'platform': 'IOS', 'status': 'PASS', 'cases': [
                   {'id': 'valid', 'outcome': 'ACCEPT', 'connected': True},
                   {'id': 'expired', 'outcome': 'REJECT', 'connected': False}]}
        server = {'valid': {'connections': 1, 'secure_connections': 1, 'requests': 1, 'invalid_payloads': 0},
                  'expired': {'connections': 1, 'secure_connections': 0, 'requests': 0, 'invalid_payloads': 0}}
        return config, app, server

    def test_exact_native_and_server_evidence_required(self):
        args = self.fixture()
        self.assertEqual(len(matrix.validate(*args, 'IOS')), 2)

    def test_unreachable_negative_cannot_pass_as_certificate_rejection(self):
        config, app, server = self.fixture()
        server['expired']['connections'] = 0
        with self.assertRaises(ValueError):
            matrix.validate(config, app, server, 'IOS')

    def test_missing_reply_wrong_nonce_timeout_and_plaintext_are_rejected(self):
        mutations = [lambda c, a, s: a.update(nonce='d' * 48),
                     lambda c, a, s: a['cases'][1].update(outcome='TIMEOUT'),
                     lambda c, a, s: a['cases'][1].update(connected=True),
                     lambda c, a, s: s['expired'].update(requests=1),
                     lambda c, a, s: s['valid'].update(requests=0),
                     lambda c, a, s: a['cases'].pop(),
                     lambda c, a, s: a.update(platform='ANDROID'),
                     lambda c, a, s: s['valid'].update(connections=True)]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                args = copy.deepcopy(self.fixture())
                mutation(*args)
                with self.assertRaises(ValueError):
                    matrix.validate(*args, 'IOS')

    def test_local_or_unbound_public_runner_never_executes_app_probe(self):
        class Harness:
            PLATFORM = 'IOS'
            def read(self):
                return {'build': 'PASS', 'smoke': 'PASS'}
            def artifact_identity(self):
                raise AssertionError('Rejected context must not inspect an app artifact')
        for env in ({}, dict(GITHUB_ACTIONS='true', RUNNER_ENVIRONMENT='github-hosted',
                             GITHUB_REPOSITORY='KeeperCommunity/bitcoin-keeper',
                             GITHUB_REPOSITORY_ID='470904030', KEEPER_DIAGNOSTIC='false')):
            with self.subTest(env=env), patch.dict('os.environ', env, clear=True), \
                    patch.object(matrix.subprocess, 'Popen') as spawn, patch.object(matrix.subprocess, 'run') as cleanup:
                with self.assertRaisesRegex(RuntimeError, 'TLS_PRIVATE_HOSTED'):
                    matrix.run(Harness())
                spawn.assert_not_called(); cleanup.assert_not_called()

    def test_rejected_android_serial_and_ios_udid_never_become_cleanup_targets(self):
        for platform, candidate in [('ANDROID', 'physical-serial'), ('IOS', 'all')]:
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); generated = root / '.github/native/.generated/r52_tls_fixture.json'
                generated.parent.mkdir(parents=True)
                config = dict(schema=1, nonce='a' * 48, platform=platform,
                              cases=[dict(id='valid', port=31000, expected='ACCEPT')],
                              rpc=dict(selected=dict(port=31001), other=dict(port=31002), control_port=31003))
                saved = []; commands = []
                data = dict(build='PASS', smoke='PASS', source_sha='a' * 40, built_artifact={'hash': 'fixed'})
                class Harness:
                    ROOT = root
                    PRIVATE = root
                    PLATFORM = platform
                    APP_IDS = {platform: 'owned.test.app'}
                    def read(self): return data
                    def save(self, value): saved.append(value)
                    def artifact_identity(self): return data['built_artifact']
                    def warm_metro_bundle(self, _suite): pass
                    def command(self, args, *_args, **_kwargs):
                        commands.append(args)
                        return candidate if args[0] in ['adb', 'xcrun'] else ''
                class Fixture:
                    stdin = io.StringIO()
                    stdout = io.StringIO()
                    returncode = None
                    def poll(self): return self.returncode
                    def wait(self, **_kwargs):
                        generated.unlink(missing_ok=True); self.returncode = 0; return 0
                metro = Mock(); metro.poll.side_effect = [None, None, 0]
                response = Mock(); response.__enter__ = Mock(return_value=response); response.__exit__ = Mock(return_value=False)
                response.read.return_value = b'packager-status:running'
                def spawn(args, **_kwargs):
                    if not any(arg.endswith('r52_tls_fixture.cjs') for arg in args): return metro
                    generated.write_text(json.dumps(config)); return Fixture()
                ready = dict(ready=True, ports=[31000, 31001, 31002, 31003], config_sha256=hashlib.sha256(json.dumps(config).encode()).hexdigest())
                with patch.dict('os.environ', dict(GITHUB_ACTIONS='true', RUNNER_ENVIRONMENT='github-hosted',
                                GITHUB_REPOSITORY='KeeperCommunity/bitcoin-keeper-private', KEEPER_SOURCE_SHA='a' * 40)), \
                     patch.object(matrix.subprocess, 'check_output', return_value='a' * 40), \
                     patch.object(matrix.subprocess, 'Popen', side_effect=spawn), \
                     patch.object(matrix, 'receive', return_value=ready), \
                     patch.object(matrix, 'verify_source'), patch.object(matrix, 'require_free_metro_port'), \
                     patch.object(matrix.subprocess, 'run') as cleanup, \
                     patch.object(matrix.os, 'killpg'), \
                     patch.object(matrix.urllib.request, 'urlopen', return_value=response):
                    with self.assertRaisesRegex(RuntimeError, 'TLS_OWNED_DEVICE_REQUIRED'):
                        matrix.run(Harness())
                    cleanup.assert_not_called()
                    self.assertEqual(saved[-1]['r52_tls_native']['status'], 'FAIL')
                    self.assertEqual(saved[-1]['r52_tls_native']['cleanup'], 'PASS')
                    self.assertFalse(any('install' in args or 'reverse' in args for args in commands))

    def test_existing_metro_listener_is_rejected(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener, \
                socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            listener.bind(('127.0.0.1', 0)); listener.listen()
            # Keep real EADDRINUSE, but isolate it from shared/foreign port8081.
            def bind_owned(address):
                self.assertEqual(address, ('127.0.0.1', 8081))
                probe.bind(listener.getsockname())
            with patch.object(matrix._BOUNDARY.socket, 'socket') as sockets:
                sockets.return_value.__enter__.return_value.bind.side_effect = bind_owned
                with self.assertRaisesRegex(RuntimeError, 'TLS_METRO_PORT_OCCUPIED') as rejected:
                    matrix.require_free_metro_port()
                sockets.assert_called_once_with(socket.AF_INET, socket.SOCK_STREAM)
            self.assertEqual(rejected.exception.__cause__.errno, errno.EADDRINUSE)

    def test_preparation_failure_keeps_original_error_and_fixed_category(self):
        for error, expected in [(RuntimeError('TLS_UNTRACKED_SOURCE'), 'TLS_UNTRACKED_SOURCE'),
                                (RuntimeError('TLS_METRO_PORT_OCCUPIED'), 'TLS_METRO_PORT_OCCUPIED'),
                                (RuntimeError('PRIVATE_SENTINEL'), 'UNCLASSIFIED_PREPARATION_FAILURE')]:
            with self.subTest(expected=expected):
                data = dict(source_sha='a' * 40)
                saved = []
                harness = Mock(PLATFORM='ANDROID')
                harness.read.return_value = data
                harness.save.side_effect = lambda value: saved.append(copy.deepcopy(value))
                with patch.object(matrix, '_run_with_preparation', side_effect=error):
                    with self.assertRaises(RuntimeError) as raised:
                        matrix.run(harness)
                self.assertIs(raised.exception, error)
                outcome = saved[-1]['r52_tls_native']
                self.assertEqual(outcome['status'], 'FAIL')
                self.assertEqual(outcome['cases'], [])
                self.assertEqual(outcome['preparation_failure'], expected)
                self.assertFalse(outcome['full_r52_acceptance'])
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(saved))

    def test_runtime_failure_receipt_is_not_replaced_by_preparation_diagnosis(self):
        current = dict(r52_tls_native=dict(status='FAIL', scope='ACTUAL_APP_RN_PRODUCTION_TLS_BRIDGE', cases=[]))
        harness = Mock(PLATFORM='ANDROID'); harness.read.return_value = current
        with patch.object(matrix, '_run_with_preparation', side_effect=RuntimeError('PRIVATE_SENTINEL')):
            with self.assertRaises(RuntimeError):
                matrix.run(harness)
        harness.save.assert_not_called()

    def test_child_failure_before_ready_is_not_successful_cleanup(self):
        class DeadFixture:
            def poll(self):
                return 1
        with self.assertRaisesRegex(RuntimeError, 'TLS_FIXTURE_CLEANUP_UNVERIFIED'):
            matrix.close_fixture(DeadFixture())

    def test_raw_source_detects_assume_unchanged_and_untracked_platform_substitution(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'src').mkdir()
            file = root / 'src/row.js'; file.write_bytes(b'original')
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL).decode().strip()
            git('init', '-q'); git('add', 'src/row.js')
            git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
            source = git('rev-parse', 'HEAD')
            matrix.verify_source(root, source)
            git('update-index', '--assume-unchanged', 'src/row.js'); file.write_bytes(b'modified')
            self.assertEqual(git('diff'), '')
            with self.assertRaisesRegex(RuntimeError, 'RAW_SOURCE_BYTES'):
                matrix.verify_source(root, source)
            file.write_bytes(b'original'); (root / 'src/row.ios.js').write_bytes(b'substitution')
            with self.assertRaisesRegex(RuntimeError, 'UNTRACKED_SOURCE'):
                matrix.verify_source(root, source)

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
            matrix.verify_source(root, source, overlay)
            for changed in ({'before_sha256': '0' * 64}, {'after_sha256': '0' * 64},
                            {'allowed_fields': ['browser']}, {'path': 'other.json'}):
                with self.assertRaisesRegex(RuntimeError, 'OVERLAY_UNRECORDED'):
                    matrix.verify_source(root, source, {**overlay, **changed})
            file.write_bytes(original)
            with self.assertRaisesRegex(RuntimeError, 'OVERLAY_UNRECORDED'):
                matrix.verify_source(root, source, overlay)
            file.write_bytes(installed)
            with self.assertRaisesRegex(RuntimeError, 'OVERLAY_UNRECORDED'):
                matrix.verify_source(root, source)
            modified['dependencies']['realm'] = '13.0.0'; installed = json.dumps(modified).encode(); file.write_bytes(installed)
            overlay['after_sha256'] = hashlib.sha256(installed).hexdigest()
            with self.assertRaisesRegex(RuntimeError, 'PROTECTED_FIELDS'):
                matrix.verify_source(root, source, overlay)
            modified['dependencies']['realm'] = '12.15.0'; modified['private'] = 1
            installed = json.dumps(modified).encode(); file.write_bytes(installed)
            overlay['after_sha256'] = hashlib.sha256(installed).hexdigest()
            with self.assertRaisesRegex(RuntimeError, 'PROTECTED_FIELDS'):
                matrix.verify_source(root, source, overlay)


if __name__ == '__main__':
    unittest.main()
