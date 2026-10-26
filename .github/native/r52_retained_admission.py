"""Explicit original-ff diagnostics with a separately bound harness.

No downloader, builder, source relabeling or default-driver waiver. Stage on the
reviewed controller, then install only AFTER the existing original-APK restore
and ordinary startup have passed. The original source/run/build/smoke metadata
is preserved. iOS consumes the separately reviewed normal-Xcode restore proof
and requires these diagnostic files already committed in that controller.
"""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

SOURCE = 'ff3cc6b2721de986d9f6211ef333df57ebc3b1fa'
TREE = 'ee0c587945901788b4ad62ad28ed660ab656cb6a'
APP_INPUTS = '6112e0e18e093e5e65e754fc607aa7e44ee73682576a31a168a6ad01f06a2b85'
MANIFEST = '.github/native/r52_retained_manifest.json'
ADAPTER = '.github/native/r52_retained_admission.py'
SCOPE = 'ORIGINAL_FF_APP_REVIEWED_DIAGNOSTIC_HARNESS_NOT_CURRENT_BUILD_OR_RELEASE'
MAX_BASELINE = 4 * 1024 * 1024
PROTECTED = ('source_sha', 'run_id', 'run_attempt', 'workflow_sha', 'workflow_ref',
             'build', 'built_artifact', 'smoke', 'native_keychain', 'native_probe',
             'r5_features', 'configuration_overlays', 'nodeify_overlay', 'build_checkpoint',
             'controller_source_sha', 'compiled_app_source_sha', 'current_source_compilation',
             'build_execution_scope', 'original_build', 'restored_bundle_identity',
             'retained_xcode_restore', 'original_signature_preserved', 'toolchain', 'maestro')
SOURCE_OVERRIDE_PATHS = ['src', 'patches', 'tests/electrum', 'tests/recovery/fixtures',
                         '.github/native', 'index.*', 'shim.*', 'metro.config.*',
                         'babel.config.*', 'react-native.config.*']


def require(condition, code='R52_RETAINED_ADMISSION_REJECTED'):
    if not condition:
        raise RuntimeError(code)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def parse(raw):
    def pairs(rows):
        value = {}
        for key, entry in rows:
            require(key not in value)
            value[key] = entry
        return value
    return json.loads(raw, object_pairs_hook=pairs,
                      parse_constant=lambda _: require(False))


def directory(path):
    require(path.is_absolute() and path.resolve(strict=True) == path)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid())


def regular(path, limit=2 * 1024 * 1024):
    directory(path.parent)
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
            before.st_uid == os.getuid() and 0 <= before.st_size <= limit)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as source:
        after = os.fstat(source.fileno())
        require((before.st_dev, before.st_ino, before.st_size) ==
                (after.st_dev, after.st_ino, after.st_size))
        raw = source.read(limit + 1)
        require(len(raw) == before.st_size)
    return raw


def new_file(path, raw):
    directory(path.parent)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as target:
        target.write(raw)


def git(root, *args):
    return subprocess.check_output(['git', '--no-replace-objects', *args], cwd=root,
        env=dict(PATH=os.environ.get('PATH', ''), GIT_CONFIG_NOSYSTEM='1',
                 GIT_CONFIG_GLOBAL=os.devnull, GIT_TERMINAL_PROMPT='0', GIT_ALLOW_PROTOCOL=''),
        stderr=subprocess.DEVNULL, timeout=30)


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    # Avoid pycache writes inside the immutable staged tree.
    exec(compile(regular(path), str(path), 'exec'), module.__dict__)
    return module


