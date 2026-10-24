"""Offline validation controls; no download, native fixture or acceptance execution."""
from contextlib import redirect_stdout
import base64
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

SPEC = importlib.util.spec_from_file_location('current_readout',
    Path(__file__).resolve().parents[1] / 'scripts/read-current-ios-artifact.py')
reader = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reader)


def fixture():
    # Existing metadata-only shape, never a native or app fixture.
    return {'schema': 1, 'source_sha': reader.SOURCE, 'workflow_sha': reader.WORKFLOW,
        'workflow_ref': reader.WORKFLOW_REF, 'run_id': reader.RUN, 'run_attempt': reader.ATTEMPT,
        'platform': 'IOS', 'diagnostic_only': True, 'build': 'PASS', 'smoke': 'FAIL',
        'native_probe': 'NOT RUN', 'r5_features': 'NOT RUN', 'hardware': 'NOT RUN',
        'signing': 'NOT RUN', 'app_id': 'io.hexawallet.hexakeeper.dev', 'failed_phase': 'smoke',
        'runner': {}, 'toolchain': {}, 'maestro': {}, 'built_artifact': {}, 'device': {},
        'installed_artifact': {}, 'startup_diagnostics': {}, 'driver_preflight': {},
        'install_succeeded': True, 'installed_artifact_verified': True,
        'commands': [{'label': 'Record Node version', 'command': ['node', '--version'],
            'timeout_seconds': 120, 'exit_code': 0, 'duration_seconds': 0.1}]}


def archive(data=None, raw=None, name='ios/metadata.json', attributes=None, extra=False):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as output:
        entry = zipfile.ZipInfo(name)
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = attributes if attributes is not None else (stat.S_IFREG | 0o600) << 16
        output.writestr(entry, raw if raw is not None else json.dumps(fixture() if data is None else data))
        if extra:
            output.writestr('raw.log', 'PRIVATE_SENTINEL')
    return stream.getvalue()


