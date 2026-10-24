"""Pinned tool-format and privacy controls; no simulator or native credit."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

NATIVE = Path(__file__).parents[1] / 'native'


def load(name):
    spec = importlib.util.spec_from_file_location(name, NATIVE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


observe = load('ios_startup_command_observation')
native = load('hosted_native')
DEVICE = '12345678-1234-1234-1234-123456789ABC'


def row(sequence=0, status='RUNNING', key='launchAppCommand'):
    return {'command': {key: {'appId': '${APP_ID}', 'clearState': True,
        'permissions': {'all': 'deny'}, 'optional': False}},
        'metadata': {'sequenceNumber': sequence, 'status': status, 'depth': 0,
            'timestamp': 1792700000000, 'duration': 100,
            'evaluatedCommand': {key: {'appId': observe.APP, 'clearState': True,
                'permissions': {'all': 'deny'}}},
            'error': {'message': 'DeviceConnectionException PRIVATE_SENTINEL',
                      'debugMessage': 'PRIVATE_SENTINEL'}, 'artifacts': []}}


class CommandObservation(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.private = Path(temporary.name)
        self.output = self.private / 'maestro-output'
        self.flow = self.output / observe.FLOW
        self.flow.mkdir(parents=True)
        self.path = self.flow / 'commands.json'

    def write(self, rows=None):
        self.path.write_text(json.dumps([row()] if rows is None else rows))

    def result(self):
        result = observe.commands(self.output)
        encoded = json.dumps(result)
        for text in ('PRIVATE_SENTINEL', str(self.private), observe.APP, 'debugMessage', '${APP_ID}'):
            self.assertNotIn(text, encoded)
        return result

    def test_running_launch_is_observation_without_completed_or_failed_inference(self):
        self.write()
        self.assertEqual(self.result()['rows'], [{'sequence': 0, 'kind': 'LAUNCH_APP',
            'status': 'RUNNING', 'error_markers': ['DRIVER_CONNECTION_TEXT']}])
        self.assertEqual(self.result()['state'], 'RECORDED')
        self.assertIn('NOT_COMPLETION', self.result()['scope'])

    def test_every_pinned_status_and_known_kind_is_fixed_and_not_mapped_by_sequence(self):
        rows = []
        for index, (key, kind) in enumerate(observe.KINDS.items()):
            rows.append(row(index, observe.STATUSES[index], key))
        self.write(rows)
        self.assertEqual([item['kind'] for item in self.result()['rows']], list(observe.KINDS.values()))
        self.assertEqual([item['status'] for item in self.result()['rows']], list(observe.STATUSES))
        other = row(); other['command'] = {'PRIVATE_SENTINEL': {'text': 'PRIVATE_SENTINEL'}}
        self.write([other])
        self.assertEqual(self.result()['rows'][0]['kind'], 'OTHER')
        other = row(); other['command']['launchAppCommand']['appId'] = 'PRIVATE_SENTINEL'
        self.write([other])
        self.assertEqual(self.result()['rows'][0]['kind'], 'OTHER')

    def test_error_markers_export_only_fixed_vocabulary(self):
        item = row(status='FAILED')
        item['metadata']['error']['message'] = ('Failed to launch app PRIVATE_SENTINEL '
            'FBSOpenApplicationServiceErrorDomain An error was encountered processing the command')
        self.write([item])
        self.assertEqual(self.result()['rows'][0]['error_markers'],
            ['APP_LAUNCH_TEXT', 'FBS_OPEN_APPLICATION_TEXT', 'SIMCTL_OPERATION_TEXT'])

    def test_evaluated_app_wrapper_and_fixed_app_binding_cannot_conflict(self):
        for evaluated in (None, [], {}, {'PRIVATE_SENTINEL': {}},
                {'launchAppCommand': None}, {'launchAppCommand': {'appId': 'PRIVATE_SENTINEL'}},
                {'launchAppCommand': {'appId': '${APP_ID}'}},
                {'launchAppCommand': {'appId': observe.APP}, 'stopAppCommand': {}}):
            item = row(); item['metadata']['evaluatedCommand'] = evaluated
            self.write([item])
            self.assertEqual(self.result()['state'], 'UNKNOWN')

    def test_missing_empty_wrong_flow_duplicate_candidates_and_symlinks_are_unknown(self):
        self.assertEqual(self.result()['state'], 'UNKNOWN')
        self.write([]); self.assertEqual(self.result()['state'], 'UNKNOWN')
        self.write(); other = self.output / 'Other flow'
        self.flow.rename(other)
        self.assertEqual(self.result()['state'], 'UNKNOWN'); other.rename(self.flow)
        candidate = self.output / 'commands.json'; candidate.write_text(self.path.read_text())
        self.assertEqual(self.result()['state'], 'UNKNOWN'); candidate.unlink()
        outside = self.private / 'outside'; outside.write_text(self.path.read_text())
        self.path.unlink(); self.path.symlink_to(outside)
        self.assertEqual(self.result()['state'], 'UNKNOWN')

    def test_malformed_or_unbounded_input_fails_whole_projection_without_partial_rows(self):
        self.write()
        for raw in ('[{"command":{},"command":{},"metadata":{}}]', 'NaN', '\ud800'):
            self.path.write_bytes(raw.encode(errors='surrogatepass'))
            self.assertEqual(self.result()['state'], 'UNKNOWN')
        self.path.write_bytes(b' ' * (observe.LIMIT + 1))
        self.assertEqual(self.result()['state'], 'UNKNOWN')
        for change in ('status', 'sequence', 'depth', 'duration', 'error', 'extra', 'duplicate', 'limit'):
            item = row(); rows = [item]
            if change == 'status': item['metadata']['status'] = 'PRIVATE_SENTINEL'
            elif change == 'sequence': item['metadata']['sequenceNumber'] = True
            elif change == 'depth': item['metadata']['depth'] = 99
            elif change == 'duration': item['metadata']['duration'] = False
            elif change == 'error': item['metadata']['error']['type'] = 'PRIVATE_SENTINEL'
            elif change == 'extra': item['metadata']['PRIVATE_SENTINEL'] = True
            elif change == 'duplicate': rows.append(copy.deepcopy(item))
            else: rows = [row(index) for index in range(65)]
            self.write(rows)
            with self.subTest(change=change): self.assertEqual(self.result()['state'], 'UNKNOWN')

    def test_process_matches_only_owned_label_without_pid_or_absence_inference(self):
        prefix = b'PID\tStatus\tLabel\n'
        owned = ('1234\t0\tUIKitApplication:%s[ABC-123][rb-legacy]\n' % observe.APP).encode()
        result = observe.process_entries(prefix + owned)
        self.assertEqual(result['state'], 'OWNED_RUNNING_ENTRY_OBSERVED')
        self.assertEqual(result['owned_entry_count'], 1)
        self.assertNotIn('1234', json.dumps(result)); self.assertNotIn(observe.APP, json.dumps(result))
        self.assertEqual(observe.process_entries(prefix + owned.replace(b'1234\t', b'-\t'))['state'],
            'OWNED_NONRUNNING_ENTRY_OBSERVED')
        self.assertEqual(observe.process_entries(prefix + owned.replace(observe.APP.encode(),
            (observe.APP + '.foreign').encode()))['state'], 'NO_OWNED_ENTRY_OBSERVED')
        for payload in (owned, prefix + owned + owned, prefix + b'PRIVATE_SENTINEL\n',
                        prefix + b'\xff', b' ' * (observe.LIMIT + 1)):
            self.assertEqual(observe.process_entries(payload)['state'], 'UNKNOWN')

    def test_process_query_is_nonmutating_device_bound_timed_and_always_closes_private_output(self):
        captured = []
        def run(args, **kwargs):
            self.assertEqual(args, ['xcrun', 'simctl', 'spawn', DEVICE, 'launchctl', 'list'])
            self.assertEqual(kwargs['timeout'], 15)
            self.assertEqual(kwargs['stderr'], subprocess.DEVNULL)
            captured.append(kwargs['stdout'])
            kwargs['stdout'].write(b'PID\tStatus\tLabel\n')
            return SimpleNamespace(returncode=0)
        with mock.patch.object(observe.subprocess, 'run', side_effect=run):
            self.assertEqual(observe.process(self.private, DEVICE)['state'], 'NO_OWNED_ENTRY_OBSERVED')
        self.assertTrue(captured[0].closed)
        self.assertEqual(list(self.private.glob('*')), [self.output])
        for failure, expected in ((subprocess.TimeoutExpired('private', 15), 'TIMEOUT'),
                                  (OSError('PRIVATE_SENTINEL'), 'UNAVAILABLE')):
            with mock.patch.object(observe.subprocess, 'run', side_effect=failure):
                self.assertEqual(observe.process(self.private, DEVICE)['query'], expected)
        with mock.patch.object(observe.subprocess, 'run', return_value=SimpleNamespace(returncode=1)):
            self.assertEqual(observe.process(self.private, DEVICE)['query'], 'NONZERO_EXIT')
        with mock.patch.object(observe.subprocess, 'run') as run_mock:
            self.assertEqual(observe.process(self.private, 'booted')['query'], 'NOT_RUN')
            run_mock.assert_not_called()

    def test_exact_owned_launch_invocation_and_clearstate_permission_markers_are_observations(self):
        log = self.output / 'maestro.log'
        log.write_text('Clearing app %s state\nReinstalling and launching %s\n'
            'App %s reinstalled and launched\n'
            '[Start] Setting permissions all=deny through applesimutils\n'
            '[Done] Setting permissions through applesimutils\n'
            '[Start] Setting Permissions all=deny through simctl\n'
            '[Done] Setting Permissions all=deny through simctl\n'
            'Running command line operation: [xcrun, simctl, launch, %s, %s] with {} PRIVATE_SENTINEL\n'
            % (observe.APP, observe.APP, observe.APP, DEVICE, observe.APP))
        with mock.patch.object(native, 'PRIVATE', self.private), \
                mock.patch.object(native, 'PLATFORM', 'IOS'), mock.patch.object(native, 'read', return_value={'commands': []}):
            result = native.maestro_preflight_diagnostics(owned_device=DEVICE)
            self.assertTrue(all(result[key] for key in result if key.startswith('app_')))
            other = native.maestro_preflight_diagnostics(owned_device='00000000-0000-0000-0000-000000000000')
            self.assertFalse(other['app_simctl_launch_invocation_text'])
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
            self.assertNotIn(observe.APP, json.dumps(result)); self.assertNotIn(DEVICE, json.dumps(result))


if __name__ == '__main__':
    unittest.main()
