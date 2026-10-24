"""Synthetic byte transport controls, without app, native, Actions or evidence trust."""
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

SCRIPT = Path(__file__).resolve().parents[1] / 'native/private_software_artifact_zip.py'
spec = importlib.util.spec_from_file_location('private_software_artifact_zip', SCRIPT)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
BODY = b'\x00\xffnot-json\r\n{"duplicate":1,"duplicate":2}\n'


def expected_names(platform='IOS'):
    p = platform.lower()
    return (
        f'control/artifacts/native-integration/{p}/metadata.json',
        f'control/artifacts/native-integration/{p}/startup.json',
        f'control/artifacts/native-protected/{p}/metadata.json',
        f'control/artifacts/native-protected/{p}/fixture.json',
        f'control/artifacts/native-recovery/{p}/metadata.json',
        f'control/artifacts/native-recovery/{p}/fixture.json',
        f'control/artifacts/native-account/{p}/metadata.json',
        f'control/artifacts/native-account/{p}/fixture.json',
        'control/artifacts/native-protected/mongo.json',
        f'app/artifacts/native/{p}/metadata.json',
        f'control/artifacts/native-integration/{p}/public-probe.json',
        f'control/artifacts/native-integration/{p}/public-features.json',
        f'control/artifacts/native-integration/{p}/public-product.json',
    )


class StreamingOutput:
    def __init__(self):
        self.chunks = []

    def write(self, value):
        self.chunks.append(value)
        return len(value)

    def flush(self):
        pass

    def getvalue(self):
        return b''.join(self.chunks)


def make_zip(platform='IOS', *, names=None, bodies=None, streaming=False,
             compression=zipfile.ZIP_DEFLATED, extra=b'', mode=None):
    output = StreamingOutput() if streaming else io.BytesIO()
    names = expected_names(platform) if names is None else names
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', UserWarning)
        with zipfile.ZipFile(output, 'w') as archive:
            for index, name in enumerate(names):
                info = zipfile.ZipInfo(name)
                info.compress_type = compression[index % len(compression)] if isinstance(compression, tuple) else compression
                info.extra = extra
                if mode is not None:
                    info.external_attr = mode << 16
                archive.writestr(info, (bodies or {}).get(name, BODY + bytes([index])))
    return output.getvalue()


def number(raw, offset, value, width=2):
    result = bytearray(raw)
    struct.pack_into('<H' if width == 2 else '<I', result, offset, value)
    return bytes(result)


def central_start(raw):
    return struct.unpack_from('<I', raw, len(raw) - 6)[0]


def parts(raw):
    """Split real zipfile output into original local/central byte records for faults."""
    c = central_start(raw)
    offsets, directory, cursor = [], [], c
    for _ in range(struct.unpack_from('<H', raw, len(raw) - 12)[0]):
        name, extra, comment = struct.unpack_from('<3H', raw, cursor + 28)
        end = cursor + 46 + name + extra + comment
        offsets.append(struct.unpack_from('<I', raw, cursor + 42)[0])
        directory.append(raw[cursor:end])
        cursor = end
    return [[raw[start:(offsets + [c])[i + 1]], directory[i]] for i, start in enumerate(offsets)]


def assemble(records, *, prefix=b'', central_suffix=b''):
    """Update only ZIP offsets/sizes after a deliberate byte mutation."""
    local, directory = prefix, b''
    for chunk, entry in records:
        directory += number(entry, 42, len(local), 4)
        local += chunk
    directory += central_suffix
    return local + directory + struct.pack('<4s4H2IH', b'PK\x05\x06', 0, 0,
                                           len(records), len(records), len(directory), len(local), 0)


