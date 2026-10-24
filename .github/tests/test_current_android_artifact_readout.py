"""Portable fabricated metadata controls; no download, app or native execution."""
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

SPEC = importlib.util.spec_from_file_location('current_android_readout',
    Path(__file__).resolve().parents[1] / 'scripts/read-current-android-artifact.py')
reader = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reader)


def fixture():
    return {'schema': 1, 'source_sha': reader.SOURCE, 'workflow_sha': reader.WORKFLOW,
        'workflow_ref': reader.WORKFLOW_REF, 'run_id': reader.RUN, 'run_attempt': reader.ATTEMPT,
        'platform': 'ANDROID', 'diagnostic_only': True, 'build': 'PASS', 'smoke': 'PASS',
        'native_probe': 'PASS', 'r5_features': 'PASS', 'hardware': 'NOT RUN', 'signing': 'NOT RUN',
        'app_id': 'io.hexawallet.keeper.development', 'commands': [{
            'label': 'Record Node version', 'command': ['node', '--version'],
            'timeout_seconds': 120, 'exit_code': 0, 'duration_seconds': 0.1}],
        'startup_observation': {'hierarchy': {**dict.fromkeys(reader.STARTUP_FLAGS, False),
                                            'snapshot_count': 1}},
        'product_ui': {'status': 'FAIL', 'samples': [{'sample': 1, 'status': 'FAIL'}],
                       'controlled_disconnect_retry': {'status': 'NOT RUN'}}}


def failure_observation():
    return {'scope': 'Failed-sample files and bound owned Metro only; observations do not prove current visibility, route, tap delivery or cause.',
        'junit': {'state': 'ERROR_RECORDED', 'failed_selector': 'start_new_tile',
                  'failure_kind': 'ASSERT_VISIBLE'},
        'hierarchy': {'state': 'PARTIAL', 'snapshot_count': 1, 'node_count': 10,
            'rejected_snapshots': 1, 'snapshot_limit_exceeded': False,
            'scope': reader.PRODUCT_HIERARCHY_SCOPE,
            'flags': {**dict.fromkeys(reader.PRODUCT_FLAGS), 'onboarding_skip': True}},
        'product_metro': {'state': 'UNKNOWN', 'scope': 'Bound product-sample console window; markers are not cause or request proof.',
                          'process_state': 'ALIVE', 'exit_code': None}}


def archive(data=None, raw=None, name='android/metadata.json', attributes=None, extra=False):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as output:
        entry = zipfile.ZipInfo(name)
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = attributes if attributes is not None else (stat.S_IFREG | 0o600) << 16
        output.writestr(entry, raw if raw is not None else json.dumps(fixture() if data is None else data))
        if extra:
            output.writestr('raw.log', 'PRIVATE_SENTINEL')
    return stream.getvalue()


def bound(blob):
    # Fabricated ZIP bytes only; production conclusion tuple remains unchanged.
    return mock.patch.multiple(reader, ARTIFACT='1', ZIP_SIZE=len(blob),
        ZIP_SHA256=hashlib.sha256(blob).hexdigest(), NATIVE_CONCLUSION='failure',
        BUILD_CONCLUSION='success', PROBES_CONCLUSION='failure')


