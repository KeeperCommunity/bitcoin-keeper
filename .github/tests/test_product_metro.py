"""Owned host process/flow boundaries; no native application acceptance."""
import contextlib
import importlib.util
import copy
import hashlib
import json
from pathlib import Path
import signal
import subprocess
import tempfile
import types
import unittest
from unittest import mock

NATIVE = Path(__file__).resolve().parents[1] / 'native'


def load(name):
    spec = importlib.util.spec_from_file_location(name, NATIVE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


metro = load('product_metro')
product = load('product_measurements')


class MetroTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.private = Path(directory.name)
        self.h = types.SimpleNamespace(ROOT=NATIVE.parents[1], PLATFORM='ANDROID',
            APP_IDS={'ANDROID': 'owned.app'}, warm_metro_bundle=mock.Mock(),
            successful_junit=mock.Mock(return_value=1))
        self.children, self.spawn_args = [], []

        def spawn(args, **kwargs):
            child = mock.Mock(pid=10000 + len(self.children))
            child.poll.return_value = None
            self.children.append(child)
            self.spawn_args.append((args, kwargs))
            return child
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        self.spawn = stack.enter_context(mock.patch.object(metro.subprocess, 'Popen', side_effect=spawn))
        self.kill = stack.enter_context(mock.patch.object(metro.os, 'killpg'))
        stack.enter_context(mock.patch.object(metro.time, 'sleep'))
        self.port = stack.enter_context(mock.patch.object(metro.OwnedMetro, 'port_occupied', return_value=False))
        self.status = stack.enter_context(mock.patch.object(metro.urllib.request, 'urlopen'))
        reply = self.status.return_value.__enter__.return_value
        reply.status, reply.read.return_value = 200, b'packager-status:running'
        self.manager = metro.OwnedMetro(self.h, self.private)

    def test_fixed_bundle_switches_scrub_fixture_env_and_keep_phase_specific_warmups(self):
        with mock.patch.dict(metro.os.environ, {'KEEPER_CREDENTIAL_FIXTURE_PHASE': 'restore'}):
            self.manager.start('product', initial=True)
            with self.assertRaisesRegex(RuntimeError, 'STOPPED_JUNIT'):
                self.manager.switch('arm')
            for phase in ('arm', 'product', 'history_seed_stale', 'product'):
                self.manager.app_stopped = True  # facade-owned grant tested below
                self.manager.switch(phase)
        for (args, kwargs), phase in zip(self.spawn_args,
                ('product', 'arm', 'product', 'history_seed_stale', 'product')):
            self.assertTrue(kwargs['start_new_session'])
            self.assertEqual(kwargs['env'].get('KEEPER_CREDENTIAL_FIXTURE_PHASE'),
                             'arm' if phase == 'arm' else None)
            self.assertEqual('--config' in args, phase != 'product')
        self.assertEqual(self.h.warm_metro_bundle.call_args_list,
            [mock.call('startup'), mock.call('product_ui_arm'), mock.call('product_ui_product'),
             mock.call('product_ui_history_seed_stale'), mock.call('product_ui_product')])
        self.manager.close()
        self.assertTrue(all(child.wait.called for child in self.children))

    def test_foreign_listener_arbitrary_phase_and_unowned_process_are_never_adopted_or_killed(self):
        self.port.return_value = True
        with self.assertRaisesRegex(RuntimeError, 'PORT_OCCUPIED'):
            self.manager.start('product', initial=True)
        with self.assertRaisesRegex(RuntimeError, 'PHASE_REJECTED'):
            self.manager.switch('../index.js')
        with self.assertRaisesRegex(RuntimeError, 'UNOWNED_PROCESS'):
            self.manager.stop(mock.Mock(pid=1))
        self.spawn.assert_not_called()
        self.kill.assert_not_called()

    def test_latest_child_is_retained_for_cleanup_when_readiness_warmup_or_spawn_fails(self):
        for failure in ('readiness', 'warmup', 'spawn'):
            with self.subTest(failure=failure):
                manager = metro.OwnedMetro(self.h, self.private)
                self.h.warm_metro_bundle.side_effect = RuntimeError('private') if failure == 'warmup' else None
                self.status.side_effect = OSError() if failure == 'readiness' else None
                if failure == 'spawn':
                    self.spawn.side_effect = OSError('private')
                with self.assertRaises((RuntimeError, OSError)):
                    manager.start('product', initial=True)
                manager.close()
                if failure != 'spawn':
                    self.assertIs(manager.process, manager.owned[-1])
                    self.assertTrue(manager.process.wait.called)
                    self.assertEqual(manager.events[-1]['status'], 'FAIL')

    def test_timeout_escalates_and_waits_after_kill_and_cleanup_still_visits_every_owned_child(self):
        self.manager.start('product', initial=True)
        first = self.children[0]
        first.wait.side_effect = [subprocess.TimeoutExpired('owned', 10), 0]
        self.manager.app_stopped = True
        self.manager.switch('arm')
        first.wait.assert_has_calls([mock.call(timeout=10), mock.call(timeout=10)])
        self.assertIn(mock.call(first.pid, signal.SIGKILL), self.kill.call_args_list)
        second = self.children[-1]
        second.wait.side_effect = RuntimeError('private')
        with self.assertRaisesRegex(RuntimeError, 'CLEANUP_FAILED'):
            self.manager.close()
        self.assertTrue(second.wait.called)

    def test_failed_replacement_start_keeps_both_owned_handles_for_final_cleanup(self):
        self.manager.start('product', initial=True)
        first = self.children[0]
        self.manager.app_stopped = True
        self.h.warm_metro_bundle.side_effect = RuntimeError('private')
        with self.assertRaises(RuntimeError):
            self.manager.switch('arm')
        self.assertEqual(len(self.manager.owned), 2)
        self.assertIs(self.manager.process, self.children[-1])
        self.manager.close()
        self.assertTrue(first.wait.called)
        self.assertTrue(self.children[-1].wait.called)

    def test_flow_facade_requires_matching_new_successful_junit_and_reviewed_final_stop(self):
        self.manager.start('product', initial=True)
        data = {'maestro': {'binary': 'owned-maestro'}}
        report = self.private / 'flow.xml'
        report.write_text('stale')

        def command(_args, _label, **_kwargs):
            self.assertFalse(report.exists(), 'stale report must be removed before invocation')
            report.write_text('new')
        self.h.command = mock.Mock(side_effect=command)
        facade = metro.StoppedFlowHarness(self.h, data, 'emulator-5554', self.private, self.manager, set())
        args = ['owned-maestro', '--device', 'emulator-5554', 'test', '--env', 'APP_ID=owned.app',
                '--output', str(report), '--debug-output', str(self.private),
                '--test-output-dir', str(self.private), '--format', 'junit',
                '.github/native/product_key_acceptance.yaml']
        facade.command(args, 'fixed', error_details=False)
        self.assertFalse(self.manager.app_stopped)
        with self.assertRaisesRegex(RuntimeError, 'MATCHING_JUNIT'):
            facade.successful_junit(self.private / 'other.xml')
        self.h.successful_junit.side_effect = RuntimeError('failed junit')
        with self.assertRaises(RuntimeError):
            facade.successful_junit(report)
        self.assertFalse(self.manager.app_stopped)
        with self.assertRaisesRegex(RuntimeError, 'MATCHING_JUNIT'):
            facade.successful_junit(report)
        self.h.successful_junit.side_effect = None
        facade.command(args, 'fixed', error_details=False)
        facade.successful_junit(report)
        self.assertTrue(self.manager.app_stopped)
        self.manager.switch('arm')
        self.assertFalse(self.manager.app_stopped)
        for changed in (args[:2] + ['another-device'] + args[3:],
                        args[:-1] + ['.github/native/unknown.yaml']):
            with self.assertRaisesRegex(RuntimeError, 'REVIEWED_FLOW'):
                facade.command(changed, 'fixed', error_details=False)
        self.manager.phase = 'product'
        outside = args.copy()
        outside[outside.index('--debug-output') + 1] = '/tmp'
        with self.assertRaisesRegex(RuntimeError, 'PRIVATE_OUTPUT'):
            facade.command(outside, 'fixed', error_details=False)
        self.h.command.side_effect = lambda *_a, **_k: report.symlink_to(self.private.parent / 'outside.xml')
        with self.assertRaisesRegex(RuntimeError, 'PRIVATE_JUNIT'):
            facade.command(args, 'fixed', error_details=False)
        self.assertIsNone(facade.pending)
        self.manager.close()


class IntegrationTests(unittest.TestCase):
    def test_ios_readiness_precedes_first_product_install_and_keeps_failure_cleanup(self):
        for readiness_fails in (False, True):
            with self.subTest(readiness_fails=readiness_fails), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                private = root / 'private'
                private.mkdir()
                (root / 'release').mkdir()
                manifest = b'{"name":"owned"}'
                (root / 'package.json').write_bytes(manifest)
                (root / 'release/version.json').write_text(json.dumps(
                    {'version': '2.6.4', 'androidVersionCode': 627, 'iosBuildNumber': 620}))
                (root / '.env.ci').write_text('\n'.join([
                    'ENVIRONMENT=DEVELOPMENT', 'RELAY=http://127.0.0.1:8765/',
                    'SIGNING_SERVER_TESTNET=https://127.0.0.1:9/', 'SIGNING_SERVER_MAINNET=https://127.0.0.1:9/',
                    'CHANNEL_URL=https://127.0.0.1:9/', 'SENTRY_DNS=https://public@127.0.0.1:9/1',
                    'ENC_KEY_STORAGE_IDENTIFIER=KEEPER-HOSTED-DISPOSABLE']))
                sha, artifact, order = 'a' * 40, {'sha256': 'b' * 64}, []
                owned = '12345678-1234-1234-1234-123456789ABC'
                digest = hashlib.sha256(manifest).hexdigest()
                state = {'build': 'PASS', 'source_sha': sha, 'built_artifact': artifact,
                         'commands': [], 'maestro': {'binary': 'fake-maestro'}, 'nodeify_overlay': {
                             'path': 'package.json', 'allowed_fields': ['browser', 'react-native', 'browserify'],
                             'before_sha256': digest, 'after_sha256': digest}}
                original_error = RuntimeError('PRIVATE_SENTINEL original setup failure')

                def save(value):
                    state.clear()
                    state.update(copy.deepcopy(value))

                def command(args, label, **kwargs):
                    order.append(label)
                    if label == 'Create task-owned product UI simulator':
                        return owned
                    if label == 'Install exact product UI app':
                        self.assertEqual(kwargs, {'timeout': 120})
                        raise original_error

                def ready(device):
                    self.assertEqual(device, owned)
                    order.append('app-services-ready')
                    if readiness_fails:
                        raise original_error

                manager = types.SimpleNamespace(start=lambda *_a, **_k: order.append('metro-start'),
                                                close=lambda: order.append('metro-close'), events=[])
                server = types.SimpleNamespace(serve_forever=lambda: None,
                    shutdown=lambda: order.append('server-stop'), server_close=lambda: None)
                h = types.SimpleNamespace(ROOT=root, PRIVATE=private, PLATFORM='IOS', APP_IDS={'IOS': 'owned.app'},
                    read=lambda: copy.deepcopy(state), save=save, artifact_identity=lambda: artifact,
                    command=command, wait_for_simulator_app_services=ready)

                def shell(args, **_kwargs):
                    if args[:2] == ['xcrun', 'simctl']:
                        order.append('device-' + args[2])
                    return types.SimpleNamespace(returncode=0)

                with contextlib.ExitStack() as stack:
                    stack.enter_context(mock.patch.dict(product.os.environ, {'GITHUB_ACTIONS': 'true',
                        'RUNNER_ENVIRONMENT': 'github-hosted', 'KEEPER_SOURCE_SHA': sha}))
                    stack.enter_context(mock.patch.object(product.subprocess, 'check_output', side_effect=[sha, manifest]))
                    stack.enter_context(mock.patch.object(product.subprocess, 'run', side_effect=shell))
                    stack.enter_context(mock.patch.object(product, 'native_module',
                        return_value=types.SimpleNamespace(OwnedMetro=lambda *_: manager)))
                    stack.enter_context(mock.patch.object(product, 'make_server', return_value=server))
                    with self.assertRaises(RuntimeError) as failure:
                        product.run(h)
                self.assertIs(failure.exception, original_error)
                self.assertLess(order.index('Wait for product UI simulator'), order.index('app-services-ready'))
                if readiness_fails:
                    self.assertNotIn('Install exact product UI app', order)
                    self.assertNotIn('Reset task-owned simulator credentials', order)
                else:
                    self.assertLess(order.index('app-services-ready'), order.index('Install exact product UI app'))
                self.assertLess(order.index('metro-close'), order.index('device-shutdown'))
                self.assertLess(order.index('device-shutdown'), order.index('device-delete'))
                self.assertEqual(state['product_ui']['samples'], [])
                self.assertEqual(state['product_ui']['status'], 'FAIL')
                self.assertNotIn('Full-product first-wallet and relaunch UI sample', order)
                self.assertIn('server-stop', order)
                self.assertEqual(list(private.iterdir()), [])

    def test_primary_ui_failure_survives_save_and_metro_cleanup_errors_while_all_owned_data_is_disposed(self):
        class PrimaryFailure(RuntimeError):
            pass
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            private = root / 'private'
            private.mkdir()
            (root / 'release').mkdir()
            manifest = b'{"name":"owned"}'
            (root / 'package.json').write_bytes(manifest)
            (root / 'release/version.json').write_text(json.dumps(
                {'version': '2.6.4', 'androidVersionCode': 627, 'iosBuildNumber': 620}))
            (root / '.env.ci').write_text('\n'.join([
                'ENVIRONMENT=DEVELOPMENT', 'RELAY=http://127.0.0.1:8765/',
                'SIGNING_SERVER_TESTNET=https://127.0.0.1:9/', 'SIGNING_SERVER_MAINNET=https://127.0.0.1:9/',
                'CHANNEL_URL=https://127.0.0.1:9/', 'SENTRY_DNS=https://public@127.0.0.1:9/1',
                'ENC_KEY_STORAGE_IDENTIFIER=KEEPER-HOSTED-DISPOSABLE']))
            sha, artifact, order = 'a' * 40, {'sha256': 'b' * 64}, []
            digest = hashlib.sha256(manifest).hexdigest()
            state = {'build': 'PASS', 'source_sha': sha, 'built_artifact': artifact,
                     'commands': [], 'maestro': {'binary': 'fake-maestro'}, 'nodeify_overlay': {
                         'path': 'package.json', 'allowed_fields': ['browser', 'react-native', 'browserify'],
                         'before_sha256': digest, 'after_sha256': digest}}
            receipts, runtime = [], {}
            original_error = PrimaryFailure('PRIVATE_SENTINEL')
            def save(value):
                receipts.append(copy.deepcopy(value['product_ui']))
                if value['product_ui']['status'] == 'FAIL':
                    raise OSError('PRIVATE_SENTINEL')
                state.clear()
                state.update(copy.deepcopy(value))
            def command(args, *_args, **_kwargs):
                state['commands'].append({})
                (private / ('command-%03d.log' % len(state['commands']))).write_text('PRIVATE_SENTINEL')
                if args == ['adb', 'get-serialno']:
                    return 'emulator-5554'
                if args[0] == 'fake-maestro':
                    for stage in product.STAGES[:2]:
                        runtime['receipt'].mark(stage)
                    for marker in product.PIN_MARKERS[:3]:
                        runtime['receipt'].mark_pin(marker)
                    output = Path(args[args.index('--debug-output') + 1])
                    (output / 'private-failure.png').write_text('PRIVATE_SENTINEL')
                    raise original_error
                return 'fake image'
            def installed(_device):
                proof = {'method': 'SINGLE_INSTALLED_BASE_APK_SHA256', 'sha256': 'c' * 64}
                state.update(installed_artifact_verified=True, installed_artifact=proof)
                return proof
            def close():
                order.append('metro-close')
                raise RuntimeError('PRIVATE_SENTINEL')
            manager = types.SimpleNamespace(start=lambda *_a, **_k: None, close=close, events=[])
            server = types.SimpleNamespace(serve_forever=lambda: None, shutdown=lambda: order.append('server-stop'),
                                           server_close=lambda: None)
            def make_server(receipt):
                runtime['receipt'] = receipt
                return server
            def observe(output, device):
                self.assertEqual(output.name, 'sample-1')
                self.assertTrue((output / 'private-failure.png').exists())
                self.assertEqual(device, 'emulator-5554')
                order.append('failure-observation')
                return {'status': 'UNAVAILABLE'}
            h = types.SimpleNamespace(ROOT=root, PRIVATE=private, PLATFORM='ANDROID',
                APP_IDS={'ANDROID': 'owned.app'}, read=lambda: copy.deepcopy(state), save=save,
                artifact_identity=lambda: artifact, command=command, verify_installed_artifact=installed)
            def shell(args, **_kwargs):
                if args[0] == 'adb':
                    order.append('device-cleanup')
                return types.SimpleNamespace(returncode=0)
            with contextlib.ExitStack() as stack:
                stack.enter_context(mock.patch.dict(product.os.environ, {'GITHUB_ACTIONS': 'true',
                    'RUNNER_ENVIRONMENT': 'github-hosted', 'KEEPER_SOURCE_SHA': sha}))
                stack.enter_context(mock.patch.object(product.subprocess, 'check_output', side_effect=[sha, manifest]))
                stack.enter_context(mock.patch.object(product.subprocess, 'run', side_effect=shell))
                stack.enter_context(mock.patch.object(product, 'native_module',
                    return_value=types.SimpleNamespace(OwnedMetro=lambda *_: manager)))
                stack.enter_context(mock.patch.object(product, 'make_server', side_effect=make_server))
                observation = stack.enter_context(mock.patch.object(product, 'android_failure_observation', side_effect=observe))
                with self.assertRaises(PrimaryFailure) as failure:
                    product.run(h)
            self.assertIs(failure.exception, original_error)
            observation.assert_called_once()
            self.assertLess(order.index('failure-observation'), order.index('metro-close'))
            self.assertLess(order.index('metro-close'), order.index('device-cleanup'))
            self.assertIn('server-stop', order)
            self.assertEqual(list(private.iterdir()), [], 'task-owned UI/process output must be removed')
            failed = receipts[-1]
            self.assertEqual(failed['status'], 'FAIL')
            self.assertEqual(len(failed['samples']), 1, 'the original command must not be retried')
            self.assertEqual(failed['samples'][0]['completed_stages'], list(product.STAGES[:2]))
            self.assertEqual(failed['samples'][0]['pin_onboarding_progress']['completed_markers'],
                             list(product.PIN_MARKERS[:3]))
            self.assertEqual(failed['samples'][0]['android_runtime_diagnostic'], {'status': 'UNAVAILABLE'})
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(receipts))

    def test_order_preserves_completed_receipts_if_a_later_companion_fails(self):
        for fail_history in (False, True):
            calls, result = [], {}
            control = types.SimpleNamespace(ensure_product=lambda: calls.append('product'), switch=lambda _: None)
            proof = object()
            def module(name):
                def run(*args):
                    calls.append(name)
                    self.assertIs(args[-1], proof if name.endswith('vault_acceptance') else control.switch)
                    if fail_history and name == 'product_history_acceptance':
                        raise RuntimeError('private')
                    return {'status': 'PASS'}
                return types.SimpleNamespace(run_companion=run)
            with mock.patch.object(product, 'native_module', side_effect=module):
                try:
                    product.run_post_key_companions(None, None, None, None, None, control, proof, result)
                except RuntimeError:
                    self.assertTrue(fail_history)
            self.assertEqual(calls[:5], ['product', 'product_credential_acceptance', 'product',
                                        'product', 'product_history_acceptance'])
            self.assertIn('credential_errors_ui', result)
            self.assertEqual('vault_references_ui' in result, not fail_history)
            if not fail_history:
                self.assertEqual(calls[-1], 'product')

    def test_backend_and_receipt_ports_are_unique_and_match_fixed_metric_urls(self):
        modules = [load(name) for name in ('product_measurements', 'product_key_acceptance',
                    'product_credential_acceptance', 'product_vault_acceptance')]
        ports = [module.PORT for module in modules]
        self.assertEqual(ports, [8765, 8766, 8767, 8769])
        self.assertEqual(len(set([*ports, 8768])), 5, '8768 belongs to private-protocol controls')
        for port, filename in [(8766, 'product_key_metric.js'), (8767, 'product_credential_metric.js'),
                               (8769, 'product_vault_metric.js')]:
            self.assertIn('http://127.0.0.1:%d/metric' % port, (NATIVE / filename).read_text())


if __name__ == '__main__':
    unittest.main()
