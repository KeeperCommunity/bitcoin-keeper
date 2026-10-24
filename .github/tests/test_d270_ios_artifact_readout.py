"""Portable projection/identity/privacy controls; no original native receipt fabricated."""
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

SPEC = importlib.util.spec_from_file_location('d270_readout',
    Path(__file__).resolve().parents[1] / 'scripts/read-d270-ios-artifact.py')
reader = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reader)


def fixture():
    return {'schema': 1, 'source_sha': reader.SOURCE, 'workflow_sha': reader.WORKFLOW,
        'workflow_ref': reader.WORKFLOW_REF, 'run_id': reader.RUN, 'run_attempt': reader.ATTEMPT,
        'platform': 'IOS', 'diagnostic_only': True, 'build': 'PASS', 'smoke': 'FAIL',
        'native_probe': 'NOT RUN', 'r5_features': 'NOT RUN', 'hardware': 'NOT RUN', 'signing': 'NOT RUN',
        'app_id': 'io.hexawallet.hexakeeper.dev', 'install_succeeded': True,
        'installed_artifact_verified': True, 'toolchain': {'ios_simulator_signature': {
            'verified': True, 'scope': 'ADHOC_SIMULATOR_ONLY_NOT_RELEASE_SIGNING',
            'bundle_id': 'io.hexawallet.hexakeeper.dev', 'entitlements_sha256': 'a' * 64,
            'embedded_code_count': 1}},
        'commands': [{'PRIVATE_PATH_OR_OTHER_UNEXPORTED_CONTENT': 'PRIVATE_SENTINEL'}]}


def observation():
    flags = dict.fromkeys(('credential_error', 'retry', 'logbox_controls', 'redbox_resource', 'loading',
        'login', 'welcome_back', 'logbox_error_header', 'logbox_warning_header',
        'logbox_syntax_footer', 'logbox_counter'), None)
    return {'scope': reader.STARTUP_SCOPE, 'collection_errors': [],
            'hierarchy': dict(flags, observation_state='UNKNOWN', snapshot_count=0, scope=reader.HIERARCHY_SCOPE)}


def archive(data=None, raw=None, extra=False):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as output:
        output.writestr('ios/metadata.json', raw if raw is not None else json.dumps(fixture() if data is None else data))
        if extra: output.writestr('raw.log', 'PRIVATE_SENTINEL')
    return stream.getvalue()


def bound(blob):
    return mock.patch.multiple(reader, ZIP_SIZE=len(blob), DIGEST=hashlib.sha256(blob).hexdigest())


class D270ReadoutTests(unittest.TestCase):
    def project(self, data=None, blob=None):
        blob = archive(data) if blob is None else blob
        with bound(blob): return reader.project(blob)

    def test_projection_keeps_source_and_false_failure_facts_without_exporting_commands(self):
        value = self.project()
        self.assertEqual(value['scope'], 'OBSERVATIONS_ONLY_NOT_NATIVE_ACCEPTANCE_OR_CAUSE')
        self.assertEqual(value['observations']['smoke'], 'FAIL')
        self.assertEqual(value['observations']['native_probe'], 'NOT RUN')
        self.assertNotIn('commands', value['observations'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(value))
        self.assertEqual(len(value['metadata_sha256']), 64)

    def test_wrong_source_attempt_and_effective_signature_policy_reject(self):
        mutations = [lambda d: d.update(source_sha='0' * 40), lambda d: d.update(run_attempt='2'),
            lambda d: d.update(workflow_sha='0' * 40), lambda d: d.update(raw_logs='PRIVATE_SENTINEL'),
            lambda d: d['toolchain']['ios_simulator_signature'].update(verified=False),
            lambda d: d['toolchain']['ios_simulator_signature'].update(bundle_id='FOREIGN'),
            lambda d: d['toolchain']['ios_simulator_signature'].update(extra='PRIVATE_SENTINEL')]
        for mutation in mutations:
            data = fixture(); mutation(data)
            with self.subTest(mutation=mutation), self.assertRaises(Exception): self.project(data)

    def test_exported_unknown_or_raw_nested_values_are_rejected(self):
        for value in [{'raw_logs': 'PRIVATE_SENTINEL'}, {'scope': 'PRIVATE_SENTINEL'},
                      {'hierarchy': {'text': 'PRIVATE_SENTINEL'}}]:
            data = fixture(); data['startup_diagnostics'] = value
            with self.subTest(value=value), self.assertRaises(Exception): self.project(data)

    def test_current_producer_conservative_scopes_are_retained_and_strict(self):
        data = fixture(); data['startup_observation'] = observation()
        self.assertEqual(self.project(data)['observations']['startup_observation'], data['startup_observation'])
        for mutation in [lambda d: d['startup_observation'].update(scope='UNKNOWN'),
                         lambda d: d['startup_observation']['hierarchy'].pop('scope'),
                         lambda d: d['startup_observation']['hierarchy'].update(scope='UNKNOWN'),
                         lambda d: d['startup_observation']['hierarchy'].update(text='PRIVATE_SENTINEL'),
                         lambda d: d['startup_observation']['hierarchy'].update(credential_error='false')]:
            changed = copy.deepcopy(data); mutation(changed)
            with self.subTest(mutation=mutation), self.assertRaises(Exception): self.project(changed)

    def test_original_digest_archive_layout_duplicate_json_and_private_file_alias_reject(self):
        blob = archive()
        with self.assertRaises(Exception): reader.project(blob)
        for value in [archive(extra=True), archive(raw='{"schema":1,"schema":1}'), blob + b'PRIVATE_SENTINEL']:
            with self.subTest(length=len(value)), self.assertRaises(Exception): self.project(blob=value)
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {'RUNNER_TEMP': directory}):
            source = Path(directory) / 'original.zip'; source.write_bytes(blob); source.chmod(0o600)
            target = Path(directory) / 'r5-d270-ios-fixed.zip'; target.symlink_to(source)
            with bound(blob), redirect_stdout(io.StringIO()) as output:
                self.assertEqual(reader.main([]), 1)
            self.assertEqual(output.getvalue(), 'D270_IOS_OBSERVATION_READOUT_FAILED:PRIVATE_FILE\n')


if __name__ == '__main__':
    unittest.main()
