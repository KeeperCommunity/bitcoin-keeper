"""Finite normal-arm64 profile on the existing immutable private parent preparer.

Delegates its local-only Git, source-pin, path, credential and isolated-output
rules unchanged. No remote, installation, dispatch or runtime acceptance occurs.
"""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/prepare_private_native_parent.py'
spec = importlib.util.spec_from_file_location('keeper_private_parent_preparer', SCRIPT)
parent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parent)
original_render = parent.render


def render(files, app_sha, app_tree):
    changed = original_render(files, app_sha, app_tree)
    workflow = changed[parent.WORKFLOW].decode()
    workflow = parent.replace_once(workflow, "'macos-15-intel'", "'macos-15'")
    workflow = parent.replace_once(workflow, 'Build one unsigned development native candidate',
                                   'Build one current-source development native candidate')
    workflow = parent.replace_once(workflow, """      - name: Check hosted iOS driver before the app build
        if: env.KEEPER_NATIVE_PLATFORM == 'IOS'
        working-directory: app
        run: python3 .github/native/hosted_native.py driver
""", '')
    changed[parent.WORKFLOW] = workflow.encode()
    path = 'tests/nativeIntegrationSource.test.cjs'
    test = parent.replace_once(changed[path].decode(), "['IOS', 'macos-15-intel']", "['IOS', 'macos-15']")
    test = parent.replace_once(test, "source.replace('macos-15-intel', 'macos-15')",
                               "source.replace('macos-15', 'macos-15-intel')")
    changed[path] = test.encode()
    policy = json.loads(changed[parent.POLICY])
    parent.require(set(changed) <= set(policy['control_paths']), 'PRIVATE_PARENT_UNREVIEWED_PATH')
    return changed


# The existing prepare()/main() keep their complete admission and output rules.
parent.render = render
if __name__ == '__main__':
    try:
        parent.main()
    except (ValueError, OSError, subprocess.SubprocessError, KeyError):
        print('PRIVATE_PARENT_PREPARATION_FAILED', file=sys.stderr)
        raise SystemExit(1)
