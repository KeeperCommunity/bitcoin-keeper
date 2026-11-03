#!/usr/bin/env python3
"""Report Android source/dependency input gaps without reading environment values.

This passive, static audit is neither a build-input approval nor a reproducibility
verdict. It does not resolve Gradle dependencies or verify installed Yarn bytes.
"""

import argparse
import base64
from collections import Counter
import csv
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit


class AuditError(Exception):
    pass


CONFIG_PATH = "src/utils/service-utilities/config.ts"
SOURCE_FILES = (
    "package.json", "yarn.lock", CONFIG_PATH, "android/build.gradle",
    "android/app/build.gradle", "android/settings.gradle", "android/gradle.properties",
    "android/gradle/wrapper/gradle-wrapper.properties",
    "android/gradle/wrapper/gradle-wrapper.jar",
)
NAME_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
PACKAGE_RE = re.compile(r"(?:@[A-Za-z0-9_.-]+/)?[A-Za-z0-9_.-]+")
TOKEN_RE = re.compile(
    r"(?P<comment>//[^\n]*|/\*[\s\S]*?\*/)"
    r"|(?P<string>'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|`(?:\\.|[^`\\])*`)"
    r"|(?P<other>[A-Za-z_$][A-Za-z0-9_$]*|\S)"
)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tokens(source):
    return [match.group() for match in TOKEN_RE.finditer(source) if not match.group("comment")]


def configuration_names(source):
    """Inspect the repository's default import and static uppercase accesses only."""
    items = tokens(source)
    aliases = set()
    import_alias_positions = set()
    for index in range(len(items) - 3):
        if (items[index] == "import" and NAME_RE.fullmatch(items[index + 1])
                and items[index + 2] == "from"
                and items[index + 3] in ("'react-native-config'", '"react-native-config"')):
            aliases.add(items[index + 1])
            import_alias_positions.add(index + 1)
    if not aliases:
        raise AuditError("configuration module has no supported react-native-config default import")
    names = set()
    dynamic = 0
    unsupported = 0
    for index, token in enumerate(items):
        if token not in aliases or index in import_alias_positions:
            continue
        # A property with the same spelling as an import alias is not that alias.
        if (index and items[index - 1] == "."
                and items[max(0, index - 3):index] != [".", ".", "."]):
            continue
        access = index + 1
        if items[access:access + 2] == ["?", "."]:
            access += 2
            if access < len(items) and re.fullmatch(r"[A-Z][A-Z0-9_]*", items[access]):
                names.add(items[access])
                continue
        if (access + 1 < len(items) and items[access] == "."
                and re.fullmatch(r"[A-Z][A-Z0-9_]*", items[access + 1])):
            names.add(items[access + 1])
        elif access + 1 < len(items) and items[access] == "[":
            key = items[access + 1]
            if (access + 2 < len(items) and items[access + 2] == "]"
                    and re.fullmatch(r"['\"][A-Z][A-Z0-9_]*['\"]", key)):
                names.add(key[1:-1])
            else:
                dynamic += 1
        else:
            # Destructuring, passing/spreading the config object, and shadowing
            # cannot be resolved by this static scan. Keep the gap explicit.
            unsupported += 1
    return sorted(names), dynamic, unsupported


def approved_names(inputs):
    names = inputs.get("environment_names")
    if (not isinstance(names, list) or not names
            or any(not isinstance(name, str) or not NAME_RE.fullmatch(name) for name in names)
            or len(set(names)) != len(names)):
        raise AuditError("input manifest has an invalid environment name list")
    return sorted(names)


def package_names(header):
    try:
        selectors = next(csv.reader([header], skipinitialspace=True, strict=True))
    except csv.Error:
        raise AuditError("invalid Yarn entry header") from None
    names = set()
    for selector in selectors:
        match = PACKAGE_RE.match(selector)
        if not match or selector[match.end():match.end() + 1] != "@":
            raise AuditError("unsupported Yarn package selector")
        names.add(match.group())
    return sorted(names)


