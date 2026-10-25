"""Controlled process/failure tests; no native launch or simulator credit."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
observer = load('direct_launch_under_test', ROOT / 'native/ios_direct_launch_observation.py')
DEVICE = '12345678-1234-1234-1234-123456789ABC'

class DirectLaunchObservation(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.private = Path(temporary.name)
        self.data = {'build': 'PASS', 'smoke': 'NOT RUN', 'install_succeeded': True,
            'installed_artifact_verified': True, 'device': {'id': DEVICE,
            'fresh_disposable_state': True}, 'startup_diagnostics': {'command_observation': {
            'commands': {'rows': [{'kind': 'LAUNCH_APP', 'status': 'FAILED'}]}}}}
        self.native = SimpleNamespace(PLATFORM='IOS', PRIVATE=self.private,
            read=lambda: self.data, original_smoke_failed=True)
        self.files = []
        self.real_temporary_file = tempfile.TemporaryFile
        self.before = {'state': 'NO_OWNED_ENTRY_OBSERVED', 'query': 'EXIT_ZERO', 'owned_entry_count': 0}
        self.after = {'state': 'OWNED_RUNNING_ENTRY_OBSERVED', 'query': 'EXIT_ZERO', 'owned_entry_count': 1}

    def temporary_file(self, **kwargs):
        handle = self.real_temporary_file(**kwargs)
        self.files.append(handle)
        return handle

    def exercise(self, exit_code=0, stderr=b'', timeout=False, spawn_error=False):
        child = mock.Mock(pid=7001)
        child.poll.return_value = exit_code
        child.wait.side_effect = [subprocess.TimeoutExpired('PRIVATE_SENTINEL', 20), 0] if timeout else None
        child.wait.return_value = exit_code
        def spawn(args, **kwargs):
            self.assertEqual(args, ['xcrun', 'simctl', 'launch', DEVICE, observer.APP])
            self.assertTrue(kwargs['start_new_session'])
            if spawn_error:
                raise OSError('PRIVATE_SENTINEL spawn failed')
            kwargs['stdout'].write((observer.APP + ': 12345\n').encode())
            kwargs['stderr'].write(stderr)
            return child
        with mock.patch.object(observer, 'process', side_effect=[self.before, self.after]), \
                mock.patch.object(observer.tempfile, 'TemporaryFile', side_effect=self.temporary_file), \
                mock.patch.object(observer.subprocess, 'Popen', side_effect=spawn) as popen, \
                mock.patch.object(observer.os, 'killpg') as kill:
            value = observer.collect(self.native, DEVICE)
        self.assertEqual(popen.call_count, 1)
        self.assertTrue(all(handle.closed for handle in self.files))
        self.assertEqual([x.name for x in self.private.iterdir()], ['ios-direct-launch.once'])
        self.assertFalse(value['native_acceptance'])
        self.assertEqual(value['cause'], 'UNKNOWN')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(value))
        self.assertNotIn('12345', json.dumps(value))
        self.assertEqual(self.data['smoke'], 'NOT RUN', 'observer must not repair the original state')
        return value, child, kill

    def test_later_success_does_not_set_pass_and_second_call_cannot_launch(self):
        result, child, _ = self.exercise()
        self.assertEqual(result['command'], 'EXIT_ZERO')
        self.assertEqual(result['launch_response'], 'ACCEPTED_AT_LATER_TIME')
        child.wait.assert_called_once_with(timeout=20)
        with mock.patch.object(observer.subprocess, 'Popen') as launch:
            self.assertEqual(observer.collect(self.native, DEVICE)['state'], 'ALREADY_ATTEMPTED')
            launch.assert_not_called()

    def test_nonzero_preserves_outer_and_underlying_codes_without_error_text(self):
        payload = b'An error was encountered processing the command (domain=FBSOpenApplicationServiceErrorDomain, code=1):\nPRIVATE_SENTINEL\nUnderlying error (domain=NSPOSIXErrorDomain, code=2):\nError Domain=FBProcessExit Code=64 PRIVATE_SENTINEL\n'
        result, _, _ = self.exercise(exit_code=1, stderr=payload)
        self.assertEqual(result['command'], 'NONZERO_EXIT')
        self.assertEqual(result['launch_response'], 'UNKNOWN')
        self.assertEqual(result['error_codes']['pairs'], [
            {'domain': 'FBSOpenApplicationServiceErrorDomain', 'code': 1},
            {'domain': 'NSPOSIXErrorDomain', 'code': 2}, {'domain': 'FBProcessExit', 'code': 64}])

    def test_timeout_kills_reaps_owned_group_and_closes_private_output(self):
        result, child, kill = self.exercise(timeout=True)
        self.assertEqual(result['command'], 'TIMEOUT')
        self.assertEqual(child.wait.call_args_list, [mock.call(timeout=20), mock.call(timeout=5)])
        kill.assert_called_once_with(7001, observer.signal.SIGKILL)

    def test_spawn_failure_closes_both_private_files_and_observes_post_state(self):
        result, _, _ = self.exercise(spawn_error=True)
        self.assertEqual(result['command'], 'UNAVAILABLE')
        self.assertEqual(result['after_process'], self.after)

    def test_no_launch_for_successful_foreign_unverified_or_nonlaunch_failures(self):
        variants = [lambda: setattr(self.native, 'original_smoke_failed', False),
            lambda: self.data.update(smoke='PASS'), lambda: self.data.update(installed_artifact_verified=False),
            lambda: self.data['device'].update(id='00000000-0000-0000-0000-000000000000'),
            lambda: self.data['startup_diagnostics']['command_observation']['commands'].update(rows=[{'kind':'ASSERT_CONDITION','status':'FAILED'}])]
        for change in variants:
            self.setUp()
            change()
            with mock.patch.object(observer.subprocess, 'Popen') as launch:
                self.assertEqual(observer.collect(self.native, DEVICE)['state'], 'NOT_ELIGIBLE')
                launch.assert_not_called()

    def test_bounded_unknown_domain_and_invalid_numbers_never_export_untrusted_names(self):
        value = observer.codes(b'Underlying error (domain=PrivateSentinel, code=7):\nError Domain=NSPOSIXErrorDomain Code=2147483648\n' + b'x' * 65536)
        self.assertEqual(value['pairs'], [])
        self.assertTrue(value['unknown_domain_observed'])
        self.assertNotIn('PrivateSentinel', json.dumps(value))
        self.assertTrue(value['input_partial'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(value))

    def test_owned_process_query_is_bounded_and_never_exports_pid(self):
        def run(args, **kwargs):
            self.assertEqual(args, ['xcrun','simctl','spawn',DEVICE,'launchctl','list'])
            self.assertEqual(kwargs['timeout'], 5)
            kwargs['stdout'].write(('PID Status Label\n12345 0 UIKitApplication:'+observer.APP+'[owned]\n').encode())
            return SimpleNamespace(returncode=0)
        with mock.patch.object(observer.subprocess, 'run', side_effect=run):
            result = observer.process(self.private, DEVICE)
        self.assertEqual(result['state'], 'OWNED_RUNNING_ENTRY_OBSERVED')
        self.assertNotIn('12345', json.dumps(result))

class OriginalSmokeFailure(unittest.TestCase):
    def test_actual_smoke_preserves_original_failure_cleanup_and_blocked_later_phases(self):
        fixture = load('direct_launch_integration_fixture', ROOT / 'tests/test_startup_integration.py')
        for diagnostic_raises in (False, True):
            case = fixture.StartupIntegrationTest(methodName='runTest')
            case.setUp()
            original_collect = case.collect
            def collect(*args):
                if len(args) == 3:
                    return original_collect(*args)
                case.events.append('direct-launch-observation')
                context, device = args
                self.assertTrue(context.original_smoke_failed)
                self.assertEqual(context.read()['smoke'], 'NOT RUN')
                if diagnostic_raises:
                    raise RuntimeError('PRIVATE_SENTINEL diagnostic failure')
                return {'state':'OBSERVED','command':'EXIT_ZERO','native_acceptance':False}
            case.observer.collect.side_effect = collect
            try:
                result = case.exercise(platform='IOS', smoke_fails=True)
                self.assertIs(result['error'], case.original_error)
                self.assertEqual(result['metadata']['smoke'], 'FAIL')
                self.assertNotIn('smoke_test_cases', result['metadata'])
                self.assertNotIn('r5_features', result['metadata'])
                self.assertFalse(result['metadata']['ios_direct_launch_observation']['native_acceptance'])
                for before, after in [('failure-diagnostics','capture-collect'),
                        ('capture-stop','direct-launch-observation'),('direct-launch-observation','metro-stop'),
                        ('metro-stop','device-shutdown'),('device-shutdown','device-delete')]:
                    self.assertLess(case.events.index(before),case.events.index(after))
            finally:
                case.doCleanups()

if __name__ == '__main__':
    unittest.main()
