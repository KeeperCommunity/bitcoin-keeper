"""Offline observation controls; no app, simulator or native acceptance."""

from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    'install_diagnosis_controls', Path(__file__).resolve().parents[1] / 'native/install_diagnosis.py')
diagnosis = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(diagnosis)


class InstallDiagnosisTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.private = self.root / 'private'
        self.private.mkdir()
        self.evidence = self.root / 'metadata.json'
        self.evidence.write_text(json.dumps({'commands': [], 'build': 'PASS', 'smoke': 'FAIL'}))
        self.context = SimpleNamespace(PRIVATE=self.private, ROOT=self.root,
                                       read=lambda: json.loads(self.evidence.read_text()),
                                       save=lambda data: self.evidence.write_text(json.dumps(data)),
                                       command=mock.Mock())
        self.device = '12345678-1234-1234-1234-123456789ABC'
        self.args = ['xcrun', 'simctl', 'install', self.device, '/private/PRIVATE_SENTINEL/App.app']

    def test_log_export_is_fixed_categories_and_bounded_known_domain_codes(self):
        payload = ('PRIVATE_SENTINEL failed to install; invalid code signature; permission denied\n'
                   'Error Domain=com.apple.CoreSimulator.SimError Code=405 "PRIVATE_SENTINEL"\n'
                   'Error Domain=NSPOSIXErrorDomain Code=60 "PRIVATE_SENTINEL"\n'
                   'Error Domain=PRIVATE_SENTINEL Code=1\n'
                   'Error Domain=NSCocoaErrorDomain Code=1234567890\n')
        facts = diagnosis._classify(payload)
        self.assertEqual(facts['categories'], ['INSTALL_FAILED', 'SIGNATURE_VERIFICATION_FAILED', 'PERMISSION_DENIED'])
        self.assertEqual(facts['error_domain_codes'], {'CORE_SIMULATOR': [405], 'POSIX': [60]})
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))
        self.assertEqual(diagnosis._classify('PRIVATE_SENTINEL token=arbitrary recovery words'),
                         {'categories': [], 'error_domain_codes': {}})
        unknown = type('PRIVATE_SENTINEL', (Exception,), {})('arbitrary text')
        self.assertEqual(diagnosis._error(unknown), 'OTHER_ERROR')

    def test_private_log_reader_bounds_bytes_hashes_and_rejects_path_escape(self):
        path = self.private / 'output.log'
        payload = b'PRIVATE_SENTINEL failed to install\n' + b'x' * diagnosis.LIMIT
        path.write_bytes(payload)
        raw, facts = diagnosis._bounded(self.context, path)
        self.assertEqual(len(raw), diagnosis.LIMIT)
        self.assertTrue(facts['truncated'])
        self.assertFalse(facts['grew_during_read'])
        self.assertEqual(facts['bytes'], len(payload))
        self.assertEqual(facts['prefix_sha256'], hashlib.sha256(payload[:diagnosis.LIMIT]).hexdigest())
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))
        outside = self.root / 'outside.log'
        outside.write_text('PRIVATE_SENTINEL')
        link = self.private / 'link.log'
        link.symlink_to(outside)
        for item in [outside, link]:
            with self.subTest(item=item), self.assertRaises(ValueError):
                diagnosis._bounded(self.context, item)

    def test_capture_does_not_follow_a_preexisting_output_symlink(self):
        outside = self.root / 'outside.log'
        outside.write_text('PRIVATE_SENTINEL remains intact')
        (self.private / 'fixture-processes.log').symlink_to(outside)
        with mock.patch.object(diagnosis.subprocess, 'Popen') as popen:
            _, facts = diagnosis._capture(self.context, ['ps'], 'processes', 'fixture', 3)
        popen.assert_not_called()
        self.assertEqual(facts['error_type'], 'ValueError')
        self.assertEqual(outside.read_text(), 'PRIVATE_SENTINEL remains intact')

    def test_baseline_queries_app_services_without_app_or_service_changes(self):
        with mock.patch.object(diagnosis, '_capture', return_value=('', {'exit_code': 124})) as capture, \
                mock.patch.object(diagnosis.shutil, 'disk_usage', return_value=SimpleNamespace(free=123456)), \
                mock.patch.object(diagnosis.os, 'getloadavg', return_value=(1.125, 2.25, 3.5)):
            facts = diagnosis._baseline(self.context, self.device, 'fixture')
        self.assertEqual([call.args for call in capture.call_args_list], [
            (self.context, ['xcrun', 'simctl', 'listapps', self.device], 'baseline-listapps', 'fixture', 5),
            (self.context, ['xcrun', 'simctl', 'get_app_container', self.device, 'com.apple.Preferences', 'app'],
             'baseline-preferences-container', 'fixture', 5),
        ])
        self.assertEqual(facts['disk_free_bytes'], 123456)
        self.assertEqual(facts['host_load_1_5_15m'], [1.12, 2.25, 3.5])
        self.assertEqual(facts['resource_errors'], [])
        self.context.command.assert_not_called()

    def test_collect_samples_only_one_exact_owned_install_and_keeps_service_output_private(self):
        calls = []
        (self.private / 'command-001.log').write_text('PRIVATE_SENTINEL resource busy')

        def capture(context, args, label, prefix, timeout):
            self.assertIs(context, self.context)
            calls.append((args, label, timeout))
            if label == 'install-sample':
                Path(args[-1]).write_text('CoreSimulator SimDevice installApplication\n'
                                          'xpc_connection_send_message_with_reply_sync PRIVATE_SENTINEL')
            payload = {
                'processes': '123 S /Developer/usr/bin/simctl install ' + self.device + ' PRIVATE_SENTINEL\n'
                             '456 S /Developer/usr/bin/simctl install OTHER PRIVATE_SENTINEL\n'
                             '789 S /Developer/usr/bin/simctl install OTHER/' + self.device + ' PRIVATE_SENTINEL',
                'simulator-services': '20 0 com.apple.mobile.installd\n- 0 com.apple.appinstalld\n'
                                      '30 0 com.apple.lsd\nPRIVATE_SENTINEL',
                'owned-host-events': 'Error Domain=com.apple.CoreSimulator.SimError Code=405 PRIVATE_SENTINEL',
                'simulator-install-events': 'PRIVATE_SENTINEL',
            }.get(label, '')
            return payload, {'label': label, 'exit_code': 0, **diagnosis._classify(payload)}

        with mock.patch.object(diagnosis, '_capture', side_effect=capture):
            facts = diagnosis._collect(self.context, self.device, 'fixture', self.private / 'command-001.log')
        self.assertEqual(facts['owned_install_process_count'], 1)
        self.assertTrue(facts['owned_install_running'])
        self.assertEqual(facts['install_sample']['stack_categories'],
                         ['CORE_SIMULATOR', 'MOBILE_INSTALLATION', 'XPC_SYNC_WAIT'])
        self.assertIn((['sample', '123', '3', '1', '-file', str(self.private / 'fixture-install.sample')],
                       'install-sample', 8), calls)
        self.assertTrue(facts['services']['installd']['running'])
        self.assertFalse(facts['services']['appinstalld']['running'])
        self.assertTrue(facts['services']['lsd']['running'])
        self.assertEqual(facts['install_command_output']['categories'], ['RESOURCE_BUSY'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))
        self.assertNotIn(str(self.private), json.dumps(facts))
        self.context.command.assert_not_called()

    def test_failed_process_and_service_controls_stay_unknown_and_do_not_sample(self):
        with mock.patch.object(diagnosis, '_capture', return_value=('', {'exit_code': 124})) as capture:
            facts = diagnosis._collect(self.context, self.device, 'fixture', self.private / 'missing.log')
        self.assertIsNone(facts['owned_install_process_count'])
        self.assertIsNone(facts['owned_install_running'])
        self.assertIsNone(facts['services']['installd']['running'])
        self.assertFalse(any(call.args[2] == 'install-sample' for call in capture.call_args_list))

    def test_observe_samples_during_one_unchanged_command_and_preserves_failure_metadata(self):
        events = []
        sampled = threading.Event()
        original_error = RuntimeError('PRIVATE_SENTINEL original install failure')

        def command(args, label, timeout):
            self.assertIs(args, self.args)
            self.assertEqual(label, 'Install unsigned development app')
            self.assertEqual(timeout, 120)
            events.append('install-start')
            self.assertTrue(sampled.wait(2), 'sample must precede install return/cleanup')
            data = self.context.read()
            data['original_final_write'] = True
            self.context.save(data)
            events.append('install-end')
            raise original_error

        def baseline(*args):
            events.append('baseline')
            return {'commands': []}

        def collect(*args):
            events.append('sample')
            self.assertNotIn('original_final_write', self.context.read())
            sampled.set()
            return {'commands': [], 'collection_errors': []}

        self.context.command.side_effect = command
        try:
            with mock.patch.object(diagnosis, 'SNAPSHOT_SECONDS', 0.01), \
                    mock.patch.object(diagnosis, '_baseline', side_effect=baseline), \
                    mock.patch.object(diagnosis, '_collect', side_effect=collect), \
                    mock.patch.object(diagnosis, '_capture', return_value=('', {'exit_code': 124})), \
                    self.assertRaises(RuntimeError) as failure:
                diagnosis.observe(self.context, self.device, self.args, 'Install unsigned development app', timeout=120)
            self.assertIs(failure.exception, original_error)
        finally:
            events.append('caller-cleanup')
        self.assertEqual(events, ['baseline', 'install-start', 'sample', 'install-end', 'caller-cleanup'])
        self.context.command.assert_called_once_with(self.args, 'Install unsigned development app', timeout=120)
        data = self.context.read()
        self.assertTrue(data['original_final_write'])
        facts = data['install_diagnoses'][0]
        self.assertEqual(facts['snapshot_phase'], 'DURING_INSTALL')
        self.assertTrue(facts['install_running_before_collection'])
        self.assertEqual(facts['post_install_lookup']['state'], 'TIMEOUT')
        self.assertEqual(facts['command_error_type'], 'RuntimeError')
        self.assertEqual((data['build'], data['smoke']), ('PASS', 'FAIL'))
        self.assertNotIn('installed_artifact_verified', data)
        self.assertNotIn('PRIVATE_SENTINEL', self.evidence.read_text())

    def test_fast_success_returns_original_result_without_retry_or_native_credit(self):
        result = object()
        self.context.command.return_value = result
        with mock.patch.object(diagnosis, '_baseline', return_value={'commands': []}), \
                mock.patch.object(diagnosis, '_collect', return_value={'commands': []}), \
                mock.patch.object(diagnosis, '_capture', return_value=('', {'exit_code': 0})):
            actual = diagnosis.observe(self.context, self.device, self.args, 'Install unsigned development app')
        self.assertIs(actual, result)
        self.context.command.assert_called_once_with(self.args, 'Install unsigned development app', timeout=120)
        data = self.context.read()
        self.assertEqual(data['install_diagnoses'][0]['snapshot_phase'], 'AFTER_INSTALL_COMMAND')
        self.assertEqual(data['install_diagnoses'][0]['post_install_lookup']['state'], 'SUCCESS')
        self.assertEqual(data['smoke'], 'FAIL')
        self.assertNotIn('installed_artifact_verified', data)

    def test_collection_and_persistence_errors_cannot_mask_original_install_failure(self):
        original_error = RuntimeError('PRIVATE_SENTINEL original install failure')
        self.context.command.side_effect = original_error
        console = io.StringIO()
        with mock.patch.object(diagnosis, '_baseline', side_effect=ValueError('PRIVATE_SENTINEL baseline')), \
                mock.patch.object(diagnosis, '_collect', side_effect=ValueError('PRIVATE_SENTINEL snapshot')), \
                mock.patch.object(diagnosis, '_capture', side_effect=ValueError('PRIVATE_SENTINEL lookup')), \
                redirect_stdout(console), self.assertRaises(RuntimeError) as failure:
            diagnosis.observe(self.context, self.device, self.args, 'Install unsigned development app')
        self.assertIs(failure.exception, original_error)
        self.context.command.assert_called_once()
        self.assertNotIn('PRIVATE_SENTINEL', console.getvalue() + self.evidence.read_text())

    def test_successful_install_with_unpersisted_diagnostics_blocks_with_fixed_error(self):
        self.context.command.return_value = object()
        self.context.save = mock.Mock(side_effect=ValueError('PRIVATE_SENTINEL persistence failure'))
        with mock.patch.object(diagnosis, '_baseline', return_value={'commands': []}), \
                mock.patch.object(diagnosis, '_collect', return_value={'commands': []}), \
                mock.patch.object(diagnosis, '_capture', return_value=('', {'exit_code': 0})), \
                self.assertRaises(RuntimeError) as failure:
            diagnosis.observe(self.context, self.device, self.args, 'Install unsigned development app')
        self.assertEqual(str(failure.exception), 'Bounded install diagnostics could not be saved.')
        self.assertTrue(failure.exception.__suppress_context__)
        self.context.command.assert_called_once_with(self.args, 'Install unsigned development app', timeout=120)
        self.context.save.assert_called_once()
        self.assertNotIn('install_diagnoses', self.context.read())
        self.assertNotIn('PRIVATE_SENTINEL', str(failure.exception) + self.evidence.read_text())

    def test_wrong_device_or_command_is_rejected_before_any_operation(self):
        for device, args in [('OTHER', self.args), (self.device, ['adb', 'install', self.device]),
                             (self.device, ['xcrun', 'simctl', 'install', 'OTHER', 'PRIVATE_SENTINEL'])]:
            with self.subTest(args=args), mock.patch.object(diagnosis, '_baseline') as baseline, \
                    self.assertRaises(ValueError):
                diagnosis.observe(self.context, device, args, 'Install unsigned development app')
            baseline.assert_not_called()
        self.context.command.assert_not_called()


if __name__ == '__main__':
    unittest.main()
