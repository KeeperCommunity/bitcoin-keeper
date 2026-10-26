"""Offline runner/receipt boundaries; these tests never establish native UI PASS."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock

NATIVE = Path(__file__).resolve().parents[1] / 'native'
def load(name):
    spec = importlib.util.spec_from_file_location(name, NATIVE / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value
ui, metro = load('r52_trust_ui_acceptance'), load('product_metro')

class Boundaries(unittest.TestCase):
    def test_complete_unique_native_stages_and_exact_nonce_are_required(self):
        config = {'nonce': 'a' * 48}
        value = {'schema': 1, 'nonce': config['nonce'], 'platform': 'IOS', 'status': 'PASS',
                 'scope': 'ACTUAL_NORMAL_PRODUCT_UI_WITH_READ_ONLY_NATIVE_REALM_OBSERVER',
                 'stages': [{'stage': s, 'status': 'PASS'} for s in ui.STAGES]}
        self.assertIs(ui.validate_receipt(value, config, 'IOS'), value)
        for mutate in (lambda v: v.update(status='INCOMPLETE'),
                       lambda v: v.update(nonce='b' * 48),
                       lambda v: v.update(platform='ANDROID'),
                       lambda v: v['stages'].pop(),
                       lambda v: v['stages'].reverse(),
                       lambda v: v['stages'][1].update(status='NOT RUN')):
            bad = copy.deepcopy(value); mutate(bad)
            with self.assertRaisesRegex(RuntimeError, 'COMPLETE_NATIVE'):
                ui.validate_receipt(bad, config, 'IOS')

    def test_hosted_private_exact_source_and_real_startup_gates_precede_fixture(self):
        h = types.SimpleNamespace(PLATFORM='ANDROID', ROOT=Path('/unused'), artifact_identity=lambda: {'sha256': 'b' * 64})
        data = {'build': 'PASS', 'smoke': 'PASS', 'source_sha': 'a' * 40, 'built_artifact': h.artifact_identity()}
        env = {'GITHUB_ACTIONS': 'true', 'GITHUB_REPOSITORY': 'KeeperCommunity/bitcoin-keeper-private',
               'RUNNER_ENVIRONMENT': 'github-hosted', 'KEEPER_SOURCE_SHA': data['source_sha']}
        with mock.patch.object(ui.subprocess, 'Popen') as spawn, mock.patch.object(ui.subprocess, 'check_output', return_value=data['source_sha']):
            for update in ({'GITHUB_ACTIONS': 'false'}, {'GITHUB_REPOSITORY': 'KeeperCommunity/bitcoin-keeper'}, {'RUNNER_ENVIRONMENT': 'self-hosted'}):
                with mock.patch.dict(ui.os.environ, {**env, **update}, clear=True):
                    with self.assertRaisesRegex(RuntimeError, 'PRIVATE_OWNED'):
                        ui.run_companion(h, data, 'emulator-5554', None, None, None)
            with mock.patch.dict(ui.os.environ, env, clear=True):
                with self.assertRaisesRegex(RuntimeError, 'PRIVATE_OWNED'):
                    ui.run_companion(h, data, 'real-phone', None, None, None)
                with self.assertRaisesRegex(RuntimeError, 'EXACT_APP_STARTUP'):
                    ui.run_companion(h, {**data, 'smoke': 'FAIL'}, 'emulator-5554', None, None, None)
                with mock.patch.object(ui.subprocess, 'run', return_value=types.SimpleNamespace(returncode=1)):
                    with self.assertRaisesRegex(RuntimeError, 'COMMITTED_SOURCE'):
                        ui.run_companion(h, data, 'emulator-5554', None, None, None)
            spawn.assert_not_called()

    def test_loopback_reverse_is_bound_to_generated_config_and_owned_device(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); generated = root / '.github/native/.generated/r52_trust_ui.json'
            generated.parent.mkdir(parents=True)
            config = {'schema': 1, 'platform': 'ANDROID', 'a': {'port': 41001}, 'b': {'port': 41002}, 'c': {'port': 41003}}
            generated.write_text(json.dumps(config))
            h = types.SimpleNamespace(ROOT=root, PLATFORM='ANDROID', command=mock.Mock())
            ports = set()
            wrapper = metro.StoppedFlowHarness(h, {}, 'emulator-5554', root, None, ports)
            wrapper.reverse_trust_loopback(config)
            self.assertEqual(ports, {'8768', '41001', '41002', '41003'})
            self.assertEqual(h.command.call_count, 4)
            self.assertTrue(all(c.args[0][0:3] == ['adb', '-s', 'emulator-5554'] for c in h.command.call_args_list))
            with self.assertRaisesRegex(RuntimeError, 'CONFIG_REQUIRED'):
                wrapper.reverse_trust_loopback({**config, 'a': {'port': 22}})
            invalid = {**config, 'a': {'port': 8768}}
            generated.write_text(json.dumps(invalid))
            with self.assertRaisesRegex(RuntimeError, 'PORTS_REQUIRED'):
                wrapper.reverse_trust_loopback(invalid)
            self.assertEqual(h.command.call_count, 4)

if __name__ == '__main__': unittest.main()
