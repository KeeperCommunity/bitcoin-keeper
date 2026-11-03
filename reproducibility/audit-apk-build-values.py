#!/usr/bin/env python3
"""Check the seven public Android build inputs against an authenticated APK.

Values stay in memory. Neither successful results nor errors print or write them.
This is a configuration audit, not a source reproducibility verdict.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import urlsplit


FIELDS = (
    "CHANNEL_URL",
    "ENVIRONMENT",
    "HEXA_ID_MAINNET",
    "HEXA_ID_TESTNET",
    "RELAY",
    "SIGNING_SERVER_MAINNET",
    "SIGNING_SERVER_TESTNET",
)
FIELD_SET = set(FIELDS)
NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
RESOURCE_RE = re.compile(r"^\s*resource\s+0x[0-9a-fA-F]+\s+string/([A-Za-z_][A-Za-z0-9_]*)\s*$")
ANY_RESOURCE_RE = re.compile(r"^\s*resource\s+0x[0-9a-fA-F]+\s+")
DEFAULT_VALUE_RE = re.compile(r'^\s*\((?:default)?\)\s+"([^"\\]*)"\s*$')
ASSIGNMENT_RE = re.compile(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\S+)\s*$")


class AuditError(Exception):
    """An error whose message contains no build value."""


def check_tracked_allowlist() -> None:
    manifest = Path(__file__).with_name("android-inputs.json")
    try:
        inputs = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError):
        raise AuditError("cannot read the tracked Android input manifest") from None
    if inputs.get("environment_names") != list(FIELDS):
        raise AuditError("audited field names differ from the tracked Android allowlist")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_apk_hash(path: Path, expected: str) -> None:
    if not SHA256_RE.fullmatch(expected):
        raise AuditError("expected APK SHA-256 must have 64 hex characters")
    try:
        if not path.is_file() or sha256(path) != expected.lower():
            raise AuditError("APK does not match the expected SHA-256")
    except OSError:
        raise AuditError("cannot read APK") from None


def run_aapt2(aapt2: str, apk: Path) -> str:
    try:
        result = subprocess.run(
            [aapt2, "dump", "resources", str(apk)],
            capture_output=True,
            text=True,
            check=False,
        )
    except (OSError, UnicodeError):
        raise AuditError("could not inspect APK resources with aapt2") from None
    if result.returncode != 0:
        # aapt2 output can contain APK data, so never echo stdout or stderr.
        raise AuditError("aapt2 could not inspect APK resources")
    return result.stdout


def validate_field(name: str, value: str) -> None:
    if not value or any(char.isspace() for char in value):
        raise AuditError(f"APK field has an unsupported value: {name}")
    if name == "ENVIRONMENT":
        if value != "PRODUCTION":
            raise AuditError("APK environment is not production")
    elif name.startswith("HEXA_ID_"):
        if not re.fullmatch(r"[0-9a-fA-F]{64}", value):
            raise AuditError(f"APK field is not a 64-character identifier: {name}")
    else:
        try:
            parsed = urlsplit(value)
            valid = parsed.scheme == "https" and bool(parsed.hostname)
            valid = valid and not parsed.username and not parsed.password
            valid = valid and not parsed.query and not parsed.fragment
        except ValueError:
            valid = False
        if not valid:
            raise AuditError(f"APK field is not a simple HTTPS URL: {name}")


def read_apk_fields(resource_dump: str) -> dict[str, str]:
    lines = resource_dump.splitlines()
    positions: dict[str, list[int]] = {name: [] for name in FIELDS}
    for index, line in enumerate(lines):
        match = RESOURCE_RE.fullmatch(line)
        if match and match.group(1) in positions:
            positions[match.group(1)].append(index)

    values = {}
    for name in FIELDS:
        found = positions[name]
        if len(found) != 1:
            raise AuditError(f"APK must contain exactly one string resource named {name}")
        start = found[0] + 1
        end = next(
            (index for index in range(start, len(lines)) if ANY_RESOURCE_RE.match(lines[index])),
            len(lines),
        )
        defaults = [
            match.group(1)
            for line in lines[start:end]
            if (match := DEFAULT_VALUE_RE.fullmatch(line))
        ]
        if len(defaults) != 1:
            raise AuditError(f"APK must contain one plain default value for {name}")
        validate_field(name, defaults[0])
        values[name] = defaults[0]
    return values


def read_candidate_env(path: Path) -> dict[str, str]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        raise AuditError("cannot read candidate environment file") from None
    values = {}
    for number, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = ASSIGNMENT_RE.fullmatch(stripped)
        if not match:
            raise AuditError(f"candidate environment line {number} must be simple KEY=value")
        name, value = match.groups()
        if not NAME_RE.fullmatch(name):
            raise AuditError(f"candidate environment line {number} has an invalid name")
        if name in values:
            raise AuditError(f"duplicate candidate environment name at line {number}")
        values[name] = value
    return values


def compare_fields(apk_fields: dict[str, str], candidate: dict[str, str]) -> list[str]:
    if set(apk_fields) != FIELD_SET:
        raise AuditError("APK field set is incomplete")
    if set(candidate) != FIELD_SET:
        raise AuditError("candidate environment must contain exactly the seven audited names")
    return [name for name in FIELDS if apk_fields[name] != candidate[name]]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--expected-apk-sha256", required=True)
    parser.add_argument("--env-file", type=Path, help="optional seven-field candidate environment")
    parser.add_argument("--aapt2", default=shutil.which("aapt2"))
    args = parser.parse_args()
    if not args.aapt2:
        raise AuditError("aapt2 is required; pass --aapt2 or add it to PATH")
    check_tracked_allowlist()
    verify_apk_hash(args.apk, args.expected_apk_sha256)
    apk_fields = read_apk_fields(run_aapt2(args.aapt2, args.apk))
    print("APK matches the supplied SHA-256 and contains all seven audited build fields.")
    if args.env_file:
        different = compare_fields(apk_fields, read_candidate_env(args.env_file))
        if different:
            print("Candidate differs from APK for: " + ", ".join(different))
            return 1
        print("Candidate environment matches the APK for all seven fields.")
    print("This is a value audit, not a source reproducibility verdict.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AuditError as error:
        print(f"Android build value audit failed: {error}", file=sys.stderr)
        sys.exit(2)
