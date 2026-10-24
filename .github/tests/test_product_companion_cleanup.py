"""Run each actual companion with fake UI/host boundaries and failing cleanup."""
import contextlib
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock

NATIVE = Path(__file__).resolve().parents[1] / 'native'
COMPANIONS = ('key', 'credential', 'history', 'vault')


def load(name):
    spec = importlib.util.spec_from_file_location(name, NATIVE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PrimaryFailure(RuntimeError):
    pass


class CompanionCleanupTests(unittest.TestCase):
    def exercise(self, kind, *, primary=False, failures=(), initial_save_failure=False):
        product = load('product_' + kind + '_acceptance')
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        private = root / 'private'
        private.mkdir()
        (root / 'release').mkdir()
        (root / 'release/version.json').write_text(json.dumps(
            {'version': '2.6.4', 'iosBuildNumber': 620, 'androidVersionCode': 627}))
        sha, artifact = 'a' * 40, {'sha256': 'f' * 64}
        proof = {'method': 'SINGLE_INSTALLED_BASE_APK_SHA256', 'sha256': 'f' * 64}
        state = {'build': 'PASS', 'source_sha': sha, 'built_artifact': artifact,
                 'maestro': {'binary': 'fake-maestro'}, 'product_key_ui': {
                     'status': 'PASS', 'scenario': 'UNUSED_MOBILE_KEY_UI_DELETE_AND_NATIVE_PIN',
                     'visible_eligible_keys_after_deletion': 0,
                     'unrelated_visible_wallet_count_after_relaunch': 1,
                     'new_account_requests_during_key_flow': 0,
                     'installed_artifact_verified': True, 'installed_artifact': proof}}
        slot = {'key': 'product_key_ui', 'credential': 'product_credential_ui',
                'history': 'product_version_history_ui', 'vault': 'product_vault_ui'}[kind]
        output = private / (kind + '-ui')
        events, attempted_receipts = [], []
        runtime = {'started': False, 'save_calls': 0}
        primary_error = PrimaryFailure('PRIVATE_SENTINEL primary error')

        def save(value):
            runtime['save_calls'] += 1
            attempted_receipts.append(copy.deepcopy(value[slot]))
            if initial_save_failure and runtime['save_calls'] == 1:
                raise OSError('PRIVATE_SENTINEL initial metadata error')
            if runtime['started']:
                events.append('evidence-save')
                if 'evidence-save' in failures:
                    raise OSError('PRIVATE_SENTINEL metadata error')
            state.clear()
            state.update(copy.deepcopy(value))

        def cleanup_step(name):
            events.append(name)
            if name in failures:
                raise OSError('PRIVATE_SENTINEL cleanup error')

        def server(receipt):
            runtime['receipt'] = receipt
            return types.SimpleNamespace(serve_forever=lambda: None,
                shutdown=lambda: cleanup_step('server-shutdown'),
                server_close=lambda: cleanup_step('server-close'))

        def installed(_device):
            state.update(installed_artifact_verified=True, installed_artifact=copy.deepcopy(proof))
            return copy.deepcopy(proof)

        def command(args, _label, **_kwargs):
            if args[0] == 'adb':
                return
            runtime['started'] = True
            directory = Path(args[args.index('--debug-output') + 1])
            (directory / 'private-ui.png').write_text('PRIVATE_SENTINEL')
            if primary:
                raise primary_error
            if kind in ('key', 'vault'):
                for stage in product.STAGES:
                    self.assertTrue(runtime['receipt'].mark(stage))
            elif kind == 'credential' and not args[-1].endswith('credential_fixture.yaml'):
                stages = product.STAGES[:3] if args[-1].endswith('blocked.yaml') else product.STAGES[3:]
                for stage in stages:
                    self.assertTrue(runtime['receipt'].mark(stage))

        real_rmtree = product.shutil.rmtree

        def rmtree(path, *args, **kwargs):
            if Path(path) == output:
                cleanup_step('private-output')
            return real_rmtree(path, *args, **kwargs)

        h = types.SimpleNamespace(ROOT=root, PLATFORM='ANDROID', APP_IDS={'ANDROID': 'owned.app'},
            read=lambda: copy.deepcopy(state), save=save, artifact_identity=lambda: artifact,
            verify_installed_artifact=installed, command=command, successful_junit=lambda _: 1)
        backend = types.SimpleNamespace(snapshot=lambda **_: {'status': 'PASS', 'sample': 6,
            'scenario': 'CONTROLLED_DISCONNECT_BEFORE_COMMIT_NOT_WAN_OFFLINE',
            'create_new_app_calls': 2, 'visible_wallet_count_after_relaunch': 1})
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.dict(product.os.environ, {'GITHUB_ACTIONS': 'true',
                'RUNNER_ENVIRONMENT': 'github-hosted', 'KEEPER_SOURCE_SHA': sha}))
            stack.enter_context(mock.patch.object(product.subprocess, 'check_output', return_value=sha))
            stack.enter_context(mock.patch.object(product.subprocess, 'run',
                return_value=types.SimpleNamespace(returncode=0)))
            stack.enter_context(mock.patch.object(product.shutil, 'rmtree', side_effect=rmtree))
            if kind != 'history':
                stack.enter_context(mock.patch.object(product, 'make_server', side_effect=server))
            arguments = [h, state, 'emulator-5554', private, backend]
            if kind == 'vault':
                arguments.append(lambda _h, device: installed(device))
            elif kind in ('credential', 'history'):
                arguments.append(lambda _phase: None)
            try:
                value = product.run_companion(*arguments)
            except Exception as error:
                value = error
        return value, primary_error, state, slot, output, events, attempted_receipts

    def test_primary_failure_survives_all_cleanup_and_save_failures_in_each_actual_companion(self):
        for kind in COMPANIONS:
            with self.subTest(kind=kind):
                failures = ('server-shutdown', 'server-close', 'private-output', 'evidence-save')
                value, primary, _state, _slot, output, events, receipts = self.exercise(
                    kind, primary=True, failures=failures)
                self.assertIs(value, primary)
                expected = ['private-output'] if kind == 'history' else list(failures[:3])
                self.assertEqual(events[:len(expected)], expected)
                self.assertEqual(events[len(expected):], ['evidence-save', 'evidence-save'])
                self.assertTrue(output.exists(), 'injected purge failure must remain visible to the parent')
                self.assertEqual(receipts[-1]['status'], 'FAIL')
                self.assertEqual(receipts[-1]['failure_category'], 'PrimaryFailure')
                self.assertEqual(receipts[-1]['cleanup'], 'FAILED')
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(receipts))

    def test_successful_ui_cannot_leave_pass_when_any_cleanup_or_final_save_fails(self):
        for kind in COMPANIONS:
            choices = ['private-output', 'evidence-save']
            if kind != 'history':
                choices += ['server-shutdown', 'server-close']
            for failed_stage in choices:
                with self.subTest(kind=kind, stage=failed_stage):
                    value, _primary, state, slot, output, events, receipts = self.exercise(
                        kind, failures=(failed_stage,))
                    self.assertIsInstance(value, Exception)
                    self.assertNotEqual(state[slot]['status'], 'PASS')
                    self.assertEqual(receipts[-1]['status'], 'FAIL')
                    if failed_stage != 'private-output':
                        self.assertFalse(output.exists())
                    if kind != 'history':
                        self.assertIn('server-shutdown', events)
                        self.assertIn('server-close', events)
                    self.assertIn('private-output', events)
                    self.assertNotIn('PRIVATE_SENTINEL', json.dumps(state))

    def test_initial_save_failure_still_disposes_the_created_private_directory(self):
        for kind in COMPANIONS:
            with self.subTest(kind=kind):
                value, _primary, state, slot, output, events, _receipts = self.exercise(
                    kind, initial_save_failure=True)
                self.assertIsInstance(value, OSError)
                self.assertEqual(state[slot]['status'], 'FAIL')
                self.assertEqual(state[slot]['failure_category'], 'OSError')
                self.assertFalse(output.exists())
                self.assertIn('private-output', events)


if __name__ == '__main__':
    unittest.main()
