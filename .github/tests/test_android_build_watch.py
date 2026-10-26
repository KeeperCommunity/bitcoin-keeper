"""Real disposable subprocess/source tests; no Gradle, Android SDK or network."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

NATIVE = Path(__file__).resolve().parents[1] / 'native'
SPEC = importlib.util.spec_from_file_location('android_watch_test', NATIVE / 'android_build_watch.py')
watch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(watch)

STUB = '''import json, os, pathlib, time, sys
root = pathlib.Path.cwd()
private = pathlib.Path(os.environ['RUNNER_TEMP']) / 'keeper-native-private'
private.mkdir(exist_ok=True)
metadata = root / 'artifacts/native/android/metadata.json'
metadata.parent.mkdir(parents=True, exist_ok=True)
metadata.write_text(json.dumps({'source_sha': os.environ['KEEPER_SOURCE_SHA'],
 'commands': [{'label': 'Build debug-key-only development APK'}]}))
log = private / 'command-001.log'
log.write_text('> Task :app:configureCMakeDebug[x86_64]\\nPRIVATE_SENTINEL arbitrary wallet data\\n')
(root / 'child.pid').write_text(str(os.getpid()))
time.sleep(float(os.environ.get('STUB_SECONDS', '0.18')))
with log.open('a') as target: target.write('> Task :app:buildCMakeDebug[x86_64]\\n')
raise SystemExit(int(os.environ.get('STUB_EXIT', '0')))
'''


class BuildWatchTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.root, self.temporary = base / 'app', base / 'runner'
        self.root.mkdir()
        self.temporary.mkdir()
        native = self.root / '.github/native'
        native.mkdir(parents=True)
        (native / 'android_build_watch.py').write_bytes((NATIVE / 'android_build_watch.py').read_bytes())
        (native / 'android_build_failure.py').write_bytes((NATIVE / 'android_build_failure.py').read_bytes())
        (native / 'hosted_native.py').write_text(STUB)
        (self.root / 'package.json').write_text('{"dependencies":{"react-native":"0.80.1"}}\n')
        self.git('init', '-q')
        self.git('add', '.')
        self.git('-c', 'user.name=Watch Test', '-c', 'user.email=watch@example.invalid',
                 'commit', '-qm', 'synthetic build source')
        self.sha = self.git('rev-parse', 'HEAD').strip()
        event = self.temporary / 'event.json'
        self.event = {'repository': {'id': 839671816, 'private': True},
            'pull_request': {'number': 73, 'head': {'sha': self.sha, 'repo': {'id': 839671816}}}}
        event.write_text(json.dumps(self.event))
        self.env = {**os.environ, 'GITHUB_ACTIONS': 'true', 'GITHUB_EVENT_NAME': 'pull_request',
            'GITHUB_REPOSITORY': watch.REPO, 'GITHUB_REPOSITORY_ID': '839671816',
            'RUNNER_ENVIRONMENT': 'github-hosted', 'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64',
            'ImageOS': 'ubuntu24', 'KEEPER_NATIVE_PLATFORM': 'ANDROID', 'KEEPER_DIAGNOSTIC': 'true',
            'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_WORKSPACE': str(self.root),
            'GITHUB_WORKFLOW_REF': watch.REPO + '/.github/workflows/keeper-native-diagnostic.yml@refs/pull/73/merge',
            'GITHUB_WORKFLOW_SHA': 'b' * 40, 'KEEPER_SOURCE_SHA': self.sha,
            'GITHUB_RUN_ID': '12345', 'GITHUB_EVENT_PATH': str(event), 'RUNNER_TEMP': str(self.temporary),
            'PYTHONDONTWRITEBYTECODE': '1'}
        self.policy = watch.policy_module(self.root)

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.DEVNULL, text=True)

    def fixture_log(self, raw):
        private = self.temporary / 'keeper-native-private'
        private.mkdir(exist_ok=True)
        metadata = self.root / 'artifacts/native/android/metadata.json'
        metadata.parent.mkdir(parents=True, exist_ok=True)
        metadata.write_text(json.dumps({'source_sha': self.sha,
            'commands': [{'label': watch.BUILD_LABEL}]}))
        path = private / 'command-001.log'
        path.write_bytes(raw)
        return path

    def test_real_child_preserves_success_and_emits_only_source_bound_bounded_facts(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = watch.run(self.root, self.env, interval=0.04)
        self.assertEqual(code, 0)
        self.assertNotIn('PRIVATE_SENTINEL', output.getvalue())
        records = [json.loads(line.removeprefix('KEEPER_ANDROID_BUILD_OBSERVATION '))
                   for line in output.getvalue().splitlines()]
        self.assertEqual(records[0]['event'], 'START')
        self.assertEqual(records[-1]['event'], 'EXIT')
        self.assertEqual(records[-1]['child_exit_code'], 0)
        self.assertTrue(any(row['event'] == 'SAMPLE' for row in records))
        for row in records:
            self.assertEqual(row['source_sha'], self.sha)
            self.assertEqual(row['source_tree'], self.git('rev-parse', 'HEAD^{tree}').strip())
            self.assertFalse(row['native_acceptance'])
            self.assertLessEqual(row['progress']['sample_bytes'], watch.TAIL_BYTES)
            self.assertLessEqual(len(row['progress']['task_records']), 8)
        self.assertEqual(records[-1]['progress']['task_records'][-1]['task'], ':app:buildCMakeDebug[x86_64]')

    def test_real_child_failure_is_not_changed_to_success(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(watch.run(self.root, {**self.env, 'STUB_EXIT': '17'}, interval=0.05), 17)

    def test_wrong_context_or_source_rejects_before_child_launch(self):
        for key, value in [('GITHUB_REPOSITORY_ID', '1'), ('KEEPER_SOURCE_SHA', 'a' * 40),
            ('GITHUB_EVENT_NAME', 'push'), ('KEEPER_DIAGNOSTIC', 'false'),
            ('GITHUB_RUN_ATTEMPT', '2'), ('ImageOS', 'ubuntu26')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                watch.run(self.root, {**self.env, key: value})
        self.assertFalse((self.root / 'child.pid').exists())

    def test_public_event_rejects_before_child_launch(self):
        self.event['repository']['private'] = False
        Path(self.env['GITHUB_EVENT_PATH']).write_text(json.dumps(self.event))
        with self.assertRaises(ValueError):
            watch.run(self.root, self.env)
        self.assertFalse((self.root / 'child.pid').exists())

    def test_modified_observer_source_rejects_before_child_launch(self):
        with (self.root / '.github/native/android_build_failure.py').open('a') as output:
            output.write('\n# changed\n')
        with self.assertRaises(subprocess.CalledProcessError):
            watch.run(self.root, self.env)
        self.assertFalse((self.root / 'child.pid').exists())

    def test_unknown_and_private_log_text_never_reaches_projection(self):
        self.fixture_log(b'> Task :unlisted:PRIVATE_SENTINEL\nPRIVATE_SENTINEL wallet dump\n'
                         b'> Task :app:buildCMakeDebug[x86_64]\njava.lang.OutOfMemoryError: PRIVATE_SENTINEL\n')
        result = watch.progress(self.root, self.temporary, self.policy)
        self.assertEqual(result['state'], 'OBSERVED')
        self.assertEqual(result['task_records'], [{'task': ':app:buildCMakeDebug[x86_64]', 'state': 'HEADER_OBSERVED'}])
        self.assertEqual(result['signals'], ['JVM_MEMORY'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_bounded_tail_discards_cut_record(self):
        self.fixture_log(b'PRIVATE_SENTINEL' * 100 + b'\n> Task :app:assembleDevelopmentDebug\n')
        with mock.patch.object(watch, 'TAIL_BYTES', 64):
            result = watch.progress(self.root, self.temporary, self.policy)
        self.assertTrue(result['tail_only'])
        self.assertLessEqual(result['sample_bytes'], 64)
        self.assertEqual(result['task_records'][-1]['task'], ':app:assembleDevelopmentDebug')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_linked_log_is_not_read(self):
        path = self.fixture_log(b'> Task :app:assembleDevelopmentDebug\n')
        other = path.with_name('other.log')
        path.rename(other)
        path.symlink_to(other)
        self.assertEqual(watch.progress(self.root, self.temporary, self.policy)['state'], 'UNAVAILABLE')
        path.unlink()
        os.link(other, path)
        self.assertEqual(watch.progress(self.root, self.temporary, self.policy)['state'], 'UNAVAILABLE')

    def test_real_nested_command_session_is_reaped_and_unrelated_session_survives(self):
        implementation = self.root / '.github/native/hosted_native_impl.py'
        implementation.write_bytes((NATIVE / 'hosted_native.py').read_bytes())
        nested = self.root / 'nested.py'
        nested.write_text('import os, pathlib, signal, time\n'
            'signal.signal(signal.SIGTERM, signal.SIG_IGN)\n'
            'pathlib.Path("nested.pid").write_text(str(os.getpid()))\n'
            'time.sleep(60)\n')
        (self.root / '.github/native/hosted_native.py').write_text(
            'import hosted_native_impl as host\n'
            'import os, pathlib, sys\n'
            'pathlib.Path("child.pid").write_text(str(os.getpid()))\n'
            'host.save({"source_sha": os.environ["KEEPER_SOURCE_SHA"], "commands": []})\n'
            'host.command([sys.executable, "nested.py"], "Build debug-key-only development APK", timeout=2100)\n')
        self.git('add', '.')
        self.git('-c', 'user.name=Watch Test', '-c', 'user.email=watch@example.invalid',
                 'commit', '-qm', 'real nested command session')
        self.sha = self.git('rev-parse', 'HEAD').strip()
        self.env['KEEPER_SOURCE_SHA'] = self.sha
        self.event['pull_request']['head']['sha'] = self.sha
        Path(self.env['GITHUB_EVENT_PATH']).write_text(json.dumps(self.event))
        guard = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'],
            start_new_session=True)
        proc = subprocess.Popen([sys.executable, str(self.root / '.github/native/android_build_watch.py')],
            cwd=self.root, env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, start_new_session=True)
        nested_pid = None
        try:
            deadline = time.monotonic() + 10
            while not (self.root / 'nested.pid').exists() and time.monotonic() < deadline:
                if proc.poll() is not None:
                    break
                time.sleep(0.01)
            self.assertTrue((self.root / 'nested.pid').exists())
            child_pid = int((self.root / 'child.pid').read_text())
            nested_pid = int((self.root / 'nested.pid').read_text())
            self.assertEqual(os.getsid(nested_pid), nested_pid)
            self.assertEqual(os.getsid(child_pid), child_pid)
            self.assertNotEqual(os.getsid(nested_pid), os.getsid(child_pid))
            os.kill(proc.pid, signal.SIGTERM)
            output, error = proc.communicate(timeout=15)
            self.assertEqual(proc.returncode, 143, error)
            self.assertIn('"event": "SIGTERM"', output)
            self.assertIsNone(guard.poll())
            for pid in (child_pid, nested_pid):
                with self.assertRaises(ProcessLookupError):
                    os.kill(pid, 0)
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait(timeout=5)
            if nested_pid is not None:
                try:
                    os.kill(nested_pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            guard.terminate()
            guard.wait(timeout=5)
            proc.stdout.close()
            proc.stderr.close()

    def test_real_sigterm_records_termination_and_stops_only_owned_child(self):
        proc = subprocess.Popen([sys.executable, str(self.root / '.github/native/android_build_watch.py')],
            cwd=self.root, env={**self.env, 'STUB_SECONDS': '60'}, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, start_new_session=True)
        try:
            with selectors.DefaultSelector() as ready:
                ready.register(proc.stdout, selectors.EVENT_READ)
                self.assertTrue(ready.select(10))
                first = proc.stdout.readline()
            self.assertIn('"event": "START"', first)
            deadline = time.monotonic() + 3
            while not (self.root / 'child.pid').exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            child_pid = int((self.root / 'child.pid').read_text())
            os.kill(proc.pid, signal.SIGTERM)
            output, error = proc.communicate(timeout=15)
            self.assertEqual(proc.returncode, 143, error)
            self.assertIn('"event": "SIGTERM"', output)
            self.assertNotIn('PRIVATE_SENTINEL', first + output + error)
            with self.assertRaises(ProcessLookupError):
                os.kill(child_pid, 0)
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait(timeout=5)
            proc.stdout.close()
            proc.stderr.close()


if __name__ == '__main__':
    unittest.main()
