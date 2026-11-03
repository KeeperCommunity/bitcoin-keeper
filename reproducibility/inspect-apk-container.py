#!/usr/bin/env python3
"""Hash exact ZIP32 APK regions and APK signing-block pairs without extracting data.

This read-only inspection does not verify signatures, authenticate an APK, or
establish source reproducibility. Even an SDK metadata-only difference exits 1.
No entry contents, signing-block values, or decoded ZIP names are printed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys


CHUNK_SIZE = 1024 * 1024
MAX_APK_BYTES = 0xFFFFFFFF
MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024
MAX_SIGNING_BLOCK_BYTES = 64 * 1024 * 1024
MAX_SIGNING_PAIRS = 1024
EOCD_MAGIC = b"PK\x05\x06"
APK_MAGIC = b"APK Sig Block 42"
SDK_METADATA_ID = "0x504b4453"
SCOPE = (
    "Exact ZIP32 APK container bytes and APK signing-block pair values; "
    "no signature verification, artifact authentication, or reproducibility verdict"
)


def _read(stream, offset: int, size: int, limit: int) -> bytes:
    if offset < 0 or size < 0 or offset + size > limit:
        raise ValueError("APK region exceeds its containing boundary")
    stream.seek(offset)
    value = stream.read(size)
    if len(value) != size:
        raise ValueError("Truncated APK region")
    return value


def _region(stream, offset: int, size: int, limit: int) -> dict:
    if offset < 0 or size < 0 or offset + size > limit:
        raise ValueError("APK region exceeds its containing boundary")
    stream.seek(offset)
    digest = hashlib.sha256()
    remaining = size
    while remaining:
        chunk = stream.read(min(CHUNK_SIZE, remaining))
        if not chunk:
            raise ValueError("Truncated APK region")
        digest.update(chunk)
        remaining -= len(chunk)
    return {"offset": offset, "size": size, "sha256": digest.hexdigest()}


def _extra(data: bytes) -> None:
    position = 0
    nonzero_end = len(data.rstrip(b"\0"))
    while position < len(data):
        # Android zipalign also uses unstructured zero padding in local extras.
        if position >= nonzero_end:
            return
        if len(data) - position < 4:
            raise ValueError("Malformed ZIP extra field")
        field_id, size = struct.unpack_from("<HH", data, position)
        position += 4
        if field_id == 0x0001:
            raise ValueError("ZIP64 is unsupported")
        if position + size > len(data):
            raise ValueError("Malformed ZIP extra field")
        position += size


def _eocd(stream, file_size: int) -> tuple[int, int, int, int]:
    tail_size = min(file_size, 22 + 0xFFFF)
    tail_start = file_size - tail_size
    tail = _read(stream, tail_start, tail_size, file_size)
    candidates = []
    position = tail.find(EOCD_MAGIC)
    while position >= 0:
        if position + 22 <= len(tail):
            comment_size = struct.unpack_from("<H", tail, position + 20)[0]
            if position + 22 + comment_size == len(tail):
                candidates.append(position)
        position = tail.find(EOCD_MAGIC, position + 1)
    if len(candidates) != 1:
        raise ValueError("Missing or ambiguous ZIP end record")
    offset = tail_start + candidates[0]
    _, disk, cd_disk, disk_count, count, cd_size, cd_offset, _ = struct.unpack_from(
        "<4s4H2IH", tail, candidates[0]
    )
    if count == 0xFFFF or disk_count == 0xFFFF or cd_size == 0xFFFFFFFF or cd_offset == 0xFFFFFFFF:
        raise ValueError("ZIP64 is unsupported")
    if disk or cd_disk or disk_count != count:
        raise ValueError("Multi-disk ZIP is unsupported")
    if offset >= 20 and _read(stream, offset - 20, 4, file_size) == b"PK\x06\x07":
        raise ValueError("ZIP64 is unsupported")
    if cd_offset + cd_size != offset:
        raise ValueError("Central directory does not end at the ZIP end record")
    if cd_size > MAX_CENTRAL_DIRECTORY_BYTES:
        raise ValueError("Central directory exceeds inspection limit")
    return offset, cd_offset, cd_size, count


def _signing_block(stream, cd_offset: int, file_size: int) -> tuple[int, dict]:
    if cd_offset < 24 or _read(stream, cd_offset - 16, 16, file_size) != APK_MAGIC:
        return cd_offset, {"present": False}
    footer = _read(stream, cd_offset - 24, 24, file_size)
    size = struct.unpack_from("<Q", footer)[0]
    total_size = size + 8
    if size < 24 or total_size > cd_offset:
        raise ValueError("Invalid APK signing-block size")
    if total_size > MAX_SIGNING_BLOCK_BYTES:
        raise ValueError("APK signing block exceeds inspection limit")
    start = cd_offset - total_size
    if struct.unpack("<Q", _read(stream, start, 8, file_size))[0] != size:
        raise ValueError("APK signing-block size fields disagree")
    position, end = start + 8, cd_offset - 24
    pairs = []
    ids = set()
    while position < end:
        if len(pairs) >= MAX_SIGNING_PAIRS:
            raise ValueError("Too many APK signing-block pairs")
        pair_size = struct.unpack("<Q", _read(stream, position, 8, end))[0]
        if pair_size < 4 or position + 8 + pair_size > end:
            raise ValueError("Invalid APK signing-block pair size")
        pair_id = struct.unpack("<I", _read(stream, position + 8, 4, end))[0]
        if pair_id in ids:
            raise ValueError("Duplicate APK signing-block pair ID")
        ids.add(pair_id)
        value = _region(stream, position + 12, pair_size - 4, end)
        pairs.append({
            "id": f"0x{pair_id:08x}",
            "offset": position,
            "value_size": value["size"],
            "value_sha256": value["sha256"],
        })
        position += 8 + pair_size
    return start, {
        "present": True,
        **_region(stream, start, total_size, file_size),
        "framing": {
            "leading_size": _region(stream, start, 8, file_size),
            "footer": _region(stream, cd_offset - 24, 24, file_size),
        },
        "pairs": pairs,
    }


def _central_entries(stream, offset: int, size: int, count: int, local_end: int) -> list[dict]:
    position, end = offset, offset + size
    entries = []
    names, offsets = set(), set()
    for _ in range(count):
        header = _read(stream, position, 46, end)
        fields = struct.unpack("<4s6H3I5H2I", header)
        if fields[0] != b"PK\x01\x02":
            raise ValueError("Invalid ZIP central directory header")
        _, _, _, flags, method, _, _, crc, compressed, uncompressed, name_len, extra_len, comment_len, disk, _, _, local_offset = fields
        if compressed == 0xFFFFFFFF or uncompressed == 0xFFFFFFFF or local_offset == 0xFFFFFFFF:
            raise ValueError("ZIP64 is unsupported")
        if disk:
            raise ValueError("Multi-disk ZIP is unsupported")
        if flags & 0x0041:
            raise ValueError("Encrypted ZIP entries are unsupported")
        variable = _read(stream, position + 46, name_len + extra_len + comment_len, end)
        name = variable[:name_len]
        if not name or name in names:
            raise ValueError("Empty or duplicate raw ZIP entry name")
        if local_offset in offsets or local_offset >= local_end:
            raise ValueError("Invalid or duplicate local ZIP header offset")
        names.add(name)
        offsets.add(local_offset)
        _extra(variable[name_len:name_len + extra_len])
        header_size = 46 + len(variable)
        entries.append({
            "name": name,
            "name_sha256": hashlib.sha256(name).hexdigest(),
            "flags": flags,
            "method": method,
            "crc": crc,
            "compressed": compressed,
            "uncompressed": uncompressed,
            "local_offset": local_offset,
            "central_header": _region(stream, position, header_size, end),
        })
        position += header_size
    if position != end:
        raise ValueError("Central directory size or entry count disagrees")
    return entries


def _local_entries(stream, entries: list[dict], local_end: int) -> dict:
    result = {}
    position = 0
    ordered = sorted(entries, key=lambda entry: entry["local_offset"])
    for index, entry in enumerate(ordered):
        if entry["local_offset"] != position:
            raise ValueError("Gaps, overlapping entries, or a ZIP prefix are unsupported")
        end = ordered[index + 1]["local_offset"] if index + 1 < len(ordered) else local_end
        header = _read(stream, position, 30, end)
        magic, _, flags, method, _, _, crc, compressed, uncompressed, name_len, extra_len = struct.unpack("<4s5H3I2H", header)
        if magic != b"PK\x03\x04":
            raise ValueError("Invalid local ZIP header")
        if compressed == 0xFFFFFFFF or uncompressed == 0xFFFFFFFF:
            raise ValueError("ZIP64 is unsupported")
        variable = _read(stream, position + 30, name_len + extra_len, end)
        if variable[:name_len] != entry["name"] or flags != entry["flags"] or method != entry["method"]:
            raise ValueError("Local and central ZIP headers disagree")
        _extra(variable[name_len:])
        expected = (entry["crc"], entry["compressed"], entry["uncompressed"])
        observed = (crc, compressed, uncompressed)
        if flags & 8:
            if any(actual not in (0, wanted) for actual, wanted in zip(observed, expected)):
                raise ValueError("Local ZIP data-descriptor fields disagree")
        elif observed != expected:
            raise ValueError("Local and central ZIP sizes or CRC disagree")
        header_size = 30 + len(variable)
        data_offset = position + header_size
        data_end = data_offset + entry["compressed"]
        descriptor_size = end - data_end
        if flags & 8:
            if descriptor_size not in (12, 16):
                raise ValueError("Invalid or unsupported ZIP data descriptor")
            descriptor = _read(stream, data_end, descriptor_size, end)
            if descriptor_size == 16:
                if descriptor[:4] != b"PK\x07\x08":
                    raise ValueError("Invalid ZIP data descriptor signature")
                descriptor = descriptor[4:]
            if struct.unpack("<3I", descriptor) != expected:
                raise ValueError("ZIP data descriptor disagrees with central header")
        elif descriptor_size:
            raise ValueError("Gaps or overlapping ZIP entries are unsupported")
        result[entry["name_sha256"]] = {
            "local_header": _region(stream, position, header_size, end),
            "compressed_data": _region(stream, data_offset, entry["compressed"], end),
            "data_descriptor": _region(stream, data_end, descriptor_size, end),
            "central_header": entry["central_header"],
        }
        position = end
    if position != local_end:
        raise ValueError("Unaccounted bytes before the central directory or signing block")
    return dict(sorted(result.items()))


def inspect_apk(path: Path) -> dict:
    if not path.is_file():
        raise ValueError("Input is not a regular file")
    file_size = path.stat().st_size
    if file_size > MAX_APK_BYTES:
        raise ValueError("APK exceeds ZIP32 inspection limit")
    with path.open("rb") as stream:
        eocd_offset, cd_offset, cd_size, count = _eocd(stream, file_size)
        local_end, signing = _signing_block(stream, cd_offset, file_size)
        entries = _central_entries(stream, cd_offset, cd_size, count, local_end)
        entry_hashes = _local_entries(stream, entries, local_end)
        return {
            "schema_version": 1,
            "scope": SCOPE,
            "file_size": file_size,
            "file_sha256": _region(stream, 0, file_size, file_size)["sha256"],
            "zip_entry_count": count,
            "zip_regions": {
                "local_records": _region(stream, 0, local_end, file_size),
                "central_directory": _region(stream, cd_offset, cd_size, file_size),
                "eocd": _region(stream, eocd_offset, file_size - eocd_offset, file_size),
            },
            "signing_block": signing,
            "entries_by_raw_name_sha256": entry_hashes,
        }


def _bytes_equal(left: dict | None, right: dict | None) -> bool:
    if left is None or right is None:
        return left is right
    return (left["size"], left["sha256"]) == (right["size"], right["sha256"])


def compare(reference: dict, rebuilt: dict) -> dict:
    zip_differences = [
        name for name in reference["zip_regions"]
        if not _bytes_equal(reference["zip_regions"][name], rebuilt["zip_regions"][name])
    ]
    before_block, after_block = reference["signing_block"], rebuilt["signing_block"]
    before_pairs = {pair["id"]: pair for pair in before_block.get("pairs", [])}
    after_pairs = {pair["id"]: pair for pair in after_block.get("pairs", [])}
    pair_differences = []
    for pair_id in sorted(before_pairs.keys() | after_pairs.keys()):
        before, after = before_pairs.get(pair_id), after_pairs.get(pair_id)
        identity = lambda pair: None if pair is None else (pair["value_size"], pair["value_sha256"])
        if identity(before) != identity(after):
            pair_differences.append({
                "id": pair_id,
                "role": "sdk_dependency_metadata" if pair_id == SDK_METADATA_ID else "other_signing_block_data",
                "reference": before,
                "rebuilt": after,
            })
    before_order = [pair["id"] for pair in before_block.get("pairs", [])]
    after_order = [pair["id"] for pair in after_block.get("pairs", [])]
    framing_equal = before_block["present"] == after_block["present"] and all(
        _bytes_equal(before_block.get("framing", {}).get(name), after_block.get("framing", {}).get(name))
        for name in ("leading_size", "footer")
    )
    entry_differences = []
    matching_parts = {name: 0 for name in ("local_header", "compressed_data", "data_descriptor", "central_header")}
    before_entries = reference["entries_by_raw_name_sha256"]
    after_entries = rebuilt["entries_by_raw_name_sha256"]
    for name_hash in sorted(before_entries.keys() | after_entries.keys()):
        before, after = before_entries.get(name_hash), after_entries.get(name_hash)
        parts = []
        for name in matching_parts:
            if before is not None and after is not None and _bytes_equal(before[name], after[name]):
                matching_parts[name] += 1
            else:
                parts.append(name)
        if parts:
            entry_differences.append({"raw_name_sha256": name_hash, "differing_parts": parts})
    identical = reference["file_size"] == rebuilt["file_size"] and reference["file_sha256"] == rebuilt["file_sha256"]
    sdk_only = (
        not identical and not zip_differences and framing_equal and before_order == after_order
        and len(pair_differences) == 1 and pair_differences[0]["id"] == SDK_METADATA_ID
    )
    return {
        "schema_version": 1,
        "scope": SCOPE,
        "result": "identical" if identical else "different",
        "difference_scope": "none" if identical else "sdk_dependency_metadata_pair_only" if sdk_only else "other_package_data",
        "reference": {key: value for key, value in reference.items() if key != "entries_by_raw_name_sha256"},
        "rebuilt": {key: value for key, value in rebuilt.items() if key != "entries_by_raw_name_sha256"},
        "zip_region_differences": zip_differences,
        "signing_block_presence_equal": before_block["present"] == after_block["present"],
        "signing_block_framing_equal": framing_equal,
        "signing_block_pair_order_equal": before_order == after_order,
        "signing_block_pair_differences": pair_differences,
        "matching_entry_parts": matching_parts,
        "entry_differences": entry_differences,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference_apk", type=Path, help="APK to inspect; independently verify its signer and provenance")
    parser.add_argument("rebuilt_apk", type=Path, nargs="?", help="Optional second APK for exact-byte comparison")
    args = parser.parse_args()
    try:
        reference = inspect_apk(args.reference_apk)
        if args.rebuilt_apk is None:
            report, status = reference, 0
        else:
            report = compare(reference, inspect_apk(args.rebuilt_apk))
            status = 0 if report["result"] == "identical" else 1
    except (OSError, ValueError, struct.error) as error:
        # OSError text can contain input paths; print only the exception type.
        message = str(error) if isinstance(error, ValueError) else type(error).__name__
        report, status = {"schema_version": 1, "scope": SCOPE, "result": "invalid_input", "error": message}, 2
    json.dump(report, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
