"""Retained-build admission and observational lifecycle; no native acceptance."""
import importlib.util
import os
from pathlib import Path
import plistlib
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('comparison', Path(__file__).resolve().parents[1] / 'native/ios_signature_comparison.py')
comparison = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(comparison)
DEVICE = '12345678-1234-1234-1234-123456789ABC'
ENV = dict(KEEPER_SOURCE_SHA='f' * 40, GITHUB_RUN_ID='2', GITHUB_RUN_ATTEMPT='1',
           GITHUB_WORKFLOW_REF='private/workflow', GITHUB_WORKFLOW_SHA='a' * 40)

class ComparisonTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_wrong_zip_or_alias_rejects_before_unpacking(self):
        native = SimpleNamespace(PRIVATE=self.root)
        input_zip = self.root / 'original.zip'
        input_zip.write_bytes(b'WRONG_APP')
        for kind in ('regular', 'symlink', 'hardlink'):
            with self.subTest(kind=kind):
                candidate = input_zip
                if kind == 'symlink':
                    candidate = self.root / 'symlink.zip'
                    candidate.symlink_to(input_zip)
                if kind == 'hardlink':
                    candidate = self.root / 'hardlink.zip'
                    os.link(input_zip, candidate)
                with self.assertRaises((ValueError, OSError)), mock.patch.object(comparison.tarfile, 'open') as unpack:
                    comparison.restore(native, candidate)
                unpack.assert_not_called()
        self.assertFalse((self.root / 'DerivedData').exists())

    def variant(self, name, fail=None, stream_failure=False):
        native = comparison.module('ios_launch_debug').load_native()
        native.PLATFORM = 'IOS'
        cleanup = []
        def command(args, label, **kwargs):
            data = native.read()
            data['commands'].append({'command': args, 'label': label, 'exit_code': 1 if label == fail else 0})
            native.save(data)
            (native.PRIVATE / ('command-%03d.log' % len(data['commands']))).write_bytes(b'')
            if label == fail:
                raise RuntimeError('PRIVATE_REASON')
            if args[:2] == ['codesign', '--display']:
                return plistlib.dumps(comparison.module('simulator_signing').ENTITLEMENTS).decode()
            if args[:3] == ['xcrun', 'simctl', 'create']:
                return DEVICE
            if args[:3] == ['xcrun', 'simctl', 'launch']:
                return comparison.APP + ': 123'
        native.command = command
        def installed(device):
            data = native.read()
            data.update(installed_artifact_verified=True, installed_artifact={'inventory_sha256': 'f' * 64})
            native.save(data)
        native.verify_installed_artifact = installed
        native.wait_for_simulator_app_services = lambda device: None
        native.artifact_identity = lambda: {'path': 'private/app', 'executable_sha256': 'a' * 64}
        native.sign_simulator_app = mock.Mock()
        class Stream:
            def __init__(self, path, args):
                path.write_bytes(b'')
            def stop(self):
                return {'drain_failed': stream_failure, 'cleanup_failed': False, 'initial_exit_code': None}
        observer = SimpleNamespace(process=mock.Mock(side_effect=[{'state':'NO_OWNED_ENTRY_OBSERVED'},
            {'state':'OWNED_RUNNING_ENTRY_OBSERVED'}, {'state':'NO_OWNED_ENTRY_OBSERVED'}]), codes=lambda payload: {})
        debug = SimpleNamespace(load_native=lambda: native, Stream=Stream, MAX_LOG=1024,
            crash_reasons=lambda *args: [{'termination': {'namespace':'CODESIGNING','code':1}}])
        def run(args, **kwargs):
            cleanup.append(args)
        with mock.patch.dict(os.environ, ENV), mock.patch.object(comparison, 'restore'), mock.patch.object(
                comparison.subprocess, 'run', side_effect=run), mock.patch.object(comparison.time, 'sleep') as delay:
            result = comparison.compare_variant(name, self.root, self.root, self.root / 'input.zip', debug, observer)
        return result, native, cleanup, delay

    def test_accepted_launch_with_dead_later_process_does_not_grant_acceptance(self):
        result, native, cleanup, delay = self.variant('original')
        self.assertTrue(result['observation_complete'])
        self.assertEqual(result['launch_request'], 'ACCEPTED')
        self.assertEqual(result['after_process']['state'], 'NO_OWNED_ENTRY_OBSERVED')
        self.assertFalse(result['native_acceptance'])
        self.assertTrue(result['installed_artifact_verified'])
        self.assertEqual(result['installed_artifact']['inventory_sha256'], 'f' * 64)
        self.assertEqual([row[2] for row in cleanup], ['shutdown', 'delete'])
        delay.assert_called_once_with(10)
        native.sign_simulator_app.assert_not_called()

    def test_setup_failure_records_phase_and_does_not_look_complete(self):
        result, native, cleanup, delay = self.variant('complete_nested', 'Install exact comparison simulator app')
        self.assertFalse(result['observation_complete'])
        self.assertEqual(result['phase'], 'SIMULATOR_SETUP')
        self.assertEqual(result['setup_error_type'], 'RuntimeError')
        self.assertNotIn('PRIVATE_REASON', str(result))
        self.assertFalse(result['installed_artifact_verified'])
        native.sign_simulator_app.assert_called_once()
        self.assertEqual([row[2] for row in cleanup], ['shutdown', 'delete'])

    def test_rejected_launch_is_an_observed_failure_not_a_setup_error(self):
        result, _, _, _ = self.variant('original', 'Launch original app once')
        self.assertTrue(result['observation_complete'])
        self.assertEqual(result['launch_request'], 'REJECTED_OR_TIMED_OUT')
        self.assertEqual(result['launch_command']['exit_code'], 1)
        self.assertFalse(result['native_acceptance'])

    def test_capture_drain_failure_cannot_complete_the_comparison(self):
        result, _, _, _ = self.variant('original', stream_failure=True)
        self.assertFalse(result['observation_complete'])
        self.assertIn('host_stream_drain_failed', result['cleanup_errors'])

if __name__ == '__main__':
    unittest.main()