def context(env):
    for key, expected in {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
            'GITHUB_REPOSITORY': 'KeeperCommunity/bitcoin-keeper-private',
            'GITHUB_REPOSITORY_ID': '839671816', 'GITHUB_EVENT_NAME': 'pull_request',
            'GITHUB_RUN_ATTEMPT': '1', 'KEEPER_DIAGNOSTIC': 'true'}.items():
        require(env.get(key) == expected)
    require(re.fullmatch('[a-f0-9]{40}', env.get('KEEPER_CONTROLLER_SHA', '')) is not None)
    require(env.get('KEEPER_NATIVE_PLATFORM') in ['ANDROID', 'IOS'])
    if env['KEEPER_NATIVE_PLATFORM'] == 'IOS':
        require(env.get('KEEPER_PRIVATE_IOS_NORMAL_RETAINED') == '1')


def locations(env):
    root, temporary = Path(env['GITHUB_WORKSPACE']), Path(env['RUNNER_TEMP'])
    directory(root); directory(temporary)
    return root, temporary / 'keeper-r52-retained-controller'


def read_manifest(raw):
    value = parse(raw)
    require(type(value) is dict and set(value) == {'schema', 'scope', 'compiled_source',
        'compiled_tree', 'app_inputs_sha256', 'app_input_entries', 'producer',
        'original_helper_sha256', 'ios_guards', 'files', 'patch_outputs', 'runtime_files', 'package_versions'})
    require(type(value['schema']) is int and value['schema'] == 1 and value['scope'] == SCOPE)
    require(value['compiled_source'] == SOURCE and value['compiled_tree'] == TREE and
            value['app_inputs_sha256'] == APP_INPUTS and type(value['app_input_entries']) is int and
            value['app_input_entries'] == 2398)
    require(value['package_versions'] == {'electrum-client': '2.0.0',
        'react-native-tcp-socket': '6.4.1', 'realm': '12.15.0'})
    require(re.fullmatch('[a-f0-9]{64}', value['original_helper_sha256']) is not None)
    require(value['producer'].get('source_sha') == SOURCE and value['producer'].get('source_tree') == TREE and
            value['producer'].get('run_id') == 40351740729 and value['producer'].get('artifact_id') == 12666607953 and
            value['producer'].get('archive_sha256') == 'e55662352ed806ecc7b55dbfe424e62344ae6787fdd86dba39946c400c8950a8')
    require(type(value['files']) is list and 15 <= len(value['files']) <= 32)
    names = []
    for row in value['files']:
        require(type(row) is dict and set(row) == {'path', 'sha256', 'mode'})
        require(re.fullmatch(r'\.github/native/r52_[A-Za-z0-9_]+\.(?:py|js|cjs|yaml)', row['path']) is not None)
        require(re.fullmatch('[a-f0-9]{64}', row['sha256']) is not None and row['mode'] == '100644')
        names.append(row['path'])
    require(len(set(names)) == len(names) and ADAPTER in names and
            '.github/native/r52_tls_native.py' in names and '.github/native/r52_realm109_native.py' in names)
    require(type(value['patch_outputs']) is list and len(value['patch_outputs']) == 6)
    require(type(value['runtime_files']) is list and 1 <= len(value['runtime_files']) <= 768)
    all_names = []
    for row in value['patch_outputs'] + value['runtime_files']:
        require(type(row) is dict and set(row) == {'path', 'sha256'})
        require(row['path'].startswith('node_modules/') and '..' not in Path(row['path']).parts and
                re.fullmatch('[a-f0-9]{64}', row['sha256']) is not None)
        all_names.append(row['path'])
    require(len(set(all_names)) == len(all_names))
    require(type(value['ios_guards']) is list and len(value['ios_guards']) == 2)
    require({row['path'] for row in value['ios_guards']} == {
        '.github/native/ios_normal_retained_runtime.py', '.github/native/ios_fresh_runtime.py'})
    require(all(set(row) == {'path', 'sha256'} and re.fullmatch('[a-f0-9]{64}', row['sha256'])
                for row in value['ios_guards']))
    return value


