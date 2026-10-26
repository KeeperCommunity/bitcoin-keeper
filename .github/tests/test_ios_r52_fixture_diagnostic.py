"""Actual owned host fixture/process controls; no app build, simulator or UI."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('fixture_diagnostic', ROOT / '.github/native/ios_r52_fixture_diagnostic.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class HostFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='keeper-fixture-test-'); self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)

    def test_actual_exported_ios_matrix_ready_and_close_with_real_default_openssl(self):
        tool = m.identity(Path(shutil.which('openssl'))); node = m.identity(Path(shutil.which('node')))
        value = m.attempt('actual', tool, node, ROOT / '.github/native/ios_r52_fixture_probe.cjs', self.base, dict(os.environ))
        self.assertTrue(value['capable']); self.assertEqual(value['probe']['case_count'], 25)
        self.assertEqual(value['probe']['loopback_listener_count'], 28)
        self.assertEqual(value['probe']['cleanup'], 'PASS'); self.assertEqual(list(self.base.iterdir()), [])
        self.assertNotIn('BEGIN CERTIFICATE', json.dumps(value)); self.assertNotIn('PRIVATE KEY', json.dumps(value))

    def test_actual_unsupported_tool_failure_is_fixed_category_and_temp_keys_removed(self):
        binary = self.base / 'openssl'; binary.write_text('#!/bin/sh\nprintf "Unknown option -new PRIVATE_SENTINEL\\n" >&2\nexit 1\n'); binary.chmod(0o700)
        tool = m.identity(binary); node = m.identity(Path(shutil.which('node')))
        value = m.attempt('unsupported', tool, node, ROOT / '.github/native/ios_r52_fixture_probe.cjs', self.base, dict(os.environ))
        self.assertFalse(value['capable']); self.assertEqual(value['probe']['error_category'], 'OPENSSL_OPTION_UNSUPPORTED')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(value)); self.assertEqual(list(self.base.iterdir()), [binary])
        self.assertEqual(value['command']['process_group_cleanup'], 'PASS')

    def test_actual_output_overflow_and_hanging_process_group_are_bounded_and_reaped(self):
        result, raw = m.owned_run([sys.executable, '-c', 'import os; os.write(1,b"X"*65536)'], self.base, dict(os.environ), 2, 1024)
        self.assertEqual(result['category'], 'OUTPUT_LIMIT'); self.assertLessEqual(len(raw), 1024)
        self.assertEqual(result['process_group_cleanup'], 'PASS')
        result, raw = m.owned_run([sys.executable, '-c', 'import time; time.sleep(20)'], self.base, dict(os.environ), 0.1)
        self.assertEqual(result['category'], 'TIMEOUT'); self.assertEqual(result['process_group_cleanup'], 'PASS')

    def test_timeout_does_not_signal_a_separate_owned_control_process(self):
        other = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(20)'], start_new_session=True)
        try:
            result, _ = m.owned_run([sys.executable, '-c', 'import time; time.sleep(20)'], self.base, dict(os.environ), 0.1)
            self.assertEqual(result['category'], 'TIMEOUT'); self.assertIsNone(other.poll())
        finally:
            other.terminate(); other.wait(timeout=2)

    def test_actual_self_mutating_tool_identity_is_rejected_after_version(self):
        binary = self.base / 'openssl'
        binary.write_text('#!/bin/sh\nprintf "# changed\\n" >> "$0"\nprintf "OpenSSL 3.4.0\\n"\n'); binary.chmod(0o700)
        tool = m.identity(binary)
        with self.assertRaises(RuntimeError): m.version(tool, self.base, dict(os.environ))

    def test_cli_stale_target_and_parent_alias_reject_without_foreign_mutation(self):
        native = self.base / '.github/native'; native.mkdir(parents=True)
        self.assertEqual(m.cli_guards(self.base)['parent'], 'ABSENT_CANONICAL_EXISTING_ANCESTORS')
        generated = native / '.generated'; generated.mkdir()
        target = generated / 'r52_tls_fixture.json'; target.write_text('stale')
        self.assertEqual(m.cli_guards(self.base)['state'], 'FAIL')
        self.assertFalse(m.cli_guards(self.base)['target_absent'])
        self.assertEqual(target.read_text(), 'stale'); target.unlink(); generated.rmdir()
        foreign = self.base / 'foreign'; foreign.mkdir(); (foreign / 'sentinel').write_text('foreign')
        generated.symlink_to(foreign, target_is_directory=True)
        self.assertEqual(m.cli_guards(self.base)['state'], 'FAIL')
        self.assertFalse(m.cli_guards(self.base)['parent_canonical'])
        self.assertEqual((foreign / 'sentinel').read_text(), 'foreign')

    def test_tool_mutability_and_directory_aliases_reject(self):
        binary = self.base / 'tool'; binary.write_text('#!/bin/sh\nexit 0\n'); binary.chmod(0o777)
        with self.assertRaises(RuntimeError): m.identity(binary)
        binary.chmod(0o700); alias = self.base / 'alias'; alias.symlink_to(self.base, target_is_directory=True)
        with self.assertRaises(RuntimeError): m.directory(alias)


class SessionPolicy(unittest.TestCase):
    def test_malformed_node_version_never_exports_raw_bytes_or_starts_fixture(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory); worker = base / '.github/native/ios_r52_fixture_probe.cjs'
            worker.parent.mkdir(parents=True); worker.write_bytes(b'fixed probe')
            state = {}; native = SimpleNamespace(ROOT=base, read=lambda: copy.deepcopy(state),
                save=lambda value: (state.clear(), state.update(copy.deepcopy(value))))
            for raw in (b'PRIVATE_SENTINEL\n', b'v22.23.4 PRIVATE_SENTINEL\n', b'\xffPRIVATE_SENTINEL\n'):
                with mock.patch.dict(os.environ, {'RUNNER_TEMP': str(base)}), \
                    mock.patch.object(m.subprocess, 'check_output', return_value=b'fixed probe'), \
                    mock.patch.object(m, 'identity', return_value={'path': '/fixed/node', 'sha256': 'b' * 64, 'bytes': 1}), \
                    mock.patch.object(m, 'owned_run', return_value=({'exit_code': 0, 'category': None, 'process_group_cleanup': 'PASS'}, raw)), \
                    mock.patch.object(m, 'attempt') as attempt, self.assertRaises(RuntimeError):
                    with m.session(native): self.fail('malformed version admitted')
                value = state[m.FIELD]
                self.assertEqual(value['node_version'], 'UNAVAILABLE'); self.assertEqual(value['status'], 'FAIL')
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(value)); self.assertFalse(value['native_acceptance'])
                attempt.assert_not_called()

    def exercise(self, default_capable=True, alt_capable=False, alt_version='3.4.0', primary=None, cleanup='PASS', compare=False, select=True):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        base = Path(temporary.name); (base / '.github/native').mkdir(parents=True)
        worker = base / '.github/native/ios_r52_fixture_probe.cjs'; worker.write_bytes(b'fixed probe')
        brew = base / 'brew'; brew.write_text('present')
        state = {}; native = SimpleNamespace(ROOT=base, read=lambda: copy.deepcopy(state), save=lambda value: (state.clear(), state.update(copy.deepcopy(value))))
        default = {'path': '/usr/bin/openssl', 'sha256': 'a' * 64, 'bytes': 1}
        node = {'path': '/usr/bin/node', 'sha256': 'b' * 64, 'bytes': 1}
        alt = {'path': '/opt/homebrew/Cellar/openssl@3/3.4.0/bin/openssl', 'sha256': 'c' * 64, 'bytes': 1}
        def identity(path):
            resolved = os.readlink(path) if path.is_symlink() else str(path)
            return alt if path == brew or resolved == alt['path'] else node if path.name == 'node' else default
        def attempt(label, tool, *args): return {'candidate': label, 'capable': default_capable if label == 'default' else alt_capable,
            'command': {'process_group_cleanup': cleanup}, 'version': {'implementation': 'OpenSSL', 'version': alt_version}}
        def which(name):
            if name == 'node': return node['path']
            selected = Path(os.environ['PATH'].split(os.pathsep)[0]) / 'openssl'
            return str(selected) if selected.is_symlink() else default['path']
        old = os.environ['PATH']; seen = []
        with mock.patch.dict(os.environ, {'RUNNER_TEMP': str(base)}), mock.patch.object(m, 'BREW', brew), \
            mock.patch.object(m, 'identity', side_effect=identity), mock.patch.object(m.shutil, 'which', side_effect=which), \
            mock.patch.object(m.subprocess, 'check_output', return_value=b'fixed probe'), \
            mock.patch.object(m, 'owned_run', return_value=({'exit_code': 0, 'category': None, 'process_group_cleanup': 'PASS'}, b'v22.23.4\n')), \
            mock.patch.object(m, 'attempt', side_effect=attempt):
            try:
                with m.session(native, compare=compare, select=select) as value:
                    seen.append(value['selection'])
                    if not select: self.assertEqual(os.environ['PATH'], old)
                    if primary: raise primary
            except RuntimeError as error:
                if primary: self.assertIs(error, primary)
                elif cleanup == 'PASS' and (default_capable or alt_capable and alt_version.startswith('3.')): raise
            self.assertEqual(os.environ['PATH'], old)
        self.assertEqual(state[m.FIELD]['temporary_cleanup'], 'PASS')
        self.assertFalse(state[m.FIELD]['native_acceptance'])
        return state[m.FIELD], seen

    def test_default_pass_skips_alternative_and_path_restores_on_original_failure(self):
        value, seen = self.exercise(primary=RuntimeError('ORIGINAL'))
        self.assertEqual(seen, ['DEFAULT_CAPABLE']); self.assertEqual(len(value['attempts']), 1)

    def test_failed_default_and_actual_capable_openssl3_required_for_selection(self):
        value, seen = self.exercise(default_capable=False, alt_capable=True)
        self.assertEqual(seen, ['MEASURED_EXISTING_HOMEBREW_OPENSSL3']); self.assertEqual(len(value['attempts']), 2)
        value, seen = self.exercise(default_capable=False, alt_capable=False)
        self.assertEqual(value['status'], 'FAIL'); self.assertEqual(seen, [])

    def test_unknown_first_process_group_cleanup_blocks_alternative_and_native_session(self):
        value, seen = self.exercise(default_capable=False, alt_capable=True, cleanup='FAIL')
        self.assertEqual(value['status'], 'FAIL'); self.assertEqual(seen, [])
        self.assertEqual(len(value['attempts']), 1)
        value, seen = self.exercise(default_capable=False, alt_capable=True, alt_version='1.1.1')
        self.assertEqual(value['status'], 'FAIL'); self.assertEqual(seen, [])

    def test_fixture_only_compares_both_available_candidates_without_runtime_path_selection(self):
        value, seen = self.exercise(compare=True, select=False)
        self.assertEqual(len(value['attempts']), 2)
        self.assertEqual(seen, ['READINESS_ONLY_NO_RUNTIME_TOOL_SELECTION'])


if __name__ == '__main__': unittest.main()
