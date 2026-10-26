import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('selected_relay', Path(__file__).with_name('protected_relay_source.py'))
relay = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(relay)


class SelectedRelayTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='keeper-selected-backend-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.backend = self.root / 'backend'

    def test_original_commit_tree_and_only_selected_blob_bytes_round_trip(self):
        receipt = relay.restore(self.backend)
        self.assertEqual(receipt['backend'], relay.COMMIT)
        self.assertEqual(receipt['files'], 17)
        self.assertEqual(relay.git(self.backend, 'diff', '--quiet', 'HEAD'), b'')
        self.assertEqual(relay.git(self.backend, 'rev-list', '--count', 'HEAD').strip(), b'1')
        archive = json.loads(relay.ARCHIVE.read_bytes())
        files = sorted(str(p.relative_to(self.backend)) for p in self.backend.rglob('*')
                       if p.is_file() and '.git' not in p.relative_to(self.backend).parts)
        self.assertEqual(files, sorted(archive['files']))
        objects = relay.git(self.backend, 'cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)').decode().splitlines()
        self.assertEqual(len(objects), len(archive['objects']))
        self.assertEqual(sum(x.endswith(' blob') for x in objects), 17)
        self.assertEqual(sum(x.endswith(' commit') for x in objects), 1)

    def test_archive_changes_unrelated_blobs_or_parent_history_are_rejected(self):
        raw = relay.ARCHIVE.read_bytes()
        for changed in [raw + b' ', raw.replace(b'"schema":1', b'"schema":2'),
                        raw.replace(relay.COMMIT.encode(), b'0' * 40, 1)]:
            with self.subTest(digest=hashlib.sha256(changed).hexdigest()):
                with self.assertRaisesRegex(ValueError, 'ARCHIVE_CHANGED'):
                    relay.checked_archive(changed)

    def test_existing_and_aliased_destinations_are_never_overwritten(self):
        self.backend.mkdir()
        (self.backend / 'owner-data').write_text('retain')
        with self.assertRaises(ValueError): relay.restore(self.backend)
        link = self.root / 'alias'
        link.symlink_to(self.backend, target_is_directory=True)
        with self.assertRaises(ValueError): relay.restore(link)
        self.assertEqual((self.backend / 'owner-data').read_text(), 'retain')

    def test_hidden_worktree_blob_change_is_rejected(self):
        relay.restore(self.backend)
        relay.git(self.backend, 'update-index', '--assume-unchanged', 'src/services/protectedBackup.ts')
        p = self.backend / 'src/services/protectedBackup.ts'
        p.write_bytes(p.read_bytes() + b'\n// tampered\n')
        with self.assertRaisesRegex(ValueError, 'FILE_CHANGED'): relay.verify(self.backend)

    def test_source_symlink_and_additional_file_are_rejected(self):
        relay.restore(self.backend)
        extra = self.backend / 'unreviewed.cjs'; extra.write_text('throw 1')
        with self.assertRaisesRegex(ValueError, 'CHECKOUT_CHANGED'): relay.verify(self.backend)
        extra.unlink()
        file = self.backend / 'src/db.ts'; original = file.read_bytes(); file.unlink()
        elsewhere = self.root / 'other.ts'; elsewhere.write_bytes(original); file.symlink_to(elsewhere)
        with self.assertRaises(ValueError): relay.verify(self.backend)


if __name__ == '__main__': unittest.main()