def stage(env):
    """Before original-source checkout; emits hashes, never changes SOURCE_SHA."""
    context(env)
    root, state = locations(env)
    require(git(root, 'rev-parse', 'HEAD').decode().strip() == env['KEEPER_CONTROLLER_SHA'])
    raw = regular(root / MANIFEST)
    require(raw == git(root, 'show', 'HEAD:' + MANIFEST))
    manifest = read_manifest(raw)
    if env['KEEPER_NATIVE_PLATFORM'] == 'IOS':
        for row in manifest['ios_guards']:
            content = regular(root / row['path'])
            require(digest(content) == row['sha256'] and content == git(root, 'show', 'HEAD:' + row['path']))
    files = {}
    for row in manifest['files']:
        content = regular(root / row['path'])
        require(digest(content) == row['sha256'] and content == git(root, 'show', 'HEAD:' + row['path']))
        files[row['path']] = content
    state.mkdir(mode=0o700)
    (state / 'files').mkdir(mode=0o700)
    for name, content in files.items():
        new_file(state / 'files' / Path(name).name, content)
    new_file(state / 'manifest.json', raw)
    identity = dict(schema=1, controller_sha=env['KEEPER_CONTROLLER_SHA'],
        controller_tree=git(root, 'rev-parse', 'HEAD^{tree}').decode().strip(),
        manifest_sha256=digest(raw), adapter_sha256=digest(files[ADAPTER]))
    identity_raw = (json.dumps(identity, sort_keys=True) + '\n').encode()
    new_file(state / 'identity.json', identity_raw)
    with os.fdopen(os.open(env['GITHUB_ENV'], os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW), 'w') as target:
        for key, name in [('KEEPER_R52_MANIFEST_SHA256', 'manifest_sha256'),
                          ('KEEPER_R52_ADAPTER_SHA256', 'adapter_sha256')]:
            target.write(key + '=' + identity[name] + '\n')
        target.write('KEEPER_R52_IDENTITY_SHA256=' + digest(identity_raw) + '\n')
    print('R52_DIAGNOSTIC_HARNESS_STAGED_NOT_NATIVE_EXECUTION')


def staged(env):
    context(env)
    root, state = locations(env)
    directory(state)
    identity_raw = regular(state / 'identity.json')
    require(digest(identity_raw) == env.get('KEEPER_R52_IDENTITY_SHA256'))
    identity = parse(identity_raw)
    require(identity['controller_sha'] == env['KEEPER_CONTROLLER_SHA'] and
            identity['manifest_sha256'] == env.get('KEEPER_R52_MANIFEST_SHA256') and
            identity['adapter_sha256'] == env.get('KEEPER_R52_ADAPTER_SHA256'))
    raw = regular(state / 'manifest.json')
    require(digest(raw) == identity['manifest_sha256'])
    manifest = read_manifest(raw)
    require(digest(regular(Path(__file__))) == identity['adapter_sha256'])
    for row in manifest['files']:
        require(digest(regular(state / 'files' / Path(row['path']).name)) == row['sha256'])
    return root, state, manifest, identity


