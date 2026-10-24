"""Original-byte binding and private-output controls, using synthetic receipts only."""
from contextlib import redirect_stdout
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import zipfile

SPEC = importlib.util.spec_from_file_location('d270_android_readout',
    Path(__file__).resolve().parents[1] / 'scripts/read-d270-android-artifact.py')
reader = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reader)
FIXTURE_SPEC = importlib.util.spec_from_file_location('fixed_android_fixtures',
    Path(__file__).with_name('test_044_android_artifact_readout.py'))
fixtures = importlib.util.module_from_spec(FIXTURE_SPEC)
FIXTURE_SPEC.loader.exec_module(fixtures)


def fixture():
    value = fixtures.observed_data()
    value.update(source_sha=reader.SOURCE, workflow_sha=reader.WORKFLOW,
        workflow_ref=reader.WORKFLOW_REF, run_id=reader.RUN, run_attempt=reader.ATTEMPT)
    value['commands'] = [{'PRIVATE_PATH_OR_OTHER_UNEXPORTED_CONTENT': 'PRIVATE_SENTINEL'}]
    value['product_ui']['performance_scope'] = 'PRIVATE_SENTINEL'
    value['product_ui']['samples'][0]['unselected_optional_field'] = 'PRIVATE_SENTINEL'
    return value


def archive(data=None, raw=None, extra=False):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as output:
        output.writestr('android/metadata.json', raw if raw is not None else json.dumps(fixture() if data is None else data))
        if extra: output.writestr('raw.log', 'PRIVATE_SENTINEL')
    return stream.getvalue()


def bound(blob):
    return mock.patch.multiple(reader, ZIP_SIZE=len(blob), DIGEST=hashlib.sha256(blob).hexdigest())


class D270AndroidReadoutTests(unittest.TestCase):
    def project(self, data=None, blob=None):
        blob = archive(data) if blob is None else blob
        with bound(blob): return reader.project(blob)

    def test_bounded_failure_facts_survive_and_unselected_content_never_exports(self):
        data = fixture(); result = self.project(data)
        self.assertEqual(result['scope'], 'OBSERVATIONS_ONLY_NOT_NATIVE_ACCEPTANCE_OR_CAUSE')
        self.assertEqual(result['observations']['smoke'], 'PASS')
        self.assertEqual(result['observations']['product_ui']['status'], 'FAIL')
        self.assertEqual(result['observations']['product_ui']['samples'][0]['failure_observation'],
                         data['product_ui']['samples'][0]['failure_observation'])
        self.assertEqual(result['observations']['product_ui']['samples'][0]['failed_assertion_snapshot'],
                         data['product_ui']['samples'][0]['failed_assertion_snapshot'])
        self.assertEqual(len(result['metadata_sha256']), 64)
        self.assertNotIn('commands', result['observations'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_wrong_source_platform_attempt_workflow_and_unknown_root_reject(self):
        for key, value in [('source_sha', '0' * 40), ('platform', 'IOS'), ('run_attempt', '2'),
                           ('workflow_sha', '0' * 40), ('raw_logs', 'PRIVATE_SENTINEL')]:
            data = fixture(); data[key] = value
            with self.subTest(key=key), self.assertRaises(Exception): self.project(data)

    def test_projected_raw_values_unknown_nested_data_and_bad_snapshot_types_reject(self):
        changes = [lambda s: s['failure_observation'].update(raw_logs='PRIVATE_SENTINEL'),
            lambda s: s['failure_observation']['hierarchy']['flags'].update(onboarding_skip=1),
            lambda s: s['failed_assertion_snapshot']['skip'].update(clickable='false'),
            lambda s: s['failed_assertion_snapshot'].update(node_count=10001),
            lambda s: s['failed_assertion_snapshot'].update(raw='PRIVATE_SENTINEL'),
            lambda s: s['android_runtime_diagnostic']['facts'].update(message='PRIVATE_SENTINEL'),
            lambda s: s['failed_assertion_snapshot']['failed_assertion'].update(selector='onboarding_skip')]
        for change in changes:
            data = fixture(); change(data['product_ui']['samples'][0])
            with self.subTest(change=change), self.assertRaises(Exception): self.project(data)

    def test_missing_failed_sample_wrong_product_types_and_unsafe_json_reject(self):
        for product in [None, [], {'status': 'PASS', 'samples': [{}]},
                        {'status': 'FAIL', 'samples': []}, {'status': 'FAIL', 'samples': [None]},
                        {'status': 'FAIL', 'samples': [{}] * 7}]:
            data = fixture(); data['product_ui'] = product
            with self.subTest(product=product), self.assertRaises(Exception): self.project(data)
        for blob in [archive(raw='{"schema":1,"schema":1}'), archive(raw='{"schema":NaN}'),
                     archive(extra=True), archive() + b'PRIVATE_SENTINEL']:
            with self.subTest(size=len(blob)), self.assertRaises(Exception): self.project(blob=blob)

    def test_original_digest_kernel_change_and_private_file_alias_fail_without_observations(self):
        blob = archive()
        with self.assertRaises(Exception): reader.project(blob)
        with bound(blob), mock.patch.object(reader, 'KERNEL_SHA256', '0' * 64), self.assertRaises(Exception):
            reader.project(blob)
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {'RUNNER_TEMP': directory}):
            source = Path(directory) / 'original.zip'; source.write_bytes(blob); source.chmod(0o600)
            target = Path(directory) / 'r5-d270-android-fixed.zip'; target.symlink_to(source)
            with bound(blob), redirect_stdout(io.StringIO()) as output:
                self.assertEqual(reader.main([]), 1)
            self.assertEqual(output.getvalue(), 'D270_ANDROID_OBSERVATION_READOUT_FAILED:PRIVATE_FILE\n')


if __name__ == '__main__':
    unittest.main()