class PrivateArtifactZipTests(unittest.TestCase):
    def reject(self, raw, platform='IOS'):
        with self.assertRaisesRegex(ValueError, '^PRIVATE_SOFTWARE_ARTIFACT_ZIP_INVALID$'):
            reader.read_archive(raw, platform)

    def test_fixed_manifest_and_finite_caps_match_d_profile(self):
        for platform in ('IOS', 'ANDROID'):
            limits = reader.member_limits(platform)
            self.assertEqual(tuple(limits), expected_names(platform))
            self.assertEqual(list(limits.values()), [2000000, 2000000, 32768, 8192,
                             32768, 8192, 32768, 8192, 8192, 2000000, 2000000, 2000000, 2000000])
            self.assertEqual(sum(limits.values()), 12131072)
            self.assertEqual(reader.MAX_TOTAL, 12582912)
            self.assertEqual(reader.MAX_ARCHIVE, reader.MAX_TOTAL)
            limits.clear()  # Caller cannot mutate a later invocation's policy.
            self.assertEqual(len(reader.member_limits(platform)), 13)

    def test_real_stored_deflate_mixed_archives_preserve_binary_originals(self):
        for platform in ('IOS', 'ANDROID'):
            for compression in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED,
                                (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
                names = expected_names(platform)
                bodies = {name: BODY + bytes([i]) for i, name in enumerate(names)}
                raw = make_zip(platform, bodies=bodies, compression=compression)
                result = reader.read_archive(raw, platform)
                self.assertEqual(tuple(result), names)
                self.assertEqual(result, bodies)

    def test_any_physical_permutation_returns_canonical_order(self):
        names = expected_names()
        for order in (names[::-1], names[5:] + names[:5], names[::2] + names[1::2]):
            raw = make_zip(names=order)
            result = reader.read_archive(raw, 'IOS')
            self.assertEqual(tuple(result), names)
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                self.assertEqual(result, {name: archive.read(name) for name in names})

    def test_real_streaming_signed_and_unsigned_descriptors(self):
        for compression in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raw = make_zip(streaming=True, compression=compression)
            expected = reader.read_archive(raw, 'IOS')
            records = parts(raw)
            for record in records:
                self.assertEqual(record[0][-16:-12], b'PK\x07\x08')
                record[0] = record[0][:-16] + record[0][-12:]
            self.assertEqual(reader.read_archive(assemble(records), 'IOS'), expected)

    def test_utf8_regular_mode_and_finite_timestamp_extras(self):
        extras = (b'', struct.pack('<HHBI', 0x5455, 5, 1, 1700000000),
                  struct.pack('<HHIHH3Q', 0x000a, 32, 0, 1, 24, 1, 2, 3))
        for extra in extras:
            records = parts(make_zip(extra=extra, mode=stat.S_IFREG | 0o600))
            for record in records:
                record[0] = number(record[0], 6, 0x800)
                record[1] = number(record[1], 8, 0x800)
            self.assertEqual(len(reader.read_archive(assemble(records), 'IOS')), 13)

    def test_all_member_caps_simultaneously_accept_original_stored_bytes(self):
        bodies = {name: b'a' * cap for name, cap in reader.member_limits('IOS').items()}
        raw = make_zip(bodies=bodies, compression=zipfile.ZIP_STORED)
        self.assertLess(len(raw), reader.MAX_ARCHIVE)
        self.assertEqual(reader.read_archive(raw, 'IOS'), bodies)

    def test_each_individual_cap_and_empty_member_fail(self):
        for name, cap in reader.member_limits('IOS').items():
            for body in (b'', b'x' * (cap + 1)):
                self.reject(make_zip(bodies={name: body}))

    def test_declared_small_size_cannot_hide_oversized_inflation(self):
        name = expected_names()[3]
        records = parts(make_zip(bodies={name: b'x' * 8193}))
        records[3][0] = number(records[3][0], 22, 1, 4)
        records[3][1] = number(records[3][1], 24, 1, 4)
        self.reject(assemble(records))

    def test_platform_raw_type_and_archive_bounds(self):
        raw = make_zip()
        for platform in ('ios', 'ANDROID', 'C2', 'D', '', None, {'p': 'IOS'}):
            self.reject(raw, platform)
        for value in (bytearray(raw), memoryview(raw), None, raw[:21], b'x' * (reader.MAX_ARCHIVE + 1)):
            self.reject(value)

    def test_exact_set_rejects_missing_extra_duplicate_and_unknown_names(self):
        names = expected_names()
        for order in (names[:-1], names + ('extra.log',), names[:-1] + (names[0],)):
            self.reject(make_zip(names=order))
        for name in ('metadata.json', names[0].replace('/ios/', '/android/'),
                     '../' + names[0], '/' + names[0], names[0].replace('/', '\\'),
                     names[0].upper(), names[0].replace('/ios/', '/ios/../ios/')):
            self.reject(make_zip(names=(name,) + names[1:]))

    def test_nul_nonascii_and_local_name_disagreement(self):
        records = parts(make_zip())
        for section, offset in ((0, 30), (1, 46)):
            for value in (b'\0', b'\xff', b'X'):
                changed = [x[:] for x in records]
                raw = changed[0][section]
                changed[0][section] = raw[:offset] + value + raw[offset + 1:]
                self.reject(assemble(changed))

    def test_symlink_directory_device_fifo_modes_and_dos_directory_fail(self):
        for mode in (stat.S_IFLNK, stat.S_IFDIR, stat.S_IFCHR, stat.S_IFBLK, stat.S_IFIFO, stat.S_IFSOCK):
            self.reject(make_zip(mode=mode | 0o600))
        records = parts(make_zip())
        records[0][1] = number(records[0][1], 38, 0x10, 4)
        self.reject(assemble(records))

    def test_encryption_flags_stored_hints_methods_versions_and_host_fail(self):
        for offset, central_offset, values in ((6, 8, (1, 0x40, 0x2000, 0x8000)),
                                               (8, 10, (9, 12, 14, 99)),
                                               (4, 6, (9, 21, 45))):
            for value in values:
                records = parts(make_zip())
                records[0][0] = number(records[0][0], offset, value)
                records[0][1] = number(records[0][1], central_offset, value)
                self.reject(assemble(records))
        records = parts(make_zip(compression=zipfile.ZIP_STORED))
        records[0][0] = number(records[0][0], 6, 2)
        records[0][1] = number(records[0][1], 8, 2)
        self.reject(assemble(records))
        records = parts(make_zip())
        records[0][1] = number(records[0][1], 4, (19 << 8) | 20)
        self.reject(assemble(records))

    def test_zip64_path_override_unknown_and_malformed_extras_fail(self):
        extras = [struct.pack('<HHI', kind, 4, 0) for kind in (1, 0x7075, 0x6375, 0x9901, 42)]
        extras += [struct.pack('<HHB', 0x5455, 1, 1), struct.pack('<HHBI', 0x5455, 5, 8, 0),
                   struct.pack('<HHBI', 0x5455, 5, 1, 0) * 2, struct.pack('<HHI', 0x000a, 4, 0),
                   b'\x55\x54\x08\x00\x01', b'\x55']
        for extra in extras:
            self.reject(make_zip(extra=extra))

    def test_local_and_central_timestamp_extras_are_checked_independently(self):
        extra = struct.pack('<HHBI', 0x5455, 5, 1, 0)
        for section, fixed, name_offset in ((0, 30, 26), (1, 46, 28)):
            records = parts(make_zip(extra=extra))
            raw = records[0][section]
            location = fixed + struct.unpack_from('<H', raw, name_offset)[0]
            records[0][section] = number(raw, location, 1)
            self.reject(assemble(records))

    def test_eocd_counts_disks_comments_and_zip64_sentinels_fail(self):
        raw = make_zip()
        for relative, value, width in ((4, 1, 2), (6, 1, 2), (8, 12, 2), (10, 14, 2),
                                       (10, 0xffff, 2), (12, 0xffffffff, 4), (16, 0xffffffff, 4), (20, 1, 2)):
            self.reject(number(raw, len(raw) - 22 + relative, value, width))
        for suffix in (b'X', b'PK\x06\x06' + b'\0' * 40):
            self.reject(raw + suffix)

    def test_prefix_local_gap_central_gap_and_truncation_fail(self):
        raw = make_zip()
        self.reject(assemble(parts(raw), prefix=b'launcher'))
        records = parts(raw)
        records[4][0] += b'GAP'
        self.reject(assemble(records))
        self.reject(assemble(parts(raw), central_suffix=b'GAP'))
        for cut in (1, 21, 100, len(raw) // 2):
            self.reject(raw[:-cut])

    def test_central_record_reorder_offset_overlap_and_hidden_local_fail(self):
        raw = make_zip()
        c = central_start(raw)
        records = parts(raw)
        directory = b''.join(entry for _, entry in records[::-1])
        self.reject(raw[:c] + directory + raw[-22:])
        for offset in (0, 1, c - 1, 0xffffffff):
            second = c + len(records[0][1])
            self.reject(number(raw, second + 42, offset, 4))
        # A complete unlisted local entry is still hidden bytes, even with adjusted EOCD.
        records[0][0] += records[1][0]
        self.reject(assemble(records))

    def test_central_header_fields_and_local_agreement_fail(self):
        raw = make_zip()
        for offset, value, width in ((4, 10, 2), (6, 0x800, 2), (8, 0, 2),
                                     (10, 1, 2), (12, 1, 2), (14, 123, 4),
                                     (18, 1, 4), (22, 1, 4), (26, 1, 2), (28, 1, 2)):
            records = parts(raw)
            records[0][0] = number(records[0][0], offset, value, width)
            self.reject(assemble(records))
        for offset, value, width in ((32, 1, 2), (34, 1, 2), (20, 0, 4),
                                     (20, 0xffffffff, 4), (24, 0, 4), (24, 0xffffffff, 4)):
            records = parts(raw)
            records[0][1] = number(records[0][1], offset, value, width)
            self.reject(assemble(records))

    def test_actual_crc_corruption_and_hidden_deflate_tail_fail(self):
        for compression in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            records = parts(make_zip(compression=compression))
            local, entry = records[0]
            records[0] = [number(local, 14, 123, 4), number(entry, 16, 123, 4)]
            self.reject(assemble(records))
            records = parts(make_zip(compression=compression))
            local = bytearray(records[0][0])
            start = 30 + struct.unpack_from('<H', local, 26)[0]
            local[start] ^= 0x7f
            records[0][0] = bytes(local)
            self.reject(assemble(records))
        records = parts(make_zip())
        local, entry = records[0]
        packed = struct.unpack_from('<I', entry, 20)[0] + 6
        records[0] = [number(local + b'HIDDEN', 18, packed, 4), number(entry, 20, packed, 4)]
        self.reject(assemble(records))

    def test_descriptor_values_lengths_and_unflagged_descriptor_fail(self):
        original = parts(make_zip(streaming=True))
        for offset in (-16, -12, -8, -4):
            records = [x[:] for x in original]
            local = bytearray(records[5][0])
            local[offset] ^= 1
            records[5][0] = bytes(local)
            self.reject(assemble(records))
        records = [x[:] for x in original]
        records[5][0] = records[5][0][:-1]
        self.reject(assemble(records))
        records = [x[:] for x in original]
        records[5][0] = number(records[5][0], 6, 0)
        records[5][1] = number(records[5][1], 8, 0)
        self.reject(assemble(records))

    def test_cli_captured_envelope_preserves_originals_in_canonical_order(self):
        for platform in ('IOS', 'ANDROID'):
            raw = make_zip(platform, names=expected_names(platform)[::-1])
            completed = subprocess.run([sys.executable, str(SCRIPT), platform], input=raw,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
            self.assertEqual(completed.returncode, 0)
            self.assertEqual(completed.stderr, b'')
            envelope = json.loads(completed.stdout)
            self.assertEqual(tuple(envelope), expected_names(platform))
            self.assertEqual({name: base64.b64decode(value, validate=True) for name, value in envelope.items()},
                             reader.read_archive(raw, platform))

    def test_cli_failure_discloses_no_payload_path_or_traceback(self):
        for args, payload in ((['PRIVATE'], make_zip()), (['IOS'], b'PRIVATE_URL_SECRET_INVALID'),
                              (['IOS', '/private/unapproved'], make_zip()),
                              (['IOS'], b'x' * (reader.MAX_ARCHIVE + 1))):
            completed = subprocess.run([sys.executable, str(SCRIPT), *args], input=payload,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
            self.assertEqual(completed.returncode, 1)
            self.assertEqual(completed.stdout, b'')
            self.assertEqual(completed.stderr, b'PRIVATE_SOFTWARE_ARTIFACT_ZIP_INVALID\n')


if __name__ == '__main__':
    unittest.main()
