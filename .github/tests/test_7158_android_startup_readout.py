"""Synthetic exact-artifact and private startup projection controls."""
from contextlib import redirect_stdout
import ast
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import tempfile
import unittest
from unittest import mock
import zipfile

SPEC = importlib.util.spec_from_file_location('startup_7158_reader',
    Path(__file__).resolve().parents[1] / 'scripts/read-7158-android-startup-artifact.py')
reader = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reader)


def producer_failures():
    # This unchanged function's segment hash is independently bound to the
    # actual 3f4 producer. Execute only that fixed pure parser, not the runner.
    source = (Path(__file__).resolve().parents[1] / 'native/hosted_native.py').read_text()
    definition = next(node for node in ast.parse(source).body
        if isinstance(node, ast.FunctionDef) and node.name == 'maestro_failure_details')
    segment = ast.get_source_segment(source, definition)
    assert hashlib.sha256(segment.encode()).hexdigest() == (
        '4e89c67a3503e4004d013a6845433e10a03f1e62793441d6e9b99a261e18e0c1')
    scope = {'re': re, 'APP_IDS': {'ANDROID': 'io.hexawallet.keeper.development'}}
    exec(compile(ast.Module(body=[definition], type_ignores=[]), '<pinned-pure-producer>', 'exec'), scope)
    return scope['maestro_failure_details']('Assertion is false: Create a passcode PRIVATE_SENTINEL')


def fixture():
    return {'schema': 1, 'source_sha': reader.SOURCE, 'workflow_sha': reader.WORKFLOW,
        'workflow_ref': reader.WORKFLOW_REF, 'run_id': reader.RUN, 'run_attempt': reader.ATTEMPT,
        'platform': 'ANDROID', 'diagnostic_only': True, 'build': 'PASS', 'smoke': 'FAIL',
        'native_probe': 'NOT RUN', 'r5_features': 'NOT RUN',
        'hardware': 'NOT RUN', 'signing': 'NOT RUN',
        'startup_diagnostics': {'metro_errors': ['METRO_ERROR'], 'maestro': {
            'failed_commands': [], 'testcase_failures': producer_failures(),
            'report': 'PRESENT', 'testcase_statuses': ['ERROR']}},
        'startup_observation': {'scope': 'Owned emulator launch window; fixed facts only.',
            'collection_errors': [], 'metro': {'rows': [
                {'stage': 'APP_WINDOW', 'kind': 'ERROR', 'event': 'bundling_error',
                 'error_type': 'TypeError', 'categories': ['TYPE']},
                {'stage': 'APP_WINDOW', 'kind': 'RESPONSE', 'request': 'ENTRY_BUNDLE',
                 'outer_http_status': 500}], 'invalid_rows': 0, 'input_truncated': False,
                 'row_limit_reached': False, 'emitter_cap_observed': False,
                 'scope': 'Outer HTTP status only; multipart terminal status is not observed.'},
            'hierarchy': {'raw': 'PRIVATE_SENTINEL'}, 'unselected': 'PRIVATE_SENTINEL'},
        'commands': [{'raw': 'PRIVATE_SENTINEL'}]}


def archive(data=None, raw=None, extra=False):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as output:
        output.writestr('android/metadata.json', raw if raw is not None else json.dumps(
            fixture() if data is None else data))
        if extra:
            output.writestr('raw.log', 'PRIVATE_SENTINEL')
    return stream.getvalue()


def bound(blob):
    return mock.patch.multiple(reader, ZIP_SIZE=len(blob), DIGEST=hashlib.sha256(blob).hexdigest())


