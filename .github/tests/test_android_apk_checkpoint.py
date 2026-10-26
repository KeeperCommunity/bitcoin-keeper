"""Real temporary Git source/file guards; no APK build, API or credential access."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('checkpoint_test',
    Path(__file__).resolve().parents[1] / 'native/android_apk_checkpoint.py')
checkpoint = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checkpoint)


def digest(value):
    return hashlib.sha256(value).hexdigest()


class CheckpointTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.base = Path(temp.name)
        self.root = self.base / 'app'
        self.root.mkdir()
        self.temporary = self.base / 'runner'
        self.temporary.mkdir()
        self.original = b'{"name":"synthetic-source","dependencies":{"safe":"1"}}\n'
        self.put('package.json', self.original)
        self.put('src/empty.ts', b'')
        self.put('src/source.ts', b'export const value = 1;\n')
        self.put('firebase.json', b'{}\n')
        self.put('android/app/google-services.json', b'{}\n')
        self.put('.github/native/android_apk_checkpoint.py', Path(checkpoint.__file__).read_bytes())
        self.git('init', '-q')
        self.git('-c', 'user.name=Checkpoint test', '-c', 'user.email=checkpoint@example.invalid',
                 'add', '.')
        self.git('-c', 'user.name=Checkpoint test', '-c', 'user.email=checkpoint@example.invalid',
                 'commit', '-qm', 'synthetic committed source')
        self.source = self.git('rev-parse', 'HEAD').decode().strip()
        self.tree = self.git('rev-parse', 'HEAD^{tree}').decode().strip()
        installed = json.loads(self.original)
        installed['browser'] = {'synthetic': False}
        self.put('package.json', json.dumps(installed).encode())
        self.overlays = []
        for name in sorted(checkpoint.OVERLAYS):
            raw = b'SYNTHETIC_CONFIG_ONLY\n' if name == '.env.ci' else b'{"synthetic":true}\n'
            self.put(name, raw)
            self.overlays.append({'path': name, 'sha256': digest(raw)})
        self.apk = b'PK\x03\x04SYNTHETIC_APK_BYTES_NOT_AN_APPLICATION'
        self.put(checkpoint.APK, self.apk)
        self.origin = {'schema': 1, 'repository_id': 839671816, 'repository_private': True,
            'source_sha': self.source, 'source_tree': self.tree, 'run_id': 40190000001,
            'run_attempt': 1, 'job_id': 121150000001,
            'job_name': 'android / Native ANDROID build and probes', 'workflow_id': 395790359,
            'workflow_sha': 'a' * 40,
            'workflow_ref': 'KeeperCommunity/bitcoin-keeper-private/.github/workflows/keeper-native-diagnostic.yml@refs/pull/73/merge'}
        self.env = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
            'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64', 'ImageOS': 'ubuntu24',
            'KEEPER_NATIVE_PLATFORM': 'ANDROID', 'KEEPER_DIAGNOSTIC': 'true',
            'GITHUB_REPOSITORY': 'KeeperCommunity/bitcoin-keeper-private',
            'GITHUB_REPOSITORY_ID': '839671816', 'GITHUB_EVENT_NAME': 'pull_request',
            'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_WORKSPACE': str(self.root),
            'KEEPER_SOURCE_SHA': self.source, 'GITHUB_RUN_ID': str(self.origin['run_id']),
            'GITHUB_WORKFLOW_SHA': self.origin['workflow_sha'],
            'GITHUB_WORKFLOW_REF': self.origin['workflow_ref'], 'RUNNER_TEMP': str(self.temporary)}
        self.metadata = {'schema': 1, 'platform': 'ANDROID', 'diagnostic_only': True,
            **{key: self.origin[key] for key in ('source_sha', 'workflow_sha', 'workflow_ref')},
            'run_id': str(self.origin['run_id']), 'run_attempt': '1', 'build': 'PASS',
            'app_id': 'io.hexawallet.keeper.development',
            **{key: 'NOT RUN' for key in ('smoke', 'native_probe', 'r5_features', 'hardware', 'signing')},
            'commands': [{'label': 'Build debug-key-only development APK', 'exit_code': 0}],
            'built_artifact': {'path': checkpoint.APK, 'sha256': digest(self.apk)},
            'configuration_overlays': self.overlays,
            'nodeify_overlay': {'path': 'package.json', 'allowed_fields': ['browser', 'react-native', 'browserify'],
                'before_sha256': digest(self.original),
                'after_sha256': digest((self.root / 'package.json').read_bytes())}}
        self.write_inputs()

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.DEVNULL)

    def put(self, name, raw):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        return path

    def write_inputs(self):
        (self.temporary / checkpoint.ORIGIN).write_text(json.dumps(self.origin))
        self.put(checkpoint.METADATA, json.dumps(self.metadata).encode())

    def prepare(self):
        return checkpoint.prepare(self.root, self.env)

    def test_exact_checkpoint_copies_only_two_originals_and_measured_manifest(self):
        metadata = (self.root / checkpoint.METADATA).read_bytes()
        with mock.patch.object(checkpoint.shutil, 'disk_usage', return_value=SimpleNamespace(free=1234567)):
            result = self.prepare()
        output = self.root / 'artifacts' / checkpoint.CHECKPOINT
        self.assertEqual({p.name for p in output.iterdir()},
                         {'manifest.json', 'app-development-debug.apk', 'build-metadata.json'})
        self.assertEqual(output.stat().st_mode & 0o777, 0o700)
        self.assertEqual((output / 'app-development-debug.apk').read_bytes(), self.apk)
        self.assertEqual((output / 'build-metadata.json').read_bytes(), metadata)
        self.assertFalse(result['native_acceptance'])
        self.assertFalse(result['release_artifact'])
        self.assertEqual(result['measured_free_bytes_before_emulator'], 1234567)
        for key in checkpoint.FIELDS:
            self.assertEqual(result[key], self.origin[key])
        self.assertEqual(result['files']['app-development-debug.apk'],
            {'source_path': checkpoint.APK, 'sha256': digest(self.apk), 'size_bytes': len(self.apk)})
        self.assertNotIn('SYNTHETIC_CONFIG_ONLY', (output / 'manifest.json').read_text())

    def test_context_mismatch_fails_before_output(self):
        for field in self.env:
            if field == 'RUNNER_TEMP':
                continue
            with self.subTest(field=field), mock.patch.dict(self.env, {field: 'UNKNOWN'}):
                with self.assertRaises(Exception):
                    self.prepare()
        self.assertFalse((self.root / 'artifacts' / checkpoint.CHECKPOINT).exists())

    def test_origin_must_match_official_private_a1_tuple(self):
        for field, value in [('repository_id', 470904030), ('repository_private', False),
                ('source_tree', 'b' * 40), ('source_sha', 'b' * 40), ('job_id', True),
                ('job_name', 'unknown'), ('workflow_id', 1), ('run_attempt', 2),
                ('run_id', 1), ('workflow_sha', 'b' * 40), ('workflow_ref', 'unknown')]:
            previous = self.origin[field]
            self.origin[field] = value
            self.write_inputs()
            with self.subTest(field=field), self.assertRaises(Exception):
                self.prepare()
            self.origin[field] = previous
        self.assertFalse((self.root / 'artifacts' / checkpoint.CHECKPOINT).exists())

    def test_duplicate_json_and_origin_unknown_fields_are_rejected(self):
        receipt = self.temporary / checkpoint.ORIGIN
        receipt.write_text('{"schema":1,"schema":1}')
        with self.assertRaises(Exception):
            self.prepare()
        self.origin['credential'] = 'DO_NOT_EXPORT'
        self.write_inputs()
        with self.assertRaises(Exception):
            self.prepare()

    def test_another_private_pr_cannot_supply_a_checkpoint(self):
        other = self.origin['workflow_ref'].replace('/73/', '/74/')
        self.origin['workflow_ref'] = other
        self.env['GITHUB_WORKFLOW_REF'] = other
        self.metadata['workflow_ref'] = other
        self.write_inputs()
        with self.assertRaises(Exception):
            self.prepare()
        self.assertFalse((self.root / 'artifacts' / checkpoint.CHECKPOINT).exists())

    def test_metadata_exceeding_runtime_admission_limit_is_not_retained(self):
        self.metadata['padding'] = 'x' * (1024 * 1024)
        self.write_inputs()
        with self.assertRaises(Exception):
            self.prepare()
        self.assertFalse((self.root / 'artifacts' / checkpoint.CHECKPOINT).exists())

    def test_tracked_executable_mode_must_match_committed_source(self):
        source = self.root / 'src/source.ts'
        source.chmod(source.stat().st_mode | 0o100)
        with self.assertRaises(Exception):
            self.prepare()
        self.assertFalse((self.root / 'artifacts' / checkpoint.CHECKPOINT).exists())

    def test_missing_or_failed_build_and_postbuild_acceptance_are_rejected(self):
        for field, value in [('build', 'FAIL'), ('diagnostic_only', False), ('platform', 'IOS'),
                ('run_attempt', '2'), ('source_sha', 'b' * 40), ('signing', 'PASS'), ('smoke', 'PASS')]:
            previous = self.metadata[field]
            self.metadata[field] = value
            self.write_inputs()
            with self.subTest(field=field), self.assertRaises(Exception):
                self.prepare()
            self.metadata[field] = previous

    def test_exact_apk_hash_bounds_and_hardlink_reject_and_remove_partial_output(self):
        self.put(checkpoint.APK, b'WRONG')
        with self.assertRaises(Exception):
            self.prepare()
        self.assertFalse((self.root / 'artifacts' / checkpoint.CHECKPOINT).exists())
        self.put(checkpoint.APK, self.apk)
        with mock.patch.object(checkpoint, 'MAX_APK', len(self.apk) - 1), self.assertRaises(Exception):
            self.prepare()
        os.link(self.root / checkpoint.APK, self.base / 'extra-apk-link')
        with self.assertRaises(Exception):
            self.prepare()

    def test_file_and_ancestor_symlinks_cannot_redirect_apk(self):
        apk = self.root / checkpoint.APK
        alternate = self.base / 'alternate.apk'
        alternate.write_bytes(self.apk)
        apk.unlink()
        apk.symlink_to(alternate)
        with self.assertRaises(Exception):
            self.prepare()
        apk.unlink()
        apk.parent.rename(self.base / 'real-debug')
        apk.parent.symlink_to(self.base / 'real-debug', target_is_directory=True)
        with self.assertRaises(Exception):
            self.prepare()

    def test_tracked_source_and_overlay_mutation_are_rejected(self):
        source = self.root / 'src/source.ts'
        source.write_text('UNCOMMITTED_SOURCE')
        with self.assertRaises(Exception):
            self.prepare()
        source.write_text('export const value = 1;\n')
        self.put('firebase.json', b'UNATTESTED_CONFIG')
        with self.assertRaises(Exception):
            self.prepare()

    def test_nodeify_cannot_change_dependency_or_claim_wrong_original(self):
        path = self.root / 'package.json'
        data = json.loads(path.read_bytes())
        data['dependencies']['safe'] = '2'
        path.write_text(json.dumps(data))
        self.metadata['nodeify_overlay']['after_sha256'] = digest(path.read_bytes())
        self.write_inputs()
        with self.assertRaises(Exception):
            self.prepare()

    def test_build_command_must_have_one_integer_success_result(self):
        for commands in ([], [{'label': 'Build debug-key-only development APK', 'exit_code': False}],
                [{'label': 'Build debug-key-only development APK', 'exit_code': 1}],
                [{'label': 'Build debug-key-only development APK', 'exit_code': 0}] * 2):
            with self.subTest(commands=commands):
                self.metadata['commands'] = commands
                self.write_inputs()
                with self.assertRaises(Exception):
                    self.prepare()

    def test_nodeify_original_hash_and_overlay_members_are_bound(self):
        original = self.metadata['nodeify_overlay']['before_sha256']
        self.metadata['nodeify_overlay']['before_sha256'] = '0' * 64
        self.write_inputs()
        with self.assertRaises(Exception):
            self.prepare()
        self.metadata['nodeify_overlay']['before_sha256'] = original
        self.metadata['configuration_overlays'] = self.overlays[:2] + self.overlays[:1]
        self.write_inputs()
        with self.assertRaises(Exception):
            self.prepare()

    def test_preexisting_checkpoint_is_never_overwritten_or_deleted(self):
        output = self.root / 'artifacts' / checkpoint.CHECKPOINT
        output.mkdir()
        (output / 'keep').write_text('PRESERVE')
        with self.assertRaises(Exception):
            self.prepare()
        self.assertEqual((output / 'keep').read_text(), 'PRESERVE')

    def test_source_move_after_copy_fails_and_cleans_only_owned_checkpoint(self):
        real = checkpoint.validate_context
        count = 0
        def context(*args):
            nonlocal count
            count += 1
            if count == 2:
                raise ValueError('synthetic source moved')
            return real(*args)
        with mock.patch.object(checkpoint, 'validate_context', side_effect=context), self.assertRaises(Exception):
            self.prepare()
        self.assertFalse((self.root / 'artifacts' / checkpoint.CHECKPOINT).exists())

    def test_inflight_file_mutation_and_wrong_owner_fail_closed(self):
        base = checkpoint.directory(self.root)
        self.addCleanup(os.close, base)
        real = checkpoint.os.fstat
        count = 0
        def changed(fd):
            nonlocal count
            count += 1
            result = real(fd)
            if count == 2:
                return SimpleNamespace(**{key: getattr(result, key) + (1 if key == 'st_mtime_ns' else 0)
                    for key in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns',
                                'st_nlink', 'st_uid', 'st_mode')})
            return result
        with mock.patch.object(checkpoint.os, 'fstat', side_effect=changed), self.assertRaises(Exception):
            checkpoint.read_file(base, 'package.json', 4096)
        def wrong_owner(fd):
            result = real(fd)
            return SimpleNamespace(**{key: getattr(result, key) + (1 if key == 'st_uid' else 0)
                for key in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns',
                            'st_nlink', 'st_uid', 'st_mode')})
        with mock.patch.object(checkpoint.os, 'fstat', side_effect=wrong_owner), self.assertRaises(Exception):
            checkpoint.read_file(base, 'package.json', 4096)


if __name__ == '__main__':
    unittest.main()
