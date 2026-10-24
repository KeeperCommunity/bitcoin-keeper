#!/usr/bin/env python3
"""Inspect supplied ELF/AAR/APK bytes; this does not prove Android runtime support.

Primary references, checked 2026-10-15:
https://developer.android.com/guide/practices/page-sizes
https://android.googlesource.com/platform/bionic/+/06356e41c5ed7b12220b24c05ba4fdb873b126a7/linker/linker_phdr.cpp
https://android.googlesource.com/platform/bionic/+/06356e41c5ed7b12220b24c05ba4fdb873b126a7/linker/linker_phdr_16kib_compat.cpp

Keep LOAD alignment, RELRO end alignment, Android 17's effective program
alignment, and APK ZIP alignment separate. In particular, an unaligned RELRO
end covering its entire LOAD is exempt from Android 17's prefix adjustment.
AAR ZIP offsets say nothing about the final APK's packaging.
"""

import argparse
import hashlib
import json
import pathlib
import struct
import sys
import zipfile

PAGE = 16384
COMPAT_PAGE = 4096
PT_LOAD = 1
PT_GNU_RELRO = 0x6474E552
MACHINES = {183: "arm64-v8a", 62: "x86_64"}
ABIS = set(MACHINES.values())
MAX_LIBRARY_SIZE = 512 * 1024 * 1024


class InspectionError(ValueError):
    """The supplied artifact does not establish the requested static proof."""


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def inspect_elf(data, expected_abi=None):
    if len(data) < 64 or data[:4] != b"\x7fELF":
        raise InspectionError("missing or truncated ELF64 header")
    if data[4:7] != bytes((2, 1, 1)):
        raise InspectionError("expected a little-endian ELF64 version 1 library")
    fields = struct.unpack_from("<HHIQQQIHHHHHH", data, 16)
    elf_type, machine, version, _, phoff, _, _, ehsize, phentsize, phnum, *_ = fields
    if elf_type != 3 or version != 1 or ehsize != 64:
        raise InspectionError("expected a valid ELF64 ET_DYN shared library")
    if machine not in MACHINES:
        raise InspectionError("unsupported 64-bit ELF machine: %s" % machine)
    abi = MACHINES[machine]
    if expected_abi is not None and expected_abi != abi:
        raise InspectionError("ELF machine does not match archive ABI directory")
    if phentsize != 56 or not 0 < phnum <= 65536 // 56:
        raise InspectionError("invalid or unsupported ELF program-header table")
    if phoff < 64 or phoff % 8 or phoff + phentsize * phnum > len(data):
        raise InspectionError("program-header table is outside the supplied file")
    headers = []
    for index in range(phnum):
        ptype, flags, offset, vaddr, _, filesz, memsz, align = struct.unpack_from(
            "<IIQQQQQQ", data, phoff + index * phentsize
        )
        if ptype not in (PT_LOAD, PT_GNU_RELRO):
            continue
        if offset + filesz > len(data) or vaddr + memsz > 0xFFFFFFFFFFFFFFFF:
            raise InspectionError("segment range exceeds file or address space")
        if ptype == PT_LOAD and filesz > memsz:
            raise InspectionError("LOAD file size exceeds memory size")
        headers.append({
            "index": index, "type": "LOAD" if ptype == PT_LOAD else "GNU_RELRO",
            "flags": flags, "offset": offset, "vaddr": vaddr,
            "filesz": filesz, "memsz": memsz, "align": align,
        })
    loads = [x for x in headers if x["type"] == "LOAD"]
    relros = [x for x in headers if x["type"] == "GNU_RELRO"]
    if not loads:
        raise InspectionError("ELF has no LOAD segment")

    reasons = []
    load_alignment = all(x["align"] >= PAGE and x["align"] & (x["align"] - 1) == 0 for x in loads)
    load_congruence = all((x["vaddr"] - x["offset"]) % PAGE == 0 for x in loads)
    declared_congruence = all(x["align"] <= 1 or (x["vaddr"] - x["offset"]) % x["align"] == 0 for x in loads)
    if not load_alignment:
        reasons.append("LOAD p_align is not a power of two of at least 16384")
    if not load_congruence or not declared_congruence:
        reasons.append("LOAD virtual/file offsets are not congruent")

    # Mirror CheckProgramHeaderAlignment and FixMinAlignFor16KiB. Invalid
    # p_align values are separately rejected above, rather than silently ignored.
    effective = PAGE
    for item in loads:
        align = item["align"]
        if align > 1 and align & (align - 1) == 0:
            effective = min(effective, align)
    relro_details = []
    for item in relros:
        end = item["vaddr"] + item["memsz"]
        matching = next((x for x in loads if x["vaddr"] == item["vaddr"]), None)
        whole_load = matching is not None and matching["memsz"] <= item["memsz"]
        relro_details.append({
            **item, "end": end, "end_mod_16384": end % PAGE,
            "end_aligned": end % PAGE == 0,
            "matching_load_index": None if matching is None else matching["index"],
            "covers_entire_matching_load": whole_load,
        })
    if len(relro_details) == 1:
        item = relro_details[0]
        if item["matching_load_index"] is not None and not item["covers_entire_matching_load"]:
            lowbit = item["end"] & -item["end"]
            if lowbit >= COMPAT_PAGE:
                effective = min(effective, lowbit)
    overlap = False
    if effective >= PAGE:
        previous_end = 0
        for item in loads:
            if previous_end > item["vaddr"] // PAGE * PAGE:
                overlap = True
                effective = COMPAT_PAGE
                break
            previous_end = item["vaddr"] + item["memsz"]
    if effective < PAGE:
        reasons.append("Android 17 effective program alignment is %s" % effective)
    # The guide's end check is deliberately retained even when Android 17's
    # rejection logic does not inspect a non-prefix/multiple-RELRO layout.
    # Only the documented-in-source whole-LOAD exception is accepted here.
    relro_safe = all(x["end_aligned"] or x["covers_entire_matching_load"] for x in relro_details)
    if not relro_safe:
        reasons.append("nonaligned RELRO end has no whole-LOAD exemption")
    return {
        "abi": abi, "sha256": sha256(data), "size": len(data),
        "load_alignment_pass": load_alignment,
        "load_16kb_congruence_pass": load_congruence,
        "load_declared_congruence_pass": declared_congruence,
        "loads": loads, "relro": relro_details,
        "relro_end_alignment_pass": all(x["end_aligned"] for x in relro_details),
        "relro_layout_pass": relro_safe,
        "android17_effective_program_alignment": effective,
        "android17_program_alignment_pass": effective >= PAGE,
        "android17_load_page_overlap": overlap,
        "failures": reasons,
    }


