"""Restore only reviewed Relay inputs as an authentic shallow sparse checkout."""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

COMMIT = '29597b27eeeb299205bf7d0555db0a90c38cc4be'
TREE = 'e9bc660c605c858bb6b34bd74bc9313183642305'
ARCHIVE_SHA256 = 'dc42bd5113ee5a06d818cb1705a8804e72d36317f4289543322a52b0ed0d1bae'
ARCHIVE = Path(__file__).with_name('protected-relay-inputs.json')


def git(directory, *args, data=None):
    env = {**os.environ, 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_SYSTEM': '/dev/null',
           'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_TERMINAL_PROMPT': '0'}
    return subprocess.check_output(['git', '-C', str(directory), '-c', 'core.hooksPath=/dev/null',
                                    *args], input=data, stderr=subprocess.PIPE, env=env, timeout=20)


def checked_archive(raw):
    if hashlib.sha256(raw).hexdigest() != ARCHIVE_SHA256:
        raise ValueError('PRIVATE_RELAY_ARCHIVE_CHANGED')
    data = json.loads(raw)
    if data['commit'] != COMMIT or data['tree'] != TREE or len(data['files']) != 17:
        raise ValueError('PRIVATE_RELAY_IDENTITY')
    decoded = {}
    for oid, item in data['objects'].items():
        kind = item['type']
        if kind not in ('commit', 'tree', 'blob'):
            raise ValueError('PRIVATE_RELAY_OBJECT_TYPE')
        value = base64.b64decode(item['base64'], validate=True)
        actual = hashlib.sha1(kind.encode() + b' ' + str(len(value)).encode() + b'\0' + value).hexdigest()
        if actual != oid:
            raise ValueError('PRIVATE_RELAY_OBJECT_CHANGED')
        decoded[oid] = (kind, value)
    if {oid for oid, (kind, _) in decoded.items() if kind == 'commit'} != {COMMIT}:
        raise ValueError('PRIVATE_RELAY_HISTORY_NOT_SELECTED')
    if {oid for oid, (kind, _) in decoded.items() if kind == 'blob'} != {f['oid'] for f in data['files'].values()}:
        raise ValueError('PRIVATE_RELAY_UNRELATED_SOURCE')
    for file, entry in data['files'].items():
        if Path(file).is_absolute() or any(p in ('', '.', '..', '.git') for p in file.split('/')):
            raise ValueError('PRIVATE_RELAY_SOURCE_PATH')
        kind, value = decoded[entry['oid']]
        if kind != 'blob' or hashlib.sha256(value).hexdigest() != entry['sha256']:
            raise ValueError('PRIVATE_RELAY_FILE_CHANGED')
    return data, decoded


def verify(directory):
    directory = Path(directory)
    data, _ = checked_archive(ARCHIVE.read_bytes())
    if directory.resolve() != directory or directory.is_symlink():
        raise ValueError('PRIVATE_RELAY_CHECKOUT_ALIAS')
    if git(directory, 'rev-parse', 'HEAD').decode().strip() != COMMIT:
        raise ValueError('PRIVATE_RELAY_CHECKOUT_COMMIT')
    if git(directory, 'rev-parse', 'HEAD^{tree}').decode().strip() != TREE:
        raise ValueError('PRIVATE_RELAY_CHECKOUT_TREE')
    if git(directory, 'remote').strip() or git(directory, 'status', '--porcelain', '--untracked-files=normal').strip():
        raise ValueError('PRIVATE_RELAY_CHECKOUT_CHANGED')
    for file, entry in data['files'].items():
        p = directory / file
        if p.resolve() != p or not p.is_file() or p.is_symlink():
            raise ValueError('PRIVATE_RELAY_FILE_ALIAS')
        raw = p.read_bytes()
        if hashlib.sha256(raw).hexdigest() != entry['sha256']:
            raise ValueError('PRIVATE_RELAY_FILE_CHANGED')
        if (p.stat().st_mode & 0o100 != 0) != (entry['mode'] == '100755'):
            raise ValueError('PRIVATE_RELAY_FILE_MODE')
        if git(directory, 'rev-parse', 'HEAD:' + file).decode().strip() != entry['oid']:
            raise ValueError('PRIVATE_RELAY_TREE_BINDING')
    return {'backend': COMMIT, 'tree': TREE, 'files': 17, 'archiveSha256': ARCHIVE_SHA256}


def restore(directory):
    directory = Path(directory)
    data, decoded = checked_archive(ARCHIVE.read_bytes())
    if not directory.is_absolute() or directory.parent.resolve() != directory.parent or directory.exists() or directory.is_symlink():
        raise ValueError('PRIVATE_RELAY_DESTINATION_NOT_FRESH')
    directory.mkdir(mode=0o700)
    git(directory, 'init', '--quiet')
    for oid, (kind, raw) in decoded.items():
        if git(directory, 'hash-object', '-t', kind, '-w', '--stdin', data=raw).decode().strip() != oid:
            raise ValueError('PRIVATE_RELAY_OBJECT_INSTALL')
    # A genuine shallow boundary preserves the original commit object and tree;
    # no parent history is fabricated, transferred or required by the test guard.
    (directory / '.git/shallow').write_text(COMMIT + '\n')
    git(directory, 'update-ref', 'HEAD', COMMIT)
    git(directory, 'config', 'core.sparseCheckout', 'true')
    (directory / '.git/info/sparse-checkout').write_text(''.join('/' + p + '\n' for p in data['files']))
    git(directory, 'read-tree', '-mu', 'HEAD')
    return verify(directory)


def main():
    if (len(sys.argv) != 2 or sys.argv[1] not in ('restore', 'verify') or
            os.environ.get('GITHUB_REPOSITORY') != 'KeeperCommunity/bitcoin-keeper-private' or
            os.environ.get('GITHUB_REPOSITORY_ID') != '839671816' or
            os.environ.get('GITHUB_JOB') != 'protected-backup-v3'):
        raise ValueError('PRIVATE_RELAY_CI_CONTEXT')
    workspace = Path(os.environ['GITHUB_WORKSPACE'])
    if not workspace.is_absolute() or workspace.resolve() != workspace:
        raise ValueError('PRIVATE_RELAY_WORKSPACE')
    action = restore if sys.argv[1] == 'restore' else verify
    print(json.dumps(action(workspace / 'backend')))


if __name__ == '__main__':
    main()
