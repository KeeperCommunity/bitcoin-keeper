"""Host-only Phase A harness contracts; no native runtime or platform credit."""
import contextlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    'release_native', Path(__file__).resolve().parents[1] / 'native' / 'hosted_native.py')
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)


class ReleaseJunitTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.report = Path(directory.name) / 'probe.xml'

    def test_actual_success_cases_are_required(self):
        self.report.write_text('<testsuites><testsuite tests="1" failures="0"><testcase status="SUCCESS"/>'
                               '</testsuite></testsuites>')
        self.assertEqual(native.successful_junit(self.report), 1)

    def test_missing_empty_oversized_or_malformed_report_never_passes(self):
        with self.assertRaises(RuntimeError):
            native.successful_junit(self.report)
        for content in ['', '<testsuites/>', 'x' * (1024 * 1024 + 1), '<invalid']:
            with self.subTest(content=content[:20]):
                self.report.write_text(content)
                with self.assertRaises(Exception):
                    native.successful_junit(self.report)

    def test_failure_error_skipped_and_non_success_case_never_pass(self):
        for tag in ['failure', 'error', 'skipped']:
            with self.subTest(tag=tag):
                self.report.write_text(f'<testsuite><testcase status="SUCCESS"><{tag}/></testcase></testsuite>')
                with self.assertRaises(RuntimeError):
                    native.successful_junit(self.report)
        for status in ['ERROR', 'FAILED', 'SKIPPED', 'PENDING', '']:
            with self.subTest(status=status):
                self.report.write_text(f'<testsuite><testcase status="{status}"/></testsuite>')
                with self.assertRaises(RuntimeError):
                    native.successful_junit(self.report)

    def test_declared_suite_failures_without_child_details_never_pass(self):
        for field in ['failures', 'errors', 'skipped']:
            with self.subTest(field=field):
                self.report.write_text(f'<testsuite {field}="1"><testcase status="SUCCESS"/></testsuite>')
                with self.assertRaises(RuntimeError):
                    native.successful_junit(self.report)


class ReleaseNativeExecutionTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.private = self.root / 'private'
        self.private.mkdir()
        patch = mock.patch.multiple(native, ROOT=self.root, PRIVATE=self.private,
                                    EVIDENCE=self.root / 'metadata.json', PLATFORM='ANDROID')
        patch.start()
        self.addCleanup(patch.stop)
        self.identity = {'sha256': 'synthetic-artifact-identity'}
        native.save({'commands': [], 'build': 'PASS', 'smoke': 'PASS', 'native_probe': 'NOT RUN',
                     'built_artifact': self.identity, 'maestro': {'binary': 'synthetic-maestro'},
                     'toolchain': {}})

    def exercise(self, after_identity=None, maestro_failure=False, report_failure=False, report_missing=False):
        def command(args, label, **kwargs):
            if '--format' in args:
                if maestro_failure:
                    raise RuntimeError('PRIVATE_SENTINEL native failure')
                if not report_missing:
                    (self.private / 'probe-junit.xml').write_text(
                        '<testsuite><testcase status="SUCCESS">'
                        + ('<failure/>' if report_failure else '') + '</testcase></testsuite>')
            return 'emulator-5554'

        process = mock.Mock(pid=12345)
        process.poll.return_value = None
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'packager-status:running'
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(mock.patch.object(native.subprocess, 'check_call'))
        stack.enter_context(mock.patch.object(native.subprocess, 'Popen', return_value=process))
        stack.enter_context(mock.patch.object(native.subprocess, 'run'))
        stack.enter_context(mock.patch.object(native.os, 'killpg'))
        stack.enter_context(mock.patch.object(native.urllib.request, 'urlopen', return_value=response))
        stack.enter_context(mock.patch.object(native, 'command', side_effect=command))
        stack.enter_context(mock.patch.object(native, 'warm_metro_bundle'))
        stack.enter_context(mock.patch.object(native, 'android_sdk_metadata', return_value={}))
        stack.enter_context(mock.patch.object(native, 'verify_installed_artifact'))
        stack.enter_context(mock.patch.object(native, 'artifact_identity',
                           side_effect=[self.identity, after_identity or self.identity]))
        native.run_phase('probe')

    def test_probe_requires_actual_app_smoke_first(self):
        data = native.read()
        data['smoke'] = 'NOT RUN'
        native.save(data)
        with mock.patch.object(native.subprocess, 'check_call'), \
                mock.patch.object(native.subprocess, 'Popen') as popen:
            with self.assertRaisesRegex(RuntimeError, 'app startup smoke'):
                native.run_phase('probe')
        popen.assert_not_called()
        self.assertEqual(native.read()['native_probe'], 'FAIL')

    def test_changed_artifact_before_probe_stops_before_runtime(self):
        with mock.patch.object(native.subprocess, 'check_call'), \
                mock.patch.object(native, 'artifact_identity', return_value={'sha256': 'changed'}), \
                mock.patch.object(native.subprocess, 'Popen') as popen:
            with self.assertRaisesRegex(RuntimeError, 'artifact changed'):
                native.run_phase('probe')
        popen.assert_not_called()
        self.assertEqual(native.read()['native_probe'], 'FAIL')

    def test_probe_success_is_distinct_from_application_acceptance(self):
        self.exercise()
        data = native.read()
        self.assertEqual(data['native_probe'], 'PASS')
        self.assertEqual(data['native_probe_test_cases'], 1)
        self.assertIn('NOT app key deletion', data['probe_scope'])
        self.assertNotIn('release_ready', data)

    def test_artifact_change_during_execution_cannot_pass(self):
        with self.assertRaisesRegex(RuntimeError, 'artifact changed during'):
            self.exercise(after_identity={'sha256': 'changed'})
        self.assertEqual(native.read()['native_probe'], 'FAIL')

    def test_missing_new_report_cannot_reuse_stale_success(self):
        (self.private / 'probe-junit.xml').write_text('<testsuite><testcase status="SUCCESS"/></testsuite>')
        with self.assertRaisesRegex(RuntimeError, 'Missing or oversized'):
            self.exercise(report_missing=True)
        self.assertEqual(native.read()['native_probe'], 'FAIL')

    def test_failed_native_command_or_report_never_exports_raw_data_or_passes(self):
        for command_failure in [True, False]:
            with self.subTest(command_failure=command_failure):
                with self.assertRaises(RuntimeError):
                    self.exercise(maestro_failure=command_failure, report_failure=not command_failure)
                self.assertEqual(native.read()['native_probe'], 'FAIL')
                self.assertNotIn('PRIVATE_SENTINEL', native.EVIDENCE.read_text())


if __name__ == '__main__':
    unittest.main()
