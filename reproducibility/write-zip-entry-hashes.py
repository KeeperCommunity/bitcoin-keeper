#!/usr/bin/env python3
"""Write a stable content-hash manifest for a diagnostic APK and AAB."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile


def entry_hashes(path: Path) -> list[dict[str, str | int]]:
    entries = []
    seen = set()
    with ZipFile(path) as archive:
        for entry in archive.infolist():
            if entry.is_dir():
                continue
            if entry.filename in seen:
                raise ValueError(f"Duplicate ZIP entry: {entry.filename}")
            seen.add(entry.filename)
            digest = hashlib.sha256()
            size = 0
            with archive.open(entry) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
                    size += len(block)
            if size != entry.file_size:
                raise ValueError(f"Incorrect ZIP entry size: {entry.filename}")
            entries.append({"path": entry.filename, "sha256": digest.hexdigest(), "size": size})
    return sorted(entries, key=lambda entry: entry["path"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", required=True, type=Path)
    parser.add_argument("--aab", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    result = {"apk": entry_hashes(args.apk), "aab": entry_hashes(args.aab)}
    args.output.write_text(json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
