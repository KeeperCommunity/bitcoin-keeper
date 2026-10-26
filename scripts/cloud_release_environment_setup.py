#!/usr/bin/env python3
"""Generate a secret-free environment PUT body or verify metadata; never call an API."""
import argparse
import json
import sys

NAMES = ("keeper-release-ios", "keeper-release-android")


def payload(reviewer_type=None, reviewer_id=None):
    optional = reviewer_type is None and reviewer_id is None
    if not optional and (reviewer_type not in ("User", "Team") or type(reviewer_id) is not int or reviewer_id <= 0):
        raise ValueError("reviewer required")
    return {"wait_timer": 0, "prevent_self_review": True, "can_admins_bypass": False,
            "reviewers": [] if optional else [{"type": reviewer_type, "id": reviewer_id}],
            "deployment_branch_policy": {"protected_branches": True, "custom_branch_policies": False}}


def verify(value, name, reviewer_type=None, reviewer_id=None):
    payload(reviewer_type, reviewer_id)
    if name not in NAMES or not isinstance(value, dict):
        raise ValueError("invalid metadata")
    rules = value.get("protection_rules")
    reviews = [r for r in rules if isinstance(r, dict) and r.get("type") == "required_reviewers"] if isinstance(rules, list) else []
    selected = reviews[0].get("reviewers") if len(reviews) == 1 else None
    identity = (isinstance(selected, list) and len(selected) == 1 and
                isinstance(selected[0], dict) and selected[0].get("type") == reviewer_type and
                isinstance(selected[0].get("reviewer"), dict) and
                type(selected[0]["reviewer"].get("id")) is int and selected[0]["reviewer"]["id"] == reviewer_id)
    optional = reviewer_type is None and reviewer_id is None
    valid_review = not reviews or (len(reviews) == 1 and reviews[0].get("prevent_self_review") is True and
                                  isinstance(selected, list) and len(selected) > 0)
    policy = value.get("deployment_branch_policy")
    checks = {"name": value.get("name") == name,
              "protection_rules_observed": isinstance(rules, list),
              "admin_bypass_disabled": value.get("can_admins_bypass") is False,
              "optional_review_configuration": valid_review if optional else valid_review and identity,
              "protected_branches_only": isinstance(policy, dict) and
              policy.get("protected_branches") is True and policy.get("custom_branch_policies") is False}
    return {"environment": name, "checks": checks, "metadata_verified": all(checks.values()),
            "human_review_required": False,
            "enforcement_verified": False, "execution_allowed": False}


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate metadata")
        value[key] = item
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("plan", "verify"))
    parser.add_argument("--reviewer-type", choices=("User", "Team"))
    parser.add_argument("--reviewer-id", type=int)
    parser.add_argument("--name", choices=NAMES)
    args = parser.parse_args()
    try:
        if args.operation == "plan":
            result = payload(args.reviewer_type, args.reviewer_id)
        else:
            raw = sys.stdin.buffer.read(1024 * 1024 + 1)
            if not raw or len(raw) > 1024 * 1024:
                raise ValueError("metadata unavailable")
            result = verify(json.loads(raw, object_pairs_hook=unique_object), args.name,
                            args.reviewer_type, args.reviewer_id)
        print(json.dumps(result, indent=2))
        return 0 if args.operation == "plan" or result["metadata_verified"] else 1
    except (ValueError, TypeError, KeyError):
        parser.exit(2, "Environment metadata unavailable or invalid; no API or release action performed.\n")


if __name__ == "__main__":
    sys.exit(main())
