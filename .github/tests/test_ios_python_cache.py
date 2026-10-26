"""Real timestamp-valid forged PYC controls; no native build or application runs."""
import importlib.util
import json
import marshal
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class PythonCacheBoundary(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.native = self.root / '.github/native'; self.native.mkdir(parents=True)
        for name in ('hosted_native.py', 'ios_normal_xcode.py', 'ios_generated_source.py', 'android_apk_checkpoint.py'):
            shutil.copyfile(ROOT / '.github/native' / name, self.native / name)
        self.fixture = self.native / 'fixture.py'; self.fixture.write_text("VALUE = 'VERIFIED_SOURCE'\n")
        subprocess.run(['git', 'init', '-q'], cwd=self.root, check=True)
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True)
        subprocess.run(['git', '-c', 'user.name=Fixture', '-c', 'user.email=f@example.invalid',
            'commit', '-qm', 'tracked source fixture'], cwd=self.root, check=True)
        self.source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=self.root, text=True).strip()
        (self.root / '.git/info/exclude').write_text('.github/native/__pycache__/\n')

    def forge(self, source, payload):
        identity = source.stat()
        header = importlib.util.MAGIC_NUMBER + struct.pack('<III', 0, int(identity.st_mtime), identity.st_size)
        target = source.parent / '__pycache__' / (source.stem + '.' + sys.implementation.cache_tag + '.pyc')
        target.parent.mkdir(exist_ok=True)
        target.write_bytes(header + marshal.dumps(compile(payload, str(source), 'exec')))
        return target

    def run_python(self, program, protected):
        env = {key: os.environ[key] for key in ('PATH', 'SYSTEMROOT') if key in os.environ}
        env.update({'KEEPER_NATIVE_PLATFORM': 'IOS', 'KEEPER_SOURCE_SHA': self.source,
                    'RUNNER_TEMP': str(self.root / 'runner-private')})
        if protected:
            env.update(PYTHONPYCACHEPREFIX=os.devnull, PYTHONDONTWRITEBYTECODE='1')
        return subprocess.run([sys.executable, '-B', '-c', program], cwd=self.root,
            env=env, capture_output=True, text=True, timeout=30, check=False)

    def test_valid_forged_cache_executes_under_B_alone_but_not_with_source_only_bootstrap(self):
        self.forge(self.fixture, "VALUE = 'UNVERIFIED_CACHE'\n")
        loader = """import importlib.util
spec = importlib.util.spec_from_file_location('fixture', '.github/native/fixture.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
print(module.VALUE)
"""
        ordinary = self.run_python(loader, protected=False)
        self.assertEqual(ordinary.returncode, 0, ordinary.stderr)
        self.assertEqual(ordinary.stdout.strip(), 'UNVERIFIED_CACHE')
        protected = self.run_python(loader, protected=True)
        self.assertEqual(protected.returncode, 0, protected.stderr)
        self.assertEqual(protected.stdout.strip(), 'VERIFIED_SOURCE')

    def test_forged_harness_normal_and_downstream_caches_cannot_run_before_or_after_guard(self):
        for name in ('hosted_native', 'ios_normal_xcode'):
            self.forge(self.native / (name + '.py'), "raise RuntimeError('UNVERIFIED_NATIVE_CACHE_EXECUTED')\n")
        self.forge(self.fixture, "VALUE = 'UNVERIFIED_CACHE'\n")
        program = """import importlib.util, json, os, pathlib, shutil, sys
spec = importlib.util.spec_from_file_location('native', '.github/native/hosted_native.py')
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
assert sys.pycache_prefix == os.devnull and sys.dont_write_bytecode is True
normal = h.normal_ios()
assert normal.PROFILE == 'normal-xcode'
assert normal.module('fixture').VALUE == 'VERIFIED_SOURCE'
h.save({'source_sha': os.environ['KEEPER_SOURCE_SHA']})
try:
    normal.require_source(h.native_context(), prepared=False)
except RuntimeError:
    rejected = True
else:
    rejected = False
assert rejected
assert normal.module('fixture').VALUE == 'VERIFIED_SOURCE'
shutil.rmtree(pathlib.Path('.github/native/__pycache__'))
normal.require_source(h.native_context(), prepared=False)
assert normal.module('fixture').VALUE == 'VERIFIED_SOURCE'
assert not pathlib.Path('.github/native/__pycache__').exists()
print(json.dumps({'cache_rejected': rejected, 'source_before_and_after_guard': True, 'cache_writes': False}))
"""
        result = self.run_python(program, protected=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {'cache_rejected': True,
            'source_before_and_after_guard': True, 'cache_writes': False})

    def test_direct_harness_entry_bootstrap_protects_normal_and_transitive_imports_without_cached_inputs(self):
        # The harness is the direct trusted entry here; its own cache cannot be
        # consulted by runpy.run_path, as with python hosted_native.py.
        self.forge(self.native / 'ios_normal_xcode.py', "raise RuntimeError('UNVERIFIED_NORMAL_CACHE')\n")
        self.forge(self.fixture, "VALUE = 'UNVERIFIED_CACHE'\n")
        program = """import os, runpy, sys
namespace = runpy.run_path('.github/native/hosted_native.py', run_name='trusted_entry')
assert sys.pycache_prefix == os.devnull and sys.dont_write_bytecode is True
assert os.environ['PYTHONPYCACHEPREFIX'] == os.devnull
assert os.environ['PYTHONDONTWRITEBYTECODE'] == '1'
normal = namespace['normal_ios']()
assert normal.module('fixture').VALUE == 'VERIFIED_SOURCE'
print('SOURCE_ONLY')
"""
        result = self.run_python(program, protected=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'SOURCE_ONLY')

    def test_bootstrap_rejects_non_character_cache_prefix_device(self):
        regular = self.root / 'not-null'; regular.write_text('regular file')
        program = """import os, runpy
os.devnull = 'not-null'
try:
    runpy.run_path('.github/native/hosted_native.py', run_name='trusted_entry')
except RuntimeError as error:
    assert str(error) == 'SOURCE_ONLY_PYTHON_NULL_DEVICE_REQUIRED'
else:
    raise AssertionError('regular file accepted')
print('REJECTED')
"""
        result = self.run_python(program, protected=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'REJECTED')


if __name__ == '__main__': unittest.main()
