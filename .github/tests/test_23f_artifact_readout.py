"""Synthetic-only artifact controls. The real pinned ZIP is NOT read here."""
from contextlib import redirect_stdout
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
import warnings
import zipfile

SPEC = importlib.util.spec_from_file_location('readout',
    Path(__file__).resolve().parents[1] / 'scripts/read-23f-android-artifact.py')
reader = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reader)


def fixture():
    return {'schema': 1, 'source_sha': reader.SOURCE, 'workflow_sha': reader.WORKFLOW,
            'workflow_ref': reader.WORKFLOW_REF, 'run_id': reader.RUN, 'run_attempt': reader.ATTEMPT,
            'platform': 'ANDROID', 'diagnostic_only': True, 'build': 'PASS', 'smoke': 'PASS',
            'r5_features': 'PASS', 'built_artifact': {'sha256': 'a' * 64, 'path': 'PRIVATE_SENTINEL'},
            'installed_artifact_verified': True,
            'installed_artifact': {'method': 'SINGLE_INSTALLED_BASE_APK_SHA256', 'sha256': 'a' * 64},
            'r5_feature_evidence': {'status': 'PASS',
                'scenarios': [{'id': name, 'status': 'PASS'} for name in reader.SCENARIOS],
                'source_functions': [{'path': path, 'names': names, 'sha256': sha}
                                     for _, path, names, sha in reader.SOURCES]},
            'product_ui': {'status': 'FAIL', 'failure_category': 'RuntimeError', 'requested_samples': 5,
                'samples': [{'sample': 1, 'status': 'FAIL', 'completed_stages': list(reader.STAGES[:3]),
                    'raw_durations': {'startup_to_passcode_ms': 123.456}, 'create_new_app_calls': 0,
                    'pin_onboarding_progress': {'completed_markers': list(reader.PIN[:2]),
                        'next_marker': reader.PIN[2], 'complete': False}}]}}


def archive(data=None, raw=None, name='android/metadata.json', attributes=None, extra=False):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as output:
        entry = zipfile.ZipInfo(name)
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = attributes if attributes is not None else (stat.S_IFREG | 0o600) << 16
        output.writestr(entry, raw if raw is not None else json.dumps(data if data is not None else fixture()))
        if extra:
            output.writestr('PRIVATE_SENTINEL', 'PRIVATE_SENTINEL')
    return stream.getvalue()


