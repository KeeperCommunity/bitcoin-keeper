"""Actual Node fixture subprocess lifecycle; no native app acceptance credit."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('r52_tls_native', ROOT / '.github/native/r52_tls_native.py')
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)

class FixtureLifecycle(unittest.TestCase):
    def test_both_actual_fixture_clis_acknowledge_cleanup_and_exit_after_owned_stdin_eof(self):
        for stem in ('tls', 'trust_ui'):
            with self.subTest(fixture=stem), tempfile.TemporaryFile(mode='w+') as errors:
                name = 'r52_tls_fixture.json' if stem == 'tls' else 'r52_trust_ui.json'
                generated = ROOT / '.github/native/.generated' / name
                self.assertFalse(generated.exists(), 'Never adopt or delete an existing fixture')
                args = [os.environ.get('NODE_BINARY', 'node'), '.github/native/r52_' + stem + '_fixture.cjs', 'ANDROID']
                if stem == 'tls': args.append(str(generated))
                child = subprocess.Popen(args, cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                         stderr=errors, text=True)
                try:
                    ready = runner.receive(child)
                    self.assertIs(ready['ready'], True)
                    self.assertTrue(generated.is_file())
                    child.stdin.write('snapshot\n'); child.stdin.flush()
                    snapshot = runner.receive(child)
                    self.assertIsInstance(snapshot, dict)
                    runner.close_fixture(child)
                    self.assertEqual(child.returncode, 0)
                    self.assertTrue(child.stdin.closed)
                    self.assertFalse(generated.exists())
                finally:
                    if child.poll() is None:
                        # EOF to our own process still permits its ordinary cleanup.
                        if not child.stdin.closed: child.stdin.close()
                        try: child.wait(timeout=20)
                        except subprocess.TimeoutExpired:
                            child.kill(); child.wait(timeout=5)
                    if child.stdout: child.stdout.close()

if __name__ == '__main__': unittest.main()
