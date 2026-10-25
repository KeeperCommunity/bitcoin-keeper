"""Read-only owned launch-denial observations; no native/cause credit."""
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(os.environ.get('KEEPER_LAUNCH_OBSERVER_SOURCE_ROOT', Path(__file__).resolve().parents[2]))


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / '.github/native' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


observe, native = load('ios_startup_command_observation'), load('hosted_native')
START, END = 1792861200000, 1792861260000
DEVICE = '12345678-1234-1234-1234-123456789ABC'
APP = 'io.hexawallet.hexakeeper.dev'


def row(message=None, service='runningboardd', instant=START + 1000):
    return {'timestamp': datetime.fromtimestamp(instant / 1000, timezone.utc).isoformat(),
            'processImagePath': '/private/system/' + service,
            'eventMessage': message or (APP + ' Error Domain=NSPOSIXErrorDomain Code=1 '
                'operation not permitted PRIVATE_SENTINEL /private/wallet.json')}


class LaunchServices(unittest.TestCase):
    def classify(self, rows):
        result = observe.launch_service_records(json.dumps(rows).encode(), START, END)
        for value in ('PRIVATE_SENTINEL', '/private/', APP, str(START), 'wallet.json'):
            self.assertNotIn(value, json.dumps(result))
        self.assertIn('NOT_CAUSE_OR_ACCEPTANCE', result['scope'])
        return result

    def test_owned_time_bound_system_record_projects_only_fixed_service_domain_code_and_markers(self):
        result = self.classify([row()])
        self.assertEqual(result['state'], 'RECORDED')
        self.assertEqual(result['matching_records'], 1)
        self.assertEqual(result['rows'], [{'service': 'runningboardd',
            'codes': [{'domain': 'NSPOSIXErrorDomain', 'code': 1}], 'markers': ['PERMISSION_TEXT']}])
        nested = self.classify([row(APP + ' <NSError: 0x123; domain: RBSRequestErrorDomain; code: 5; '
            '"Launch failed."> Library not loaded incompatible architecture signature capability PRIVATE_SENTINEL')])
        self.assertEqual(nested['rows'][0]['codes'], [{'domain': 'RBSRequestErrorDomain', 'code': 5}])
        self.assertEqual(nested['rows'][0]['markers'],
            ['CAPABILITY_TEXT', 'ARCHITECTURE_TEXT', 'SIGNATURE_TEXT', 'SPAWN_FAILURE_TEXT', 'DYLD_TEXT'])

    def test_foreign_process_bundle_suffix_and_outside_window_cannot_create_denial_evidence(self):
        rows = [row(service='OtherApp'), row(instant=START - 1), row(instant=END + 1)]
        for foreign in (APP + '.other', 'prefix.' + APP, APP + '-other', APP + '_other'):
            rows.append(row(foreign + ' Error Domain=NSPOSIXErrorDomain Code=1 PRIVATE_SENTINEL'))
        self.assertEqual(self.classify(rows)['matching_records'], 0)
        for timestamp in ('2026-99-24T17:00:01+00:00', '2026-10-24T17:00:01', 'PRIVATE_SENTINEL'):
            value = row(); value['timestamp'] = timestamp
            self.assertEqual(self.classify([value])['state'], 'UNKNOWN')

    def test_unknown_domains_messages_and_unbounded_codes_are_never_copied_or_interpreted(self):
        result = self.classify([row(APP + ' Error Domain=PrivateSentinelDomain Code=1 PRIVATE_SENTINEL'),
            row(APP + ' Error Domain=NSPOSIXErrorDomain Code=2147483648 PRIVATE_SENTINEL'),
            row(APP + ' arbitrary PRIVATE_SENTINEL')])
        self.assertEqual(result['matching_records'], 3)
        self.assertEqual(result['rows'], [])
        for payload in (b'{}', b'NaN', b'[{"x":1,"x":2}]', b'\xff'):
            self.assertEqual(observe.launch_service_records(payload, START, END)['state'], 'UNKNOWN')

    def test_limits_are_explicit_and_no_oversized_or_tail_record_is_classified(self):
        self.assertTrue(observe.launch_service_records(b' ' * (observe.LIMIT + 1), START, END)['input_partial'])
        result = self.classify([row()] * 513)
        self.assertEqual(result['matching_records'], 512)
        self.assertEqual(len(result['rows']), 32)
        self.assertTrue(result['input_partial'])
        self.assertEqual(self.classify([row(APP + ' signature ' + 'x' * 16384)])['rows'], [])
        for start, end in ((True, END), (START, START), (END, START), (START, START + 900001)):
            self.assertEqual(observe.launch_service_records(b'[]', start, end)['state'], 'UNKNOWN')

    def test_query_is_read_only_owned_timed_private_and_preserves_failures(self):
        with tempfile.TemporaryDirectory() as temporary:
            private = Path(temporary)
            captured = []
            def run(args, **kwargs):
                self.assertEqual(args[:10], ['xcrun', 'simctl', 'spawn', DEVICE, 'log', 'show',
                    '--info', '--style', 'json', '--start'])
                self.assertEqual(kwargs['timeout'], 20)
                self.assertEqual(kwargs['stderr'], subprocess.DEVNULL)
                self.assertIn('eventMessage CONTAINS "' + APP + '"', args[-1])
                captured.append(kwargs['stdout'])
                kwargs['stdout'].write(json.dumps([row()]).encode())
                return SimpleNamespace(returncode=0)
            with mock.patch.object(observe.subprocess, 'run', side_effect=run):
                result = observe.launch_services(private, DEVICE, START, END)
            self.assertEqual(result['query'], 'EXIT_ZERO')
            self.assertEqual(result['matching_records'], 1)
            self.assertTrue(captured[0].closed)
            self.assertEqual(list(private.iterdir()), [])
            for failure, expected in ((subprocess.TimeoutExpired('private', 20), 'TIMEOUT'),
                                      (OSError('PRIVATE_SENTINEL'), 'UNAVAILABLE')):
                with mock.patch.object(observe.subprocess, 'run', side_effect=failure):
                    self.assertEqual(observe.launch_services(private, DEVICE, START, END)['query'], expected)
            with mock.patch.object(observe.subprocess, 'run', return_value=SimpleNamespace(returncode=1)):
                self.assertEqual(observe.launch_services(private, DEVICE, START, END)['query'], 'NONZERO_EXIT')
            with mock.patch.object(observe.subprocess, 'run') as child:
                self.assertEqual(observe.launch_services(private, 'booted', START, END)['query'], 'NOT_RUN')
                self.assertEqual(observe.launch_services(private, DEVICE, None, END)['query'], 'NOT_RUN')
                child.assert_not_called()

    def test_actual_startup_failure_hook_passes_original_window_and_keeps_collector_failure_nonfatal(self):
        with tempfile.TemporaryDirectory() as temporary:
            private = Path(temporary)
            saved, calls = [], []
            def run(args, **kwargs):
                calls.append(args)
                if '--style' in args and args[args.index('--style') + 1] == 'json':
                    kwargs['stdout'].write(json.dumps([row()]).encode())
                    return SimpleNamespace(returncode=0)
                return SimpleNamespace(returncode=1)
            with mock.patch.object(native, 'PRIVATE', private), mock.patch.object(native, 'PLATFORM', 'IOS'), \
                    mock.patch.object(native, 'read', side_effect=lambda: {'commands': [],
                        'built_artifact': {'executable': 'hexa_keeper_dev'}}), \
                    mock.patch.object(native, 'save', side_effect=saved.append), \
                    mock.patch.object(native.time, 'time', return_value=END / 1000), \
                    mock.patch.object(native.subprocess, 'run', side_effect=run), mock.patch('builtins.print'):
                native.record_startup_failure(private / 'missing.xml', DEVICE, START)
            result = saved[-1]['startup_diagnostics']['command_observation']['launch_services']
            self.assertEqual(result['matching_records'], 1)
            self.assertEqual(sum('--style' in args and args[args.index('--style') + 1] == 'json'
                for args in calls), 1)


if __name__ == '__main__':
    unittest.main()
