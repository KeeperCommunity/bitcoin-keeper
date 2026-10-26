"""Source, exact entrypoint and failure preservation controls; no native credit."""
from contextlib import contextmanager
import ast
import copy
import importlib.util
import json
import marshal
import os
from pathlib import Path
import subprocess
import struct
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import yaml

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('ios_security_fixture_phase', ROOT / '.github/native/ios_security_fixture_phase.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def git(root, *args):
    return subprocess.check_output(['git', '-c', 'user.name=Host source fixture',
        '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', *args], cwd=root,
        stderr=subprocess.DEVNULL).decode().strip()


class FixturePhase(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for name in m.FILES:
            target = self.root / '.github/native' / name; target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((ROOT / '.github/native' / name).read_bytes())
        git(self.root, 'init', '-q'); git(self.root, 'add', '.'); git(self.root, 'commit', '-qm', 'Synthetic host fixture')
        self.source = git(self.root, 'rev-parse', 'HEAD')
        self.state = dict(source_sha=self.source, run_id='999', run_attempt='1', build='PASS', smoke='PASS',
                          r52_tls_native=dict(status='NOT RUN'), signing='NOT RUN')
        self.native = SimpleNamespace(ROOT=self.root, PLATFORM='IOS',
            read=lambda: copy.deepcopy(self.state), save=lambda value: (self.state.clear(), self.state.update(copy.deepcopy(value))))
        self.env = patch.dict(os.environ, KEEPER_SOURCE_SHA=self.source, GITHUB_RUN_ID='999', GITHUB_RUN_ATTEMPT='1')
        self.env.start(); self.addCleanup(self.env.stop)

    def fixture(self, code=0, category=None, late_failure=False, setup_failure=False):
        @contextmanager
        def session(native):
            self.assertIs(native, self.native)
            self.state['fixture_readiness'] = dict(status='FAIL' if setup_failure else 'PASS', native_acceptance=False,
                selected_tool=dict(path='/fixed/openssl', sha256='a' * 64), node=dict(path='/fixed/node', sha256='b' * 64))
            if setup_failure:
                raise RuntimeError('REJECTED')
            try:
                yield self.state['fixture_readiness']
            finally:
                self.state['fixture_readiness']['temporary_cleanup'] = 'FAIL' if late_failure else 'PASS'
                if late_failure:
                    raise RuntimeError('CLEANUP_REJECTED')
        def child(root, phase):
            self.assertEqual(root, self.root); self.assertIn(phase, m.PHASES)
            self.assertEqual(os.environ['PYTHONPYCACHEPREFIX'], os.devnull)
            self.assertEqual(os.environ['PYTHONDONTWRITEBYTECODE'], '1')
            self.state['r52_tls_native'] = dict(status='FAIL' if code else 'NOT RUN', cleanup='PASS')
            return dict(exit_code=code, category=category, cleanup='ORIGINAL_PHASE_OWNS_CLEANUP_NO_WRAPPER_CREDIT')
        runner = unittest.mock.Mock(side_effect=child)
        replacement = patch.object(m, 'original_phase', runner); replacement.start(); self.addCleanup(replacement.stop)
        return SimpleNamespace(session=session, original_phase=runner, FIELD='fixture_readiness',
            identity=lambda path: dict(path=str(path), sha256=('a' if path.name == 'openssl' else 'b') * 64),
            shutil=SimpleNamespace(which=lambda name: '/fixed/' + name))

    def test_three_exact_original_entrypoints_and_no_readiness_native_promotion(self):
        expected = {'tls': ('hosted_native.py', 'tls'), 'realm109': ('r52_realm109_native.py',),
                    'trust-ui': ('product_measurements.py', 'run')}
        self.assertEqual(m.PHASES, expected)
        for phase, entrypoint in expected.items():
            fixture = self.fixture()
            self.assertEqual(m.execute(self.native, phase, fixture), 0)
            self.assertEqual(fixture.original_phase.call_args.args, (self.root, phase))
            record = self.state['ios_security_fixture_toolchain'][phase]
            self.assertFalse(record['native_acceptance']); self.assertEqual(self.state['r52_tls_native']['status'], 'NOT RUN')
            self.assertEqual(self.state['build'], 'PASS'); self.assertEqual(self.state['signing'], 'NOT RUN')
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(self.state))

    def test_original_nonzero_exit_and_native_failure_survive_late_cleanup_failure(self):
        for late in (False, True):
            fixture = self.fixture(code=17, late_failure=late)
            self.assertEqual(m.execute(self.native, 'tls', fixture), 17)
            self.assertEqual(self.state['r52_tls_native']['status'], 'FAIL')
            record = self.state['ios_security_fixture_toolchain']['tls']
            self.assertEqual(record['command']['exit_code'], 17)
            self.assertEqual(record['readiness']['temporary_cleanup'], 'FAIL' if late else 'PASS')


    def test_capability_rejection_does_not_start_native_or_replace_existing_failure(self):
        self.state['r52_tls_native'] = dict(status='FAIL', cause='ORIGINAL')
        fixture = self.fixture(setup_failure=True)
        with self.assertRaisesRegex(RuntimeError, 'REJECTED'):
            m.execute(self.native, 'tls', fixture)
        fixture.original_phase.assert_not_called()
        self.assertEqual(self.state['r52_tls_native'], dict(status='FAIL', cause='ORIGINAL'))

    def test_absent_fixed_homebrew_alternative_stops_after_failed_default_measurement(self):
        fixture = m.load('ios_r52_fixture_diagnostic')
        failed = dict(candidate='default', capable=False,
            command=dict(exit_code=1, category=None, process_group_cleanup='PASS'),
            probe=dict(readiness='FAIL', error_category='OPENSSL_OPTION_UNSUPPORTED'))
        before = os.environ['PATH']
        with patch.dict(os.environ, RUNNER_TEMP=str(self.root)), \
             patch.object(fixture, 'BREW', self.root / 'absent-fixed-homebrew-openssl'), \
             patch.object(fixture, 'attempt', return_value=failed) as attempt:
            with self.assertRaises(RuntimeError):
                with fixture.session(self.native):
                    self.fail('Unsupported default without the fixed existing alternative cannot enter native work')
        self.assertEqual(attempt.call_count, 1)
        record = self.state[fixture.FIELD]
        self.assertEqual(record['status'], 'FAIL')
        self.assertEqual(record['alternative'], 'FIXED_EXISTING_HOMEBREW_OPENSSL3_ABSENT')
        self.assertEqual(record['temporary_cleanup'], 'PASS'); self.assertEqual(os.environ['PATH'], before)

    def test_original_child_mutation_is_rejected_by_post_phase_raw_source_check(self):
        fixture = self.fixture()
        original = fixture.original_phase.side_effect
        def mutate(*args):
            outcome = original(*args)
            target = self.root / '.github/native/ios_r52_fixture_probe.cjs'
            target.write_bytes(target.read_bytes() + b'\n// changed during native phase\n')
            return outcome
        fixture.original_phase.side_effect = mutate
        with self.assertRaises(RuntimeError): m.execute(self.native, 'tls', fixture)
        self.assertEqual(self.state['ios_security_fixture_toolchain']['tls']['wrapper_failure'],
                         'SESSION_SOURCE_TOOL_OR_ORIGINAL_PHASE_FAILURE')

    def test_after_child_tool_identity_or_resolution_change_rejects_zero_and_preserves_nonzero(self):
        for code in (0, 17):
            for kind in ('bytes', 'resolution'):
                fixture = self.fixture(code=code); original = fixture.original_phase.side_effect
                def mutate(*args):
                    result = original(*args)
                    if kind == 'bytes': fixture.identity = lambda path: dict(path=str(path), sha256='0' * 64)
                    else: fixture.shutil.which = lambda name: '/changed/' + name
                    return result
                fixture.original_phase.side_effect = mutate
                if code:
                    self.assertEqual(m.execute(self.native, 'tls', fixture), code)
                else:
                    with self.assertRaises(RuntimeError): m.execute(self.native, 'tls', fixture)
                self.assertEqual(self.state['ios_security_fixture_toolchain']['tls']['tool_identity_after'], 'FAIL')

    def test_successful_child_cannot_hide_late_session_cleanup_error(self):
        with self.assertRaisesRegex(RuntimeError, 'CLEANUP_REJECTED'):
            m.execute(self.native, 'tls', self.fixture(late_failure=True))

    def test_original_nonzero_exit_also_wins_when_wrapper_metadata_save_fails(self):
        with patch.object(self.native, 'save', side_effect=RuntimeError('SAVE_FAILED')):
            self.assertEqual(m.execute(self.native, 'tls', self.fixture(code=17)), 17)
            with self.assertRaisesRegex(RuntimeError, 'SAVE_FAILED'):
                m.execute(self.native, 'tls', self.fixture(code=0))

    def test_dynamic_exception_name_is_not_exported_in_wrapper_metadata(self):
        fixture = self.fixture()
        fixture.original_phase.side_effect = type('PRIVATE_SENTINEL_CLASS', (BaseException,), {})()
        self.assertEqual(m.execute(self.native, 'tls', fixture), 1)
        record = self.state['ios_security_fixture_toolchain']['tls']
        self.assertEqual(record['command']['exception_type'], 'OTHER_EXCEPTION')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(record))

    def test_source_guard_checks_actual_raw_bytes_even_when_git_index_hides_change(self):
        m.source_guard(self.root, self.source)
        target = self.root / '.github/native/ios_r52_fixture_diagnostic.py'
        git(self.root, 'update-index', '--assume-unchanged', '.github/native/ios_r52_fixture_diagnostic.py')
        target.write_bytes(target.read_bytes() + b'\n# hidden change\n')
        self.assertEqual(git(self.root, 'diff'), '')
        with self.assertRaises(RuntimeError): m.source_guard(self.root, self.source)

    def test_missing_worker_alias_or_wrong_source_reject_before_tool_resolution(self):
        for source in ['moving-branch', '0' * 40]:
            with self.assertRaises(RuntimeError): m.source_guard(self.root, source)
        target = self.root / '.github/native/ios_r52_fixture_probe.cjs'
        original = target.read_bytes(); target.unlink()
        with self.assertRaises(RuntimeError): m.source_guard(self.root, self.source)
        foreign = self.root / 'foreign.cjs'; foreign.write_bytes(original); target.symlink_to(foreign)
        with self.assertRaises(RuntimeError): m.source_guard(self.root, self.source)
        self.assertEqual(foreign.read_bytes(), original)

    def test_each_original_entrypoint_hidden_index_mutation_and_same_bytes_alias_are_rejected(self):
        for name in m.ENTRYPOINTS:
            target = self.root / '.github/native' / name; original = target.read_bytes()
            git(self.root, 'update-index', '--assume-unchanged', '.github/native/' + name)
            target.write_bytes(original + b'\n# hidden original entrypoint mutation\n')
            self.assertEqual(git(self.root, 'diff'), '')
            with self.assertRaises(RuntimeError): m.source_guard(self.root, self.source)
            target.unlink(); foreign = self.root / name; foreign.write_bytes(original); target.symlink_to(foreign)
            with self.assertRaises(RuntimeError): m.source_guard(self.root, self.source)
            self.assertEqual(foreign.read_bytes(), original)
            target.unlink(); target.write_bytes(original)
        m.source_guard(self.root, self.source)

    def test_android_and_unknown_phase_cannot_load_fixture_or_change_path(self):
        fixture = self.fixture(); before = os.environ['PATH']
        self.native.PLATFORM = 'ANDROID'
        with self.assertRaises(RuntimeError): m.execute(self.native, 'tls', fixture)
        self.native.PLATFORM = 'IOS'
        with self.assertRaises(RuntimeError): m.execute(self.native, 'shell', fixture)
        self.assertEqual(os.environ['PATH'], before); fixture.original_phase.assert_not_called()
        with patch.object(m.sys, 'argv', ['wrapper', 'tls']), patch.dict(os.environ, KEEPER_NATIVE_PLATFORM='ANDROID'), patch.object(m, 'load') as load:
            with self.assertRaises(RuntimeError): m.main()
            load.assert_not_called()
        for arguments in [['wrapper', 'shell'], ['wrapper', 'tls', 'arbitrary-command']]:
            with patch.object(m.sys, 'argv', arguments), patch.dict(os.environ, KEEPER_NATIVE_PLATFORM='IOS'), patch.object(m, 'load') as load:
                with self.assertRaises(RuntimeError): m.main()
                load.assert_not_called()

    def test_current_source_metadata_cannot_be_borrowed(self):
        for field in ['source_sha', 'run_id', 'run_attempt']:
            original = self.state[field]; self.state[field] = 'wrong'
            with self.assertRaises(RuntimeError): m.execute(self.native, 'tls', self.fixture())
            self.state[field] = original

    def test_only_existing_ios_workflow_entrypoints_wrap_android_originals_stay_direct(self):
        workflow = yaml.safe_load((ROOT / '.github/workflows/keeper-native-platform.yml').read_text())
        self.assertEqual(workflow['jobs']['native']['timeout-minutes'], "${{ inputs.platform == 'IOS' && 240 || 120 }}")
        self.assertEqual(m.OUTER_PHASE_SECONDS, 240 * 60)
        steps = workflow['jobs']['native']['steps']
        wrapped = [step for step in steps if 'ios_security_fixture_phase.py' in step.get('run', '')]
        self.assertEqual(len(wrapped), 3)
        self.assertEqual([step['run'].strip().splitlines()[-1] for step in wrapped],
            ['python3 .github/native/ios_security_fixture_phase.py tls',
             'python3 .github/native/ios_security_fixture_phase.py realm109',
             'python3 .github/native/ios_security_fixture_phase.py trust-ui'])
        for step in wrapped:
            self.assertEqual(step['if'], "inputs.platform == 'IOS' && !inputs.prepare_only")
            self.assertFalse(step.get('continue-on-error', False))
        self.assertIn('git diff --exit-code HEAD -- .github/native .github/workflows', wrapped[-1]['run'])
        android = next(step for step in steps if step['name'] == 'Run Android startup persistence worker TLS Realm trust and product flows')
        self.assertNotIn('ios_security_fixture_phase', android['with']['script'])
        for command in ['hosted_native.py tls', 'r52_realm109_native.py', 'product_measurements.py run']:
            self.assertIn(command, android['with']['script'])



