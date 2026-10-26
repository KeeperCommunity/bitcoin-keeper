"""Execute the actual workflow setup against real owned HTTP/Node children only."""
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / '.github/workflows/keeper-private-android-runtime-reuse.yml'
STEP = next(row for row in yaml.load(WORKFLOW.read_text(), Loader=yaml.BaseLoader)['jobs']['reuse']['steps']
            if row['name'] == 'Warm unchanged development bundle before emulator contention')
SCRIPT = '\n'.join(STEP['run'].splitlines()[1:-1])
SCOPE = 'REUSED_EXACT_ORIGINAL_PRIVATE_DEBUG_APK_NO_CURRENT_RUN_COMPILATION_OR_RELEASE'
STUB = '''import json, os, pathlib, urllib.request
ROOT = pathlib.Path.cwd()
PLATFORM = 'ANDROID'
PRIVATE = ROOT / 'private'
def read(): return json.loads((ROOT / 'state.json').read_text())
def save(value): (ROOT / 'state.json').write_text(json.dumps(value))
def warm_metro_bundle(suite):
    with urllib.request.urlopen('http://127.0.0.1:8081/index.bundle', timeout=3) as reply:
        raw = reply.read()
        if raw != b'SYNTHETIC_TEST_BUNDLE': raise RuntimeError('TEST_BUNDLE_REJECTED')
    value = read()
    value['metro_warmup'] = {'result': 'PASS', 'http_status': 200,
        'bytes': len(raw), 'sha256': 'b' * 64, 'duration_seconds': 0.01}
    save(value)
'''
SERVER = '''const http = require('node:http'), fs = require('node:fs');
fs.writeFileSync('node.pid', String(process.pid));
http.createServer((req, res) => {
  if (req.url === '/status') { res.end('packager-status:running'); return; }
  if (process.env.TEST_BUNDLE_FAIL === '1') { res.statusCode = 500; res.end('SYNTHETIC_FAILURE'); return; }
  res.end('SYNTHETIC_TEST_BUNDLE');
}).listen(8081, '127.0.0.1');
'''


class RuntimePrewarm(unittest.TestCase):
    def setUp(self):
        if shutil.which('node') is None:
            self.skipTest('Node is required for real owned HTTP process checks.')
        try:
            with socket.create_connection(('127.0.0.1', 8081), timeout=0.2):
                self.skipTest('Never touch an unrelated existing listener on fixed port8081.')
        except OSError:
            pass
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        native = self.root / '.github/native'
        native.mkdir(parents=True)
        (native / 'hosted_native.py').write_text(STUB)
        (native / 'product_metro.py').write_bytes((ROOT / '.github/native/product_metro.py').read_bytes())
        (native / 'startup_observer.cjs').write_text('module.exports = {};\n')
        cli = self.root / 'node_modules/react-native/cli.js'
        cli.parent.mkdir(parents=True)
        cli.write_text(SERVER)
        (self.root / 'private').mkdir()
        self.state = {'source_sha': 'a' * 40, 'build': 'PASS', 'build_execution_scope': SCOPE,
            **{key: 'NOT RUN' for key in ('smoke', 'native_probe', 'r5_features', 'hardware', 'signing')}}
        self.save()
        self.git('init', '-q')
        self.git('add', '.github')
        self.git('-c', 'user.name=Prewarm Test', '-c', 'user.email=prewarm@example.invalid',
                 'commit', '-qm', 'synthetic source-bound setup')
        self.addCleanup(self.stop_if_left)

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.DEVNULL)

    def save(self):
        (self.root / 'state.json').write_text(json.dumps(self.state))

    def stop_if_left(self):
        path = self.root / 'node.pid'
        if path.exists():
            pid = int(path.read_text())
            try:
                owner = Path('/proc') / str(pid)
                if (os.getsid(pid) == pid and (owner / 'cwd').resolve() == self.root and
                        b'node_modules/react-native/cli.js' in (owner / 'cmdline').read_bytes().split(b'\0')):
                    os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def run_setup(self, **updates):
        return subprocess.run([sys.executable, '-B', '-c', SCRIPT], cwd=self.root,
            env={**os.environ, 'KEEPER_SOURCE_SHA': 'a' * 40, **updates},
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=15)

    def assert_owned_gone(self):
        pid = int((self.root / 'node.pid').read_text())
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_actual_setup_preserves_all_gates_and_reaps_real_owned_server(self):
        outcome = self.run_setup()
        self.assertEqual(outcome.returncode, 0, outcome.stderr)
        value = json.loads((self.root / 'state.json').read_text())
        for key in ('smoke', 'native_probe', 'r5_features', 'hardware', 'signing'):
            self.assertEqual(value[key], 'NOT RUN')
        self.assertFalse(value['pre_emulator_bundle']['native_acceptance'])
        self.assertEqual(value['pre_emulator_bundle']['unchanged_request_timeout_seconds'], 240)
        self.assert_owned_gone()

    def test_failed_http_warmup_is_not_pass_and_still_reaps_owned_server(self):
        outcome = self.run_setup(TEST_BUNDLE_FAIL='1')
        self.assertNotEqual(outcome.returncode, 0)
        self.assertNotIn('pre_emulator_bundle', json.loads((self.root / 'state.json').read_text()))
        self.assert_owned_gone()

    def test_dirty_original_helper_rejects_before_any_owned_child(self):
        with (self.root / '.github/native/product_metro.py').open('a') as output:
            output.write('\n# changed after source admission\n')
        self.assertNotEqual(self.run_setup().returncode, 0)
        self.assertFalse((self.root / 'node.pid').exists())

    def test_nonreused_or_already_passed_native_state_rejects_before_launch(self):
        for change in ({'build_execution_scope': 'COMPILED'}, {'smoke': 'PASS'}, {'source_sha': 'c' * 40}):
            with self.subTest(change=change):
                self.save()
                value = json.loads((self.root / 'state.json').read_text())
                value.update(change)
                (self.root / 'state.json').write_text(json.dumps(value))
                self.assertNotEqual(self.run_setup().returncode, 0)
                self.assertFalse((self.root / 'node.pid').exists())


if __name__ == '__main__':
    unittest.main()
