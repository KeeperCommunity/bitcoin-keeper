"""Bound selected Git-object import controls; no native execution or network."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parents[2]
SPEC = importlib.util.spec_from_file_location('history_contract', ROOT / '.github/native/r52_realm109_history.py')
history = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(history)
BUNDLE = ROOT / '.github/native/r52_realm109_objects.json'


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL)


def fixture(root):
    root.mkdir(); git(root, 'init', '-q')
    file = root / history.FIXTURE; file.parent.mkdir(parents=True); shutil.copyfile(ROOT / history.FIXTURE, file)
    git(root, 'add', '.'); git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                              'commit', '-qm', 'independent source fixture')
    return root


class HistoricalObjectAdmission(unittest.TestCase):
    def test_exact_pack_contains_only_original_commit_ten_trees_and_17_approved_blobs(self):
        value, manifest, pack, objects = history.verify_bundle(BUNDLE.read_bytes(), (ROOT / history.FIXTURE).read_bytes())
        self.assertEqual(len(pack), 14563); self.assertEqual(len(objects), 28)
        self.assertEqual(sum(kind == 'commit' for kind, _ in objects.values()), 1)
        self.assertEqual(sum(kind == 'tree' for kind, _ in objects.values()), 10)
        self.assertEqual(sum(kind == 'blob' for kind, _ in objects.values()), 17)
        self.assertNotIn('a7158f111f30e886f1d220630c0d804b8758d05e', objects)
        self.assertEqual({row['git_blob'] for row in manifest['files']},
                         {oid for oid, (kind, _) in objects.items() if kind == 'blob'})
        self.assertEqual(value['tree'], history.TREE)

    def test_modified_bundle_or_fixture_authority_rejects_before_import(self):
        raw = BUNDLE.read_bytes(); authority = (ROOT / history.FIXTURE).read_bytes()
        for bundle, manifest in [(raw + b' ', authority), (raw, authority + b' '),
                                 (raw.replace(b'pack_base64', b'other_field'), authority)]:
            with self.assertRaises(RuntimeError):
                history.verify_bundle(bundle, manifest)

    def test_pack_trailer_version_count_delta_and_duplicate_objects_reject(self):
        value, _, pack, _ = history.verify_bundle(BUNDLE.read_bytes(), (ROOT / history.FIXTURE).read_bytes())
        altered = bytearray(pack); altered[-1] ^= 1
        with self.assertRaises(RuntimeError): history.unpack(bytes(altered), value['objects'])
        for change in [lambda data: data.__setitem__(slice(4, 8), struct.pack('>I', 3)),
                       lambda data: data.__setitem__(slice(8, 12), struct.pack('>I', 29)),
                       lambda data: data.__setitem__(12, (data[12] & 0x8f) | 0x60)]:
            altered = bytearray(pack); change(altered); altered[-20:] = hashlib.sha1(altered[:-20]).digest()
            with self.assertRaises(RuntimeError): history.unpack(bytes(altered), value['objects'])
        rows = copy.deepcopy(value['objects']); rows[-1] = rows[-2]
        with self.assertRaises(RuntimeError): history.unpack(pack, rows)

    def test_actual_import_preserves_head_refs_index_and_dirty_files_without_parent_history(self):
        with tempfile.TemporaryDirectory() as name:
            temporary = Path(name); root = fixture(temporary / 'app')
            (root / 'staged.txt').write_text('staged'); git(root, 'add', 'staged.txt')
            (root / 'untracked.txt').write_text('untracked source remains unchanged')
            before = history.snapshot(root)
            existing = set(git(root, 'cat-file', '--batch-all-objects', '--batch-check=%(objectname)').decode().splitlines())
            with self.assertRaises(subprocess.CalledProcessError): git(root, 'cat-file', '-e', history.HISTORICAL)
            receipt = history.provision(root, BUNDLE, temporary / 'admission.json')
            self.assertEqual(history.snapshot(root), before)
            self.assertEqual(receipt['head_before'], receipt['head_after'])
            self.assertFalse(receipt['network_fetch']); self.assertFalse(receipt['native_execution'])
            with self.assertRaises(subprocess.CalledProcessError):
                git(root, 'cat-file', '-e', 'a7158f111f30e886f1d220630c0d804b8758d05e')
            value, manifest, _, objects = history.verify_bundle(BUNDLE.read_bytes(), (ROOT / history.FIXTURE).read_bytes())
            after = set(git(root, 'cat-file', '--batch-all-objects', '--batch-check=%(objectname)').decode().splitlines())
            self.assertEqual(after - existing, set(objects) - existing)
            for row in manifest['files']:
                self.assertEqual(history.sha(git(root, 'show', history.HISTORICAL + ':' + row['path'])), row['sha256'])

    def test_stale_receipt_or_symlink_bundle_rejects_before_git_object_writes(self):
        with tempfile.TemporaryDirectory() as name:
            temporary = Path(name); root = fixture(temporary / 'app')
            stale = temporary / 'admission.json'; stale.write_text('original receipt')
            with self.assertRaises(RuntimeError): history.provision(root, BUNDLE, stale)
            with self.assertRaises(subprocess.CalledProcessError): git(root, 'cat-file', '-e', history.HISTORICAL)
            link = temporary / 'bundle.json'; link.symlink_to(BUNDLE)
            with self.assertRaises(RuntimeError): history.provision(root, link, temporary / 'fresh.json')
            with self.assertRaises(subprocess.CalledProcessError): git(root, 'cat-file', '-e', history.HISTORICAL)

    def test_cli_wrong_context_never_provisions(self):
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'false'}), patch.object(history.sys, 'argv', ['history', 'provision']), \
             patch.object(history, 'provision') as provision:
            with self.assertRaises(RuntimeError): history.main()
            provision.assert_not_called()


if __name__ == '__main__':
    unittest.main()
