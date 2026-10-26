import importlib.util
import contextlib
import io
import json
from pathlib import Path
import subprocess
import socket
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('suite_controller_test', ROOT / '.github/native/android_skip_delivery_observer.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class RetainedSuiteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'app'; self.root.mkdir()
        self.state = Path(self.temp.name) / 'stage'; (self.state / 'files').mkdir(parents=True)
        self.orig = '.github/native/r52_tls_native.py'; self.added = '.github/native/r52_new_probe.js'
        (self.root / self.orig).parent.mkdir(parents=True)
        (self.root / self.orig).write_bytes(b'ORIGINAL_FF_BYTES\n')
        self.git('init', '-q'); self.git('add', '.')
        self.git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'ff fixture')
        self.manifest = {'files': [{'path': self.orig}, {'path': self.added}]}
        (self.state / 'files/r52_tls_native.py').write_bytes(b'REVIEWED_TLS_OVERLAY\n')
        (self.state / 'files/r52_new_probe.js').write_bytes(b'REVIEWED_PROBE_OVERLAY\n')
        (self.state / 'manifest.json').write_bytes(b'REVIEWED_MANIFEST\n')
        self.metadata = {'source_sha': 'ff-proof', 'smoke': 'PASS', 'build': 'PASS'}
        self.harness = SimpleNamespace(read=lambda: self.metadata)

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.DEVNULL)

    def install(self, harness, env):
        for row in self.manifest['files']:
            (self.root / row['path']).write_bytes((self.state / 'files' / Path(row['path']).name).read_bytes())
        (self.root / '.github/native/r52_retained_manifest.json').write_bytes((self.state / 'manifest.json').read_bytes())

    def adapter(self, tls_status='FAIL', tls_cleanup='PASS', install_failure=False):
        calls = []
        def install(h, env):
            self.install(h, env)
            if install_failure: raise RuntimeError('PARTIAL_INSTALL_FAILURE')
        def load(path, name):
            phase = 'tls' if path.name == 'r52_tls_native.py' else 'realm109'
            def run(h):
                calls.append(phase)
                status = tls_status if phase == 'tls' else 'PASS'
                self.metadata['r52_' + ('tls_native' if phase == 'tls' else 'realm109_native')] = {
                    'status': status, 'cleanup': tls_cleanup if phase == 'tls' else 'PASS'}
                if status == 'FAIL': raise ValueError('ORIGINAL_PHASE_FAILURE_SECRET_SENTINEL')
            return SimpleNamespace(run_retained=run)
        value = SimpleNamespace(staged=lambda env: (self.root, self.state, self.manifest, {}),
            install=install, Admission=mock.Mock(), load_module=load)
        return value, calls

    def test_exact_overlay_restore_preserves_original_and_removes_only_known_additions(self):
        baseline = m.originals(self.root, self.manifest)
        self.install(self.harness, {})
        unrelated = self.root / 'UNRELATED_USER_FILE'; unrelated.write_bytes(b'KEEP\n')
        m.restore_r52(self.root, self.state, self.manifest, baseline)
        self.assertEqual((self.root / self.orig).read_bytes(), b'ORIGINAL_FF_BYTES\n')
        self.assertFalse((self.root / self.added).exists())
        self.assertFalse((self.root / '.github/native/r52_retained_manifest.json').exists())
        self.assertEqual(unrelated.read_bytes(), b'KEEP\n')
        self.assertEqual(self.git('diff', '--name-only'), b'')

    def test_unknown_overlay_or_symlink_refuses_before_any_restore(self):
        for mode in ('foreign', 'symlink'):
            baseline = m.originals(self.root, self.manifest)
            self.install(self.harness, {})
            added = self.root / self.added
            if mode == 'foreign': added.write_bytes(b'FOREIGN_SOURCE_SECRET_SENTINEL\n')
            else:
                added.unlink(); added.symlink_to('/etc/passwd')
            with self.subTest(mode=mode), self.assertRaises(RuntimeError):
                m.restore_r52(self.root, self.state, self.manifest, baseline)
            self.assertEqual((self.root / self.orig).read_bytes(), b'REVIEWED_TLS_OVERLAY\n')
            added.unlink()
            (self.root / self.orig).write_bytes(b'ORIGINAL_FF_BYTES\n')
            (self.root / '.github/native/r52_retained_manifest.json').unlink()

    def test_exact_overlay_under_symlink_parent_rejects_before_any_foreign_mutation(self):
        baseline = m.originals(self.root, self.manifest)
        self.install(self.harness, {})
        native = self.root / '.github/native'
        foreign = Path(self.temp.name) / 'foreign-exact-overlay'
        native.rename(foreign); native.symlink_to(foreign, target_is_directory=True)
        before = {path.name: path.read_bytes() for path in foreign.iterdir()}
        with self.assertRaises(RuntimeError): m.restore_r52(self.root, self.state, self.manifest, baseline)
        self.assertEqual({path.name: path.read_bytes() for path in foreign.iterdir()}, before)
        with self.assertRaises(RuntimeError): m.originals(self.root, self.manifest)
        self.assertEqual({path.name: path.read_bytes() for path in foreign.iterdir()}, before)

    def test_staged_files_parent_alias_rejects_before_app_overlay_mutation(self):
        baseline = m.originals(self.root, self.manifest)
        self.install(self.harness, {})
        staged = self.state / 'files'; foreign = Path(self.temp.name) / 'foreign-stage'
        staged.rename(foreign); staged.symlink_to(foreign, target_is_directory=True)
        app_before = {path.name: path.read_bytes() for path in (self.root / '.github/native').iterdir()}
        stage_before = {path.name: path.read_bytes() for path in foreign.iterdir()}
        with self.assertRaises(RuntimeError): m.restore_r52(self.root, self.state, self.manifest, baseline)
        self.assertEqual({path.name: path.read_bytes() for path in (self.root / '.github/native').iterdir()}, app_before)
        self.assertEqual({path.name: path.read_bytes() for path in foreign.iterdir()}, stage_before)

    def test_tls_failure_with_proven_cleanup_still_runs_realm_and_preserves_each_result(self):
        adapter, calls = self.adapter()
        report = {}
        with mock.patch.object(m, 'wait_for_metro', return_value={'status': 'AVAILABLE'}):
            self.assertTrue(m.r52_phases(adapter, self.harness, {}, report))
        self.assertEqual(calls, ['tls', 'realm109'])
        self.assertEqual(report['tls']['status'], 'FAIL')
        self.assertEqual(report['realm109']['status'], 'PASS')
        self.assertEqual(report['r52_overlay_restoration'], 'PASS')
        self.assertEqual(self.metadata['r52_tls_native']['status'], 'FAIL')
        self.assertEqual(self.metadata['smoke'], 'PASS')
        self.assertEqual(self.git('diff', '--name-only'), b'')
        self.assertNotIn('SECRET_SENTINEL', json.dumps(report))

    def test_unverified_phase_cleanup_blocks_later_realm_and_product_without_erasing_tls_failure(self):
        adapter, calls = self.adapter(tls_cleanup='FAIL'); report = {}
        with mock.patch.object(m, 'wait_for_metro', return_value={'status': 'AVAILABLE'}):
            self.assertFalse(m.r52_phases(adapter, self.harness, {}, report))
        self.assertEqual(calls, ['tls'])
        self.assertEqual(report['tls']['status'], 'FAIL')
        self.assertEqual(report['realm109']['status'], 'NOT RUN')
        self.assertFalse(report['host_cleanup_verified_before_product'])
        self.assertEqual(report['r52_overlay_restoration'], 'PASS')
        self.assertEqual(self.git('diff', '--name-only'), b'')

    def test_partial_install_failure_restores_owned_bytes_and_keeps_host_unverified(self):
        adapter, calls = self.adapter(install_failure=True); report = {}
        self.assertFalse(m.r52_phases(adapter, self.harness, {}, report))
        self.assertEqual(calls, [])
        self.assertEqual(report['r52_install'], 'FAIL')
        self.assertEqual(report['r52_overlay_restoration'], 'PASS')
        self.assertEqual(self.git('diff', '--name-only'), b'')

    def test_unavailable_metro_bind_stops_before_loading_any_phase_and_restores_source(self):
        adapter, calls = self.adapter(tls_status='PASS'); report = {}
        with mock.patch.object(m, 'wait_for_metro', return_value={'status': 'UNAVAILABLE'}):
            self.assertFalse(m.r52_phases(adapter, self.harness, {}, report))
        self.assertEqual(calls, [])
        self.assertEqual(report['tls']['status'], 'NOT RUN')
        self.assertEqual(report['realm109']['status'], 'NOT RUN')
        self.assertEqual(report['r52_overlay_restoration'], 'PASS')

    def test_real_active_listener_remains_blocking_and_is_never_killed_or_bypassed(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(('127.0.0.1', 8081)); listener.listen()
            with mock.patch.object(m, 'METRO_WAIT_SECONDS', 0.01):
                self.assertEqual(m.wait_for_metro()['status'], 'UNAVAILABLE')
            self.assertEqual(listener.getsockname(), ('127.0.0.1', 8081))

    def test_product_pass_after_clean_tls_failure_does_not_erase_failure_or_pass_combined_suite(self):
        (self.root / 'artifacts').mkdir()
        adapter = SimpleNamespace(protected=lambda data: dict(data))
        def phases(adapter, harness, env, report):
            report.update(r52_install='PASS', r52_overlay_restoration='PASS',
                tls={'status': 'FAIL'}, realm109={'status': 'PASS'})
            return True
        output = io.StringIO()
        with mock.patch.object(m, 'admitted', return_value=(self.root, self.state, {'controller_sha': 'a' * 40})), \
             mock.patch.object(m, 'pinned', return_value=self.harness), \
             mock.patch.object(m, 'staged_r52', return_value=(adapter, self.root, self.state, {})), \
             mock.patch.object(m, 'r52_phases', side_effect=phases), \
             mock.patch.object(m, 'run') as product, contextlib.redirect_stdout(output):
            with self.assertRaises(RuntimeError): m.suite({'GITHUB_RUN_ID': '123'})
        product.assert_called_once()
        report = json.loads((self.root / 'artifacts/private-android-skip-delivery/suite.json').read_bytes())
        self.assertEqual(report['tls']['status'], 'FAIL')
        self.assertEqual(report['realm109']['status'], 'PASS')
        self.assertEqual(report['product']['status'], 'PASS')
        self.assertFalse(report['native_acceptance']); self.assertFalse(report['release_acceptance'])


if __name__ == '__main__': unittest.main()
