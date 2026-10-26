"""Real ZIP controls and nested original-collector observations; no native credit."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('ios_readout', ROOT / '.github/native/ios_runtime_evidence_readout.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class ExactIOSReadout(unittest.TestCase):
    def metadata(self):
        return {'schema': 1, 'platform': 'IOS', 'source_sha': m.SOURCE,
            'compiled_app_source_sha': m.SOURCE, 'app_inputs_sha256': m.APP_INPUTS,
            'diagnostic_only': True, 'native_acceptance': False,
            'run_id': str(m.RUN), 'run_attempt': '1',
            'workflow_ref': 'KeeperCommunity/bitcoin-keeper-private/.github/workflows/keeper-private-ios-fresh-runtime.yml@refs/pull/74/merge',
            'build_execution_scope': m.FRESH_SCOPE, 'build': 'PASS', 'smoke': 'FAIL',
            'fresh_checkpoint': 'PASS', 'fresh_checkpoint_uploaded': 'PASS',
            'toolchain': {'ios_simulator_signature': {'verified': True, 'entitlements_sha256': m.SIGNED_SHA,
                'entitlement_policy': 'XCODE_GENERATED_SIGNED_AND_LINKER_EMBEDDED_SIMULATOR_ENTITLEMENTS'}},
            'fresh_checkpoint_artifact': {'id': m.APP_ARTIFACT, 'archive_sha256': m.APP_ZIP_SHA,
                'source_sha': m.SOURCE, 'run_id': str(m.RUN), 'run_attempt': 1},
            'startup_observation': {'metro': {'coverage': 'BOUNDED_INPUT_ONLY', 'exported_rows': 4,
                'rows': [
                    {'stage': 'APP_WINDOW', 'kind': 'REQUEST', 'request': 'ENTRY_BUNDLE',
                     'options': {'dev': True, 'lazy': True, 'minify': False, 'platform': 'ios',
                                 'engine': 'hermes', 'app': 'EXPECTED', 'sourcePaths': 'url-server',
                                 'modulesOnly': False, 'runModule': True, 'excludeSource': False}},
                    {'stage': 'APP_WINDOW', 'kind': 'RESPONSE', 'request': 'ENTRY_BUNDLE', 'outer_http_status': 500},
                    {'stage': 'APP_WINDOW', 'kind': 'ERROR', 'event': 'bundling_error',
                     'categories': ['MODULE_RESOLUTION'], 'error_type': 'UnableToResolveError'},
                    {'stage': 'APP_WINDOW', 'kind': 'CONSOLE', 'event': 'client_log', 'level': 'error',
                     'diagnostic_codes': ['GLOBAL_BUFFER_MISSING'],
                     'source_frames': [{'path': 'App.tsx', 'line': 10, 'column': 4}],
                     'private_payload': 'PRIVATE_SENTINEL'}]}},
            'metro_warmup': {'result': 'PASS', 'http_status': 200, 'bytes': 55000000,
                'sha256': 'a' * 64, 'duration_seconds': 34.2,
                'url': 'http://127.0.0.1:8081/index.bundle?platform=ios&dev=true&minify=false'},
            'direct_keychain_bundle': {'result': 'PASS', 'http_status': 200, 'sha256': 'b' * 64},
            'simulator_app_service_readiness': [{'result': 'PASS', 'criterion': 'SIMCTL_LISTAPPS_EXIT_ZERO',
                'after_command_index': 12, 'attempts': [{'state': 'TIMEOUT', 'duration_seconds': 5},
                    {'state': 'SUCCESS', 'exit_code': 0, 'duration_seconds': 0.2}]}],
            'direct_keychain_diagnostic': {'status': 'FAIL', 'phase': 'SIMULATOR_SETUP',
                'launches': [], 'stages': [], 'cleanup_errors': [], 'native_acceptance': False},
            'startup_diagnostics': {'replacement_observation': {'bytes': 'MATCH', 'entitlements': 'MISMATCH'}},
            'commands': [{'label': 'Wait for direct Keychain simulator boot', 'exit_code': -15,
                'duration_seconds': 240.1, 'timeout_seconds': 240,
                'command': ['PRIVATE_SENTINEL'], 'cwd': 'PRIVATE_SENTINEL'}]}

    def archive(self, value, names=('native-metadata.json',), symlink=False):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
            for name in names:
                row = zipfile.ZipInfo(name)
                if symlink:
                    row.create_system = 3; row.external_attr = 0o120777 << 16
                z.writestr(row, json.dumps(value))
        return output.getvalue()

    def decode(self, raw):
        return m.decode(raw, hashlib.sha256(raw).hexdigest(), len(raw))

    def test_nested_app_window_requests_responses_errors_frames_and_readiness_are_preserved(self):
        value = self.metadata()
        result = m.summary(self.decode(self.archive(value)), m.vocabulary())
        observed = result['observations']
        self.assertEqual(observed['startup_observation']['metro']['rows'],
            [{k: v for k, v in row.items() if k != 'private_payload'}
             for row in value['startup_observation']['metro']['rows']])
        for key in ('metro_warmup', 'direct_keychain_bundle', 'simulator_app_service_readiness',
                    'direct_keychain_diagnostic'):
            self.assertEqual(observed[key], value[key])
        self.assertEqual(result['recorded_commands'], [{'index': 1, 'label': 'Wait for direct Keychain simulator boot',
            'exit_code': -15, 'duration_seconds': 240.1, 'timeout_seconds': 240}])
        self.assertFalse(result['native_acceptance'])
        self.assertEqual(result['phase_results']['smoke'], 'FAIL')
        encoded = json.dumps(result)
        self.assertNotIn('PRIVATE_SENTINEL', encoded)
        self.assertNotIn('private_payload', encoded)
        context = result['entitlement_comparison_context']
        self.assertEqual(context['original_entitlements_field'], 'MISMATCH')
        self.assertEqual(context['recorded_full_installed_bytes'], 'MATCH')
        self.assertEqual(context['original_field_policy'], 'LEGACY_FIXED_MANUAL_SIGNING_DICTIONARY_ONLY')
        self.assertIsNone(context['observed_canonical_entitlements_sha256'])

    def test_original_collector_512_row_coverage_is_not_silently_lost(self):
        value = self.metadata()
        row = value['startup_observation']['metro']['rows'][1]
        value['startup_observation']['metro']['rows'] = [row] * 512
        result = m.summary(value, m.vocabulary())
        self.assertEqual(len(result['observations']['startup_observation']['metro']['rows']), 512)

    def test_direct_phases_pids_fixed_native_receipts_and_cleanup_are_preserved(self):
        value = self.metadata()
        receipt = {'schema': 1, 'scope': 'ACTUAL_RN_KEYCHAIN_DISPOSABLE_SERVICE_ONLY',
            'option_profile': 'PRODUCTION_WHEN_UNLOCKED_SERVICE_ONLY_NO_EXPLICIT_ACCESS_GROUP_OR_STORAGE',
            'stage': 'failed', 'operation': 'READ_EXISTING', 'failure_code': 'MISSING_ENTITLEMENT',
            'native_code': -34018, 'native_acceptance': False}
        direct = value['direct_keychain_diagnostic']
        direct.update(launches=[1001, 1002, 1003], stages=[receipt],
                      cleanup_errors=['device_shutdown', 'metro_process', 'metro_log'])
        value.update(startup_cleanup_errors=['device_delete', 'startup_capture', 'metro_output'],
                     startup_observation_cleanup='FAIL', startup_observation_capture='UNAVAILABLE')
        for phase in ('LAUNCH_SEEDED', 'READ_NATIVE_SEEDED', 'LAUNCH_UPDATED',
                      'READ_NATIVE_UPDATED', 'LAUNCH_PASS', 'READ_NATIVE_PASS'):
            direct['phase'] = phase
            result = m.summary(value, m.vocabulary())['observations']
            self.assertEqual(result['direct_keychain_diagnostic'], direct)
            for key in ('startup_cleanup_errors', 'startup_observation_cleanup', 'startup_observation_capture'):
                self.assertEqual(result[key], value[key])

    def test_exact_archive_digest_size_and_all_original_source_custody_bindings_required(self):
        raw = self.archive(self.metadata())
        for digest, size in [('0' * 64, len(raw)), (hashlib.sha256(raw).hexdigest(), len(raw) + 1)]:
            with self.assertRaises(ValueError): m.decode(raw, digest, size)
        for key, wrong in [('source_sha', '0' * 40), ('compiled_app_source_sha', '0' * 40),
                ('app_inputs_sha256', '0' * 64), ('run_id', '999'), ('run_attempt', '2'),
                ('schema', True), ('platform', 'ANDROID'), ('native_acceptance', True),
                ('diagnostic_only', False), ('build_execution_scope', 'other'),
                ('workflow_ref', 'other'), ('fresh_checkpoint_uploaded', 'NOT RUN')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                value = self.metadata(); value[key] = wrong; self.decode(self.archive(value))
        for path, wrong in [(('toolchain', 'ios_simulator_signature', 'entitlements_sha256'), '0' * 64),
                (('fresh_checkpoint_artifact', 'archive_sha256'), '0' * 64),
                (('fresh_checkpoint_artifact', 'source_sha'), '0' * 40),
                (('fresh_checkpoint_artifact', 'id'), '999')]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                value = self.metadata(); cursor = value
                for part in path[:-1]: cursor = cursor[part]
                cursor[path[-1]] = wrong; self.decode(self.archive(value))

    def test_archive_paths_duplicate_members_unknown_members_and_links_rejected(self):
        for names, symlink in [(('../native-metadata.json',), False),
                (('native-metadata.json', 'arbitrary.txt'), False),
                (('native-metadata.json', 'native-metadata.json'), False),
                (('native-metadata.json',), True)]:
            with self.subTest(names=names, symlink=symlink), self.assertRaises(ValueError):
                self.decode(self.archive(self.metadata(), names, symlink))
        self.decode(self.archive(self.metadata(), ('native-metadata.json', 'summary.json')))

    def test_unknown_strings_are_masked_and_malformed_numeric_or_hash_fields_rejected(self):
        value = self.metadata()
        value['startup_observation']['metro']['rows'][0]['options']['engine'] = 'PRIVATE_SENTINEL'
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(m.summary(value, m.vocabulary())))
        for data in [float('inf'), 2 ** 53, [None] * 1025]:
            with self.assertRaises(ValueError): m.project(data, set())
        with self.assertRaises(ValueError):
            m.project('PRIVATE_SENTINEL', set(), ('metro_warmup', 'sha256'))
        for raw in (b'{"schema":1,"schema":1}', b'{"x":NaN}'):
            with self.assertRaises(ValueError): m.strict(raw)

    def test_collector_vocabulary_rejects_dirty_or_changed_policies(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in m.POLICIES:
                target = root / '.github/native' / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / '.github/native' / name, target)
            with (root / '.github/native/startup_diagnosis.py').open('a') as output:
                output.write('\nPRIVATE_SENTINEL = "PRIVATE_SENTINEL"\n')
            with self.assertRaises(ValueError): m.vocabulary(root)


if __name__ == '__main__':
    unittest.main()
