"""Synthetic original ZIP bytes exercise receipt transport, never native acceptance."""
import base64
import importlib.util
import io
import json
from pathlib import Path
import stat
import struct
import subprocess
import sys
import unittest
import warnings
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'native/software_artifact_zip.py'
spec = importlib.util.spec_from_file_location('software_artifact_zip', SCRIPT)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
BODY = b'{"schema":1,"status":"PASS","authorization_eligible":false}'


class StreamingOutput:
    """A real unseekable writer makes zipfile emit ZIP32 data descriptors."""
    def __init__(self):
        self.chunks = []

    def write(self, value):
        self.chunks.append(value)
        return len(value)

    def flush(self):
        pass

    def getvalue(self):
        return b''.join(self.chunks)


def make_zip(name='ios/metadata.json', body=BODY, compression=zipfile.ZIP_DEFLATED,
             streaming=False, info=None, extra_entries=()):
    output = StreamingOutput() if streaming else io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', UserWarning)
        with zipfile.ZipFile(output, 'w', compression=compression) as archive:
            if info is None:
                archive.writestr(name, body)
            else:
                info.compress_type = compression
                archive.writestr(info, body)
            for extra_name, extra_body in extra_entries:
                archive.writestr(extra_name, extra_body)
    return output.getvalue()


def central(raw):
    return struct.unpack_from('<I', raw, len(raw) - 6)[0]


def replace_number(raw, offset, value, width=2):
    result = bytearray(raw)
    struct.pack_into('<H' if width == 2 else '<I', result, offset, value)
    return bytes(result)