def original_proof(harness, manifest, env):
    """Consume the existing reviewed before/after-API + safe restore admission."""
    if harness.PLATFORM == 'IOS':
        return ios_original_proof(harness, manifest, env)
    root, temporary = harness.ROOT, Path(env['RUNNER_TEMP'])
    control = temporary / 'keeper-android-reuse-controller'
    helper_path = control / 'android_runtime_checkpoint.py'
    require(digest(regular(helper_path)) == manifest['original_helper_sha256'])
    helper = load_module(helper_path, 'r52_original_checkpoint_admission')
    admitted_root, _, original_state, selected = helper.guarded(env)
    require(admitted_root == root and selected == manifest['producer'] and selected['source_sha'] == SOURCE)
    admitted_raw = regular(original_state / 'admitted.json')
    require(digest(admitted_raw) == env.get('KEEPER_ADMISSION_SHA256'))
    admitted = parse(admitted_raw)
    require(admitted['identity']['selection'] == selected and admitted['native_acceptance'] is False and
            admitted['identity']['current_controller_sha'] == env['KEEPER_CONTROLLER_SHA'] and
            admitted['identity']['current_controller_merge'] == env['GITHUB_SHA'])
    declared_raw = regular(original_state / 'manifest.json')
    require(digest(declared_raw) == admitted['manifest_sha256'])
    declared = helper.manifest(parse(declared_raw), selected)
    old_raw = regular(original_state / 'build-metadata.json')
    require(digest(old_raw) == declared['files']['build-metadata.json']['sha256'])
    old = parse(old_raw)
    helper.built_metadata(old, selected, declared)
    data = harness.read()
    checkpoint = data.get('build_checkpoint', {})
    require(data.get('source_sha') == SOURCE and data.get('run_id') == env['GITHUB_RUN_ID'] and
            data.get('run_attempt') == '1' and data.get('build') == 'PASS' and data.get('smoke') == 'PASS' and
            data.get('workflow_sha') == env.get('GITHUB_WORKFLOW_SHA') and
            data.get('workflow_ref') == env.get('GITHUB_WORKFLOW_REF'))
    require(checkpoint.get('origin') == {key: declared[key] for key in helper.ORIGIN_KEYS} and
            checkpoint.get('archive_sha256') == selected['archive_sha256'] and
            checkpoint.get('artifact_id') == selected['artifact_id'] and checkpoint.get('native_acceptance') is False)
    require(data['configuration_overlays'] == old['configuration_overlays'] and
            data['nodeify_overlay'] == old['nodeify_overlay'] and
            data['built_artifact'] == old['built_artifact'] and
            harness.artifact_identity() == old['built_artifact'])
    require(data.get('diagnostic_only') is True and harness.PLATFORM == 'ANDROID')
    return data, admitted, digest(old_raw)


def ios_guard(root, manifest):
    for row in manifest['ios_guards']:
        require(digest(regular(root / row['path'])) == row['sha256'])
    return load_module(root / '.github/native/ios_normal_retained_runtime.py', 'r52_normal_xcode_restore_guard')


def ios_original_proof(harness, manifest, env):
    # Check all raw controller/app bytes before importing any restore-helper
    # dependency. While a probe owns generated files, this adapter's raw guard
    # admits only those driver-governed outputs; the baseline helper is unchanged.
    raw_sources(harness.ROOT, harness.read(), manifest, overlays=True)
    normal = ios_guard(harness.ROOT, manifest)
    data = normal.require_state(harness)
    proof = normal.read_proof()
    require(data.get('source_sha') == env['KEEPER_CONTROLLER_SHA'] == env['KEEPER_SOURCE_SHA'] and
            data.get('build') == 'NOT RUN' and data.get('current_source_compilation') == 'NOT RUN' and
            data.get('smoke') == 'PASS' and data.get('retained_xcode_restore') == 'PASS' and
            data.get('original_signature_preserved') is True and
            data.get('original_build', {}).get('build') == 'PASS' and
            data['original_build'].get('api_proof') == proof and proof['source_sha'] == SOURCE and
            proof['source_tree'] == TREE and proof['artifact_id'] == 12667427189 and
            proof['artifact_zip_sha256'] == '89806c9d8d71dc032d2ce3ca8b444768705d1ca3ab565aa9ec0652f0277b76f5')
    require(harness.artifact_identity() == data.get('restored_bundle_identity') == data.get('built_artifact') and
            normal.verify_signature(harness) == data['toolchain']['ios_simulator_signature'])
    original = data['original_build']
    require(original.get('original_manifest', {}).get('source_sha') == SOURCE and
            original['original_manifest'].get('source_tree') == TREE and
            original['original_manifest'].get('run_id') == '40351735911')
    normalized = dict(identity=dict(selection=proof))
    return data, normalized, digest(json.dumps(original, sort_keys=True).encode())


