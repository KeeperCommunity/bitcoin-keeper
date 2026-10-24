"""Portable fabricated 044 metadata controls; no native/acceptance execution."""
from contextlib import redirect_stdout
import base64
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import struct
import tempfile
import unittest
from unittest import mock
import zipfile

SPEC = importlib.util.spec_from_file_location('ios044_readout',
    Path(__file__).resolve().parents[1] / 'scripts/read-044-ios-artifact.py')
reader = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reader)


def fixture():
    return {'schema': 1, 'source_sha': reader.SOURCE, 'workflow_sha': reader.WORKFLOW,
        'workflow_ref': reader.WORKFLOW_REF, 'run_id': reader.RUN, 'run_attempt': reader.ATTEMPT,
        'platform': 'IOS', 'diagnostic_only': True, 'build': 'PASS', 'smoke': 'FAIL',
        'native_probe': 'NOT RUN', 'r5_features': 'NOT RUN', 'hardware': 'NOT RUN', 'signing': 'NOT RUN',
        'app_id': 'io.hexawallet.hexakeeper.dev', 'commands': [{'label': 'Record Node version',
            'command': ['node', '--version'], 'timeout_seconds': 120, 'exit_code': 0, 'duration_seconds': 0.1}]}


def startup():
    return {'schema': 1, 'status': 'OBSERVED', 'cause': 'UNDETERMINED', 'window': 'BOUNDED',
        'records': [{'phase': 'NATIVE_CREDENTIAL_READ', 'outcome': 'REJECTED', 'error_name': 'Error',
                     'code': -34018, 'window_relation': 'IN_WINDOW'}],
        'marker_records_seen': 1,
        **dict.fromkeys(('duplicate_records', 'malformed_markers',
            'invalid_compact_markers', 'invalid_record_fields', 'foreign_process_markers', 'outside_window_markers'), 0),
        'own_process_count': 1, 'own_process_count_capped': False, 'limit_reached': False,
        'input_partial': False, 'reasons': [],
        'scope': 'OPTIONAL_ORIGINAL_STARTUP_MARKERS_NOT_CAUSE_OR_ACCEPTANCE'}


def snapshot():
    return {'schema': 1, 'binding_state': 'BOUND', 'reason': 'FAILED_ASSERTION_OUTCOME',
        'scope': 'POST_FAILED_ASSERT_OUTCOME_NOT_TAP_TIME',
        'failed_assertion': {'kind': 'ASSERT_VISIBLE', 'selector': 'start_new_tile', 'sequence_number': 0},
        'node_count': 2, 'skip': {'state': 'UNIQUE_VALID_BOUNDS', 'exact_resource_id_count': 1,
            'bounds': {'left': -1, 'top': 2, 'right': 50, 'bottom': 30},
            'clickable': None, 'enabled': True, 'focused': False, 'selected': False,
            'conflicts': {'clickable': True, 'enabled': False, 'focused': False, 'selected': False}},
        'tap_coordinates': 'NOT_RECORDED', 'visible_to_user': 'NOT_RECORDED'}


def archive(data=None, raw=None, name='ios/metadata.json', attributes=None, extra=False):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as output:
        info = zipfile.ZipInfo(name); info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = attributes if attributes is not None else (stat.S_IFREG | 0o600) << 16
        output.writestr(info, raw if raw is not None else json.dumps(fixture() if data is None else data))
        if extra: output.writestr('raw.log', 'PRIVATE_SENTINEL')
    return stream.getvalue()


def binding(blob):
    return mock.patch.multiple(reader, ARTIFACT='991', ZIP_SIZE=len(blob),
        ZIP_SHA256=hashlib.sha256(blob).hexdigest(), NATIVE_CONCLUSION='failure',
        STEP_CONCLUSIONS=('success', 'failure', 'skipped', 'skipped', 'skipped'))


