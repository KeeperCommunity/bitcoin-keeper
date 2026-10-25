"""Offline startup-observer lifecycle controls; no emulator or native credit."""

from contextlib import ExitStack
import importlib.util
from pathlib import Path
import re
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    'startup_integration_native', Path(__file__).resolve().parents[1] / 'native/hosted_native.py')
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)


class StartupIntegrationTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.events = []
        self.device = 'emulator-5554'
        self.artifact = {'sha256': 'a' * 64}
        self.metro = mock.Mock(pid=7000)
        self.metro.poll.return_value = None
        self.capture = object()
        self.observer = SimpleNamespace(
            start=mock.Mock(side_effect=self.start),
            collect=mock.Mock(side_effect=self.collect),
            stop=mock.Mock(side_effect=self.stop),
            observe=mock.Mock(),
        )
        self.original_error = RuntimeError('PRIVATE_SENTINEL original smoke failure')
        self.import_error = RuntimeError('PRIVATE_SENTINEL observer import failure')
        self.spawn_error = OSError('PRIVATE_SENTINEL Metro spawn failure')

    def start(self, context, device):
        self.assertEqual(context.PLATFORM, self.expected_platform)
        self.assertEqual(context.PRIVATE, self.root)
        self.assertEqual(device, self.device)
        self.events.append('capture-start')
        return self.capture

    def collect(self, context, device, capture):
        self.assertEqual(device, self.device)
        if capture == self.root / 'features-junit.xml':
            self.events.append('feature-failure-collect')
            data = native.read()
            data['commands'].append({'label': 'fixed failure document read', 'exit_code': 0})
            native.save(data)
            return {'scope': 'failure only', 'native_acceptance': False}
        self.assertIn(capture, [self.capture, None])
        self.events.append('capture-collect')
        return {'scope': 'startup only', 'collection_errors': []}

    def stop(self, capture):
        self.assertIn(capture, [self.capture, None])
        self.events.append('capture-stop')

    def exercise(self, suite='startup', smoke_fails=False, start_fails=False,
                 collect_fails=False, stop_fails=False, platform='ANDROID',
                 import_fails=False, popen_fails=False, receipt_fails=None,
                 cleanup_fails=(), diagnostics_fail=False, install_timeout=False,
                 install_fails=False, readiness_fails=False, create_result=None,
                 installed_proof_fails=False, boot_fails=False):
        captured = {}
        self.expected_platform = platform
        self.device = '12345678-1234-1234-1234-123456789ABC' if platform == 'IOS' else 'emulator-5554'
        original_read, original_save, original_unlink = native.read, native.save, Path.unlink
        original_command = native.command

        def late_read():
            if receipt_fails == 'read' and 'capture-collect' in self.events:
                raise OSError('PRIVATE_SENTINEL receipt read failure')
            return original_read()

        def late_save(value):
            if receipt_fails == 'save' and 'capture-collect' in self.events:
                raise OSError('PRIVATE_SENTINEL receipt write failure')
            return original_save(value)

        def unlink(path, *args, **kwargs):
            if path.name in ['startup-logcat.log', 'startup-observer.jsonl', 'startup-foreground.log', 'ios-startup-errors.log', 'ios-startup-errors-stderr.log'] and 'capture-collect' in self.events:
                self.events.append('purge-' + path.name)
                if 'purge' in cleanup_fails:
                    raise OSError('PRIVATE_SENTINEL purge failure')
            return original_unlink(path, *args, **kwargs)

        def command(args, label, **kwargs):
            captured.setdefault('command_calls', []).append((args, label, kwargs))
            self.events.append('command-' + label)
            if label == 'Wait for simulator boot' and boot_fails:
                raise self.original_error
            if label == 'Install unsigned development app':
                captured['install_command_count'] = captured.get('install_command_count', 0) + 1
                captured['install_args'], captured['install_options'] = args, kwargs
                if install_fails:
                    raise self.original_error
                if install_timeout:
                    return original_command(args, label, **kwargs)
            if label == 'Identify fresh emulator':
                return self.device
            if label == 'Record actual adb version':
                return 'Android Debug Bridge version 1.0.41'
            if label == 'Record Android emulator image':
                return 'fixed-disposable-image'
            if label == 'Create fresh iPhone 16 iOS 18.5 simulator':
                return self.device if create_result is None else create_result
            if label.startswith('Assert '):
                self.events.append('maestro')
                captured['flow'] = args[-1]
                captured['maestro_args'], captured['maestro_options'] = args, kwargs
                if smoke_fails:
                    raise self.original_error

        def popen(args, **kwargs):
            if args[:3] == ['xcrun', 'simctl', 'install']:
                process = mock.Mock(pid=7001)
                process.wait.side_effect = [native.subprocess.TimeoutExpired(args, 120), 0]
                captured.setdefault('install_processes', []).append(process)
                return process
            captured['metro_args'] = args
            captured['metro_options'] = kwargs
            if popen_fails:
                raise self.spawn_error
            return self.metro

        original_open = Path.open

        def track_output(path, *args, **kwargs):
            handle = original_open(path, *args, **kwargs)
            if path == self.root / 'metro.log':
                if 'metro-output' in cleanup_fails:
                    real_handle = handle
                    class FailingClose:
                        @property
                        def closed(self):
                            return real_handle.closed

                        def close(self):
                            real_handle.close()
                            raise OSError('PRIVATE_SENTINEL Metro output close failure')
                    handle = FailingClose()
                captured['metro_output'] = handle
            return handle

        def load_observer(module):
            if import_fails:
                raise self.import_error

        def observe_install(context, device, args, label, **kwargs):
            self.events.append('install-observe')
            self.assertEqual(device, '12345678-1234-1234-1234-123456789ABC')
            self.assertEqual(context.PRIVATE, self.root)
            return context.command(args, label, **kwargs)

        self.observer.observe.side_effect = observe_install

        def ready(device):
            self.events.append('app-services-ready')
            if readiness_fails:
                raise self.original_error

        def installed_proof(device):
            self.events.append('installed-proof')
            if installed_proof_fails:
                raise self.original_error

        def dispose(args, **kwargs):
            event = 'device-' + args[2] if args[0] == 'xcrun' else 'device-uninstall'
            self.events.append(event)
            if event in cleanup_fails:
                raise OSError('PRIVATE_SENTINEL disposal failure')
            return SimpleNamespace(returncode=0)

        def kill_metro(*args):
            if args[0] == 7001:
                self.events.append('install-kill')
                return
            self.events.append('metro-stop')
            if 'metro-stop' in cleanup_fails:
                raise OSError('PRIVATE_SENTINEL Metro cleanup failure')

        def failure_diagnostics(*args):
            self.events.append('failure-diagnostics')
            if diagnostics_fail:
                raise OSError('PRIVATE_SENTINEL diagnostics failure')

        def fail_start(*args):
            self.events.append('capture-start')
            raise OSError('PRIVATE_SENTINEL start failure')

        def fail_collect(*args):
            self.events.append('capture-collect')
            raise OSError('PRIVATE_SENTINEL collection failure')

        def fail_stop(*args):
            self.events.append('capture-stop')
            raise OSError('PRIVATE_SENTINEL stop failure')

        if start_fails:
            self.observer.start.side_effect = fail_start
        if collect_fails:
            self.observer.collect.side_effect = fail_collect
        if stop_fails:
            self.observer.stop.side_effect = fail_stop
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'packager-status:running'
        loader = SimpleNamespace(exec_module=load_observer)
        with ExitStack() as stack:
            # A failed assertion must never render the worker's inherited env.
            stack.enter_context(mock.patch.dict(native.os.environ, {'KEEPER_PUBLIC_TEST_ENV': 'fixture'}, clear=True))
            stack.enter_context(mock.patch.multiple(native, PRIVATE=self.root, EVIDENCE=self.root / 'metadata.json',
                                                    ROOT=self.root, PLATFORM=platform))
            native.save({'commands': [], 'build': 'PASS', 'smoke': 'PASS' if suite != 'startup' else 'NOT RUN',
                         'built_artifact': self.artifact, 'toolchain': {}, 'maestro': {'binary': 'fixed-maestro'}})
            patches = [
                (native, 'command', command),
                (native, 'artifact_identity', lambda: self.artifact),
                (native, 'verify_installed_artifact', installed_proof),
                (native, 'android_sdk_metadata', lambda *args: {'version': 'fixed'}),
                (native, 'warm_metro_bundle', lambda suite: self.events.append('warm-' + suite)),
                (native, 'wait_for_simulator_app_services', ready),
                (native, 'successful_junit', lambda report: 1),
                (native, 'record_startup_failure', failure_diagnostics),
                (native, 'collect_r5_feature_evidence', lambda device: {'status': 'PASS'}),
                (native.subprocess, 'Popen', popen),
                (native.subprocess, 'run', dispose),
                (native.urllib.request, 'urlopen', lambda *args, **kwargs: response),
                (native.os, 'killpg', kill_metro),
                (native.Path, 'open', track_output),
                (native.Path, 'unlink', unlink),
                (native, 'read', late_read),
                (native, 'save', late_save),
                (native.importlib.util, 'spec_from_file_location', lambda *args: SimpleNamespace(loader=loader)),
                (native.importlib.util, 'module_from_spec', lambda *args: self.observer),
            ]
            for owner, name, replacement in patches:
                stack.enter_context(mock.patch.object(owner, name, replacement))
            try:
                native.smoke(suite)
            except Exception as error:
                captured['error'] = error
            captured['metadata'] = original_read()
        return captured

    def test_android_capture_stays_inside_owned_startup_and_all_resources_close(self):
        value = self.exercise()
        self.assertNotIn('error', value)
        self.assertEqual(value['metadata']['smoke'], 'PASS')
        self.assertEqual(value['metadata']['startup_observation']['scope'], 'startup only')
        self.assertEqual(value['flow'], '.github/native/startup.yaml')
        self.assertIn('--client-logs', value['metro_args'])
        self.assertEqual(value['metro_args'][-4:], [
            '--config', str(self.root / '.github/native/startup_observer.cjs'),
            '--custom-log-reporter-path', str(self.root / '.github/native/startup_reporter.cjs'),
        ])
        self.assertEqual(value['metro_options']['env']['KEEPER_STARTUP_OBSERVER_PATH'],
                         str(self.root / 'startup-observer.jsonl'))
        for before, after in [('capture-start', 'maestro'), ('maestro', 'capture-collect'),
                              ('capture-collect', 'capture-stop'), ('capture-stop', 'metro-stop'),
                              ('metro-stop', 'device-uninstall')]:
            self.assertLess(self.events.index(before), self.events.index(after))
        self.assertTrue(value['metro_options']['stdout'].closed)

    def test_feature_failure_capture_preserves_original_error_commands_and_disposal(self):
        value = self.exercise(suite='features', smoke_fails=True)
        self.assertIs(value['error'], self.original_error)
        self.assertEqual(value['metadata']['r5_features'], 'FAIL')
        self.assertFalse(value['metadata']['r5_feature_failure_observation']['native_acceptance'])
        self.assertEqual(value['metadata']['commands'][-1]['label'], 'fixed failure document read')
        self.assertLess(self.events.index('feature-failure-collect'), self.events.index('device-uninstall'))
        self.assertEqual(value['maestro_options'], {'timeout': 660, 'error_details': False})
        self.assertEqual(self.events.count('maestro'), 1)
        self.assertNotIn('r5_feature_evidence', value['metadata'])
        self.assertIn('metro-stop', self.events)

    def test_feature_capture_error_does_not_replace_failure_or_skip_cleanup(self):
        value = self.exercise(suite='features', smoke_fails=True, collect_fails=True)
        self.assertIs(value['error'], self.original_error)
        self.assertEqual(value['metadata']['r5_features'], 'FAIL')
        self.assertEqual(value['metadata']['r5_feature_failure_observation'],
                         {'state': 'UNAVAILABLE', 'native_acceptance': False})
        self.assertIn('metro-stop', self.events)
        self.assertIn('device-uninstall', self.events)

    def test_feature_observer_is_absent_from_success_and_native_probe_failure(self):
        for suite, fails in [('features', False), ('probe', True)]:
            self.events.clear()
            value = self.exercise(suite=suite, smoke_fails=fails)
            self.assertNotIn('feature-failure-collect', self.events)
            self.assertNotIn('r5_feature_failure_observation', value['metadata'])

    def test_capture_failure_is_optional_but_collection_and_disposal_still_happen(self):
        value = self.exercise(collect_fails=True)
        self.assertNotIn('error', value)
        self.assertEqual(value['metadata']['smoke'], 'PASS')
        self.assertEqual(value['metadata']['startup_observation'], {'collection_errors': ['collector']})
        self.assertNotIn('startup_observation_cleanup', value['metadata'])
        self.assertIn('capture-stop', self.events)
        self.assertIn('metro-stop', self.events)
        self.assertIn('device-uninstall', self.events)
        self.assertNotIn('PRIVATE_SENTINEL', str(value['metadata']))

    def test_failed_capture_start_keeps_the_real_smoke_outcome_and_closes_other_resources(self):
        value = self.exercise(start_fails=True)
        self.assertNotIn('error', value)
        self.assertEqual(value['metadata']['smoke'], 'PASS')
        self.assertEqual(value['metadata']['startup_observation_capture'], 'UNAVAILABLE')
        self.observer.collect.assert_called_once()
        self.observer.stop.assert_called_once_with(None)
        self.assertIn('metro-stop', self.events)
        self.assertIn('device-uninstall', self.events)
        self.assertTrue(value['metro_options']['stdout'].closed)
        self.assertNotIn('PRIVATE_SENTINEL', str(value['metadata']))

    def test_original_smoke_failure_survives_observer_and_cleanup_failures(self):
        value = self.exercise(smoke_fails=True, collect_fails=True, stop_fails=True)
        self.assertIs(value['error'], self.original_error)
        self.assertEqual(value['metadata']['startup_observation_cleanup'], 'FAIL')
        self.assertIn('metro-stop', self.events)
        self.assertIn('device-uninstall', self.events)

    def test_observer_import_or_metro_spawn_failure_closes_output_before_any_device_work(self):
        for option in ['import_fails', 'popen_fails']:
            with self.subTest(option=option):
                self.events.clear()
                value = self.exercise(**{option: True})
                self.assertIsNotNone(value.get('error'))
                self.assertTrue(value['metro_output'].closed)
                self.assertEqual(self.events, [])
                self.assertEqual(value['metadata']['smoke'], 'NOT RUN')
                self.assertNotIn('startup_observation', value['metadata'])
                self.assertNotIn('PRIVATE_SENTINEL', str(value['metadata']))
        self.assertTrue(value['metro_options']['stdout'].closed)
        self.assertNotIn('PRIVATE_SENTINEL', str(value['metadata']))

    def test_unstopped_capture_cannot_allow_a_successful_phase_to_continue(self):
        value = self.exercise(stop_fails=True)
        self.assertIsNotNone(value.get('error'), 'an unconfirmed live capture must block subsequent feature/account probes')
        self.assertEqual(value['metadata']['startup_observation_cleanup'], 'FAIL')
        self.assertEqual(value['metadata']['smoke'], 'FAIL')
        self.assertIn('metro-stop', self.events)
        self.assertIn('device-uninstall', self.events)

    def test_early_close_failure_preserves_exact_import_or_spawn_error(self):
        for option, expected in [('import_fails', self.import_error), ('popen_fails', self.spawn_error)]:
            with self.subTest(option=option):
                self.events.clear()
                value = self.exercise(**{option: True}, cleanup_fails=('metro-output',))
                self.assertIs(value['error'], expected)
                self.assertTrue(value['metro_output'].closed)
                self.assertEqual(self.events, [])

    def test_ios_install_timeout_still_fails_once_before_any_app_or_junit_credit(self):
        value = self.exercise(platform='IOS', install_timeout=True)
        self.assertIsInstance(value['error'], RuntimeError)
        self.assertIn('exit 124', str(value['error']))
        self.assertEqual(len(value['install_processes']), 1)
        self.assertEqual(value['install_processes'][0].wait.call_args_list,
                         [mock.call(timeout=120), mock.call()])
        entry = value['metadata']['commands'][0]
        self.assertEqual((entry['label'], entry['timeout_seconds'], entry['exit_code']),
                         ('Install unsigned development app', 120, 124))
        self.assertEqual(value['metadata']['smoke'], 'FAIL')
        for field in ['install_succeeded', 'installed_artifact_verified', 'smoke_test_cases']:
            self.assertNotIn(field, value['metadata'])
        for event in ['maestro', 'installed-proof']:
            self.assertNotIn(event, self.events)
        self.assertNotIn('flow', value)
        self.assertEqual(self.events.count('install-kill'), 1)
        self.assertIn('device-shutdown', self.events)
        self.assertIn('device-delete', self.events)
        self.assertTrue(value['metro_output'].closed)

    def test_ios_install_success_keeps_exact_bytes_and_default_passcode_flow(self):
        value = self.exercise(platform='IOS')
        self.assertNotIn('error', value)
        self.assertEqual(value['install_options']['timeout'], 120)
        self.assertEqual(value['install_args'][:3], ['xcrun', 'simctl', 'install'])
        self.assertEqual(value['flow'], '.github/native/startup.yaml')
        self.assertEqual(self.events.count('installed-proof'), 2)
        self.assertEqual(value['metadata']['smoke'], 'PASS')
        self.assertEqual(value['metadata']['startup_observation']['scope'], 'startup only')
        self.assertEqual(value['maestro_options'], {'timeout': 420, 'error_details': True})
        self.assertEqual(self.events.count('maestro'), 1)
        self.assertLess(self.events.index('installed-proof'), self.events.index('capture-start'))
        self.assertLess(self.events.index('capture-start'), self.events.index('maestro'))
        self.assertLess(self.events.index('maestro'), self.events.index('capture-collect'))
        self.assertLess(self.events.index('capture-collect'), self.events.index('device-shutdown'))
        self.assertEqual(value['metro_args'][-4:], [
            '--config', str(self.root / '.github/native/startup_observer.cjs'),
            '--custom-log-reporter-path', str(self.root / '.github/native/startup_reporter.cjs')])

    def test_first_ios_launch_uses_the_original_install_on_its_new_owned_simulator(self):
        value = self.exercise(platform='IOS')
        self.assertNotIn('error', value)
        commands = value['command_calls']
        created = [args for args, _, _ in commands if args[:3] == ['xcrun', 'simctl', 'create']]
        self.assertEqual(len(created), 1)
        self.assertEqual(created[0][3:], ['Keeper-disposable-ci',
            'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
            'com.apple.CoreSimulator.SimRuntime.iOS-18-5'])
        for action in ['boot', 'bootstatus', 'install']:
            calls = [args for args, _, _ in commands if args[:3] == ['xcrun', 'simctl', action]]
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][3], self.device)
        self.assertEqual(value['metadata']['device']['id'], self.device)
        self.assertIs(value['metadata']['device']['fresh_disposable_state'], True)
        for before, after in [
                ('command-Create fresh iPhone 16 iOS 18.5 simulator', 'command-Boot disposable simulator'),
                ('command-Boot disposable simulator', 'command-Wait for simulator boot'),
                ('command-Wait for simulator boot', 'app-services-ready'),
                ('app-services-ready', 'install-observe'), ('install-observe', 'installed-proof'),
                ('installed-proof', 'maestro'), ('maestro', 'device-shutdown'),
                ('device-shutdown', 'device-delete')]:
            self.assertLess(self.events.index(before), self.events.index(after))
        flow = Path(__file__).resolve().parents[1] / 'native/startup.yaml'
        text = flow.read_text()
        # This bounded source contract covers only the two launch branches;
        # actual simctl/install/attestation order is executed above.
        branches = re.findall(r'- runFlow:\n    when:\n      platform: (iOS|Android)\n'
            r'    commands:\n      - launchApp:\n          clearState: (false|true)\n'
            r'          permissions:\n            all: deny\n', text)
        self.assertEqual(branches, [('iOS', 'false'), ('Android', 'true')])
        self.assertEqual(text.count('launchApp:'), 2)
        self.assertEqual(text.count('clearState:'), 2)
        self.assertNotIn('optional:', text)
        self.assertEqual(value['maestro_options'], {'timeout': 420, 'error_details': True})

    def test_invalid_creation_cannot_reuse_or_dispose_an_existing_simulator(self):
        for created in ['booted', 'existing-device', '', '12345678-1234-1234-1234-123456789ABC\n']:
            with self.subTest(created=created):
                self.events.clear()
                value = self.exercise(platform='IOS', create_result=created)
                self.assertIsInstance(value['error'], ValueError)
                self.assertNotIn('maestro', self.events)
                self.assertNotIn('install-observe', self.events)
                self.assertNotIn('installed-proof', self.events)
                self.assertNotIn('device-shutdown', self.events)
                self.assertNotIn('device-delete', self.events)

    def test_original_installed_byte_failure_blocks_the_no_clear_ios_launch(self):
        value = self.exercise(platform='IOS', installed_proof_fails=True)
        self.assertIs(value['error'], self.original_error)
        self.assertNotIn('maestro', self.events)
        self.assertNotIn('smoke_test_cases', value['metadata'])
        self.assertEqual(value['metadata']['smoke'], 'FAIL')
        self.assertIn('device-shutdown', self.events)
        self.assertIn('device-delete', self.events)

    def test_ios_install_observation_delegates_once_after_readiness_before_proof_and_ui(self):
        value = self.exercise(platform='IOS')
        self.assertNotIn('error', value)
        self.observer.observe.assert_called_once()
        self.assertEqual(value['install_command_count'], 1)
        self.assertEqual(value['install_args'], [
            'xcrun', 'simctl', 'install', '12345678-1234-1234-1234-123456789ABC',
            str(self.root / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'),
        ])
        self.assertEqual(value['install_options'], {'timeout': 120})
        self.assertLess(self.events.index('app-services-ready'), self.events.index('install-observe'))
        self.assertLess(self.events.index('install-observe'), self.events.index('installed-proof'))
        self.assertLess(self.events.index('installed-proof'), self.events.index('capture-start'))
        self.assertLess(self.events.index('capture-start'), self.events.index('maestro'))
        self.assertIn('device-shutdown', self.events)
        self.assertIn('device-delete', self.events)

    def test_ios_install_failure_preserves_original_error_and_cleanup_without_ui_credit(self):
        value = self.exercise(platform='IOS', install_fails=True)
        self.assertIs(value['error'], self.original_error)
        self.assertEqual(value['install_command_count'], 1)
        self.assertNotIn('installed-proof', self.events)
        self.assertNotIn('maestro', self.events)
        self.assertIn('failure-diagnostics', self.events)
        self.assertIn('metro-stop', self.events)
        self.assertIn('device-shutdown', self.events)
        self.assertIn('device-delete', self.events)
        self.assertTrue(value['metro_output'].closed)

    def test_ios_unresponsive_app_services_block_install_and_ui_but_still_clean_up(self):
        value = self.exercise(platform='IOS', readiness_fails=True)
        self.assertIs(value['error'], self.original_error)
        self.observer.observe.assert_not_called()
        self.assertNotIn('install_command_count', value)
        self.assertNotIn('installed-proof', self.events)
        self.assertNotIn('maestro', self.events)
        self.assertIn('device-shutdown', self.events)
        self.assertIn('device-delete', self.events)
        self.assertTrue(value['metro_output'].closed)

    def test_ios_probe_and_features_keep_direct_single_install_after_readiness(self):
        for suite in ['probe', 'features']:
            with self.subTest(suite=suite):
                self.events.clear()
                self.observer.observe.reset_mock()
                value = self.exercise(platform='IOS', suite=suite)
                self.assertNotIn('error', value)
                self.observer.observe.assert_not_called()
                self.assertEqual(value['install_command_count'], 1)
                self.assertEqual(value['install_options'], {'timeout': 120})
                self.assertLess(self.events.index('app-services-ready'), self.events.index('installed-proof'))

    def test_ios_companions_preserve_the_original_install_on_their_own_new_simulator(self):
        for suite, flow in [('probe', 'release_probe.yaml'), ('features', 'r5_features.yaml')]:
            with self.subTest(suite=suite):
                self.events.clear()
                value = self.exercise(platform='IOS', suite=suite)
                self.assertNotIn('error', value)
                self.assertEqual(value['flow'], '.github/native/' + flow)
                commands = value['command_calls']
                self.assertEqual(sum(args[:3] == ['xcrun', 'simctl', 'create']
                                     for args, _, _ in commands), 1)
                self.assertEqual(value['install_command_count'], 1)
                self.assertEqual(value['install_args'][3], self.device)
                self.assertEqual(value['metadata']['device']['id'], self.device)
                self.assertIs(value['metadata']['device']['fresh_disposable_state'], True)
                for before, after in [
                        ('command-Create fresh iPhone 16 iOS 18.5 simulator', 'command-Boot disposable simulator'),
                        ('command-Boot disposable simulator', 'command-Wait for simulator boot'),
                        ('command-Wait for simulator boot', 'app-services-ready'),
                        ('app-services-ready', 'command-Install unsigned development app'),
                        ('command-Install unsigned development app', 'installed-proof'),
                        ('installed-proof', 'maestro'), ('maestro', 'device-shutdown'),
                        ('device-shutdown', 'device-delete')]:
                    self.assertLess(self.events.index(before), self.events.index(after))
                self.assertEqual(self.events.count('installed-proof'), 2)
                text = (Path(__file__).resolve().parents[1] / 'native' / flow).read_text()
                branches = re.findall(r'- runFlow:\n    when:\n      platform: (iOS|Android)\n'
                    r'    commands:\n      - launchApp:\n          clearState: (false|true)\n'
                    r'          permissions:\n            all: deny\n', text)
                self.assertEqual(branches, [('iOS', 'false'), ('Android', 'true')])
                tail = text[text.index('- extendedWaitUntil:'):]
                self.assertNotIn('clearState: true', tail)
                self.assertNotIn('optional:', text)
                self.assertEqual(value['maestro_options'], {
                    'timeout': 300 if suite == 'probe' else 660, 'error_details': False})

    def test_ios_companions_reject_a_reused_device_alias_before_installation(self):
        for suite in ['probe', 'features']:
            with self.subTest(suite=suite):
                self.events.clear()
                value = self.exercise(platform='IOS', suite=suite, create_result='booted')
                self.assertIsInstance(value['error'], ValueError)
                for event in ['installed-proof', 'maestro', 'device-shutdown', 'device-delete']:
                    self.assertNotIn(event, self.events)
                self.assertNotIn('install_command_count', value)

    def test_receipt_failures_preserve_primary_and_do_not_skip_any_disposal(self):
        for boundary in ['read', 'save']:
            for primary in [True, False]:
                with self.subTest(boundary=boundary, primary=primary):
                    self.events.clear()
                    value = self.exercise(smoke_fails=primary, receipt_fails=boundary,
                                          stop_fails=True, cleanup_fails=('metro-stop', 'metro-output', 'device-uninstall', 'purge'),
                                          diagnostics_fail=True)
                    if primary:
                        self.assertIs(value['error'], self.original_error)
                    else:
                        self.assertIsInstance(value['error'], RuntimeError)
                        self.assertNotIn('PRIVATE_SENTINEL', str(value['error']))
                    for event in ['capture-stop', 'metro-stop', 'device-uninstall',
                                  'purge-startup-logcat.log', 'purge-startup-observer.jsonl',
                                  'purge-startup-foreground.log']:
                        self.assertEqual(self.events.count(event), 1)
                    self.assertTrue(value['metro_output'].closed)

    def test_raw_purge_failure_blocks_a_successful_phase_after_other_cleanup(self):
        value = self.exercise(cleanup_fails=('purge',))
        self.assertIsInstance(value.get('error'), RuntimeError)
        self.assertEqual(value['metadata']['smoke'], 'FAIL')
        self.assertEqual(value['metadata']['startup_cleanup_errors'],
                         ['private_startup-logcat', 'private_startup-observer', 'private_startup-foreground'])
        self.assertIn('capture-stop', self.events)
        self.assertIn('device-uninstall', self.events)
        self.assertTrue(value['metro_output'].closed)

    def test_cleanup_failures_fail_closed_and_keep_attempting_ios_delete(self):
        for primary in [True, False]:
            with self.subTest(primary=primary):
                self.events.clear()
                value = self.exercise(platform='IOS', smoke_fails=primary,
                                      cleanup_fails=('metro-stop', 'device-shutdown', 'device-delete'))
                if primary:
                    self.assertIs(value['error'], self.original_error)
                else:
                    self.assertIsInstance(value['error'], RuntimeError)
                self.assertEqual(value['metadata']['smoke'], 'FAIL')
                self.assertEqual(value['metadata']['startup_cleanup_errors'],
                                 ['metro_process', 'device_shutdown', 'device_delete'])
                self.assertTrue(value['metro_output'].closed)
                self.assertLess(self.events.index('device-shutdown'), self.events.index('device-delete'))

    def test_only_observer_raw_files_are_purged_after_collection(self):
        observer_names = ['startup-logcat.log', 'startup-observer.jsonl', 'startup-foreground.log']
        for name in [*observer_names, 'build-artifact', 'maestro.zip']:
            (self.root / name).write_text('PRIVATE_SENTINEL')
        value = self.exercise()
        self.assertNotIn('error', value)
        for name in observer_names:
            self.assertFalse((self.root / name).exists())
            self.assertGreater(self.events.index('purge-' + name), self.events.index('capture-stop'))
        for name in ['build-artifact', 'maestro.zip']:
            self.assertTrue((self.root / name).exists())

    def test_probes_preserve_their_existing_metro_configuration_without_observation(self):
        for suite, platform, config in [('probe', 'ANDROID', 'release_metro.cjs'),
                                         ('features', 'ANDROID', 'r5_metro.cjs'),
                                         ('probe', 'IOS', 'release_metro.cjs'),
                                         ('features', 'IOS', 'r5_metro.cjs')]:
            with self.subTest(suite=suite, platform=platform):
                self.events.clear()
                value = self.exercise(suite=suite, platform=platform)
                self.assertNotIn('error', value)
                self.assertNotIn('capture-start', self.events)
                self.assertNotIn('startup_observation', value['metadata'])
                if config:
                    self.assertNotIn('--client-logs', value['metro_args'])
                    self.assertEqual(value['metro_args'][-2:], ['--config', str(self.root / '.github/native' / config)])
                else:
                    self.assertNotIn('--config', value['metro_args'])

    def test_ios_normal_startup_uses_observer_without_changing_ui_or_deadlines(self):
        value = self.exercise(platform='IOS')
        self.assertNotIn('error', value)
        self.assertEqual(value['metro_args'], [
            'node', 'node_modules/react-native/cli.js', 'start', '--port', '8081',
            '--client-logs', '--config', str(self.root / '.github/native/startup_observer.cjs'),
            '--custom-log-reporter-path', str(self.root / '.github/native/startup_reporter.cjs')])
        self.assertEqual(value['metro_options']['env'], {
            'KEEPER_PUBLIC_TEST_ENV': 'fixture',
            'KEEPER_STARTUP_OBSERVER_PATH': str(self.root / 'startup-observer.jsonl')})
        self.assertEqual(value['install_options'], {'timeout': 120})
        self.assertEqual(value['flow'], '.github/native/startup.yaml')
        self.assertEqual(self.events.count('installed-proof'), 2)
        self.assertLess(self.events.index('maestro'), self.events.index('capture-collect'))
        self.assertLess(self.events.index('capture-collect'), self.events.index('capture-stop'))
        self.assertLess(self.events.index('capture-stop'), self.events.index('metro-stop'))

    def test_ios_private_collection_and_receipt_failures_preserve_primary_and_all_disposal(self):
        observer_names = ['startup-logcat.log', 'startup-observer.jsonl', 'startup-foreground.log',
                          'ios-startup-errors.log', 'ios-startup-errors-stderr.log']
        for boundary in [None, 'read', 'save']:
            with self.subTest(boundary=boundary):
                self.events.clear()
                value = self.exercise(platform='IOS', smoke_fails=True, receipt_fails=boundary,
                                      collect_fails=True, stop_fails=True,
                                      cleanup_fails=('metro-stop', 'metro-output', 'device-shutdown', 'device-delete', 'purge'))
                self.assertIs(value['error'], self.original_error)
                for event in ['capture-stop', 'metro-stop', 'device-shutdown', 'device-delete',
                              *['purge-'+name for name in observer_names]]:
                    self.assertEqual(self.events.count(event), 1)
                self.assertTrue(value['metro_output'].closed)
                self.assertNotIn('PRIVATE_SENTINEL', str(value['metadata']))

    def test_ios_missing_observation_never_changes_real_outcome_or_skips_log_purge(self):
        for primary in [False, True]:
            with self.subTest(primary=primary):
                self.events.clear()
                for name in ['ios-startup-errors.log', 'ios-startup-errors-stderr.log']:
                    (self.root/name).write_text('PRIVATE_SENTINEL')
                value = self.exercise(platform='IOS', smoke_fails=primary, start_fails=True, collect_fails=True)
                self.assertEqual(value['metadata']['smoke'], 'FAIL' if primary else 'PASS')
                self.assertEqual(value['metadata']['startup_observation_capture'], 'UNAVAILABLE')
                self.assertEqual(value['metadata']['startup_observation'], {'collection_errors': ['collector']})
                for name in ['ios-startup-errors.log', 'ios-startup-errors-stderr.log']:
                    self.assertFalse((self.root/name).exists())
                self.assertIn('device-shutdown', self.events)
                self.assertIn('device-delete', self.events)
                if primary:
                    self.assertIs(value['error'], self.original_error)


if __name__ == '__main__':
    unittest.main()
