#!/usr/bin/env python3
"""Read-only Phase B source/configuration inventory. Never handles secret values.

The output is preparation evidence, not an execution gate or release approval.
Only explicitly allowlisted metadata is included in the report.
"""
import argparse
import json
import pathlib
import re
import subprocess


PROPOSED_ENVIRONMENTS = ("keeper-release-ios", "keeper-release-android")
SOURCE_FILES = (
    "ios/fastlane/Fastfile", "android/fastlane/Fastfile",
    "ios/fastlane/Appfile", "android/fastlane/Appfile", "android/app/build.gradle",
)


def git(root, *args):
    return subprocess.check_output(
        ["git", "-C", str(root), *args], text=True, stderr=subprocess.DEVNULL
    ).strip()


def release_credential_literals(text):
    # Scope to the release signing block; Android's public debug credentials
    # intentionally remain distinct. Return field/line only, never its value.
    start = re.search(r"signingConfigs\s*\{\s*release\s*\{", text)
    if not start:
        return None
    position = start.end()
    depth = 1
    while position < len(text) and depth:
        depth += (text[position] == "{") - (text[position] == "}")
        position += 1
    if depth:
        return None
    body = text[start.end():position - 1]
    findings = []
    for match in re.finditer(r"\b(storePassword|keyPassword|keyAlias)\s*(?:=\s*)?['\"]", body):
        line = text[:start.end() + match.start()].count("\n") + 1
        findings.append({"field": match.group(1), "line": line})
    return findings


def environment_inventory(document):
    results = []
    if document is not None and (
        not isinstance(document, dict) or not isinstance(document.get("environments"), list)
    ):
        raise ValueError("invalid environment metadata")
    environments = document.get("environments", []) if document is not None else []
    for name in PROPOSED_ENVIRONMENTS:
        matches = [env for env in environments if isinstance(env, dict) and env.get("name") == name]
        if document is None:
            state = "UNKNOWN"
            reviewers = "UNKNOWN"
            branch_policy = "UNKNOWN"
        elif len(matches) != 1:
            state = "NOT_CONFIGURED" if not matches else "AMBIGUOUS"
            reviewers = branch_policy = "NOT_VERIFIED"
        else:
            state = "CONFIGURED_NOT_VERIFIED"
            env = matches[0]
            rules = env.get("protection_rules", [])
            review_rules = [rule for rule in rules if isinstance(rule, dict) and rule.get("type") == "required_reviewers"] if isinstance(rules, list) else []
            protected = len(review_rules) == 1 and review_rules[0].get("prevent_self_review") is True and bool(review_rules[0].get("reviewers"))
            reviewers = "PRESENT" if protected else "NOT_VERIFIED"
            policy = env.get("deployment_branch_policy")
            restricted = isinstance(policy, dict) and (policy.get("custom_branch_policies") is True or policy.get("protected_branches") is True)
            # A collection response cannot prove which exact branch is allowed,
            # bypass policy, or that reviewer enforcement actually works.
            branch_policy = "RESTRICTION_PRESENT_EXACT_RULES_UNVERIFIED" if restricted else "NOT_VERIFIED"
        results.append({"proposed_name": name, "state": state,
                        "independent_reviewers": reviewers, "source_restriction": branch_policy})
    return results


def inventory(root, environments=None):
    root = pathlib.Path(root)
    tracked = git(root, "ls-files", "-z").split("\0")
    php_count = sum(path.lower().endswith(".php") for path in tracked)
    composer_count = sum(pathlib.PurePosixPath(path).name in ("composer.json", "composer.lock") for path in tracked)
    source = {}
    for name in SOURCE_FILES:
        path = root / name
        source[name] = path.read_text() if path.is_file() else ""
    signing = release_credential_literals(source["android/app/build.gradle"])
    return {
        "schema": 1,
        "source_sha": git(root, "rev-parse", "HEAD"),
        "tracked_tree_dirty": bool(git(root, "status", "--porcelain", "--untracked-files=no")),
        "scope": "PHASE_B_PREPARATION_ONLY",
        "execution_allowed": False,
        "hosted_signing_distribution": "NOT_IMPLEMENTED_NOT_VERIFIED",
        "source_inventory": {"tracked_php_files": php_count, "tracked_composer_manifests": composer_count,
                             "deployed_runtime_inventory": "UNKNOWN", "php_exposure": "NOT_ESTABLISHED"},
        "android_release_literal_credentials": {"state": "UNKNOWN" if signing is None else "FOUND_REQUIRES_PRIVATE_TRIAGE" if signing else "NONE_IN_INSPECTED_BLOCK",
                                                "locations": signing or []},
        "existing_lanes": {
            "ios_build_only_acquires_signing_material": all(token in source["ios/fastlane/Fastfile"] for token in ("get_certificates(", "get_provisioning_profile(")),
            "ios_upload_action_present": "upload_to_testflight(" in source["ios/fastlane/Fastfile"],
            "android_upload_action_present": "upload_to_play_store(" in source["android/fastlane/Fastfile"],
            "lane_execution": "NOT_RUN",
        },
        "proposed_protected_environments": environment_inventory(environments),
        "credential_custody_and_authorization": "UNKNOWN_NOT_INSPECTED",
        "exact_head_native_security_physical_acceptance": "REQUIRES_SEPARATE_EVIDENCE",
        "owner_release_approval": "REQUIRES_SEPARATE_EXPLICIT_APPROVAL",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".")
    parser.add_argument("--environment-metadata", help="Optional read-only GitHub environments JSON; no credentials")
    args = parser.parse_args()
    try:
        metadata = None
        if args.environment_metadata:
            path = pathlib.Path(args.environment_metadata)
            if path.stat().st_size > 1024 * 1024:
                raise ValueError("metadata too large")
            metadata = json.loads(path.read_text())
        result = inventory(args.root, metadata)
    except (OSError, ValueError, TypeError, subprocess.CalledProcessError):
        # Do not echo exception text, input, file paths or credential-like data.
        parser.exit(2, "Release inventory unavailable: invalid source or metadata; no release action performed.\n")
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
