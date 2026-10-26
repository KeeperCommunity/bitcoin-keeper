import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock
import yaml

ROOT = Path(__file__).resolve().parents[2]
def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / '.github/native' / (name + '.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
m = load('android_compile_checkpoint_only')
projection = load('android_runtime_evidence_readout')
WORKER = yaml.load((ROOT / '.github/workflows/keeper-native-platform.yml').read_text(), Loader=yaml.BaseLoader)['jobs']['native']


def expression(raw, values):
    raw = raw.removeprefix('${{').removesuffix('}}').strip()
    for name in sorted(values, key=len, reverse=True):
        raw = raw.replace(name, repr(values[name]))
    raw = raw.replace('&&', ' and ').replace('||', ' or ')
    raw = re.sub(r'!(?!=)', ' not ', raw)
    raw = re.sub(r"'[^']*'|\b(?:true|false)\b", lambda match: {'true': 'True', 'false': 'False'}.get(match[0], match[0]), raw)
    return bool(eval(raw, {'__builtins__': {}, 'contains': lambda values, item: item in values}, {}))


def context(**updates):
    result = {'inputs.platform': 'ANDROID', 'inputs.diagnostic': True, 'inputs.prepare_only': False,
        'github.repository_id': '839671816', 'github.event.repository.private': True,
        'github.event.pull_request.number': 73, 'github.event.pull_request.head.repo.id': 839671816,
        'github.event.pull_request.labels.*.name': [m.LABEL, 'keeper/native-diagnostic', 'keeper/android-diagnostic-only']}
    result.update(updates); return result


class CompileOnlyControls(unittest.TestCase):
    def test_actual_workflow_scope_skips_only_android_emulator_after_retention(self):
        for change, expected in [({}, True), ({'inputs.diagnostic': False}, False),
            ({'inputs.platform': 'IOS'}, False), ({'github.repository_id': '1'}, False),
            ({'github.event.repository.private': False}, False), ({'github.event.pull_request.number': 74}, False),
            ({'github.event.pull_request.head.repo.id': 1}, False), ({'inputs.prepare_only': True}, False),
            ({'github.event.pull_request.labels.*.name': ['keeper/native-diagnostic', 'keeper/android-diagnostic-only']}, False)]:
            with self.subTest(change=change):
                values = context(**change)
                flag = expression(WORKER['env']['KEEPER_ANDROID_CHECKPOINT_ONLY'], values)
                self.assertEqual(flag, expected)
                values['env.KEEPER_ANDROID_CHECKPOINT_ONLY'] = str(flag).lower()
                for name in ('Enable emulator acceleration', 'Run Android startup and native persistence probes'):
                    step = next(row for row in WORKER['steps'] if row['name'] == name)
                    selected = expression(step['if'], values)
                    normal = values['inputs.platform'] == 'ANDROID' and not values['inputs.prepare_only']
                    self.assertEqual(selected, normal and not expected)
        steps = [row['name'] for row in WORKER['steps']]
        self.assertLess(steps.index('Upload private Android build checkpoint'), steps.index('Finalize explicit private Android compile-only outcome'))
        self.assertLess(steps.index('Finalize explicit private Android compile-only outcome'), steps.index('Enable emulator acceleration'))
        self.assertIn('android_build_watch.py', next(row['run'] for row in WORKER['steps'] if row['name'] == 'Build development app'))

    def test_actual_fresh_pr_check_rejects_removed_added_or_conflicting_modifier(self):
        step = next(row for row in WORKER['steps'] if row['name'] == 'Verify current diagnostic source')
        script = re.sub(r'\$\{\{(.*?)\}\}', lambda match: str(expression(match[1], context())).lower(), step['with']['script'])
        initial = context()['github.event.pull_request.labels.*.name']
        for flag, labels, rejected in [('true', initial, False), ('true', initial[:-3] + initial[1:], True),
            ('false', initial, True), ('true', initial + ['keeper/ios-diagnostic-only'], True)]:
            with self.subTest(flag=flag, labels=labels):
                pr = {'head': {'sha': 'a' * 40, 'repo': {'full_name': m.REPOSITORY}},
                    'labels': [{'name': name} for name in labels]}
                code = "const failures=[]; const github={rest:{pulls:{get:async()=>({data:" + json.dumps(pr) + "})}}}; const core={setFailed:x=>failures.push(x)}; const context={repo:{owner:'KeeperCommunity',repo:'bitcoin-keeper-private'},payload:{pull_request:{number:73}}}; (async()=>{" + script + "; console.log(JSON.stringify(failures));})().catch(()=>process.exit(2));"
                run = subprocess.run(['node', '-e', code], env={**os.environ, 'EXPECTED_SOURCE': 'a' * 40,
                    'KEEPER_ANDROID_CHECKPOINT_ONLY': flag, 'PREPARE_ONLY': 'false'}, text=True, capture_output=True, check=True)
                self.assertEqual(bool(json.loads(run.stdout)), rejected)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); (self.root / 'input').write_text('SYNTHETIC')
        subprocess.run(['git', 'init', '-q'], cwd=self.root, check=True)
        subprocess.run(['git', 'add', 'input'], cwd=self.root, check=True)
        subprocess.run(['git', '-c', 'user.name=Control', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'synthetic'], cwd=self.root, check=True)
        source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=self.root, text=True).strip()
        self.event = {'repository': {'id': 839671816, 'private': True}, 'pull_request': {'number': 73,
            'head': {'sha': source, 'repo': {'id': 839671816}},
            'labels': [{'name': name} for name in context()['github.event.pull_request.labels.*.name']]}}
        self.event_file = self.root / 'event.json'; self.event_file.write_text(json.dumps(self.event))
        self.apk = self.root / 'app.apk'; self.apk.write_bytes(b'SYNTHETIC_APK_NOT_APP')
        identity = lambda: {'path': 'app.apk', 'sha256': hashlib.sha256(self.apk.read_bytes()).hexdigest()}
        self.value = {'source_sha': source, 'run_id': '12345', 'run_attempt': '1', 'platform': 'ANDROID',
            'diagnostic_only': True, 'build': 'PASS', 'built_artifact': identity(), **dict.fromkeys(m.GATES, 'NOT RUN')}
        self.saved = []
        self.native = SimpleNamespace(ROOT=self.root, read=lambda: copy.deepcopy(self.value),
            artifact_identity=identity, save=lambda value: self.saved.append(value))
        self.env = {'GITHUB_ACTIONS': 'true', 'GITHUB_REPOSITORY_ID': '839671816', 'RUNNER_ENVIRONMENT': 'github-hosted',
            'GITHUB_REPOSITORY': m.REPOSITORY, 'GITHUB_EVENT_NAME': 'pull_request', 'GITHUB_RUN_ATTEMPT': '1',
            'KEEPER_DIAGNOSTIC': 'true', 'KEEPER_NATIVE_PLATFORM': 'ANDROID', 'KEEPER_ANDROID_CHECKPOINT_ONLY': 'true',
            'GITHUB_EVENT_PATH': str(self.event_file), 'KEEPER_SOURCE_SHA': source, 'GITHUB_RUN_ID': '12345',
            'KEEPER_CHECKPOINT_ARTIFACT_ID': '456789', 'KEEPER_CHECKPOINT_ARTIFACT_DIGEST': 'b' * 64}

    def test_finalization_retains_explicit_not_run_without_changing_apk(self):
        before = self.apk.read_bytes()
        with contextlib.redirect_stdout(io.StringIO()): m.finish(self.native, self.env)
        self.assertEqual(len(self.saved), 1)
        self.assertEqual({key: self.saved[0][key] for key in m.GATES}, dict.fromkeys(m.GATES, 'NOT RUN'))
        self.assertFalse(self.saved[0]['native_acceptance'])
        self.assertEqual(self.saved[0]['compile_checkpoint_only']['status'], 'APK_RETAINED_RUNTIME_NOT_RUN')
        self.assertEqual(self.apk.read_bytes(), before)

    def test_failed_upload_wrong_context_changed_apk_or_native_credit_rejected(self):
        for updates in [{'KEEPER_CHECKPOINT_ARTIFACT_ID': ''}, {'KEEPER_CHECKPOINT_ARTIFACT_DIGEST': 'bad'},
            {'KEEPER_DIAGNOSTIC': 'false'}, {'GITHUB_RUN_ATTEMPT': '2'}, {'GITHUB_REPOSITORY_ID': '1'},
            {'KEEPER_ANDROID_CHECKPOINT_ONLY': 'false'}]:
            with self.subTest(updates=updates), self.assertRaises(RuntimeError): m.finish(self.native, {**self.env, **updates})
        for gate in m.GATES:
            self.value[gate] = 'PASS'
            with self.subTest(gate=gate), self.assertRaises(RuntimeError): m.finish(self.native, self.env)
            self.value[gate] = 'NOT RUN'
        self.apk.write_bytes(b'CHANGED')
        with self.assertRaises(RuntimeError): m.finish(self.native, self.env)
        self.assertEqual(self.saved, [])

    def test_terminal_projection_includes_fixed_onboarding_map_without_private_text(self):
        value = {'product_ui': {'status': 'FAIL', 'samples': [{'android_runtime_diagnostic': {'facts': {
            'onboarding_boundary_observation': {'stages': {'SKIP_PRESS': True, 'PRIVATE_SENTINEL': True},
                'ordered_stages': ['SKIP_PRESS'], 'coverage': 'POSITIVE_ONLY_MISSING_STAGES_UNKNOWN'}}},
            'scope': 'PRIVATE_SENTINEL'}]}}
        result = projection.terminal_summary(value, projection.vocabulary())
        receipt = result['product_samples'][0]['android_runtime_diagnostic']['facts']['onboarding_boundary_observation']
        self.assertEqual(receipt['stages'], {'SKIP_PRESS': True})
        self.assertEqual(receipt['ordered_stages'], ['SKIP_PRESS'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        self.assertFalse(result['native_acceptance'])

    def test_real_terminal_cli_binds_own_source_and_rejects_dirty_vocabulary(self):
        native = self.root / '.github/native'; native.mkdir(parents=True)
        for name in (*projection.POLICIES, 'android_runtime_evidence_readout.py'):
            (native / name).write_bytes((ROOT / '.github/native' / name).read_bytes())
        subprocess.run(['git', 'add', '.github'], cwd=self.root, check=True)
        subprocess.run(['git', '-c', 'user.name=Control', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixed policy'], cwd=self.root, check=True)
        source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=self.root, text=True).strip()
        value = {**self.value, 'schema': 1, 'source_sha': source, 'product_ui': {'status': 'FAIL',
            'samples': [{'scope': 'PRIVATE_SENTINEL', 'status': 'FAIL'}]}}
        metadata = self.root / 'artifacts/native/android/metadata.json'; metadata.parent.mkdir(parents=True)
        metadata.write_text(json.dumps(value))
        env = {**os.environ, **self.env, 'KEEPER_SOURCE_SHA': source}
        command = ['python3', '-B', str(native / 'android_runtime_evidence_readout.py'), 'terminal']
        result = subprocess.run(command, env=env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('PRIVATE_SENTINEL', result.stdout)
        summary = json.loads(result.stdout.split('KEEPER_PRIVATE_ANDROID_TERMINAL ')[1])
        self.assertEqual(summary['app_source'], source)
        self.assertEqual(summary['phase_results']['smoke'], 'NOT RUN')
        self.assertFalse(summary['native_acceptance'])
        self.assertNotEqual(subprocess.run(command, env={**env, 'KEEPER_SOURCE_SHA': 'f' * 40}, capture_output=True).returncode, 0)
        with (native / projection.POLICIES[0]).open('a') as target: target.write('\n# modified policy\n')
        self.assertNotEqual(subprocess.run(command, env=env, capture_output=True).returncode, 0)


if __name__ == '__main__': unittest.main()
