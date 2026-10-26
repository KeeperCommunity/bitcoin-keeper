"""Retained-app phase/provenance gates; these tests do not execute a native app."""
import copy
import hashlib
import importlib.util
import json
import os
import plistlib
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('retained_runtime',
    Path(__file__).resolve().parents[1] / 'native/ios_retained_runtime.py')
runtime = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runtime)
ENV = {'KEEPER_SOURCE_SHA': 'f' * 40, 'GITHUB_RUN_ID': '7', 'GITHUB_RUN_ATTEMPT': '1'}
PROOF = copy.deepcopy(runtime.POLICY_PROOF)


class RuntimeGates(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.state = {'source_sha': ENV['KEEPER_SOURCE_SHA'], 'run_id': '7', 'run_attempt': '1',
            'build': 'NOT RUN', 'smoke': 'NOT RUN', 'native_keychain': 'NOT RUN', 'native_probe': 'NOT RUN', 'r5_features': 'NOT RUN',
            'native_acceptance': False, 'build_execution_scope': runtime.SCOPE,
            'retained_runtime_restore': 'PASS', 'reused_original_build': 'PASS',
            'retained_runtime_policy_proof': PROOF, 'built_artifact': {'executable_sha256': 'a' * 64}}
        self.native = SimpleNamespace(ROOT=self.root, PRIVATE=self.root, EVIDENCE=self.root / 'metadata.json',
            read=lambda: copy.deepcopy(self.state), save=self.save,
            artifact_identity=lambda: {'executable_sha256': 'a' * 64})
        self.addCleanup(mock.patch.stopall)
        mock.patch.dict(os.environ, ENV).start()

    def save(self, data):
        self.state = copy.deepcopy(data)
        self.native.EVIDENCE.write_text(json.dumps(data))

    def suite(self, name):
        with mock.patch.object(runtime, 'POLICY_PROOF', PROOF), mock.patch.object(runtime, 'require_worktree'):
            runtime.run_suite(self.native, name)

    def test_unproven_or_rejected_policy_cannot_run(self):
        for proof in (None, dict(PROOF, launch_request='REJECTED_OR_TIMED_OUT'),
                      dict(PROOF, process_after_10_seconds='NO_OWNED_ENTRY_OBSERVED'),
                      dict(PROOF, run_id=1), dict(PROOF, controller_source_sha='e' * 40),
                      dict(PROOF, job_id=True), dict(PROOF, job_id=123), dict(PROOF, artifact_id=456),
                      dict(PROOF, workflow_sha='c' * 40), dict(PROOF, artifact_zip_sha256='d' * 64),
                      dict(PROOF, observed_executable_sha256='a' * 64),
                      dict(PROOF, observed_bundle_tree_sha256='b' * 64),
                      dict(PROOF, comparison_job_conclusion='success'),
                      dict(PROOF, comparison_run_conclusion='success'),
                      dict(PROOF, observation_complete=False), dict(PROOF, cleanup_complete=False),
                      dict(PROOF, installed_artifact_verified=False), dict(PROOF, owned_crash_count=1),
                      dict(PROOF, qualification='KEYCHAIN_PASS'), dict(PROOF, native_acceptance=True),
                      dict(PROOF, effective_entitlements_sha256='0' * 64)):
            with self.subTest(proof=proof), mock.patch.object(runtime, 'POLICY_PROOF', proof):
                with self.assertRaises(RuntimeError):
                    runtime.require_policy()

    def test_reviewed_empty_policy_admits_only_diagnostic_after_failed_batch(self):
        proof = runtime.require_policy()
        self.assertEqual(proof['run_id'], 40282251540)
        self.assertEqual(proof['job_id'], 121437916024)
        self.assertEqual(proof['artifact_id'], 12633406300)
        self.assertEqual(proof['comparison_job_conclusion'], 'failure')
        self.assertEqual(proof['comparison_run_conclusion'], 'failure')
        self.assertEqual(proof['eligibility_scope'],
                         'CONTROL_SIMULATOR_SETUP_FAILED_ELIGIBLE_VARIANT_OBSERVATION_COMPLETE')
        self.assertEqual(proof['qualification'], 'OS_LAUNCH_AND_PROCESS_ONLY_UI_KEYCHAIN_NOT_RUN')
        self.assertEqual(runtime.module('ios_signature_comparison').entitlement_policy(proof['policy']), {})
        self.assertFalse(proof['native_acceptance'])

    def test_real_harness_failure_restores_current_build_not_run_and_preserves_original(self):
        def smoke(*args, **kwargs):
            self.assertEqual(self.state['build'], 'PASS')
            self.assertEqual(self.state['reused_original_build'], 'PASS')
            raise RuntimeError('CONTROLLED_NATIVE_FAILURE')
        self.native.smoke = smoke
        self.state['smoke'] = 'PASS'
        self.state['native_keychain'] = 'PASS'
        with self.assertRaisesRegex(RuntimeError, 'CONTROLLED_NATIVE_FAILURE'):
            self.suite('probe')
        self.assertEqual(self.state['native_probe'], 'FAIL')
        self.assertEqual(self.state['build'], 'NOT RUN')
        self.assertEqual(self.state['reused_original_build'], 'PASS')
        self.assertEqual(self.state['compiled_app_source_sha'], 'ddcd0970f80e23adf86a093cf3eebf8ad363cec9')
        self.assertFalse(self.state['native_acceptance'])

    def test_probe_cannot_bypass_failed_startup_or_changed_app(self):
        self.native.smoke = mock.Mock()
        for change in ({'smoke': 'FAIL'}, {'smoke': 'PASS', 'built_artifact': {'executable_sha256': 'b' * 64}}):
            self.state.update(change)
            with self.assertRaises(RuntimeError):
                self.suite('probe')
        self.native.smoke.assert_not_called()
        self.assertEqual(self.state['build'], 'NOT RUN')

    def test_successful_real_phase_is_qualified_as_runtime_only(self):
        self.state['smoke'] = 'PASS'
        self.state['native_keychain'] = 'PASS'
        def smoke(suite):
            self.assertEqual(suite, 'probe')
            data = self.native.read(); data['native_probe'] = 'PASS'; self.native.save(data)
        self.native.smoke = smoke
        self.suite('probe')
        self.assertEqual(self.state['native_probe'], 'PASS')
        self.assertEqual(self.state['build'], 'NOT RUN')
        self.assertEqual(self.state['current_source_compilation'], 'NOT RUN')
        self.assertFalse(self.state['native_acceptance'])

    def test_features_require_actual_persistence_probe(self):
        self.state['smoke'] = 'PASS'
        self.state['native_keychain'] = 'PASS'
        self.native.smoke = mock.Mock()
        with self.assertRaisesRegex(RuntimeError, 'ACTUAL_NATIVE_PROBE'):
            self.suite('features')
        self.native.smoke.assert_not_called()

    def test_keychain_failure_is_distinct_and_blocks_later_persistence_probe(self):
        self.state['smoke'] = 'PASS'
        self.native.smoke = mock.Mock(side_effect=RuntimeError('CONTROLLED_KEYCHAIN_FAILURE'))
        with self.assertRaisesRegex(RuntimeError, 'CONTROLLED_KEYCHAIN_FAILURE'):
            self.suite('keychain')
        self.assertEqual(self.state['native_keychain'], 'FAIL')
        self.assertEqual(self.state['smoke'], 'PASS')
        self.assertEqual(self.state['build'], 'NOT RUN')
        self.native.smoke.reset_mock()
        with self.assertRaisesRegex(RuntimeError, 'ACTUAL_KEYCHAIN_DIAGNOSTIC_PASS_REQUIRED'):
            self.suite('probe')
        self.native.smoke.assert_not_called()

    def test_direct_keychain_diagnostic_cannot_unlock_formal_native_probe(self):
        self.state.update(smoke='PASS', direct_keychain_diagnostic={'status': 'PASS'})
        self.native.smoke = mock.Mock()
        with self.assertRaisesRegex(RuntimeError, 'ACTUAL_KEYCHAIN_DIAGNOSTIC_PASS_REQUIRED'):
            self.suite('probe')
        self.native.smoke.assert_not_called()

    def test_unrecorded_worktree_change_cannot_reuse_original_source(self):
        (self.root / 'App.tsx').write_text('changed')
        with mock.patch.object(runtime.subprocess, 'check_output', return_value='App.tsx\n'):
            with self.assertRaisesRegex(RuntimeError, 'UNRECORDED_RUNTIME_SOURCE_CHANGE'):
                runtime.require_worktree(self.native)

    def test_failed_original_build_api_proof_is_not_admitted(self):
        proof = {'schema': 1, 'repository_id': 839671816,
            'source_sha': 'ddcd0970f80e23adf86a093cf3eebf8ad363cec9', 'run_id': 40189694110,
            'run_attempt': 1, 'job_id': 121157855365, 'artifact_id': 12598443612,
            'artifact_zip_sha256': 'fd1f27948a19811ecd9c80a6fe0a400a290766fbdaa5b55ef5eaa02b1224db37',
            'native_acceptance': False, 'build_step': {'name': 'Build simulator app once',
                'status': 'completed', 'conclusion': 'failure', 'started_at': 'before', 'completed_at': 'after'}}
        (self.root / 'keeper-original-ios-build-proof.json').write_text(json.dumps(proof))
        with mock.patch.dict(os.environ, {'RUNNER_TEMP': str(self.root)}):
            with self.assertRaisesRegex(RuntimeError, 'ORIGINAL_BUILD_STEP_NOT_SUCCESSFUL'):
                runtime.read_build_proof()

    def test_changed_signed_bundle_is_blocked_before_runtime_and_keeps_original_provenance(self):
        comparison = runtime.module('ios_signature_comparison')
        policy = comparison.entitlement_policy('empty_entitlements')
        self.state.update(retained_runtime_dependencies='PASS',
            toolchain={'ios_simulator_signature': {'verified': True}})
        self.native.sign_simulator_app = mock.Mock()
        self.native.command = mock.Mock(return_value=plistlib.dumps(policy).decode())
        self.native.artifact_identity = lambda: {'executable_sha256': PROOF['observed_executable_sha256'],
            'bundle_tree_sha256': '0' * 64}
        def invalidate(*args):
            self.state['toolchain']['ios_simulator_signature']['verified'] = False
        comparison.restore = mock.Mock(return_value={'source_sha': comparison.SOURCE})
        comparison.resign_outer_for_comparison = invalidate
        comparison.metadata = lambda: {'original_build': {'source_sha': comparison.SOURCE}}
        original_module = runtime.module
        with mock.patch.object(runtime, 'POLICY_PROOF', PROOF), mock.patch.object(runtime, 'require_worktree'), \
                mock.patch.object(runtime, 'read_build_proof', return_value={'job_id': 121157855365}), \
                mock.patch.dict(os.environ, {'RUNNER_TEMP': str(self.root)}), \
                mock.patch.object(runtime, 'module', side_effect=lambda name: comparison if name == 'ios_signature_comparison' else original_module(name)):
            with self.assertRaisesRegex(RuntimeError, 'REPRODUCED_SIGNED_APP_DIFFERS'):
                runtime.restore_app(self.native)
        self.assertEqual(self.state['retained_runtime_restore'], 'INCOMPLETE')
        self.assertEqual(self.state['original_build']['source_sha'], comparison.SOURCE)
        self.assertEqual(self.state['original_build']['build'], 'PASS')
        self.assertFalse(self.state['toolchain']['ios_simulator_signature']['verified'])

    def test_exact_reproduced_empty_signature_still_does_not_prequalify_keychain(self):
        comparison = runtime.module('ios_signature_comparison')
        self.state.update(retained_runtime_dependencies='PASS',
            toolchain={'ios_simulator_signature': {'verified': False}})
        observed = {'path': '/different/owned/private/app',
            'executable_sha256': PROOF['observed_executable_sha256'],
            'bundle_tree_sha256': PROOF['observed_bundle_tree_sha256']}
        self.native.sign_simulator_app = mock.Mock()
        self.native.command = mock.Mock(return_value=plistlib.dumps({}).decode())
        self.native.artifact_identity = lambda: observed
        comparison.restore = mock.Mock(return_value={'source_sha': comparison.SOURCE})
        comparison.resign_outer_for_comparison = mock.Mock()
        original_module = runtime.module
        with mock.patch.object(runtime, 'require_worktree'), \
                mock.patch.object(runtime, 'read_build_proof', return_value={'job_id': 121157855365}), \
                mock.patch.dict(os.environ, {'RUNNER_TEMP': str(self.root), 'GITHUB_WORKFLOW_REF': 'private',
                                           'GITHUB_WORKFLOW_SHA': 'c' * 40}), \
                mock.patch.object(runtime, 'module', side_effect=lambda name: comparison if name == 'ios_signature_comparison' else original_module(name)):
            runtime.restore_app(self.native)
        comparison.resign_outer_for_comparison.assert_called_once_with(self.native, {})
        self.assertEqual(self.state['retained_runtime_restore'], 'PASS')
        self.assertEqual(self.state['built_artifact'], observed)
        self.assertEqual(self.state['toolchain']['ios_simulator_signature']['keychain_behavior'], 'NOT_YET_TESTED')
        self.assertEqual(self.state['original_build']['original_smoke'], 'FAIL_PRESERVED')
        self.assertEqual(self.state['native_probe'], 'NOT RUN')
        self.assertFalse(self.state['native_acceptance'])

    def test_job_log_projection_never_emits_raw_private_values_or_unvalidated_hashes(self):
        self.state.update(controller_source_sha=ENV['KEEPER_SOURCE_SHA'],
            commands=[{'command': ['PRIVATE_ARGV']}], startup_cleanup_errors=['PRIVATE_PATH'],
            arbitrary='PRIVATE_APP_DATA', smoke='PRIVATE_ERROR_TEXT',
            toolchain={'ios_simulator_signature': {'entitlements_sha256': 'PRIVATE_NOT_A_HASH'}})
        self.save(self.state)
        value = runtime.project_summary(self.native)
        text = json.dumps(value)
        self.assertNotIn('PRIVATE_', text)
        self.assertEqual(value['startup'], 'UNKNOWN')
        self.assertEqual(value['startup_cleanup'], 'FAIL')
        self.assertIsNone(value['effective_entitlements_sha256'])
        self.assertEqual(value['current_build'], 'NOT RUN')
        self.assertFalse(value['native_acceptance'])


if __name__ == '__main__':
    unittest.main()
