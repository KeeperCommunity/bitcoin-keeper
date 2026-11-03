import hashlib
import io
import json
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile, ZipInfo


SCRIPT = Path(__file__).with_name("inspect-apk-container.py")
SPEC = spec_from_file_location("inspect_apk_container", SCRIPT)
MODULE = module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
V2 = 0x7109871A
SDK = 0x504B4453
PADDING = 0x42726577
DEFAULT_PAIRS = [(V2, b"synthetic-signature"), (SDK, b"encrypted-sdk-data")]


class NonSeekable(io.BytesIO):
    def seek(self, *args):
        raise io.UnsupportedOperation("seek")


def zip_bytes(entries=None, compression=ZIP_STORED, date=(2026, 10, 12, 0, 0, 0),
              comment=b"", extra=b"", descriptor=False):
    buffer = NonSeekable() if descriptor else io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with ZipFile(buffer, "w") as archive:
            archive.comment = comment
            for name, value in entries or [("classes.dex", b"synthetic-dex")]:
                info = ZipInfo(name, date)
                info.compress_type = compression
                info.extra = extra
                archive.writestr(info, value)
    return buffer.getvalue()


def apk_bytes(pairs=DEFAULT_PAIRS, **kwargs):
    data = zip_bytes(**kwargs)
    if pairs is None:
        return data
    eocd = data.rfind(MODULE.EOCD_MAGIC)
    cd_offset = struct.unpack_from("<I", data, eocd + 16)[0]
    pair_bytes = b"".join(struct.pack("<QI", len(value) + 4, pair_id) + value for pair_id, value in pairs)
    size = len(pair_bytes) + 24
    block = struct.pack("<Q", size) + pair_bytes + struct.pack("<Q", size) + MODULE.APK_MAGIC
    result = bytearray(data[:cd_offset] + block + data[cd_offset:])
    struct.pack_into("<I", result, eocd + len(block) + 16, cd_offset + len(block))
    return bytes(result)


class ContainerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.counter = 0

    def write(self, data):
        self.counter += 1
        path = Path(self.directory.name) / f"input-{self.counter}.apk"
        path.write_bytes(data)
        return path

    def inspect(self, data):
        return MODULE.inspect_apk(self.write(data))

    def compare(self, first, second):
        return MODULE.compare(self.inspect(first), self.inspect(second))

    def assertInvalid(self, data, message):
        with self.assertRaisesRegex(ValueError, message):
            self.inspect(data)

    def test_hashes_cover_every_byte_without_printing_contents_or_names(self):
        name, secret = "private-config-field", b"private-config-value"
        data = apk_bytes(entries=[(name, secret)], comment=b"private-comment")
        report = self.inspect(data)
        self.assertEqual(report["file_sha256"], hashlib.sha256(data).hexdigest())
        self.assertEqual(report["zip_entry_count"], 1)
        regions = list(report["zip_regions"].values()) + [report["signing_block"]]
        self.assertEqual(sum(region["size"] for region in regions), len(data))
        for region in regions:
            raw = data[region["offset"]:region["offset"] + region["size"]]
            self.assertEqual(region["sha256"], hashlib.sha256(raw).hexdigest())
        raw_name_hash = hashlib.sha256(name.encode()).hexdigest()
        self.assertIn(raw_name_hash, report["entries_by_raw_name_sha256"])
        output = json.dumps(report)
        for sensitive in (name, secret.decode(), "private-comment", "synthetic-signature", "encrypted-sdk-data"):
            self.assertNotIn(sensitive, output)

    def test_unsigned_zip_and_empty_zip_are_inspected_without_authentication_claim(self):
        report = self.inspect(apk_bytes(pairs=None))
        self.assertEqual(report["signing_block"], {"present": False})
        self.assertIn("no signature verification", report["scope"])
        buffer = io.BytesIO()
        with ZipFile(buffer, "w"):
            pass
        self.assertEqual(self.inspect(buffer.getvalue())["zip_entry_count"], 0)

    def test_identical_and_sdk_only_differences(self):
        original = apk_bytes()
        self.assertEqual(self.compare(original, original)["result"], "identical")
        changed = apk_bytes(pairs=[(V2, DEFAULT_PAIRS[0][1]), (SDK, b"encrypted-sdk-datb")])
        report = self.compare(original, changed)
        self.assertEqual(report["result"], "different")
        self.assertEqual(report["difference_scope"], "sdk_dependency_metadata_pair_only")
        self.assertEqual(report["zip_region_differences"], [])
        self.assertEqual(report["entry_differences"], [])
        self.assertEqual(report["signing_block_pair_differences"][0]["id"], "0x504b4453")
        self.assertTrue(report["signing_block_framing_equal"])

    def test_signature_unknown_and_padding_pairs_remain_critical(self):
        for pair_id in (V2, 0x12345678, PADDING):
            with self.subTest(pair_id=pair_id):
                first = apk_bytes(pairs=[(pair_id, b"first"), (SDK, b"same")])
                second = apk_bytes(pairs=[(pair_id, b"other"), (SDK, b"same")])
                report = self.compare(first, second)
                self.assertEqual(report["difference_scope"], "other_package_data")
                self.assertEqual(report["signing_block_pair_differences"][0]["role"], "other_signing_block_data")

    def test_pair_order_presence_and_sdk_length_changes_are_reported(self):
        original = apk_bytes()
        for changed in (apk_bytes(pairs=list(reversed(DEFAULT_PAIRS))), apk_bytes(pairs=None),
                        apk_bytes(pairs=[DEFAULT_PAIRS[0], (SDK, b"longer-sdk-metadata")])):
            with self.subTest(size=len(changed)):
                report = self.compare(original, changed)
                self.assertEqual(report["difference_scope"], "other_package_data")
        reordered = self.compare(original, apk_bytes(pairs=list(reversed(DEFAULT_PAIRS))))
        self.assertFalse(reordered["signing_block_pair_order_equal"])
        self.assertEqual(reordered["signing_block_pair_differences"], [])

    def test_payload_and_packaging_changes_are_distinguished(self):
        original = apk_bytes()
        payload = self.compare(original, apk_bytes(entries=[("classes.dex", b"synthetic-Dex")]))
        self.assertEqual(payload["difference_scope"], "other_package_data")
        self.assertIn("compressed_data", payload["entry_differences"][0]["differing_parts"])
        timestamp = self.compare(original, apk_bytes(date=(2026, 10, 11, 0, 0, 0)))
        self.assertEqual(timestamp["matching_entry_parts"]["compressed_data"], 1)
        self.assertIn("local_header", timestamp["entry_differences"][0]["differing_parts"])
        compression = self.compare(original, apk_bytes(compression=ZIP_DEFLATED))
        self.assertIn("compressed_data", compression["entry_differences"][0]["differing_parts"])

    def test_added_removed_entries_are_reported_using_name_hashes(self):
        report = self.compare(apk_bytes(), apk_bytes(entries=[("classes.dex", b"synthetic-dex"), ("assets/new", b"new")]))
        entry = next(item for item in report["entry_differences"] if item["raw_name_sha256"] == hashlib.sha256(b"assets/new").hexdigest())
        self.assertEqual(set(entry["differing_parts"]), set(report["matching_entry_parts"]))

    def test_signed_and_unsigned_data_descriptors(self):
        original = zip_bytes(descriptor=True)
        first = self.inspect(original)
        entry = next(iter(first["entries_by_raw_name_sha256"].values()))
        self.assertEqual(entry["data_descriptor"]["size"], 16)
        offset = entry["data_descriptor"]["offset"]
        unsigned = bytearray(original[:offset] + original[offset + 4:])
        eocd = unsigned.rfind(MODULE.EOCD_MAGIC)
        cd_offset = struct.unpack_from("<I", unsigned, eocd + 16)[0]
        struct.pack_into("<I", unsigned, eocd + 16, cd_offset - 4)
        second = self.inspect(bytes(unsigned))
        self.assertEqual(next(iter(second["entries_by_raw_name_sha256"].values()))["data_descriptor"]["size"], 12)
        corrupt = bytearray(original)
        corrupt[offset + 4] ^= 1
        self.assertInvalid(corrupt, "data descriptor disagrees")

    def test_android_zero_padding_and_well_formed_extra_are_accepted(self):
        for extra in (b"\0", b"\0" * 3, b"\0" * 17, struct.pack("<HH", 0xCAFE, 3) + b"abc" + b"\0" * 2):
            with self.subTest(extra_size=len(extra)):
                self.assertEqual(self.inspect(apk_bytes(extra=extra))["zip_entry_count"], 1)

    def test_missing_trailing_and_ambiguous_eocd_are_rejected(self):
        self.assertInvalid(b"not a ZIP", "ZIP end record")
        self.assertInvalid(apk_bytes() + b"trailing", "ZIP end record")
        fake = struct.pack("<4s4H2IH", MODULE.EOCD_MAGIC, 0, 0, 0, 0, 0, 0, 0)
        self.assertInvalid(apk_bytes(comment=fake), "ambiguous")

    def test_eocd_bounds_counts_and_multidisk_are_rejected(self):
        for relative, fmt, value, message in ((16, "I", 1, "Central directory"),
                                               (12, "I", 1, "Central directory"),
                                               (8, "H", 2, "Multi-disk"),
                                               (4, "H", 1, "Multi-disk")):
            with self.subTest(relative=relative):
                data = bytearray(apk_bytes())
                struct.pack_into("<" + fmt, data, data.rfind(MODULE.EOCD_MAGIC) + relative, value)
                self.assertInvalid(data, message)

    def test_zip64_sentinels_locator_and_extras_are_rejected(self):
        for relative, fmt, value in ((8, "H", 0xFFFF), (10, "H", 0xFFFF),
                                     (12, "I", 0xFFFFFFFF), (16, "I", 0xFFFFFFFF)):
            with self.subTest(relative=relative):
                data = bytearray(apk_bytes())
                struct.pack_into("<" + fmt, data, data.rfind(MODULE.EOCD_MAGIC) + relative, value)
                self.assertInvalid(data, "ZIP64")
        data = bytearray(apk_bytes())
        eocd = data.rfind(MODULE.EOCD_MAGIC)
        data[eocd - 20:eocd - 16] = b"PK\x06\x07"
        self.assertInvalid(data, "ZIP64")
        self.assertInvalid(apk_bytes(extra=struct.pack("<HHQ", 1, 8, 12)), "ZIP64")

    def test_duplicate_names_offsets_and_bad_extras_are_rejected(self):
        self.assertInvalid(apk_bytes(entries=[("same", b"first"), ("same", b"other")]), "duplicate raw ZIP")
        data = bytearray(apk_bytes(entries=[("a", b"one"), ("b", b"two")]))
        report = self.inspect(data)
        headers = sorted(entry["central_header"]["offset"] for entry in report["entries_by_raw_name_sha256"].values())
        struct.pack_into("<I", data, headers[1] + 42, 0)
        self.assertInvalid(data, "duplicate local ZIP")
        for extra in (b"\x01", struct.pack("<HH", 0xCAFE, 5) + b"x"):
            with self.subTest(extra_size=len(extra)):
                self.assertInvalid(apk_bytes(extra=extra), "Malformed ZIP extra")

    def test_malformed_local_and_central_headers_and_gap_are_rejected(self):
        original = apk_bytes()
        report = self.inspect(original)
        central = report["zip_regions"]["central_directory"]["offset"]
        for offset, value, message in ((0, b"bad!", "local ZIP header"), (central, b"bad!", "central directory header"),
                                        (8, b"\x08\x00", "headers disagree"), (14, b"bad!", "CRC disagree"),
                                        (central + 42, struct.pack("<I", 1), "Gaps")):
            with self.subTest(offset=offset):
                data = bytearray(original)
                data[offset:offset + len(value)] = value
                self.assertInvalid(data, message)

    def test_signing_block_sizes_pair_bounds_duplicates_and_limits(self):
        original = apk_bytes()
        report = self.inspect(original)
        block = report["signing_block"]
        mutations = ((block["offset"], "Q", 1, "size fields disagree"),
                     (block["offset"] + block["size"] - 24, "Q", 1, "Invalid APK signing-block size"),
                     (block["offset"] + 8, "Q", 3, "pair size"),
                     (block["offset"] + 8, "Q", 0xFFFFFFFFFFFFFFFF, "pair size"))
        for offset, fmt, value, message in mutations:
            with self.subTest(offset=offset, value=value):
                data = bytearray(original)
                struct.pack_into("<" + fmt, data, offset, value)
                self.assertInvalid(data, message)
        self.assertInvalid(apk_bytes(pairs=[(V2, b"one"), (V2, b"two")]), "Duplicate APK signing-block pair")
        with patch.object(MODULE, "MAX_SIGNING_BLOCK_BYTES", 16):
            self.assertInvalid(original, "inspection limit")
        with patch.object(MODULE, "MAX_SIGNING_PAIRS", 1):
            self.assertInvalid(original, "Too many")
        with patch.object(MODULE, "MAX_APK_BYTES", 16):
            self.assertInvalid(original, "ZIP32 inspection limit")
        with patch.object(MODULE, "MAX_CENTRAL_DIRECTORY_BYTES", 16):
            self.assertInvalid(original, "Central directory exceeds")

    def test_truncated_pair_prefix_and_signing_magic_are_rejected(self):
        original = apk_bytes(pairs=[])
        report = self.inspect(original)
        offset = report["signing_block"]["offset"]
        # A block with four pair bytes cannot contain its eight-byte length.
        data = bytearray(original[:offset + 8] + b"1234" + original[offset + 8:])
        struct.pack_into("<Q", data, offset, 28)
        struct.pack_into("<Q", data, offset + 12, 28)
        eocd = data.rfind(MODULE.EOCD_MAGIC)
        struct.pack_into("<I", data, eocd + 16, report["zip_regions"]["central_directory"]["offset"] + 4)
        self.assertInvalid(data, "containing boundary")
        data = bytearray(apk_bytes())
        block = self.inspect(data)["signing_block"]
        data[block["offset"] + block["size"] - 1] ^= 1
        self.assertInvalid(data, "Gaps")

    def test_cli_inspection_comparison_exit_codes_and_safe_errors(self):
        first = self.write(apk_bytes())
        sdk_changed = self.write(apk_bytes(pairs=[DEFAULT_PAIRS[0], (SDK, b"encrypted-sdk-datb")]))
        invalid = self.write(b"invalid APK")
        for arguments, expected in (([first], 0), ([first, first], 0), ([first, sdk_changed], 1), ([invalid], 2)):
            with self.subTest(expected=expected, inputs=len(arguments)):
                result = subprocess.run([sys.executable, str(SCRIPT), *map(str, arguments)], capture_output=True, text=True)
                self.assertEqual(result.returncode, expected, result.stderr)
                self.assertEqual(json.loads(result.stdout)["schema_version"], 1)
                self.assertEqual(result.stderr, "")
        missing = Path(self.directory.name) / "private-config-value.apk"
        result = subprocess.run([sys.executable, str(SCRIPT), str(missing)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertNotIn("private-config-value", result.stdout)


if __name__ == "__main__":
    unittest.main()
