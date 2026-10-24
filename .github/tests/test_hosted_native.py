"""Pure hosted-harness checks: these do not claim native simulator evidence."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    'hosted_native', Path(__file__).resolve().parents[1] / 'native' / 'hosted_native.py')
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)


class HostedNativeHarnessTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.patches = mock.patch.multiple(native, ROOT=self.root, PRIVATE=self.root / 'private',
                                          EVIDENCE=self.root / 'evidence/metadata.json', PLATFORM='ANDROID')
        self.patches.start()
        self.addCleanup(self.patches.stop)
        native.save({'commands': [], 'build': 'NOT RUN', 'smoke': 'NOT RUN'})

    def test_metadata_records_the_current_run_attempt_without_native_credit(self):
        source = 'a' * 40
        for attempt in ['1', '2']:
            with self.subTest(attempt=attempt), \
                    mock.patch.dict(os.environ, {'KEEPER_SOURCE_SHA': source,
                                                'KEEPER_DIAGNOSTIC': 'true',
                                                'GITHUB_RUN_ID': '90', 'GITHUB_RUN_ATTEMPT': attempt}), \
                    mock.patch.object(native.subprocess, 'check_output', return_value=source), \
                    mock.patch.object(native, 'command', return_value='synthetic-tool-version'), \
                    mock.patch.object(native, 'disk_preflight'):
                native.record()
            metadata = native.read()
            self.assertEqual(metadata['source_sha'], source)
            self.assertEqual(metadata['run_id'], '90')
            self.assertEqual(metadata['run_attempt'], attempt)
            self.assertTrue(metadata['diagnostic_only'])
            for field in ['build', 'smoke', 'native_probe', 'r5_features', 'hardware', 'signing']:
                self.assertEqual(metadata[field], 'NOT RUN')

    def test_success_records_command_and_duration_without_output(self):
        script = self.root / 'output.py'
        script.write_text('print("private output")')
        result = native.command([sys.executable, str(script)], 'Success', capture=True)
        self.assertEqual(result, 'private output')
        record = native.read()['commands'][0]
        self.assertEqual(record['exit_code'], 0)
        self.assertGreaterEqual(record['duration_seconds'], 0)
        self.assertNotIn('private output', native.EVIDENCE.read_text())

    def test_failure_exposes_only_allowlisted_diagnostic(self):
        script = self.root / 'failure.py'
        script.write_text('print("private payload: lockfile needs to be updated"); raise SystemExit(3)')
        with self.assertRaisesRegex(RuntimeError, 'Manifest and yarn.lock are inconsistent'):
            native.command([sys.executable, str(script)], 'Install')
        record = native.read()['commands'][0]
        self.assertEqual(record['exit_code'], 3)
        self.assertNotIn('private payload', native.EVIDENCE.read_text())

    def test_hierarchy_command_failure_never_exports_arbitrary_error_lines(self):
        script = self.root / 'hierarchy_failure.py'
        script.write_text('print("error: PRIVATE_SENTINEL hierarchy data"); raise SystemExit(1)')
        with self.assertRaisesRegex(RuntimeError, 'exit 1'):
            native.command([sys.executable, str(script)], 'Driver hierarchy', error_details=False)
        self.assertEqual(native.read()['commands'][0]['redacted_tool_errors'], [])
        self.assertNotIn('PRIVATE_SENTINEL', native.EVIDENCE.read_text())

    def test_tool_errors_are_deduplicated_fixed_categories(self):
        output = 'private payload\nerror: missing module https://example.test/private token=secret\n' \
            + 'Caused by: password=private Bearer private\n' + 'error: detail\n' * 30
        details = native.failure_details(output)
        self.assertEqual(details, ['TOOL_ERROR'])
        kotlin = '> Task :compile\n' * 40 + 'e: file:///runner/App.kt:1 unresolved reference'
        self.assertEqual(native.failure_details(kotlin), ['KOTLIN_COMPILER_ERROR'])
        excerpts = ''.join(' %s | +(NSDictionary*)statWithError:(NSError**)error:\n' % line
                           for line in range(30))
        self.assertEqual(native.failure_details(excerpts + 'error: actual compiler failure'),
                         ['TOOL_ERROR'])

    def test_timeout_records_failure_and_terminates_process(self):
        with self.assertRaisesRegex(RuntimeError, 'exit 124'):
            native.command([sys.executable, '-c', 'import time; time.sleep(30)'], 'Timeout', timeout=0.05)
        self.assertEqual(native.read()['commands'][0]['exit_code'], 124)

    def test_startup_diagnostics_keep_only_fixed_failed_steps_and_categories(self):
        maestro = '\n'.join([
            'Assert that "Create a passcode" is visible... FAILED',
            'Tap on id: key_2... FAILED',
            'Tap on "private recovery phrase"... FAILED',
            'UI hierarchy: private state',
            'Assertion is false: "Create a passcode" is visible; UI hierarchy: PRIVATE_SENTINEL',
            'Element not found: key_1; private arbitrary suffix',
        ])
        messages = native.maestro_failure_details(maestro)
        self.assertTrue(any('Create a passcode' in message for message in messages))
        self.assertIn('Maestro tap key_2 FAILED', messages)
        self.assertNotIn('private', '\n'.join(messages))
        self.assertNotIn('PRIVATE_SENTINEL', '\n'.join(messages))
        self.assertNotIn('hierarchy', '\n'.join(messages))
        self.assertIn('Maestro assertion failed: Create a passcode', messages)
        self.assertIn('Maestro element not found: key_1', messages)
        metro = native.metro_startup_errors(' BUNDLE index.js\n ERROR Error: Unable to resolve module token=private https://example.test/private; View hierarchy: PRIVATE_SENTINEL')
        self.assertEqual(metro, ['METRO_MODULE_RESOLUTION_ERROR'])
        native_errors = native.android_startup_errors('\n'.join([
            'E/AndroidRuntime( 123): FATAL EXCEPTION: main; credentials: PRIVATE_SENTINEL',
            'E/ReactNativeJS( 123): TypeError: Cannot load module token=private',
            'E/OtherApp( 124): Error: private unrelated data',
            'E/ReactNativeJS( 123):     at unneeded stack frame',
        ]))
        self.assertEqual(native_errors, ['ANDROID_RUNTIME_ERROR', 'REACT_NATIVE_JS_ERROR'])

    def test_junit_failure_collection_omits_hierarchy_and_preserves_failed_result(self):
        native.PRIVATE.mkdir()
        native.save({'commands': [], 'build': 'PASS', 'smoke': 'FAIL'})
        (native.PRIVATE / 'metro.log').write_text('No bundler error\n')
        report = native.PRIVATE / 'smoke-junit.xml'
        report.write_text('<testsuites><testsuite><testcase status="ERROR"><failure>'
                          'Assertion is false: Create a passcode is visible\nUI hierarchy: private data'
                          '</failure></testcase></testsuite></testsuites>')
        hierarchy = native.PRIVATE / 'maestro-output/2026-10-17_092233/Disposable startup and passcode input/screen-hierarchy'
        hierarchy.mkdir(parents=True)
        (hierarchy / 'step-002-assertCondition-Create_a_passcode.json').write_text(json.dumps({
            'attributes': {'accessibilityText': 'PRIVATE_SENTINEL', 'resource-id': 'redbox-error'},
            'children': [{'attributes': {'accessibilityText': 'No script URL provided. PRIVATE_SENTINEL'}}]}))
        native.record_startup_failure(report, None)
        data = native.read()
        self.assertEqual(data['smoke'], 'FAIL')
        self.assertEqual(data['startup_diagnostics']['maestro']['testcase_statuses'], ['ERROR'])
        self.assertNotIn('private data', native.EVIDENCE.read_text())
        self.assertNotIn('PRIVATE_SENTINEL', native.EVIDENCE.read_text())
        self.assertTrue(data['startup_diagnostics']['hierarchy_signals']['RNredbox'])
        self.assertTrue(data['startup_diagnostics']['hierarchy_signals']['noScriptURL'])
        self.assertTrue(data['startup_diagnostics']['maestro']['testcase_failures'])

    def test_private_hierarchy_exports_only_fixed_signals_from_standalone_tree_nodes(self):
        hierarchy = self.root / 'maestro-output/2026-10-17_092233/Disposable startup and passcode input/screen-hierarchy'
        hierarchy.mkdir(parents=True)
        (hierarchy / 'step-002-assertCondition-Create_a_passcode.json').write_text(json.dumps({
            'attributes': {'accessibilityText': 'Create a passcode', 'value': 'PRIVATE_SENTINEL'},
            'children': [
                {'attributes': {'accessibilityText': 'Confirm your passcode'}},
                {'attributes': {'resource-id': 'io.hexawallet.keeper.development:id/rn_redbox_stack',
                                'text': 'Could not connect to development server. PRIVATE_SENTINEL'}},
                {'attributes': {'title': 'Unable to load script. PRIVATE_SENTINEL'}},
                {'attributes': {'text': 'SpringBoard PRIVATE_SENTINEL'}, 'children': None},
            ]}))
        # Other JSON files are not hierarchy snapshots and must not be parsed.
        (hierarchy.parent / 'commands.json').write_text('{ malformed PRIVATE_SENTINEL')
        signals = native.startup_hierarchy_signals(self.root / 'maestro-output')
        self.assertEqual(signals, {'createPIN': True, 'confirmPIN': True, 'RNredbox': True,
                                  'noScriptURL': False, 'developmentServerError': True,
                                  'unableLoadScript': True, 'snapshot_count': 1, 'parse_error_types': []})
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(signals))
        self.assertNotIn('SpringBoard', json.dumps(signals))

    def test_private_hierarchy_bounds_bytes_and_nodes_and_records_only_parse_error_classes(self):
        hierarchy = self.root / 'maestro-output/screen-hierarchy'
        hierarchy.mkdir(parents=True)
        (hierarchy / 'step-001-malformed.json').write_text('{ PRIVATE_SENTINEL')
        (hierarchy / 'step-002-oversize.json').write_bytes(b'PRIVATE_SENTINEL' * (1024 * 1024 // 8))
        (hierarchy / 'step-003-too-many-nodes.json').write_text(json.dumps({
            'attributes': {'accessibilityText': 'Create a passcode'}, 'children': [{}] * 10000}))
        signals = native.startup_hierarchy_signals(self.root / 'maestro-output')
        self.assertEqual(signals['snapshot_count'], 3)
        self.assertEqual(set(signals['parse_error_types']), {'JSONDecodeError', 'ValueError'})
        self.assertFalse(signals['createPIN'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(signals))

    def test_maestro_preflight_retains_fixed_driver_markers_and_known_types_without_raw_messages(self):
        output = native.PRIVATE / 'maestro-output'
        output.mkdir(parents=True)
        native.save({'commands': [{'label': 'Assert startup and disposable passcode transition'}],
                     'smoke': 'FAIL'})
        (native.PRIVATE / 'command-001.log').write_text(
            'xcuitest.installer.LocalXCTestInstaller$IOSDriverTimeoutException: '
            'iOS driver not ready in time, consider increasing timeout by configuring '
            'MAESTRO_DRIVER_STARTUP_TIMEOUT env variable PRIVATE_SENTINEL\n'
            'PRIVATE_SENTINELException: arbitrary exception names must not escape\n')
        (output / 'maestro.log').write_text(
            '[Start] Install XCUITest runner on PRIVATE_SENTINEL\n'
            '[Done] Install XCUITest runner on PRIVATE_SENTINEL\n'
            '[Start] Perform XCUITest driver status check on PRIVATE_SENTINEL\n'
            '[Done] Perform XCUITest driver status check on PRIVATE_SENTINEL\n'
            '[Failed] Perform XCUITest driver status check on PRIVATE_SENTINEL\n'
            'Installing pre built driver without xcodebuild PRIVATE_SENTINEL\n'
            'Requested driver host port PRIVATE_SENTINEL is not available\n')
        (output / 'xctest_runner_fixture.log').write_text(
            'java.io.FileNotFoundException: xctestrun config does not exist PRIVATE_SENTINEL\n'
            'ui test runner does not exist PRIVATE_SENTINEL\n'
            '** TEST EXECUTE FAILED ** PRIVATE_SENTINEL\nTesting failed: PRIVATE_SENTINEL\n')
        result = native.maestro_preflight_diagnostics()
        self.assertTrue(result['driver_startup_timeout'])
        self.assertTrue(result['runner_install_started'])
        self.assertTrue(result['runner_install_launch_returned'])
        self.assertTrue(result['status_response_received'])
        self.assertTrue(result['status_check_failed'])
        self.assertTrue(result['host_port_unavailable'])
        self.assertTrue(result['xctestrun_config_missing'])
        self.assertTrue(result['ui_test_runner_missing'])
        self.assertTrue(result['xcode_test_execute_failed'])
        self.assertTrue(result['xcode_testing_failed'])
        self.assertEqual(set(result['exception_types']), {'IOSDriverTimeoutException', 'FileNotFoundException'})
        self.assertEqual(result['logs_read'], 3)
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        self.assertNotIn(str(output), json.dumps(result))
        self.assertNotIn('driver_ready', result)
        self.assertEqual(native.read()['smoke'], 'FAIL')

    def test_ios_driver_preflight_is_setup_only_and_cleans_only_its_created_simulator(self):
        native.save({'commands': [], 'maestro': {'binary': '/private/maestro'},
                     'build': 'NOT RUN', 'smoke': 'NOT RUN'})
        owned = '12345678-1234-1234-1234-123456789abc'
        with mock.patch.object(native, 'PLATFORM', 'IOS'), mock.patch.dict(native.os.environ), \
                mock.patch.object(native, 'wait_for_simulator_app_services') as ready, \
                mock.patch.object(native, 'command', side_effect=[owned, None, None, None]) as command, \
                mock.patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as cleanup:
            native.driver()
            self.assertEqual(native.os.environ['XDG_STATE_HOME'], str(native.PRIVATE / 'maestro-preflight-state'))
        self.assertEqual(command.call_args.args[0],
                         ['/private/maestro', '--platform', 'ios', '--device', owned, 'hierarchy'])
        self.assertFalse(command.call_args.kwargs['error_details'])
        ready.assert_called_once_with(owned)
        self.assertEqual([call.args[0] for call in cleanup.call_args_list],
                         [['xcrun', 'simctl', 'shutdown', owned], ['xcrun', 'simctl', 'delete', owned]])
        self.assertEqual(native.read()['driver_preflight']['result'], 'PASS')
        self.assertEqual(native.read()['build'], 'NOT RUN')
        self.assertEqual(native.read()['smoke'], 'NOT RUN')

    def test_ios_driver_failure_preserves_original_error_and_attempts_delete_after_cleanup_timeout(self):
        native.save({'commands': [], 'maestro': {'binary': '/private/maestro'},
                     'build': 'NOT RUN', 'smoke': 'NOT RUN'})
        owned = '12345678-1234-1234-1234-123456789abc'
        with mock.patch.object(native, 'PLATFORM', 'IOS'), mock.patch.dict(native.os.environ), \
                mock.patch.object(native, 'wait_for_simulator_app_services'), \
                mock.patch.object(native, 'command', side_effect=[owned, None, None, RuntimeError('driver failed PRIVATE_SENTINEL')]), \
                mock.patch.object(subprocess, 'run', side_effect=[subprocess.TimeoutExpired('shutdown', 30),
                                                                subprocess.CompletedProcess([], 0)]) as cleanup, \
                self.assertRaisesRegex(RuntimeError, 'driver failed PRIVATE_SENTINEL'):
            native.run_phase('driver')
        self.assertEqual(cleanup.call_count, 2)
        self.assertEqual(cleanup.call_args.args[0], ['xcrun', 'simctl', 'delete', owned])
        data = native.read()
        self.assertEqual(data['driver_preflight']['result'], 'FAIL')
        self.assertEqual(data['driver_preflight']['cleanup_errors'], [{'action': 'shutdown', 'error_type': 'TimeoutExpired'}])
        self.assertEqual(data['failed_phase'], 'driver')
        self.assertEqual(data['build'], 'NOT RUN')
        self.assertEqual(data['smoke'], 'NOT RUN')
        self.assertNotIn('PRIVATE_SENTINEL', native.EVIDENCE.read_text())

    def test_unresponsive_simulator_blocks_maestro_and_cleans_owned_device(self):
        native.save({'commands': [], 'maestro': {'binary': '/private/maestro'},
                     'build': 'NOT RUN', 'smoke': 'NOT RUN'})
        owned = '12345678-1234-1234-1234-123456789abc'
        original_error = RuntimeError('PRIVATE_SENTINEL app services unavailable')
        with mock.patch.object(native, 'PLATFORM', 'IOS'), mock.patch.dict(native.os.environ), \
                mock.patch.object(native, 'wait_for_simulator_app_services', side_effect=original_error), \
                mock.patch.object(native, 'command', side_effect=[owned, None, None]) as command, \
                mock.patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as cleanup, \
                self.assertRaises(RuntimeError) as failure:
            native.run_phase('driver')
        self.assertIs(failure.exception, original_error)
        self.assertEqual(command.call_count, 3)
        self.assertEqual(command.call_args.args[0], ['xcrun', 'simctl', 'bootstatus', owned, '-b'])
        self.assertEqual([call.args[0] for call in cleanup.call_args_list],
                         [['xcrun', 'simctl', 'shutdown', owned], ['xcrun', 'simctl', 'delete', owned]])
        self.assertEqual(native.read()['driver_preflight']['result'], 'FAIL')
        self.assertNotIn('PRIVATE_SENTINEL', native.EVIDENCE.read_text())

    def test_driver_preflight_diagnostics_cannot_contaminate_smoke_flags(self):
        native.PRIVATE.mkdir()
        driver_label = 'Check disposable iOS driver readiness'
        native.save({'commands': [{'label': driver_label},
                                  {'label': 'Assert startup and disposable passcode transition'}]})
        (native.PRIVATE / 'command-001.log').write_text('IOSDriverTimeoutException PRIVATE_SENTINEL\n')
        (native.PRIVATE / 'command-002.log').write_text('ordinary smoke output PRIVATE_SENTINEL\n')
        state = native.PRIVATE / 'maestro-preflight-state/maestro/tests/timestamp'
        state.mkdir(parents=True)
        (state / 'maestro.log').write_text('** TEST EXECUTE FAILED ** PRIVATE_SENTINEL\n')
        driver = native.maestro_preflight_diagnostics(state.parent, driver_label)
        smoke = native.maestro_preflight_diagnostics()
        self.assertTrue(driver['xcode_test_execute_failed'])
        self.assertEqual(driver['exception_types'], ['IOSDriverTimeoutException'])
        self.assertFalse(smoke['xcode_test_execute_failed'])
        self.assertEqual(smoke['exception_types'], [])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(driver))

    def test_maestro_preflight_bounds_files_bytes_and_collection_errors_without_changing_failure(self):
        output = native.PRIVATE / 'maestro-output'
        output.mkdir(parents=True)
        native.save({'commands': [], 'smoke': 'FAIL'})
        (output / 'maestro.log').write_bytes(
            b'PRIVATE_SENTINEL' * (1024 * 1024 // 8) + b'\nInstalling driver with xcodebuild\n')
        for index in range(7):
            (output / ('xctest_runner_%s.log' % index)).write_text('PRIVATE_SENTINEL\n')
        result = native.maestro_preflight_diagnostics()
        self.assertEqual(result['logs_read'], 6)
        self.assertTrue(result['log_limit_reached'])
        self.assertEqual(result['truncated_logs'], 1)
        self.assertFalse(result['xcodebuild_driver_selected'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        with mock.patch.object(native, 'private_log_prefix', side_effect=OSError('PRIVATE_SENTINEL')):
            result = native.maestro_preflight_diagnostics()
        self.assertEqual(result['collection_error_types'], ['OSError'])
        self.assertEqual(native.read()['smoke'], 'FAIL')

    def test_ios_startup_errors_restrict_process_and_export_only_a_fixed_category(self):
        payload = '\n'.join([
            'Filtering the log data using the process predicate',
            'Timestamp               Ty Process[PID:TID]',
            '2026-10-17 09:22:33.123 E  hexa_keeper_dev[123:abc] [com.facebook.react:javascript] NSException: module failed token=private; UI hierarchy: PRIVATE_SENTINEL',
            'private stack continuation',
            '2026-10-17 09:22:34.123 E  OtherApp[124:def] Error: hexa_keeper_dev private unrelated application',
            '2026-10-17 09:22:35.123 Df hexa_keeper_dev[123:abc] normal startup message',
            '2026-10-17 09:22:36.123 Df hexa_keeper_dev[123:abc] ReferenceError: missing startup module',
            'PRIVATE_SENTINEL multiline continuation',
            '2026-10-17 09:22:37.123+0000 Df hexa_keeper_dev[123:abc] NSException: failed native startup',
            'PRIVATE_SENTINEL multiline continuation',
            'Error: hexa_keeper_dev[123:abc] missing timestamp must not be accepted',
        ])
        diagnostics = native.ios_startup_diagnostics(payload, 'hexa_keeper_dev')
        errors = diagnostics['errors']
        self.assertEqual(diagnostics['matching_process_records'], 4)
        self.assertEqual(errors, ['IOS_STARTUP_ERROR'])
        self.assertEqual(native.ios_startup_diagnostics('no compact records', 'hexa_keeper_dev')['matching_process_records'], 0)

    def test_ios_collector_keeps_launch_prefix_when_log_is_truncated_and_preserves_failure(self):
        native.PRIVATE.mkdir()
        native.save({'commands': [], 'smoke': 'FAIL', 'built_artifact': {'executable': 'hexa_keeper_dev'}})
        (native.PRIVATE / 'metro.log').write_text('\x1b[32m BUNDLE \x1b[0m private-path/index.js\n'
                                                   ' BUNDLE private-path/index.js\n PREBUNDLE private-path/index.js\n')

        def compact_log(args, stdout, **kwargs):
            self.assertEqual(args[args.index('--style') + 1], 'compact')
            self.assertEqual(args[args.index('--last') + 1], '10m')
            stdout.write(b'2026-10-17 09:22:33.123 Df hexa_keeper_dev[123:abc] ReferenceError: launch module failed token=private\n')
            stdout.write(b'2026-10-17 09:22:34.123 E OtherApp[124:def] Error: private unrelated data\n')
            # The first MiB ends within a continuation, not a complete record.
            stdout.write(b'PRIVATE_SENTINEL' * (1024 * 1024 // 8))
            stdout.write(b'\n2026-10-17 09:30:33.123 E hexa_keeper_dev[123:abc] Error: tail must not replace launch evidence\n')
            return subprocess.CompletedProcess(args, 0)

        with mock.patch.object(native, 'PLATFORM', 'IOS'), \
                mock.patch.object(subprocess, 'run', side_effect=compact_log):
            native.record_startup_failure(native.PRIVATE / 'missing-report.xml', 'owned-simulator')
        data = native.read()
        self.assertEqual(data['smoke'], 'FAIL')
        diagnostics = data['startup_diagnostics']['ios_errors']
        self.assertTrue(diagnostics['input_truncated'])
        self.assertEqual(diagnostics['matching_process_records'], 1)
        self.assertEqual(diagnostics['errors'], ['IOS_STARTUP_ERROR'])
        self.assertEqual(data['startup_diagnostics']['metro_progress'],
                         {'bundle_marker_observed': True, 'bundle_marker_count': 2, 'prebundle_marker_count': 1})
        self.assertNotIn('private unrelated', native.EVIDENCE.read_text())
        self.assertNotIn('PRIVATE_SENTINEL', native.EVIDENCE.read_text())
        self.assertNotIn('private-path', native.EVIDENCE.read_text())

    def test_warmup_keeps_each_platform_body_private_and_does_not_supply_smoke_evidence(self):
        native.PRIVATE.mkdir()
        body = b'disposable development bundle PRIVATE_SENTINEL'

        def warmup(args, *unused, **kwargs):
            self.assertEqual(args[-1], 'http://127.0.0.1:8081/index.bundle?platform=%s&dev=true&minify=false'
                             % platform.lower())
            Path(args[args.index('--output') + 1]).write_bytes(body)
            return '200'

        for platform in ['IOS', 'ANDROID']:
            with self.subTest(platform=platform), mock.patch.object(native, 'PLATFORM', platform), \
                    mock.patch.object(native, 'command', side_effect=warmup):
                native.warm_metro_bundle()
            data = native.read()
            self.assertEqual(data['smoke'], 'NOT RUN')
            self.assertEqual(data['metro_warmup']['platform'], platform.lower())
            self.assertEqual(data['metro_warmup']['result'], 'PASS')
            self.assertEqual(data['metro_warmup']['http_status'], 200)
            self.assertEqual(data['metro_warmup']['bytes'], len(body))
            self.assertEqual(data['metro_warmup']['sha256'], hashlib.sha256(body).hexdigest())
            self.assertNotIn('PRIVATE_SENTINEL', native.EVIDENCE.read_text())
        with mock.patch.object(native, 'command', side_effect=RuntimeError('HTTP error')), \
                self.assertRaisesRegex(RuntimeError, 'HTTP error'):
            native.warm_metro_bundle()
        self.assertEqual(native.read()['metro_warmup']['result'], 'FAIL')
        self.assertEqual(native.read()['smoke'], 'NOT RUN')
        with mock.patch.object(native, 'PLATFORM', 'unsupported&private=value'), \
                mock.patch.object(native, 'command') as command, \
                self.assertRaisesRegex(ValueError, 'Unsupported native bundle platform'):
            native.warm_metro_bundle()
        command.assert_not_called()

    def test_ios_collector_rejects_unsafe_executable_without_running_command(self):
        native.PRIVATE.mkdir()
        native.save({'commands': [], 'smoke': 'FAIL', 'built_artifact': {'executable': '../unsafe"'}})
        (native.PRIVATE / 'metro.log').write_text('')
        with mock.patch.object(native, 'PLATFORM', 'IOS'), mock.patch.object(subprocess, 'run') as run:
            native.record_startup_failure(native.PRIVATE / 'missing-report.xml', 'owned-simulator')
        run.assert_not_called()
        self.assertEqual(native.read()['smoke'], 'FAIL')
        self.assertIn({'stage': 'ios_errors', 'error_type': 'ValueError'},
                      native.read()['startup_diagnostics']['collection_errors'])

    def test_diagnostic_failure_never_replaces_original_smoke_failure(self):
        native.PRIVATE.mkdir()
        identity = {'sha256': 'test artifact'}
        native.save({'commands': [], 'build': 'PASS', 'smoke': 'NOT RUN', 'built_artifact': identity})
        metro = mock.Mock()
        metro.poll.return_value = 1
        with mock.patch.object(native, 'artifact_identity', return_value=identity), \
                mock.patch.object(subprocess, 'Popen', return_value=metro), \
                mock.patch.object(native, 'record_startup_failure', side_effect=RuntimeError('collector failed')), \
                self.assertRaisesRegex(RuntimeError, 'Metro exited before the disposable smoke'):
            native.run_phase('smoke')
        self.assertEqual(native.read()['smoke'], 'FAIL')
        self.assertEqual(native.read()['startup_diagnostics']['collection_errors'],
                         [{'stage': 'collector', 'error_type': 'RuntimeError'}])

    def test_missing_executable_is_recorded(self):
        with self.assertRaisesRegex(RuntimeError, 'exit 127'):
            native.command([str(self.root / 'missing-command')], 'Missing')
        self.assertEqual(native.read()['commands'][0]['exit_code'], 127)

    def test_record_rejects_wrong_source_sha_before_collecting_evidence(self):
        before = native.EVIDENCE.read_bytes()
        with mock.patch.dict(native.os.environ, {'KEEPER_SOURCE_SHA': 'b' * 40}), \
                mock.patch.object(subprocess, 'check_output', return_value='a' * 40 + '\n'), \
                self.assertRaisesRegex(RuntimeError, 'exact requested PR head'):
            native.record()
        self.assertEqual(native.EVIDENCE.read_bytes(), before)

    def test_android_fixtures_use_only_dummy_project_and_loopback_services(self):
        (self.root / 'android/app').mkdir(parents=True)
        native.fixtures()
        environment = (self.root / '.env.ci').read_text()
        self.assertIn('ENVIRONMENT=DEVELOPMENT', environment)
        for line in environment.splitlines():
            if 'https://' in line:
                self.assertIn('127.0.0.1:9', line)
        firebase = json.loads((self.root / 'android/app/google-services.json').read_text())
        self.assertEqual(firebase['project_info']['project_id'], 'keeper-disposable-ci')
        settings = json.loads((self.root / 'firebase.json').read_text())['react-native']
        self.assertFalse(settings['messaging_auto_init_enabled'])
        self.assertFalse(settings['app_data_collection_default_enabled'])
        for overlay in native.read()['configuration_overlays']:
            self.assertEqual(overlay['sha256'], hashlib.sha256((self.root / overlay['path']).read_bytes()).hexdigest())
        self.assertEqual(len(native.read()['configuration_overlays']), 3)

    def test_ios_fixtures_cover_both_tracked_firebase_files(self):
        (self.root / 'ios/GoogleServices/dev').mkdir(parents=True)
        with mock.patch.object(native, 'PLATFORM', 'IOS'):
            native.fixtures()
        paths = {overlay['path'] for overlay in native.read()['configuration_overlays']}
        self.assertEqual(paths, {'.env.ci', 'firebase.json', 'ios/GoogleService-Info.plist',
                                 'ios/GoogleServices/dev/GoogleService-Info.plist'})

    def test_emulator_revision_comes_from_sdk_metadata_without_executing_binary(self):
        emulator = self.root / 'emulator'
        emulator.mkdir()
        (emulator / 'source.properties').write_text('Pkg.Revision = 36.6.11\nUnrelated = ignored\n')
        with mock.patch.object(subprocess, 'Popen') as popen:
            self.assertEqual(native.android_sdk_metadata(self.root, 'emulator'), {'Pkg.Revision': '36.6.11'})
        popen.assert_not_called()

    def test_emulator_metadata_must_exist_and_contain_revision(self):
        with self.assertRaises(FileNotFoundError):
            native.android_sdk_metadata(self.root, 'emulator')
        emulator = self.root / 'emulator'
        emulator.mkdir()
        for text in ['Pkg.Desc = Android Emulator\n', 'Pkg.Revision =  \n']:
            with self.subTest(properties=text):
                (emulator / 'source.properties').write_text(text)
                with self.assertRaisesRegex(RuntimeError, 'no Pkg.Revision metadata'):
                    native.android_sdk_metadata(self.root, 'emulator')

    def test_smoke_requires_successful_build(self):
        with mock.patch.object(subprocess, 'Popen') as popen, \
                self.assertRaisesRegex(RuntimeError, 'successful native build'):
            native.smoke()
        popen.assert_not_called()

    def test_ios_build_rejects_unsupported_architecture_before_invoking_xcode(self):
        with mock.patch.object(native, 'PLATFORM', 'IOS'), \
                mock.patch.object(native, 'disk_preflight'), \
                mock.patch.object(native.platform, 'machine', return_value='riscv64'), \
                mock.patch.object(native, 'command') as command, \
                self.assertRaisesRegex(RuntimeError, 'Unsupported hosted iOS simulator architecture'):
            native.build()
        command.assert_not_called()

    def test_ios_build_uses_only_the_supported_host_simulator_architecture(self):
        for architecture in ['arm64', 'x86_64']:
            with self.subTest(architecture=architecture), \
                    mock.patch.object(native, 'disk_preflight'), \
                    mock.patch.object(native, 'PLATFORM', 'IOS'), \
                    mock.patch.object(native.platform, 'machine', return_value=architecture), \
                    mock.patch.object(native, 'artifact_identity', return_value={'sha256': 'test artifact'}), \
                    mock.patch.object(native, 'command') as command:
                native.build()
                arguments = command.call_args.args[0]
                self.assertIn('ARCHS=' + architecture, arguments)
                self.assertIn('ONLY_ACTIVE_ARCH=YES', arguments)
                self.assertIn('CODE_SIGNING_ALLOWED=NO', arguments)
                self.assertEqual(command.call_args.kwargs['timeout'], 2400)
                self.assertEqual(native.read()['toolchain']['ios_simulator_architecture'], architecture)

    def test_artifact_hash_detects_changed_apk_before_smoke(self):
        apk = self.root / 'android/app/build/outputs/apk/development/debug/app-development-debug.apk'
        apk.parent.mkdir(parents=True)
        apk.write_bytes(b'first disposable artifact')
        identity = native.artifact_identity()
        self.assertEqual(identity['sha256'], hashlib.sha256(apk.read_bytes()).hexdigest())
        native.save({'commands': [], 'build': 'PASS', 'smoke': 'NOT RUN', 'built_artifact': identity})
        apk.write_bytes(b'replacement artifact')
        with mock.patch.object(subprocess, 'Popen') as popen, \
                self.assertRaisesRegex(RuntimeError, 'artifact changed'):
            native.smoke()
        popen.assert_not_called()

    def test_failed_build_and_smoke_are_never_recorded_as_pass(self):
        for phase in ['build', 'smoke']:
            with self.subTest(phase=phase), \
                    mock.patch.object(native, phase, side_effect=RuntimeError('failure')), \
                    self.assertRaisesRegex(RuntimeError, 'failure'):
                native.run_phase(phase)
            self.assertEqual(native.read()[phase], 'FAIL')
            self.assertEqual(native.read()['failed_phase'], phase)


if __name__ == '__main__':
    unittest.main()