def admission_hash(env):
    if env['KEEPER_NATIVE_PLATFORM'] == 'IOS':
        return digest(regular(Path(env['RUNNER_TEMP']) / 'keeper-normal-ios-origin.json'))
    return env['KEEPER_ADMISSION_SHA256']


def raw_sources(root, data, manifest, overlays):
    """Every original tracked raw file; only literal diagnostic replacements vary."""
    ios = os.environ.get('KEEPER_NATIVE_PLATFORM') == 'IOS'
    expected_head = os.environ['KEEPER_CONTROLLER_SHA'] if ios else SOURCE
    require(git(root, 'rev-parse', 'HEAD').decode().strip() == expected_head)
    if not ios:
        require(git(root, 'rev-parse', 'HEAD^{tree}').decode().strip() == TREE)
    rows = [row for row in git(root, 'ls-tree', '-rz', 'HEAD').split(b'\0') if row]
    app = [row for row in rows if not row.split(b'\t', 1)[1].startswith(b'.github/')]
    require(len(app) == manifest['app_input_entries'] and digest(b'\0'.join(app) + b'\0') == APP_INPUTS)
    reader_path = root / '.github/native/android_apk_checkpoint.py'
    require(regular(reader_path) == git(root, 'show', expected_head + ':.github/native/android_apk_checkpoint.py'))
    reader = load_module(reader_path, 'r52_original_raw_reader')
    boundary_path = (root / '.github/native/r52_source_boundary.py' if overlays else
                     Path(os.environ['RUNNER_TEMP']) / 'keeper-r52-retained-controller/files/r52_source_boundary.py')
    boundary_row = next(row for row in manifest['files'] if row['path'] == '.github/native/r52_source_boundary.py')
    require(digest(regular(boundary_path)) == boundary_row['sha256'])
    boundary = load_module(boundary_path, 'r52_retained_package_boundary')
    expected_overlay_names = ({'.env.ci', 'firebase.json', 'ios/GoogleService-Info.plist',
        'ios/GoogleServices/dev/GoogleService-Info.plist'} if ios else
        {'.env.ci', 'firebase.json', 'android/app/google-services.json'})
    configuration = data.get('configuration_overlays', [])
    require(type(configuration) is list and len(configuration) == len(expected_overlay_names) and
            {row['path'] for row in configuration} == expected_overlay_names)
    hashes = {row['path']: row['sha256'] for row in configuration}
    replacements = {row['path']: row for row in manifest['files']} if overlays else {}
    descriptor = reader.directory(root)
    try:
        for name, expected in hashes.items():
            require(reader.read_file(descriptor, name, 1024 * 1024)['sha256'] == expected)
        for entry in rows:
            metadata, path = entry.split(b'\t', 1)
            mode, kind, oid = metadata.split()
            name = path.decode('utf8')
            require(kind == b'blob' and mode in [b'100644', b'100755'])
            if name in hashes:
                continue
            observed = reader.read_file(descriptor, name, 64 * 1024 * 1024, minimum=0)
            require(observed['executable'] == (mode == b'100755'))
            if name in replacements:
                require(observed['sha256'] == replacements[name]['sha256'])
            elif name == 'package.json':
                boundary.verify_package_overlay(git(root, 'cat-file', 'blob', oid.decode()),
                                                observed['bytes'], data.get('nodeify_overlay'))
            else:
                require(observed['git_blob'] == oid.decode(), 'R52_RETAINED_RAW_SOURCE_CHANGED')
        for name, expected in replacements.items():
            observed = reader.read_file(descriptor, name, 2 * 1024 * 1024, minimum=0)
            require(observed['sha256'] == expected['sha256'] and not observed['executable'])
    finally:
        os.close(descriptor)
    for ignored in [[], ['--ignored']]:
        extras = git(root, 'ls-files', '--others', '--exclude-standard', *ignored, '-z', '--', *SOURCE_OVERRIDE_PATHS)
        for raw_name in extras.split(b'\0'):
            if not raw_name:
                continue
            name = raw_name.decode('utf8')
            if name in replacements or (overlays and name == MANIFEST):
                continue
            if name.startswith('.github/native/.generated/'):
                continue  # Existing selected driver's exact generated-artifact checks still apply.
            if re.fullmatch(r'\.github/native/__pycache__/[A-Za-z0-9_]+\.cpython-[0-9]+\.pyc', name):
                continue
            raise RuntimeError('R52_RETAINED_UNTRACKED_SOURCE_OVERRIDE')


