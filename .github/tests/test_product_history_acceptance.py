"""Offline runner boundary controls only; no native acceptance credit."""
import contextlib
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('product_history_acceptance',
    Path(__file__).resolve().parents[1] / 'native/product_history_acceptance.py')
product = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(product)


class RunnerTests(unittest.TestCase):
    def exercise(self, *, dirty=False, command_failure=False, invalid_installed=False,
                 changed_install=False, new_account=False, device='emulator-5554', switch_failure=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        (root / 'release').mkdir()
        (root / 'release/version.json').write_text(json.dumps(
            {'version': '2.6.4', 'iosBuildNumber': 620, 'androidVersionCode': 627}))
        private = root / 'private'
        private.mkdir()
        sha = 'a' * 40
        artifact = {'sha256': 'b' * 64}
        state = {'build': 'PASS', 'source_sha': sha, 'built_artifact': artifact,
                 'maestro': {'binary': 'offline-fake-maestro'}}
        commands, switches = [], []
        installed_calls = 0
        backend_calls = 0

        def backend_snapshot(passed=False):
            nonlocal backend_calls
            backend_calls += 1
            return {'status': 'PASS', 'sample': 6, 'create_new_app_calls':
                    3 if new_account and backend_calls > 1 else 2,
                    'scenario': 'CONTROLLED_DISCONNECT_BEFORE_COMMIT_NOT_WAN_OFFLINE',
                    'visible_wallet_count_after_relaunch': 1}

        def command(args, label, **kwargs):
            self.assertFalse(kwargs['error_details'])
            commands.append(args)
            (private / 'history-ui/private-UI.png').write_text('PRIVATE_SENTINEL')
            if command_failure:
                raise RuntimeError('PRIVATE_SENTINEL')

        def verify_installed(_):
            nonlocal installed_calls
            installed_calls += 1
            proof = {'method': 'SINGLE_INSTALLED_BASE_APK_SHA256',
                     'sha256': ('d' if changed_install and installed_calls > 1 else 'c') * 64}
            state['installed_artifact_verified'] = not invalid_installed
            state['installed_artifact'] = copy.deepcopy(proof)
            return proof

        def save(value):
            state.clear()
            state.update(copy.deepcopy(value))

        def switch(phase):
            switches.append(phase)
            if switch_failure:
                raise RuntimeError('PRIVATE_SENTINEL')

        h = types.SimpleNamespace(ROOT=root, PLATFORM='ANDROID', APP_IDS={'ANDROID': 'disposable.app'},
            read=lambda: copy.deepcopy(state), save=save, artifact_identity=lambda: artifact,
            verify_installed_artifact=verify_installed, command=command, successful_junit=lambda _: 1)
        backend = types.SimpleNamespace(snapshot=backend_snapshot)
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.dict(product.os.environ, {'GITHUB_ACTIONS': 'true',
                'RUNNER_ENVIRONMENT': 'github-hosted', 'KEEPER_SOURCE_SHA': sha}))
            stack.enter_context(mock.patch.object(product.subprocess, 'check_output', return_value=sha))
            stack.enter_context(mock.patch.object(product.subprocess, 'run',
                return_value=types.SimpleNamespace(returncode=1 if dirty else 0)))
            try:
                value = product.run_companion(h, state, device, private, backend, switch)
            except Exception as error:
                value = error
        return value, state, commands, switches, installed_calls, private

    def test_full_order_requires_all_fixed_native_and_normal_product_phases_and_byte_proofs(self):
        value, state, commands, switches, installed_calls, private = self.exercise()
        self.assertEqual(value['status'], 'PASS')
        self.assertEqual(value['completed_stages'], list(product.PHASES))
        self.assertEqual(switches, [p if p.startswith('history_') else 'product'
                                   for p in product.PHASES] + ['product'])
        self.assertEqual(len(commands), len(product.PHASES))
        self.assertEqual(installed_calls, 2 * len(product.PHASES) + 2)
        self.assertTrue(all(p['installed_artifact_verified'] for p in value['stage_evidence']))
        self.assertEqual(value['original_history_restored'], True)
        self.assertEqual(value['new_account_requests_during_history_flow'], 0)
        self.assertFalse((private / 'history-ui').exists())
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(state))

    def test_interrupted_native_phase_never_claims_complete_and_purges_ui_output(self):
        for option in ['command_failure', 'switch_failure']:
            value, state, _, _, _, private = self.exercise(**{option: True})
            self.assertIsInstance(value, RuntimeError)
            self.assertEqual(state['product_version_history_ui']['status'], 'FAIL')
            self.assertEqual(state['product_version_history_ui']['completed_stages'], [])
            self.assertNotIn('original_history_restored', state['product_version_history_ui'])
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(state))
            self.assertFalse((private / 'history-ui').exists())

    def test_changed_or_unverified_installed_bytes_cannot_pass(self):
        for option in ['invalid_installed', 'changed_install']:
            value, state, commands, _, _, private = self.exercise(**{option: True})
            self.assertIsInstance(value, RuntimeError)
            self.assertEqual(state['product_version_history_ui']['status'], 'FAIL')
            self.assertEqual(commands, [])
            self.assertFalse((private / 'history-ui').exists())

    def test_new_account_request_after_scenario_is_a_failure(self):
        value, state, *_ = self.exercise(new_account=True)
        self.assertIsInstance(value, RuntimeError)
        self.assertEqual(state['product_version_history_ui']['status'], 'FAIL')

    def test_dirty_source_and_physical_device_are_rejected_before_commands(self):
        for options in [{'dirty': True}, {'device': 'physical-device'}]:
            value, state, commands, *_ = self.exercise(**options)
            self.assertIsInstance(value, RuntimeError)
            self.assertEqual(commands, [])
            self.assertNotIn('product_version_history_ui', state)

    def test_fixed_configs_select_only_their_committed_entrypoint_and_all_flows_stop_app(self):
        native = Path(__file__).resolve().parents[1] / 'native'
        for phase in product.PHASES:
            if phase.startswith('history_'):
                config = (native / (phase + '_metro.cjs')).read_text()
                self.assertIn('/.github/native/' + phase + '.$1', config)
                self.assertIn("registerFixture('" + phase[8:] + "')",
                              (native / (phase + '.js')).read_text())
                self.assertNotIn('process.env', config)
        for flow in ['history_product.yaml', 'history_fixture.yaml']:
            source = (native / flow).read_text()
            self.assertTrue(source.rstrip().endswith('- stopApp'))
            for forbidden in ['takeScreenshot:', 'copyTextFrom:', 'setClipboard:', 'clearKeychain:']:
                self.assertNotIn(forbidden, source)


if __name__ == '__main__':
    unittest.main()
