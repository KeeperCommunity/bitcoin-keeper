"""Byte-level regressions for the static Android 16 KB evidence checker."""

import importlib.util
import io
import json
import pathlib
import struct
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile
from contextlib import redirect_stdout
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("check_android_16kb", pathlib.Path(__file__).with_name("check-android-16kb.py"))
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


def elf(loads=None, relros=None, machine=183):
    loads = loads or [(0, 0, 0x100, 0x100, 0x10000), (0x10000, 0x30000, 0x8000, 0x9000, 0x10000)]
    relros = [(0x10000, 0x30000, 0x6000, 0x6000)] if relros is None else relros
    headers = [(1, 6, offset, vaddr, vaddr, filesz, memsz, align) for offset, vaddr, filesz, memsz, align in loads]
    headers += [(CHECK.PT_GNU_RELRO, 4, offset, vaddr, vaddr, filesz, memsz, 1) for offset, vaddr, filesz, memsz in relros]
    size = max(64 + 56 * len(headers), *(x[2] + x[5] for x in headers))
    data = bytearray(size)
    data[:16] = b"\x7fELF" + bytes((2, 1, 1)) + bytes(9)
    struct.pack_into("<HHIQQQIHHHHHH", data, 16, 3, machine, 1, 0, 64, 0, 0, 64, 56, len(headers), 0, 0, 0)
    for index, header in enumerate(headers):
        struct.pack_into("<IIQQQQQQ", data, 64 + 56 * index, *header)
    return bytes(data)


def native_zip(payload, prefix="lib", aligned=True, compressed=False):
    out = io.BytesIO()
    entry = zipfile.ZipInfo(prefix + "/arm64-v8a/libexample.so")
    entry.compress_type = zipfile.ZIP_DEFLATED if compressed else zipfile.ZIP_STORED
    if aligned:
        padding = (-30 - len(entry.filename.encode()) - 4) % CHECK.PAGE
        entry.extra = struct.pack("<HH", 0xFFFF, padding) + bytes(padding)
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr(entry, payload)
    return out.getvalue()


class ElfAlignmentTests(unittest.TestCase):
    def test_local_jna_shape_load_passes_but_relro_prefix_lowers_program_alignment(self):
        result = CHECK.inspect_elf(elf())
        self.assertTrue(result["load_alignment_pass"])
        self.assertTrue(result["load_16kb_congruence_pass"])
        self.assertEqual(result["relro"][0]["end"], 0x36000)
        self.assertEqual(result["android17_effective_program_alignment"], 8192)
        self.assertFalse(result["android17_program_alignment_pass"])

    def test_corrected_relro_end_passes(self):
        result = CHECK.inspect_elf(elf(relros=[(0x10000, 0x30000, 0x8000, 0x8000)]))
        self.assertEqual(result["failures"], [])
        self.assertTrue(result["relro_end_alignment_pass"])

    def test_whole_load_relro_non_aligned_end_is_explicit_exemption(self):
        result = CHECK.inspect_elf(elf(relros=[(0x10000, 0x30000, 0x8000, 0x9000)]))
        self.assertFalse(result["relro_end_alignment_pass"])
        self.assertTrue(result["relro"][0]["covers_entire_matching_load"])
        self.assertTrue(result["android17_program_alignment_pass"])
        self.assertEqual(result["failures"], [])

    def test_load_overlap_fails_even_when_declared_alignment_passes(self):
        # The virtual byte ranges do not overlap, but their rounded 16 KB
        # pages do. p_align and file/virtual congruence alone miss this.
        result = CHECK.inspect_elf(elf(loads=[(0, 0, 0x100, 0x4100, 0x4000), (0x4100, 0x4100, 0x100, 0x100, 0x4000)], relros=[]))
        self.assertTrue(result["load_alignment_pass"])
        self.assertTrue(result["android17_load_page_overlap"])
        self.assertEqual(result["android17_effective_program_alignment"], 4096)

    def test_small_load_alignment_is_independent_failure(self):
        result = CHECK.inspect_elf(elf(loads=[(0, 0, 0x100, 0x100, 0x1000)], relros=[]))
        self.assertFalse(result["load_alignment_pass"])
        self.assertFalse(result["android17_program_alignment_pass"])

    def test_noncongruent_virtual_file_offsets_fail(self):
        result = CHECK.inspect_elf(elf(loads=[(0, 0x1000, 0x100, 0x100, 0x4000)], relros=[]))
        self.assertTrue(result["load_alignment_pass"])
        self.assertFalse(result["load_16kb_congruence_pass"])
        self.assertTrue(result["failures"])

    def test_multiple_relro_does_not_falsely_emulate_single_prefix_adjustment(self):
        result = CHECK.inspect_elf(elf(relros=[(0x10000, 0x30000, 0x6000, 0x6000), (0x10000, 0x30000, 0x4000, 0x4000)]))
        self.assertTrue(result["android17_program_alignment_pass"])
        self.assertFalse(result["relro_layout_pass"])

    def test_sub_4kb_relro_end_remains_unproved_even_if_bionic_does_not_lower_alignment(self):
        result = CHECK.inspect_elf(elf(relros=[(0x10000, 0x30000, 0x6000, 0x6001)]))
        self.assertTrue(result["android17_program_alignment_pass"])
        self.assertFalse(result["relro_layout_pass"])
        self.assertTrue(result["failures"])

    def test_no_relro_and_x86_64_are_supported(self):
        result = CHECK.inspect_elf(elf(relros=[], machine=62))
        self.assertEqual(result["abi"], "x86_64")
        self.assertEqual(result["failures"], [])

    def test_truncated_headers_or_wrong_abi_rejected(self):
        for payload in [b"", b"\x7fELF", elf()[:120]]:
            with self.assertRaises(CHECK.InspectionError):
                CHECK.inspect_elf(payload)
        with self.assertRaisesRegex(CHECK.InspectionError, "ABI"):
            CHECK.inspect_elf(elf(), expected_abi="x86_64")

    def test_out_of_file_segment_rejected(self):
        payload = bytearray(elf())
        struct.pack_into("<Q", payload, 64 + 32, len(payload) + 1)
        with self.assertRaises(CHECK.InspectionError):
            CHECK.inspect_elf(payload)


