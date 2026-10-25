#!/usr/bin/env python3
"""Fail closed on known path, configuration, and toolchain drift before an Android build.

This is an input check, not a complete build recipe or reproducibility verdict.
Environment values are never printed or written to an output file.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


class InputError(Exception):
    pass


KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
ASSIGNMENT_RE = re.compile(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=")


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_env_names(path):
    """Read only names; deliberately never retain or show the values."""
    names = set()
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = ASSIGNMENT_RE.match(stripped)
        if not match:
            raise InputError(f"invalid environment assignment at line {line_number}")
        name = match.group(1)
        if name in names:
            raise InputError(f"duplicate environment name: {name}")
        names.add(name)
    return names


def expected_env_names(expected):
    if not isinstance(expected, list) or not expected:
        raise InputError("pinned environment name list is missing or empty")
    names = set()
    for name in expected:
        if not isinstance(name, str) or not KEY_RE.fullmatch(name):
            raise InputError("invalid pinned environment name")
        if name in names:
            raise InputError(f"duplicate pinned environment name: {name}")
        names.add(name)
    return names


def check_env_names(env_file, expected_names):
    actual = read_env_names(env_file)
    approved = expected_env_names(expected_names)
    unexpected = sorted(actual - approved)
    missing = sorted(approved - actual)
    if unexpected or missing:
        parts = []
        if unexpected:
            parts.append("unexpected environment names: " + ", ".join(unexpected))
        if missing:
            parts.append("missing environment names: " + ", ".join(missing))
        raise InputError("; ".join(parts))


def check_local_dependencies(repo):
    dependencies = repo / "node_modules"
    if dependencies.is_symlink() or not dependencies.is_dir():
        raise InputError("node_modules must be a real directory inside this checkout")
    root = dependencies.resolve()
    for current, directories, files in os.walk(dependencies, followlinks=False):
        for name in directories + files:
            path = Path(current) / name
            if path.is_symlink():
                try:
                    target = path.resolve(strict=True)
                except (OSError, RuntimeError):
                    raise InputError("node_modules contains a broken or cyclic symlink") from None
                if not target.is_relative_to(root):
                    raise InputError("node_modules contains a symlink outside this checkout")


def run(*command, cwd=None):
    try:
        result = subprocess.run(command, cwd=cwd, check=True, capture_output=True, text=True)
    except (OSError, subprocess.CalledProcessError):
        raise InputError(f"cannot run required command: {command[0]}") from None
    return result.stdout + result.stderr


def check_source(repo, commit):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise InputError("expected source commit must be a full 40-character SHA")
    actual = run("git", "rev-parse", "HEAD", cwd=repo).strip()
    if actual != commit:
        raise InputError("checkout HEAD differs from expected source commit")
    if run("git", "status", "--porcelain=v1", "--untracked-files=normal", cwd=repo).strip():
        raise InputError("source checkout has uncommitted files")


def check_hash(path, expected, label):
    if not path.is_file() or sha256(path) != expected:
        raise InputError(f"{label} differs from the pinned hash")


def check_gradle_distribution(repo, expected):
    wrapper = (repo / "android/gradle/wrapper/gradle-wrapper.properties").read_text(encoding="utf-8")
    if f"distributionSha256Sum={expected}" not in wrapper.splitlines():
        raise InputError("Gradle distribution checksum differs from the pinned hash")


def sdk_revision(path):
    properties = path / "source.properties"
    if not properties.is_file():
        raise InputError(f"Android SDK package missing: {path.name}")
    for line in properties.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"Pkg\.Revision\s*=\s*(\S+)\s*", line)
        if match:
            return match.group(1)
    raise InputError(f"Android SDK package has no revision: {path.name}")


def check_toolchain(inputs, sdk_root):
    node = run("node", "--version").strip().removeprefix("v")
    yarn = run("yarn", "--version").strip()
    java_output = run("java", "-XshowSettings:properties", "-version")
    java_match = re.search(r"^\s*java\.version\s*=\s*(\S+)\s*$", java_output, re.MULTILINE)
    if (node, yarn, java_match.group(1) if java_match else None) != (
        inputs["node"], inputs["yarn"], inputs["java"]
    ):
        raise InputError("Node, Yarn, or JDK version differs from pinned Android inputs")
    for package, revision in inputs["android_packages"].items():
        if sdk_revision(sdk_root / package) != revision:
            raise InputError(f"Android SDK package revision differs: {package}")
    platform = inputs["android_platform"]
    if sdk_revision(sdk_root / platform["path"]) != platform["revision"]:
        raise InputError("Android platform revision differs from pinned Android inputs")
    if not (sdk_root / platform["path"] / "android.jar").is_file():
        raise InputError("pinned Android platform is missing")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--android-sdk-root", type=Path, default=None)
    args = parser.parse_args()
    repo = args.repo.resolve()
    sdk_root = args.android_sdk_root or os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if not sdk_root:
        raise InputError("ANDROID_HOME or ANDROID_SDK_ROOT is required")
    sdk_root = Path(sdk_root).resolve()
    inputs = json.loads((repo / "reproducibility/android-inputs.json").read_text(encoding="utf-8"))
    check_source(repo, args.source_commit)
    check_hash(repo / "yarn.lock", inputs["yarn_lock_sha256"], "yarn.lock")
    check_hash(
        repo / "android/gradle/wrapper/gradle-wrapper.jar",
        inputs["gradle_wrapper_jar_sha256"],
        "Gradle wrapper JAR",
    )
    check_gradle_distribution(repo, inputs["gradle_distribution_sha256"])
    check_local_dependencies(repo)
    check_env_names(args.env_file, inputs["environment_names"])
    check_toolchain(inputs, sdk_root)
    print("Android build inputs verified; this is not a reproducibility verdict.")


if __name__ == "__main__":
    try:
        main()
    except (InputError, OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"Android input check failed: {error}", file=sys.stderr)
        sys.exit(1)
