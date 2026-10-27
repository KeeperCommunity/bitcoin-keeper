"""Actual tiny child processes plus synthetic producer identity/projection controls."""
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import types
import unittest
from contextlib import redirect_stdout
from unittest import mock

NATIVE = Path(__file__).resolve().parents[1] / 'native'


def load(name):
    spec = importlib.util.spec_from_file_location('compile_test_' + name, NATIVE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CompileProducerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='keeper-compile-control-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'package.json').write_text(json.dumps({'dependencies': {'react-native': '0.83.1'}}))
        self.h, self.p = load('hosted_native'), load('android_compile_producer')
        self.patch = mock.patch.multiple(self.h, ROOT=self.root, PRIVATE=self.root / 'private',
            EVIDENCE=self.root / 'evidence.json', PLATFORM='ANDROID')
        self.patch.start(); self.addCleanup(self.patch.stop)
        self.env = mock.patch.dict(os.environ, KEEPER_ANDROID_CUSTODY_ROLE='producer')
        self.env.start(); self.addCleanup(self.env.stop)
        self.bound = dict(source_sha='a' * 40, workflow_sha='b' * 40, run_id=17, run_attempt=1)
        self.reset()

    def reset(self):
        self.h.save(dict(schema=1, platform='ANDROID', source_sha=self.bound['source_sha'],
            workflow_sha=self.bound['workflow_sha'], run_id='17', run_attempt='1', commands=[],
            build='NOT RUN', smoke='NOT RUN', native_probe='NOT RUN', r5_features='NOT RUN'))

    def child(self, text, timeout=2):
        return self.h.command([sys.executable, '-c', text], self.p.BUILD, timeout=timeout)

    def declare_synthetic_full_budget(self):
        data = self.h.read()
        # Actual tiny-child process outcome; only this test's declared budget is synthetic.
        data['commands'][-1]['timeout_seconds'] = 3000
        data['commands'][-1]['android_compile_process']['budget_seconds'] = 3000
        self.h.save(data)

    def test_real_child_success_and_failure_are_distinct(self):
        self.child('raise SystemExit(0)')
        success = self.h.read()['commands'][-1]
        self.assertEqual(success['android_compile_process']['termination'], 'CHILD_EXIT')
        self.assertEqual(success['android_compile_process']['child_exit_code'], 0)
        self.assertEqual(success['android_compile_process']['cleanup'], 'OWNED_CHILD_REAPED')
        self.reset()
        with self.assertRaises(RuntimeError): self.child('raise SystemExit(7)')
        failure = self.h.read()['commands'][-1]
        self.assertEqual(failure['exit_code'], 7)
        self.assertEqual(failure['android_compile_process']['child_exit_code'], 7)

    def test_real_timeout_is_recorded_and_foreign_child_survives(self):
        foreign = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(20)'], start_new_session=True)
        try:
            with self.assertRaises(RuntimeError): self.child('import time; time.sleep(20)', timeout=0.05)
            row = self.h.read()['commands'][-1]
            self.assertEqual(row['exit_code'], 124)
            self.assertEqual(row['android_compile_process']['termination'], 'COMMAND_TIMEOUT')
            self.assertEqual(row['android_compile_process']['child_exit_code'], -signal.SIGKILL)
            self.assertIsNone(foreign.poll())
        finally:
            foreign.kill(); foreign.wait(timeout=5)

    def test_real_child_signal_is_not_a_timeout(self):
        with self.assertRaises(RuntimeError): self.child('import os,signal;os.kill(os.getpid(),signal.SIGTERM)')
        observed = self.h.read()['commands'][-1]['android_compile_process']
        self.assertEqual(observed['termination'], 'CHILD_SIGNAL')
        self.assertEqual(observed['child_exit_code'], -signal.SIGTERM)

    def test_real_host_sigterm_records_interruption_and_reaps_owned_child(self):
        ready = self.root / 'ready'
        script = self.root / 'host.py'
        script.write_text('import importlib.util,pathlib,sys\n'
            f's=importlib.util.spec_from_file_location("h",{str(NATIVE / "hosted_native.py")!r})\n'
            'h=importlib.util.module_from_spec(s);s.loader.exec_module(h)\n'
            f'h.ROOT=pathlib.Path({str(self.root)!r});h.PRIVATE=h.ROOT/"private";h.EVIDENCE=h.ROOT/"evidence.json";h.PLATFORM="ANDROID"\n'
            f'h.command([sys.executable,"-c",{("import pathlib,time;pathlib.Path(" + repr(str(ready)) + ").write_text(\"ready\");time.sleep(20)")!r}],"{self.p.BUILD}",timeout=20)\n')
        host = subprocess.Popen([sys.executable, str(script)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 5
            while not ready.exists() and time.monotonic() < deadline: time.sleep(0.01)
            self.assertTrue(ready.exists())
            host.send_signal(signal.SIGTERM)
            host.communicate(timeout=10)
            self.assertEqual(host.returncode, 143)
            observed = self.h.read()['commands'][-1]['android_compile_process']
            self.assertEqual(observed['termination'], 'HOST_SIGNAL')
            self.assertEqual(observed['host_signal'], signal.SIGTERM)
            self.assertEqual(observed['cleanup'], 'OWNED_CHILD_REAPED')
        finally:
            if host.poll() is None: host.kill(); host.communicate(timeout=5)

    def test_projection_and_log_keep_only_fixed_facts(self):
        self.child('print("> Task :app:compileDevelopmentDebugKotlin");print("PRIVATE_SENTINEL https://private.invalid/token")')
        self.declare_synthetic_full_budget()
        data = self.h.read(); data['build'] = 'PASS'; self.h.save(data)
        result = self.p.projection(self.h, self.bound, 'success')
        self.assertEqual(result['build'], 'PASS')
        self.assertEqual(result['progress']['last_fixed_task']['task'], ':app:compileDevelopmentDebugKotlin')
        result['command']['PRIVATE_SENTINEL'] = 'not forwarded from metadata'
        data = self.h.read(); data['commands'][-1]['android_compile_process']['PRIVATE_SENTINEL'] = 'private'
        self.h.save(data)
        result = self.p.projection(self.h, self.bound, 'success')
        output = io.StringIO()
        with redirect_stdout(output): self.p.emit(self.h, result, initial=True)
        self.assertNotIn('PRIVATE_SENTINEL', output.getvalue())
        self.assertNotIn('private.invalid', output.getvalue())
        self.assertFalse(result['native_acceptance'])

    def test_stale_source_attempt_and_budget_reject(self):
        self.child('raise SystemExit(0)'); self.declare_synthetic_full_budget()
        original = self.h.read()
        for field, value in [('source_sha', 'c' * 40), ('run_attempt', '2')]:
            data = copy.deepcopy(original); data[field] = value; self.h.save(data)
            with self.assertRaises(ValueError): self.p.projection(self.h, self.bound)
        data = copy.deepcopy(original); data['commands'][-1]['timeout_seconds'] = 9999; self.h.save(data)
        with self.assertRaises(ValueError): self.p.projection(self.h, self.bound)

    def test_apparent_pass_requires_successful_reaped_compiler(self):
        self.child('raise SystemExit(0)'); self.declare_synthetic_full_budget()
        data = self.h.read(); data['build'] = 'PASS'
        data['commands'][-1]['android_compile_process']['termination'] = 'COMMAND_TIMEOUT'; self.h.save(data)
        with self.assertRaises(ValueError): self.p.projection(self.h, self.bound)

    def test_missing_compiler_row_cannot_export_compile_pass(self):
        data = self.h.read(); data['build'] = 'PASS'; self.h.save(data)
        with self.assertRaises(ValueError): self.p.projection(self.h, self.bound)

    def test_secondary_observation_failure_preserves_original_build_error(self):
        error = RuntimeError('ORIGINAL_SYNTHETIC_BUILD_FAILURE')
        with mock.patch.object(self.p, 'identity', return_value=self.bound), \
                mock.patch.object(self.h, 'run_phase', side_effect=error), \
                mock.patch.object(self.p, 'emit', side_effect=[None, OSError('SYNTHETIC_WRITE_FAILURE')]):
            with self.assertRaises(RuntimeError) as found: self.p.build(self.h, {})
        self.assertIs(found.exception, error)

    def test_failed_step_cannot_export_a_pass(self):
        self.child('raise SystemExit(0)'); self.declare_synthetic_full_budget()
        data = self.h.read(); data['build'] = 'PASS'; self.h.save(data)
        self.assertEqual(self.p.projection(self.h, self.bound, 'failure')['build'], 'FAIL')

    def test_stale_or_linked_output_rejected_without_touching_foreign_bytes(self):
        result = self.p.projection(self.h, self.bound)
        with redirect_stdout(io.StringIO()): self.p.emit(self.h, result, initial=True)
        output = self.root / self.p.OUTPUT
        other = self.root / 'foreign.json'; other.write_text('FOREIGN_SENTINEL')
        output.unlink(); output.hardlink_to(other)
        with self.assertRaises(ValueError): self.p.emit(self.h, result)
        self.assertEqual(other.read_text(), 'FOREIGN_SENTINEL')


if __name__ == '__main__': unittest.main()
