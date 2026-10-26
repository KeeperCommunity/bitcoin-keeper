"""Admit one reviewed private APK checkpoint; never compile or grant acceptance."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time
import zipfile

REPOSITORY = 'KeeperCommunity/bitcoin-keeper-private'
REPO_ID = 839671816
APK = 'android/app/build/outputs/apk/development/debug/app-development-debug.apk'
METADATA = 'artifacts/native/android/metadata.json'
LABEL = 'keeper/android-runtime-reuse'
JOB_NAME = 'android / Native ANDROID build and probes'
WORKFLOW_REF = REPOSITORY + '/.github/workflows/keeper-native-diagnostic.yml@refs/pull/73/merge'
SCOPE = 'EXACT_PRIVATE_ANDROID_CHECKPOINT_ONLY_NOT_NATIVE_ACCEPTANCE'
MAX_APK = 512 * 1024 ** 2
MAX_META = 1024 ** 2
MAX_ARCHIVE = MAX_APK + 2 * MAX_META
FILES = {'app-development-debug.apk': APK, 'build-metadata.json': METADATA}
ORIGIN_KEYS = {'repository_id', 'repository_private', 'source_sha', 'source_tree', 'run_id',
               'run_attempt', 'job_id', 'job_name', 'workflow_id', 'workflow_sha', 'workflow_ref'}


class Rejected(Exception):
    pass


def require(value):
    if not value:
        raise Rejected()


def integer(value, low=1, high=2 ** 53 - 1):
    return type(value) is int and low <= value <= high


def hex_value(value, count):
    return type(value) is str and re.fullmatch('[0-9a-f]{%d}' % count, value) is not None


def parse(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result)
            result[key] = value
        return result
    def invalid(_):
        raise Rejected()
    return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_constant=invalid)


def regular(path, limit):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1)
    require(0 < info.st_size <= limit)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as source:
        current = os.fstat(source.fileno())
        require((info.st_dev, info.st_ino, info.st_size) == (current.st_dev, current.st_ino, current.st_size))
        require(stat.S_ISREG(current.st_mode) and current.st_nlink == 1 and current.st_uid == os.getuid())
        data = source.read(limit + 1)
        require(len(data) == info.st_size)
    return data


def write_new(path, data):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as target:
        target.write(data)


def json_new(path, value):
    write_new(path, (json.dumps(value, sort_keys=True, indent=2) + '\n').encode())


def owned_directory(path):
    require(path.is_absolute() and path.resolve(strict=True) == path)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid())


def directories(env):
    root, temporary = Path(env['GITHUB_WORKSPACE']), Path(env['RUNNER_TEMP'])
    owned_directory(root)
    owned_directory(temporary)
    return root, temporary / 'keeper-android-reuse-controller', temporary / 'keeper-android-reuse-state'


def context(env):
    fixed = {'GITHUB_ACTIONS': 'true', 'GITHUB_EVENT_NAME': 'pull_request',
             'GITHUB_REPOSITORY': REPOSITORY, 'GITHUB_REPOSITORY_ID': str(REPO_ID),
             'GITHUB_RUN_ATTEMPT': '1', 'KEEPER_NATIVE_PLATFORM': 'ANDROID',
             'KEEPER_DIAGNOSTIC': 'true'}
    require(all(env.get(key) == value for key, value in fixed.items()))
    require(hex_value(env.get('KEEPER_CONTROLLER_SHA'), 40) and hex_value(env.get('GITHUB_SHA'), 40))


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL, timeout=30)


def selection(raw):
    value = parse(raw)
    keys = {'schema', 'armed', 'scope', 'repository_id', 'source_sha', 'source_tree', 'run_id',
            'run_attempt', 'job_id', 'workflow_id', 'check_suite_id', 'workflow_sha', 'workflow_ref',
            'artifact_id', 'archive_sha256', 'archive_size_bytes'}
    require(type(value) is dict and set(value) == keys)
    require(type(value['schema']) is int and value['schema'] == 1 and value['armed'] is True)
    require(value['scope'] == SCOPE and type(value['repository_id']) is int and value['repository_id'] == REPO_ID)
    for key in ('source_sha', 'source_tree', 'workflow_sha'):
        require(hex_value(value[key], 40))
    require(hex_value(value['archive_sha256'], 64))
    for key in ('run_id', 'job_id', 'workflow_id', 'check_suite_id', 'artifact_id'):
        require(integer(value[key]))
    require(type(value['run_attempt']) is int and value['run_attempt'] == 1)
    require(value['workflow_id'] == 395790359 and value['workflow_ref'] == WORKFLOW_REF)
    require(integer(value['archive_size_bytes'], 1, MAX_ARCHIVE))
    return value


def stage(env):
    context(env)
    root, control, _ = directories(env)
    require(git(root, 'rev-parse', 'HEAD').decode().strip() == env['KEEPER_CONTROLLER_SHA'])
    git(root, 'diff', '--exit-code', 'HEAD', '--')
    names = ('android_runtime_checkpoint.py', 'android_checkpoint_origin.cjs', 'android_reuse_selection.json')
    source = {name: regular(root / '.github/native' / name, MAX_META) for name in names}
    for name, data in source.items():
        require(data == git(root, 'show', 'HEAD:.github/native/' + name))
    selected = selection(source['android_reuse_selection.json'])  # Unarmed stops before API/download.
    control.mkdir(mode=0o700)
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in source.items()}
    for name, data in source.items():
        write_new(control / name, data)
    json_new(control / 'identity.json', {'controller_sha': env['KEEPER_CONTROLLER_SHA'], 'hashes': hashes})
    descriptor = os.open(env['GITHUB_OUTPUT'], os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'w') as target:
        for key, value in (('app_source', selected['source_sha']),
                           ('helper_sha256', hashes[names[0]]), ('origin_sha256', hashes[names[1]])):
            target.write(key + '=' + value + '\n')
    descriptor = os.open(env['GITHUB_ENV'], os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'w') as target:
        for key, value in (('KEEPER_SOURCE_SHA', selected['source_sha']),
                           ('KEEPER_HELPER_SHA256', hashes[names[0]]),
                           ('KEEPER_ORIGIN_SHA256', hashes[names[1]]),
                           ('KEEPER_SELECTION_SHA256', hashes[names[2]])):
            target.write(key + '=' + value + '\n')


def guarded(env):
    context(env)
    root, control, state = directories(env)
    owned_directory(control)
    identity = parse(regular(control / 'identity.json', 16384))
    require(identity['controller_sha'] == env['KEEPER_CONTROLLER_SHA'])
    for name, digest in identity['hashes'].items():
        require(name in ('android_runtime_checkpoint.py', 'android_checkpoint_origin.cjs', 'android_reuse_selection.json'))
        require(hex_value(digest, 64) and hashlib.sha256(regular(control / name, MAX_META)).hexdigest() == digest)
    require(len(identity['hashes']) == 3)
    require(identity['hashes']['android_runtime_checkpoint.py'] == env['KEEPER_HELPER_SHA256'])
    require(identity['hashes']['android_checkpoint_origin.cjs'] == env['KEEPER_ORIGIN_SHA256'])
    require(identity['hashes']['android_reuse_selection.json'] == env['KEEPER_SELECTION_SHA256'])
    selected = selection(regular(control / 'android_reuse_selection.json', 16384))
    require(git(root, 'rev-parse', 'HEAD').decode().strip() == selected['source_sha'])
    require(git(root, 'rev-parse', 'HEAD^{tree}').decode().strip() == selected['source_tree'])
    require(env.get('KEEPER_SOURCE_SHA') == selected['source_sha'])
    return root, control, state, selected


def api_identity(receipt, selected, env):
    require(type(receipt) is dict and set(receipt) == {'schema', 'observed_unix_seconds', 'current_pr', 'run', 'job', 'artifact'})
    require(type(receipt['schema']) is int and receipt['schema'] == 1)
    stamp = receipt['observed_unix_seconds']
    require(integer(stamp) and 0 <= time.time() - stamp <= 120)
    run, job, artifact, pr = (receipt[key] for key in ('run', 'job', 'artifact', 'current_pr'))
    require(run['id'] == selected['run_id'] and run['head_sha'] == selected['source_sha'])
    require(run['head_commit']['tree_id'] == selected['source_tree'])
    require(type(run['run_attempt']) is int and run['run_attempt'] == 1)
    require(run['repository']['id'] == run['head_repository']['id'] == REPO_ID and run['repository']['private'] is True)
    require(run['workflow_id'] == selected['workflow_id'] and run['check_suite_id'] == selected['check_suite_id'])
    require(run['path'] == '.github/workflows/keeper-native-diagnostic.yml')
    workflow_sha = selected['workflow_sha']
    require(any(row['sha'] == workflow_sha and row['ref'] == 'refs/pull/73/merge' and
                row['path'] == REPOSITORY + '/.github/workflows/keeper-native-platform.yml@' + workflow_sha
                for row in run['referenced_workflows']))
    require(job['id'] == selected['job_id'] and job['run_id'] == selected['run_id'])
    require(job['head_sha'] == selected['source_sha'] and type(job['run_attempt']) is int and job['run_attempt'] == 1)
    require(job['name'] == JOB_NAME and job['status'] == 'completed' and job['conclusion'] in ('success', 'failure'))
    require(type(job['steps']) is list and len(job['steps']) <= 100)
    for name in ('Verify current diagnostic source', 'Build development app',
                 'Record official private Android checkpoint origin',
                 'Prepare exact private Android build checkpoint', 'Upload private Android build checkpoint'):
        matches = [row for row in job['steps'] if row['name'] == name]
        require(len(matches) == 1 and matches[0]['status'] == 'completed' and matches[0]['conclusion'] == 'success')
    require(artifact['id'] == selected['artifact_id'] and artifact['size_in_bytes'] == selected['archive_size_bytes'])
    require(artifact['digest'] == 'sha256:' + selected['archive_sha256'] and artifact['expired'] is False)
    require(artifact['name'] == 'keeper-private-android-checkpoint-%s-%s-1' % (selected['source_sha'], selected['run_id']))
    require(artifact['workflow_run']['id'] == selected['run_id'] and artifact['workflow_run']['head_sha'] == selected['source_sha'])
    require(artifact['workflow_run']['repository_id'] == artifact['workflow_run']['head_repository_id'] == REPO_ID)
    require(pr['head']['sha'] == env['KEEPER_CONTROLLER_SHA'] and pr['head']['repo']['id'] == REPO_ID)
    require(pr['merge_commit_sha'] == env['GITHUB_SHA'] and pr['runtime_opt_in'] is True and pr['native_opt_in'] is False)
    ids = [run['id'], run['repository']['id'], run['head_repository']['id'], run['workflow_id'],
           run['check_suite_id'], job['id'], job['run_id'], artifact['id'], artifact['size_in_bytes'],
           artifact['workflow_run']['id'], artifact['workflow_run']['repository_id'],
           artifact['workflow_run']['head_repository_id'], pr['head']['repo']['id']]
    require(all(integer(value) for value in ids))
    return {'selection': selected, 'job_conclusion': job['conclusion'],
            'current_controller_sha': env['KEEPER_CONTROLLER_SHA'], 'current_controller_merge': env['GITHUB_SHA']}


def manifest(value, selected):
    require(type(value) is dict and set(value) == ORIGIN_KEYS | {'schema', 'scope', 'native_acceptance',
        'release_artifact', 'files', 'measured_free_bytes_before_emulator'})
    require(type(value['schema']) is int and value['schema'] == 1)
    require(value['scope'] == 'PRIVATE_ANDROID_DEBUG_BUILD_CHECKPOINT_NOT_NATIVE_ACCEPTANCE_OR_RELEASE')
    require(value['native_acceptance'] is False and value['release_artifact'] is False)
    for key in ('source_sha', 'source_tree', 'run_id', 'run_attempt', 'job_id', 'workflow_id', 'workflow_sha', 'workflow_ref', 'repository_id'):
        require(type(value[key]) is type(selected[key]) and value[key] == selected[key])
    require(value['repository_private'] is True and value['job_name'] == JOB_NAME)
    require(integer(value['measured_free_bytes_before_emulator'], 0))
    require(type(value['files']) is dict and set(value['files']) == set(FILES))
    for name, original in FILES.items():
        row = value['files'][name]
        require(type(row) is dict and set(row) == {'source_path', 'sha256', 'size_bytes'})
        require(row['source_path'] == original and hex_value(row['sha256'], 64))
        require(integer(row['size_bytes'], 1, MAX_APK if name.endswith('.apk') else MAX_META))
    return value


def built_metadata(value, selected, declared):
    require(type(value) is dict and type(value['schema']) is int and value['schema'] == 1)
    require(value['platform'] == 'ANDROID' and value['diagnostic_only'] is True)
    require(value['source_sha'] == selected['source_sha'] and value['run_id'] == str(selected['run_id']) and value['run_attempt'] == '1')
    require(value['workflow_sha'] == selected['workflow_sha'] and value['workflow_ref'] == selected['workflow_ref'])
    require(value['build'] == 'PASS')
    require(all(value[key] == 'NOT RUN' for key in ('smoke', 'native_probe', 'r5_features', 'hardware', 'signing')))
    require(value['built_artifact'] == {'path': APK, 'sha256': declared['files']['app-development-debug.apk']['sha256']})


def purge_owned(path, owner):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and (info.st_dev, info.st_ino) == owner)
    require(info.st_uid == os.getuid() and info.st_nlink == 1)
    path.unlink()


def download(env):
    root, _, state, selected = guarded(env)
    git(root, 'diff', '--exit-code', 'HEAD', '--')
    before = api_identity(parse(regular(Path(env['RUNNER_TEMP']) / 'keeper-android-reuse-before.json', MAX_META)), selected, env)
    state.mkdir(mode=0o700)
    raw = state / 'checkpoint.zip'
    descriptor = os.open(raw, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    info = os.fstat(descriptor)
    owner = info.st_dev, info.st_ino
    try:
        with os.fdopen(descriptor, 'w+b') as archive:
            subprocess.run(['gh', 'api', 'repos/' + REPOSITORY + '/actions/artifacts/' +
                            str(selected['artifact_id']) + '/zip'], stdout=archive,
                           stderr=subprocess.DEVNULL, timeout=180, check=True)
            archive.flush()
            require(os.fstat(archive.fileno()).st_size == selected['archive_size_bytes'])
            archive.seek(0)
            digest = hashlib.sha256()
            for chunk in iter(lambda: archive.read(1024 ** 2), b''):
                digest.update(chunk)
            require(digest.hexdigest() == selected['archive_sha256'])
            archive.seek(0)
            with zipfile.ZipFile(archive) as bundle:
                members = bundle.infolist()
                require(len(members) == 3 and {row.filename for row in members} == set(FILES) | {'manifest.json'})
                for member in members:
                    require(member.filename == member.orig_filename and not member.flag_bits & 1)
                    require(member.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED))
                    require(stat.S_IFMT(member.external_attr >> 16) in (0, stat.S_IFREG))
                    require(0 < member.file_size <= (MAX_APK if member.filename.endswith('.apk') else MAX_META))
                declared = manifest(parse(bundle.read('manifest.json')), selected)
                for name, row in declared['files'].items():
                    require(bundle.getinfo(name).file_size == row['size_bytes'])
                    destination = state / name
                    target = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                    digest, total = hashlib.sha256(), 0
                    with os.fdopen(target, 'wb') as output, bundle.open(name) as source:
                        for chunk in iter(lambda: source.read(1024 ** 2), b''):
                            total += len(chunk)
                            require(total <= row['size_bytes'])
                            digest.update(chunk)
                            output.write(chunk)
                    require(total == row['size_bytes'] and digest.hexdigest() == row['sha256'])
                built_metadata(parse(regular(state / 'build-metadata.json', MAX_META)), selected, declared)
                json_new(state / 'manifest.json', declared)
                json_new(state / 'staged.json', {'before': before, 'manifest_sha256': hashlib.sha256(regular(state / 'manifest.json', MAX_META)).hexdigest()})
    finally:
        purge_owned(raw, owner)  # No staged admission/success survives a raw-ZIP purge failure.
    print('EXACT_PRIVATE_CHECKPOINT_STAGED_RAW_ZIP_PURGED')


def finalize(env):
    _, _, state, selected = guarded(env)
    owned_directory(state)
    staged = parse(regular(state / 'staged.json', MAX_META))
    after = api_identity(parse(regular(Path(env['RUNNER_TEMP']) / 'keeper-android-reuse-after.json', MAX_META)), selected, env)
    require(after == staged['before'] and not (state / 'checkpoint.zip').exists())
    declared_bytes = regular(state / 'manifest.json', MAX_META)
    require(hashlib.sha256(declared_bytes).hexdigest() == staged['manifest_sha256'])
    declared = manifest(parse(declared_bytes), selected)
    for name, row in declared['files'].items():
        require(hashlib.sha256(regular(state / name, MAX_APK if name.endswith('.apk') else MAX_META)).hexdigest() == row['sha256'])
    json_new(state / 'admitted.json', {'schema': 1, 'identity': after, 'manifest_sha256': staged['manifest_sha256'], 'native_acceptance': False})
    admission_hash = hashlib.sha256(regular(state / 'admitted.json', MAX_META)).hexdigest()
    descriptor = os.open(env['GITHUB_ENV'], os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'w') as target:
        target.write('KEEPER_ADMISSION_SHA256=' + admission_hash + '\n')
    print('EXACT_PRIVATE_CHECKPOINT_ADMITTED_NOT_NATIVE_ACCEPTANCE')


def restore(env):
    root, _, state, selected = guarded(env)
    owned_directory(state)
    admission_bytes = regular(state / 'admitted.json', MAX_META)
    require(hashlib.sha256(admission_bytes).hexdigest() == env['KEEPER_ADMISSION_SHA256'])
    admitted = parse(admission_bytes)
    require(admitted['identity']['selection'] == selected and admitted['native_acceptance'] is False)
    declared_bytes = regular(state / 'manifest.json', MAX_META)
    require(hashlib.sha256(declared_bytes).hexdigest() == admitted['manifest_sha256'])
    declared = manifest(parse(declared_bytes), selected)
    old_bytes = regular(state / 'build-metadata.json', MAX_META)
    require(hashlib.sha256(old_bytes).hexdigest() == declared['files']['build-metadata.json']['sha256'])
    old = parse(old_bytes)
    built_metadata(old, selected, declared)
    current = parse(regular(root / METADATA, MAX_META))
    require(current['source_sha'] == selected['source_sha'] and current['run_id'] == env['GITHUB_RUN_ID'] and current['run_attempt'] == '1')
    require(current['build'] == 'NOT RUN' and current['diagnostic_only'] is True and current['platform'] == 'ANDROID')
    require(current['workflow_sha'] == env['GITHUB_WORKFLOW_SHA'] and current['workflow_ref'] == env['GITHUB_WORKFLOW_REF'])
    # The same committed app and synthetic preparation must feed the reused APK.
    require(current['configuration_overlays'] == old['configuration_overlays'])
    require(current['nodeify_overlay'] == old['nodeify_overlay'])
    git(root, 'diff', '--exit-code', 'HEAD', '--', '.github/native', '.github/workflows', 'yarn.lock', 'ios/Podfile.lock')
    # Admit every tracked input after dependency setup, allowing only the exact
    # synthetic overlays already bound to the original build metadata.
    checker_path = root / '.github/native/android_apk_checkpoint.py'
    checker_bytes = regular(checker_path, MAX_META)
    require(checker_bytes == git(root, 'show', 'HEAD:.github/native/android_apk_checkpoint.py'))
    checker_spec = importlib.util.spec_from_file_location('checkpoint_source_guard', checker_path)
    checker = importlib.util.module_from_spec(checker_spec)
    exec(compile(checker_bytes, str(checker_path), 'exec'), checker.__dict__)
    descriptor = checker.directory(root)
    try:
        checker.committed_bytes(root, descriptor, current)
    finally:
        os.close(descriptor)
    data = regular(state / 'app-development-debug.apk', MAX_APK)
    require(hashlib.sha256(data).hexdigest() == declared['files']['app-development-debug.apk']['sha256'])
    destination = root / APK
    # Only the literal build-output ancestry is created; never follow a link.
    parent = root
    for component in Path(APK).parts[:-1]:
        parent = parent / component
        if not parent.exists():
            parent.mkdir(mode=0o700)
        owned_directory(parent)
    write_new(destination, data)
    current.update(build='PASS', built_artifact=old['built_artifact'],
        build_execution_scope='REUSED_EXACT_ORIGINAL_PRIVATE_DEBUG_APK_NO_CURRENT_RUN_COMPILATION_OR_RELEASE',
        build_checkpoint={'origin': {key: declared[key] for key in ORIGIN_KEYS},
                          'archive_sha256': selected['archive_sha256'], 'artifact_id': selected['artifact_id'],
                          'native_acceptance': False})
    temporary = root / (METADATA + '.reuse')
    json_new(temporary, current)
    os.replace(temporary, root / METADATA)
    evidence = root / 'artifacts/private-android-runtime-admission'
    evidence.mkdir(mode=0o700, parents=True, exist_ok=False)
    json_new(evidence / 'admission.json', {'schema': 1, 'native_acceptance': False, 'release_artifact': False,
        'original_build': admitted['identity'], 'runtime_run_id': int(env['GITHUB_RUN_ID']),
        'runtime_source_sha': selected['source_sha'], 'controller_sha': env['KEEPER_CONTROLLER_SHA'],
        'controller_workflow_sha': env['GITHUB_WORKFLOW_SHA'],
        'measured_free_bytes_before_emulator': shutil.disk_usage(root).free})
    print('EXACT_ORIGINAL_PRIVATE_APK_RESTORED_NOT_CURRENT_SOURCE_ACCEPTANCE')


def main():
    require(len(sys.argv) == 2 and sys.argv[1] in ('stage', 'download', 'finalize', 'restore'))
    globals()[sys.argv[1]](os.environ)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('PRIVATE_ANDROID_CHECKPOINT_REJECTED_NO_RAW_VALUES', file=sys.stderr)
        raise SystemExit(1)
