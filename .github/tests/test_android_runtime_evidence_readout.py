import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('readout', ROOT / '.github/native/android_runtime_evidence_readout.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class ExactReadoutTests(unittest.TestCase):
    def metadata(self):
        return {'schema': 1, 'source_sha': m.SOURCE, 'platform': 'ANDROID', 'diagnostic_only': True,
                'run_id': str(m.RUN), 'run_attempt': '1',
                'workflow_ref': 'KeeperCommunity/bitcoin-keeper-private/.github/workflows/keeper-private-android-runtime-reuse.yml@refs/pull/73/merge',
                'build_execution_scope': 'REUSED_EXACT_ORIGINAL_PRIVATE_DEBUG_APK_NO_CURRENT_RUN_COMPILATION_OR_RELEASE',
                'build': 'PASS', 'smoke': 'PASS', 'native_probe': 'PASS', 'r5_features': 'PASS',
                'product_ui': {'status': 'FAIL', 'samples': [{'status': 'FAIL',
                    'failure_observation': {'junit': {'failed_selector': 'create_passcode', 'failure_kind': 'ASSERT_VISIBLE'}},
                    'pin_onboarding_progress': {'completed_markers': ['skip_visible'], 'next_marker': 'skip_tapped'},
                    'arbitrary_private_key': 'PRIVATE_SENTINEL', 'scope': 'PRIVATE_SENTINEL'}]}}

    def archive(self, value, name='metadata.json', extra=False):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr(name, json.dumps(value))
            if extra:
                z.writestr('unexpected.txt', 'PRIVATE_SENTINEL')
        return output.getvalue()

    def decode(self, raw):
        return m.decode(raw, hashlib.sha256(raw).hexdigest(), len(raw))

    def test_actual_collector_vocabulary_projects_only_closed_observations(self):
        result = m.summary(self.decode(self.archive(self.metadata())), m.vocabulary())
        encoded = json.dumps(result)
        self.assertNotIn('PRIVATE_SENTINEL', encoded)
        self.assertNotIn('arbitrary_private_key', encoded)
        self.assertEqual(result['product_samples'][0]['failure_observation']['junit']['failed_selector'], 'create_passcode')
        self.assertEqual(result['product_samples'][0]['pin_onboarding_progress']['next_marker'], 'skip_tapped')
        self.assertEqual(result['product_samples'][0]['scope'], 'UNPROJECTED')
        self.assertFalse(result['native_acceptance'])
        self.assertEqual(result['phase_results']['smoke'], 'PASS')
        self.assertEqual(result['product_status'], 'FAIL')

    def test_size_digest_source_run_and_mode_are_required(self):
        raw = self.archive(self.metadata())
        with self.assertRaises(ValueError):
            m.decode(raw, '0' * 64, len(raw))
        with self.assertRaises(ValueError):
            m.decode(raw, hashlib.sha256(raw).hexdigest(), len(raw) + 1)
        for key, bad in [('schema', True), ('source_sha', '0' * 40), ('run_id', '999'),
                         ('run_attempt', '2'), ('diagnostic_only', False), ('platform', 'IOS'),
                         ('workflow_ref', 'other'), ('build_execution_scope', 'compiled')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                value = self.metadata(); value[key] = bad
                self.decode(self.archive(value))

    def test_archive_must_have_one_literal_regular_json_member(self):
        for name, extra in [('../metadata.json', False), ('metadata.json', True)]:
            with self.subTest(name=name, extra=extra), self.assertRaises(ValueError):
                self.decode(self.archive(self.metadata(), name, extra))
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as z:
            row = zipfile.ZipInfo('metadata.json'); row.create_system = 3; row.external_attr = 0o120777 << 16
            z.writestr(row, 'target')
        with self.assertRaises(ValueError): self.decode(output.getvalue())

    def test_duplicate_json_and_nonfinite_or_unbounded_structures_rejected(self):
        for raw in [b'{"schema":1,"schema":1}', b'{"x":NaN}']:
            with self.subTest(raw=raw), self.assertRaises(ValueError): m.strict(raw)
        for value in [float('inf'), 2**53, [None] * 257]:
            with self.subTest(value=type(value)), self.assertRaises(ValueError): m.project(value, set())

    def test_counts_exclude_bool_and_invalid_states_never_gain_credit(self):
        value = self.metadata(); value.update(smoke='UNKNOWN', native_probe_test_cases=True, r5_features_test_cases=4097)
        result = m.summary(value, m.vocabulary())
        self.assertEqual(result['phase_results']['smoke'], 'UNKNOWN')
        self.assertEqual(result['case_counts'], {})
        self.assertFalse(result['native_acceptance'])


if __name__ == '__main__':
    unittest.main()