def installed_dependencies(root, manifest):
    actual_paths = []
    # Parse the unchanged committed patch inputs; there is no discovery or
    # expected-output hash update at runtime. The exact set must match literals.
    for name in manifest['package_versions']:
        package = parse(regular(root / 'node_modules' / name / 'package.json'))
        require(package['name'] == name and package['version'] == manifest['package_versions'][name])
        if name not in ['electrum-client', 'react-native-tcp-socket']:
            continue
        patch = root / 'patches' / (name + '+' + package['version'] + '.patch')
        actual_paths.extend(re.findall(r'^\+\+\+ b/(node_modules/[^\n]+)', regular(patch).decode(), re.M))
    require(set(actual_paths) == {row['path'] for row in manifest['patch_outputs']} and
            len(actual_paths) == len(set(actual_paths)))
    for row in manifest['patch_outputs'] + manifest['runtime_files']:
        require(digest(regular(root / row['path'])) == row['sha256'], 'R52_RETAINED_INSTALLED_PATCH_OUTPUT_CHANGED')
    runtime_expected = {row['path'] for row in manifest['runtime_files'] + manifest['patch_outputs']}
    # Realm's RN wrapper loads its dist tree through extensionless imports.
    # Pin the complete bounded shipped tree, including platform alternatives;
    # reject extra runtime files instead of inferring safety from the wrapper.
    for relative in ['node_modules/electrum-client/lib', 'node_modules/react-native-tcp-socket/src',
                     'node_modules/realm/dist']:
        base = root / relative
        directory(base)
        pending, count = [base], 0
        while pending:
            parent = pending.pop(); directory(parent)
            for file in parent.iterdir():
                count += 1
                require(count <= 1024 and not file.is_symlink(), 'R52_RETAINED_DEPENDENCY_SOURCE_OVERRIDE')
                if file.is_dir():
                    pending.append(file)
                else:
                    require(file.is_file() and file.relative_to(root).as_posix() in runtime_expected,
                            'R52_RETAINED_DEPENDENCY_SOURCE_OVERRIDE')
    for name in ['node_modules/electrum-client/index.js', 'node_modules/realm/index.react-native.js']:
        entry = root / name
        for sibling in entry.parent.iterdir():
            if sibling.name.startswith(entry.stem + '.') and sibling.suffix in ['.js', '.jsx', '.ts', '.tsx', '.json', '.cjs', '.mjs']:
                require(not sibling.is_symlink() and sibling.relative_to(root).as_posix() in runtime_expected,
                        'R52_RETAINED_DEPENDENCY_SOURCE_OVERRIDE')


def protected(data):
    return {key: copy.deepcopy(data[key]) for key in PROTECTED if key in data}


