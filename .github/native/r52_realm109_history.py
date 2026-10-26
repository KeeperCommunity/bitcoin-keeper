"""Provision only 28 approved historical Git objects; never checkout or fetch.

The original public commit, its ten path trees and the 17 fixture-authorized
blobs are a tiny fixed non-delta pack. No parent history, unrelated blobs, refs,
index or application files are imported. Run the staged helper before probes.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import subprocess
import sys
import zlib

HISTORICAL = '2b6c3ce56857b5dc92f17cc37453ff308d5a3ae8'
TREE = '92f252cdcb7941e6211f891261e2e0594b42f585'
FIXTURE = 'tests/recovery/fixtures/realm109-node-source.json'
FIXTURE_SHA256 = 'bc46b37001c423f96e8aff5ed3e8b63a3ac261224e5647a1dab13179eb54d4d2'
BUNDLE_SHA256 = '07aaa45bb0158b78ee9af7dd0d9efceda9941a2214c5a318a7a4a0193b0c18a9'
BUNDLE = 'r52_realm109_objects.json'
TREE_PATHS = ['/', 'src', 'src/models', 'src/models/enums', 'src/services',
              'src/services/wallets', 'src/services/wallets/enums', 'src/storage',
              'src/storage/realm', 'src/storage/realm/schema']


def require(value):
    if not value:
        raise RuntimeError('REALM109_HISTORY_PROVISION_REJECTED')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def parse(raw):
    def pairs(rows):
        result = {}
        for key, value in rows:
            require(key not in result)
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: require(False))


def regular(path, limit=65536):
    require(path.is_absolute() and path.parent.resolve(strict=True) == path.parent)
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1 and
            0 < before.st_size <= limit)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as source:
        raw = source.read(limit + 1); after = os.fstat(source.fileno())
    require(len(raw) == before.st_size and all(getattr(before, key) == getattr(after, key) for key in
        ['st_dev', 'st_ino', 'st_mode', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns']))
    return raw


def unpack(pack, rows):
    """Bound and verify every object before allowing Git to write the pack."""
    require(32 <= len(pack) <= 32768 and pack[:4] == b'PACK' and
            struct.unpack('>II', pack[4:12]) == (2, 28) and
            hashlib.sha1(pack[:-20]).digest() == pack[-20:])
    require(type(rows) is list and len(rows) == 28)
    declared = {}
    for row in rows:
        require(type(row) is dict and set(row) == {'oid', 'type', 'path', 'size_bytes', 'sha256'} and
                re.fullmatch('[a-f0-9]{40}', row['oid']) and row['oid'] not in declared and
                row['type'] in ['commit', 'tree', 'blob'] and type(row['size_bytes']) is int and
                0 < row['size_bytes'] <= 65536 and re.fullmatch('[a-f0-9]{64}', row['sha256']))
        declared[row['oid']] = row
    offset, objects, total = 12, {}, 0
    for _ in range(28):
        require(offset < len(pack) - 20)
        byte = pack[offset]; offset += 1
        kind = {1: 'commit', 2: 'tree', 3: 'blob'}.get((byte >> 4) & 7)
        require(kind is not None)  # No delta/base objects or implicit extra closure.
        size, shift = byte & 15, 4
        while byte & 128:
            require(offset < len(pack) - 20 and shift <= 28)
            byte = pack[offset]; offset += 1
            size |= (byte & 127) << shift; shift += 7
        require(0 < size <= 65536)
        compressed = pack[offset:-20]
        decoder = zlib.decompressobj()
        raw = decoder.decompress(compressed, size + 1)
        require(len(raw) == size and decoder.eof and not decoder.unconsumed_tail)
        consumed = len(compressed) - len(decoder.unused_data)
        require(consumed > 0); offset += consumed; total += size
        oid = hashlib.sha1(kind.encode() + b' ' + str(size).encode() + b'\0' + raw).hexdigest()
        require(total <= 131072 and oid in declared and oid not in objects)
        row = declared[oid]
        require(row['type'] == kind and row['size_bytes'] == size and row['sha256'] == sha(raw))
        objects[oid] = (kind, raw)
    require(offset == len(pack) - 20 and set(objects) == set(declared))
    return objects


def tree_entries(raw):
    entries, offset = {}, 0
    while offset < len(raw):
        end = raw.index(b'\0', offset)
        mode, name = raw[offset:end].split(b' ', 1)
        require(name not in entries and name not in [b'.', b'..'] and b'/' not in name and
                0 < len(name) <= 255 and end + 21 <= len(raw) and len(entries) < 512)
        entries[name] = (mode, raw[end + 1:end + 21].hex()); offset = end + 21
    require(offset == len(raw))
    return entries


def verify_bundle(bundle_raw, fixture_raw):
    require(sha(bundle_raw) == BUNDLE_SHA256 and sha(fixture_raw) == FIXTURE_SHA256)
    value, fixture = parse(bundle_raw), parse(fixture_raw)
    require(set(value) == {'schema', 'scope', 'commit', 'tree', 'fixture_manifest_sha256',
        'public_commit_url', 'pack_sha256', 'pack_size_bytes', 'objects', 'pack_base64'})
    require(type(value['schema']) is int and value['schema'] == 1 and value['commit'] == HISTORICAL and
            value['tree'] == TREE and value['fixture_manifest_sha256'] == FIXTURE_SHA256 and
            value['scope'] == 'SELECTED_PUBLIC_HISTORICAL_REALM109_OBJECTS_NOT_PRIVATE_HISTORY')
    require(fixture['commit'] == HISTORICAL and len(fixture['files']) == 17 and
            fixture['realm_schema_version'] == 109 and fixture['realm_package'] == '12.15.0')
    pack = base64.b64decode(value['pack_base64'], validate=True)
    require(len(pack) == value['pack_size_bytes'] and sha(pack) == value['pack_sha256'])
    objects = unpack(pack, value['objects'])
    require(objects[HISTORICAL][0] == 'commit' and
            objects[HISTORICAL][1].split(b'\n', 1)[0] == b'tree ' + TREE.encode())
    require([row['path'] for row in value['objects'] if row['type'] == 'tree'] == TREE_PATHS and
            [row['oid'] for row in value['objects'] if row['type'] == 'commit'] == [HISTORICAL] and
            {row['oid'] for row in value['objects'] if row['type'] == 'blob'} ==
            {row['git_blob'] for row in fixture['files']})
    visited = set()
    for row in fixture['files']:
        oid, parts = TREE, row['path'].encode().split(b'/')
        for index, name in enumerate(parts):
            require(objects[oid][0] == 'tree'); visited.add(oid)
            mode, oid = tree_entries(objects[oid][1])[name]
            require(mode == (b'100644' if index == len(parts) - 1 else b'40000'))
        require(oid == row['git_blob'] and objects[oid][0] == 'blob' and sha(objects[oid][1]) == row['sha256'])
    require(visited == {row['oid'] for row in value['objects'] if row['type'] == 'tree'})
    return value, fixture, pack, objects


def git(root, *args, input=None):
    return subprocess.check_output(['git', '--no-replace-objects', *args], cwd=root, input=input,
        env=dict(PATH=os.environ.get('PATH', ''), GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
                 GIT_TERMINAL_PROMPT='0', GIT_ALLOW_PROTOCOL='', GIT_OPTIONAL_LOCKS='0'),
        stderr=subprocess.DEVNULL, timeout=30)


def snapshot(root):
    index = Path(git(root, 'rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
    return (git(root, 'rev-parse', 'HEAD'), git(root, 'for-each-ref', '--format=%(refname) %(objectname)'),
            git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'), sha(regular(index, 4 * 1024 * 1024)))


def provision(root, bundle_path, receipt_path):
    require(root.is_absolute() and root.resolve(strict=True) == root)
    require(receipt_path.is_absolute() and receipt_path.parent.resolve(strict=True) == receipt_path.parent and
            not receipt_path.exists() and not receipt_path.is_symlink())
    value, fixture, pack, objects = verify_bundle(regular(bundle_path), regular(root / FIXTURE))
    before = snapshot(root)
    require(re.fullmatch(b'[a-f0-9]{40}\n', before[0]))
    # Only object storage changes. A partial historical tree is intentional:
    # parent history and unrelated tree children are never exported or fetched.
    git(root, 'unpack-objects', '-q', input=pack)
    for oid, (kind, raw) in objects.items():
        require(git(root, 'cat-file', kind, oid) == raw)
    for row in fixture['files']:
        raw = git(root, 'show', HISTORICAL + ':' + row['path'])
        require(raw == objects[row['git_blob']][1] and sha(raw) == row['sha256'])
    require(snapshot(root) == before)
    receipt = dict(schema=1, scope='HISTORICAL_GIT_OBJECTS_ONLY_NO_APP_OR_NATIVE_EXECUTION',
        status='PASS', head_before=before[0].decode().strip(), head_after=before[0].decode().strip(),
        refs_index_and_worktree='UNCHANGED', historical_commit=HISTORICAL, historical_tree=TREE,
        fixture_manifest_sha256=FIXTURE_SHA256, bundle_sha256=BUNDLE_SHA256,
        pack_sha256=value['pack_sha256'], pack_size_bytes=len(pack), objects=28,
        commit_objects=1, path_tree_objects=10, approved_blob_objects=17,
        private_parent_history_exported=False, unrelated_blob_objects_exported=False,
        network_fetch=False, native_execution=False, published_app_upgrade='NOT RUN')
    with os.fdopen(os.open(receipt_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'w') as target:
        json.dump(receipt, target, sort_keys=True, indent=2); target.write('\n')
    return receipt


def main():
    require(len(sys.argv) == 2 and sys.argv[1] == 'provision')
    for key, value in {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
        'GITHUB_REPOSITORY': 'KeeperCommunity/bitcoin-keeper-private', 'GITHUB_REPOSITORY_ID': '839671816'}.items():
        require(os.environ.get(key) == value)
    require(os.environ.get('KEEPER_NATIVE_PLATFORM') in ['IOS', 'ANDROID'])
    root = Path(os.environ['GITHUB_WORKSPACE'])
    require(git(root, 'rev-parse', 'HEAD').decode().strip() == os.environ['KEEPER_SOURCE_SHA'])
    receipt = provision(root, Path(__file__).resolve().with_name(BUNDLE),
        Path(os.environ['RUNNER_TEMP']) / 'keeper-realm109-history-admission.json')
    print('REALM109_SELECTED_HISTORY_PROVISIONED=' + json.dumps(receipt, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Historical Realm109 provisioning rejected; no current-schema fallback.', file=sys.stderr)
        sys.exit(1)
