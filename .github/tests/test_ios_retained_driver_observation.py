"""Owned live driver sampling preserves command result and metadata ordering."""
import copy
import importlib.util
from pathlib import Path
import threading
from types import SimpleNamespace
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('retained_driver_controls',
    Path(__file__).resolve().parents[1] / 'native/ios_retained_driver_observation.py')
observer = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(observer)
DEVICE = '12345678-1234-1234-1234-123456789ABC'


class RetainedDriver(unittest.TestCase):
    def test_owned_snapshot_precedes_command_completion_and_keeps_primary_failure(self):
        state = {'commands': []}
        def save(value): state.clear(); state.update(copy.deepcopy(value))
        native = SimpleNamespace(PRIVATE=Path('/owned'), read=lambda: copy.deepcopy(state), save=save)
        sampled = threading.Event()
        failure = RuntimeError('ORIGINAL_PRIVATE_FAILURE')
        def original(*args, **kwargs):
            self.assertTrue(sampled.wait(1))
            state['final_command_write'] = True
            raise failure
        def collect(device, metadata, **kwargs):
            self.assertEqual(device, DEVICE)
            self.assertEqual(metadata['commands'][-1]['label'], observer.LABEL)
            self.assertEqual(kwargs['log_directory'], Path('/owned/maestro-output'))
            self.assertNotIn('final_command_write', state)
            sampled.set()
            return {'owned_xcodebuild_alive': True}
        helper = SimpleNamespace(collect=collect)
        with mock.patch.object(observer, 'load', return_value=helper), \
                mock.patch.object(observer, 'POLL_SECONDS', 0.01), \
                self.assertRaises(RuntimeError) as caught:
            observer.observe(native, original, ['maestro', '--device', DEVICE], observer.LABEL, timeout=420)
        self.assertIs(caught.exception, failure)
        self.assertTrue(state['final_command_write'])
        facts = state['retained_live_driver_observation']
        self.assertTrue(facts['command_running_before_collection'])
        self.assertFalse(facts['native_acceptance'])

    def test_unrelated_commands_and_completed_driver_are_not_retried_or_resampled(self):
        native = SimpleNamespace(read=lambda: {'commands': []}, save=mock.Mock())
        original = mock.Mock(return_value='UNCHANGED')
        self.assertEqual(observer.observe(native, original, ['xcodebuild', '-version'], 'version'), 'UNCHANGED')
        original.assert_called_once()
        native.save.assert_not_called()
        with mock.patch.object(observer, 'load', return_value=SimpleNamespace(collect=mock.Mock())) as helper:
            self.assertEqual(observer.observe(native, original, ['maestro', '--device', DEVICE], observer.LABEL), 'UNCHANGED')
            helper.return_value.collect.assert_not_called()


if __name__ == '__main__': unittest.main()
