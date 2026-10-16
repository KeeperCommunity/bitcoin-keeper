#!/usr/bin/env python3
"""Compare the uncompressed payload entries of two Android APKs.

This is an inspection aid, not a WalletScrutiny build script or a Play attestation.
It never extracts archive entries to the filesystem.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile


CHUNK_SIZE = 1024 * 1024
MAX_ENTRIES = 100_000
MAX_ENTRY_BYTES = 2 * 1024**3
MAX_TOTAL_BYTES = 4 * 1024**3

# APK Signature Scheme v2/v3 blocks are outside ZIP entries. These names cover
# only root-level JAR/v1 signature material plus Play's certificate stamp.
JAR_SIGNATURE = re.compile(r"^META-INF/[^/]+\.(?:SF|RSA|DSA|EC)$")
DEX_FILE = re.compile(r"(?:^|/)classes\d*\.dex$")


def is_signing_only(name: str) -> bool:
    return (
        name == "META-INF/MANIFEST.MF"
        or name == "stamp-cert-sha256"
        or JAR_SIGNATURE.fullmatch(name) is not None
    )


def category(name: str) -> str:
    if DEX_FILE.search(name) or name.endswith(".dex"):
        return "dex"
    if name.startswith("assets/dexopt/") and name.endswith((".prof", ".profm")):
        return "baseline_profile"
    if name.startswith("lib/") and name.endswith(".so"):
        return "native_library"
    if name.endswith((".jsbundle", ".bundle")) or (
        name.startswith("assets/") and name.endswith(".js")
    ):
        return "javascript_bundle"
    if name == "AndroidManifest.xml":
        return "manifest"
    if name == "resources.arsc" or name.startswith("res/"):
        return "resource"
    if name.startswith("META-INF/"):
        return "metadata"
    if name.startswith("assets/"):
        return "asset"
    return "other"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_apk(path: Path) -> dict:
    if not path.is_file():
        raise ValueError(f"Not a regular file: {path}")

    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        if len(infos) > MAX_ENTRIES:
            raise ValueError(f"Too many ZIP entries in {path}: {len(infos)}")

        names = [info.filename for info in infos]
        duplicates = sorted(name for name, count in Counter(names).items() if count > 1)
        if duplicates:
            raise ValueError(f"Duplicate ZIP entry names in {path}: {duplicates}")

        files = [info for info in infos if not info.is_dir()]
        total_bytes = sum(info.file_size for info in files)
        if total_bytes > MAX_TOTAL_BYTES:
            raise ValueError(f"Declared uncompressed ZIP size exceeds limit in {path}")

        entries = {}
        for info in files:
            if info.file_size > MAX_ENTRY_BYTES:
                raise ValueError(f"ZIP entry exceeds size limit in {path}: {info.filename}")
            digest = hashlib.sha256()
            measured = 0
            # Passing ZipInfo selects the exact entry; reading to EOF checks its CRC.
            with archive.open(info) as stream:
                for chunk in iter(lambda: stream.read(CHUNK_SIZE), b""):
                    measured += len(chunk)
                    if measured > MAX_ENTRY_BYTES:
                        raise ValueError(f"ZIP entry exceeds size limit in {path}: {info.filename}")
                    digest.update(chunk)
            if measured != info.file_size:
                raise ValueError(f"Incorrect ZIP entry size in {path}: {info.filename}")
            entries[info.filename] = {"sha256": digest.hexdigest(), "size": measured}

    return {
        "path": str(path.resolve()),
        "apk_sha256": file_sha256(path),
        "payload_entry_count": len(entries),
        "entries": entries,
    }


def compare(reference: dict, rebuilt: dict) -> dict:
    reference_entries = reference["entries"]
    rebuilt_entries = rebuilt["entries"]
    differences = []
    ignored_signing_entries = []
    matching_payload_entries = 0

    for name in sorted(reference_entries.keys() | rebuilt_entries.keys()):
        before = reference_entries.get(name)
        after = rebuilt_entries.get(name)
        if before == after:
            if not is_signing_only(name):
                matching_payload_entries += 1
            continue

        status = (
            "only_reference" if after is None else
            "only_rebuilt" if before is None else
            "content_mismatch"
        )
        detail = {
            "path": name,
            "status": status,
            "category": "signing_only" if is_signing_only(name) else category(name),
            "reference": before,
            "rebuilt": after,
        }
        if is_signing_only(name):
            ignored_signing_entries.append(detail)
        else:
            differences.append(detail)

    return {
        "schema_version": 1,
        "verdict": "match" if not differences else "mismatch",
        "scope": "one APK versus one APK; uncompressed ZIP file entries",
        "reference": {key: value for key, value in reference.items() if key != "entries"},
        "rebuilt": {key: value for key, value in rebuilt.items() if key != "entries"},
        "summary": {
            "matching_payload_entries": matching_payload_entries,
            "payload_differences": len(differences),
            "ignored_signing_differences": len(ignored_signing_entries),
        },
        "differences": differences,
        "ignored_signing_entries": ignored_signing_entries,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference_apk", type=Path, help="Published reference APK")
    parser.add_argument("rebuilt_apk", type=Path, help="APK rebuilt from source")
    args = parser.parse_args()

    try:
        report = compare(inspect_apk(args.reference_apk), inspect_apk(args.rebuilt_apk))
    except (OSError, ValueError, RuntimeError, EOFError, NotImplementedError, zipfile.BadZipFile) as error:
        report = {"schema_version": 1, "verdict": "invalid_input", "error": str(error)}

    json.dump(report, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return {"match": 0, "mismatch": 1, "invalid_input": 2}[report["verdict"]]


if __name__ == "__main__":
    raise SystemExit(main())