class AndroidByteReadoutTests(unittest.TestCase):
    def reject(self, blob):
        with self.assertRaises(Exception):
            reader.validate_archive(blob)

    def test_production_bindings_match_observed_receipt_and_wrong_bytes_never_emit(self):
        self.assertEqual((reader.ARTIFACT, reader.ZIP_SIZE, reader.ZIP_SHA256,
            reader.NATIVE_CONCLUSION, reader.BUILD_CONCLUSION, reader.PROBES_CONCLUSION),
            ('12466091444', 8950, '5c3210a6b0af7bf9ea0cddb61fd1494714e8cfac0db8385960fb6390f92aa545',
             'failure', 'success', 'failure'))
        reader.require_binding()
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {'RUNNER_TEMP': directory}), \
                mock.patch.object(reader, 'public_literals') as policy, \
                mock.patch.object(reader, 'validate_archive') as validating:
            path = Path(directory) / 'r5-current-android-fixed.zip'
            path.write_bytes(bytes(reader.ZIP_SIZE)); path.chmod(0o600)
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(reader.main([]), 1)
            self.assertEqual(output.getvalue(), 'FIXED_ANDROID_ARTIFACT_BYTE_READOUT_FAILED\n')
            policy.assert_not_called(); validating.assert_not_called()

    def test_partial_binding_never_reads_input_and_invalid_types_fail_closed(self):
        blob = archive()
        for name in ('ARTIFACT', 'ZIP_SHA256', 'ZIP_SIZE', 'NATIVE_CONCLUSION',
                     'BUILD_CONCLUSION', 'PROBES_CONCLUSION'):
            with bound(blob), mock.patch.object(reader, name, None), \
                    mock.patch.object(reader, 'checked_bytes') as checking, \
                    mock.patch.object(reader, 'Path') as paths, \
                    mock.patch.object(reader.os, 'open') as opening, \
                    mock.patch.object(reader, 'public_literals') as policy:
                with redirect_stdout(io.StringIO()):
                    self.assertEqual(reader.main([]), 1)
                checking.assert_not_called()
                paths.assert_not_called(); opening.assert_not_called(); policy.assert_not_called()
        for name, value in [('ARTIFACT', True), ('ZIP_SIZE', True), ('ZIP_SIZE', -1),
                            ('ZIP_SHA256', 'PRIVATE_SENTINEL'), ('NATIVE_CONCLUSION', 1),
                            ('NATIVE_CONCLUSION', 'success'), ('BUILD_CONCLUSION', 'failure'),
                            ('PROBES_CONCLUSION', 'success'), ('BUILD_CONCLUSION', 'PRIVATE_SENTINEL')]:
            with bound(blob), mock.patch.object(reader, name, value):
                with self.assertRaises(ValueError): reader.require_binding()

    def test_exact_current_android_identity_and_root_types_are_required(self):
        reader.validate_archive(archive())
        for key, value in [('source_sha', '0' * 40), ('workflow_sha', '0' * 40),
                           ('run_id', '1'), ('run_attempt', '2'), ('schema', True),
                           ('platform', 'IOS'), ('diagnostic_only', False), ('smoke', 1),
                           ('native_probe', 'PRIVATE_SENTINEL'), ('commands', [None]),
                           ('commands', [{'label': 'Record Node version', 'command': [1]}])]:
            data = fixture(); data[key] = value
            with self.subTest(key=key): self.reject(archive(data))

    def test_unknown_failed_false_null_and_missing_optional_receipts_are_transportable(self):
        data = fixture(); data.update(build='FAIL', smoke='UNKNOWN', install_succeeded=False,
            installed_artifact_verified=False, installed_artifact=None, startup_observation=None)
        data.pop('commands'); data.pop('product_ui')
        reader.validate_archive(archive(data))
        data = fixture(); data['product_ui']['samples'][0]['failure_observation'] = None
        reader.validate_archive(archive(data))

    def test_legacy_startup_and_optional_sample_retry_hierarchy_flags_are_supported(self):
        data = fixture()
        data['product_ui']['samples'][0]['failure_observation'] = failure_observation()
        data['product_ui']['controlled_disconnect_retry']['failure_observation'] = failure_observation()
        data['startup_cleanup_errors'] = ['private_startup-observer']
        data['toolchain'] = {'observed_android_sdk': {
            'platforms/android-36': {}, 'build-tools/35.0.0': {}, 'ndk/27.1.12297006': {}}}
        data['product_ui']['samples'][0]['android_runtime_diagnostic'] = {'status': 'COLLECTED',
            'facts': {'host_memory': {'cgroup': {'memory.current': {'lookup_status': 'SUCCESS',
                                                                'bytes': 1234}}}}}
        reader.validate_archive(archive(data))
        for target in ('legacy', 'sample', 'retry'):
            malformed = copy.deepcopy(data)
            hierarchy = (malformed['startup_observation']['hierarchy'] if target == 'legacy' else
                malformed['product_ui']['samples'][0]['failure_observation']['hierarchy'] if target == 'sample' else
                malformed['product_ui']['controlled_disconnect_retry']['failure_observation']['hierarchy'])
            hierarchy['attributes'] = {'text': 'PASS'}
            self.reject(archive(malformed))
        data['product_ui']['samples'][0]['failure_observation']['hierarchy']['flags']['onboarding_skip'] = 1
        self.reject(archive(data))
        data = fixture(); data['startup_diagnostics'] = {'platforms/android-36': {}}
        self.reject(archive(data))

    def test_five_samples_retry_and_all_companion_command_paths_are_finite_public_data(self):
        data = fixture(); data['commands'] = []
        binary = next(value for value in reader.public_literals() if value.endswith('/bin/maestro'))
        base = '/home/runner/work/_temp/keeper-native-private/keeper-product-ui-a1b2c3d4/'
        def add(folder, filename, label, argument=None):
            output = base + folder
            args = [binary, '--device', 'emulator-5554', 'test', '--env',
                    'APP_ID=io.hexawallet.keeper.development']
            if argument: args += ['--env', argument]
            args += ['--flatten-debug-output', '--debug-output', output, '--test-output-dir', output,
                     '--format', 'junit', '--output', output + '/junit.xml', '.github/native/' + filename]
            data['commands'].append({'label': label, 'command': args,
                                    'timeout_seconds': 600, 'exit_code': 0, 'duration_seconds': 1})
        for number in range(1, 7):
            add('sample-' + str(number), 'product_retry.yaml' if number == 6 else 'product_first_wallet.yaml',
                'Full-product controlled disconnect and Retry fixture' if number == 6 else
                'Full-product first-wallet and relaunch UI sample')
        add('key-ui', 'product_key_acceptance.yaml', 'Normal-app unused-key deletion and native PIN rejection')
        for phase in ('armed', 'restored'):
            add('credential-ui/credential_fixture-' + phase, 'credential_fixture.yaml',
                'Disposable credential acceptance phase', 'FIXTURE_STAGE=' + phase)
        for phase in ('blocked', 'recovered'):
            add('credential-ui/product_credential_' + phase, 'product_credential_' + phase + '.yaml',
                'Disposable credential acceptance phase')
        policy = json.loads(Path(reader.__file__).with_name('current-android-metadata-policy.json').read_bytes())
        for argument in policy['derived_public_literals']:
            if argument.startswith('EXPECTED_FIXTURE_ID=history-fixture-'):
                add('history-ui', 'history_fixture.yaml', 'Native controlled history fixture', argument)
        add('history-ui', 'history_product.yaml', 'Normal cold-login current history observation')
        add('vault-ui', 'product_vault_acceptance.yaml',
            'Normal-app genuine Vault visible hidden and archived key references')
        reader.validate_archive(archive(data))
        for path in (base + 'sample-7', base + 'private-wallet-name',
                     base.replace('a1b2c3d4', 'PRIVATE_SENTINEL') + 'sample-1',
                     '/home/other/private/sample-1'):
            malformed = copy.deepcopy(data); malformed['commands'][0]['command'][10] = path
            self.reject(archive(malformed))

    def test_raw_ui_private_keys_values_controls_and_urls_are_rejected_everywhere(self):
        for key, value in [('raw_logs', 'PRIVATE_SENTINEL'), ('PRIVATE_SENTINEL', 1),
                           ('errors', ['PRIVATE_SENTINEL']), ('scope', 'PRIVATE_SENTINEL\u2028'),
                           ('url', 'https://private.example/token?sig=PRIVATE_SENTINEL'),
                           ('scope', '\x00'), ('\n', 'PASS'), ('attributes', {'text': 'PASS'}),
                           ('children', []), ('hierarchy', {'text': 'PASS'})]:
            data = fixture(); data['startup_diagnostics'] = {key: value}
            with self.subTest(key=key): self.reject(archive(data))
        data = fixture(); data['PRIVATE_SENTINEL'] = 'PASS'; self.reject(archive(data))

    def test_duplicate_nonfinite_deep_oversized_json_and_unsafe_members_reject(self):
        for raw in ('{"schema":1,"schema":1}', '{"x":NaN}', '{"x":1e999}', b'\xffPRIVATE_SENTINEL'):
            self.reject(archive(raw=raw))
        for kwargs in ({'extra': True}, {'name': '../android/metadata.json'}, {'name': 'metadata.json'},
                       {'name': 'android\\metadata.json'}, {'attributes': (stat.S_IFLNK | 0o777) << 16},
                       {'raw': b'x' * (reader.LIMIT + 1)}):
            self.reject(archive(**kwargs))
        data = fixture(); data['startup_diagnostics'] = {'errors': ['PASS'] * 1025}
        self.reject(archive(data))
        data = fixture(); branch = data['startup_diagnostics'] = {}
        for _ in range(26): branch['errors'] = {}; branch = branch['errors']
        self.reject(archive(data))
        encrypted = bytearray(archive())
        struct.pack_into('<H', encrypted, 6, struct.unpack_from('<H', encrypted, 6)[0] | 1)
        central = encrypted.index(b'PK\x01\x02')
        struct.pack_into('<H', encrypted, central + 8, struct.unpack_from('<H', encrypted, central + 8)[0] | 1)
        for blob in (bytes(encrypted), b'PRIVATE_SENTINEL', archive()[:-30]): self.reject(blob)

    def test_original_transport_rejects_comments_extras_prefix_suffix_and_unused_deflate(self):
        blob = archive()
        for modified in (b'PRIVATE_SENTINEL' + blob, blob + b'PRIVATE_SENTINEL'): self.reject(modified)
        for location in ('archive_comment', 'member_comment', 'extra'):
            output = io.BytesIO()
            with zipfile.ZipFile(output, 'w') as target:
                entry = zipfile.ZipInfo('android/metadata.json'); entry.compress_type = zipfile.ZIP_DEFLATED
                if location == 'archive_comment': target.comment = b'PRIVATE_SENTINEL'
                if location == 'member_comment': entry.comment = b'PRIVATE_SENTINEL'
                if location == 'extra': entry.extra = struct.pack('<HH', 0xcafe, 16) + b'PRIVATE_SENTINEL'
                target.writestr(entry, json.dumps(fixture()))
            self.reject(output.getvalue())
        modified = bytearray(blob); modified[30] = ord('x'); self.reject(bytes(modified))
        modified = bytearray(blob)
        central = modified.index(b'PK\x01\x02'); end = modified.index(b'PK\x05\x06')
        compressed = struct.unpack_from('<I', modified, 18)[0]
        struct.pack_into('<I', modified, 18, compressed + 16)
        struct.pack_into('<I', modified, central + 20, compressed + 16)
        struct.pack_into('<I', modified, end + 16, central + 16)
        modified[central:central] = b'PRIVATE_SENTINEL'; self.reject(bytes(modified))

    def test_github_signed_descriptor_positive_and_exact_original_base64(self):
        class Unseekable(io.BytesIO):
            def seek(self, *args): raise OSError('Synthetic nonseekable writer')
        stream = Unseekable()
        with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as output:
            output.writestr('android/metadata.json', json.dumps(fixture()))
        blob = stream.getvalue(); self.assertEqual(struct.unpack_from('<H', blob, 6)[0], 8)
        reader.validate_archive(blob)
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {'RUNNER_TEMP': directory}):
            path = Path(directory) / 'r5-current-android-fixed.zip'; path.write_bytes(blob); path.chmod(0o600)
            output = io.StringIO()
            with bound(blob), redirect_stdout(output): self.assertEqual(reader.main([]), 0)
            lines = output.getvalue().splitlines()
            self.assertEqual((lines[0], lines[2]), (reader.BEGIN, reader.END))
            self.assertEqual(base64.b64decode(lines[1], validate=True), blob)
            self.assertTrue(path.exists())  # CJS owns deletion before logging.

    def test_bound_cli_wrong_size_digest_mode_symlink_fifo_and_arguments_emit_no_bytes(self):
        blob = archive()
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {'RUNNER_TEMP': directory}):
            path = Path(directory) / 'r5-current-android-fixed.zip'; path.write_bytes(blob); path.chmod(0o600)
            for mutation in ('size', 'digest', 'mode', 'symlink', 'fifo', 'argument'):
                if mutation == 'mode': path.chmod(0o644)
                if mutation in ('symlink', 'fifo'):
                    path.unlink()
                    if mutation == 'symlink': path.symlink_to(Path(directory) / 'missing')
                    else: os.mkfifo(path, 0o600)
                output = io.StringIO()
                with bound(blob), mock.patch.object(reader, 'ZIP_SIZE', len(blob) + (mutation == 'size')), \
                        mock.patch.object(reader, 'ZIP_SHA256', '0' * 64 if mutation == 'digest' else hashlib.sha256(blob).hexdigest()), redirect_stdout(output):
                    self.assertEqual(reader.main(['PRIVATE_SENTINEL'] if mutation == 'argument' else []), 1)
                self.assertEqual(output.getvalue(), 'FIXED_ANDROID_ARTIFACT_BYTE_READOUT_FAILED\n')
                path.unlink(); path.write_bytes(blob); path.chmod(0o600)

    def test_policy_pins_reviewed_source_raw_historical_bytes_and_keyword_fields(self):
        path = Path(reader.__file__).with_name('current-android-metadata-policy.json')
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), reader.POLICY_SHA256)
        policy = json.loads(path.read_bytes())
        self.assertEqual(policy['source_sha'], reader.SOURCE)
        self.assertEqual(len(policy['producer_sha256']), 10)
        self.assertEqual(policy['historical_metadata_sha256'],
            '8471b48f7637923ae2576f17a25c95898ed9bfac445ff1cbcda816cfa6a7f70a')
        self.assertIn('valid_records', policy['public_literals'])
        self.assertIn('FIXTURE_STAGE=armed', policy['derived_public_literals'])
        with mock.patch.object(reader, 'POLICY_SHA256', '0' * 64): self.reject(archive())


if __name__ == '__main__':
    unittest.main()
