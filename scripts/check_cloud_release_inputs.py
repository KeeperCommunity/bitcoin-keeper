#!/usr/bin/env python3
"""Read-only frozen Ruby/Pod/Nitro input check. No install or release operation."""
import argparse
import json
import pathlib
import sys

from cloud_release_worker import digest, ruby_lock_compatibility

INPUTS = ("Gemfile", "Gemfile.lock", "package.json", "yarn.lock", "ios/Podfile.lock")


def inspect(root):
    ruby_lock_compatibility(root)
    return {
        "schema": 1,
        "state": "INPUTS_ALIGNED",
        "execution_allowed": False,
        "frozen_installation_verified": False,
        "native_acceptance_verified": False,
        "input_sha256": {name: digest(root / name) for name in INPUTS},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=pathlib.Path, default=pathlib.Path("."))
    args = parser.parse_args()
    try:
        result = inspect(args.root)
    except (OSError, ValueError, KeyError, TypeError):
        print('Frozen release inputs rejected; no input changed or operation allowed.', file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
