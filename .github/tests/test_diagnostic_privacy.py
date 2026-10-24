"""Adversarial export contracts with synthetic data; no native tools or app state."""

from contextlib import redirect_stdout, redirect_stderr
import io
import json
from pathlib import Path
import runpy
import subprocess
import sys
import unittest
from unittest import mock

import test_hosted_native as harness

native = harness.native


# Reuse the isolated evidence fixture without running the inherited test suite.
class DiagnosticPrivacyTest(unittest.TestCase):
    setUp = harness.HostedNativeHarnessTest.setUp

    def test_arbitrary_private_text_cannot_be_exported_by_any_log_classifier(self):
        payloads = [
            'PRIVATE_SENTINEL ordinary wallet name and recovery words with no secret label',
            'PRIVATE_SENTINEL xpubSyntheticExtendedKey bc1qsyntheticaddress user@example.invalid',
            'PRIVATE_SENTINEL token = "two words" password: two words Bearer synthetic',
            'PRIVATE_SENTINEL file:///Users/private-user/Documents/wallet.txt /home/private-user/backup',
            'PRIVATE_SENTINEL https://example.invalid/private?phrase=one%20two',
            'PRIVATE_SENTINEL cHJpdmF0ZSB3b3Jkcw== \\u0070rivate <seed>synthetic</seed>',
            'PRIVATE_SENTINEL \u79d8\u5bc6 \u03bc\u03c5\u03c3\u03c4\u03b9\u03ba\u03cc \u202esecret \x00\x1b[31mprivate\x1b[0m',
            'PRIVATE_SENTINEL first line\nprivate continuation\rprivate last line',
            'PRIVATE_SENTINEL ' + 'long arbitrary private text ' * 100,
        ]
        routes = [
            (native.failure_details, 'error: {}', ['TOOL_ERROR']),
            (native.failure_details, 'e: {}', ['KOTLIN_COMPILER_ERROR']),
            (native.failure_details, 'FAILURE: {}', ['BUILD_FAILURE']),
            (native.failure_details, 'Caused by: {}', ['TOOL_ERROR']),
            (native.maestro_failure_details, 'Unable to launch app {}', ['Maestro app launch failed']),
            (native.maestro_failure_details, 'Failed to connect {}', ['Maestro connection failed']),
            (native.maestro_failure_details, 'Failed to start {}', ['Maestro driver start failed']),
            (native.maestro_failure_details, 'No devices found {}', ['Maestro device unavailable']),
            (native.android_startup_errors, 'E/AndroidRuntime( 123): FATAL EXCEPTION: {}', ['ANDROID_RUNTIME_ERROR']),
            (native.android_startup_errors, 'E/ReactNativeJS( 123): TypeError: {}', ['REACT_NATIVE_JS_ERROR']),
            (native.android_startup_errors, 'F/ReactNative( 123): Could not {}', ['REACT_NATIVE_ERROR']),
            (native.metro_startup_errors, 'ERROR {}', ['METRO_ERROR']),
            (native.metro_startup_errors, 'SyntaxError: {}', ['METRO_SYNTAX_ERROR']),
            (native.metro_startup_errors, 'TypeError: {}', ['METRO_TYPE_ERROR']),
            (native.metro_startup_errors, 'ReferenceError: {}', ['METRO_REFERENCE_ERROR']),
            (native.metro_startup_errors, 'Unable to resolve module {}', ['METRO_MODULE_RESOLUTION_ERROR']),
        ]
        for payload in payloads:
            for classify, template, expected in routes:
                with self.subTest(route=template, payload=payload[:70]):
                    self.assertEqual(classify(template.format(payload)), expected)
            with self.subTest(route='ios', payload=payload[:70]):
                diagnostics = native.ios_startup_diagnostics(
                    '2026-10-18 06:00:00.000 E hexa_keeper_dev[123:abc] ' + payload, 'hexa_keeper_dev')
                if '\x00' in payload or '\x1b' in payload:
                    # A malformed compact record is no longer attributed even
                    # when its prefix contains an error severity.
                    self.assertEqual(diagnostics['errors'], [])
                    self.assertEqual(diagnostics['parse_status'], 'UNKNOWN')
                    self.assertGreater(diagnostics['malformed_record_lines'], 0)
                else:
                    self.assertEqual(diagnostics['errors'], ['IOS_STARTUP_ERROR'])
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(diagnostics))

    def test_general_failure_categories_cover_install_blockers_without_excerpts(self):
        messages = [
            ('error: lockfile needs to be updated', 'DEPENDENCY_LOCK_MISMATCH'),
            ('[!] could not find compatible versions', 'DEPENDENCY_LOCK_MISMATCH'),
            ('The sandbox is not in sync', 'DEPENDENCY_LOCK_MISMATCH'),
            ('error: no space left on device', 'DISK_SPACE_EXHAUSTED'),
            ('error: command not found', 'REQUIRED_TOOL_UNAVAILABLE'),
            ('[!] requires a higher minimum deployment target', 'IOS_DEPLOYMENT_TARGET_UNSUPPORTED'),
            ('[!] other pod failure', 'COCOAPODS_ERROR'),
            ('A problem occurred', 'BUILD_FAILURE'),
            ('Execution failed', 'BUILD_FAILURE'),
            ('Could not find a dependency', 'DEPENDENCY_OR_TOOL_FAILURE'),
            ('> compiler detail', 'TOOL_ERROR'),
        ]
        for message, category in messages:
            with self.subTest(message=message):
                self.assertEqual(native.failure_details(message + ' PRIVATE_SENTINEL'), [category])
        self.assertEqual(native.failure_details('ordinary PRIVATE_SENTINEL\n> Task :compile\n'
                                               ' 12 | error: PRIVATE_SENTINEL'), [])
        self.assertEqual(native.failure_details('error: PRIVATE_SENTINEL\n' * 1000), ['TOOL_ERROR'])
        self.assertEqual(native.metro_startup_errors('ERROR PRIVATE_SENTINEL\n' * 1000), ['METRO_ERROR'])
        self.assertEqual(native.android_startup_errors('E/OtherApp( 1): Error: PRIVATE_SENTINEL'), [])

    def test_failed_command_metadata_console_and_exception_do_not_export_private_text(self):
        script = self.root / 'failed-command.py'
        script.write_text('print("error: PRIVATE_SENTINEL arbitrary recovery text"); raise SystemExit(3)')
        console = io.StringIO()
        with redirect_stdout(console), self.assertRaises(RuntimeError) as failure:
            native.command([sys.executable, str(script)], 'Build fixture')
        record = native.read()['commands'][0]
        self.assertEqual(record['exit_code'], 3)
        self.assertEqual(record['redacted_tool_errors'], ['TOOL_ERROR'])
        self.assertIn('TOOL_ERROR', console.getvalue())
        self.assertNotIn('PRIVATE_SENTINEL', native.EVIDENCE.read_text() + console.getvalue() + str(failure.exception))
        self.assertIn('PRIVATE_SENTINEL', (native.PRIVATE / 'command-001.log').read_text())

    def test_startup_collector_exports_only_categories_and_preserves_failure(self):
        native.PRIVATE.mkdir()
        native.save({'commands': [{'label': 'Assert startup and disposable passcode transition'}],
                     'build': 'PASS', 'smoke': 'FAIL'})
        (native.PRIVATE / 'command-001.log').write_text('Unable to launch app PRIVATE_SENTINEL wallet text\n')
        (native.PRIVATE / 'metro.log').write_text('ERROR PRIVATE_SENTINEL wallet text\n')
        report = native.PRIVATE / 'smoke-junit.xml'
        report.write_text('<testsuites><testcase status="ERROR"><failure>'
                          'Failed to connect PRIVATE_SENTINEL wallet text\nUI hierarchy: PRIVATE_SENTINEL'
                          '</failure></testcase></testsuites>')

        def android_log(args, stdout, **kwargs):
            stdout.write(b'E/AndroidRuntime( 123): FATAL EXCEPTION: PRIVATE_SENTINEL wallet text\n')
            return subprocess.CompletedProcess(args, 0)

        console = io.StringIO()
        with redirect_stdout(console), mock.patch.object(subprocess, 'run', side_effect=android_log):
            native.record_startup_failure(report, 'fixture-emulator')
        data = native.read()
        details = data['startup_diagnostics']
        self.assertEqual((data['build'], data['smoke']), ('PASS', 'FAIL'))
        self.assertEqual(details['maestro']['testcase_statuses'], ['ERROR'])
        self.assertEqual(details['maestro']['failed_commands'], ['Maestro app launch failed'])
        self.assertEqual(details['maestro']['testcase_failures'], ['Maestro connection failed'])
        self.assertEqual(details['metro_errors'], ['METRO_ERROR'])
        self.assertEqual(details['android_errors']['errors'], ['ANDROID_RUNTIME_ERROR'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(data) + console.getvalue())

    def test_cli_failure_never_prints_arbitrary_exception_text(self):
        console = io.StringIO()
        # The record phase fails before invoking a native tool. Exercise the real
        # CLI exception boundary, including its nonzero exit, with a private error.
        with mock.patch.dict(native.os.environ, {'KEEPER_NATIVE_PLATFORM': 'ANDROID'}), \
                mock.patch.object(sys, 'argv', [str(Path(native.__file__)), 'record']), \
                mock.patch.object(subprocess, 'check_output', side_effect=RuntimeError('PRIVATE_SENTINEL')), \
                redirect_stderr(console), self.assertRaises(SystemExit) as failure:
            runpy.run_path(native.__file__, run_name='__main__')
        self.assertEqual(failure.exception.code, 1)
        self.assertIn('Hosted native validation failed', console.getvalue())
        self.assertNotIn('PRIVATE_SENTINEL', console.getvalue())