class IOS044Readout(unittest.TestCase):
    def reject(self, data):
        with self.assertRaises(Exception): reader.validate_archive(archive(data))

    def test_exact_observed_selection_and_each_partial_binding_fail_before_policy_files_or_input(self):
        self.assertEqual((reader.ARTIFACT, reader.ZIP_SHA256, reader.ZIP_SIZE, reader.NATIVE_CONCLUSION,
            reader.STEP_CONCLUSIONS), ('12469536083',
            'e244015128d4aa72e1e1c8be3072bc70d506ba11a804067448122d1318621caf', 7232,
            'failure', ('success', 'failure', 'skipped', 'skipped', 'skipped')))
        for field in ('ARTIFACT', 'ZIP_SHA256', 'ZIP_SIZE', 'NATIVE_CONCLUSION', 'STEP_CONCLUSIONS'):
            with mock.patch.object(reader, field, None), \
                    mock.patch.object(reader, 'checked_bytes') as checking, \
                    mock.patch.object(reader, 'Path') as paths, mock.patch.object(reader, 'public_literals') as policy:
                output = io.StringIO()
                with redirect_stdout(output): self.assertEqual(reader.main([]), 1)
                self.assertEqual(output.getvalue(), 'FIXED_044_IOS_ARTIFACT_BYTE_READOUT_FAILED\n')
                checking.assert_not_called(); paths.assert_not_called(); policy.assert_not_called()
        for index in range(5):
            steps = list(reader.STEP_CONCLUSIONS); steps[index] = None
            with mock.patch.object(reader, 'STEP_CONCLUSIONS', tuple(steps)), \
                    mock.patch.object(reader, 'checked_bytes') as checking, \
                    mock.patch.object(reader, 'Path') as paths:
                with redirect_stdout(io.StringIO()): self.assertEqual(reader.main([]), 1)
                checking.assert_not_called(); paths.assert_not_called()
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {'RUNNER_TEMP': directory}), \
                mock.patch.object(reader, 'validate_archive') as validating:
            path = Path(directory) / 'r5-044-ios-fixed.zip'; path.write_bytes(bytes(7232)); path.chmod(0o600)
            output = io.StringIO()
            with redirect_stdout(output): self.assertEqual(reader.main([]), 1)
            self.assertEqual(output.getvalue(), 'FIXED_044_IOS_ARTIFACT_BYTE_READOUT_FAILED\n')
            validating.assert_not_called()

    def test_exact_identity_failed_false_null_and_missing_optional_receipts_are_admissible(self):
        reader.validate_archive(archive())
        data = fixture(); data.update(build='FAIL', smoke='UNKNOWN', install_succeeded=False,
            installed_artifact_verified=False, installed_artifact=None)
        data.pop('commands')
        data['product_ui'] = {'status': 'FAIL', 'samples': [{'sample': 1, 'failed_assertion_snapshot': None}]}
        reader.validate_archive(archive(data))
        for key, value in [('source_sha', '0' * 40), ('workflow_sha', '0' * 40), ('run_id', '1'),
                           ('run_attempt', '2'), ('platform', 'ANDROID'), ('schema', True),
                           ('diagnostic_only', False), ('commands', [None]), ('smoke', 1)]:
            data = fixture(); data[key] = value; self.reject(data)

    def test_full_product_roots_more_than_100_commands_and_finite_macos_companion_paths(self):
        data = fixture(); data['commands'] *= 101
        base = '/Users/runner/work/_temp/keeper-native-private/keeper-product-ui-a1b2c3d4/'
        for folder in ('sample-1', 'sample-5', 'sample-6', 'key-ui', 'history-ui', 'vault-ui',
                       'credential-ui/credential_fixture-armed', 'credential-ui/product_credential_recovered'):
            data['commands'].append({'label': 'Full-product first-wallet and relaunch UI sample',
                'command': ['node', base + folder, base + folder + '/junit.xml'],
                'timeout_seconds': 600, 'exit_code': 0, 'duration_seconds': 1})
        for root in ('product_ui', 'product_key_ui', 'product_credential_ui', 'product_version_history_ui', 'product_vault_ui'):
            data[root] = {'status': 'NOT RUN'}
        reader.validate_archive(archive(data))
        for path in (base + 'sample-7', base + '../private', base.replace('a1b2c3d4', 'PRIVATE_SENTINEL') + 'sample-1'):
            malformed = copy.deepcopy(data); malformed['commands'][101]['command'][1] = path; self.reject(malformed)
        data['commands'] = data['commands'][:1] * (reader.MAX_COMMANDS + 1); self.reject(data)

    def test_startup_full_and_reduced_unknown_receipts_and_all_int32_statuses(self):
        for code in (None, -2147483648, -34018, 0, 2147483647):
            data = fixture(); receipt = startup(); receipt['records'][0]['code'] = code
            data['startup_diagnostics'] = {'ios_errors': {'startup_failure_receipt': receipt}}
            reader.validate_archive(archive(data))
        for reason in ('COLLECTOR_UNAVAILABLE', 'QUERY_UNAVAILABLE'):
            data['startup_diagnostics']['ios_errors']['startup_failure_receipt'] = {
                'schema': 1, 'status': 'UNKNOWN', 'records': [], 'cause': 'UNDETERMINED',
                'reasons': [reason], 'scope': startup()['scope']}
            reader.validate_archive(archive(data))
        data['startup_diagnostics']['ios_errors']['startup_failure_receipt'] = None
        reader.validate_archive(archive(data))

    def test_startup_private_malformed_codes_counts_names_extra_fields_and_wrong_location_reject(self):
        for mutate in (lambda v: v['records'][0].update(code=True), lambda v: v['records'][0].update(code=2147483648),
                       lambda v: v['records'][0].update(phase='CREDENTIAL_JSON'),
                       lambda v: v['records'][0].update(error_name='PRIVATE_SENTINEL'),
                       lambda v: v['records'][0].update(message='PRIVATE_SENTINEL'),
                       lambda v: v.update(marker_records_seen=33), lambda v: v.update(own_process_count=3),
                       lambda v: v.update(input_partial=1), lambda v: v.update(reasons=['PRIVATE_SENTINEL'])):
            value = startup(); mutate(value); data = fixture()
            data['startup_diagnostics'] = {'ios_errors': {'startup_failure_receipt': value}}; self.reject(data)
        data = fixture(); data['startup_diagnostics'] = {'startup_failure_receipt': startup()}; self.reject(data)
        data = fixture(); data['startup_diagnostics'] = {'ios_errors': {'onboarding_boundary_observation': {}}}; self.reject(data)

    def test_snapshot_adjacent_normal_retry_unknown_absent_and_multiple_nodes(self):
        data = fixture(); data['product_ui'] = {'samples': [{'sample': 1, 'failed_assertion_snapshot': snapshot()}],
            'controlled_disconnect_retry': {'failed_assertion_snapshot': snapshot()}}
        reader.validate_archive(archive(data))
        value = snapshot(); value.update(binding_state='UNKNOWN', reason='UNBOUND_FAILED_ASSERTION',
            failed_assertion=None, node_count=None)
        value['skip'] = {'state': 'UNKNOWN', 'exact_resource_id_count': None, 'bounds': None,
            **dict.fromkeys(('clickable', 'enabled', 'focused', 'selected')),
            'conflicts': dict.fromkeys(('clickable', 'enabled', 'focused', 'selected'))}
        data['product_ui']['samples'][0]['failed_assertion_snapshot'] = value
        reader.validate_archive(archive(data))
        for count in (0, 2):
            value = snapshot(); value['skip'].update(state='ABSENT' if count == 0 else 'UNKNOWN',
                exact_resource_id_count=count, bounds=None, **dict.fromkeys(('clickable', 'enabled', 'focused', 'selected')),
                conflicts=dict.fromkeys(('clickable', 'enabled', 'focused', 'selected')))
            data['product_ui']['samples'][0]['failed_assertion_snapshot'] = value
            reader.validate_archive(archive(data))
        data['product_ui']['samples'][0]['failed_assertion_snapshot'] = {
            'schema': 1, 'binding_state': 'UNKNOWN', 'reason': 'COLLECTOR_UNAVAILABLE', 'scope': snapshot()['scope']}
        reader.validate_archive(archive(data))

    def test_snapshot_raw_keys_private_text_bad_bounds_counts_and_nested_legacy_location_reject(self):
        for mutate in (lambda v: v.update(node_count=True), lambda v: v['failed_assertion'].update(sequence_number=2048),
                       lambda v: v['skip']['bounds'].update(left=-100001),
                       lambda v: v['skip']['bounds'].update(right=-1),
                       lambda v: v['skip'].update(clickable=1), lambda v: v['skip'].update(exact_resource_id_count=10001),
                       lambda v: v['skip']['conflicts'].update(selected='PRIVATE_SENTINEL'),
                       lambda v: v['skip'].update(attributes={'text': 'PRIVATE_SENTINEL'})):
            value = snapshot(); mutate(value); data = fixture()
            data['product_ui'] = {'samples': [{'failed_assertion_snapshot': value}]}; self.reject(data)
        data = fixture(); data['product_ui'] = {'samples': [{'failure_observation': {'failed_assertion_snapshot': snapshot()}}]}
        self.reject(data)

    def test_fixed_startup_and_product_hierarchy_flags_are_contextual_not_raw_trees(self):
        data = fixture(); data['startup_observation'] = {'hierarchy': {
            **dict.fromkeys(reader.STARTUP_FLAGS), 'snapshot_count': 0, 'observation_state': 'UNKNOWN'}}
        hierarchy = {'state': 'COMPLETE', 'snapshot_count': 1, 'node_count': 1, 'rejected_snapshots': 0,
            'snapshot_limit_exceeded': False, 'scope': reader.PRODUCT_HIERARCHY_SCOPE,
            'flags': dict.fromkeys(reader.PRODUCT_FLAGS, False)}
        data['product_ui'] = {'samples': [{'failure_observation': {'hierarchy': hierarchy}}]}
        reader.validate_archive(archive(data))
        data['product_ui']['samples'][0]['failure_observation']['hierarchy']['attributes'] = {'text': 'PASS'}
        self.reject(data)

    def test_recursive_privacy_duplicate_nonfinite_size_depth_and_zip_channels_fail_closed(self):
        for value in ({'raw_logs': 'PRIVATE_SENTINEL'}, {'PRIVATE_SENTINEL': 1},
                      {'errors': ['PRIVATE_SENTINEL']}, {'scope': '\x00'}, {'scope': 'PRIVATE_SENTINEL\u2028'},
                      {'url': 'https://private.example/token'}, {'children': []}, {'\n': 'PASS'}):
            data = fixture(); data['startup_diagnostics'] = value; self.reject(data)
        for blob in (archive(raw='{"schema":1,"schema":1}'), archive(raw='{"x":NaN}'), archive(raw='{"x":1e999}'),
                     archive(raw=b'\xff'), archive(extra=True), archive(name='../ios/metadata.json'),
                     archive(attributes=(stat.S_IFLNK | 0o777) << 16), archive(raw=b' ' * (reader.LIMIT + 1))):
            with self.assertRaises(Exception): reader.validate_archive(blob)
        blob = archive()
        for payload in (b'PRIVATE_SENTINEL' + blob, blob + b'PRIVATE_SENTINEL'):
            with self.assertRaises(Exception): reader.validate_archive(payload)
        for channel in ('archive', 'member', 'extra'):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, 'w') as output:
                info = zipfile.ZipInfo('ios/metadata.json'); info.compress_type = zipfile.ZIP_DEFLATED
                if channel == 'archive': output.comment = b'PRIVATE_SENTINEL'
                elif channel == 'member': info.comment = b'PRIVATE_SENTINEL'
                else: info.extra = struct.pack('<HH', 0xcafe, 16) + b'PRIVATE_SENTINEL'
                output.writestr(info, json.dumps(fixture()))
            with self.assertRaises(Exception): reader.validate_archive(stream.getvalue())

    def test_canonical_descriptor_original_base64_and_bound_file_failures(self):
        class Unseekable(io.BytesIO):
            def seek(self, *_args): raise OSError()
        stream = Unseekable()
        with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as output:
            output.writestr('ios/metadata.json', json.dumps(fixture()))
        blob = stream.getvalue(); reader.validate_archive(blob)
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {'RUNNER_TEMP': directory}):
            path = Path(directory) / 'r5-044-ios-fixed.zip'; path.write_bytes(blob); path.chmod(0o600)
            result = io.StringIO()
            with binding(blob), redirect_stdout(result): self.assertEqual(reader.main([]), 0)
            lines = result.getvalue().splitlines(); self.assertEqual((lines[0], lines[2]), (reader.BEGIN, reader.END))
            self.assertEqual(base64.b64decode(lines[1], validate=True), blob)
            self.assertTrue(path.exists())  # CJS deletes its owned ZIP before logging.
            for field, wrong in (('ZIP_SIZE', len(blob) + 1), ('ZIP_SHA256', '0' * 64)):
                result = io.StringIO()
                with binding(blob), mock.patch.object(reader, field, wrong), redirect_stdout(result):
                    self.assertEqual(reader.main([]), 1)
                self.assertEqual(result.getvalue(), 'FIXED_044_IOS_ARTIFACT_BYTE_READOUT_FAILED\n')

    def test_compact_policy_is_pinned_to_exact_reviewed_producers(self):
        raw = Path(reader.__file__).with_name('044-ios-metadata-policy.json').read_bytes()
        self.assertLess(len(raw), 65536)
        self.assertEqual(hashlib.sha256(raw).hexdigest(), reader.POLICY_SHA256)
        policy = json.loads(raw)
        self.assertEqual(policy['source_sha'], reader.SOURCE)
        self.assertEqual(len(policy['producer_sha256']), 13)
        with mock.patch.object(reader, 'POLICY_SHA256', '0' * 64):
            with self.assertRaises(Exception): reader.validate_archive(archive())


if __name__ == '__main__':
    unittest.main()
