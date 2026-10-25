"""Host contracts for native evidence validation; no native acceptance."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('native_features', Path(__file__).resolve().parents[1] / 'native/hosted_native.py')
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)


class FeatureEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        for path in native.R5_SOURCES:
            file = self.root / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('public synthetic current source')
        committed_sources = {path: (self.root / path).read_bytes() for path in native.R5_SOURCES}
        committed_read = mock.patch.object(native.subprocess, 'check_output',
            side_effect=lambda args, **kwargs: committed_sources[args[-1].removeprefix('HEAD:')])
        committed_read.start()
        self.addCleanup(committed_read.stop)
        patch = mock.patch.multiple(native, ROOT=self.root, EVIDENCE=self.root / 'metadata.json')
        patch.start()
        self.addCleanup(patch.stop)
        self.payload = {
            'schema': 1, 'scope': 'production-worker-native-storage', 'status': 'PASS', 'stage': 'pass',
            'scenarios': [{'id': item, 'status': 'PASS'} for item in native.R5_SCENARIOS],
            'measurements': [{'iteration': index, 'probe_ready_ms': 100.5, 'setup_first_wallet_ms': 25} for index in range(1, 6)],
            'limits': native.R5_LIMITS,
            'source_functions': [{'path': path, 'sha256': hashlib.sha256((self.root / path).read_bytes()).hexdigest(), 'names': names}
                                 for path, names in native.R5_SOURCES.items()],
        }

    def test_only_bounded_metadata_survives_exact_source_validation(self):
        self.payload['private_message'] = 'PRIVATE_SENTINEL'
        evidence = native.validate_r5_feature_evidence(json.dumps(self.payload))
        self.assertEqual(evidence['status'], 'PASS')
        self.assertEqual(len(evidence['measurements']), 5)
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(evidence))
        self.assertIn('probe-and-worker-timings-not-product-startup-ux', evidence['limits'])

    def test_incomplete_wrong_scope_or_failed_scenarios_cannot_supply_credit(self):
        for field, value in [('schema', 2), ('scope', 'full-app-acceptance'), ('status', 'FAIL'),
                             ('stage', 'running'), ('scenarios', self.payload['scenarios'][:-1]),
                             ('measurements', self.payload['measurements'][:-1]), ('limits', [])]:
            with self.subTest(field=field):
                payload = {**self.payload, field: value}
                with self.assertRaises(ValueError):
                    native.validate_r5_feature_evidence(json.dumps(payload))

    def test_failed_skipped_or_duplicate_scenario_is_rejected(self):
        for mutation in ['failure', 'skip', 'duplicate']:
            payload = copy.deepcopy(self.payload)
            if mutation == 'duplicate':
                payload['scenarios'][1] = payload['scenarios'][0]
            else:
                payload['scenarios'][0]['status'] = mutation
            with self.assertRaises(ValueError):
                native.validate_r5_feature_evidence(json.dumps(payload))

    def test_measurements_must_be_raw_ordered_finite_bounded_numbers(self):
        for field, value in [('iteration', 2), ('iteration', True), ('probe_ready_ms', float('nan')), ('probe_ready_ms', True),
                             ('probe_ready_ms', -1), ('setup_first_wallet_ms', 600001),
                             ('setup_first_wallet_ms', '25')]:
            with self.subTest(field=field, value=value):
                payload = copy.deepcopy(self.payload)
                payload['measurements'][0][field] = value
                with self.assertRaises(ValueError):
                    native.validate_r5_feature_evidence(json.dumps(payload))

    def test_stale_source_wrong_function_selection_and_oversized_data_fail_closed(self):
        payload = copy.deepcopy(self.payload)
        payload['source_functions'][0]['sha256'] = '0' * 64
        with self.assertRaises(ValueError):
            native.validate_r5_feature_evidence(json.dumps(payload))
        payload = copy.deepcopy(self.payload)
        payload['source_functions'][0]['names'] = ['otherFunction']
        with self.assertRaises(ValueError):
            native.validate_r5_feature_evidence(json.dumps(payload))
        with self.assertRaises(ValueError):
            native.validate_r5_feature_evidence(' ' * 65537)

    def test_disk_reserve_is_recorded_and_exhaustion_stops_without_cleanup(self):
        native.save({})
        with mock.patch.object(native.shutil, 'disk_usage', return_value=mock.Mock(free=1024)), \
             mock.patch.object(native.shutil, 'rmtree') as cleanup:
            with self.assertRaisesRegex(RuntimeError, 'disk reserve'):
                native.disk_preflight('before_native_build')
        cleanup.assert_not_called()
        evidence = native.read()['disk_preflight'][0]
        self.assertEqual(evidence['result'], 'FAIL')
        self.assertEqual(evidence['free_bytes'], 1024)
        self.assertEqual(evidence['minimum_free_bytes'], 12 * 1024 ** 3)

    def test_feature_runtime_requires_successful_product_startup_before_extraction(self):
        native.save({'build': 'PASS', 'smoke': 'NOT RUN'})
        with mock.patch.object(native.subprocess, 'Popen') as process:
            with self.assertRaisesRegex(RuntimeError, 'app startup smoke'):
                native.run_phase('features')
        process.assert_not_called()
        self.assertEqual(native.read()['r5_features'], 'FAIL')

    def test_mutated_working_source_and_matching_probe_hash_cannot_impersonate_head(self):
        path = self.payload['source_functions'][0]['path']
        changed = b'altered public source after build'
        (self.root / path).write_bytes(changed)
        self.payload['source_functions'][0]['sha256'] = hashlib.sha256(changed).hexdigest()
        with self.assertRaisesRegex(ValueError, 'committed candidate'):
            native.validate_r5_feature_evidence(json.dumps(self.payload))
