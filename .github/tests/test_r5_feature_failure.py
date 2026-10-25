"""Failure-path privacy, source binding and existing-result retention controls."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

BASE = Path(__file__).resolve().parents[1] / 'native'
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
failure = load('r5_failure_tests', BASE / 'r5_feature_failure.py')
native = load('r5_failure_native_contract', BASE / 'hosted_native.py')


class FeatureFailureTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.sources = [{'path': 'public-worker.ts', 'sha256': 'a' * 64, 'names': ['worker']}]

    def document(self, stage='failed'):
        count = 0 if stage == 'failed' else 5 if stage == 'pass' else 2
        result = {'schema': 1, 'scope': 'production-worker-native-storage',
            'status': {'failed': 'FAIL', 'next': 'IN PROGRESS', 'pass': 'PASS'}[stage], 'stage': stage,
            'source_functions': copy.deepcopy(self.sources), 'limits': native.R5_LIMITS,
            'scenarios': [{'id': name, 'status': 'FAIL' if stage == 'failed' else
                'NOT RUN' if stage == 'next' and name == 'native-worker-process-relaunch-counts'
                else 'PASS'} for name in native.R5_SCENARIOS],
            'measurements': [{'iteration': n, 'probe_ready_ms': 12.5,
                              'setup_first_wallet_ms': 25} for n in range(1, count + 1)]}
        if stage == 'failed':
            result['failure'] = 'partial-delete-not-rolled-back'
        return result

    def project(self, value):
        result = failure.project_document(value if type(value) is str else json.dumps(value),
            self.sources, native.R5_SCENARIOS, native.R5_LIMITS)
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        return result

    def test_failed_next_and_pass_documents_are_only_last_persisted_observations(self):
        for stage, count in [('failed', 0), ('next', 2), ('pass', 5)]:
            result = self.project(self.document(stage))
            self.assertEqual(result['state'], 'OBSERVED')
            self.assertEqual(result['source_binding'], 'MATCH')
            self.assertEqual(result['measurement_count'], count)
            self.assertEqual(result['last_persisted_iteration'], None if stage == 'failed' else count)
        h = SimpleNamespace(PRIVATE=self.root, R5_SCENARIOS=native.R5_SCENARIOS,
                            R5_LIMITS=native.R5_LIMITS)
        with mock.patch.object(failure, 'expected_sources', return_value=self.sources), \
             mock.patch.object(failure, 'read_document', return_value=json.dumps(self.document('pass'))):
            result = failure.collect(h, 'emulator-5554', self.root / 'features-junit.xml')
        self.assertFalse(result['native_acceptance'])
        self.assertEqual(result['freshness'], 'LAST_PERSISTED_PROCESS_UNKNOWN')
        self.assertEqual(result['document']['status'], 'PASS')
        self.assertEqual(result['junit']['state'], 'UNAVAILABLE')

    def test_source_mismatch_extra_fields_and_invalid_shapes_reject_without_raw_data(self):
        for mutation in [lambda d: d['source_functions'][0].update(sha256='b' * 64),
                         lambda d: d.update(private_seed='PRIVATE_SENTINEL'),
                         lambda d: d.update(schema=True), lambda d: d.update(status='PASS'),
                         lambda d: d.update(limits=[]), lambda d: d['scenarios'].pop(),
                         lambda d: d.update(failure={'secret': 'PRIVATE_SENTINEL'})]:
            data = self.document(); mutation(data)
            self.assertEqual(self.project(data)['state'], 'INVALID')
        for raw in [' ' * 65537, '{"schema":1,"schema":1}', '{"x":NaN}', '\ufffd', '[' * 2000]:
            self.assertEqual(self.project(raw)['state'], 'INVALID')
        for value in [True, float('nan'), -1, 600001, 'PRIVATE_SENTINEL']:
            data = self.document('next'); data['measurements'][0]['probe_ready_ms'] = value
            self.assertEqual(self.project(data)['state'], 'INVALID')

    def test_unknown_failure_code_stays_unknown_without_exporting_its_value(self):
        data = self.document(); data['failure'] = 'PRIVATE_SENTINEL unknown native exception'
        result = self.project(data)
        self.assertEqual(result['state'], 'OBSERVED')
        self.assertEqual(result['failure_code'], 'UNKNOWN')
        self.assertEqual(self.project(self.document())['failure_code'], 'partial-delete-not-rolled-back')

    def test_fixed_junit_selector_only_and_ambiguous_or_injected_messages_stay_unknown(self):
        def junit(message, file='.github/native/r5_features.yaml'):
            return ('<testsuites><testsuite><testcase file="' + file + '" status="ERROR">'
                    '<failure>' + message + '</failure></testcase></testsuite></testsuites>')
        for selector in failure.SELECTORS:
            result = failure.project_junit(junit('Assertion is false: id: ' + selector + ' is visible'))
            self.assertEqual(result['failed_selector'], selector)
            self.assertEqual(result['failure_kind'], 'ASSERT_VISIBLE')
        for raw in [junit('Assertion is false: id: r5-features-next is visible PRIVATE_SENTINEL'),
                    junit('PRIVATE_SENTINEL\nAssertion is false: id: r5-features-next is visible'),
                    junit('Assertion is false: id: r5-features-next is visible', 'PRIVATE_SENTINEL'),
                    '<!DOCTYPE testsuites><testsuites/>', '<testsuites/>', ' ' * (1024 * 1024 + 1)]:
            result = failure.project_junit(raw)
            self.assertIsNone(result['failed_selector'])
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_private_read_rejects_symlinks_non_utf8_and_oversized_files(self):
        leaf = self.root / 'features-junit.xml'; leaf.write_text('safe')
        self.assertEqual(failure.read_private(self.root, leaf.name, 20), 'safe')
        target = self.root / 'target'; target.write_text('PRIVATE_SENTINEL')
        leaf.unlink(); leaf.symlink_to(target)
        with self.assertRaises(OSError): failure.read_private(self.root, leaf.name, 20)
        leaf.unlink()
        for raw in [b'x' * 21, b'\xff']:
            leaf.write_bytes(raw)
            with self.assertRaises((ValueError, UnicodeError)):
                failure.read_private(self.root, leaf.name, 20)

    def test_android_observation_is_one_bounded_read_without_launch_or_retry(self):
        command = mock.Mock(return_value=json.dumps(self.document()))
        h = SimpleNamespace(PLATFORM='ANDROID', APP_IDS={'ANDROID': 'fixed.app'}, command=command)
        self.assertEqual(failure.read_document(h, 'emulator-5554'), json.dumps(self.document()))
        args, kwargs = command.call_args
        self.assertEqual(args[0], ['adb', '-s', 'emulator-5554', 'exec-out', 'run-as', 'fixed.app',
                                  'head', '-c', '65537', 'files/keeper-r5-native-evidence.json'])
        self.assertEqual(kwargs, {'timeout': 15, 'capture': True, 'error_details': False})
        command.reset_mock()
        with self.assertRaises(ValueError): failure.read_document(h, 'booted')
        command.assert_not_called()

    def test_ios_read_is_confined_to_owned_uuid_data_and_has_its_own_short_budget(self):
        device = '12345678-1234-1234-1234-123456789ABC'
        app = '87654321-1234-1234-1234-123456789ABC'
        container = self.root / 'Library/Developer/CoreSimulator/Devices' / device / 'data/Containers/Data/Application' / app
        documents = container / 'Documents'; documents.mkdir(parents=True)
        payload = json.dumps(self.document())
        (documents / 'keeper-r5-native-evidence.json').write_text(payload)
        command = mock.Mock(return_value=str(container))
        h = SimpleNamespace(PLATFORM='IOS', APP_IDS={'IOS': 'fixed.app'}, command=command)
        with mock.patch.object(failure.Path, 'home', return_value=self.root):
            self.assertEqual(failure.read_document(h, device), payload)
            command.assert_called_once_with(
                ['xcrun', 'simctl', 'get_app_container', device, 'fixed.app', 'data'],
                'Locate failed R5 worker evidence', timeout=15, capture=True, error_details=False)
            command.return_value = str(self.root / app)
            with self.assertRaises(ValueError): failure.read_document(h, device)

    def test_committed_source_binding_rejects_matching_but_modified_working_source(self):
        path = self.root / 'worker.ts'; path.write_bytes(b'committed')
        h = SimpleNamespace(ROOT=self.root, R5_SOURCES={'worker.ts': ['worker']})
        with mock.patch.object(failure.subprocess, 'check_output', return_value=b'committed'):
            expected = failure.expected_sources(h)
            self.assertEqual(expected[0]['sha256'], hashlib.sha256(b'committed').hexdigest())
            path.write_bytes(b'PRIVATE_SENTINEL modified')
            with self.assertRaises(ValueError): failure.expected_sources(h)

    def test_observation_read_failure_cannot_raise_or_supply_native_acceptance(self):
        h = SimpleNamespace(PRIVATE=self.root, R5_SCENARIOS=native.R5_SCENARIOS,
                            R5_LIMITS=native.R5_LIMITS)
        with mock.patch.object(failure, 'expected_sources', return_value=self.sources), \
             mock.patch.object(failure, 'read_document', side_effect=RuntimeError('PRIVATE_SENTINEL')):
            result = failure.collect(h, 'emulator-5554', self.root / 'features-junit.xml')
        self.assertEqual(result['document']['state'], 'UNAVAILABLE')
        self.assertFalse(result['native_acceptance'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