class ArchiveAlignmentTests(unittest.TestCase):
    def inspect_temp(self, data, suffix):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / ("artifact" + suffix)
            path.write_bytes(data)
            return CHECK.inspect_file(path)

    def test_apk_checks_actual_stored_data_offset(self):
        result = self.inspect_temp(native_zip(elf(relros=[])), ".apk")
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["libraries"][0]["apk_zip"]["data_offset"], CHECK.PAGE)

    def test_unaligned_stored_apk_fails(self):
        result = self.inspect_temp(native_zip(elf(relros=[]), aligned=False), ".apk")
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(result["libraries"][0]["apk_zip"]["status"], "FAIL")

    def test_aar_does_not_assert_final_apk_zip_alignment(self):
        result = self.inspect_temp(native_zip(elf(relros=[]), prefix="jni", aligned=False), ".aar")
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["libraries"][0]["apk_zip"]["status"], "NOT_APPLICABLE")

    def test_compressed_apk_is_not_uncompressed_zip_proof(self):
        result = self.inspect_temp(native_zip(elf(relros=[]), compressed=True), ".apk")
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(result["libraries"][0]["apk_zip"]["status"], "NOT_PROVEN")

    def test_malformed_zip_local_extra_length_is_rejected(self):
        payload = bytearray(native_zip(elf(relros=[])))
        struct.pack_into("<H", payload, 28, 65535)
        result = self.inspect_temp(payload, ".apk")
        self.assertEqual(result["status"], "FAIL")
        self.assertTrue(result["errors"])
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "malformed.apk"
            path.write_bytes(payload)
            cli = subprocess.run([sys.executable, str(pathlib.Path(CHECK.__file__)), str(path)], capture_output=True, text=True, check=False)
            self.assertEqual(cli.returncode, 1)
            self.assertEqual(json.loads(cli.stdout)["artifacts"][0]["status"], "FAIL")
            self.assertNotIn("Traceback", cli.stderr)

    def test_bare_zip_read_eof_is_recorded_and_cli_emits_failure_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "truncated.apk"
            path.write_bytes(native_zip(elf(relros=[])))
            # Python 3.9 zipfile can raise EOFError() with no message for a
            # malformed local header; newer versions may raise BadZipFile.
            with patch.object(CHECK.zipfile.ZipFile, "read", side_effect=EOFError()):
                result = CHECK.inspect_file(path)
                output = io.StringIO()
                with redirect_stdout(output):
                    status = CHECK.main([str(path)])
            self.assertEqual(result["status"], "FAIL")
            self.assertIn("lib/arm64-v8a/libexample.so: EOFError", result["errors"])
            self.assertEqual(status, 1)
            recorded = json.loads(output.getvalue())["artifacts"][0]
            self.assertEqual(recorded["status"], "FAIL")
            self.assertIn("lib/arm64-v8a/libexample.so: EOFError", recorded["errors"])

    def test_malformed_local_signature_is_rejected(self):
        payload = bytearray(native_zip(elf(relros=[])))
        payload[:4] = b"BAD!"
        result = self.inspect_temp(payload, ".apk")
        self.assertEqual(result["status"], "FAIL")
        self.assertTrue(result["errors"])

    def test_empty_archive_and_invalid_library_fail_closed(self):
        for payload in [native_zip(b"not ELF"), native_zip(elf(relros=[]), prefix="ignored")]:
            result = self.inspect_temp(payload, ".apk")
            self.assertEqual(result["status"], "FAIL")

    def test_duplicate_native_archive_path_fails_closed(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as archive, warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            for _ in range(2):
                archive.writestr("jni/arm64-v8a/libduplicate.so", elf(relros=[]))
        result = self.inspect_temp(out.getvalue(), ".aar")
        self.assertEqual(result["status"], "FAIL")
        self.assertTrue(any("duplicate" in x for x in result["errors"]))

    def test_cli_exit_and_evidence_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "local-shape.so"
            path.write_bytes(elf())
            result = subprocess.run([sys.executable, str(pathlib.Path(CHECK.__file__)), str(path)], capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 1)
            self.assertIn(CHECK.sha256(path.read_bytes()), result.stdout)


if __name__ == "__main__":
    unittest.main()
