"""Retained-build admission and observational lifecycle; no native acceptance."""
import importlib.util
import contextlib
import io
import json
from datetime import datetime, timezone
import os
from pathlib import Path
import plistlib
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('comparison', Path(__file__).resolve().parents[1] / 'native/ios_signature_comparison.py')
comparison = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(comparison)
DEVICE = '12345678-1234-1234-1234-123456789ABC'
ENV = dict(KEEPER_SOURCE_SHA='f' * 40, GITHUB_RUN_ID='2', GITHUB_RUN_ATTEMPT='1',
           GITHUB_WORKFLOW_REF='private/workflow', GITHUB_WORKFLOW_SHA='a' * 40)

class ComparisonTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_wrong_zip_or_alias_rejects_before_unpacking(self):
        native = SimpleNamespace(PRIVATE=self.root)
        input_zip = self.root / 'original.zip'
        input_zip.write_bytes(b'WRONG_APP')
        for kind in ('regular', 'symlink', 'hardlink'):
            with self.subTest(kind=kind):
                candidate = input_zip
                if kind == 'symlink':
                    candidate = self.root / 'symlink.zip'
                    candidate.symlink_to(input_zip)
                if kind == 'hardlink':
                    candidate = self.root / 'hardlink.zip'
                    os.link(input_zip, candidate)
                with self.assertRaises((ValueError, OSError)), mock.patch.object(comparison.tarfile, 'open') as unpack:
                    comparison.restore(native, candidate)
                unpack.assert_not_called()
        self.assertFalse((self.root / 'DerivedData').exists())

    def variant(self, name, fail=None, stream_failure=False):
        native = comparison.module('ios_launch_debug').load_native()
        native.PLATFORM = 'IOS'
        cleanup = []
        def command(args, label, **kwargs):
            data = native.read()
            data['commands'].append({'command': args, 'label': label, 'exit_code': 1 if label == fail else 0})
            native.save(data)
            (native.PRIVATE / ('command-%03d.log' % len(data['commands']))).write_bytes(b'')
            if label == fail:
                raise RuntimeError('PRIVATE_REASON')
            if args[:2] == ['codesign', '--display']:
                return plistlib.dumps(comparison.entitlement_policy(name)).decode()
            if args[:3] == ['xcrun', 'simctl', 'create']:
                return DEVICE
            if args[:3] == ['xcrun', 'simctl', 'launch']:
                return comparison.APP + ': 123'
        native.command = command
        def installed(device):
            data = native.read()
            data.update(installed_artifact_verified=True, installed_artifact={'inventory_sha256': 'f' * 64})
            native.save(data)
        native.verify_installed_artifact = installed
        native.wait_for_simulator_app_services = lambda device: None
        native.artifact_identity = lambda: {'path': 'private/app', 'executable_sha256': 'a' * 64}
        def sign():
            data = native.read()
            data['toolchain']['ios_simulator_signature'] = {'verified': True, 'embedded_code_count': 3}
            native.save(data)
        native.sign_simulator_app = mock.Mock(side_effect=sign)
        class Stream:
            def __init__(self, path, args):
                path.write_bytes(b'')
            def stop(self):
                return {'drain_failed': stream_failure, 'cleanup_failed': False, 'initial_exit_code': None}
        observer = SimpleNamespace(process=mock.Mock(side_effect=[{'state':'NO_OWNED_ENTRY_OBSERVED'},
            {'state':'OWNED_RUNNING_ENTRY_OBSERVED'}, {'state':'NO_OWNED_ENTRY_OBSERVED'}]), codes=lambda payload: {})
        debug = SimpleNamespace(load_native=lambda: native, Stream=Stream, MAX_LOG=1024,
            crash_reasons=lambda *args: [{'termination': {'namespace':'CODESIGNING','code':1}}])
        def run(args, **kwargs):
            cleanup.append(args)
        with mock.patch.dict(os.environ, ENV), mock.patch.object(comparison, 'restore'), mock.patch.object(
                comparison.subprocess, 'run', side_effect=run), mock.patch.object(comparison.time, 'sleep') as delay:
            result = comparison.compare_variant(name, self.root, self.root, self.root / 'input.zip', debug, observer)
        return result, native, cleanup, delay

    def test_accepted_launch_with_dead_later_process_does_not_grant_acceptance(self):
        result, native, cleanup, delay = self.variant('original')
        self.assertTrue(result['observation_complete'])
        self.assertEqual(result['launch_request'], 'ACCEPTED')
        self.assertEqual(result['after_process']['state'], 'NO_OWNED_ENTRY_OBSERVED')
        self.assertFalse(result['native_acceptance'])
        self.assertTrue(result['installed_artifact_verified'])
        self.assertEqual(result['installed_artifact']['inventory_sha256'], 'f' * 64)
        self.assertEqual([row[2] for row in cleanup], ['shutdown', 'delete'])
        delay.assert_called_once_with(10)
        native.sign_simulator_app.assert_not_called()

    def test_setup_failure_records_phase_and_does_not_look_complete(self):
        result, native, cleanup, delay = self.variant('complete_nested', 'Install exact comparison simulator app')
        self.assertFalse(result['observation_complete'])
        self.assertEqual(result['phase'], 'SIMULATOR_SETUP')
        self.assertEqual(result['setup_error_type'], 'RuntimeError')
        self.assertNotIn('PRIVATE_REASON', str(result))
        self.assertFalse(result['installed_artifact_verified'])
        native.sign_simulator_app.assert_called_once()
        self.assertEqual([row[2] for row in cleanup], ['shutdown', 'delete'])

    def test_rejected_launch_is_an_observed_failure_not_a_setup_error(self):
        result, _, _, _ = self.variant('original', 'Launch original app once')
        self.assertTrue(result['observation_complete'])
        self.assertEqual(result['launch_request'], 'REJECTED_OR_TIMED_OUT')
        self.assertEqual(result['launch_command']['exit_code'], 1)
        self.assertFalse(result['native_acceptance'])

    def test_capture_drain_failure_cannot_complete_the_comparison(self):
        result, _, _, _ = self.variant('original', stream_failure=True)
        self.assertFalse(result['observation_complete'])
        self.assertIn('host_stream_drain_failed', result['cleanup_errors'])

    def test_one_key_delta_preserves_app_and_keychain_identity_and_default_policy(self):
        original = comparison.entitlement_policy('complete_nested')
        changed = comparison.entitlement_policy('without_team_identifier')
        self.assertEqual(set(original) - set(changed), {'com.apple.developer.team-identifier'})
        self.assertEqual(changed, {key: value for key, value in original.items() if key != 'com.apple.developer.team-identifier'})
        self.assertEqual(comparison.entitlement_policy('complete_nested'), original)
        result, native, _, _ = self.variant('without_team_identifier')
        self.assertTrue(result['observation_complete'])
        self.assertEqual(result['entitlement_keys'], sorted(changed))
        self.assertEqual(result['static_signature']['entitlements_sha256'], result['effective_entitlements_sha256'])
        self.assertEqual(result['static_signature']['keychain_behavior'], 'NOT_TESTED')
        self.assertFalse((native.PRIVATE / 'comparison-debug.entitlements').exists())
        self.assertFalse(result['native_acceptance'])

    def test_one_key_signing_failure_is_incomplete_and_removes_temporary_entitlements(self):
        result, native, _, _ = self.variant('without_team_identifier', 'Apply reviewed simulator entitlement comparison')
        self.assertFalse(result['observation_complete'])
        self.assertEqual(result['phase'], 'STATIC_SIGNATURE')
        self.assertFalse(result['static_signature']['verified'])
        self.assertFalse((native.PRIVATE / 'comparison-debug.entitlements').exists())

    def test_identity_groups_variant_removes_only_debug_entitlement_from_teamless(self):
        before = comparison.entitlement_policy('without_team_identifier')
        after = comparison.entitlement_policy('identity_groups_only')
        self.assertEqual(set(before) - set(after), {'get-task-allow'})
        self.assertEqual(after, {key: value for key, value in before.items() if key != 'get-task-allow'})
        result, _, _, _ = self.variant('identity_groups_only')
        self.assertTrue(result['observation_complete'])
        self.assertEqual(result['effective_entitlements'], after)
        self.assertEqual(result['keychain_access_groups'], before['keychain-access-groups'])

    def test_empty_policy_is_only_os_diagnostic_and_does_not_claim_keychain_access(self):
        self.assertEqual(comparison.entitlement_policy('empty_entitlements'), {})
        result, _, _, _ = self.variant('empty_entitlements')
        self.assertTrue(result['observation_complete'])
        self.assertEqual(result['effective_entitlements'], {})
        self.assertIsNone(result['keychain_access_groups'])
        self.assertEqual(result['static_signature']['keychain_behavior'], 'NOT_TESTED')
        self.assertFalse(result['native_acceptance'])

    def test_live_policy_projection_requires_owned_path_thread_and_window(self):
        def row(thread, message, second=1):
            return {'processImagePath': '/usr/libexec/amfid', 'threadID': thread, 'processID': 97,
                'timestamp': '2026-10-26 06:00:%02d.000000+0000' % second, 'eventMessage': message}
        marker = 'Requirements for restricted entitlements failed to validate, error -67688'
        path = self.root / 'stream.log'
        rows = [row(10, '/Devices/' + DEVICE + '/hexa_keeper_dev.app/hexa_keeper_dev PRIVATE_PATH'),
            row(11, marker), row(10, 'AppleMobileFileIntegrityError Code=-420', 9)]
        start = datetime(2026, 10, 26, 6, tzinfo=timezone.utc).timestamp()
        path.write_text('\n'.join(json.dumps(value) for value in rows))
        result = comparison.host_policy_observation(path, DEVICE, start, start + 5)
        self.assertEqual(result['owned_thread_count'], 1)
        self.assertFalse(result['restricted_entitlement_requirement_failed'])
        self.assertFalse(result['amfi_invalid_signature'])
        rows.append(row(10, marker))
        path.write_text('\n'.join(json.dumps(value) for value in rows))
        result = comparison.host_policy_observation(path, DEVICE, start, start + 5)
        self.assertTrue(result['restricted_entitlement_requirement_failed'])
        self.assertNotIn('PRIVATE_PATH', str(result))

    def test_joblog_projection_omits_private_paths_raw_errors_and_unknown_crash_text(self):
        value, _, _, _ = self.variant('empty_entitlements')
        value.update(observed_artifact=None, arbitrary_secret='SECRET',
            owned_crashes=[{'termination': {'namespace': 'SECRET', 'code': 1},
                'faulting_symbols': ['PRIVATE_FUNCTION'], 'exception': {'reason': 'SECRET'}}])
        with mock.patch.dict(os.environ, ENV), contextlib.redirect_stdout(io.StringIO()) as output:
            comparison.emit_bounded_summary(comparison.metadata(), [value])
        text = output.getvalue()
        self.assertTrue(text.startswith('IOS_SIGNATURE_OBSERVATION '))
        self.assertNotIn('SECRET', text)
        self.assertNotIn('PRIVATE_FUNCTION', text)
        self.assertNotIn('private/app', text)
        self.assertFalse(json.loads(text.split(' ', 1)[1])['native_acceptance'])

if __name__ == '__main__':
    unittest.main()