class ArtifactZipTests(unittest.TestCase):
    def reject(self, raw, platform='IOS'):
        with self.assertRaisesRegex(ValueError, '^SOFTWARE_ARTIFACT_ZIP_INVALID$'):
            reader.read_archive(raw, platform)

    def test_real_stored_and_deflated_archives_return_original_bytes(self):
        for compression in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            for platform in ('IOS', 'ANDROID'):
                name = platform.lower() + '/metadata.json'
                self.assertEqual(reader.read_archive(make_zip(name, compression=compression), platform),
                                 {name: BODY})

    def test_real_streaming_archives_with_signed_data_descriptors(self):
        for compression in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raw = make_zip(compression=compression, streaming=True)
            self.assertTrue(struct.unpack_from('<H', raw, 6)[0] & 8)
            self.assertEqual(reader.read_archive(raw, 'IOS'), {'ios/metadata.json': BODY})

    def test_valid_signatureless_descriptor_is_supported(self):
        raw = make_zip(streaming=True)
        offset = central(raw)
        self.assertEqual(raw[offset - 16:offset - 12], b'PK\x07\x08')
        raw = raw[:offset - 16] + raw[offset - 12:]
        raw = replace_number(raw, len(raw) - 6, offset - 4, 4)
        self.assertEqual(reader.read_archive(raw, 'IOS'), {'ios/metadata.json': BODY})

    def test_utf8_flag_and_regular_unix_mode_are_supported(self):
        info = zipfile.ZipInfo('ios/metadata.json')
        info.external_attr = (stat.S_IFREG | 0o600) << 16
        raw = make_zip(info=info)
        raw = replace_number(raw, 6, 0x800)
        raw = replace_number(raw, central(raw) + 8, 0x800)
        self.assertEqual(reader.read_archive(raw, 'IOS'), {'ios/metadata.json': BODY})

    def test_bounded_timestamp_extra_fields_are_supported(self):
        extras = (struct.pack('<HHBI', 0x5455, 5, 1, 1700000000),
                  struct.pack('<HHIHH3Q', 0x000a, 32, 0, 1, 24, 1, 2, 3))
        for extra in extras:
            info = zipfile.ZipInfo('ios/metadata.json')
            info.extra = extra
            self.assertEqual(reader.read_archive(make_zip(info=info), 'IOS'),
                             {'ios/metadata.json': BODY})

    def test_only_fixed_public_platform_paths_are_configured(self):
        for platform in ('PRIVATE', 'C2', 'ios', '', None, {'untrusted': 'IOS'}):
            self.reject(make_zip(), platform)
        for name in ('metadata.json', 'android/metadata.json', '../ios/metadata.json',
                     '/ios/metadata.json', 'ios/../ios/metadata.json', 'ios\\metadata.json',
                     'ios/METADATA.json'):
            self.reject(make_zip(name))
        # zipfile truncates input names at NUL before writing; mutate original ZIP bytes instead.
        raw = make_zip()
        pos = central(raw) + 46
        self.reject(raw[:pos] + b'\0' + raw[pos + 1:])
        self.reject(raw[:30] + b'\0' + raw[31:])

    def test_duplicate_and_extra_members_are_rejected(self):
        for extra in ((('ios/metadata.json', b'{}'),), (('private.log', b'private fixture'),),
                      (('ios/', b''),)):
            self.reject(make_zip(extra_entries=extra))

    def test_symlink_directory_device_and_fifo_modes_are_rejected(self):
        for kind in (stat.S_IFLNK, stat.S_IFDIR, stat.S_IFCHR, stat.S_IFBLK, stat.S_IFIFO, stat.S_IFSOCK):
            info = zipfile.ZipInfo('ios/metadata.json')
            info.external_attr = (kind | 0o600) << 16
            self.reject(make_zip(info=info))
        raw = make_zip()
        self.reject(replace_number(raw, central(raw) + 38, 0x10, 4))

    def test_empty_oversized_and_decompression_bomb_members_are_rejected(self):
        for body in (b'', b'a' * (reader.MAX_MEMBER + 1)):
            self.reject(make_zip(body=body))
        self.reject(b'x' * (reader.MAX_ARCHIVE + 1))
        self.reject(bytearray(make_zip()))

    def test_exact_member_limit_is_accepted(self):
        body = b'c' * reader.MAX_MEMBER
        self.assertEqual(reader.read_archive(make_zip(body=body), 'IOS'), {'ios/metadata.json': body})

    def test_encryption_unknown_flags_and_unsupported_compression_are_rejected(self):
        raw = make_zip()
        for flags in (1, 0x40, 0x2000, 0x8000):
            value = replace_number(raw, 6, flags)
            self.reject(replace_number(value, central(value) + 8, flags))
        for method in (9, 12, 14, 99):
            value = replace_number(raw, 8, method)
            self.reject(replace_number(value, central(value) + 10, method))

    def test_zip64_and_ambiguous_path_extra_fields_are_rejected(self):
        for kind in (1, 0x7075, 0x6375, 0x9901):
            info = zipfile.ZipInfo('ios/metadata.json')
            info.extra = struct.pack('<HHI', kind, 4, 0)
            self.reject(make_zip(info=info))
        raw = make_zip()
        raw = replace_number(raw, 4, 45)
        self.reject(replace_number(raw, central(raw) + 6, 45))

    def test_malformed_or_duplicate_timestamp_extras_are_rejected(self):
        for extra in (struct.pack('<HHB', 0x5455, 1, 1),
                      struct.pack('<HHBI', 0x5455, 5, 8, 0),
                      struct.pack('<HHBI', 0x5455, 5, 1, 0) * 2,
                      struct.pack('<HHI', 0x000a, 4, 0)):
            info = zipfile.ZipInfo('ios/metadata.json')
            info.extra = extra
            self.reject(make_zip(info=info))

    def test_truncation_prepended_data_trailing_data_comments_and_multidisk_are_rejected(self):
        raw = make_zip()
        for value in (raw[:20], raw[:-1], b'launcher' + raw, raw + b'trailing'):
            self.reject(value)
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            archive.writestr('ios/metadata.json', BODY)
            archive.comment = b'not an evidence channel'
        self.reject(output.getvalue())
        for offset, value in ((len(raw) - 18, 1), (len(raw) - 16, 1),
                              (len(raw) - 12, 2), (central(raw) + 34, 1)):
            self.reject(replace_number(raw, offset, value))

    def test_central_local_header_agreement_is_required(self):
        raw = make_zip()
        for offset, value, width in ((4, 10, 2), (6, 0x800, 2), (8, 0, 2),
                                     (10, 1, 2), (12, 1, 2), (14, 42, 4),
                                     (18, 42, 4), (22, 42, 4), (26, 3, 2),
                                     (central(raw) + 42, 1, 4),
                                     (central(raw) + 20, len(raw), 4)):
            self.reject(replace_number(raw, offset, value, width))
        self.reject(raw[:30] + b'X' + raw[31:])
        pos = central(raw) + 46
        self.reject(raw[:pos] + b'X' + raw[pos + 1:])

    def test_actual_crc_and_complete_deflate_stream_are_required(self):
        for compression in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raw = make_zip(compression=compression)
            c = central(raw)
            forged = replace_number(raw, 14, 123, 4)
            self.reject(replace_number(forged, c + 16, 123, 4))
            start = 30 + struct.unpack_from('<H', raw, 26)[0] + struct.unpack_from('<H', raw, 28)[0]
            damaged = bytearray(raw)
            damaged[start] ^= 0x7f
            self.reject(bytes(damaged))

    def test_hidden_trailing_deflate_data_is_not_an_extra_channel(self):
        raw = make_zip()
        c = central(raw)
        packed = struct.unpack_from('<I', raw, c + 20)[0]
        raw = raw[:c] + b'HIDDEN' + raw[c:]
        raw = replace_number(raw, len(raw) - 6, c + 6, 4)
        raw = replace_number(raw, 18, packed + 6, 4)
        raw = replace_number(raw, c + 6 + 20, packed + 6, 4)
        self.reject(raw)

    def test_declared_small_size_cannot_hide_oversized_inflate_output(self):
        raw = make_zip(body=b'x' * (reader.MAX_MEMBER + 1))
        raw = replace_number(raw, 22, 1, 4)
        raw = replace_number(raw, central(raw) + 24, 1, 4)
        self.reject(raw)

    def test_data_descriptor_values_and_length_must_match(self):
        raw = make_zip(streaming=True)
        c = central(raw)
        for offset in (c - 16, c - 12, c - 8, c - 4):
            value = bytearray(raw)
            value[offset] ^= 1
            self.reject(bytes(value))
        value = raw[:c - 16] + raw[c - 12:]
        self.reject(value)  # Central directory offset cannot be silently rebased.

    def test_cli_preserves_bytes_only_in_captured_ipc(self):
        completed = subprocess.run([sys.executable, str(SCRIPT), 'IOS'], input=make_zip(),
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stderr, b'')
        envelope = json.loads(completed.stdout)
        self.assertEqual(set(envelope), {'ios/metadata.json'})
        self.assertEqual(base64.b64decode(envelope['ios/metadata.json'], validate=True), BODY)

    def test_cli_failure_has_no_payload_path_or_traceback(self):
        for args, payload in ((['PRIVATE'], make_zip()), (['IOS'], b'PRIVATE_URL_SECRET_INVALID'),
                              (['IOS', '/private/unapproved'], make_zip()),
                              (['IOS'], b'x' * (reader.MAX_ARCHIVE + 1))):
            completed = subprocess.run([sys.executable, str(SCRIPT), *args], input=payload,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
            self.assertEqual(completed.returncode, 1)
            self.assertEqual(completed.stdout, b'')
            self.assertEqual(completed.stderr, b'SOFTWARE_ARTIFACT_ZIP_INVALID\n')


if __name__ == '__main__':
    unittest.main()