def inspect_apk_entry(archive_data, info):
    """Read the LOCAL header; central-directory header_offset is not data offset."""
    start = info.header_offset
    if start < 0 or start + 30 > len(archive_data):
        raise InspectionError("APK local ZIP header is outside the file")
    fields = struct.unpack_from("<IHHHHHIIIHH", archive_data, start)
    signature, _, flags, method, _, _, crc, compressed, size, name_len, extra_len = fields
    if signature != 0x04034B50:
        raise InspectionError("invalid APK local ZIP header signature")
    data_offset = start + 30 + name_len + extra_len
    if data_offset + info.compress_size > len(archive_data):
        raise InspectionError("APK ZIP entry data is outside the supplied file")
    local_name = archive_data[start + 30:start + 30 + name_len]
    try:
        local_name = local_name.decode("utf-8" if flags & 0x800 else "cp437")
    except UnicodeDecodeError as exc:
        raise InspectionError("invalid APK local filename encoding") from exc
    if local_name != info.filename or method != info.compress_type or flags != info.flag_bits:
        raise InspectionError("APK local and central ZIP headers disagree")
    if flags & 1:
        raise InspectionError("encrypted native APK entry is unsupported")
    if not flags & 8 and (crc != info.CRC or compressed not in (info.compress_size, 0xFFFFFFFF) or size not in (info.file_size, 0xFFFFFFFF)):
        raise InspectionError("APK local and central ZIP size/CRC fields disagree")
    if method != zipfile.ZIP_STORED:
        return {"status": "NOT_PROVEN", "method": method, "data_offset": data_offset,
                "reason": "compressed native entry: extraction/manifest and runtime require separate proof"}
    if info.compress_size != info.file_size:
        raise InspectionError("STORED ZIP entry sizes differ")
    aligned = data_offset % PAGE == 0
    return {"status": "PASS" if aligned else "FAIL", "method": method,
            "data_offset": data_offset, "data_offset_mod_16384": data_offset % PAGE}


def inspect_file(path):
    path = pathlib.Path(path)
    result = {"path": str(path), "libraries": [], "errors": []}
    try:
        data = path.read_bytes()
        result["sha256"] = sha256(data)
        suffix = path.suffix.lower()
        if suffix == ".so":
            item = inspect_elf(data)
            item.update({"entry": path.name, "apk_zip": {"status": "NOT_APPLICABLE"}})
            result["libraries"].append(item)
            result["kind"] = "ELF"
        elif suffix in (".aar", ".apk"):
            result["kind"] = suffix[1:].upper()
            with zipfile.ZipFile(path) as archive:
                seen = set()
                for info in archive.infolist():
                    parts = info.filename.split("/")
                    prefix = "lib" if suffix == ".apk" else "jni"
                    if len(parts) != 3 or parts[0] != prefix or parts[1] not in ABIS or not parts[2].endswith(".so"):
                        continue
                    try:
                        if info.filename in seen:
                            raise InspectionError("duplicate native ZIP entry")
                        seen.add(info.filename)
                        if info.file_size > MAX_LIBRARY_SIZE:
                            raise InspectionError("native entry exceeds inspection size limit")
                        item = inspect_elf(archive.read(info), expected_abi=parts[1])
                        item["entry"] = info.filename
                        item["apk_zip"] = inspect_apk_entry(data, info) if suffix == ".apk" else {"status": "NOT_APPLICABLE"}
                        if item["apk_zip"]["status"] not in ("PASS", "NOT_APPLICABLE"):
                            item["failures"].append("APK ZIP packaging is " + item["apk_zip"]["status"])
                        result["libraries"].append(item)
                    except (InspectionError, ValueError, RuntimeError, EOFError, zipfile.BadZipFile, struct.error) as exc:
                        result["errors"].append(info.filename + ": " + (str(exc) or type(exc).__name__))
        else:
            raise InspectionError("expected an explicit .so, .aar, or .apk input")
        if not result["libraries"]:
            result["errors"].append("no supported retained 64-bit native libraries inspected")
    except (OSError, InspectionError, ValueError, zipfile.BadZipFile, struct.error) as exc:
        result["errors"].append(str(exc))
    result["status"] = "FAIL" if result["errors"] or any(x["failures"] for x in result["libraries"]) else "PASS"
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifacts", nargs="+", help="explicit .so, .aar, or .apk paths")
    args = parser.parse_args(argv)
    results = [inspect_file(x) for x in args.artifacts]
    print(json.dumps({
        "schema": 1, "page_size": PAGE,
        "scope": "static supplied bytes only; runtime, Portal behavior and production AAB/split identity remain separate",
        "artifacts": results,
    }, indent=2, sort_keys=True))
    return 1 if any(x["status"] != "PASS" for x in results) else 0


if __name__ == "__main__":
    sys.exit(main())
