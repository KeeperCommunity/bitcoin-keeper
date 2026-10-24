"""Real private-file projection and source preparation controls; no native claims."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


observe = load('pod_observe', HERE / 'native/pod_diagnostics.py')
native = load('pod_native', HERE / 'native/hosted_native.py')


class PodDiagnostics(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'ios').mkdir()
        for name in ('Gemfile', 'Gemfile.lock', 'yarn.lock'):
            (self.root / name).write_text('fixed-input')
        (self.root / 'ios/Podfile.lock').write_text(
            'PODS:\n  - FirebaseAnalytics (11.0.0)\n  - React-Core (0.83.9):\n'
            '    - nested-private-value\nDEPENDENCIES:\n  - PRIVATE_SENTINEL\n')
        self.log = self.root / 'log'
        self.before = observe.lock_state(self.root)

    def project(self, text):
        self.log.write_text(text)
        return observe.observe(self.log, observe.locked_pods(self.root), self.before, self.before)

    def test_download_failure_identifies_only_locked_pod_fixed_categories_and_codes(self):
        result = self.project('[!] Error installing FirebaseAnalytics\n'
            'curl: (22) The requested URL returned error: 503\n'
            'https://private.test/token=PRIVATE_SENTINEL\n')
        self.assertEqual(result['reported_failed_locked_pods'], ['FirebaseAnalytics'])
        self.assertEqual(result['http_statuses'], [503])
        self.assertEqual(result['curl_exit_codes'], [22])
        self.assertIn('DEPENDENCY_HTTP_SERVER_FAILURE', result['categories'])
        self.assertTrue(result['locks_unchanged'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_unclassified_and_arbitrary_error_text_never_leaves(self):
        result = self.project('[!] PRIVATE_SENTINEL mnemonic token=arbitrary\n'
                              'not an error: password=PRIVATE_SENTINEL\n')
        self.assertEqual(result['categories'], [])
        self.assertEqual(result['unclassified_error_lines'], 1)
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        self.assertEqual(result['state'], 'OBSERVED')

    def test_foreign_pod_or_dependency_section_values_do_not_leave(self):
        result = self.project('[!] Error installing PRIVATE_SENTINEL\n')
        self.assertEqual(result['reported_failed_locked_pods'], [])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_specific_failure_types_are_finite_and_do_not_return_suffixes(self):
        for text, category in [
            ('curl: (6) Could not resolve host: PRIVATE_SENTINEL', 'DEPENDENCY_DNS_FAILURE'),
            ('curl: (60) SSL certificate problem PRIVATE_SENTINEL', 'DEPENDENCY_TLS_FAILURE'),
            ('curl: (28) Operation timed out PRIVATE_SENTINEL', 'DEPENDENCY_COMMAND_TIMEOUT'),
            ('[!] Verification checksum was incorrect PRIVATE_SENTINEL', 'POD_CHECKSUM_MISMATCH'),
            ('[!] CocoaPods could not find compatible versions PRIVATE_SENTINEL', 'POD_LOCK_CONFLICT'),
            ('[!] Unable to find a specification PRIVATE_SENTINEL', 'POD_SPEC_UNAVAILABLE'),
            ('[!] Invalid Podfile: NoMethodError PRIVATE_SENTINEL', 'RUBY_TOOL_FAILURE'),
            ('HTTP/2 404 PRIVATE_SENTINEL', 'DEPENDENCY_HTTP_CLIENT_FAILURE'),
            ('CDN: trunk URL couldn\'t be downloaded PRIVATE_SENTINEL', 'DEPENDENCY_DOWNLOAD_FAILURE'),
        ]:
            with self.subTest(category=category):
                result = self.project(text)
                self.assertIn(category, result['categories'])
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_caps_and_bad_numeric_shapes_are_explicit(self):
        result = self.project('[!] PRIVATE_SENTINEL\n' * (observe.LINE_LIMIT + 1))
        self.assertTrue(result['line_limit_reached'])
        self.assertEqual(result['unclassified_error_lines'], observe.LINE_LIMIT)
        result = self.project('x' * (observe.LIMIT + 1))
        self.assertTrue(result['input_truncated'])
        self.assertEqual(result['bytes_read'], observe.LIMIT)
        for text in ('curl: (123456) PRIVATE_SENTINEL', 'HTTP/2 999 PRIVATE_SENTINEL',
                     'HTTP/2 503123456 PRIVATE_SENTINEL'):
            result = self.project(text)
            self.assertEqual(result['http_statuses'], [])
            self.assertEqual(result['curl_exit_codes'], [])

    def test_missing_symlink_and_fifo_logs_stay_unknown_without_opening_a_target(self):
        for mode in ('missing', 'symlink', 'fifo'):
            self.log.unlink(missing_ok=True)
            if mode == 'symlink':
                self.log.symlink_to(self.root / 'Gemfile')
            elif mode == 'fifo':
                os.mkfifo(self.log)
            result = observe.observe(self.log, set(), self.before, self.before)
            self.assertEqual(result['state'], 'UNKNOWN', mode)
            self.assertNotIn('fixed-input', json.dumps(result))
        self.log.unlink(missing_ok=True)

    def test_changed_or_missing_input_cannot_satisfy_lock_fence(self):
        (self.root / 'Gemfile.lock').write_text('changed')
        self.log.write_text('')
        result = observe.observe(self.log, set(), self.before, observe.lock_state(self.root))
        self.assertFalse(result['locks_unchanged'])
        (self.root / 'Gemfile.lock').unlink()
        self.assertIsNone(observe.lock_state(self.root)['Gemfile.lock'])

    def native_context(self):
        return mock.patch.multiple(native, ROOT=self.root, PRIVATE=self.root / 'private',
            EVIDENCE=self.root / 'evidence.json', PLATFORM='IOS')

    def test_real_failed_command_keeps_primary_exit_and_persists_safe_facts(self):
        with self.native_context(), contextlib.redirect_stdout(io.StringIO()) as output:
            native.save({'commands': []})
            script = 'print("[!] Error installing React-Core"); print("curl: (6) PRIVATE_SENTINEL"); raise SystemExit(7)'
            with self.assertRaisesRegex(RuntimeError, 'exit 7'):
                native.dependency_command([sys.executable, '-c', script], 'Fixed install', 'PODS_DEPLOYMENT')
            data = native.read()
        facts = data['dependency_install_observations']['PODS_DEPLOYMENT']
        self.assertEqual(data['commands'][0]['exit_code'], 7)
        self.assertEqual(facts['curl_exit_codes'], [6])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))
        self.assertNotIn('PRIVATE_SENTINEL', output.getvalue())

    def test_observer_failure_cannot_replace_original_failure(self):
        with self.native_context(), mock.patch.object(native, 'command', side_effect=RuntimeError('PRIMARY')), \
                mock.patch.object(native.importlib.util, 'module_from_spec') as factory:
            native.save({'commands': []})
            observer = mock.Mock()
            observer.observe.side_effect = ValueError('PRIVATE_SENTINEL')
            factory.return_value = observer
            with mock.patch.object(native.importlib.util, 'spec_from_file_location') as spec:
                spec.return_value.loader.exec_module = lambda _: None
                with self.assertRaisesRegex(RuntimeError, '^PRIMARY$'):
                    native.dependency_command(['bundle'], 'Fixed install', 'RUBY_BUNDLE')

    def test_prepare_reuses_frozen_bundle_and_dependency_only_stops_before_native_tools(self):
        (self.root / 'package.json').write_text('{}')
        for only in (False, True):
            calls = []
            def command(args, label, *unused, **kwargs):
                calls.append((args, label))
            with self.native_context(), mock.patch.dict(os.environ, {
                    'KEEPER_DIAGNOSTIC': 'true', 'KEEPER_DEPENDENCIES_ONLY': str(only).lower(),
                    'KEEPER_POD_LOCK_REPAIR': ''}), \
                    mock.patch.object(native, 'command', side_effect=command), \
                    mock.patch.object(native, 'dependency_command', side_effect=command), \
                    mock.patch.object(native.subprocess, 'check_output', return_value=b''), \
                    mock.patch.object(native, 'disk_preflight'), mock.patch.object(native, 'fixtures'), \
                    mock.patch.object(native, 'install_maestro') as maestro:
                native.save({'commands': []})
                native.prepare()
                result = native.read()
                self.assertEqual(os.environ['BUNDLE_FROZEN'], 'true')
                self.assertEqual(os.environ['BUNDLE_PATH'], str(native.PRIVATE / 'ruby-gems'))
            args = [call[0] for call in calls]
            self.assertIn(['bundle', 'install', '--jobs', '4', '--retry', '1'], args)
            self.assertIn(['bundle', 'check'], args)
            self.assertIn(['bundle', 'exec', 'pod', 'install', '--deployment'], args)
            self.assertFalse(any(arg[0] == 'gem' or arg[0] == 'pod' for arg in args))
            self.assertEqual(maestro.call_count, 0 if only else 1)
            self.assertEqual(any(arg[0] == 'sudo' for arg in args), not only)
            if only:
                self.assertEqual(result['dependency_preparation'],
                    {'scope': 'DEPENDENCIES_ONLY_NOT_NATIVE_ACCEPTANCE', 'status': 'PASS', 'native_credit': False})

    def test_dependency_only_cannot_run_on_android_or_without_diagnostic_authority(self):
        for platform, diagnostic in [('ANDROID', 'true'), ('IOS', 'false')]:
            with mock.patch.object(native, 'PLATFORM', platform), mock.patch.dict(os.environ, {
                    'KEEPER_DIAGNOSTIC': diagnostic, 'KEEPER_DEPENDENCIES_ONLY': 'true'}), \
                    mock.patch.object(native, 'disk_preflight') as disk:
                with self.assertRaisesRegex(RuntimeError, 'requires an iOS diagnostic'):
                    native.prepare()
                disk.assert_not_called()

    def test_dependency_only_rejects_lock_repair_before_any_command(self):
        with self.native_context(), mock.patch.dict(os.environ, {
                'KEEPER_DIAGNOSTIC': 'true', 'KEEPER_DEPENDENCIES_ONLY': 'true',
                'KEEPER_POD_LOCK_REPAIR': '1'}), mock.patch.object(native, 'disk_preflight') as disk:
            with self.assertRaisesRegex(RuntimeError, 'cannot repair locks'):
                native.prepare()
            disk.assert_not_called()

    def test_successful_command_cannot_hide_changed_locks(self):
        def command(*args, **kwargs):
            (self.root / 'Gemfile.lock').write_text('changed')
        with self.native_context(), mock.patch.object(native, 'command', side_effect=command), \
                contextlib.redirect_stdout(io.StringIO()):
            native.save({'commands': []})
            with self.assertRaisesRegex(RuntimeError, 'input changed'):
                native.dependency_command(['bundle'], 'Fixed install', 'RUBY_BUNDLE')
            self.assertFalse(native.read()['dependency_install_observations']['RUBY_BUNDLE']['locks_unchanged'])

    def test_failed_preparation_is_explicit_and_does_not_supply_a_native_pass(self):
        with self.native_context(), mock.patch.object(native, 'prepare', side_effect=RuntimeError('PRIMARY')):
            native.save({'commands': [], 'build': 'NOT RUN', 'smoke': 'NOT RUN',
                         'dependency_preparation': {'status': 'RUNNING', 'native_credit': False}})
            with self.assertRaisesRegex(RuntimeError, '^PRIMARY$'):
                native.run_phase('prepare')
            result = native.read()
            self.assertEqual(result['dependency_preparation']['status'], 'FAIL')
            self.assertEqual((result['build'], result['smoke']), ('NOT RUN', 'NOT RUN'))


if __name__ == '__main__':
    unittest.main()
