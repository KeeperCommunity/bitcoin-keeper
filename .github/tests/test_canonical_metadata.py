import importlib.util
import io
from pathlib import Path
import stat
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('canonical_metadata',
    Path(__file__).resolve().parents[1] / 'native/canonical_metadata.py')
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def archive(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as file:
        for name, body in entries:
            file.writestr(name, body)
    return output.getvalue()


class ArchiveTests(unittest.TestCase):
    def test_single_bounded_receipt(self):
        self.assertEqual(reader.read_metadata(archive([('metadata.json', b'{"schema":1}')])), b'{"schema":1}')

    def test_path_traversal_and_other_names_rejected(self):
        for name in ('../metadata.json', '/metadata.json', 'ios/metadata.json', 'other.json'):
            with self.assertRaises(ValueError):
                reader.read_metadata(archive([(name, b'{}')]))

    def test_multiple_members_rejected(self):
        with self.assertRaises(ValueError):
            reader.read_metadata(archive([('metadata.json', b'{}'), ('private.log', b'PRIVATE')]))

    def test_symlink_rejected(self):
        info = zipfile.ZipInfo('metadata.json')
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        with self.assertRaises(ValueError):
            reader.read_metadata(archive([(info, b'/private/file')]))

    def test_decompression_bomb_and_oversized_archive_rejected(self):
        for raw in (archive([('metadata.json', b'x' * 524289)]), b'x' * 1048577):
            with self.assertRaises(ValueError):
                reader.read_metadata(raw)

    def test_truncated_archive_rejected(self):
        with self.assertRaises(zipfile.BadZipFile):
            reader.read_metadata(archive([('metadata.json', b'{}')])[:20])


if __name__ == '__main__':
    unittest.main()
