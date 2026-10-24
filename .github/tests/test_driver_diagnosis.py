"""Offline driver-diagnostic controls; these supply no native acceptance."""

import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import plistlib
import sys
import tempfile
import threading
import unittest
from unittest import mock
import zipfile


DIRECTORY = Path(__file__).resolve().parents[1] / 'native'
SPEC_NATIVE = importlib.util.spec_from_file_location('driver_native_harness', DIRECTORY / 'hosted_native.py')
native = importlib.util.module_from_spec(SPEC_NATIVE)
SPEC_NATIVE.loader.exec_module(native)
SPEC = importlib.util.spec_from_file_location('driver_diagnosis_controls', DIRECTORY / 'driver_diagnosis.py')
diagnosis = importlib.util.module_from_spec(SPEC)
with mock.patch.dict(sys.modules, {'hosted_native': native}):
    SPEC.loader.exec_module(diagnosis)


class DriverDiagnosisTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.private = self.root / 'private'
        self.private.mkdir()
        patch = mock.patch.multiple(native, PRIVATE=self.private, ROOT=self.root,
                                    EVIDENCE=self.root / 'metadata.json', PLATFORM='IOS')
        patch.start()
        self.addCleanup(patch.stop)
        native.save({'commands': [], 'toolchain': {'sdk': '18.5'},
                     'build': 'NOT RUN', 'smoke': 'NOT RUN'})
        self.device = '12345678-1234-1234-1234-123456789ABC'

    def runner_jar(self, name='maestro-ios-driver.jar', sdk='iphonesimulator26.4', minimum='15.0'):
        inner = io.BytesIO()
        with zipfile.ZipFile(inner, 'w') as runner:
            for path in [diagnosis.RUNNER_NAME + '.app/Info.plist',
                         diagnosis.RUNNER_NAME + '.app/PlugIns/maestro-driver-iosUITests.xctest/Info.plist']:
                runner.writestr(path, plistlib.dumps({'DTSDKName': sdk, 'DTXcode': '2640',
                                                     'MinimumOSVersion': minimum,
                                                     'PRIVATE_SENTINEL': 'private runner metadata'}))
        path = self.private / 'maestro' / name
        path.parent.mkdir(exist_ok=True)
        with zipfile.ZipFile(path, 'w') as jar:
            jar.writestr('driver-iPhoneSimulator/Debug-iphonesimulator/maestro-driver-iosUITests-Runner.zip',
                         inner.getvalue())
        return path

    def test_fixed_categories_and_error_names_never_return_private_text(self):
        samples = [
            ('Library not loaded: PRIVATE_SENTINEL', 'DYLD_LIBRARY_MISSING'),
            ('Symbol not found: PRIVATE_SENTINEL', 'DYLD_SYMBOL_MISSING'),
            ('incompatible architecture PRIVATE_SENTINEL', 'DYLD_INCOMPATIBLE_LIBRARY'),
            ('Failed to load the test bundle PRIVATE_SENTINEL', 'TEST_BUNDLE_LOAD_FAILED'),
            ('failed to launch PRIVATE_SENTINEL', 'TEST_RUNNER_LAUNCH_FAILED'),
            ('applicationverificationfailed PRIVATE_SENTINEL', 'TEST_RUNNER_INSTALL_FAILED'),
            ('lost connection to the test manager PRIVATE_SENTINEL', 'TEST_MANAGER_CONNECTION_FAILED'),
            ('built for a newer PRIVATE_SENTINEL', 'RUNTIME_OR_DEPLOYMENT_MISMATCH'),
            ('unable to find runtime PRIVATE_SENTINEL', 'XCODE_COMPONENT_MISSING'),
            ('ineligible destinations PRIVATE_SENTINEL', 'DESTINATION_UNAVAILABLE'),
            ('invalid code signature PRIVATE_SENTINEL', 'CODE_SIGNING_FAILED'),
            ('permission denied PRIVATE_SENTINEL', 'PERMISSION_DENIED'),
            ('no space left on device PRIVATE_SENTINEL', 'DISK_SPACE_EXHAUSTED'),
            ('"termination": {"private": "PRIVATE_SENTINEL"}', 'PROCESS_CRASHED'),
            ('** TEST EXECUTE FAILED ** PRIVATE_SENTINEL', 'XCODE_TEST_EXECUTE_FAILED'),
            ('** TEST FAILED ** PRIVATE_SENTINEL', 'XCODE_TEST_FAILED'),
            ('Test Suite PRIVATE_SENTINEL started', 'XCODE_TEST_STARTED'),
            ('** TEST EXECUTE SUCCEEDED ** PRIVATE_SENTINEL', 'XCODE_TEST_SUCCEEDED'),
            ('server started PRIVATE_SENTINEL', 'DRIVER_SERVER_STARTED'),
            ('PRIVATE_SENTINEL\nCommand line invocation:\nprivate continuation', 'XCODE_COMMAND_INVOCATION'),
            ('PRIVATE_SENTINEL\nUser defaults from command line:\nprivate continuation', 'XCODE_USER_DEFAULTS'),
            ('Domain=com.apple.CoreSimulator.SimError Code=405 PRIVATE_SENTINEL', 'ERROR_DOMAIN_CORE_SIMULATOR'),
            ('Domain=IDETestOperationsObserverErrorDomain Code=4 PRIVATE_SENTINEL', 'ERROR_DOMAIN_IDE_TEST'),
        ]
        for payload, expected in samples:
            with self.subTest(expected=expected):
                result = diagnosis.classify(payload)
                self.assertIn(expected, result)
                self.assertTrue(set(result) <= set(diagnosis.CATEGORIES))
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        for payload in ['PRIVATE_SENTINEL', 'xpubPRIVATE_SENTINEL user@example.invalid',
                        'https://example.invalid/private?token=PRIVATE_SENTINEL']:
            self.assertEqual(diagnosis.classify(payload), [])
        private_exception = type('PRIVATE_SENTINEL', (Exception,), {})('private contents')
        self.assertEqual(diagnosis.safe_error(private_exception), 'OTHER_ERROR')
        self.assertEqual(diagnosis.safe_error(ValueError('PRIVATE_SENTINEL')), 'ValueError')

    def test_bounded_logs_export_only_prefix_facts_and_reject_escape(self):
        log = self.private / 'private.log'
        payload = b'Library not loaded: PRIVATE_SENTINEL\n' + b'x' * diagnosis.LIMIT
        log.write_bytes(payload)
        raw, facts = diagnosis.bounded(log)
        self.assertEqual(len(raw), diagnosis.LIMIT)
        self.assertTrue(facts['truncated'])
        self.assertEqual(facts['bytes'], len(payload))
        self.assertEqual(facts['prefix_sha256'], hashlib.sha256(payload[:diagnosis.LIMIT]).hexdigest())
        self.assertEqual(facts['categories'], ['DYLD_LIBRARY_MISSING'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))
        outside = self.root / 'outside.log'
        outside.write_text('PRIVATE_SENTINEL')
        link = self.private / 'escape.log'
        link.symlink_to(outside)
        for path in [outside, link]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                diagnosis.bounded(path)

    def test_bundled_plist_parser_reports_numeric_compatibility_without_extra_fields(self):
        self.runner_jar()
        facts = diagnosis.bundled_runner()
        self.assertEqual(facts['selected_sdk_version'], '18.5')
        self.assertEqual(len(facts['bundles']), 2)
        for item in facts['bundles']:
            self.assertEqual(item['sdk_version'], '26.4')
            self.assertEqual(item['xcode_numeric'], '2640')
            self.assertTrue(item['built_with_newer_sdk_than_selected'])
            self.assertFalse(item['minimum_os_exceeds_selected_sdk'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))

    def test_bundled_parser_rejects_missing_duplicate_invalid_or_malformed_inputs(self):
        with self.assertRaises(ValueError):
            diagnosis.bundled_runner()
        jar = self.runner_jar(sdk='PRIVATE_SENTINEL', minimum='PRIVATE_SENTINEL')
        facts = diagnosis.bundled_runner()
        for item in facts['bundles']:
            self.assertIsNone(item['sdk_version'])
            self.assertIsNone(item['minimum_os_version'])
            self.assertIsNone(item['built_with_newer_sdk_than_selected'])
        extra = jar.parent / 'extra'
        extra.mkdir()
        duplicate = extra / jar.name
        duplicate.write_bytes(jar.read_bytes())
        with self.assertRaises(ValueError):
            diagnosis.bundled_runner()
        duplicate.unlink()
        jar.write_bytes(b'PRIVATE_SENTINEL not a ZIP')
        with self.assertRaises(zipfile.BadZipFile):
            diagnosis.bundled_runner()

    def test_collect_classifies_private_logs_and_reports_owned_runner_facts(self):
        self.runner_jar()
        state = self.private / 'maestro-preflight-state/maestro/tests/session'
        state.mkdir(parents=True)
        (state / 'maestro.log').write_text(
            'Running XcUITest with `xcodebuild test-without-building` with 22087 and config: PRIVATE_SENTINEL\n')
        (state / 'xctest_runner_2026.log').write_text(
            'Library not loaded: PRIVATE_SENTINEL\n** TEST EXECUTE FAILED **\n')
        home = self.root / 'home'
        crash = home / 'Library/Logs/DiagnosticReports'
        crash.mkdir(parents=True)
        (crash / (diagnosis.RUNNER_NAME + '-private.ips')).write_text(
            '"termination": {"private": "PRIVATE_SENTINEL"}')

        def capture(args, label, timeout=20):
            if label == 'xcodebuild-sample':
                (self.private / 'driver-xcodebuild.sample').write_text(
                    'xpc_connection_send_message_with_reply_sync\nSimDevice installApplication\nPRIVATE_SENTINEL')
            payload = {
                'processes': ' 123 Z xcodebuild test-without-building -destination id=' + self.device + ' PRIVATE_SENTINEL\n'
                             ' 456 S xcodebuild test-without-building -destination id=OTHER PRIVATE_SENTINEL',
                'runner-installed': 'PRIVATE_SENTINEL app container',
                'runner-running': '123 0 UIKitApplication:' + diagnosis.RUNNER_ID + '[PRIVATE_SENTINEL]',
                'simulator-runner-events': 'PRIVATE_SENTINEL',
            }.get(label, 'PRIVATE_SENTINEL')
            return payload, {'label': label, 'exit_code': 0}

        connection = mock.Mock()
        connection.getresponse.return_value.status = 200
        with mock.patch.object(diagnosis, 'capture', side_effect=capture), \
                mock.patch.object(diagnosis.Path, 'home', return_value=home), \
                mock.patch.object(diagnosis.socket, 'create_connection') as tcp, \
                mock.patch.object(diagnosis.http.client, 'HTTPConnection', return_value=connection) as http:
            facts = diagnosis.collect(self.device)
        self.assertTrue(facts['runner_installed'])
        self.assertTrue(facts['runner_running'])
        self.assertEqual(facts['runner_last_exit_codes'], [0])
        self.assertEqual(facts['owned_xcodebuild_process_count'], 1)
        self.assertEqual(facts['owned_xcodebuild_zombie_count'], 1)
        self.assertEqual(facts['xcodebuild_sample']['stack_categories'],
                         ['XPC_SYNC_WAIT', 'CORE_SIMULATOR', 'DEVICE_INSTALL'])
        self.assertEqual(facts['driver_port'], 22087)
        self.assertTrue(facts['driver_tcp_connects'])
        self.assertEqual(facts['driver_status_http_code'], 200)
        self.assertEqual(facts['recent_crash_reports'][0]['categories'], ['PROCESS_CRASHED'])
        tcp.assert_called_once_with(('127.0.0.1', 22087), timeout=2)
        http.assert_called_once_with('127.0.0.1', 22087, timeout=3)
        connection.request.assert_called_once_with('GET', '/status')
        connection.close.assert_called_once()
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))

    def test_collect_without_driver_logs_never_probes_an_arbitrary_port(self):
        with mock.patch.object(diagnosis, 'capture', return_value=('', {'exit_code': 1})), \
                mock.patch.object(diagnosis.Path, 'home', return_value=self.root / 'absent'), \
                mock.patch.object(diagnosis.socket, 'create_connection') as tcp, \
                mock.patch.object(diagnosis.http.client, 'HTTPConnection') as http:
            facts = diagnosis.collect(self.device)
        self.assertIsNone(facts['runner_installed'])
        self.assertIsNone(facts['runner_running'])
        self.assertIsNone(facts['driver_port'])
        self.assertEqual(facts['collection_errors'], [{'stage': 'bundled_runner', 'error_type': 'ValueError'}])
        tcp.assert_not_called()
        http.assert_not_called()

    def test_baseline_controls_are_bounded_read_only_and_export_no_process_text(self):
        selected = '/Applications/Xcode_16.4.app/Contents/Developer'
        calls = []

        def capture(args, label, timeout):
            calls.append((args, label, timeout))
            payload = '123 S ' + selected + '/Applications/Simulator.app/Contents/MacOS/Simulator PRIVATE_SENTINEL'
            return payload, {'label': label, 'exit_code': 0 if label == 'baseline-processes' else 124}

        with mock.patch.object(diagnosis, 'capture', side_effect=capture), \
                mock.patch.dict(os.environ, {'DEVELOPER_DIR': selected}):
            facts = diagnosis.baseline(self.device)
        self.assertEqual(facts['simulator_frontend_process_count'], 1)
        self.assertTrue(facts['selected_simulator_frontend_running'])
        self.assertEqual(calls, [
            (['ps', '-axo', 'pid=,stat=,args='], 'baseline-processes', 10),
            (['xcrun', 'simctl', 'listapps', self.device], 'baseline-listapps', 10),
            (['xcrun', 'simctl', 'get_app_container', self.device, 'com.apple.Preferences', 'app'],
             'baseline-preferences-container', 10),
        ])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))
        self.assertNotIn(selected, json.dumps(facts))

    def test_timed_out_runner_lookup_and_failed_process_control_remain_unknown(self):
        with mock.patch.object(diagnosis, 'capture', return_value=('', {'exit_code': 124})), \
                mock.patch.object(diagnosis.Path, 'home', return_value=self.root / 'absent'):
            facts = diagnosis.collect(self.device)
            before = diagnosis.baseline(self.device)
        self.assertIsNone(facts['runner_installed'])
        self.assertIsNone(facts['runner_running'])
        self.assertIsNone(facts['owned_xcodebuild_alive'])
        self.assertIsNone(before['simulator_frontend_process_count'])
        self.assertIsNone(before['selected_simulator_frontend_running'])

    def test_permission_errors_and_truncated_inventories_remain_unknown(self):
        for truncated, payload in [(True, ''), (False, ''), (False, 'PRIVATE_SENTINEL malformed ps')]:
            with self.subTest(truncated=truncated):
                def capture(args, label, timeout=20):
                    if label == 'runner-installed':
                        return 'permission denied PRIVATE_SENTINEL', {'exit_code': 1, 'categories': ['PERMISSION_DENIED']}
                    return payload, {'exit_code': 0, 'truncated': truncated}
                with mock.patch.object(diagnosis, 'capture', side_effect=capture), \
                        mock.patch.object(diagnosis.Path, 'home', return_value=self.root / 'absent'):
                    facts = diagnosis.collect(self.device)
                    before = diagnosis.baseline(self.device)
                self.assertIsNone(facts['runner_installed'])
                self.assertIsNone(facts['owned_xcodebuild_alive'])
                self.assertIsNone(facts['owned_xcodebuild_process_count'])
                self.assertIsNone(facts['owned_xcodebuild_zombie_count'])
                self.assertNotIn('xcodebuild_sample', facts)
                self.assertIsNone(facts['runner_running'])
                self.assertIsNone(facts['runner_launchctl_entries'])
                self.assertIsNone(before['simulator_frontend_process_count'])
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))

    def test_receipt_read_and_save_failures_preserve_actual_driver_primary_and_cleanup(self):
        for boundary in ['read', 'save']:
            for primary in [True, False]:
                with self.subTest(boundary=boundary, primary=primary):
                    native.save({'commands': [], 'toolchain': {}, 'maestro': {'binary': 'fixed-maestro'}})
                    original_error = RuntimeError('PRIVATE_SENTINEL hierarchy failure')
                    armed = [False]
                    events = []
                    real_read, real_save = native.read, native.save

                    def read():
                        if armed[0] and boundary == 'read':
                            raise OSError('PRIVATE_SENTINEL read failure')
                        return real_read()

                    def save(value):
                        if armed[0] and boundary == 'save':
                            raise OSError('PRIVATE_SENTINEL save failure')
                        real_save(value)

                    def command(args, label, **kwargs):
                        if label == 'Create owned driver-preflight simulator':
                            return self.device
                        if label == 'Check disposable iOS driver readiness':
                            armed[0] = True
                            events.append('hierarchy')
                            if primary:
                                raise original_error

                    def dispose(args, **kwargs):
                        events.append(args[2])
                        if args[2] == 'shutdown':
                            raise OSError('PRIVATE_SENTINEL shutdown failure')

                    with mock.patch.dict(os.environ, {'KEEPER_DIAGNOSTIC': 'true'}), \
                            mock.patch.object(native, 'record'), mock.patch.object(native, 'install_maestro'), \
                            mock.patch.object(native, 'wait_for_simulator_app_services'), \
                            mock.patch.object(native, 'command', side_effect=command), \
                            mock.patch.object(native, 'read', side_effect=read), \
                            mock.patch.object(native, 'save', side_effect=save), \
                            mock.patch.object(native.subprocess, 'run', side_effect=dispose), \
                            mock.patch.object(diagnosis, 'baseline', return_value={'commands': []}), \
                            mock.patch.object(diagnosis, 'collect', return_value={'scope': 'setup only'}), \
                            self.assertRaises(RuntimeError) as failure:
                        diagnosis.run()
                    if primary:
                        self.assertIs(failure.exception, original_error)
                    else:
                        self.assertNotIn('PRIVATE_SENTINEL', str(failure.exception))
                    self.assertEqual(events, ['hierarchy', 'shutdown', 'delete'])

    def test_complete_valid_inventories_can_still_establish_absence(self):
        def capture(args, label, timeout=20):
            payload = 'PID Status Label\n' if label == 'runner-running' else '1 Ss /sbin/launchd\n'
            return payload, {'exit_code': 0, 'truncated': False}
        with mock.patch.object(diagnosis, 'capture', side_effect=capture), \
                mock.patch.object(diagnosis.Path, 'home', return_value=self.root / 'absent'):
            facts = diagnosis.collect(self.device)
            before = diagnosis.baseline(self.device)
        self.assertFalse(facts['owned_xcodebuild_alive'])
        self.assertEqual(facts['owned_xcodebuild_process_count'], 0)
        self.assertFalse(facts['runner_running'])
        self.assertEqual(facts['runner_launchctl_entries'], 0)
        self.assertEqual(before['simulator_frontend_process_count'], 0)

    def test_run_rejects_other_platforms_and_missing_opt_in_before_operations(self):
        for platform, opt_in in [('ANDROID', 'true'), ('IOS', ''), ('IOS', 'false')]:
            with self.subTest(platform=platform, opt_in=opt_in), \
                    mock.patch.object(native, 'PLATFORM', platform), \
                    mock.patch.dict(os.environ, {'KEEPER_DIAGNOSTIC': opt_in}), \
                    mock.patch.object(native, 'record') as record, \
                    mock.patch.object(native, 'install_maestro') as install, \
                    self.assertRaises(ValueError):
                diagnosis.run()
            record.assert_not_called()
            install.assert_not_called()

    def test_run_collects_before_cleanup_and_preserves_original_driver_failure(self):
        events = []
        original_error = RuntimeError('PRIVATE_SENTINEL original driver failure')

        def original(args, label, **kwargs):
            events.append('hierarchy')
            raise original_error

        def driver(phase):
            self.assertEqual(phase, 'driver')
            try:
                native.command(['maestro', '--device', self.device, 'hierarchy'],
                               'Check disposable iOS driver readiness', timeout=300, error_details=False)
            finally:
                events.append('cleanup')

        def collect(device, metadata):
            self.assertEqual(device, self.device)
            self.assertEqual(metadata['commands'][-1]['label'], 'Check disposable iOS driver readiness')
            events.append('collect')
            return {'collection_errors': [], 'scope': 'setup only'}

        with mock.patch.dict(os.environ, {'KEEPER_DIAGNOSTIC': 'true'}), \
                mock.patch.object(native, 'record'), mock.patch.object(native, 'install_maestro'), \
                mock.patch.object(native, 'command', side_effect=original) as command, \
                mock.patch.object(native, 'run_phase', side_effect=driver), \
                mock.patch.object(diagnosis, 'baseline', return_value={'commands': []}), \
                mock.patch.object(diagnosis, 'collect', side_effect=collect), \
                self.assertRaises(RuntimeError) as failure:
            diagnosis.run()
        self.assertIs(failure.exception, original_error)
        self.assertEqual(events, ['hierarchy', 'collect', 'cleanup'])
        self.assertEqual(native.read()['driver_diagnosis']['scope'], 'setup only')
        self.assertEqual(native.read()['driver_diagnosis']['snapshot_phase'], 'AFTER_DRIVER_COMMAND')
        self.assertFalse(native.read()['driver_diagnosis']['hierarchy_running_before_collection'])
        self.assertNotIn('PRIVATE_SENTINEL', native.EVIDENCE.read_text())
        self.assertEqual(command.call_count, 1)

    def test_live_sampling_precedes_cli_cleanup_and_persists_after_command_metadata(self):
        events = []
        sampled = threading.Event()
        original_error = RuntimeError('PRIVATE_SENTINEL original driver failure')

        def before(device):
            self.assertEqual(device, self.device)
            events.append('baseline')
            return {'commands': []}

        def original(args, label, **kwargs):
            events.append('hierarchy-start')
            self.assertTrue(sampled.wait(1), 'diagnosis must sample before command returns')
            data = native.read()
            data['command_final_write'] = True
            native.save(data)
            events.append('hierarchy-finish')
            raise original_error

        def collect(device, metadata):
            self.assertEqual(device, self.device)
            self.assertNotIn('command_final_write', metadata)
            self.assertNotIn('hierarchy-finish', events)
            events.append('collect')
            sampled.set()
            return {'collection_errors': [], 'scope': 'live setup only'}

        def driver(phase):
            try:
                native.command(['maestro', '--device', self.device, 'hierarchy'],
                               'Check disposable iOS driver readiness', timeout=300, error_details=False)
            finally:
                events.append('cleanup')

        with mock.patch.dict(os.environ, {'KEEPER_DIAGNOSTIC': 'true'}), \
                mock.patch.object(native, 'record'), mock.patch.object(native, 'install_maestro'), \
                mock.patch.object(native, 'command', side_effect=original) as command, \
                mock.patch.object(native, 'run_phase', side_effect=driver), \
                mock.patch.object(diagnosis, 'POLL_SNAPSHOT_SECONDS', 0.01), \
                mock.patch.object(diagnosis, 'baseline', side_effect=before), \
                mock.patch.object(diagnosis, 'collect', side_effect=collect), \
                self.assertRaises(RuntimeError) as failure:
            diagnosis.run()
        self.assertIs(failure.exception, original_error)
        self.assertEqual(events, ['baseline', 'hierarchy-start', 'collect', 'hierarchy-finish', 'cleanup'])
        data = native.read()
        self.assertTrue(data['command_final_write'])
        self.assertEqual(data['driver_diagnosis']['snapshot_phase'], 'DURING_DRIVER_POLLING')
        self.assertTrue(data['driver_diagnosis']['hierarchy_running_before_collection'])
        self.assertNotIn('PRIVATE_SENTINEL', native.EVIDENCE.read_text())
        self.assertEqual(command.call_count, 1)

    def test_collection_failure_does_not_replace_original_driver_failure(self):
        original_error = RuntimeError('PRIVATE_SENTINEL original driver failure')

        def driver(phase):
            native.command(['maestro', '--device', self.device, 'hierarchy'],
                           'Check disposable iOS driver readiness', timeout=300, error_details=False)

        with mock.patch.dict(os.environ, {'KEEPER_DIAGNOSTIC': 'true'}), \
                mock.patch.object(native, 'record'), mock.patch.object(native, 'install_maestro'), \
                mock.patch.object(native, 'command', side_effect=original_error), \
                mock.patch.object(native, 'run_phase', side_effect=driver), \
                mock.patch.object(diagnosis, 'baseline', return_value={'commands': []}), \
                mock.patch.object(diagnosis, 'collect', side_effect=ValueError('PRIVATE_SENTINEL collection')), \
                self.assertRaises(RuntimeError) as failure:
            diagnosis.run()
        self.assertIs(failure.exception, original_error)
        facts = native.read()['driver_diagnosis']
        self.assertEqual(facts['collection_errors'], [{'stage': 'pre_cleanup', 'error_type': 'ValueError'}])
        self.assertNotIn('PRIVATE_SENTINEL', native.EVIDENCE.read_text())


if __name__ == '__main__':
    unittest.main()
