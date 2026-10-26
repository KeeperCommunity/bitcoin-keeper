import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest import mock
import yaml

ROOT = Path(__file__).resolve().parents[2]


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


m = load(ROOT / '.github/native/android_runtime_capacity_measure.py', 'capacity_measure_test')
consumer = load(Path(__file__).with_name('test_android_runtime_checkpoint.py'), 'capacity_fixture')


class CapacityMeasurementTests(unittest.TestCase):
    def test_wrong_context_rejects_before_any_git_tool_or_measurement(self):
        with mock.patch.object(m.subprocess, 'run') as run, mock.patch.object(m.subprocess, 'check_output') as output:
            with self.assertRaises(RuntimeError): m.measure({})
            run.assert_not_called(); output.assert_not_called()

    def test_real_git_source_measurement_does_not_call_cleanup_or_native_entrypoints(self):
        fixture = consumer.RuntimeCheckpointTest(methodName='runTest'); fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.put('.github/native/android_runtime_capacity_measure.py', (ROOT / '.github/native/android_runtime_capacity_measure.py').read_bytes())
        fixture.stage()
        fixture.git('checkout', '--detach', '-q', fixture.env['KEEPER_CONTROLLER_SHA'])
        staged = load(fixture.root / '.github/native/android_runtime_capacity_measure.py', 'real_capacity_measure')
        event = fixture.base / 'event.json'
        event.write_text(json.dumps({'action': 'labeled', 'label': {'name': 'keeper/android-capacity-measurement'},
            'repository': {'id': 839671816, 'private': True}, 'pull_request': {'number': 73,
            'head': {'sha': fixture.env['KEEPER_CONTROLLER_SHA'], 'repo': {'id': 839671816}},
            'labels': [{'name': 'keeper/android-capacity-measurement'}]}}))
        env = {**fixture.env, 'GITHUB_EVENT_PATH': str(event), 'GITHUB_WORKFLOW_REF': staged.WORKFLOW,
            'RUNNER_ENVIRONMENT': 'github-hosted', 'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64',
            'ImageOS': 'ubuntu24', 'ANDROID_HOME': '/usr/local/lib/android/sdk',
            'ANDROID_SDK_ROOT': '/usr/local/lib/android/sdk', 'RUNNER_TOOL_CACHE': '/opt/hostedtoolcache'}
        stock, _ = staged.pinned('android_runtime_stock_codeql')
        policy, _ = staged.pinned('android_runner_disk')
        inventory = {'measured_extra_reclaim_bytes': 3_423_044_608, 'required_extra_reclaim_bytes': 2_814_287_872}
        policy.context = mock.Mock(); policy.free_bytes = mock.Mock(return_value=9_152_319_488)
        policy.stock_identity = mock.Mock(return_value=('original',))
        with mock.patch.object(staged, 'pinned', side_effect=[(stock, 'helper-sha'), (policy, stock.ORIGINAL_SHA)]), \
             mock.patch.object(stock, 'runtime_paths_clear'), \
             mock.patch.object(stock, 'stock_identity', return_value=('extra',)), \
             mock.patch.object(stock, 'capacity_inventory', return_value=(inventory,
                 {stock.NDK: ('extra',)}, {Path('/usr/share/dotnet'): ('original',)})), \
             mock.patch.object(stock, 'prepare', side_effect=AssertionError('cleanup forbidden')) as cleanup:
            result = staged.measure(env)
            self.assertTrue(result['capacity_arithmetic_closes'])
            self.assertFalse(result['native_acceptance']); self.assertEqual(result['removed'], [])
            self.assertTrue(result['later_runtime_must_remeasure'])
            self.assertEqual(result['app_runtime'], 'NOT RUN'); cleanup.assert_not_called()
        # A dirty helper is refused by the actual Git-byte loader.
        with (fixture.root / '.github/native/android_runtime_stock_codeql.py').open('a') as target:
            target.write('\n# changed\n')
        with self.assertRaises(RuntimeError): staged.pinned('android_runtime_stock_codeql')

    def test_workflow_has_only_source_setup_measure_and_bounded_retention(self):
        path = ROOT / '.github/workflows/keeper-private-android-capacity-measure.yml'
        value = yaml.load(path.read_text(), Loader=yaml.BaseLoader)
        job = value['jobs']['measure']
        self.assertEqual(job['timeout-minutes'], '10')
        self.assertIn("github.event.label.name == 'keeper/android-capacity-measurement'", job['if'])
        commands = [step['run'] for step in job['steps'] if 'run' in step]
        self.assertEqual(commands, ['python3 .github/native/android_runtime_capacity_measure.py'])
        uses = [step['uses'] for step in job['steps'] if 'uses' in step]
        self.assertFalse(any('emulator' in step for step in uses))
        self.assertFalse(any('download-artifact' in step for step in uses))
        retained = job['steps'][-1]['with']
        self.assertEqual(retained['path'], 'artifacts/private-android-capacity/measurement.json')
        self.assertEqual(retained['retention-days'], '1')


if __name__ == '__main__': unittest.main()