class Startup7158ReadoutTests(unittest.TestCase):
    def project(self, data=None, blob=None):
        blob = archive(data) if blob is None else blob
        with bound(blob):
            return reader.project(blob)

    def test_typed_metro_rows_survive_without_commands_hierarchy_or_private_fields(self):
        result = self.project()
        self.assertEqual(result['scope'], 'OBSERVATIONS_ONLY_NOT_NATIVE_ACCEPTANCE_OR_CAUSE')
        observations = result['observations']
        self.assertEqual(observations['smoke'], 'FAIL')
        self.assertEqual(observations['startup_observation']['metro']['rows'][0]['categories'], ['TYPE'])
        self.assertEqual(observations['startup_observation']['metro']['rows'][1]['outer_http_status'], 500)
        self.assertNotIn('commands', observations)
        self.assertNotIn('hierarchy', observations['startup_observation'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_every_missing_binding_fails_before_kernel_and_input(self):
        blob = archive()
        for name in ('WORKFLOW', 'WORKFLOW_REF', 'ZIP_SIZE', 'DIGEST'):
            with bound(blob), mock.patch.object(reader, name, None), \
                    mock.patch.object(reader.Path, 'read_bytes') as reading, \
                    mock.patch.object(reader.zipfile, 'ZipFile') as archive_open:
                with self.subTest(name=name), self.assertRaises(Exception):
                    reader.project(blob)
                reading.assert_not_called()
                archive_open.assert_not_called()

    def test_pinned_producer_failure_is_fixed_and_preserved_at_exact_path_only(self):
        self.assertEqual(producer_failures(), ['Maestro assertion failed: Create a passcode'])
        result = self.project()
        self.assertEqual(result['observations']['startup_diagnostics']['maestro']['testcase_failures'],
                         producer_failures())
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        for path in [('startup_diagnostics', 'metro_errors'),
                     ('startup_diagnostics', 'maestro', 'failed_commands'),
                     ('startup_observation', 'collection_errors')]:
            data = fixture()
            parent = data
            for key in path[:-1]:
                parent = parent[key]
            parent[path[-1]] = producer_failures()
            with self.subTest(path=path), self.assertRaises(Exception):
                self.project(data)

    def test_failure_receipt_requires_bounded_direct_string_list(self):
        for failures in [None, False, 1, 'Maestro assertion failed: Create a passcode', {},
                         [None], [False], [1], [[]], [producer_failures()],
                         producer_failures() * 11, ['PRIVATE_SENTINEL'], ['PASS'], ['123'],
                         ['Maestro assertion failed: Create a passcode PRIVATE_SENTINEL'],
                         ['Maestro assertion failed: Create a passcode\n']]:
            data = fixture()
            data['startup_diagnostics']['maestro']['testcase_failures'] = failures
            with self.subTest(failures=failures), self.assertRaises(Exception):
                self.project(data)
        for maestro in (None, [], 'Maestro assertion failed: Create a passcode'):
            data = fixture()
            data['startup_diagnostics']['maestro'] = maestro
            with self.subTest(maestro=maestro), self.assertRaises(Exception):
                self.project(data)

    def test_absent_failure_receipt_stays_absent_without_becoming_a_pass(self):
        for failures in ([], None):
            data = fixture()
            if failures is None:
                del data['startup_diagnostics']['maestro']['testcase_failures']
            else:
                data['startup_diagnostics']['maestro']['testcase_failures'] = failures
            result = self.project(data)
            self.assertEqual(result['observations']['smoke'], 'FAIL')
            maestro = result['observations']['startup_diagnostics']['maestro']
            self.assertEqual('testcase_failures' in maestro, failures is not None)

    def test_wrong_source_platform_attempt_workflow_or_unknown_root_reject(self):
        for key, value in [('source_sha', '0' * 40), ('platform', 'IOS'), ('run_attempt', '2'),
                           ('workflow_sha', '0' * 40), ('raw_logs', 'PRIVATE_SENTINEL')]:
            data = fixture()
            data[key] = value
            with self.subTest(key=key), self.assertRaises(Exception):
                self.project(data)

    def test_stage_mismatch_or_missing_observation_does_not_invent_a_result(self):
        for key, value in [('build', 'FAIL'), ('smoke', 'PASS'), ('native_probe', 'PASS'),
                           ('r5_features', 'PASS'), ('startup_observation', None),
                           ('startup_diagnostics', []), ('product_ui', {'status': 'FAIL'})]:
            data = fixture()
            data[key] = value
            with self.subTest(key=key), self.assertRaises(Exception):
                self.project(data)

    def test_selected_private_strings_raw_keys_and_unsafe_shapes_reject(self):
        for change in [lambda d: d['startup_diagnostics'].update(raw='PRIVATE_SENTINEL'),
                       lambda d: d['startup_observation']['metro'].update(message='PRIVATE_SENTINEL'),
                       lambda d: d['startup_observation']['metro']['rows'][0].update(error_type='PRIVATE_SENTINEL'),
                       lambda d: d['startup_observation'].update(metro=['PRIVATE_SENTINEL'])]:
            data = fixture()
            change(data)
            with self.subTest(change=change), self.assertRaises(Exception):
                self.project(data)

    def test_new_metro_coverage_flags_require_exact_path_and_boolean_type(self):
        for flag in reader.METRO_BOOLEAN_FIELDS:
            for value in (0, 1, None, 'false', [], {}):
                data = fixture()
                data['startup_observation']['metro'][flag] = value
                with self.subTest(flag=flag, value=value), self.assertRaises(Exception):
                    self.project(data)
            for parent in ('startup_diagnostics', 'startup_observation'):
                data = fixture()
                data[parent][flag] = True
                # Unselected observation fields are deliberately omitted. A
                # projected field cannot borrow the new public key elsewhere.
                if parent == 'startup_observation':
                    data[parent]['metro']['rows'][0][flag] = True
                with self.subTest(flag=flag, parent=parent), self.assertRaises(Exception):
                    self.project(data)

    def test_original_zip_identity_layout_duplicates_and_nonfinite_values_reject(self):
        with self.assertRaises(Exception):
            reader.project(archive())
        for blob in [archive(extra=True), archive() + b'PRIVATE_SENTINEL',
                     archive(raw='{"schema":1,"schema":1}'), archive(raw='{"schema":NaN}')]:
            with self.subTest(size=len(blob)), self.assertRaises(Exception):
                self.project(blob=blob)
        blob = archive()
        with bound(blob), mock.patch.object(reader, 'KERNEL_SHA256', '0' * 64), self.assertRaises(Exception):
            reader.project(blob)

    def test_symlink_file_alias_fails_without_releasing_observations(self):
        blob = archive()
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {'RUNNER_TEMP': directory}):
            source = Path(directory) / 'original.zip'
            source.write_bytes(blob)
            source.chmod(0o600)
            (Path(directory) / 'r5-7158-android-startup-fixed.zip').symlink_to(source)
            with bound(blob), redirect_stdout(io.StringIO()) as output:
                self.assertEqual(reader.main([]), 1)
            self.assertEqual(output.getvalue(), 'STARTUP_7158_ANDROID_OBSERVATION_READOUT_FAILED:PRIVATE_FILE\n')

    def test_output_never_forwards_a_private_decoder_failure(self):
        with mock.patch.object(reader, 'require_binding', side_effect=ValueError('PRIVATE_SENTINEL')), \
                redirect_stdout(io.StringIO()) as output:
            self.assertEqual(reader.main([]), 1)
        self.assertEqual(output.getvalue(), 'STARTUP_7158_ANDROID_OBSERVATION_READOUT_FAILED:SELECTION\n')


if __name__ == '__main__':
    unittest.main()