def install(harness, env):
    root, state, manifest, identity = staged(env)
    require(harness.ROOT == root)
    data, admitted, old_hash = original_proof(harness, manifest, env)
    ios = harness.PLATFORM == 'IOS'
    if ios:
        # Full original validator runs before fixture generation. No R52 file
        # replacement is permitted on iOS: all are exact committed controller bytes.
        ios_guard(root, manifest).require_restored(harness)
    raw_sources(root, data, manifest, overlays=ios)
    installed_dependencies(root, manifest)
    require(not (state / 'installed.json').exists())
    require(not (root / MANIFEST).exists() if not ios else
            regular(root / MANIFEST) == regular(state / 'manifest.json'))
    for row in manifest['files']:
        destination = root / row['path']
        content = regular(state / 'files' / destination.name)
        if ios:
            require(regular(destination) == content and content == git(root, 'show', 'HEAD:' + row['path']))
        elif destination.exists():
            # The raw source guard above admitted the original bytes first.
            regular(destination)
            temporary = destination.with_name(destination.name + '.r52-new')
            new_file(temporary, content)
            os.replace(temporary, destination)
        else:
            new_file(destination, content)
    if not ios:
        new_file(root / MANIFEST, regular(state / 'manifest.json'))
    baseline_raw = regular(harness.EVIDENCE, MAX_BASELINE)
    new_file(state / 'baseline-metadata.json', baseline_raw)
    receipt = dict(schema=1, scope=SCOPE, controller=identity,
        compiled_app_source_sha=SOURCE, compiled_app_tree=TREE,
        original_admission_sha256=admission_hash(env),
        producer_metadata_sha256=old_hash, baseline_metadata_sha256=digest(baseline_raw),
        protected_metadata=protected(data), producer=admitted['identity']['selection'],
        original_producer_dependency_output_manifest='NOT_CAPTURED',
        installed_patched_outputs='VERIFIED_LITERAL_CURRENT_OUTPUT_HASHES_AGAINST_IMMUTABLE_PATCH_INPUTS',
        native_acceptance=False, release_acceptance=False, current_source_compilation='NOT RUN')
    receipt_raw = (json.dumps(receipt, sort_keys=True) + '\n').encode()
    new_file(state / 'installed.json', receipt_raw)
    raw_sources(root, data, manifest, overlays=True)
    with os.fdopen(os.open(env['GITHUB_ENV'], os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW), 'w') as target:
        target.write('KEEPER_R52_INSTALL_SHA256=' + digest(receipt_raw) + '\n')
    # suite runs in one process inside the existing owned-emulator action;
    # GitHub's GITHUB_ENV additions otherwise take effect only in a later step.
    env['KEEPER_R52_INSTALL_SHA256'] = digest(receipt_raw)
    print('R52_RETAINED_HARNESS_INSTALLED_ORIGINAL_SOURCE_AND_BASELINE_UNCHANGED')


class Admission:
    """Only created by explicit retained admission, never the strict driver."""
    def __init__(self, harness, env):
        self.harness, self.env = harness, env
        root, state, self.manifest, identity = staged(env)
        require(harness.ROOT == root)
        installed_raw = regular(state / 'installed.json')
        require(digest(installed_raw) == env.get('KEEPER_R52_INSTALL_SHA256'))
        self.receipt = parse(installed_raw)
        require(self.receipt['controller'] == identity and self.receipt['scope'] == SCOPE and
                self.receipt['compiled_app_source_sha'] == SOURCE and
                self.receipt['original_admission_sha256'] == admission_hash(env))
        baseline = regular(state / 'baseline-metadata.json', MAX_BASELINE)
        require(digest(baseline) == self.receipt['baseline_metadata_sha256'] and
                protected(parse(baseline)) == self.receipt['protected_metadata'])
        self.verify_source()

    def verify_source(self):
        data, _, old_hash = original_proof(self.harness, self.manifest, self.env)
        require(protected(data) == self.receipt['protected_metadata'] and
                old_hash == self.receipt['producer_metadata_sha256'])
        root, state, manifest, identity = staged(self.env)
        require(identity == self.receipt['controller'])
        require(regular(root / MANIFEST) == regular(state / 'manifest.json'))
        raw_sources(root, data, manifest, overlays=True)
        installed_dependencies(root, manifest)

    def result_binding(self):
        return dict(compiled_app_source_sha=SOURCE, diagnostic_controller_sha=self.receipt['controller']['controller_sha'],
            app_execution_source_sha=SOURCE,
            source_sha_role=('DIAGNOSTIC_CONTROLLER' if self.harness.PLATFORM == 'IOS' else 'ORIGINAL_COMPILED_APP'),
            diagnostic_harness_source_sha=self.receipt['controller']['controller_sha'],
            diagnostic_harness_manifest_sha256=self.receipt['controller']['manifest_sha256'],
            original_producer=self.receipt['producer'],
            baseline_metadata_sha256=self.receipt['baseline_metadata_sha256'],
            execution_scope=SCOPE, current_source_compilation='NOT RUN',
            original_producer_dependency_output_manifest='NOT_CAPTURED',
            installed_patched_outputs='VERIFIED_LITERAL_CURRENT_HASHES',
            native_acceptance=False, release_acceptance=False)


