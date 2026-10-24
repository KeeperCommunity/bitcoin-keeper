"""Offline readiness controls, not simulator or application acceptance."""

import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    'simulator_readiness_controls', Path(__file__).resolve().parents[1] / 'native/simulator_readiness.py')
readiness = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(readiness)


class SimulatorReadinessTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.evidence = self.root / 'metadata.json'
        self.evidence.write_text(json.dumps({'commands': [{'label': 'Wait for simulator boot'}],
                                            'build': 'PASS', 'smoke': 'NOT RUN', 'driver_preflight': {'result': 'FAIL'}}))
        self.context = SimpleNamespace(PRIVATE=self.root,
                                       read=lambda: json.loads(self.evidence.read_text()),
                                       save=lambda data: self.evidence.write_text(json.dumps(data)))
        self.device = '12345678-1234-1234-1234-123456789ABC'
        self.now = 100.0

    def clock(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds

    def test_success_requires_actual_query_exit_zero_and_grants_no_native_credit(self):
        def run(args, **options):
            self.assertEqual(args, ['xcrun', 'simctl', 'listapps', self.device])
            self.assertEqual(options, {'stdout': subprocess.DEVNULL, 'stderr': subprocess.DEVNULL,
                                       'timeout': 5, 'check': False})
            self.now += 0.2
            return SimpleNamespace(returncode=0)

        with mock.patch.object(readiness.time, 'monotonic', side_effect=self.clock), \
                mock.patch.object(readiness.subprocess, 'run', side_effect=run) as command, \
                mock.patch.object(readiness.time, 'sleep') as sleep:
            record = readiness.wait_for_app_services(self.context, self.device)
        command.assert_called_once()
        sleep.assert_not_called()
        self.assertEqual(record['result'], 'PASS')
        self.assertEqual(record['criterion'], 'SIMCTL_LISTAPPS_EXIT_ZERO')
        self.assertEqual(record['attempts'], [{'state': 'SUCCESS', 'exit_code': 0, 'duration_seconds': 0.2}])
        self.assertEqual(record['after_command_index'], 1)
        data = self.context.read()
        self.assertEqual(data['simulator_app_service_readiness'], [record])
        self.assertEqual(data['driver_preflight'], {'result': 'FAIL'})
        self.assertEqual((data['build'], data['smoke']), ('PASS', 'NOT RUN'))
        self.assertNotIn('install_succeeded', data)

    def test_read_only_timeouts_and_failures_can_precede_one_successful_response(self):
        calls = []

        def run(args, **options):
            calls.append(args)
            if len(calls) == 1:
                self.now += options['timeout']
                raise subprocess.TimeoutExpired(args, options['timeout'], output='PRIVATE_SENTINEL')
            self.now += 0.1
            return SimpleNamespace(returncode=1 if len(calls) == 2 else 0)

        with mock.patch.object(readiness.time, 'monotonic', side_effect=self.clock), \
                mock.patch.object(readiness.time, 'sleep', side_effect=self.sleep), \
                mock.patch.object(readiness.subprocess, 'run', side_effect=run):
            record = readiness.wait_for_app_services(self.context, self.device)
        self.assertEqual([item['state'] for item in record['attempts']], ['TIMEOUT', 'FAIL', 'SUCCESS'])
        self.assertTrue(all(args == ['xcrun', 'simctl', 'listapps', self.device] for args in calls))
        self.assertNotIn('PRIVATE_SENTINEL', self.evidence.read_text())
        self.assertEqual(record['duration_seconds'], 7.2)

    def test_overall_deadline_clamps_each_query_and_fails_closed_without_install_or_driver(self):
        limits = []

        def run(args, **options):
            limits.append(options['timeout'])
            self.now += options['timeout']
            raise subprocess.TimeoutExpired(args, options['timeout'], stderr='PRIVATE_SENTINEL')

        with mock.patch.object(readiness.time, 'monotonic', side_effect=self.clock), \
                mock.patch.object(readiness.time, 'sleep', side_effect=self.sleep), \
                mock.patch.object(readiness.subprocess, 'run', side_effect=run) as command, \
                self.assertRaises(RuntimeError) as failure:
            readiness.wait_for_app_services(self.context, self.device, timeout=12)
        self.assertEqual(limits, [5, 5])
        self.assertEqual(command.call_count, 2)
        self.assertEqual(self.now, 112.0)
        record = self.context.read()['simulator_app_service_readiness'][0]
        self.assertEqual(record['result'], 'FAIL')
        self.assertEqual(record['duration_seconds'], 12)
        self.assertNotIn('PRIVATE_SENTINEL', str(failure.exception) + self.evidence.read_text())

    def test_short_remaining_window_is_used_instead_of_a_fresh_five_seconds(self):
        def run(args, **options):
            self.now += options['timeout']
            raise subprocess.TimeoutExpired(args, options['timeout'])

        with mock.patch.object(readiness.time, 'monotonic', side_effect=self.clock), \
                mock.patch.object(readiness.time, 'sleep', side_effect=self.sleep), \
                mock.patch.object(readiness.subprocess, 'run', side_effect=run) as command, \
                self.assertRaises(RuntimeError):
            readiness.wait_for_app_services(self.context, self.device, timeout=8)
        self.assertEqual([call.kwargs['timeout'] for call in command.call_args_list], [5, 2])
        self.assertEqual(self.now, 108.0)

    def test_success_observed_only_after_deadline_does_not_supply_a_timely_pass(self):
        def run(args, **options):
            self.now += 121
            return SimpleNamespace(returncode=0)

        with mock.patch.object(readiness.time, 'monotonic', side_effect=self.clock), \
                mock.patch.object(readiness.subprocess, 'run', side_effect=run), \
                self.assertRaises(RuntimeError):
            readiness.wait_for_app_services(self.context, self.device)
        record = self.context.read()['simulator_app_service_readiness'][0]
        self.assertEqual(record['result'], 'FAIL')
        self.assertTrue(record['attempts'][0]['observed_after_deadline'])

    def test_unknown_query_errors_and_malformed_exit_status_never_supply_a_pass(self):
        private_error = type('PRIVATE_SENTINEL', (Exception,), {})('arbitrary private message')
        for outcome in [FileNotFoundError('PRIVATE_SENTINEL path'), private_error,
                        SimpleNamespace(returncode=None), SimpleNamespace(returncode=False)]:
            with self.subTest(outcome=type(outcome).__name__), \
                    mock.patch.object(readiness.subprocess, 'run', side_effect=outcome if isinstance(outcome, Exception) else None,
                                      return_value=outcome) as run, \
                    mock.patch.object(readiness.time, 'sleep') as sleep, \
                    self.assertRaises(RuntimeError):
                readiness.wait_for_app_services(self.context, self.device)
            run.assert_called_once()
            sleep.assert_not_called()
        records = self.context.read()['simulator_app_service_readiness']
        self.assertTrue(all(record['result'] == 'FAIL' for record in records))
        self.assertTrue(all(record['attempts'][0]['state'] == 'ERROR' for record in records))
        self.assertNotIn('PRIVATE_SENTINEL', self.evidence.read_text())

    def test_missing_persistence_cannot_allow_even_a_successful_response_to_continue(self):
        self.context.save = mock.Mock(side_effect=ValueError('PRIVATE_SENTINEL path'))
        with mock.patch.object(readiness.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as run, \
                self.assertRaises(RuntimeError) as failure:
            readiness.wait_for_app_services(self.context, self.device)
        run.assert_called_once()
        self.assertEqual(str(failure.exception), 'Simulator app-service readiness evidence could not be saved.')
        self.assertTrue(failure.exception.__suppress_context__)
        self.assertNotIn('PRIVATE_SENTINEL', str(failure.exception) + self.evidence.read_text())

    def test_unreadable_source_metadata_fails_before_query_with_fixed_error(self):
        self.context.read = mock.Mock(side_effect=ValueError('PRIVATE_SENTINEL private path'))
        with mock.patch.object(readiness.subprocess, 'run') as run, self.assertRaises(RuntimeError) as failure:
            readiness.wait_for_app_services(self.context, self.device)
        run.assert_not_called()
        self.assertEqual(str(failure.exception), 'Simulator app-service readiness evidence could not be read.')
        self.assertTrue(failure.exception.__suppress_context__)
        self.assertNotIn('PRIVATE_SENTINEL', str(failure.exception))

    def test_invalid_device_or_window_cannot_start_a_query(self):
        cases = [('PRIVATE_SENTINEL', 120), (None, 120), (self.device, 0), (self.device, -1),
                 (self.device, 121), (self.device, float('inf')), (self.device, float('nan')), (self.device, True)]
        with mock.patch.object(readiness.subprocess, 'run') as run:
            for device, timeout in cases:
                with self.subTest(device=device, timeout=timeout), self.assertRaises(ValueError):
                    readiness.wait_for_app_services(self.context, device, timeout)
        run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