def valid_integrity(value):
    """Validate SRI encoding/length; presence does not authenticate installed files."""
    algorithms = []
    lengths = {"sha1": 20, "sha256": 32, "sha384": 48, "sha512": 64}
    for token in value.split():
        algorithm, separator, encoded = token.partition("-")
        if not separator or algorithm not in lengths:
            return None
        try:
            digest = base64.b64decode(encoded, validate=True)
        except (ValueError, base64.binascii.Error):
            return None
        if len(digest) != lengths[algorithm]:
            return None
        algorithms.append(algorithm)
    return algorithms or None


def yarn_report(source):
    entries = []
    entry = None
    for line in source.splitlines():
        if not line or line.startswith("#"):
            continue
        if not line[0].isspace():
            if not line.endswith(":"):
                raise AuditError("unsupported Yarn lockfile format")
            entry = {"packages": package_names(line[:-1])}
            entries.append(entry)
        elif entry is not None:
            match = re.fullmatch(r'  (resolved|integrity) (.+)', line)
            if match:
                field, value = match.groups()
                if field in entry:
                    raise AuditError("duplicate Yarn resolution or integrity field")
                entry[field] = value.strip('"')
    if not entries:
        raise AuditError("Yarn lockfile has no supported entries")
    algorithms = Counter()
    missing = []
    invalid = []
    unresolved = []
    git_entries = []
    commit_archives = []
    for entry in entries:
        names = entry["packages"]
        integrity = entry.get("integrity")
        if not integrity:
            missing.extend(names)
        else:
            parsed = valid_integrity(integrity)
            if parsed is None:
                invalid.extend(names)
            else:
                algorithms.update(parsed)
        resolved = entry.get("resolved", "")
        if not resolved:
            unresolved.extend(names)
        if resolved.startswith("git+") or resolved.startswith("git://"):
            revision = resolved.rsplit("#", 1)[-1]
            git_entries.append({"packages": names, "full_commit_pinned": bool(
                re.fullmatch(r"[0-9a-f]{40}", revision))})
        elif urlsplit(resolved).hostname == "codeload.github.com":
            revision = urlsplit(resolved).path.rsplit("/", 1)[-1]
            commit_archives.append({"packages": names, "full_commit_pinned": bool(
                re.fullmatch(r"[0-9a-f]{40}", revision))})
    return {
        "entries": len(entries), "integrity_algorithms": dict(sorted(algorithms.items())),
        "packages_without_integrity": sorted(set(missing)),
        "packages_with_invalid_integrity": sorted(set(invalid)),
        "packages_without_resolution": sorted(set(unresolved)), "git_entries": git_entries,
        "github_commit_archive_entries": commit_archives,
        "installed_bytes_verified": False,
    }


def gradle_dynamic_declarations(path, display_path):
    """Find literal Maven dynamic selectors; this is not dependency resolution."""
    source = path.read_text(encoding="utf-8")
    result = []
    coordinate_re = re.compile(r"([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([^\s]+)\Z")
    for match in TOKEN_RE.finditer(source):
        if not match.group("string") or match.group()[0] == "`":
            continue
        coordinate = match.group()[1:-1]
        parsed = coordinate_re.fullmatch(coordinate)
        if not parsed:
            continue
        version = parsed.group(3)
        if ("+" in version or version.startswith(("[", "(", "latest."))
                or version.endswith("-SNAPSHOT")):
            result.append({"path": display_path, "line": source.count("\n", 0, match.start()) + 1,
                           "coordinate": coordinate})
    return result


def realm_report(package):
    if not package.is_dir():
        return {"status": "not_inspected", "outside_gradle_downloads": []}
    downloads = []
    for path in sorted((package / "prebuilds/android").glob("*/share/cmake/Realm/*.cmake")):
        source = re.sub(r"#[^\n]*", "", path.read_text(encoding="utf-8"))
        for match in re.finditer(r"file\s*\(\s*DOWNLOAD\b([\s\S]*?)\)", source, re.I):
            body = match.group(1)
            literal_expected_hash = bool(re.search(r"\bEXPECTED_(?:HASH|MD5)\b", body))
            conditional_options = False
            for variable in re.findall(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}", body):
                conditional_options |= bool(re.search(
                    r"\bset\s*\(\s*" + re.escape(variable) + r"\s+EXPECTED_(?:HASH|MD5)\b", source))
            downloads.append({
                "path": path.relative_to(package).as_posix(),
                "sha256": sha256(path),
                "literal_expected_hash_argument": literal_expected_hash,
                "conditional_checksum_options_present": conditional_options,
            })
    return {"status": "inspected_static_cmake", "outside_gradle_downloads": downloads,
            "archive_bytes_verified": False, "cached_extracted_bytes_verified": False,
            "runtime_checksum_verification_executed": False}


