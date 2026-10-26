#!/usr/bin/env python3
"""Private source-bound debug APK checkpoint; never native or release acceptance."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
APK = 'android/app/build/outputs/apk/development/debug/app-development-debug.apk'
METADATA = 'artifacts/native/android/metadata.json'
CHECKPOINT = 'private-android-checkpoint'
ORIGIN = 'keeper-android-checkpoint-origin.json'
MAX_APK = 512 * 1024 * 1024
# Keep producer bounds identical to the runtime checkpoint consumer.
MAX_METADATA = 1024 * 1024
OVERLAYS = {'.env.ci', 'firebase.json', 'android/app/google-services.json'}
FIELDS = ('repository_id', 'repository_private', 'source_sha', 'source_tree', 'run_id',
          'run_attempt', 'job_id', 'job_name', 'workflow_id', 'workflow_sha', 'workflow_ref')
ERROR = 'PRIVATE_ANDROID_CHECKPOINT_REJECTED'


def require(value):
    if not value:
        raise ValueError(ERROR)


def json_document(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result)
            result[key] = value
        return result
    return json.loads(raw.decode('utf-8'), object_pairs_hook=unique,
                      parse_constant=lambda _: require(False))


def directory(path):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path)
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        require(os.fstat(fd).st_uid == os.getuid())
        return fd
    except BaseException:
        os.close(fd)
        raise


def descend(base, relative):
    parts = PurePosixPath(relative).parts
    require(parts and not PurePosixPath(relative).is_absolute() and
            all(part not in ('', '.', '..') for part in parts))
    fd = os.dup(base)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
            require(os.fstat(fd).st_uid == os.getuid())
        return fd, parts[-1]
    except BaseException:
        os.close(fd)
        raise


def fingerprint(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns, info.st_nlink, info.st_uid, info.st_mode)


def read_file(base, relative, cap, destination=None, minimum=1):
    parent, name = descend(base, relative)
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    finally:
        os.close(parent)
    with os.fdopen(fd, 'rb') as source:
        before = os.fstat(source.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and
                before.st_nlink == 1 and minimum <= before.st_size <= cap)
        sha256 = hashlib.sha256()
        git_sha = hashlib.sha1(('blob %d\0' % before.st_size).encode())
        chunks, size = [], 0
        for block in iter(lambda: source.read(1024 * 1024), b''):
            size += len(block)
            require(size <= cap)
            sha256.update(block)
            git_sha.update(block)
            if destination is None:
                chunks.append(block)
            else:
                destination.write(block)
        require(size == before.st_size and fingerprint(before) == fingerprint(os.fstat(source.fileno())))
    return {'sha256': sha256.hexdigest(), 'size_bytes': size,
            'executable': bool(before.st_mode & stat.S_IXUSR),
            'git_blob': git_sha.hexdigest(), 'bytes': b''.join(chunks)}


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL,
                                   timeout=30)


def validate_context(root, env, origin):
    expected = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
        'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64', 'ImageOS': 'ubuntu24',
        'KEEPER_NATIVE_PLATFORM': 'ANDROID', 'KEEPER_DIAGNOSTIC': 'true',
        'GITHUB_REPOSITORY': 'KeeperCommunity/bitcoin-keeper-private',
        'GITHUB_REPOSITORY_ID': '839671816', 'GITHUB_EVENT_NAME': 'pull_request',
        'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_WORKSPACE': str(root)}
    require(all(env.get(key) == value for key, value in expected.items()))
    require(set(origin) == {'schema', *FIELDS} and type(origin['schema']) is int and origin['schema'] == 1)
    for key in ('repository_id', 'run_id', 'run_attempt', 'job_id', 'workflow_id'):
        require(type(origin[key]) is int and 0 < origin[key] < 2 ** 53)
    require(origin['repository_id'] == 839671816 and origin['repository_private'] is True and
            origin['run_attempt'] == 1 and origin['workflow_id'] == 395790359 and
            origin['job_name'] == 'android / Native ANDROID build and probes')
    for key in ('source_sha', 'source_tree', 'workflow_sha'):
        require(type(origin[key]) is str and re.fullmatch('[0-9a-f]{40}', origin[key]))
    require(origin['source_sha'] == env.get('KEEPER_SOURCE_SHA') and
            str(origin['run_id']) == env.get('GITHUB_RUN_ID') and
            origin['workflow_sha'] == env.get('GITHUB_WORKFLOW_SHA') and
            origin['workflow_ref'] == env.get('GITHUB_WORKFLOW_REF'))
    require(origin['workflow_ref'] ==
        'KeeperCommunity/bitcoin-keeper-private/.github/workflows/keeper-native-diagnostic.yml@refs/pull/73/merge')
    require(git(root, 'rev-parse', 'HEAD').decode().strip() == origin['source_sha'] and
            git(root, 'rev-parse', 'HEAD^{tree}').decode().strip() == origin['source_tree'])


def committed_bytes(root, base, metadata):
    overlays = metadata.get('configuration_overlays')
    require(type(overlays) is list and len(overlays) == 3)
    hashes = {}
    for row in overlays:
        require(type(row) is dict and set(row) == {'path', 'sha256'} and
                row['path'] in OVERLAYS and row['path'] not in hashes)
        observed = read_file(base, row['path'], MAX_METADATA)
        require(observed['sha256'] == row['sha256'])
        hashes[row['path']] = row['sha256']
    require(set(hashes) == OVERLAYS)
    records = git(root, 'ls-tree', '-rz', 'HEAD').split(b'\0')
    require(1 < len(records) <= 10001)
    package = helper = None
    total = 0
    for record in records:
        if not record:
            continue
        header, path = record.split(b'\t', 1)
        mode, kind, blob = header.split()
        require(kind == b'blob' and mode in (b'100644', b'100755'))
        path = path.decode('utf-8')
        if path in OVERLAYS:
            continue
        observed = read_file(base, path, 64 * 1024 * 1024, minimum=0)
        require(observed['executable'] == (mode == b'100755'))
        total += observed['size_bytes']
        require(total <= 256 * 1024 * 1024)
        if path == 'package.json':
            original = git(root, 'cat-file', 'blob', blob.decode())
            overlay = metadata.get('nodeify_overlay')
            require(type(overlay) is dict and overlay.get('path') == path and
                    overlay.get('allowed_fields') == ['browser', 'react-native', 'browserify'] and
                    overlay.get('before_sha256') == hashlib.sha256(original).hexdigest() and
                    overlay.get('after_sha256') == observed['sha256'])
            before, after = json_document(original), json_document(observed['bytes'])
            for key in overlay['allowed_fields']:
                before.pop(key, None)
                after.pop(key, None)
            require(before == after)
            package = True
        else:
            require(observed['git_blob'] == blob.decode())
        if path == '.github/native/android_apk_checkpoint.py':
            require(observed['sha256'] == hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
            helper = True
    require(package is True and helper is True)


def validate_metadata(data, origin):
    require(type(data) is dict and type(data.get('schema')) is int and data['schema'] == 1 and
            data.get('platform') == 'ANDROID' and data.get('diagnostic_only') is True and
            data.get('build') == 'PASS' and data.get('app_id') == 'io.hexawallet.keeper.development')
    for key in ('source_sha', 'workflow_ref', 'workflow_sha'):
        require(data.get(key) == origin[key])
    for key in ('run_id', 'run_attempt'):
        require(data.get(key) == str(origin[key]))
    require(all(data.get(key) == 'NOT RUN' for key in
                ('smoke', 'native_probe', 'r5_features', 'hardware', 'signing')))
    commands = data.get('commands')
    require(type(commands) is list and 1 <= len(commands) <= 64)
    build = [row for row in commands if type(row) is dict and
             row.get('label') == 'Build debug-key-only development APK']
    require(len(build) == 1 and type(build[0].get('exit_code')) is int and build[0]['exit_code'] == 0)
    artifact = data.get('built_artifact')
    require(type(artifact) is dict and set(artifact) == {'path', 'sha256'} and artifact['path'] == APK and
            type(artifact['sha256']) is str and re.fullmatch('[0-9a-f]{64}', artifact['sha256']))


def prepare(root=ROOT, env=None):
    env = os.environ if env is None else env
    root = Path(root)
    base = directory(root)
    output = parent = None
    created = False
    try:
        temporary = directory(Path(env['RUNNER_TEMP']))
        try:
            origin = json_document(read_file(temporary, ORIGIN, 16384)['bytes'])
        finally:
            os.close(temporary)
        validate_context(root, env, origin)
        metadata = read_file(base, METADATA, MAX_METADATA)
        data = json_document(metadata['bytes'])
        validate_metadata(data, origin)
        committed_bytes(root, base, data)
        parent = os.open('artifacts', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=base)
        require(os.fstat(parent).st_uid == os.getuid())
        os.mkdir(CHECKPOINT, mode=0o700, dir_fd=parent)
        created = True
        output = os.open(CHECKPOINT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        def write(name):
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600, dir_fd=output)
            return os.fdopen(fd, 'wb')
        with write('app-development-debug.apk') as destination:
            apk = read_file(base, APK, MAX_APK, destination)
        require(apk['sha256'] == data['built_artifact']['sha256'])
        with write('build-metadata.json') as destination:
            destination.write(metadata['bytes'])
        committed_bytes(root, base, data)
        validate_context(root, env, origin)
        require(read_file(base, METADATA, MAX_METADATA)['sha256'] == metadata['sha256'])
        free = shutil.disk_usage(root).free
        require(type(free) is int and free >= 0)
        manifest = {'schema': 1,
            'scope': 'PRIVATE_ANDROID_DEBUG_BUILD_CHECKPOINT_NOT_NATIVE_ACCEPTANCE_OR_RELEASE',
            'native_acceptance': False, 'release_artifact': False,
            **{key: origin[key] for key in FIELDS},
            'measured_free_bytes_before_emulator': free,
            'files': {name: {'source_path': source, 'sha256': record['sha256'],
                             'size_bytes': record['size_bytes']}
                      for name, source, record in (
                          ('app-development-debug.apk', APK, apk),
                          ('build-metadata.json', METADATA, metadata))}}
        with write('manifest.json') as destination:
            destination.write((json.dumps(manifest, sort_keys=True, indent=2) + '\n').encode())
        require(fingerprint(os.fstat(output)) == fingerprint(
            os.stat(CHECKPOINT, dir_fd=parent, follow_symlinks=False)))
        return manifest
    except BaseException:
        if created and output is not None:
            for name in ('manifest.json', 'build-metadata.json', 'app-development-debug.apk'):
                try:
                    os.unlink(name, dir_fd=output)
                except FileNotFoundError:
                    pass
            named = os.stat(CHECKPOINT, dir_fd=parent, follow_symlinks=False)
            owned = os.fstat(output)
            if (named.st_dev, named.st_ino) == (owned.st_dev, owned.st_ino):
                os.rmdir(CHECKPOINT, dir_fd=parent)
        raise
    finally:
        if output is not None:
            os.close(output)
        if parent is not None:
            os.close(parent)
        os.close(base)


def main():
    try:
        require(len(sys.argv) == 1)
        prepare()
        print('PRIVATE_ANDROID_CHECKPOINT_READY')
        return 0
    except Exception:
        print(ERROR, file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
