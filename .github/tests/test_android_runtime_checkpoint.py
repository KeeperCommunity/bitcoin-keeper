"""Real Git and ZIP regression checks; subprocess downloads use synthetic bytes only."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import time
import unittest
from unittest import mock
import zipfile

NATIVE = Path(__file__).resolve().parents[1] / 'native'
SPEC = importlib.util.spec_from_file_location('android_runtime_checkpoint_test', NATIVE / 'android_runtime_checkpoint.py')
runtime = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runtime)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True) + '\n').encode()


class RuntimeCheckpointTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.root = self.base / 'app'
        self.root.mkdir()
        self.runner = self.base / 'runner'
        self.runner.mkdir()
        self.state = self.runner / 'keeper-android-reuse-state'
        self.control = self.runner / 'keeper-android-reuse-controller'
        self.original_package = encoded({'name': 'synthetic-runtime-test', 'dependencies': {'test': '1'}})
        self.put('package.json', self.original_package)
        self.put('src/app.ts', b'export const source = 1;\n')
        self.put('firebase.json', b'{}\n')
        self.put('android/app/google-services.json', b'{}\n')
        for name in ('android_runtime_checkpoint.py', 'android_checkpoint_origin.cjs', 'android_apk_checkpoint.py'):
            self.put('.github/native/' + name, (NATIVE / name).read_bytes())
        self.git('init', '-q')
        self.git('add', '.')
        self.git('-c', 'user.name=Runtime test', '-c', 'user.email=runtime@example.invalid', 'commit', '-qm', 'original app')
        self.source = self.git('rev-parse', 'HEAD').decode().strip()
        self.tree = self.git('rev-parse', 'HEAD^{tree}').decode().strip()
        self.apk = b'PK\x03\x04SYNTHETIC_APK_ONLY_NOT_AN_APPLICATION'
        self.overlays = [{'path': name, 'sha256': digest(b'SYNTHETIC_ONLY\n')} for name in
                         ('.env.ci', 'firebase.json', 'android/app/google-services.json')]
        self.installed_package = encoded({'name': 'synthetic-runtime-test', 'dependencies': {'test': '1'}, 'browser': {'synthetic': False}})
        self.nodeify = {'path': 'package.json', 'allowed_fields': ['browser', 'react-native', 'browserify'],
                        'before_sha256': digest(self.original_package), 'after_sha256': digest(self.installed_package)}
        self.selected = {'schema': 1, 'armed': True, 'scope': runtime.SCOPE, 'repository_id': runtime.REPO_ID,
            'source_sha': self.source, 'source_tree': self.tree, 'run_id': 40190000001,
            'run_attempt': 1, 'job_id': 121150000001, 'workflow_id': 395790359,
            'check_suite_id': 108900000001, 'workflow_sha': 'a' * 40, 'workflow_ref': runtime.WORKFLOW_REF,
            'artifact_id': 100000001, 'archive_sha256': None, 'archive_size_bytes': None}
        self.metadata = {'schema': 1, 'platform': 'ANDROID', 'diagnostic_only': True, 'source_sha': self.source,
            'run_id': str(self.selected['run_id']), 'run_attempt': '1', 'workflow_sha': 'a' * 40,
            'workflow_ref': runtime.WORKFLOW_REF, 'build': 'PASS',
            'app_id': 'io.hexawallet.keeper.development',
            **{key: 'NOT RUN' for key in ('smoke', 'native_probe', 'r5_features', 'hardware', 'signing')},
            'built_artifact': {'path': runtime.APK, 'sha256': digest(self.apk)},
            'commands': [{'label': 'Build debug-key-only development APK', 'exit_code': 0}],
            'configuration_overlays': self.overlays, 'nodeify_overlay': self.nodeify}
        self.manifest = {key: self.selected[key] for key in runtime.ORIGIN_KEYS if key in self.selected}
        self.manifest.update(schema=1, repository_private=True, job_name=runtime.JOB_NAME,
            scope='PRIVATE_ANDROID_DEBUG_BUILD_CHECKPOINT_NOT_NATIVE_ACCEPTANCE_OR_RELEASE',
            native_acceptance=False, release_artifact=False, measured_free_bytes_before_emulator=20000000000,
            files={'app-development-debug.apk': {'source_path': runtime.APK, 'sha256': digest(self.apk), 'size_bytes': len(self.apk)},
                   'build-metadata.json': {'source_path': runtime.METADATA, 'sha256': digest(encoded(self.metadata)), 'size_bytes': len(encoded(self.metadata))}})
        self.archive = self.zip_bytes()
        self.selected.update(archive_sha256=digest(self.archive), archive_size_bytes=len(self.archive))
        self.env = {'GITHUB_ACTIONS': 'true', 'GITHUB_EVENT_NAME': 'pull_request',
            'GITHUB_REPOSITORY': runtime.REPOSITORY, 'GITHUB_REPOSITORY_ID': str(runtime.REPO_ID),
            'GITHUB_RUN_ATTEMPT': '1', 'KEEPER_NATIVE_PLATFORM': 'ANDROID', 'KEEPER_DIAGNOSTIC': 'true',
            'GITHUB_SHA': 'c' * 40, 'GITHUB_WORKFLOW_SHA': 'c' * 40,
            'GITHUB_WORKFLOW_REF': runtime.REPOSITORY + '/.github/workflows/keeper-private-android-runtime-reuse.yml@refs/pull/73/merge',
            'GITHUB_RUN_ID': '40190000002', 'RUNNER_TEMP': str(self.runner), 'GITHUB_WORKSPACE': str(self.root),
            'GITHUB_OUTPUT': str(self.base / 'github-output'), 'GITHUB_ENV': str(self.base / 'github-env')}
        Path(self.env['GITHUB_OUTPUT']).touch()
        Path(self.env['GITHUB_ENV']).touch()

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.DEVNULL)

    def put(self, relative, raw):
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        return target

    def zip_bytes(self, members=None):
        if members is None:
            members = [('manifest.json', encoded(self.manifest)), ('app-development-debug.apk', self.apk),
                       ('build-metadata.json', encoded(self.metadata))]
        target = io.BytesIO()
        with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, raw in members:
                archive.writestr(name, raw)
        return target.getvalue()

    def stage(self):
        self.put('.github/native/android_reuse_selection.json', encoded(self.selected))
        self.git('add', '.')
        self.git('-c', 'user.name=Runtime test', '-c', 'user.email=runtime@example.invalid', 'commit', '-qm', 'reviewed controller')
        self.env['KEEPER_CONTROLLER_SHA'] = self.git('rev-parse', 'HEAD').decode().strip()
        runtime.stage(self.env)
        for line in Path(self.env['GITHUB_ENV']).read_text().splitlines():
            name, value = line.split('=', 1)
            self.env[name] = value
        self.git('checkout', '--detach', '-q', self.source)

    def receipt(self):
        return {'schema': 1, 'observed_unix_seconds': int(time.time()),
            'current_pr': {'head': {'sha': self.env['KEEPER_CONTROLLER_SHA'], 'repo': {'id': runtime.REPO_ID}},
                'merge_commit_sha': self.env['GITHUB_SHA'], 'runtime_opt_in': True, 'native_opt_in': False},
            'run': {'id': self.selected['run_id'], 'head_sha': self.source, 'head_commit': {'tree_id': self.tree},
                'run_attempt': 1, 'repository': {'id': runtime.REPO_ID, 'private': True},
                'head_repository': {'id': runtime.REPO_ID}, 'workflow_id': self.selected['workflow_id'],
                'check_suite_id': self.selected['check_suite_id'], 'path': '.github/workflows/keeper-native-diagnostic.yml',
                'referenced_workflows': [{'sha': self.selected['workflow_sha'], 'ref': 'refs/pull/73/merge',
                    'path': runtime.REPOSITORY + '/.github/workflows/keeper-native-platform.yml@' + self.selected['workflow_sha']}]},
            'job': {'id': self.selected['job_id'], 'run_id': self.selected['run_id'], 'head_sha': self.source,
                'run_attempt': 1, 'name': runtime.JOB_NAME, 'status': 'completed', 'conclusion': 'failure',
                'steps': [{'name': name, 'status': 'completed', 'conclusion': 'success'} for name in
                    ('Verify current diagnostic source', 'Build development app', 'Record official private Android checkpoint origin', 'Prepare exact private Android build checkpoint', 'Upload private Android build checkpoint')]},
            'artifact': {'id': self.selected['artifact_id'], 'name': 'keeper-private-android-checkpoint-%s-%s-1' % (self.source, self.selected['run_id']),
                'size_in_bytes': self.selected['archive_size_bytes'], 'digest': 'sha256:' + self.selected['archive_sha256'],
                'expired': False, 'workflow_run': {'id': self.selected['run_id'], 'head_sha': self.source,
                    'repository_id': runtime.REPO_ID, 'head_repository_id': runtime.REPO_ID}}}

    def write_receipt(self, phase, receipt=None):
        path = self.runner / ('keeper-android-reuse-' + phase + '.json')
        path.write_bytes(encoded(self.receipt() if receipt is None else receipt))
        return path

    def test_completed_success_or_failure_producer_still_requires_every_checkpoint_step(self):
        self.stage()
        for conclusion in ('success', 'failure'):
            receipt = self.receipt()
            receipt['job']['conclusion'] = conclusion
            admitted = runtime.api_identity(receipt, self.selected, self.env)
            self.assertEqual(admitted['job_conclusion'], conclusion)
            for index in range(len(receipt['job']['steps'])):
                failed = copy.deepcopy(receipt)
                failed['job']['steps'][index]['conclusion'] = 'failure'
                with self.subTest(conclusion=conclusion, step=index), self.assertRaises(runtime.Rejected):
                    runtime.api_identity(failed, self.selected, self.env)

    def download(self):
        self.write_receipt('before')
        real_run = subprocess.run
        requests = []
        def deliver(command, **kwargs):
            if command[0] != 'gh':
                return real_run(command, **kwargs)
            requests.append(command)
            self.assertEqual(command, ['gh', 'api', 'repos/' + runtime.REPOSITORY + '/actions/artifacts/' + str(self.selected['artifact_id']) + '/zip'])
            kwargs['stdout'].write(self.archive)
            return subprocess.CompletedProcess(command, 0)
        with mock.patch.object(runtime.subprocess, 'run', side_effect=deliver) as request:
            runtime.download(self.env)
            self.assertEqual(len(requests), 1)

    def admitted(self):
        self.stage()
        self.download()
        self.write_receipt('after')
        runtime.finalize(self.env)
        for line in Path(self.env['GITHUB_ENV']).read_text().splitlines():
            name, value = line.split('=', 1)
            self.env[name] = value

    def prepare_runtime(self):
        current = copy.deepcopy(self.metadata)
        current.update(run_id=self.env['GITHUB_RUN_ID'], workflow_sha=self.env['GITHUB_WORKFLOW_SHA'],
                       workflow_ref=self.env['GITHUB_WORKFLOW_REF'], build='NOT RUN')
        current.pop('built_artifact')
        current['commands'] = []
        self.put(runtime.METADATA, encoded(current))
        self.put('package.json', self.installed_package)
        for row in self.overlays:
            self.put(row['path'], b'SYNTHETIC_ONLY\n')

    def test_full_admission_restores_original_apk_and_records_both_sources_without_compiling(self):
        self.admitted()
        self.prepare_runtime()
        runtime.restore(self.env)
        self.assertEqual((self.root / runtime.APK).read_bytes(), self.apk)
        self.assertFalse((self.state / 'checkpoint.zip').exists())
        current = json.loads((self.root / runtime.METADATA).read_bytes())
        self.assertEqual(current['build'], 'PASS')
        self.assertIn('NO_CURRENT_RUN_COMPILATION', current['build_execution_scope'])
        self.assertEqual(current['source_sha'], self.source)
        self.assertEqual(current['run_id'], self.env['GITHUB_RUN_ID'])
        self.assertFalse(current['build_checkpoint']['native_acceptance'])
        self.assertEqual(current['build_checkpoint']['origin']['run_id'], self.selected['run_id'])
        admission = json.loads((self.root / 'artifacts/private-android-runtime-admission/admission.json').read_bytes())
        self.assertFalse(admission['native_acceptance'])
        self.assertFalse(admission['release_artifact'])
        self.assertEqual(admission['controller_sha'], self.env['KEEPER_CONTROLLER_SHA'])
        self.assertEqual(admission['runtime_source_sha'], self.source)
        self.assertEqual(current['smoke'], 'NOT RUN')

    def test_unarmed_selection_stops_before_controller_staging(self):
        self.selected['armed'] = False
        with self.assertRaises(runtime.Rejected):
            self.stage()
        self.assertFalse(self.control.exists())
        self.assertFalse(self.state.exists())

    def test_selection_rejects_ambiguous_or_different_identity(self):
        for key, bad in [('schema', True), ('armed', 1), ('source_sha', 'B' * 40), ('source_tree', 'f' * 39),
            ('run_attempt', 2), ('workflow_id', 1), ('repository_id', 1), ('artifact_id', True),
            ('archive_size_bytes', runtime.MAX_ARCHIVE + 1), ('archive_sha256', 'a' * 63)]:
            selected = dict(self.selected, **{key: bad})
            with self.subTest(key=key), self.assertRaises(runtime.Rejected):
                runtime.selection(encoded(selected))
        with self.assertRaises(runtime.Rejected):
            runtime.parse(b'{"same":1,"same":2}')
        with self.assertRaises(runtime.Rejected):
            runtime.parse(b'{"number":NaN}')

    def test_current_controller_and_original_checkout_are_independently_bound(self):
        self.stage()
        self.env['KEEPER_CONTROLLER_SHA'] = 'd' * 40
        with self.assertRaises(runtime.Rejected):
            runtime.guarded(self.env)
        self.env['KEEPER_CONTROLLER_SHA'] = json.loads((self.control / 'identity.json').read_bytes())['controller_sha']
        self.git('checkout', '--detach', '-q', self.env['KEEPER_CONTROLLER_SHA'])
        with self.assertRaises(runtime.Rejected):
            runtime.guarded(self.env)

    def test_modified_staged_helper_and_selection_fail_before_download(self):
        self.stage()
        for name in ('android_runtime_checkpoint.py', 'android_checkpoint_origin.cjs', 'android_reuse_selection.json'):
            path = self.control / name
            original = path.read_bytes()
            path.write_bytes(original + b' ')
            with self.subTest(name=name), self.assertRaises(runtime.Rejected):
                runtime.guarded(self.env)
            path.write_bytes(original)

    def test_selection_and_local_identity_cannot_be_rewritten_together(self):
        self.stage()
        selected = copy.deepcopy(self.selected)
        selected['artifact_id'] += 1
        raw = encoded(selected)
        (self.control / 'android_reuse_selection.json').write_bytes(raw)
        identity_path = self.control / 'identity.json'
        identity = json.loads(identity_path.read_bytes())
        identity['hashes']['android_reuse_selection.json'] = digest(raw)
        identity_path.write_bytes(encoded(identity))
        with self.assertRaises(runtime.Rejected):
            runtime.guarded(self.env)

    def test_official_receipt_rejects_wrong_origin_and_expired_or_moved_artifact(self):
        self.stage()
        cases = [('run', 'head_sha', 'd' * 40), ('run', 'run_attempt', 2), ('run', 'workflow_id', 1),
                 ('run', 'check_suite_id', 1), ('job', 'head_sha', 'd' * 40), ('job', 'id', 1),
                 ('job', 'status', 'in_progress'), ('artifact', 'id', 1), ('artifact', 'expired', True),
                 ('artifact', 'digest', 'sha256:' + 'd' * 64), ('artifact', 'size_in_bytes', 1),
                 ('current_pr', 'runtime_opt_in', False), ('current_pr', 'native_opt_in', True)]
        for section, key, bad in cases:
            receipt = self.receipt()
            receipt[section][key] = bad
            with self.subTest(section=section, key=key), self.assertRaises(runtime.Rejected):
                runtime.api_identity(receipt, self.selected, self.env)

    def test_receipts_require_fresh_unique_successful_build_and_checkpoint_steps(self):
        self.stage()
        for stamp in (int(time.time()) - 121, int(time.time()) + 10, True):
            receipt = self.receipt()
            receipt['observed_unix_seconds'] = stamp
            with self.subTest(stamp=stamp), self.assertRaises(runtime.Rejected):
                runtime.api_identity(receipt, self.selected, self.env)
        for mode in ('missing', 'failed', 'duplicate'):
            receipt = self.receipt()
            if mode == 'missing': receipt['job']['steps'].pop()
            if mode == 'failed': receipt['job']['steps'][-1]['conclusion'] = 'failure'
            if mode == 'duplicate': receipt['job']['steps'].append(dict(receipt['job']['steps'][-1]))
            with self.subTest(mode=mode), self.assertRaises(runtime.Rejected):
                runtime.api_identity(receipt, self.selected, self.env)

    def test_archive_digest_mismatch_purges_raw_and_never_admits(self):
        self.stage()
        self.archive = self.archive[:-1] + bytes([self.archive[-1] ^ 1])
        with self.assertRaises(runtime.Rejected):
            self.download()
        self.assertFalse((self.state / 'checkpoint.zip').exists())
        self.assertFalse((self.state / 'admitted.json').exists())

    def test_zip_extra_or_traversal_members_are_rejected_before_extracting(self):
        self.archive = self.zip_bytes([('manifest.json', encoded(self.manifest)),
            ('app-development-debug.apk', self.apk), ('../build-metadata.json', encoded(self.metadata))])
        self.selected.update(archive_sha256=digest(self.archive), archive_size_bytes=len(self.archive))
        self.stage()
        with self.assertRaises(runtime.Rejected):
            self.download()
        self.assertFalse((self.runner / 'build-metadata.json').exists())
        self.assertFalse((self.state / 'checkpoint.zip').exists())

    def test_zip_symlink_members_are_rejected(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            archive.writestr('manifest.json', encoded(self.manifest))
            member = zipfile.ZipInfo('app-development-debug.apk')
            member.create_system = 3
            member.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(member, self.apk)
            archive.writestr('build-metadata.json', encoded(self.metadata))
        self.archive = stream.getvalue()
        self.selected.update(archive_sha256=digest(self.archive), archive_size_bytes=len(self.archive))
        self.stage()
        with self.assertRaises(runtime.Rejected):
            self.download()
        self.assertFalse((self.state / 'checkpoint.zip').exists())

    def test_manifest_must_keep_exact_original_identity_and_no_acceptance(self):
        for key, bad in [('source_sha', 'd' * 40), ('source_tree', 'd' * 40), ('run_id', 1),
                         ('native_acceptance', True), ('release_artifact', True), ('repository_private', False)]:
            manifest = copy.deepcopy(self.manifest)
            manifest[key] = bad
            with self.subTest(key=key), self.assertRaises(runtime.Rejected):
                runtime.manifest(manifest, self.selected)

    def test_metadata_cannot_claim_different_build_or_already_executed_runtime(self):
        for key, bad in [('source_sha', 'd' * 40), ('run_id', '1'), ('build', 'FAIL'),
                         ('smoke', 'PASS'), ('native_probe', 'PASS'), ('r5_features', 'PASS'), ('signing', 'PASS')]:
            metadata = copy.deepcopy(self.metadata)
            metadata[key] = bad
            with self.subTest(key=key), self.assertRaises(runtime.Rejected):
                runtime.built_metadata(metadata, self.selected, self.manifest)

    def test_second_official_read_must_still_match_before_admission(self):
        self.stage()
        self.download()
        receipt = self.receipt()
        receipt['current_pr']['head']['sha'] = 'd' * 40
        self.write_receipt('after', receipt)
        with self.assertRaises(runtime.Rejected):
            runtime.finalize(self.env)
        self.assertFalse((self.state / 'admitted.json').exists())

    def test_raw_purge_failure_cannot_create_admission(self):
        self.stage()
        with mock.patch.object(runtime, 'purge_owned', side_effect=runtime.Rejected), self.assertRaises(runtime.Rejected):
            self.download()
        self.assertTrue((self.state / 'checkpoint.zip').exists())
        self.write_receipt('after')
        with self.assertRaises(runtime.Rejected):
            runtime.finalize(self.env)
        self.assertFalse((self.state / 'admitted.json').exists())

    def test_apk_modified_after_admission_cannot_restore(self):
        self.admitted()
        self.prepare_runtime()
        (self.state / 'app-development-debug.apk').write_bytes(b'REPLACED')
        with self.assertRaises(runtime.Rejected):
            runtime.restore(self.env)
        self.assertFalse((self.root / runtime.APK).exists())

    def test_metadata_modified_after_admission_cannot_restore(self):
        self.admitted()
        self.prepare_runtime()
        metadata = copy.deepcopy(self.metadata)
        metadata['configuration'] = 'UNATTESTED_MUTATION'
        (self.state / 'build-metadata.json').write_bytes(encoded(metadata))
        with self.assertRaises(runtime.Rejected):
            runtime.restore(self.env)
        self.assertFalse((self.root / runtime.APK).exists())

    def test_apk_manifest_and_admission_cannot_be_rewritten_together(self):
        self.admitted()
        self.prepare_runtime()
        replaced = b'REPLACED_APK_NOT_ORIGINAL'
        (self.state / 'app-development-debug.apk').write_bytes(replaced)
        manifest = copy.deepcopy(self.manifest)
        manifest['files']['app-development-debug.apk'].update(sha256=digest(replaced), size_bytes=len(replaced))
        metadata = copy.deepcopy(self.metadata)
        metadata['built_artifact']['sha256'] = digest(replaced)
        raw_metadata = encoded(metadata)
        (self.state / 'build-metadata.json').write_bytes(raw_metadata)
        manifest['files']['build-metadata.json'].update(sha256=digest(raw_metadata), size_bytes=len(raw_metadata))
        raw_manifest = encoded(manifest)
        (self.state / 'manifest.json').write_bytes(raw_manifest)
        admission_path = self.state / 'admitted.json'
        admission = json.loads(admission_path.read_bytes())
        admission['manifest_sha256'] = digest(raw_manifest)
        admission_path.write_bytes(encoded(admission))
        with self.assertRaises(runtime.Rejected):
            runtime.restore(self.env)
        self.assertFalse((self.root / runtime.APK).exists())

    def test_tracked_app_mutation_after_prepare_cannot_feed_runtime_metro(self):
        self.admitted()
        self.prepare_runtime()
        self.put('src/app.ts', b'export const source = "CHANGED";\n')
        with self.assertRaises(Exception):
            runtime.restore(self.env)
        self.assertFalse((self.root / runtime.APK).exists())

    def test_actual_overlay_mutation_cannot_hide_behind_unchanged_metadata(self):
        self.admitted()
        self.prepare_runtime()
        self.put('firebase.json', b'UNATTESTED_OVERLAY')
        with self.assertRaises(Exception):
            runtime.restore(self.env)
        self.assertFalse((self.root / runtime.APK).exists())

    def test_symlink_state_directory_is_rejected_after_admission(self):
        self.admitted()
        self.prepare_runtime()
        moved = self.runner / 'moved-state'
        self.state.rename(moved)
        self.state.symlink_to(moved, target_is_directory=True)
        with self.assertRaises(Exception):
            runtime.restore(self.env)
        self.assertFalse((self.root / runtime.APK).exists())

    def test_existing_apk_is_never_overwritten(self):
        self.admitted()
        self.prepare_runtime()
        existing = self.put(runtime.APK, b'KEEP_EXISTING')
        with self.assertRaises(FileExistsError):
            runtime.restore(self.env)
        self.assertEqual(existing.read_bytes(), b'KEEP_EXISTING')


if __name__ == '__main__':
    unittest.main()