def audit(repo, inputs_path, realm_package=None):
    inputs = json.loads(inputs_path.read_text(encoding="utf-8"))
    approved = approved_names(inputs)
    used, dynamic, unsupported = configuration_names((repo / CONFIG_PATH).read_text(encoding="utf-8"))
    fingerprints = {name: sha256(repo / name) for name in SOURCE_FILES if (repo / name).is_file()}
    fingerprints.update({path.relative_to(repo).as_posix(): sha256(path)
                         for path in sorted((repo / "patches").glob("*.patch"))})
    fingerprint = hashlib.sha256(json.dumps(fingerprints, sort_keys=True, separators=(",", ":"))
                                 .encode()).hexdigest()
    gradle_paths = list((repo / "android").rglob("*.gradle"))
    dependencies = repo / "node_modules"
    if dependencies.is_dir() and not dependencies.is_symlink():
        gradle_paths.extend(dependencies.rglob("*.gradle"))
    dynamic_gradle = []
    for path in sorted(gradle_paths):
        if any(part in ("build", ".gradle") for part in path.relative_to(repo).parts):
            continue
        dynamic_gradle.extend(gradle_dynamic_declarations(path, path.relative_to(repo).as_posix()))
    lockfiles = [path.relative_to(repo).as_posix() for path in sorted((repo / "android").rglob("*.lockfile"))
                 if not any(part in ("build", ".gradle") for part in path.relative_to(repo).parts)]
    return {
        "schema_version": 1, "reproducibility_verdict": "not_established",
        "source_input_fingerprint_sha256": fingerprint, "file_sha256": fingerprints,
        "chosen_manifest_yarn_hash_matches": fingerprints.get("yarn.lock") == inputs.get("yarn_lock_sha256"),
        "configuration": {"path": CONFIG_PATH, "static_names": used, "approved_names": approved,
                          "used_names_outside_allowlist": sorted(set(used) - set(approved)),
                          "approved_names_not_statically_used": sorted(set(approved) - set(used)),
                          "dynamic_key_accesses": dynamic,
                          "unsupported_alias_uses": unsupported,
                          "complete_environment_input_verified": False},
        "yarn": yarn_report((repo / "yarn.lock").read_text(encoding="utf-8")),
        "gradle": {"literal_dynamic_declarations": dynamic_gradle, "lockfiles": lockfiles,
                   "verification_metadata_present": (repo / "android/gradle/verification-metadata.xml").is_file(),
                   "local_dependency_gradle_files_inspected": dependencies.is_dir() and not dependencies.is_symlink(),
                   "resolved_versions_verified": False},
        "realm": realm_report(realm_package or dependencies / "realm"),
        "limitations": ["Only supported static accesses in the named configuration module are inspected.",
                        "Dynamic keys, destructuring and other unsupported alias uses leave names unresolved.",
                        "react-native-config can embed supplied names beyond static source references.",
                        "No environment files or values are read; configuration identity is unresolved.",
                        "No downloaded or installed dependency bytes are authenticated by this audit.",
                        "CMake option declarations do not verify runtime branches, selected hashes or execution.",
                        "Gradle declarations and metadata do not prove the historical resolved graph.",
                        "The file fingerprint covers listed build inputs and patches, not the entire source tree."],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--inputs", type=Path, default=Path(__file__).with_name("android-inputs.json"))
    parser.add_argument("--realm-package", type=Path, help="optional unpacked Realm npm package to inspect")
    args = parser.parse_args()
    try:
        report = audit(args.repo.resolve(), args.inputs, args.realm_package)
    except (AuditError, OSError, ValueError, KeyError):
        # Source literals, paths and parse error contents can contain private data.
        print("Android source audit failed; check readable supported source inputs.", file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
