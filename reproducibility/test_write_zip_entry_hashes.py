import hashlib
import tempfile
import unittest
import warnings
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

from importlib.util import module_from_spec, spec_from_file_location

SCRIPT = Path(__file__).with_name("write-zip-entry-hashes.py")
SPEC = spec_from_file_location("write_zip_entry_hashes", SCRIPT)
MODULE = module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class EntryHashTests(unittest.TestCase):
    def test_manifest_ignores_zip_order_and_compression(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.zip"
            second = Path(directory) / "second.zip"
            with ZipFile(first, "w", compression=ZIP_STORED) as archive:
                archive.writestr("b", b"second")
                archive.writestr("a", b"first")
            with ZipFile(second, "w", compression=ZIP_DEFLATED) as archive:
                archive.writestr("a", b"first")
                archive.writestr("b", b"second")
            expected = [
                {"path": "a", "sha256": hashlib.sha256(b"first").hexdigest(), "size": 5},
                {"path": "b", "sha256": hashlib.sha256(b"second").hexdigest(), "size": 6},
            ]
            self.assertEqual(MODULE.entry_hashes(first), expected)
            self.assertEqual(MODULE.entry_hashes(second), expected)

    def test_duplicate_entry_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "duplicate.zip"
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                with ZipFile(path, "w") as archive:
                    archive.writestr("same", b"first")
                    archive.writestr("same", b"second")
            with self.assertRaisesRegex(ValueError, "Duplicate ZIP entry"):
                MODULE.entry_hashes(path)


if __name__ == "__main__":
    unittest.main()
