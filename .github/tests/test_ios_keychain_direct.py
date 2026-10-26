"""Direct-launch orchestration controls; these do not execute a native bridge."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('keychain_direct_controls',
    Path(__file__).resolve().parents[1] / 'native/ios_keychain_direct.py')
direct = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(direct)
DEVICE = '12345678-1234-1234-1234-123456789ABC'


class DirectKeychain(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.state = {'commands': [], 'built_artifact': {'path': '/owned/app', 'sha256': 'a' * 64},
            'build': 'NOT RUN', 'smoke': 'FAIL', 'native_keychain': 'NOT RUN'}
        self.calls = []
        self.pid = 100
        self.native = SimpleNamespace(ROOT=self.root, PRIVATE=self.root, PLATFORM='IOS',
            APP_IDS={'IOS': 'io.hexawallet.hexakeeper.dev'}, read=lambda: copy.deepcopy(self.state),
            save=lambda value: setattr(self, 'state', copy.deepcopy(value)), command=self.command,
            artifact_identity=lambda: copy.deepcopy(self.state['built_artifact']),
            warm_metro_bundle=mock.Mock(), wait_for_simulator_app_services=mock.Mock(),
            verify_installed_artifact=mock.Mock())
        self.metro = mock.Mock(); self.metro.poll.return_value = 0
        self.response = mock.MagicMock(); self.response.__enter__.return_value.read.return_value = b'packager-status:running'

    def command(self, args, label, **kwargs):
        self.calls.append(args)
        if args[2] == 'create': return DEVICE
        if args[2] == 'launch':
            self.pid += 1
            return 'io.hexawallet.hexakeeper.dev: ' + str(self.pid)
        return ''

    def run_probe(self, observations=None, cleanup=None):
        self.metro.poll.return_value = None
        observations = observations or [{'stage': stage, 'native_acceptance': False} for stage in direct.STAGES]
        with mock.patch.object(direct.subprocess, 'Popen', return_value=self.metro), \
                mock.patch.object(direct.urllib.request, 'urlopen', return_value=self.response), \
                mock.patch.object(direct, 'witness', side_effect=observations), \
                mock.patch.object(direct.subprocess, 'run', side_effect=cleanup), \
                mock.patch.object(direct.os, 'killpg'):
            direct.run(self.native)

    def test_three_pid_distinct_processes_and_native_stages_do_not_unlock_formal_gates(self):
        self.run_probe()
        value = self.state['direct_keychain_diagnostic']
        self.assertEqual(value['status'], 'PASS')
        self.assertEqual(value['launches'], [101, 102, 103])
        self.assertEqual([x['stage'] for x in value['stages']], ['seeded', 'updated', 'pass'])
        self.assertEqual(sum(x[2] == 'terminate' for x in self.calls), 3)
        self.assertEqual(self.native.verify_installed_artifact.call_count, 4)
        self.assertEqual(self.state['smoke'], 'FAIL')
        self.assertEqual(self.state['build'], 'NOT RUN')
        self.assertEqual(self.state['native_keychain'], 'NOT RUN')
        self.assertFalse(value['native_acceptance'])

    def test_native_failure_stops_sequence_and_keeps_observed_fixed_result(self):
        with self.assertRaisesRegex(RuntimeError, 'native operation failed'):
            self.run_probe([{'stage': 'failed', 'failure_code': 'MISSING_ENTITLEMENT',
                             'native_code': -34018, 'native_acceptance': False}])
        value = self.state['direct_keychain_diagnostic']
        self.assertEqual(value['status'], 'FAIL')
        self.assertEqual(len(value['launches']), 1)
        self.assertEqual(value['stages'][0]['native_code'], -34018)

    def test_pid_reuse_and_cleanup_failure_cannot_pass(self):
        original = self.command
        def repeated(args, label, **kwargs):
            if args[2] == 'launch': return 'io.hexawallet.hexakeeper.dev: 999'
            return original(args, label, **kwargs)
        self.native.command = repeated
        with self.assertRaisesRegex(RuntimeError, 'Distinct native process'):
            self.run_probe()
        self.assertEqual(self.state['direct_keychain_diagnostic']['status'], 'FAIL')
        self.native.command = original
        with self.assertRaisesRegex(RuntimeError, 'cleanup failed'):
            self.run_probe(cleanup=RuntimeError('PRIVATE'))
        value = self.state['direct_keychain_diagnostic']
        self.assertEqual(value['status'], 'FAIL')
        self.assertEqual(value['cleanup_errors'], ['device_shutdown', 'device_delete'])
        self.assertNotIn('PRIVATE', json.dumps(value))

    def test_readback_can_wait_only_for_previous_stage_and_never_skip_a_checkpoint(self):
        evidence = SimpleNamespace(collect=mock.Mock(side_effect=[{'stage': 'seeded'}, {'stage': 'updated'}]))
        with mock.patch.object(direct, 'module', return_value=evidence), mock.patch.object(direct.time, 'sleep'):
            self.assertEqual(direct.witness(self.native, DEVICE, 'updated', 'seeded')['stage'], 'updated')
        evidence.collect.side_effect = [{'stage': 'pass'}]
        with mock.patch.object(direct, 'module', return_value=evidence), self.assertRaisesRegex(RuntimeError, 'Unexpected'):
            direct.witness(self.native, DEVICE, 'seeded', None)


if __name__ == '__main__': unittest.main()