class ByteReadoutTests(unittest.TestCase):
    def reject(self, blob):
        with self.assertRaises(Exception):
            reader.validate_archive(blob)

    def test_fixed_identity_wrong_type_source_attempt_and_phase_are_rejected(self):
        reader.validate_archive(archive())
        for key, value in [('source_sha', '0' * 40), ('workflow_sha', '0' * 40),
                           ('run_id', '1'), ('run_attempt', '2'), ('schema', True),
                           ('platform', 'ANDROID'), ('diagnostic_only', False), ('smoke', 1),
                           ('native_probe', 'PRIVATE_SENTINEL'), ('commands', {}), ('commands', [None]),
                           ('commands', [{'label': 'Record Node version', 'command': [1]}])]:
            with self.subTest(key=key):
                data = fixture(); data[key] = value; self.reject(archive(data))

    def test_failed_false_null_and_missing_optional_receipts_are_transportable(self):
        data = fixture()
        data.update(build='FAIL', smoke='UNKNOWN', install_succeeded=False,
                    installed_artifact_verified=False, installed_artifact=None)
        data.pop('built_artifact'); data.pop('commands')
        reader.validate_archive(archive(data))

    def test_reviewed_1bc_observer_shape_is_supported_but_raw_hierarchy_is_not(self):
        data = fixture()
        flags = dict.fromkeys(('credential_error', 'retry', 'logbox_controls', 'redbox_resource',
            'loading', 'login', 'welcome_back', 'logbox_error_header', 'logbox_warning_header',
            'logbox_syntax_footer', 'logbox_counter'), None)
        data['startup_observation'] = {
            'scope': 'Owned simulator startup window; fixed observations, not app-process or cause proof.',
            'collection_errors': [],
            'metro': {'observation_state': 'ROWS_OBSERVED', 'rows': [{
                'stage': 'APP_WINDOW', 'kind': 'BUILD', 'event': 'bundle_build_done',
                'platform': 'ios', 'dev': True, 'minify': False, 'error_type': None, 'categories': []}],
                'input_truncated': False, 'invalid_rows': 0,
                'scope': 'Outer HTTP status only; multipart terminal status is not observed.',
                'producer_row_limit': 512, 'export_row_limit': 512, 'line_scan_limit': 1024,
                'lines_scanned': 1, 'valid_rows_in_scanned_input': 1, 'exported_rows': 1,
                'producer_limit_may_be_reached': False, 'export_truncated': False,
                'line_scan_truncated': False, 'coverage': 'BOUNDED_INPUT_ONLY'},
            'hierarchy': {**flags, 'observation_state': 'UNKNOWN', 'snapshot_count': 0},
            'process': {'state': 'UNKNOWN',
                'scope': 'Not queried; Metro and hierarchy do not establish process state.'}}
        data['startup_observation_cleanup'] = 'FAIL'
        data['startup_cleanup_errors'] = ['private_startup-observer']
        reader.validate_archive(archive(data))
        data['startup_observation']['hierarchy']['attributes'] = {'text': 'PRIVATE_SENTINEL'}
        self.reject(archive(data))

    def test_unknown_private_keys_values_controls_and_urls_are_rejected_recursively(self):
        for key, value in [('raw_logs', 'PRIVATE_SENTINEL'), ('PRIVATE_SENTINEL', 1),
                           ('errors', ['PRIVATE_SENTINEL']), ('scope', 'PRIVATE_SENTINEL\u2028'),
                           ('url', 'https://private.example/token?sig=PRIVATE_SENTINEL'),
                           ('scope', 'PRIVATE_SENTINEL\x00')]:
            with self.subTest(key=key):
                data = fixture(); data['startup_diagnostics'] = {key: value}; self.reject(archive(data))
        data = fixture(); data['PRIVATE_SENTINEL'] = 'PASS'; self.reject(archive(data))
        data = fixture(); data['startup_diagnostics'] = {'scope': '\x00'}; self.reject(archive(data))
        data = fixture(); data['startup_diagnostics'] = {'\n': 'PASS'}; self.reject(archive(data))

    def test_duplicate_json_nonfinite_deep_oversized_lists_and_member_types_fail_closed(self):
        for raw in ('{"schema":1,"schema":1}', '{"x":NaN}', '{"x":1e999}', b'\xffPRIVATE_SENTINEL'):
            self.reject(archive(raw=raw))
        for kwargs in ({'extra': True}, {'name': '../ios/metadata.json'}, {'name': 'metadata.json'},
                       {'name': 'ios\\metadata.json'}, {'attributes': (stat.S_IFLNK | 0o777) << 16},
                       {'raw': b'x' * (reader.LIMIT + 1)}):
            self.reject(archive(**kwargs))
        data = fixture(); data['startup_diagnostics']['errors'] = ['PASS'] * 1025; self.reject(archive(data))
        data = fixture(); branch = data['startup_diagnostics']
        for _ in range(26):
            branch['errors'] = {}; branch = branch['errors']
        self.reject(archive(data))
        encrypted = bytearray(archive())
        struct.pack_into('<H', encrypted, 6, struct.unpack_from('<H', encrypted, 6)[0] | 1)
        central = encrypted.index(b'PK\x01\x02')
        struct.pack_into('<H', encrypted, central + 8, struct.unpack_from('<H', encrypted, central + 8)[0] | 1)
        for blob in (bytes(encrypted), b'PRIVATE_SENTINEL', archive()[:-30]):
            self.reject(blob)

    def test_original_byte_transport_rejects_comments_extras_prefix_suffix_and_local_ambiguity(self):
        blob = archive()
        for modified in (b'PRIVATE_SENTINEL' + blob, blob + b'PRIVATE_SENTINEL'):
            self.reject(modified)
        for location in ('archive_comment', 'member_comment', 'extra'):
            output = io.BytesIO()
            with zipfile.ZipFile(output, 'w') as z:
                entry = zipfile.ZipInfo('ios/metadata.json'); entry.compress_type = zipfile.ZIP_DEFLATED
                if location == 'archive_comment': z.comment = b'PRIVATE_SENTINEL'
                if location == 'member_comment': entry.comment = b'PRIVATE_SENTINEL'
                if location == 'extra': entry.extra = struct.pack('<HH', 0xcafe, 16) + b'PRIVATE_SENTINEL'
                z.writestr(entry, json.dumps(fixture()))
            self.reject(output.getvalue())
        modified = bytearray(blob); modified[30] = ord('x'); self.reject(bytes(modified))
        # ZIP readers may ignore trailing bytes inside a declared deflate stream.
        modified = bytearray(blob)
        central = modified.index(b'PK\x01\x02'); end = modified.index(b'PK\x05\x06')
        compressed = struct.unpack_from('<I', modified, 18)[0]
        struct.pack_into('<I', modified, 18, compressed + 16)
        struct.pack_into('<I', modified, central + 20, compressed + 16)
        struct.pack_into('<I', modified, end + 16, central + 16)
        modified[central:central] = b'PRIVATE_SENTINEL'
        self.reject(bytes(modified))

    def test_github_style_signed_data_descriptor_is_supported_portably(self):
        class Unseekable(io.BytesIO):
            def seek(self, *args):
                raise OSError('Synthetic nonseekable writer')
        stream = Unseekable()
        with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as output:
            output.writestr('ios/metadata.json', json.dumps(fixture()))
        blob = stream.getvalue()
        self.assertEqual(struct.unpack_from('<H', blob, 6)[0], 8)
        reader.validate_archive(blob)

    def test_cli_prints_exact_original_zip_base64_only_after_validation(self):
        blob = archive()
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {'RUNNER_TEMP': directory}):
            path = Path(directory) / 'r5-current-ios-fixed.zip'; path.write_bytes(blob); path.chmod(0o600)
            output = io.StringIO()
            # Semantic fabricated control; production constants remain immutable.
            with mock.patch.object(reader, 'ZIP_SIZE', len(blob)), \
                    mock.patch.object(reader, 'ZIP_SHA256', hashlib.sha256(blob).hexdigest()), redirect_stdout(output):
                self.assertEqual(reader.main([]), 0)
            lines = output.getvalue().splitlines()
            self.assertEqual((lines[0], lines[2]), (reader.BEGIN, reader.END))
            self.assertEqual(base64.b64decode(lines[1], validate=True), blob)
            self.assertTrue(path.exists())  # CJS owns cleanup, then and only then logs base64.

    def test_cli_wrong_digest_size_mode_symlink_fifo_and_arguments_never_emit_bytes(self):
        blob = archive()
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {'RUNNER_TEMP': directory}):
            path = Path(directory) / 'r5-current-ios-fixed.zip'; path.write_bytes(blob); path.chmod(0o600)
            for mutation in ('size', 'digest', 'mode', 'symlink', 'fifo', 'argument'):
                if mutation == 'mode': path.chmod(0o644)
                if mutation in ('symlink', 'fifo'):
                    path.unlink()
                    if mutation == 'symlink': path.symlink_to(Path(directory) / 'missing')
                    else: os.mkfifo(path, 0o600)
                output = io.StringIO()
                with mock.patch.object(reader, 'ZIP_SIZE', len(blob) + (mutation == 'size')), \
                        mock.patch.object(reader, 'ZIP_SHA256', '0' * 64 if mutation == 'digest' else hashlib.sha256(blob).hexdigest()), redirect_stdout(output):
                    self.assertEqual(reader.main(['PRIVATE_SENTINEL'] if mutation == 'argument' else []), 1)
                self.assertEqual(output.getvalue(), 'FIXED_IOS_ARTIFACT_BYTE_READOUT_FAILED\n')
                path.unlink(); path.write_bytes(blob); path.chmod(0o600)

    def test_public_policy_digest_is_required_and_contains_exact_reviewed_producer_source(self):
        path = Path(reader.__file__).with_name('current-ios-metadata-policy.json')
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), reader.POLICY_SHA256)
        policy = json.loads(path.read_bytes())
        self.assertEqual(policy['source_sha'], reader.SOURCE)
        self.assertEqual(len(policy['producer_sha256']), 4)
        with mock.patch.object(reader, 'POLICY_SHA256', '0' * 64):
            self.reject(archive())


if __name__ == '__main__':
    unittest.main()