def admit(harness):
    return Admission(harness, dict(os.environ))


def require_history(harness, admission):
    historical = '2b6c3ce56857b5dc92f17cc37453ff308d5a3ae8'
    manifest = parse(regular(harness.ROOT / 'tests/recovery/fixtures/realm109-node-source.json'))
    try:
        git(harness.ROOT, 'cat-file', '-e', historical + '^{commit}')
        for row in manifest['files']:
            git(harness.ROOT, 'cat-file', '-e', historical + ':' + row['path'])
    except subprocess.CalledProcessError:
        data = harness.read()
        data['r52_realm109_native'] = dict(status='NOT RUN',
            reason='HISTORICAL_109_OBJECTS_NOT_PROVISIONED', full_r52_acceptance=False,
            published_app_upgrade='NOT RUN', **admission.result_binding())
        harness.save(data)
        raise RuntimeError('R52_RETAINED_HISTORICAL_109_OBJECTS_NOT_PROVISIONED') from None


def main():
    require(len(sys.argv) == 2 and sys.argv[1] in ['stage', 'install', 'tls', 'realm109', 'suite'])
    if sys.argv[1] == 'stage':
        stage(os.environ)
        return
    # Run only the app checkout's immutable original hosted helper, validated
    # against its Git blob before import; it retains ff metadata and app paths.
    context(os.environ)
    root, _, _, _ = staged(os.environ)
    helper_path = root / '.github/native/hosted_native.py'
    helper_source = os.environ['KEEPER_CONTROLLER_SHA'] if os.environ['KEEPER_NATIVE_PLATFORM'] == 'IOS' else SOURCE
    require(regular(helper_path) == git(root, 'show', helper_source + ':.github/native/hosted_native.py'))
    harness = load_module(helper_path, 'r52_retained_original_hosted_native')
    sys.modules[harness.__name__] = harness
    if harness.PLATFORM == 'IOS':
        harness.EVIDENCE = harness.PRIVATE / 'normal-retained-runtime-metadata.json'
        manifest = staged(os.environ)[2]
        raw_sources(root, harness.read(), manifest, overlays=True)
        normal = ios_guard(root, manifest)
        normal.require_selection(harness)
        installed_verify = harness.verify_installed_artifact
        harness.verify_installed_artifact = lambda device: normal.verify_installed(harness, installed_verify, device)
    os.environ.update(ENVFILE='.env.ci', RCT_NO_LAUNCH_PACKAGER='1', RCT_NEW_ARCH_ENABLED='1',
                      MAESTRO_CLI_NO_ANALYTICS='1')
    if sys.argv[1] in ['install', 'suite']:
        install(harness, os.environ)
    if sys.argv[1] == 'install':
        return
    phases = ['tls', 'realm109'] if sys.argv[1] == 'suite' else [sys.argv[1]]
    for phase in phases:
        filename = 'r52_tls_native.py' if phase == 'tls' else 'r52_realm109_native.py'
        # Verify all staged/installed code and original inputs BEFORE loading
        # either diagnostic entrypoint, then re-admit inside that entrypoint.
        Admission(harness, dict(os.environ))
        driver = load_module(root / '.github/native' / filename, 'r52_retained_driver')
        driver.run_retained(harness)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('R52 retained diagnostic rejected; original source and native scope are not waived.', file=sys.stderr)
        sys.exit(1)
