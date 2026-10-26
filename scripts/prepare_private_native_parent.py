"""Prepare local private Relay native source windows; never push or dispatch.

Only immutable local Git objects are read. Output uses local object alternates,
has no remote, and contains separate iOS/Android marker commits. Runtime native
evidence and protected installation must still occur through the real API route.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

BASELINE = 'f0a695a6bba068ba93962e90ab52e8901ef4a852'
BACKEND = '29597b27eeeb299205bf7d0555db0a90c38cc4be'
HISTORICAL_SOURCE = '3eb92fc8a622a3e09926d49f47243c163e32d009'
OLD_APP = '5bb116a530a4f6ebabd85bb3cbed62947c5c028d'
OLD_TREE = '538974beb448a6d64058fdda384e8c225fc0e42e'
OLD_POLICY = 'a79b136f33506a25f6476f17563f6926992db04f84ca4d72abfac95aa14322af'
WORKFLOW = '.github/workflows/r5-native-integration.yml'
POLICY = 'release/r5-native-integration/inputs.json'
MARKER = 'release/r5-native-integration/native-request.json'
CONTRACT = 'scripts/native-integration-contract.cjs'
REF = 'refs/heads/codex/r5-cloud-native-execution-20261025'
SHA = re.compile(r'[a-f0-9]{40}')
PIN_PATHS = (
    '.github/native-account/run.py', '.github/native-account/test_runner.py',
    '.github/native-account/test_source.py', '.github/native-integration/run.py',
    '.github/native-protected/run.py', '.github/native-protected/test_runner.py',
    '.github/native-recovery/admission.py', '.github/native-recovery/run.py',
    '.github/native-recovery/test_runner.py', CONTRACT, POLICY,
    'tests/nativeIntegrationSource.test.cjs', 'tests/nativeRecoveryFixture.test.cjs',
    'tests/support/nativeAccountFixture.cjs', 'tests/support/publicRecoveryPacket.cjs',
)
NODE_PATHS = tuple('scripts/verify-r5-native-' + suite + '.cjs'
                   for suite in ('protected', 'recovery', 'account'))


def require(condition, code):
    if not condition:
        raise ValueError(code)


def safe_environment(extra=None):
    # No source/API/signing/store credential, Git override or interactive helper
    # is inherited by source readers or by the generated-source guard checks.
    return {'PATH': os.defpath, 'LANG': 'C.UTF-8', 'GIT_CONFIG_NOSYSTEM': '1',
            'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0',
            'GIT_ALLOW_PROTOCOL': '', 'PYTHONDONTWRITEBYTECODE': '1',
            **(extra or {})}


def git(root, *args, extra=None):
    result = subprocess.run(['git', '--no-replace-objects', '-C', str(root),
                             '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
                             '-c', 'credential.helper=', *args], env=safe_environment(extra),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    require(result.returncode == 0, 'PRIVATE_PARENT_GIT_FAILED')
    require(len(result.stdout) <= 16 * 1024 * 1024, 'PRIVATE_PARENT_OUTPUT_TOO_LARGE')
    return result.stdout


def exact_path(value, *, exists=True):
    root = Path(value)
    require(root.is_absolute() and root.resolve() == root and not re.search(r'[\x00-\x1f]', str(root)),
            'PRIVATE_PARENT_PATH_ALIAS')
    require((root.is_dir() if exists else not root.exists()), 'PRIVATE_PARENT_PATH_INVALID')
    return root


def private_checkout(app_sha):
    require(isinstance(app_sha, str) and SHA.fullmatch(app_sha), 'PRIVATE_PARENT_SHA_INVALID')
    return '\n'.join([
        '      - name: Fetch fixed private app with scoped read identity',
        '        uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6',
        '        with:', '          repository: KeeperCommunity/bitcoin-keeper-private',
        '          ref: ' + app_sha, '          path: app',
        '          fetch-depth: 0',
        '          persist-credentials: false',
        '          token: ${{ secrets.KEEPER_PRIVATE_APP_CONTENTS_READ_TOKEN }}',
    ]) + '\n'


def replace_once(value, old, new):
    require(value.count(old) == 1, 'PRIVATE_PARENT_BASELINE_SHAPE_CHANGED')
    return value.replace(old, new)


def render(files, app_sha, app_tree):
    require(all(isinstance(v, str) and SHA.fullmatch(v) for v in (app_sha, app_tree)),
            'PRIVATE_PARENT_SHA_INVALID')
    original_policy = files[POLICY]
    require(hashlib.sha256(original_policy).hexdigest() == OLD_POLICY,
            'PRIVATE_PARENT_BASELINE_POLICY_CHANGED')
    policy = json.loads(original_policy)
    require(policy['app_sha'] == OLD_APP and policy['app_tree'] == OLD_TREE
            and policy['backend_base'] == BACKEND, 'PRIVATE_PARENT_BASELINE_POLICY_CHANGED')
    changed = {}
    for name in PIN_PATHS:
        text = files[name].decode()
        require(OLD_APP in text, 'PRIVATE_PARENT_BASELINE_PIN_MISSING')
        changed[name] = text.replace(OLD_APP, app_sha).replace(OLD_TREE, app_tree).encode()
    new_digest = hashlib.sha256(changed[POLICY]).hexdigest()
    changed[CONTRACT] = replace_once(changed[CONTRACT].decode(), OLD_POLICY, new_digest).encode()
    for name in NODE_PATHS:
        changed[name] = replace_once(files[name].decode(), "'22.23.3'", "'22.23.4'").encode()
    workflow = files[WORKFLOW].decode()
    start = workflow.index('      - name: Fetch fixed public app anonymously\n')
    end = workflow.index('      - name: Set up reviewed Node runtime\n', start)
    workflow = workflow[:start] + private_checkout(app_sha) + workflow[end:]
    workflow = replace_once(workflow, 'KEEPER_SOURCE_SHA: ' + OLD_APP, 'KEEPER_SOURCE_SHA: ' + app_sha)
    workflow = replace_once(workflow, "node-version: '22.23.3'", "node-version: '22.23.4'")
    changed[WORKFLOW] = workflow.encode()
    # The existing workflow policy forbids every secret. Admit only the exact
    # checkout input and prove that it is absent from all other step fields.
    test_path = 'tests/nativeIntegrationSource.test.cjs'
    test = changed[test_path].decode()
    test = replace_once(test,
        "  assert.ok(!text.includes('secrets.') && !text.includes('continue-on-error:') && !text.includes('workflow_dispatch:'));",
        """  assert.ok(!text.includes('continue-on-error:') && !text.includes('workflow_dispatch:'));
  const app = job.steps.find(step => step.name === 'Fetch fixed private app with scoped read identity');
  assert.equal(app.uses, 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803');
  assert.deepEqual(app.with, { repository: 'KeeperCommunity/bitcoin-keeper-private', ref: contract.APP,
    path: 'app', 'fetch-depth': 0, 'persist-credentials': false, token: '${{ secrets.KEEPER_PRIVATE_APP_CONTENTS_READ_TOKEN }}' });
  assert.equal((text.match(/secrets\\./g) || []).length, 1);
  assert.equal(app.env, undefined);""")
    test = replace_once(test, "  assert.equal(fs.existsSync(path.join(root, contract.MARKER)), false);",
        """  if (fs.existsSync(path.join(root, contract.MARKER))) {
    const marker = JSON.parse(fs.readFileSync(path.join(root, contract.MARKER), 'utf8'));
    contract.requestAdmission(marker, marker.platform, 'ci(r5): run combined native ' + marker.platform);
  }""")
    changed[test_path] = test.encode()
    require(set(changed) <= set(policy['control_paths']), 'PRIVATE_PARENT_UNREVIEWED_PATH')
    return changed


def local_checkout(source, destination, sha):
    # Object alternates are local read-only inputs. No remote or network fetch is
    # created, and generated commits live only in the output repository.
    objects = Path(git(source, 'rev-parse', '--path-format=absolute', '--git-path', 'objects').decode().strip())
    exact_path(objects)
    destination.mkdir(mode=0o700)
    git(destination, '-c', 'init.templateDir=', 'init', '--quiet')
    (destination / '.git/objects/info/alternates').write_text(str(objects) + '\n')
    git(destination, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', sha)
    require(git(destination, 'remote').strip() == b'', 'PRIVATE_PARENT_REMOTE_FORBIDDEN')


def commit(root, message, timestamp):
    git(root, 'add', '--all')
    identity = {'GIT_AUTHOR_NAME': 'Keeper private source preparation',
                'GIT_AUTHOR_EMAIL': 'private-preparation@example.invalid',
                'GIT_COMMITTER_NAME': 'Keeper private source preparation',
                'GIT_COMMITTER_EMAIL': 'private-preparation@example.invalid',
                'GIT_AUTHOR_DATE': str(timestamp) + ' +0000',
                'GIT_COMMITTER_DATE': str(timestamp) + ' +0000'}
    git(root, 'commit', '--quiet', '--no-gpg-sign', '-m', message, extra=identity)
    return git(root, 'rev-parse', 'HEAD').decode().strip()


def prepare(app_source, relay_source, app_sha, output):
    app_source, relay_source = exact_path(app_source), exact_path(relay_source)
    output = exact_path(output, exists=False)
    require(not output.is_relative_to(app_source) and not output.is_relative_to(relay_source),
            'PRIVATE_PARENT_ISOLATED_OUTPUT_REQUIRED')
    require(isinstance(app_sha, str) and SHA.fullmatch(app_sha), 'PRIVATE_PARENT_SHA_INVALID')
    tree = git(app_source, 'rev-parse', app_sha + '^{tree}').decode().strip()
    require(SHA.fullmatch(tree), 'PRIVATE_PARENT_TREE_INVALID')
    git(app_source, 'merge-base', '--is-ancestor', HISTORICAL_SOURCE, app_sha)
    paths = set(PIN_PATHS) | set(NODE_PATHS) | {WORKFLOW}
    files = {name: git(relay_source, 'show', BASELINE + ':' + name) for name in paths}
    changed = render(files, app_sha, tree)
    timestamp = int(git(app_source, 'show', '-s', '--format=%ct', app_sha).strip())
    output.mkdir(mode=0o700)
    control, app = output / 'control', output / 'app'
    local_checkout(relay_source, control, BASELINE)
    local_checkout(app_source, app, app_sha)
    for name, content in changed.items():
        (control / name).write_bytes(content)
    preparation = commit(control, 'Prepare private mobile native source without dispatch', timestamp)
    windows = {}
    for index, platform in enumerate(('IOS', 'ANDROID'), 1):
        (control / MARKER).write_text(json.dumps({'schema': 1, 'app_sha': app_sha, 'platform': platform}) + '\n')
        sha = commit(control, 'ci(r5): run combined native ' + platform, timestamp + index)
        git(control, 'update-ref', 'refs/heads/private-source-' + platform.lower(), sha)
        windows[platform] = {'sha': sha, 'tree': git(control, 'rev-parse', 'HEAD^{tree}').decode().strip(),
                             'runId': None, 'runAttempt': None, 'nativeAcceptance': 'NOT_RUN'}
    require(git(control, 'diff', '--name-only', windows['IOS']['sha'], windows['ANDROID']['sha']).decode().strip() == MARKER,
            'PRIVATE_PARENT_WINDOWS_DIFFER')
    receipt = {'schema': 1, 'state': 'PRIVATE_SOURCE_PREPARATION_ONLY',
               'app': {'repository': 'KeeperCommunity/bitcoin-keeper-private', 'repositoryId': 839671816,
                       'sha': app_sha, 'tree': tree, 'remoteIdentityVerified': False},
               'producer': {'repository': 'KeeperCommunity/bitcoin-keeper-relay', 'repositoryId': 496119449,
                            'baseline': BASELINE, 'ref': REF, 'preparation': preparation},
               'windows': windows, 'changedPaths': sorted(changed),
               'policySha256': hashlib.sha256(changed[POLICY]).hexdigest(),
               'pushed': False, 'dispatched': False, 'credentialsRead': False,
               'executionAllowed': False, 'releaseReady': False}
    target = output / 'preparation.private.json'
    fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(receipt, stream, indent=2)
        stream.write('\n')
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-source', required=True)
    parser.add_argument('--relay-source', required=True)
    parser.add_argument('--app-sha', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    prepare(args.app_source, args.relay_source, args.app_sha, args.output)
    print('PRIVATE_PARENT_SOURCE_PREPARED; NOT PUSHED; NATIVE NOT RUN; RELEASE NOT AUTHORIZED')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError, KeyError):
        print('PRIVATE_PARENT_PREPARATION_FAILED', file=sys.stderr)
        raise SystemExit(1)
