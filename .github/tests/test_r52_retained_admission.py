"""Host contracts only; no retained binary, RN bridge or native result is run."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parents[2]
SPEC = importlib.util.spec_from_file_location('r52_retained_test', ROOT / '.github/native/r52_retained_admission.py')
adapter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(adapter)


def write(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw if isinstance(raw, bytes) else json.dumps(raw).encode())


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL).decode().strip()


def manifest_bytes():
    # Synthetic controller fixtures bind the code under test. The production
    # retained873 manifest stays frozen; canonical source must not rewrite it.
    value = adapter.parse((ROOT / adapter.MANIFEST).read_bytes())
    for row in value['files']:
        row['sha256'] = adapter.digest((ROOT / row['path']).read_bytes())
    return (json.dumps(value, indent=2) + '\n').encode()


def environment(root, temporary):
    env = dict(GITHUB_ACTIONS='true', RUNNER_ENVIRONMENT='github-hosted',
        GITHUB_REPOSITORY='KeeperCommunity/bitcoin-keeper-private', GITHUB_REPOSITORY_ID='839671816',
        GITHUB_EVENT_NAME='pull_request', GITHUB_RUN_ATTEMPT='1', KEEPER_DIAGNOSTIC='true',
        KEEPER_NATIVE_PLATFORM='ANDROID', KEEPER_CONTROLLER_SHA='a' * 40,
        GITHUB_WORKSPACE=str(root), RUNNER_TEMP=str(temporary), GITHUB_RUN_ID='999', GITHUB_SHA='b' * 40)
    output = temporary / 'github-env'; output.touch()
    env['GITHUB_ENV'] = str(output)
    return env


def installed_fixture(root):
    outputs = []
    for pkg, version, names in [('electrum-client', '2.0.0', ['lib/TlsSocketWrapper.js']),
                                ('react-native-tcp-socket', '6.4.1', ['src/policy' + str(i) + '.js' for i in range(5)])]:
        write(root / 'node_modules' / pkg / 'package.json', dict(name=pkg, version=version))
        patch_lines = []
        for path in names:
            relative = 'node_modules/' + pkg + '/' + path
            raw = relative.encode(); write(root / relative, raw)
            outputs.append(dict(path=relative, sha256=adapter.digest(raw)))
            patch_lines.append('+++ b/' + relative)
        write(root / 'patches' / (pkg + '+' + version + '.patch'), ('\n'.join(patch_lines) + '\n').encode())
    write(root / 'node_modules/realm/package.json', dict(name='realm', version='12.15.0'))
    runtime = []
    for relative, raw in {
        'node_modules/electrum-client/index.js': b"module.exports = require('./lib/client');",
        'node_modules/realm/index.react-native.js': b"module.exports = require('./dist/platform/react-native/index.js');",
        'node_modules/realm/dist/platform/react-native/index.js': b"module.exports = require('../../Realm');",
        'node_modules/realm/dist/Realm.js': b'exports.Realm = { open: function realNativeOpen() {} };',
    }.items():
        write(root / relative, raw); runtime.append(dict(path=relative, sha256=adapter.digest(raw)))
    return dict(package_versions={'electrum-client': '2.0.0', 'react-native-tcp-socket': '6.4.1', 'realm': '12.15.0'},
                patch_outputs=outputs, runtime_files=runtime)


class RetainedAdmission(unittest.TestCase):
    def test_manifest_refuses_other_app_duplicate_paths_and_unknown_output_fields(self):
        original = adapter.parse((ROOT / adapter.MANIFEST).read_bytes())
        adapter.read_manifest(json.dumps(original).encode())
        for change in [lambda v: v.update(compiled_source='a' * 40),
                       lambda v: v.update(app_inputs_sha256='0' * 64),
                       lambda v: v['files'].append(v['files'][0]),
                       lambda v: v['files'][0].update(path='../escape.py'),
                       lambda v: v['patch_outputs'][0].update(unknown=True)]:
            value = copy.deepcopy(original); change(value)
            with self.assertRaises(RuntimeError):
                adapter.read_manifest(json.dumps(value).encode())
        with self.assertRaises(RuntimeError):
            adapter.parse(b'{"same":1,"same":2}')

    def test_public_local_and_unselected_ios_context_never_stage(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); env = environment(root, root)
            for changed in [dict(GITHUB_ACTIONS='false'), dict(GITHUB_REPOSITORY='KeeperCommunity/bitcoin-keeper'),
                            dict(KEEPER_NATIVE_PLATFORM='IOS'), dict(KEEPER_CONTROLLER_SHA='moving-branch')]:
                with self.assertRaises(RuntimeError):
                    adapter.stage({**env, **changed})
                self.assertFalse((root / 'keeper-r52-retained-controller').exists())

    def test_stage_binds_committed_bytes_seals_identity_and_never_changes_source_selection(self):
        with tempfile.TemporaryDirectory() as name:
            temporary = Path(name); root = temporary / 'controller'; root.mkdir()
            manifest = adapter.parse(manifest_bytes())
            for row in manifest['files']:
                write(root / row['path'], (ROOT / row['path']).read_bytes())
            write(root / adapter.MANIFEST, manifest_bytes())
            git(root, 'init', '-q'); git(root, 'add', '.')
            git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
            env = environment(root, temporary)
            env.update(KEEPER_CONTROLLER_SHA=git(root, 'rev-parse', 'HEAD'), KEEPER_SOURCE_SHA=adapter.SOURCE)
            adapter.stage(env)
            emitted = Path(env['GITHUB_ENV']).read_text()
            self.assertNotIn('KEEPER_SOURCE_SHA=', emitted)
            env.update(dict(line.split('=', 1) for line in emitted.splitlines()))
            adapter.staged(env)
            state = temporary / 'keeper-r52-retained-controller'
            identity = state / 'identity.json'; before = identity.read_bytes()
            value = adapter.parse(before); value['controller_tree'] = 'c' * 40; write(identity, value)
            with self.assertRaises(RuntimeError):
                adapter.staged(env)
            identity.write_bytes(before)
            staged = state / 'files/r52_rpc_probe.js'; before = staged.read_bytes(); staged.write_bytes(b'changed')
            with self.assertRaises(RuntimeError):
                adapter.staged(env)
            staged.write_bytes(before)
            replacement = state / 'files/r52_rpc_probe.js'; replacement.unlink(); replacement.symlink_to(ROOT / '.github/native/r52_rpc_probe.js')
            with self.assertRaises(RuntimeError):
                adapter.staged(env)

    def test_changed_committed_stage_file_rejects_before_any_installation(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); manifest = adapter.parse(manifest_bytes())
            for row in manifest['files']:
                write(root / row['path'], (ROOT / row['path']).read_bytes())
            write(root / adapter.MANIFEST, manifest_bytes())
            git(root, 'init', '-q'); git(root, 'add', '.')
            git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
            env = environment(root, root); env['KEEPER_CONTROLLER_SHA'] = git(root, 'rev-parse', 'HEAD')
            (root / '.github/native/r52_rpc_probe.js').write_bytes(b'changed but index-hidden')
            git(root, 'update-index', '--assume-unchanged', '.github/native/r52_rpc_probe.js')
            with self.assertRaises(RuntimeError):
                adapter.stage(env)
            self.assertFalse((root / 'keeper-r52-retained-controller').exists())

    def test_installed_patch_outputs_version_and_runtime_override_are_independently_required(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); value = installed_fixture(root); outputs = value['patch_outputs']
            adapter.installed_dependencies(root, value)
            first = root / outputs[0]['path']; before = first.read_bytes(); first.write_bytes(b'wrong native policy')
            with self.assertRaisesRegex(RuntimeError, 'PATCH_OUTPUT_CHANGED'):
                adapter.installed_dependencies(root, value)
            first.write_bytes(before)
            extra = root / 'node_modules/electrum-client/lib/TlsSocketWrapper.android.js'; extra.write_bytes(b'override')
            with self.assertRaisesRegex(RuntimeError, 'DEPENDENCY_SOURCE_OVERRIDE'):
                adapter.installed_dependencies(root, value)
            extra.unlink()
            write(root / 'node_modules/electrum-client/package.json', dict(name='electrum-client', version='2.1.0'))
            with self.assertRaises(RuntimeError):
                adapter.installed_dependencies(root, value)

    def test_realm_dist_implementation_and_platform_shadow_overrides_are_rejected(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); value = installed_fixture(root)
            adapter.installed_dependencies(root, value)
            target = root / 'node_modules/realm/dist/platform/react-native/index.js'
            before = target.read_bytes(); target.write_bytes(b'module.exports = { open: () => ({}) };')
            with self.assertRaisesRegex(RuntimeError, 'PATCH_OUTPUT_CHANGED'):
                adapter.installed_dependencies(root, value)
            target.write_bytes(before)
            for relative in ['node_modules/realm/dist/Realm.ios.js',
                             'node_modules/realm/dist/platform/binding.native.ts',
                             'node_modules/realm/index.react-native.android.js',
                             'node_modules/electrum-client/index.native.js']:
                extra = root / relative; write(extra, b'platform shadow')
                with self.assertRaisesRegex(RuntimeError, 'DEPENDENCY_SOURCE_OVERRIDE'):
                    adapter.installed_dependencies(root, value)
                extra.unlink()
            directory = root / 'node_modules/realm/dist/platform/alias'; directory.symlink_to(target.parent, target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, 'DEPENDENCY_SOURCE_OVERRIDE'):
                adapter.installed_dependencies(root, value)

    def test_raw_all_source_and_literal_harness_check_survive_git_index_flags(self):
        # Require the genuine frozen tree; missing history is a test failure.
        # The parentless SYNTHETIC fixture commit is not the production ff commit.
        self.assertEqual(git(ROOT, 'cat-file', '-t', adapter.TREE), 'tree')
        with tempfile.TemporaryDirectory() as name:
            temporary = Path(name); root = temporary / 'app'; root.mkdir(); git(root, 'init', '-q')
            with self.assertRaises(subprocess.CalledProcessError):
                git(root, 'cat-file', '-e', adapter.TREE)
            objects = git(ROOT, 'rev-parse', '--path-format=absolute', '--git-path', 'objects')
            write(root / '.git/objects/info/alternates', (objects + '\n').encode())
            with patch.dict(os.environ, GIT_AUTHOR_DATE='2000-01-01T00:00:00Z',
                            GIT_COMMITTER_DATE='2000-01-01T00:00:00Z'):
                synthetic_fixture_commit = git(root, '-c', 'user.name=Synthetic host test fixture',
                    '-c', 'user.email=synthetic-fixture@example.invalid', 'commit-tree', adapter.TREE,
                    '-m', 'SYNTHETIC TEST FIXTURE ONLY: genuine frozen tree; not production ff source')
            self.assertNotEqual(synthetic_fixture_commit, adapter.SOURCE)
            self.assertEqual(git(root, 'rev-parse', synthetic_fixture_commit + '^{tree}'), adapter.TREE)
            self.assertEqual(git(root, 'rev-list', '--parents', '-n', '1', synthetic_fixture_commit),
                             synthetic_fixture_commit)
            git(root, 'update-ref', 'refs/heads/synthetic-fixture', synthetic_fixture_commit)
            git(root, 'symbolic-ref', 'HEAD', 'refs/heads/synthetic-fixture')
            git(root, 'read-tree', 'HEAD'); git(root, 'checkout-index', '-a')
            raw_package = (root / 'package.json').read_bytes()
            configuration = []
            for item in ['.env.ci', 'firebase.json', 'android/app/google-services.json']:
                write(root / item, b'{}'); configuration.append(dict(path=item, sha256=adapter.digest(b'{}')))
            data = dict(configuration_overlays=configuration, nodeify_overlay=dict(path='package.json',
                before_sha256=adapter.digest(raw_package), after_sha256=adapter.digest(raw_package),
                allowed_fields=['browser', 'react-native', 'browserify']))
            manifest = adapter.parse(manifest_bytes())
            staged = temporary / 'keeper-r52-retained-controller/files'; staged.mkdir(parents=True)
            write(staged / 'r52_source_boundary.py', (ROOT / '.github/native/r52_source_boundary.py').read_bytes())
            with patch.object(adapter, 'SOURCE', synthetic_fixture_commit), \
                 patch.dict(os.environ, RUNNER_TEMP=str(temporary)):
                adapter.raw_sources(root, data, manifest, overlays=False)
                with patch.object(adapter, 'TREE', '0' * 40), self.assertRaises(RuntimeError):
                    adapter.raw_sources(root, data, manifest, overlays=False)
                target = root / 'src/services/electrum/tls.js'; before = target.read_bytes()
                git(root, 'update-index', '--assume-unchanged', 'src/services/electrum/tls.js'); target.write_bytes(b'modified')
                self.assertEqual(git(root, 'diff', '--', 'src/services/electrum/tls.js'), '')
                with self.assertRaisesRegex(RuntimeError, 'RAW_SOURCE_CHANGED'):
                    adapter.raw_sources(root, data, manifest, overlays=False)
                target.write_bytes(before)
                extra = root / 'src/services/electrum/tls.android.js'; extra.write_bytes(b'override')
                write(root / '.git/info/exclude', b'src/services/electrum/tls.android.js\n')
                with self.assertRaisesRegex(RuntimeError, 'UNTRACKED_SOURCE_OVERRIDE'):
                    adapter.raw_sources(root, data, manifest, overlays=False)
                extra.unlink()
                for row in manifest['files']:
                    write(root / row['path'], (ROOT / row['path']).read_bytes())
                write(root / adapter.MANIFEST, manifest_bytes())
                adapter.raw_sources(root, data, manifest, overlays=True)
                write(root / '.github/native/r52_rpc_probe.js', b'changed harness')
                with self.assertRaises(RuntimeError):
                    adapter.raw_sources(root, data, manifest, overlays=True)

    def test_protected_metadata_snapshot_copies_source_artifact_and_baseline_proof(self):
        data = dict(source_sha=adapter.SOURCE, smoke='PASS', build='PASS', built_artifact={'sha256': 'f' * 64},
                    r52_tls_native={'status': 'PASS'})
        original = copy.deepcopy(data); snapshot = adapter.protected(data)
        self.assertEqual(data, original)
        data['built_artifact']['sha256'] = '0' * 64
        self.assertNotEqual(snapshot, adapter.protected(data))
        self.assertNotIn('r52_tls_native', snapshot)

    def test_missing_historical_objects_record_not_run_without_relabeling_baseline(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            write(root / 'tests/recovery/fixtures/realm109-node-source.json', dict(files=[dict(path='old.ts')]))
            data = dict(source_sha=adapter.SOURCE, smoke='PASS', build='PASS', built_artifact={'sha256': 'a' * 64})
            before = adapter.protected(data)
            class Harness:
                ROOT = root
                def read(self): return copy.deepcopy(data)
                def save(self, value): data.update(value)
            class Binding:
                def result_binding(self): return dict(compiled_app_source_sha=adapter.SOURCE)
            with patch.object(adapter, 'git', side_effect=subprocess.CalledProcessError(1, ['git'])):
                with self.assertRaisesRegex(RuntimeError, 'HISTORICAL_109_OBJECTS_NOT_PROVISIONED'):
                    adapter.require_history(Harness(), Binding())
            self.assertEqual(before, adapter.protected(data))
            self.assertEqual(data['r52_realm109_native']['status'], 'NOT RUN')

    def test_existing_checkpoint_admission_artifact_and_real_baseline_are_all_bound(self):
        with tempfile.TemporaryDirectory() as name:
            temporary = Path(name); root = temporary / 'app'; root.mkdir()
            control = temporary / 'keeper-android-reuse-controller'; control.mkdir()
            state = temporary / 'keeper-android-reuse-state'; state.mkdir()
            manifest = adapter.parse(manifest_bytes()); selected = manifest['producer']
            helper_path = control / 'android_runtime_checkpoint.py'
            write(helper_path, (ROOT / '.github/native/android_runtime_checkpoint.py').read_bytes())
            helper = adapter.load_module(helper_path, 'r52_existing_checkpoint_fixture')
            env = environment(root, temporary)
            env.update(GITHUB_WORKFLOW_SHA=selected['workflow_sha'], GITHUB_WORKFLOW_REF=selected['workflow_ref'])
            apk = b'host contract fixture only; never an APK execution'
            write(root / helper.APK, apk)
            original = dict(schema=1, platform='ANDROID', diagnostic_only=True, source_sha=adapter.SOURCE,
                run_id=str(selected['run_id']), run_attempt='1', workflow_sha=selected['workflow_sha'],
                workflow_ref=selected['workflow_ref'], build='PASS', smoke='NOT RUN', native_probe='NOT RUN',
                r5_features='NOT RUN', hardware='NOT RUN', signing='NOT RUN',
                configuration_overlays=[], nodeify_overlay={}, built_artifact=dict(path=helper.APK, sha256=adapter.digest(apk)))
            old_raw = json.dumps(original).encode(); write(state / 'build-metadata.json', old_raw)
            origin = {key: selected[key] for key in helper.ORIGIN_KEYS if key in selected}
            origin.update(repository_private=True, job_name=helper.JOB_NAME)
            declared = dict(**origin, schema=1, scope='PRIVATE_ANDROID_DEBUG_BUILD_CHECKPOINT_NOT_NATIVE_ACCEPTANCE_OR_RELEASE',
                native_acceptance=False, release_artifact=False, measured_free_bytes_before_emulator=123,
                files={'app-development-debug.apk':dict(source_path=helper.APK, sha256=adapter.digest(apk), size_bytes=len(apk)),
                       'build-metadata.json':dict(source_path=helper.METADATA, sha256=adapter.digest(old_raw), size_bytes=len(old_raw))})
            declared_raw = json.dumps(declared).encode(); write(state / 'manifest.json', declared_raw)
            admitted = dict(schema=1, identity=dict(selection=selected, current_controller_sha=env['KEEPER_CONTROLLER_SHA'],
                current_controller_merge=env['GITHUB_SHA']), manifest_sha256=adapter.digest(declared_raw), native_acceptance=False)
            admitted_raw = json.dumps(admitted).encode(); write(state / 'admitted.json', admitted_raw)
            env['KEEPER_ADMISSION_SHA256'] = adapter.digest(admitted_raw)
            current = copy.deepcopy(original); current.update(run_id=env['GITHUB_RUN_ID'], smoke='PASS',
                build_checkpoint=dict(origin=origin, archive_sha256=selected['archive_sha256'],
                                      artifact_id=selected['artifact_id'], native_acceptance=False))
            class Harness:
                ROOT = root
                PLATFORM = 'ANDROID'
                def read(self): return copy.deepcopy(current)
                def artifact_identity(self): return dict(path=helper.APK, sha256=adapter.digest((root / helper.APK).read_bytes()))
            before = copy.deepcopy(current)
            with patch.object(helper, 'guarded', return_value=(root, control, state, selected)), \
                 patch.object(adapter, 'load_module', return_value=helper):
                adapter.original_proof(Harness(), manifest, env)
                self.assertEqual(current, before)
                for key, value in [('source_sha', 'c' * 40), ('smoke', 'FAIL'), ('build', 'NOT RUN')]:
                    saved = current[key]; current[key] = value
                    with self.assertRaises(RuntimeError):
                        adapter.original_proof(Harness(), manifest, env)
                    current[key] = saved
                write(root / helper.APK, b'different original artifact')
                with self.assertRaises(RuntimeError):
                    adapter.original_proof(Harness(), manifest, env)
                write(root / helper.APK, apk)
                write(state / 'build-metadata.json', old_raw + b' ')
                with self.assertRaises(RuntimeError):
                    adapter.original_proof(Harness(), manifest, env)

    def test_install_and_admission_preserve_original_metadata_and_seal_baseline_snapshot(self):
        with tempfile.TemporaryDirectory() as name:
            temporary = Path(name); root = temporary / 'app'; root.mkdir()
            state = temporary / 'keeper-r52-retained-controller'; (state / 'files').mkdir(parents=True)
            manifest_raw = manifest_bytes(); manifest = adapter.parse(manifest_raw)
            for row in manifest['files']:
                write(state / 'files' / Path(row['path']).name, (ROOT / row['path']).read_bytes())
            write(state / 'manifest.json', manifest_raw)
            (root / '.github/native').mkdir(parents=True)
            current = dict(source_sha=adapter.SOURCE, run_id='999', run_attempt='1', build='PASS', smoke='PASS',
                           built_artifact={'sha256': 'f' * 64})
            evidence = temporary / 'metadata.json'; write(evidence, current); original_raw = evidence.read_bytes()
            env = environment(root, temporary); env['KEEPER_ADMISSION_SHA256'] = 'e' * 64
            identity = dict(controller_sha=env['KEEPER_CONTROLLER_SHA'], manifest_sha256=adapter.digest(manifest_raw))
            class Harness:
                ROOT = root
                EVIDENCE = evidence
                PLATFORM = 'ANDROID'
                def read(self): return copy.deepcopy(current)
            with patch.object(adapter, 'staged', return_value=(root, state, manifest, identity)), \
                 patch.object(adapter, 'original_proof', side_effect=lambda *args: (copy.deepcopy(current),
                              {'identity': {'selection': manifest['producer']}}, 'd' * 64)), \
                 patch.object(adapter, 'raw_sources'), patch.object(adapter, 'installed_dependencies'):
                adapter.install(Harness(), env)
                self.assertEqual(evidence.read_bytes(), original_raw)
                env.update(dict(line.split('=', 1) for line in Path(env['GITHUB_ENV']).read_text().splitlines()))
                binding = adapter.Admission(Harness(), env)
                self.assertEqual(binding.result_binding()['compiled_app_source_sha'], adapter.SOURCE)
                self.assertFalse(binding.result_binding()['release_acceptance'])
                current['source_sha'] = 'd' * 40
                with self.assertRaises(RuntimeError):
                    binding.verify_source()
                current['source_sha'] = adapter.SOURCE
                write(state / 'baseline-metadata.json', original_raw + b' ')
                with self.assertRaises(RuntimeError):
                    adapter.Admission(Harness(), env)

    def test_suite_keeps_install_and_both_probes_inside_one_existing_emulator_process(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); env = environment(root, root)
            env['KEEPER_SOURCE_SHA'] = adapter.SOURCE
            harness = SimpleNamespace(__name__='r52_suite_fixture', PLATFORM='ANDROID'); events = []
            def install(_harness, runtime_env):
                self.assertIs(_harness, harness)
                events.append('install'); runtime_env['KEEPER_R52_INSTALL_SHA256'] = 'e' * 64
            def module(path, _name):
                if path.name == 'hosted_native.py': return harness
                def probe(actual):
                    self.assertIs(actual, harness)
                    self.assertEqual(os.environ['KEEPER_R52_INSTALL_SHA256'], 'e' * 64)
                    self.assertEqual(os.environ['KEEPER_SOURCE_SHA'], adapter.SOURCE)
                    events.append(path.name)
                return SimpleNamespace(run_retained=probe)
            with patch.dict(os.environ, env), patch.object(adapter.sys, 'argv', ['adapter', 'suite']), \
                 patch.object(adapter, 'staged', return_value=(root, root, {}, {})), \
                 patch.object(adapter, 'regular', return_value=b'exact helper'), \
                 patch.object(adapter, 'git', return_value=b'exact helper'), \
                 patch.object(adapter, 'load_module', side_effect=module), \
                 patch.object(adapter, 'install', side_effect=install), patch.object(adapter, 'Admission'):
                adapter.main()
            self.assertEqual(events, ['install', 'r52_tls_native.py', 'r52_realm109_native.py'])

    def test_ios_retained_guard_preserves_not_run_compilation_and_binds_original_proof(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); env = environment(root, root)
            env.update(KEEPER_NATIVE_PLATFORM='IOS', KEEPER_SOURCE_SHA=env['KEEPER_CONTROLLER_SHA'],
                       KEEPER_PRIVATE_IOS_NORMAL_RETAINED='1')
            artifact = dict(executable_sha256='e' * 64, bundle_tree_sha256='f' * 64)
            proof = dict(source_sha=adapter.SOURCE, source_tree=adapter.TREE, run_id=40351735911,
                artifact_id=12667427189,
                artifact_zip_sha256='89806c9d8d71dc032d2ce3ca8b444768705d1ca3ab565aa9ec0652f0277b76f5')
            signature = dict(entitlements_sha256='9' * 64)
            data = dict(source_sha=env['KEEPER_CONTROLLER_SHA'], compiled_app_source_sha=adapter.SOURCE,
                build='NOT RUN', current_source_compilation='NOT RUN', smoke='PASS',
                retained_xcode_restore='PASS', original_signature_preserved=True,
                original_build=dict(build='PASS', api_proof=proof, original_smoke='FAIL_PRESERVED',
                    original_manifest=dict(source_sha=adapter.SOURCE, source_tree=adapter.TREE, run_id='40351735911')),
                restored_bundle_identity=artifact, built_artifact=artifact,
                toolchain=dict(ios_simulator_signature=signature))
            normal = SimpleNamespace(require_state=lambda h: copy.deepcopy(data), read_proof=lambda: proof,
                                     verify_signature=lambda h: signature)
            class Harness:
                ROOT = root
                PLATFORM = 'IOS'
                def read(self): return copy.deepcopy(data)
                def artifact_identity(self): return copy.deepcopy(artifact)
            before = copy.deepcopy(data)
            with patch.object(adapter, 'raw_sources'), patch.object(adapter, 'ios_guard', return_value=normal):
                adapter.ios_original_proof(Harness(), {}, env)
                self.assertEqual(data, before)
                for key, value in [('build', 'PASS'), ('current_source_compilation', 'PASS'),
                                   ('source_sha', adapter.SOURCE), ('smoke', 'FAIL'),
                                   ('original_signature_preserved', False)]:
                    saved = data[key]; data[key] = value
                    with self.assertRaises(RuntimeError):
                        adapter.ios_original_proof(Harness(), {}, env)
                    data[key] = saved
                normal.verify_signature = lambda h: {'changed': True}
                with self.assertRaises(RuntimeError):
                    adapter.ios_original_proof(Harness(), {}, env)

    def test_default_ios_tls_and_realm_drivers_still_reject_not_run_build(self):
        data = dict(build='NOT RUN', smoke='PASS')
        class Harness:
            PLATFORM = 'IOS'
            def read(self): return copy.deepcopy(data)
        env = dict(GITHUB_ACTIONS='true', GITHUB_REPOSITORY='KeeperCommunity/bitcoin-keeper-private',
                   RUNNER_ENVIRONMENT='github-hosted', KEEPER_PRIVATE_IOS_NORMAL_RETAINED='1')
        with patch.dict(os.environ, env):
            for name in ['r52_tls_native.py', 'r52_realm109_native.py']:
                driver = adapter.load_module(ROOT / '.github/native' / name, 'r52_default_strict_' + name)
                with self.assertRaisesRegex(RuntimeError, 'PRIVATE_HOSTED_EXACT_APP_STARTUP_REQUIRED'):
                    driver.run(Harness())

    def test_ios_install_checks_restored_app_and_leaves_controller_source_bytes_unchanged(self):
        with tempfile.TemporaryDirectory() as name:
            temporary = Path(name); root = temporary / 'controller'; root.mkdir()
            state = temporary / 'keeper-r52-retained-controller'; (state / 'files').mkdir(parents=True)
            manifest_raw = manifest_bytes(); manifest = adapter.parse(manifest_raw)
            for row in manifest['files']:
                raw = (ROOT / row['path']).read_bytes()
                write(root / row['path'], raw); write(state / 'files' / Path(row['path']).name, raw)
            write(root / adapter.MANIFEST, manifest_raw); write(state / 'manifest.json', manifest_raw)
            before = {file.relative_to(root).as_posix(): file.read_bytes() for file in root.rglob('*') if file.is_file()}
            current = dict(source_sha='a' * 40, compiled_app_source_sha=adapter.SOURCE, build='NOT RUN',
                           current_source_compilation='NOT RUN', smoke='PASS', built_artifact={'sha256': 'f' * 64})
            evidence = temporary / 'normal-retained-runtime-metadata.json'; write(evidence, current)
            write(temporary / 'keeper-normal-ios-origin.json', b'{}')
            env = environment(root, temporary); env.update(KEEPER_NATIVE_PLATFORM='IOS', KEEPER_PRIVATE_IOS_NORMAL_RETAINED='1')
            identity = dict(controller_sha=env['KEEPER_CONTROLLER_SHA'], manifest_sha256=adapter.digest(manifest_raw))
            class Harness:
                ROOT = root
                EVIDENCE = evidence
                PLATFORM = 'IOS'
                def read(self): return copy.deepcopy(current)
            normal = SimpleNamespace(require_restored=lambda h: copy.deepcopy(current))
            with patch.object(adapter, 'staged', return_value=(root, state, manifest, identity)), \
                 patch.object(adapter, 'original_proof', return_value=(copy.deepcopy(current),
                     {'identity': {'selection': {'source_sha': adapter.SOURCE}}}, 'd' * 64)), \
                 patch.object(adapter, 'raw_sources'), patch.object(adapter, 'installed_dependencies'), \
                 patch.object(adapter, 'ios_guard', return_value=normal), \
                 patch.object(adapter, 'git', side_effect=lambda directory, *args: (root / args[-1].split(':', 1)[1]).read_bytes()):
                adapter.install(Harness(), env)
            after = {file.relative_to(root).as_posix(): file.read_bytes() for file in root.rglob('*') if file.is_file()}
            self.assertEqual(before, after)
            self.assertEqual(adapter.parse(evidence.read_bytes()), current)


if __name__ == '__main__':
    unittest.main()
