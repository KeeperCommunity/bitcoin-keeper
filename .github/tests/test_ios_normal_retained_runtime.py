"""Actual ZIP/tar/file controls and formal gate ordering; no native execution."""
import copy
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import plistlib
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock
import zipfile
import yaml

ROOT = Path(__file__).resolve().parents[2]
def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / '.github/native' / (name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value
m = load('ios_normal_retained_runtime')
h = load('hosted_native')


class NormalRetained(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.env = {'KEEPER_SOURCE_SHA': 'a' * 40, 'GITHUB_RUN_ID': '7', 'GITHUB_RUN_ATTEMPT': '1',
            'GITHUB_WORKFLOW_SHA': 'b' * 40, 'RUNNER_TEMP': str(self.root)}
        patch = mock.patch.dict(os.environ, self.env); patch.start(); self.addCleanup(patch.stop)
        self.state = {'source_sha': 'a' * 40, 'controller_source_sha': 'a' * 40, 'run_id': '7', 'run_attempt': '1',
            'workflow_sha': 'b' * 40, 'compiled_app_source_sha': m.SOURCE, 'app_inputs_sha256': m.APP_INPUTS,
            'native_acceptance': False, 'build_execution_scope': m.SCOPE, 'build': 'NOT RUN',
            'retained_runtime_dependencies': 'PASS', 'retained_xcode_restore': 'PASS',
            'original_signature_preserved': True, 'original_build': {'api_proof': self.proof()},
            'built_artifact': {'executable_sha256': 'c' * 64}, 'restored_bundle_identity': {'executable_sha256': 'c' * 64},
            'toolchain': {'ios_simulator_signature': {'verified': True, 'entitlements_sha256': m.SIGNED_SHA}},
            'smoke': 'NOT RUN', 'native_keychain': 'NOT RUN', 'native_probe': 'NOT RUN', 'r5_features': 'NOT RUN'}
        self.native = SimpleNamespace(ROOT=self.root, PRIVATE=self.root, EVIDENCE=self.root / 'metadata.json',
            read=lambda: copy.deepcopy(self.state), save=self.save,
            artifact_identity=lambda: {'executable_sha256': 'c' * 64}, _bundle_inventory=h._bundle_inventory,
            command=mock.Mock(), verify_installed_artifact=mock.Mock(), smoke=mock.Mock(),
            wait_for_simulator_app_services=mock.Mock())
        (self.root / 'keeper-normal-ios-origin.json').write_text(json.dumps(self.proof()))

    def save(self, data): self.state = copy.deepcopy(data); self.native.EVIDENCE.write_text(json.dumps(data))

    def proof(self):
        return {'schema': 1, 'repository_id': 839671816, 'source_sha': m.SOURCE, 'source_tree': m.TREE,
            'run_id': m.RUN, 'run_attempt': 1, 'job_id': m.JOB, 'artifact_id': m.ARTIFACT,
            'artifact_zip_sha256': m.ZIP_SHA, 'original_smoke': 'FAIL_PRESERVED', 'native_acceptance': False,
            'steps': [{'name': name, 'status': 'completed', 'conclusion': 'success',
                'started_at': '2026-10-26T16:24:00Z', 'completed_at': '2026-10-26T16:24:01Z'} for name in m.STEPS]}

    def archive(self, change_manifest=None, member=None, zip_name='simulator-app.tar.gz'):
        app = self.root / 'input/hexa_keeper_dev.app'; app.mkdir(parents=True, exist_ok=True)
        (app / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': 'io.hexawallet.hexakeeper.dev',
            'CFBundleExecutable': 'hexa_keeper_dev'}))
        (app / 'hexa_keeper_dev').write_bytes(b'SYNTHETIC_NOT_NATIVE')
        inventory, executable = h._bundle_inventory(app)
        body = io.BytesIO()
        with tarfile.open(fileobj=body, mode='w:gz') as tar:
            tar.add(app, arcname=app.name)
            if member is not None: tar.addfile(member)
        raw = body.getvalue()
        manifest = {'schema': 1, 'source_sha': m.SOURCE, 'source_tree': m.TREE, 'run_id': str(m.RUN),
            'run_attempt': '1', 'native_acceptance': False,
            'scope': 'SIMULATOR_BUILD_ONLY_NO_CONTAINERS_KEYCHAINS_USER_DATA_OR_RELEASE_SIGNING',
            'archive_sha256': hashlib.sha256(raw).hexdigest(), 'executable_sha256': inventory[executable][1],
            'bundle_inventory_sha256': hashlib.sha256(json.dumps(inventory, sort_keys=True).encode()).hexdigest(),
            'toolchain_sha256': 'd' * 64}
        if change_manifest: manifest.update(change_manifest)
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:

            for name, content in [('manifest.json', json.dumps(manifest)), (zip_name, raw)]:
                row = zipfile.ZipInfo(name); row.create_system = 3; row.external_attr = 0o100600 << 16
                z.writestr(row, content)
        path = self.root / 'input.zip'; path.write_bytes(output.getvalue()); return path, manifest

    def restore(self, path):
        return m.restore(self.native, path, hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_size)

    def test_exact_archive_restores_original_manifest_and_every_inner_byte_without_signing(self):
        path, manifest = self.archive()
        self.assertEqual(self.restore(path), manifest)
        app = self.root / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
        self.assertEqual((app / 'hexa_keeper_dev').read_bytes(), b'SYNTHETIC_NOT_NATIVE')
        self.native.command.assert_not_called()
        self.assertFalse(list(self.root.glob('normal-restore-*')))

    def test_linux_preflight_runs_real_fixture_parser_and_exports_no_signature_or_native_credit(self):
        path, manifest = self.archive(); raw = path.read_bytes()
        path.rename(self.root / 'keeper-normal-ios-app.zip')
        actual = m.restore; before = copy.deepcopy(self.state)
        with mock.patch.object(m, 'restore', side_effect=lambda native, path: actual(
                native, path, hashlib.sha256(raw).hexdigest(), len(raw))):
            result = m.preflight(self.native)
        self.assertEqual(result['archive_admission'], 'PASS')
        self.assertEqual(result['original_manifest'], manifest)
        self.assertEqual(result['observed_inventory_sha256'], manifest['bundle_inventory_sha256'])
        self.assertEqual(result['signature_validation'], 'NOT RUN_REQUIRES_MAC')
        self.assertFalse(result['native_execution']); self.assertFalse(result['native_acceptance'])
        self.assertEqual(self.state, before); self.native.command.assert_not_called()
        self.assertTrue((self.root / 'artifacts/private-ios-normal-artifact-admission/summary.json').is_file())

    def test_paid_mac_job_needs_successful_same_workflow_linux_archive_admission(self):
        workflow = yaml.load((ROOT / '.github/workflows/keeper-private-ios-normal-retained-runtime.yml').read_text(), Loader=yaml.BaseLoader)
        jobs = workflow['jobs']; admission = jobs['artifact_admission']; runtime = jobs['runtime']
        self.assertEqual(runtime['needs'], 'artifact_admission')
        self.assertEqual(admission['runs-on'], 'ubuntu-24.04'); self.assertEqual(runtime['runs-on'], 'macos-15')
        self.assertEqual(runtime['if'], admission['if']); self.assertNotIn('always()', runtime['if'])
        self.assertFalse(any('setup-node' in row.get('uses', '') or 'setup-ruby' in row.get('uses', '') for row in admission['steps']))
        scripts = [row.get('run') for row in admission['steps'] if row.get('run')]
        self.assertEqual(scripts, ['python3 .github/native/ios_normal_retained_runtime.py preflight_verify',
                                  'python3 .github/native/ios_normal_retained_runtime.py preflight'])

    def test_linux_and_mac_selection_are_separate_and_cannot_select_each_others_phase(self):
        import subprocess
        (self.root / 'App.tsx').write_text('original')
        def git(*args): return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.DEVNULL)
        git('init', '-q'); git('add', 'App.tsx')
        git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
        sha = git('rev-parse', 'HEAD').decode().strip(); rows = git('ls-tree', '-rz', 'HEAD')
        self.native.PLATFORM = 'IOS'
        event = {'repository': {'id': 839671816, 'private': True},
            'pull_request': {'number': 74, 'head': {'repo': {'id': 839671816}, 'sha': sha}},
            'action': 'labeled', 'label': {'name': m.LABEL}}
        path = self.root / 'event.json'; path.write_text(json.dumps(event))
        env = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
            'GITHUB_REPOSITORY': 'KeeperCommunity/bitcoin-keeper-private', 'GITHUB_REPOSITORY_ID': '839671816',
            'GITHUB_EVENT_NAME': 'pull_request', 'GITHUB_RUN_ATTEMPT': '1', 'KEEPER_PRIVATE_IOS_NORMAL_RETAINED': '1',
            'GITHUB_EVENT_PATH': str(path), 'KEEPER_SOURCE_SHA': sha}
        with mock.patch.dict(os.environ, env), mock.patch.object(m, 'APP_INPUTS', hashlib.sha256(rows).hexdigest()):
            self.native.platform = SimpleNamespace(system=lambda: 'Linux', machine=lambda: 'x86_64')
            m.require_selection(self.native, preflight=True)
            with self.assertRaises(RuntimeError): m.require_selection(self.native)
            self.native.platform = SimpleNamespace(system=lambda: 'Darwin', machine=lambda: 'arm64')
            m.require_selection(self.native)
            with self.assertRaises(RuntimeError): m.require_selection(self.native, preflight=True)

    def test_zip_hash_size_and_inner_source_tar_inventory_executable_binding_are_all_required(self):
        path, _ = self.archive()
        with self.assertRaises(RuntimeError): m.restore(self.native, path)
        with self.assertRaises(RuntimeError): m.restore(self.native, path, '0' * 64, path.stat().st_size)
        with self.assertRaises(RuntimeError): m.restore(self.native, path, hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_size + 1)
        for change in ({'source_sha': 'e' * 40}, {'source_tree': 'e' * 40}, {'run_id': '1'},
                {'run_attempt': '2'}, {'schema': True}, {'native_acceptance': True},
                {'archive_sha256': 'e' * 64}, {'bundle_inventory_sha256': 'e' * 64},
                {'executable_sha256': 'e' * 64}, {'toolchain_sha256': 'invalid'}):
            with self.subTest(change=change), self.assertRaises(RuntimeError): self.restore(self.archive(change)[0])

    def test_tar_paths_symlinks_hardlinks_duplicate_members_and_foreign_zip_layout_rejected(self):
        for name, kind, target in [('hexa_keeper_dev.app/escape', tarfile.SYMTYPE, '/tmp/PRIVATE_SENTINEL'),
                ('hexa_keeper_dev.app/alias', tarfile.LNKTYPE, 'hexa_keeper_dev.app/hexa_keeper_dev'),
                ('../escape', tarfile.DIRTYPE, ''), ('foreign.app', tarfile.DIRTYPE, ''),
                ('hexa_keeper_dev.app', tarfile.DIRTYPE, '')]:
            row = tarfile.TarInfo(name); row.type = kind; row.linkname = target
            with self.subTest(name=name, kind=kind), self.assertRaises(RuntimeError): self.restore(self.archive(member=row)[0])
        with self.assertRaises(RuntimeError): self.restore(self.archive(zip_name='../simulator-app.tar.gz')[0])
        self.assertFalse((self.root / 'DerivedData').exists())

    def test_origin_requires_successful_compile_checkpoint_upload_with_failed_original_smoke_preserved(self):
        self.assertEqual(m.read_proof(), self.proof())
        path = self.root / 'keeper-normal-ios-origin.json'
        for field in ('source_sha', 'source_tree', 'artifact_id', 'job_id', 'native_acceptance'):
            value = self.proof(); value[field] = None; path.write_text(json.dumps(value))
            with self.subTest(field=field), self.assertRaises(RuntimeError): m.read_proof()
        for index in range(len(m.STEPS)):
            value = self.proof(); value['steps'][index]['conclusion'] = 'failure'; path.write_text(json.dumps(value))
            with self.subTest(index=index), self.assertRaises(RuntimeError): m.read_proof()

    def test_direct_diagnostic_or_original_build_cannot_bypass_formal_order(self):
        self.state['direct_keychain_diagnostic'] = {'status': 'PASS'}
        with mock.patch.object(m, 'require_restored', side_effect=lambda n: n.read()):
            for suite in ('keychain', 'probe', 'features', 'product'):
                with self.assertRaises(RuntimeError): m.run_suite(self.native, suite)
            self.state['smoke'] = 'PASS'
            for suite in ('probe', 'features', 'product'):
                with self.assertRaises(RuntimeError): m.run_suite(self.native, suite)
            self.state['native_keychain'] = 'PASS'
            with self.assertRaises(RuntimeError): m.run_suite(self.native, 'features')
            with self.assertRaises(RuntimeError): m.run_suite(self.native, 'product')
            self.state['native_probe'] = 'PASS'
            with self.assertRaises(RuntimeError): m.run_suite(self.native, 'product')
        self.native.smoke.assert_not_called()

    def test_existing_product_runs_only_after_every_baseline_pass_and_preserves_actual_failure_details(self):
        self.state.update(smoke='PASS', native_keychain='PASS', native_probe='PASS', r5_features='PASS')
        actual = m.module
        def run(native):
            self.assertEqual(native.read()['build'], 'PASS')
            data = native.read(); data['product_ui'] = {'status': 'FAIL', 'samples': [{'status': 'FAIL'}]}; native.save(data)
            raise RuntimeError('CONTROLLED_PRODUCT_FAILURE')
        def module(name): return SimpleNamespace(run=run) if name == 'product_measurements' else actual(name)
        with mock.patch.object(m, 'require_restored', side_effect=lambda n: n.read()), mock.patch.object(m, 'module', side_effect=module), self.assertRaises(RuntimeError):
            m.run_suite(self.native, 'product')
        self.assertEqual(self.state['product_runtime'], 'FAIL')
        self.assertEqual(self.state['product_ui'], {'status': 'FAIL', 'samples': [{'status': 'FAIL'}]})
        self.assertEqual(self.state['build'], 'NOT RUN'); self.assertFalse(self.state['native_acceptance'])

    def test_phase_entry_forbids_every_app_build_and_sign_mutation(self):
        actual = m.module
        self.native.record = mock.Mock()
        def module(name):
            return SimpleNamespace(load_native=lambda: self.native) if name == 'ios_launch_debug' else actual(name)
        for args in (['xcodebuild', '-workspace', 'PRIVATE_SENTINEL'], ['codesign', '--force', '--sign', '-', 'app']):
            self.native.record.side_effect = lambda args=args: self.native.command(args, 'FORBIDDEN')
            with mock.patch.object(m, 'module', side_effect=module), mock.patch.object(m, 'require_selection'), self.assertRaises(RuntimeError):
                m.main('record')

    def test_raw_source_checks_detect_hidden_index_edits_and_untracked_platform_override(self):
        import subprocess
        (self.root / 'src').mkdir(); path = self.root / 'src/app.ts'; path.write_text('original')
        def git(*args): return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.DEVNULL)
        git('init', '-q'); git('add', 'src/app.ts')
        git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
        m.source_bytes(self.native, prepared=False)
        git('update-index', '--assume-unchanged', 'src/app.ts'); path.write_text('changed')
        with self.assertRaises(RuntimeError): m.source_bytes(self.native, prepared=False)
        path.write_text('original'); (self.root / 'App.ios.tsx').write_text('override')
        with self.assertRaises(RuntimeError): m.source_bytes(self.native, prepared=False)

    def test_ignored_platform_probe_patch_and_generated_variants_cannot_override_committed_source(self):
        import subprocess
        (self.root / 'App.tsx').write_text('original')
        def git(*args): return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.DEVNULL)
        git('init', '-q'); git('add', 'App.tsx')
        git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
        excluded = self.root / '.git/info/exclude'
        for name in ('App.ios.tsx', 'src/screens/Screen.ios.js', '.github/native/keychain_probe.ios.js',
                     'patches/ignored.patch', '.github/native/.generated/r5_workers.ios.js',
                     '.github/native/.generated/unknown.js', 'AndroidFontFix.ios.tsx'):
            excluded.write_text(name + '\n')
            path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text('override')
            self.assertEqual(git('ls-files', '--others', '--exclude-standard', '--', name), b'')
            with self.subTest(name=name), self.assertRaises(RuntimeError): m.source_bytes(self.native, prepared=False)
            path.unlink()

    def test_only_known_generated_outputs_and_pycache_are_allowed_with_ignored_native_build_products(self):
        import subprocess
        (self.root / 'App.tsx').write_text('original')
        def git(*args): return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.DEVNULL)
        git('init', '-q'); git('add', 'App.tsx')
        git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
        names = ['.github/native/.generated/r5_workers.js', '.github/native/.generated/r52_trust_ui.json',
                 '.github/native/__pycache__/owned.cpython-312.pyc', 'ios/Pods/ignored.m',
                 'ios/build/output', 'android/app/build/output']
        (self.root / '.git/info/exclude').write_text('\n'.join(names) + '\n')
        for name in names:
            path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text('generated')
        m.source_bytes(self.native, prepared=False)
        path = self.root / names[0]; path.unlink(); path.symlink_to(self.root / 'App.tsx')
        with self.assertRaises((OSError, ValueError, RuntimeError)): m.source_bytes(self.native, prepared=False)

    def test_failed_real_suite_preserves_failed_status_original_bytes_and_current_build_not_run(self):
        self.state['smoke'] = 'PASS'; original = copy.deepcopy(self.state['built_artifact'])
        self.native.smoke.side_effect = RuntimeError('SYNTHETIC_FAILURE')
        with mock.patch.object(m, 'require_restored', side_effect=lambda n: n.read()), self.assertRaises(RuntimeError):
            m.run_suite(self.native, 'keychain')
        self.assertEqual(self.state['native_keychain'], 'FAIL')
        self.assertEqual(self.state['build'], 'NOT RUN'); self.assertEqual(self.state['current_source_compilation'], 'NOT RUN')
        self.assertEqual(self.state['built_artifact'], original); self.assertFalse(self.state['native_acceptance'])
        self.assertEqual(self.state['compiled_app_source_sha'], m.SOURCE)

    def test_restore_rejects_changed_origin_bytes_or_signature_before_formal_runtime(self):
        original = copy.deepcopy(self.state)
        for change in ({'retained_xcode_restore': 'INCOMPLETE'}, {'original_signature_preserved': False},
                {'restored_bundle_identity': {'changed': True}}, {'compiled_app_source_sha': '0' * 40}):
            self.state = {**original, **change}
            with mock.patch.object(m, 'source_bytes'), mock.patch.object(m, 'verify_signature', return_value=original['toolchain']['ios_simulator_signature']), self.assertRaises(RuntimeError):
                m.run_suite(self.native, 'startup')
        self.native.smoke.assert_not_called()

    def test_warmup_uses_actual_recorded_app_options_only_for_ios_startup_and_keeps_budgets(self):
        state = {}; output = self.root / 'ios-development-warmup.bundle'; output.write_bytes(b'COMPLETE_SYNTHETIC_BODY')
        args_seen = []
        def command(args, label, **kw):
            args_seen.append((args, kw)); return '200'
        with mock.patch.multiple(h, PLATFORM='IOS', PRIVATE=self.root, read=lambda: copy.deepcopy(state),
                save=lambda d: state.update(d), command=command):
            h.warm_metro_bundle('startup')
            self.assertIn('&lazy=true&excludeSource=true&modulesOnly=false&runModule=true&sourcePaths=url-server&app=io.hexawallet.hexakeeper.dev', args_seen[-1][0][-1])
            self.assertEqual(args_seen[-1][1]['timeout'], 250)
            self.assertEqual(state['metro_warmup']['timeout_seconds'], 240)
            h.warm_metro_bundle('keychain')
            self.assertEqual(args_seen[-1][0][-1], 'http://127.0.0.1:8081/index.bundle?platform=ios&dev=true&minify=false')

    def test_private_standard_startup_invokes_one_actual_120s_install_after_boot_and_propagates_failure(self):
        device = '12345678-1234-1234-1234-123456789ABC'
        self.state.update(build='PASS', commands=[])
        metro = mock.Mock(); metro.poll.side_effect = [None, 0]
        reply = mock.MagicMock(); reply.__enter__.return_value.read.return_value = b'packager-status:running'
        calls = []
        def command(args, label, **kw):
            calls.append((args, label, kw))
            if args[:3] == ['xcrun', 'simctl', 'create']: return device
            if args[:3] == ['xcrun', 'simctl', 'install']:
                self.assertEqual(kw['timeout'], 120)
                raise RuntimeError('CONTROLLED_ACTUAL_INSTALL_FAILURE')
            return ''
        with mock.patch.multiple(h, PLATFORM='IOS', PRIVATE=self.root, ROOT=self.root,
                read=self.native.read, save=self.save, artifact_identity=self.native.artifact_identity,
                command=command, warm_metro_bundle=mock.Mock(), wait_for_simulator_app_services=mock.Mock(),
                record_startup_failure=mock.Mock()), mock.patch.object(h.subprocess, 'Popen', return_value=metro), \
                mock.patch.object(h.subprocess, 'run', return_value=SimpleNamespace(returncode=0)), \
                mock.patch.object(h.urllib.request, 'urlopen', return_value=reply), self.assertRaisesRegex(RuntimeError, 'CONTROLLED_ACTUAL_INSTALL_FAILURE'):
            h.smoke(debug_session=mock.Mock(), normal_retained_install=True)
        self.assertEqual([row[0][:3] for row in calls], [['xcrun', 'simctl', 'create'], ['xcrun', 'simctl', 'boot'],
            ['xcrun', 'simctl', 'bootstatus'], ['xcrun', 'simctl', 'install']])
        self.assertEqual(self.state['smoke'], 'FAIL')
        self.assertEqual(self.state['native_keychain'], 'NOT RUN')

    def test_private_direct_install_option_is_unavailable_to_default_or_unqualified_routes(self):
        with mock.patch.object(h, 'PLATFORM', 'IOS'), mock.patch.object(h, 'read', return_value={}):
            with self.assertRaisesRegex(RuntimeError, 'EXACT_NORMAL_RETAINED_INSTALL_PATH_REQUIRED'):
                h.smoke(debug_session=mock.Mock(), normal_retained_install=True)
        with mock.patch.object(h, 'PLATFORM', 'IOS'), mock.patch.object(h, 'read', side_effect=lambda: self.state):
            with self.assertRaisesRegex(RuntimeError, 'EXACT_NORMAL_RETAINED_INSTALL_PATH_REQUIRED'):
                h.smoke(normal_retained_install=True)

    def test_terminal_summary_preserves_new_and_legacy_readiness_records(self):
        self.state.update(normal_retained_install_readiness=[{'result': 'PENDING_ACTUAL_INSTALL'}],
            simulator_app_service_readiness=[{'result': 'FAIL', 'attempts': [{'state': 'TIMEOUT', 'duration_seconds': 5.1}]}])
        self.save(self.state)
        output = io.StringIO()
        with redirect_stdout(output): m.retain(self.native)
        summary = json.loads(output.getvalue().split('KEEPER_NORMAL_RETAINED_SUMMARY=')[1])
        self.assertEqual(summary['normal_retained_install_readiness'], self.state['normal_retained_install_readiness'])
        self.assertEqual(summary['simulator_app_service_readiness'], self.state['simulator_app_service_readiness'])


if __name__ == '__main__': unittest.main()
