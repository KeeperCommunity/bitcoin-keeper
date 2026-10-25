"""Keep existing driver failure facts before owned simulator cleanup."""
import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest import mock

ROOT = Path(os.environ.get('KEEPER_DRIVER_FAILURE_SOURCE_ROOT', Path(__file__).resolve().parents[2]))
SPEC = importlib.util.spec_from_file_location('driver_failure_native', ROOT / '.github/native/hosted_native.py')
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)
DEVICE = '12345678-1234-1234-1234-123456789ABC'


class DriverFailureCapture(unittest.TestCase):
    def run_driver(self, fail=False, capture_fail=False):
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory)
            events = []
            primary = RuntimeError('PRIMARY_PRIVATE_SENTINEL')
            expected = {'scope': 'Before owned simulator cleanup; driver setup only.',
                        'collection_errors': [], 'commands': [], 'logs': []}
            def collect(device, metadata):
                self.assertEqual(device, DEVICE)
                self.assertEqual(metadata['build'], 'NOT RUN')
                self.assertEqual(observer.native.PRIVATE, private)
                events.append('capture')
                if capture_fail:
                    raise ValueError('CAPTURE_PRIVATE_SENTINEL')
                return expected
            observer = SimpleNamespace(collect=collect)
            spec = SimpleNamespace(loader=SimpleNamespace(exec_module=lambda module: None))
            def command(args, label, **kwargs):
                if label == 'Create owned driver-preflight simulator':
                    return DEVICE
                if label == 'Check disposable iOS driver readiness':
                    events.append('driver')
                    if fail:
                        raise primary
                return ''
            def cleanup(args, **kwargs):
                events.append(args[2])
                return SimpleNamespace(returncode=0)
            with mock.patch.multiple(native, PLATFORM='IOS', PRIVATE=private,
                    EVIDENCE=private / 'metadata.json'), mock.patch.dict(os.environ), \
                    mock.patch.object(native, 'command', side_effect=command), \
                    mock.patch.object(native, 'wait_for_simulator_app_services'), \
                    mock.patch.object(native, 'maestro_preflight_diagnostics', return_value={}), \
                    mock.patch.object(native.subprocess, 'run', side_effect=cleanup), \
                    mock.patch.object(native.importlib.util, 'spec_from_file_location', return_value=spec), \
                    mock.patch.object(native.importlib.util, 'module_from_spec', return_value=observer):
                native.save({'commands': [], 'maestro': {'binary': 'maestro'}, 'build': 'NOT RUN'})
                if fail:
                    with self.assertRaises(RuntimeError) as raised:
                        native.driver()
                    self.assertIs(raised.exception, primary)
                else:
                    native.driver()
                metadata = native.read()
            self.assertNotIn('PRIVATE_SENTINEL', str(metadata))
            return events, metadata, expected

    def test_actual_failed_driver_collects_existing_projection_before_shutdown_and_delete(self):
        events, metadata, expected = self.run_driver(fail=True)
        self.assertEqual(events, ['driver', 'capture', 'shutdown', 'delete'])
        self.assertEqual(metadata['driver_diagnosis'], expected)
        self.assertEqual(metadata['driver_preflight']['result'], 'FAIL')
        self.assertEqual(metadata['build'], 'NOT RUN')

    def test_success_does_not_invoke_failure_collector_or_change_driver_credit(self):
        events, metadata, _ = self.run_driver()
        self.assertEqual(events, ['driver', 'shutdown', 'delete'])
        self.assertNotIn('driver_diagnosis', metadata)
        self.assertEqual(metadata['driver_preflight']['result'], 'PASS')

    def test_collector_failure_keeps_primary_failure_and_owned_cleanup(self):
        events, metadata, _ = self.run_driver(fail=True, capture_fail=True)
        self.assertEqual(events, ['driver', 'capture', 'shutdown', 'delete'])
        self.assertEqual(metadata['driver_preflight']['result'], 'FAIL')
        self.assertEqual(metadata['driver_diagnosis']['collection_errors'],
            [{'stage': 'pre_cleanup', 'error_type': 'OTHER_ERROR'}])


if __name__ == '__main__':
    unittest.main()