class OriginalSourceCLI(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name); (self.root / '.github/native').mkdir(parents=True)

    def script(self, phase, source):
        target = self.root / '.github/native' / m.PHASES[phase][0]
        target.write_text(source)
        return target

    def test_actual_original_hosted_main_run_phase_tls_functions_keep_main_module_and_finally(self):
        raw = (ROOT / '.github/native/hosted_native.py').read_text(); parsed = ast.parse(raw)
        functions = '\n\n'.join(ast.get_source_segment(raw, node) for node in parsed.body
            if isinstance(node, ast.FunctionDef) and node.name in ['tls', 'main', 'run_phase'])
        self.script('tls', '''import importlib.util,json,os,sys
from pathlib import Path
PLATFORM='IOS'; APP_IDS={'IOS':'host-source-fixture'}; EVIDENCE=Path(__file__).with_name('absent-metadata')
def finish_ios_actual_install():
    Path(__file__).with_name('original-finally').write_text('RAN')
''' + functions + "\nif __name__=='__main__': main()\n")
        driver = self.root / '.github/native/r52_tls_native.py'
        driver.write_text('''import json,os,sys
from pathlib import Path
def run(h):
    assert h is sys.modules['__main__']
    assert h.__name__=='__main__'
    assert sys.dont_write_bytecode and sys.pycache_prefix==os.devnull
    assert os.environ['PYTHONPYCACHEPREFIX']==os.devnull
    Path(__file__).with_name('binding').write_text(json.dumps(dict(pid=os.getpid(),argv=sys.argv)))
''')
        # A valid ordinary cache would otherwise outrank these exact source
        # bytes. The production /dev/null prefix must prevent reading it.
        cache = driver.parent / '__pycache__' / ('r52_tls_native.' + m.sys.implementation.cache_tag + '.pyc')
        cache.parent.mkdir()
        poisoned = (importlib.util.MAGIC_NUMBER + struct.pack('<III', 0, int(driver.stat().st_mtime), driver.stat().st_size) +
            marshal.dumps(compile("raise RuntimeError('POISONED_CACHE_EXECUTED')", str(driver), 'exec')))
        cache.write_bytes(poisoned)
        before_argv = m.sys.argv; before_main = m.sys.modules['__main__']
        with patch.dict(os.environ):
            result = m.original_phase(self.root, 'tls')
        self.assertEqual(result['exit_code'], 0)
        binding = json.loads(driver.with_name('binding').read_text())
        self.assertEqual(binding, dict(pid=os.getpid(), argv=[str(driver.with_name('hosted_native.py')), 'tls']))
        self.assertEqual(driver.with_name('original-finally').read_text(), 'RAN')
        self.assertIs(m.sys.argv, before_argv); self.assertIs(m.sys.modules['__main__'], before_main)
        self.assertEqual(result['cleanup'], 'ORIGINAL_PHASE_OWNS_CLEANUP_NO_WRAPPER_CREDIT')
        self.assertEqual(cache.read_bytes(), poisoned)
        self.assertEqual(list(self.root.rglob('*.pyc')), [cache])

    def test_each_fixed_original_cli_argv_and_exit_restore_on_systemexit_and_exception(self):
        before_argv = m.sys.argv; before_main = m.sys.modules['__main__']
        for phase in m.PHASES:
            path = self.script(phase, "import json,sys\nfrom pathlib import Path\ntry:\n    Path(__file__).with_suffix('.argv').write_text(json.dumps(sys.argv))\n    raise SystemExit(17)\nfinally:\n    Path(__file__).with_suffix('.finally').write_text('RAN')\n")
            result = m.original_phase(self.root, phase)
            self.assertEqual(result['exit_code'], 17)
            self.assertEqual(json.loads(path.with_suffix('.argv').read_text()), [str(path), *m.PHASES[phase][1:]])
            self.assertEqual(path.with_suffix('.finally').read_text(), 'RAN')
            self.assertIs(m.sys.argv, before_argv); self.assertIs(m.sys.modules['__main__'], before_main)
        self.script('tls', "try:\n    raise RuntimeError('PRIVATE_SENTINEL')\nfinally:\n    pass\n")
        result = m.original_phase(self.root, 'tls')
        self.assertEqual(result['exit_code'], 1); self.assertEqual(result['exception_type'], 'RuntimeError')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result)); self.assertIs(m.sys.argv, before_argv)
        self.assertIs(m.sys.modules['__main__'], before_main)

    def test_original_interrupt_and_dynamic_exception_preserve_cleanup_and_finite_metadata(self):
        for statement, code, kind in [
                ('raise KeyboardInterrupt()', 130, 'KeyboardInterrupt'),
                ("raise type('PRIVATE_SENTINEL_CLASS', (BaseException,), {})()", 1, 'OTHER_EXCEPTION')]:
            with self.subTest(code=code, kind=kind):
                path = self.script('tls', "from pathlib import Path\ntry:\n    " + statement +
                    "\nfinally:\n    Path(__file__).with_suffix('.finally').write_text('RAN')\n")
                before_argv = m.sys.argv; before_main = m.sys.modules['__main__']
                result = m.original_phase(self.root, 'tls')
                self.assertEqual(result['exit_code'], code)
                self.assertEqual(result['exception_type'], kind)
                self.assertEqual(path.with_suffix('.finally').read_text(), 'RAN')
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
                self.assertIs(m.sys.argv, before_argv); self.assertIs(m.sys.modules['__main__'], before_main)

    def test_real_over_16k_stdout_and_stderr_are_inherited_without_child_or_output_gate(self):
        self.script('tls', "import os\nos.write(1,b'O'*65536)\nos.write(2,b'E'*65536)\n")
        source = ROOT / '.github/native/ios_security_fixture_phase.py'
        script = '''import importlib.util,json,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('native_stdio_control',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
value=m.original_phase(Path(sys.argv[2]),'tls')
print('\\nFACTS:'+json.dumps(value))
'''
        child = subprocess.run([m.sys.executable, '-B', '-c', script, str(source), str(self.root)],
            capture_output=True, timeout=15, check=True)
        output, facts = child.stdout.split(b'\nFACTS:')
        self.assertEqual(output, b'O' * 65536); self.assertEqual(child.stderr, b'E' * 65536)
        result = json.loads(facts); self.assertEqual(result['exit_code'], 0)
        self.assertEqual(result['execution'], 'IN_PROCESS_ORIGINAL_SOURCE_CLI')
        self.assertEqual(result['stdio'], 'INHERITED_ORIGINAL_CLI_NO_OUTPUT_LIMIT')
        self.assertNotIn('process_group_cleanup', result)

    def test_real_systemexit_nonzero_wins_session_and_metadata_failure_and_zero_is_blocked(self):
        # Execute the real source CLI inside the phase wrapper, rather than a
        # mocked runner, while retaining only the fixed host fixture session.
        fixture_case = FixturePhase('test_three_exact_original_entrypoints_and_no_readiness_native_promotion')
        fixture_case.setUp()
        try:
            for code in (17, 0):
                path = fixture_case.root / '.github/native/hosted_native.py'
                path.write_text('raise SystemExit(' + str(code) + ')\n')
                git(fixture_case.root, 'add', '.github/native/hosted_native.py')
                git(fixture_case.root, 'commit', '-qm', 'Synthetic original CLI SystemExit control')
                fixture_case.source = git(fixture_case.root, 'rev-parse', 'HEAD')
                fixture_case.state['source_sha'] = fixture_case.source
                os.environ['KEEPER_SOURCE_SHA'] = fixture_case.source
                for late in (False, True):
                    fixture = fixture_case.fixture(late_failure=late)
                    with patch.object(m, 'original_phase', OriginalSourceCLI.real_original_phase), \
                         patch.object(fixture_case.native, 'save', side_effect=RuntimeError('SAVE_FAILED')):
                        if code:
                            self.assertEqual(m.execute(fixture_case.native, 'tls', fixture), code)
                        else:
                            with self.assertRaises(RuntimeError): m.execute(fixture_case.native, 'tls', fixture)
        finally:
            fixture_case.doCleanups()

    real_original_phase = staticmethod(m.original_phase)


if __name__ == '__main__': unittest.main()