class ReadoutTest(unittest.TestCase):
    def rejected(self, blob):
        with self.assertRaises(ValueError) as error:
            reader.decode(blob)
        self.assertEqual(str(error.exception), 'Artifact rejected.')

    def test_synthetic_partial_product_preserves_failure_and_fixed_numeric_progress(self):
        result = reader.decode(archive())
        self.assertEqual(result['tag'], 'SAFE_R5_ANDROID_READOUT')
        self.assertEqual(result['product']['reported_status'], 'FAIL')
        self.assertEqual(result['reported_phases']['r5_features'], 'PASS')
        self.assertTrue(result['installed_apk']['installed_byte_proof_matches_built'])
        self.assertEqual(result['installed_apk']['method'], 'SINGLE_INSTALLED_BASE_APK_SHA256')
        self.assertNotIn('a' * 64, json.dumps(result))
        self.assertTrue(result['workers']['committed_sources_verified'])
        self.assertEqual(len(result['workers']['reported_scenarios']), 5)
        self.assertEqual(result['workers']['source_sha256']['wallet_worker'], reader.SOURCES[2][3])
        row = result['product']['samples'][0]
        self.assertEqual(row['completed_stages'], list(reader.STAGES[:3]))
        self.assertEqual(row['raw_durations']['startup_to_passcode_ms'], 123.456)
        self.assertEqual(row['pin_progress']['next_marker'], reader.PIN[2])
        self.assertEqual(result['product']['cleanup'], 'UNKNOWN')
        self.assertEqual(result['product']['retry']['reported_status'], 'UNKNOWN')
        self.assertEqual(result['release_acceptance'], 'NOT ESTABLISHED')
        self.assertEqual(result['cause'], 'UNDETERMINED')
        self.assertTrue(result['readout_only'])
        self.assertFalse(result['authorization_eligible'])
        self.assertFalse(result['trusted_native_acceptance'])

    def test_missing_stale_or_wrong_provenance_and_boolean_schema_are_rejected(self):
        for field in ('schema', 'source_sha', 'workflow_sha', 'workflow_ref', 'run_id',
                      'run_attempt', 'platform', 'diagnostic_only'):
            for value in (None, 'PRIVATE_SENTINEL'):
                with self.subTest(field=field, value=value):
                    data = fixture()
                    data[field] = value
                    self.rejected(archive(data))
        data = fixture()
        data['schema'] = True
        self.rejected(archive(data))

    def test_unsafe_zip_members_duplicate_encryption_and_bomb_are_rejected(self):
        for kwargs in ({'name': '../android/metadata.json'}, {'name': '/android/metadata.json'},
                       {'name': 'android\\metadata.json'}, {'name': 'metadata.json'}, {'extra': True},
                       {'attributes': (stat.S_IFLNK | 0o777) << 16},
                       {'raw': b'x' * (reader.LIMIT + 1)}):
            with self.subTest(kwargs=list(kwargs)):
                self.rejected(archive(**kwargs))
        stream = io.BytesIO()
        with warnings.catch_warnings(), zipfile.ZipFile(stream, 'w') as output:
            warnings.simplefilter('ignore', UserWarning)
            for _ in range(2):
                output.writestr('android/metadata.json', '{}')
        self.rejected(stream.getvalue())
        encrypted = bytearray(archive())
        struct.pack_into('<H', encrypted, 6, struct.unpack_from('<H', encrypted, 6)[0] | 1)
        central = encrypted.index(b'PK\x01\x02')
        struct.pack_into('<H', encrypted, central + 8, struct.unpack_from('<H', encrypted, central + 8)[0] | 1)
        for blob in (bytes(encrypted), b'PRIVATE_SENTINEL', archive()[:-30], b'x' * (reader.LIMIT + 4097)):
            self.rejected(blob)

    def test_duplicate_json_nonfinite_invalid_utf8_and_malformed_json_are_rejected(self):
        root = json.dumps(fixture())[:-1]
        for raw in (root + ',"ignored":{"same":1,"same":2}}',
                    root + ',"ignored":NaN}', root + ',"ignored":Infinity}',
                    root + ',"ignored":1e999}', b'\xffPRIVATE_SENTINEL', '{PRIVATE_SENTINEL'):
            with self.subTest(raw_type=type(raw).__name__):
                self.rejected(archive(raw=raw))

    def test_private_text_bad_types_unknown_enums_and_forged_prefix_do_not_escape(self):
        data = fixture()
        product = data['product_ui']
        product.update(status='PRIVATE_SENTINEL', failure_category='PRIVATE_SENTINEL',
                       cleanup_failure_categories=['PRIVATE_SENTINEL', {'secret': 'PRIVATE_SENTINEL'}],
                       key_management_ui={'status': 'PRIVATE_SENTINEL'})
        row = product['samples'][0]
        row.update(completed_stages=['startup_ready', 'PRIVATE_SENTINEL'], create_new_app_calls=True,
                   raw_durations={'startup_to_passcode_ms': 'PRIVATE_SENTINEL', 'PRIVATE_SENTINEL': 123})
        row['pin_onboarding_progress'].update(completed_markers=['PRIVATE_SENTINEL'], next_marker='PRIVATE_SENTINEL')
        data['commands'] = [{'command': ['PRIVATE_SENTINEL'], 'secret': 'PRIVATE_SENTINEL'}]
        data['runner'] = {'path': 'PRIVATE_SENTINEL'}
        result = reader.decode(archive(data))
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        self.assertFalse(result['product']['samples'][0]['stage_prefix_valid'])
        self.assertIsNone(result['product']['samples'][0]['create_new_app_calls'])
        self.assertIsNone(result['product']['samples'][0]['raw_durations']['startup_to_passcode_ms'])
        self.assertEqual(result['product']['failure_category'], 'UNKNOWN')
        self.assertEqual(result['product']['companions']['key_management_ui'], 'UNKNOWN')

    def test_source_mismatch_installed_mismatch_and_missing_cleanup_do_not_gain_passes(self):
        data = fixture()
        data['installed_artifact']['sha256'] = 'b' * 64
        data['r5_feature_evidence']['source_functions'][0]['sha256'] = 'c' * 64
        result = reader.decode(archive(data))
        self.assertFalse(result['installed_apk']['installed_byte_proof_matches_built'])
        self.assertFalse(result['workers']['committed_sources_verified'])
        self.assertTrue(all(value is None for value in result['workers']['source_sha256'].values()))
        self.assertEqual(result['product']['cleanup'], 'UNKNOWN')
        self.assertEqual(result['product']['samples'][0]['android_runtime']['cleanup'], 'UNKNOWN')
        self.assertEqual(result['product']['reported_status'], 'FAIL')

    def test_fixed_android_facts_and_reported_companions_preserve_scope(self):
        data = fixture()
        product = data['product_ui']
        product['key_management_ui'] = {'status': 'NOT RUN', 'secret': 'PRIVATE_SENTINEL'}
        product['samples'][0]['android_runtime_diagnostic'] = {
            'status': 'COLLECTED', 'facts': {'processes': {'state': 'PRESENT', 'matching_process_count': 2},
                'foreground_activity': {'relation': 'OWN_APP'}, 'cleanup_status': 'DELETED',
                'runtime_errors': {'parsed_error_records': 5, 'own_error_records': 2,
                    'unclassified_own_error_records': 1, 'input_truncated': False,
                    'exception_types': ['TypeError', 'PRIVATE_SENTINEL', {'private': 'PRIVATE_SENTINEL'}],
                    'fault_categories': ['JS_TYPE_ERROR', 'PRIVATE_SENTINEL'],
                    'attribution': 'CURRENT_OWN_PID_MATCH_HISTORY_FRESHNESS_UNKNOWN'},
                'private': 'PRIVATE_SENTINEL'}}
        result = reader.decode(archive(data))
        runtime = result['product']['samples'][0]['android_runtime']
        self.assertEqual(runtime['process_state'], 'PRESENT')
        self.assertEqual(runtime['foreground_relation'], 'OWN_APP')
        self.assertEqual(runtime['matching_process_count'], 2)
        self.assertEqual(runtime['error_counts']['own_error_records'], 2)
        self.assertEqual(runtime['error_counts']['unclassified_own_error_records'], 1)
        self.assertEqual(runtime['exception_types'], ['TypeError'])
        self.assertEqual(runtime['fault_categories'], ['JS_TYPE_ERROR'])
        self.assertEqual(runtime['attribution'], 'CURRENT_OWN_PID_MATCH_HISTORY_FRESHNESS_UNKNOWN')
        self.assertEqual(runtime['cleanup'], 'DELETED')
        self.assertEqual(runtime['cause'], 'UNDETERMINED')
        self.assertEqual(result['product']['companions']['key_management_ui'], 'NOT RUN')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_fixed_command_receipts_discard_raw_fields_unknown_labels_and_bad_numbers(self):
        data = fixture()
        data['commands'] = [
            {'label': 'Full-product first-wallet and relaunch UI sample', 'exit_code': 1,
             'duration_seconds': 90.5, 'timeout_seconds': 600, 'raw': 'PRIVATE_SENTINEL'},
            {'label': 'PRIVATE_SENTINEL', 'exit_code': 0, 'duration_seconds': 1},
            {'label': 'Build debug-key-only development APK', 'exit_code': True,
             'duration_seconds': -1, 'timeout_seconds': 'PRIVATE_SENTINEL'}]
        result = reader.decode(archive(data))
        self.assertEqual(result['fixed_command_receipts']['product_ui'], [
            {'exit_code': 1, 'duration_seconds': 90.5, 'timeout_seconds': 600}])
        self.assertEqual(result['fixed_command_receipts']['build_apk'], [
            {'exit_code': None, 'duration_seconds': None, 'timeout_seconds': None}])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_cli_requires_exact_size_digest_mode_and_nonsymlink_and_never_unlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'r5-23f-android-fixed.zip'
            blob = archive()
            path.write_bytes(blob)
            path.chmod(0o600)
            for mutation in ('size', 'digest', 'mode', 'owner_execute', 'symlink'):
                with self.subTest(mutation=mutation), mock.patch.dict(os.environ, {'RUNNER_TEMP': temporary}):
                    if mutation == 'mode':
                        path.chmod(0o644)
                    if mutation == 'owner_execute':
                        path.chmod(0o700)
                    if mutation == 'symlink':
                        target = Path(temporary) / 'private-target'
                        path.rename(target)
                        path.symlink_to(target)
                    output = io.StringIO()
                    with mock.patch.object(reader, 'ZIP_SIZE', len(blob) + (mutation == 'size')), \
                            mock.patch.object(reader, 'ZIP_SHA256', '0' * 64 if mutation == 'digest' else hashlib.sha256(blob).hexdigest()), redirect_stdout(output):
                        self.assertEqual(reader.main([]), 1)
                    self.assertEqual(output.getvalue(), 'FIXED_ANDROID_ARTIFACT_READOUT_FAILED\n')
                    self.assertTrue(path.exists())
                    if mutation == 'symlink':
                        path.unlink()
                        target.rename(path)
                    path.chmod(0o600)

    def test_cli_synthetic_success_prefix_and_fifo_rejection_are_bounded(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.dict(os.environ, {'RUNNER_TEMP': temporary}):
            path = Path(temporary) / 'r5-23f-android-fixed.zip'
            blob = archive()
            path.write_bytes(blob)
            path.chmod(0o600)
            output = io.StringIO()
            # Synthetic CLI contract only; the production ZIP pins stay fixed.
            with mock.patch.object(reader, 'ZIP_SIZE', len(blob)), \
                    mock.patch.object(reader, 'ZIP_SHA256', hashlib.sha256(blob).hexdigest()), redirect_stdout(output):
                self.assertEqual(reader.main([]), 0)
            self.assertTrue(output.getvalue().startswith('SAFE_R5_ANDROID_READOUT '))
            self.assertTrue(path.exists())
            path.unlink()
            os.mkfifo(path, 0o600)
            with redirect_stdout(io.StringIO()):
                self.assertEqual(reader.main([]), 1)
            self.assertTrue(path.exists())
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(reader.main(['PRIVATE_SENTINEL']), 1)
            self.assertEqual(output.getvalue(), 'FIXED_ANDROID_ARTIFACT_READOUT_FAILED\n')


if __name__ == '__main__':
    unittest.main()
