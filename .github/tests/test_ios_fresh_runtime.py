"""Fresh-producer provenance and ordering; no app compilation or native execution."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock
import yaml

SPEC = importlib.util.spec_from_file_location('fresh', Path(__file__).parents[1] / 'native/ios_fresh_runtime.py')
fresh = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(fresh)
ENV = {'KEEPER_SOURCE_SHA': 'a' * 40, 'GITHUB_RUN_ID': '9', 'GITHUB_WORKFLOW_SHA': 'b' * 40}


class FreshGates(unittest.TestCase):
    def setUp(self):
        self.addCleanup(mock.patch.stopall)
        mock.patch.dict(os.environ, ENV).start()
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.state = {'source_sha': ENV['KEEPER_SOURCE_SHA'], 'run_id': '9', 'run_attempt': '1',
            'workflow_sha': ENV['GITHUB_WORKFLOW_SHA'], 'build_execution_scope': fresh.SCOPE,
            'native_acceptance': False, 'build': 'PASS', 'fresh_policy': 'PASS',
            'fresh_checkpoint': 'PASS', 'fresh_checkpoint_uploaded': 'PASS',
            'built_artifact': {'path': '/owned/new/app', 'executable_sha256': 'c' * 64},
            'smoke': 'NOT RUN', 'native_keychain': 'NOT RUN', 'native_probe': 'NOT RUN',
            'r5_features': 'NOT RUN', 'toolchain': {'ios_simulator_signature': {'verified': True}}}
        self.native = SimpleNamespace(ROOT=self.root, PRIVATE=self.root,
            EVIDENCE=self.root / 'metadata.json', read=lambda: copy.deepcopy(self.state),
            save=lambda value: setattr(self, 'state', copy.deepcopy(value)),
            artifact_identity=lambda: copy.deepcopy(self.state['built_artifact']),
            command=mock.Mock(), smoke=mock.Mock())

    def test_changed_origin_artifact_or_missing_checkpoint_never_starts_runtime(self):
        original = copy.deepcopy(self.state)
        for change in ({'source_sha': 'd' * 40}, {'run_id': '8'}, {'native_acceptance': True},
                       {'build': 'NOT RUN'}, {'fresh_policy': 'FAIL'}, {'fresh_checkpoint': 'INCOMPLETE'},
                       {'fresh_checkpoint_uploaded': 'NOT RUN'}):
            self.state = {**original, **change}
            with mock.patch.object(fresh, 'source_bytes'), self.assertRaises(RuntimeError):
                fresh.run_suite(self.native, 'startup')
            self.native.smoke.assert_not_called()
        self.state = original
        self.native.artifact_identity = lambda: {'changed': True}
        with mock.patch.object(fresh, 'source_bytes'), self.assertRaises(RuntimeError):
            fresh.run_suite(self.native, 'direct_keychain')

    def test_direct_result_cannot_supply_formal_startup_keychain_or_probe(self):
        self.state['direct_keychain_diagnostic'] = {'status': 'PASS', 'native_acceptance': False}
        for suite in ('keychain', 'probe', 'features'):
            with mock.patch.object(fresh, 'source_bytes'), self.assertRaises(RuntimeError):
                fresh.run_suite(self.native, suite)
        self.state['smoke'] = 'PASS'
        for suite in ('probe', 'features'):
            with mock.patch.object(fresh, 'source_bytes'), self.assertRaises(RuntimeError):
                fresh.run_suite(self.native, suite)
        self.state['native_keychain'] = 'PASS'
        with mock.patch.object(fresh, 'source_bytes'), self.assertRaises(RuntimeError):
            fresh.run_suite(self.native, 'features')
        self.native.smoke.assert_not_called()

    def test_failed_formal_keychain_preserves_actual_build_and_blocks_probe(self):
        self.state['smoke'] = 'PASS'
        self.native.smoke.side_effect = RuntimeError('CONTROLLED_FAILURE')
        with mock.patch.object(fresh, 'source_bytes'), self.assertRaises(RuntimeError):
            fresh.run_suite(self.native, 'keychain')
        self.assertEqual(self.state['native_keychain'], 'FAIL')
        self.assertEqual(self.state['build'], 'PASS')
        self.assertFalse(self.state['native_acceptance'])
        with mock.patch.object(fresh, 'source_bytes'), self.assertRaises(RuntimeError):
            fresh.run_suite(self.native, 'probe')

    def test_successful_build_cannot_be_compiled_again_or_uploaded_credit_invented(self):
        self.native.run_phase = mock.Mock()
        debug = SimpleNamespace(load_native=lambda: self.native)
        with mock.patch.object(fresh, 'module', return_value=debug), mock.patch.object(fresh, 'require_selection'):
            with self.assertRaises(RuntimeError): fresh.main('build')
            with mock.patch.dict(os.environ, {'KEEPER_FRESH_ARTIFACT_ID': '', 'KEEPER_FRESH_ARTIFACT_DIGEST': ''}):
                with self.assertRaises(RuntimeError): fresh.main('uploaded')
        self.native.run_phase.assert_not_called()

    def test_failed_signature_never_creates_checkpoint_or_runtime_credit(self):
        self.state['fresh_policy'] = self.state['fresh_checkpoint'] = 'NOT RUN'
        comparison = SimpleNamespace(entitlement_policy=lambda _: {}, resign_outer_for_comparison=mock.Mock())
        retain = mock.Mock()
        original = fresh.module
        def module(name):
            if name == 'ios_signature_comparison': return comparison
            if name == 'ios_launch_debug': return SimpleNamespace(retain=retain)
            return original(name)
        self.native.command.return_value = plistlib.dumps({'wrong': True}).decode()
        with mock.patch.object(fresh, 'source_bytes'), mock.patch.object(fresh, 'module', side_effect=module), self.assertRaises(RuntimeError):
            fresh.checkpoint(self.native)
        retain.assert_not_called()
        self.assertEqual(self.state['fresh_checkpoint'], 'NOT RUN')

    def test_new_verified_build_records_new_identity_and_does_not_borrow_old_golden_bytes(self):
        comparison = SimpleNamespace(entitlement_policy=lambda _: {}, resign_outer_for_comparison=mock.Mock())
        retain = mock.Mock()
        original = fresh.module
        def module(name):
            if name == 'ios_signature_comparison': return comparison
            if name == 'ios_launch_debug': return SimpleNamespace(retain=retain)
            return original(name)
        self.native.command.side_effect = [plistlib.dumps({}).decode(), 'Signature=adhoc\n']
        with mock.patch.object(fresh, 'source_bytes'), mock.patch.object(fresh, 'module', side_effect=module):
            fresh.checkpoint(self.native)
        self.assertEqual(self.state['fresh_checkpoint'], 'PASS')
        self.assertEqual(self.state['built_artifact']['executable_sha256'], 'c' * 64)
        self.assertEqual(self.state['smoke'], 'NOT RUN')
        self.assertEqual(self.state['native_keychain'], 'NOT RUN')
        self.assertFalse(self.state['native_acceptance'])
        retain.assert_called_once_with(self.native)

    def test_raw_source_rejects_hidden_edits_and_root_platform_override(self):
        (self.root / 'src').mkdir(); (self.root / 'src/app.ts').write_text('original')
        (self.root / 'App.tsx').write_text('original')
        def git(*args):
            return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.DEVNULL)
        git('init', '-q'); git('add', '.')
        git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
        fresh.source_bytes(self.native, prepared=False)
        git('update-index', '--assume-unchanged', 'src/app.ts')
        (self.root / 'src/app.ts').write_text('modified')
        with self.assertRaises(RuntimeError): fresh.source_bytes(self.native, prepared=False)
        (self.root / 'src/app.ts').write_text('original')
        (self.root / 'App.ios.tsx').write_text('platform override')
        with self.assertRaises(RuntimeError): fresh.source_bytes(self.native, prepared=False)

    def test_only_four_recorded_ios_overlays_and_three_package_mappings_are_admitted(self):
        package = self.root / 'package.json'
        original = json.dumps({'private': True, 'dependencies': {'realm': '12.15.0'}}).encode()
        package.write_bytes(original)
        for name in fresh.OVERLAYS:
            path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b'original')
        def git(*args):
            return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.DEVNULL)
        git('init', '-q'); git('add', '.')
        git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
        overlays = []
        for name in fresh.OVERLAYS:
            (self.root / name).write_bytes(b'synthetic')
            overlays.append({'path': name, 'sha256': hashlib.sha256(b'synthetic').hexdigest()})
        modified = json.loads(original); modified['browser'] = {'path': 'path-browserify'}
        package.write_text(json.dumps(modified))
        self.state.update(configuration_overlays=overlays, nodeify_overlay={
            'path': 'package.json', 'allowed_fields': ['browser', 'react-native', 'browserify'],
            'before_sha256': hashlib.sha256(original).hexdigest(),
            'after_sha256': hashlib.sha256(package.read_bytes()).hexdigest()})
        fresh.source_bytes(self.native)
        modified['private'] = 1
        package.write_text(json.dumps(modified))
        self.state['nodeify_overlay']['after_sha256'] = hashlib.sha256(package.read_bytes()).hexdigest()
        with self.assertRaises(RuntimeError): fresh.source_bytes(self.native)

    def test_workflow_saves_app_before_direct_and_ui_with_only_direct_failure_optional(self):
        workflow = Path(__file__).parents[1] / 'workflows/keeper-private-ios-fresh-runtime.yml'
        job = yaml.load(workflow.read_text(), Loader=yaml.BaseLoader)['jobs']['fresh']
        steps = job['steps']
        index = {step.get('run', ''): i for i, step in enumerate(steps)}
        upload = next(i for i, step in enumerate(steps) if step.get('id') == 'checkpoint')
        phase = lambda value: index['python3 .github/native/ios_fresh_runtime.py ' + value]
        self.assertLess(phase('build'), phase('checkpoint'))
        self.assertLess(phase('checkpoint'), upload)
        self.assertLess(upload, phase('uploaded'))
        self.assertLess(phase('uploaded'), phase('direct_keychain'))
        self.assertLess(phase('direct_keychain'), phase('startup'))
        self.assertEqual(steps[phase('direct_keychain')]['continue-on-error'], 'true')
        for name in ('startup', 'keychain', 'probe', 'features'):
            self.assertNotIn('continue-on-error', steps[phase(name)])
        self.assertEqual(job['concurrency']['cancel-in-progress'], 'false')


if __name__ == '__main__': unittest.main()
