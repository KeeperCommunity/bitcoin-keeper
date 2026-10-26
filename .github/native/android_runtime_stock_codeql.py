"""Reclaim only fixed unused CodeQL and side-by-side NDK29 on an admitted host."""
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

STOCK = Path('/opt/hostedtoolcache/CodeQL')
STOCK_PARENT = Path('/opt/hostedtoolcache')
NDK = Path('/usr/local/lib/android/sdk/ndk/29.0.14206865')
SDK = Path('/usr/local/lib/android/sdk')
EXTRA = (('CODEQL', STOCK), ('NDK29', NDK))
ORIGINAL_SHA = '996dce07b3a14fa03198cbec52cd58ec5ec6204bf9f8106e3a42f9c232653498'
HOSTED_SHA = 'bfaad2396681be811768b53df85189509830236a61d30d40fb8a4eae7bd2db1c'
TARGET = 24 * 1024 ** 3
RESERVE = 12 * 1024 ** 3
# Exact shortfall after all three original stock tools in40359401864.
MINIMUM_BRIDGE = TARGET - 22955515904
REMOVE = {
    'CODEQL': ['/usr/bin/sudo', '-n', '--', '/usr/bin/rm', '--recursive', '--force',
              '--one-file-system', '--preserve-root=all', '--', '/opt/hostedtoolcache/CodeQL'],
    'NDK29': ['/usr/bin/sudo', '-n', '--', '/usr/bin/rm', '--recursive', '--force',
             '--one-file-system', '--preserve-root=all', '--', '/usr/local/lib/android/sdk/ndk/29.0.14206865'],
}


class Rejected(Exception):
    pass


def require(value, reason):
    if not value:
        raise Rejected(reason)


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


def admitted_context(env):
    require(all(env.get(k) == v for k, v in {'GITHUB_ACTIONS': 'true',
        'RUNNER_ENVIRONMENT': 'github-hosted', 'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64',
        'ImageOS': 'ubuntu24', 'GITHUB_REPOSITORY_ID': '839671816',
        'GITHUB_REPOSITORY': 'KeeperCommunity/bitcoin-keeper-private',
        'GITHUB_EVENT_NAME': 'pull_request', 'GITHUB_RUN_ATTEMPT': '1',
        'GITHUB_WORKFLOW_REF': 'KeeperCommunity/bitcoin-keeper-private/.github/workflows/keeper-private-android-runtime-reuse.yml@refs/pull/73/merge',
        'KEEPER_NATIVE_PLATFORM': 'ANDROID', 'KEEPER_DIAGNOSTIC': 'true',
        'RUNNER_TOOL_CACHE': '/opt/hostedtoolcache'}.items()), 'CONTEXT_REJECTED')
    control = Path(env['RUNNER_TEMP']) / 'keeper-android-reuse-controller'
    helper = control / 'android_runtime_checkpoint.py'
    require(not helper.is_symlink() and hashlib.sha256(helper.read_bytes()).hexdigest() == env['KEEPER_HELPER_SHA256'], 'CONTROLLER_HELPER_REJECTED')
    runtime = module(helper, 'controller_runtime_guard')
    root, _, state, selected = runtime.guarded(env)
    require(Path(__file__).resolve() == control / 'android_runtime_stock_codeql.py', 'CONTROLLER_LOCATION_REJECTED')
    event = runtime.parse(runtime.regular(Path(env['GITHUB_EVENT_PATH']), 1024 * 1024))
    pr = event['pull_request']; labels = {row['name'] for row in pr['labels']}
    require(event.get('action') == 'labeled' and event.get('label', {}).get('name') == 'keeper/android-runtime-reuse' and
        event['repository']['id'] == 839671816 and event['repository']['private'] is True and
        pr['number'] == 73 and pr['head']['repo']['id'] == 839671816 and
        pr['head']['sha'] == env['KEEPER_CONTROLLER_SHA'] and 'keeper/android-runtime-reuse' in labels and
        'keeper/native-diagnostic' not in labels, 'RUNTIME_SELECTION_REJECTED')
    admitted = runtime.parse(runtime.regular(state / 'admitted.json', runtime.MAX_META))
    require(admitted['native_acceptance'] is False and admitted['identity']['selection'] == selected,
        'ARCHIVE_ADMISSION_REQUIRED')
    path = root / '.github/native/android_runner_disk.py'
    raw = runtime.regular(path, runtime.MAX_META)
    require(raw == runtime.git(root, 'show', 'HEAD:.github/native/android_runner_disk.py') and
        hashlib.sha256(raw).hexdigest() == ORIGINAL_SHA, 'ORIGINAL_DISK_POLICY_REJECTED')
    policy = module(path, 'original_unchanged_disk_policy')
    require(policy.TARGET == TARGET and policy.RESERVE == RESERVE, 'ORIGINAL_BUDGET_REJECTED')
    try:
        policy.context(env)
    except policy.GuardError:
        raise Rejected('ORIGINAL_DISK_CONTEXT_REJECTED') from None
    require(all(env.get(key) == str(SDK) for key in ('ANDROID_HOME', 'ANDROID_SDK_ROOT')),
        'SDK_ROOT_REJECTED')
    # Unchanged prepare installs and verifies 27.1, never 29. Preserve
    # stock default 27.3 and latest 30, including inherited NDK aliases.
    hosted = runtime.regular(root / '.github/native/hosted_native.py', 1024 * 1024)
    require(hashlib.sha256(hosted).hexdigest() == HOSTED_SHA and
        hosted == runtime.git(root, 'show', 'HEAD:.github/native/hosted_native.py'),
        'PINNED_NDK_DEPENDENCY_REJECTED')
    runtime_paths_clear(root, env)
    return policy


def overlaps(path):
    return any(path.resolve().is_relative_to(stock) for _, stock in EXTRA)


def runtime_paths_clear(root, env):
    # SDK is an expected ancestor of NDK29, not an active NDK29 interpreter.
    # No workspace, executable, tool, NDK alias or open current-process file
    # may resolve inside either selected target.
    paths = [root, Path.cwd(), Path(sys.executable), Path('/proc/self/exe').resolve()]
    paths += [Path(env[key]) for key in ('JAVA_HOME', 'ANDROID_NDK', 'ANDROID_NDK_HOME',
        'ANDROID_NDK_ROOT', 'ANDROID_NDK_LATEST_HOME') if env.get(key)]
    paths += [Path(found) for name in ('python3', 'node', 'java', 'adb', 'sdkmanager', 'maestro',
        'ndk-build', 'clang', 'clang++', 'cmake', 'ninja', 'codeql') if (found := shutil.which(name))]
    require(not any(stock.is_relative_to(root.resolve()) for _, stock in EXTRA),
        'RUNTIME_WORKSPACE_OVERLAP_REJECTED')
    for descriptor in Path('/proc/self/fd').iterdir():
        try:
            target = os.readlink(descriptor)
        except FileNotFoundError:
            continue  # The directory iterator's descriptor may close.
        if target.startswith('/'):
            paths.append(Path(target.removesuffix(' (deleted)')))
    with Path('/proc/self/maps').open('rb') as source:
        maps = source.read(4 * 1024 * 1024 + 1)
    require(len(maps) <= 4 * 1024 * 1024, 'LIVE_MAPS_UNVERIFIED')
    for line in maps.decode('utf-8', errors='strict').splitlines():
        fields = line.split(None, 5)
        if len(fields) == 6 and fields[5].startswith('/'):
            paths.append(Path(fields[5].removesuffix(' (deleted)')))
    require(all(not overlaps(path) for path in paths), 'RUNTIME_TOOL_OVERLAP_REJECTED')


def stock_identity(policy, stock):
    require(stock in (STOCK, NDK), 'STOCK_PATH_REJECTED')
    rows = []
    for path in (*reversed(stock.parents), stock):
        try:
            info = path.lstat()
        except FileNotFoundError:
            require(path == stock, 'STOCK_ANCESTOR_MISSING')
            return None
        owners = {0} if path in (Path('/'), Path('/opt'), Path('/usr'), Path('/usr/local'),
            Path('/usr/local/lib')) else {0, os.getuid()}
        require(stat.S_ISDIR(info.st_mode) and info.st_uid in owners and path.resolve(strict=True) == path,
            'STOCK_DIRECTORY_UNVERIFIED')
        rows.append((info.st_dev, info.st_ino))
    require(not os.path.ismount(stock) and rows[-1][0] == rows[-2][0] == policy.ROOT.stat().st_dev,
        'STOCK_MOUNT_REJECTED')
    policy.mount_inventory_clear(stock)
    if stock == NDK:
        properties = NDK / 'source.properties'
        info = properties.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid in {0, os.getuid()} and info.st_size <= 16384,
            'NDK_PACKAGE_UNVERIFIED')
        raw = properties.read_bytes()
        revisions = re.findall(rb'^Pkg.Revision\s*=\s*([^\r\n]+)\s*$', raw, flags=re.M)
        require(revisions == [b'29.0.14206865'], 'NDK_PACKAGE_UNVERIFIED')
    return tuple(rows)


def allocated_bytes(paths):
    allowed = (STOCK, NDK, Path('/usr/share/dotnet'), Path('/usr/share/swift'), Path('/usr/local/.ghcup'))
    require(paths and len(set(paths)) == len(paths) and all(path in allowed for path in paths),
        'STOCK_SIZE_PATH_REJECTED')
    # One invocation counts shared hard links once across all five candidates.
    result = subprocess.run(['/usr/bin/du', '-s', '-x', '--block-size=1', '--', *map(str, paths)],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30, check=False)
    require(result.returncode == 0 and len(result.stdout) <= 4096 and result.stdout.endswith(b'\n'),
        'STOCK_SIZE_UNVERIFIED')
    lines = result.stdout.splitlines()
    require(len(lines) == len(paths), 'STOCK_SIZE_UNVERIFIED')
    sizes = {}
    for path, line in zip(paths, lines):
        match = re.fullmatch(rb'([0-9]{1,20})\t' + re.escape(str(path).encode()), line)
        require(match and int(match[1]) < 2 ** 63, 'STOCK_SIZE_UNVERIFIED')
        sizes[path] = int(match[1])
    return sizes



def capacity_inventory(policy, before_free_bytes):
    """Pure validation/measurement; never performs removal or supplies native credit."""
    result = {'before_free_bytes': before_free_bytes}
    identities = {stock: stock_identity(policy, stock) for _, stock in EXTRA}
    require(all(value is not None for value in identities.values()), 'FIXED_EXTRA_STOCK_ABSENT_STOP')
    original = {stock: policy.stock_identity(stock) for _, stock in policy.TOOLS}
    paths = [*identities, *(path for path, identity in original.items() if identity is not None)]
    sizes = allocated_bytes(paths)
    result['allocated_bytes'] = {str(path): size for path, size in sizes.items()}
    result['measured_total_reclaim_bytes'] = sum(sizes.values())
    result['measured_extra_reclaim_bytes'] = sum(sizes[stock] for _, stock in EXTRA)
    original_bytes = sum(sizes.get(stock, 0) for stock in original)
    result['required_extra_reclaim_bytes'] = max(MINIMUM_BRIDGE, TARGET - before_free_bytes - original_bytes)
    return result, identities, original

def prepare(env):
    result = {'schema': 2, 'scope': 'CONTROLLER_ONLY_FIXED_UNUSED_CODEQL_AND_NDK29_NOT_NATIVE_ACCEPTANCE',
        'native_acceptance': False, 'result': 'FAIL', 'reason': None,
        'target_bytes': TARGET, 'reserve_bytes': RESERVE, 'minimum_bridge_bytes': MINIMUM_BRIDGE,
        'allocated_bytes': {}, 'before_free_bytes': None, 'after_free_bytes': None, 'removed': [],
        'measured_total_reclaim_bytes': None, 'measured_extra_reclaim_bytes': None,
        'required_extra_reclaim_bytes': None}
    try:
        policy = admitted_context(env)
        result['before_free_bytes'] = policy.free_bytes()
        if result['before_free_bytes'] >= TARGET:
            result.update(result='READY_FOR_UNCHANGED_ORIGINAL_GUARD', reason='TARGET_ALREADY_AVAILABLE',
                after_free_bytes=result['before_free_bytes'])
            return result
        inventory, identities, original = capacity_inventory(policy, result['before_free_bytes'])
        result.update(inventory)
        require(result['measured_extra_reclaim_bytes'] >= result['required_extra_reclaim_bytes'],
            'COMBINED_FIXED_STOCK_TOO_SMALL_STOP')
        # Recheck every identity after measurement, then each target immediately
        # before its literal removal. No threshold is relaxed for CodeQL alone.
        require(all(policy.stock_identity(stock) == identity for stock, identity in original.items()),
            'ORIGINAL_STOCK_DIRECTORY_CHANGED')
        require(all(stock_identity(policy, stock) == identity for stock, identity in identities.items()),
            'STOCK_DIRECTORY_CHANGED')
        for label, stock in EXTRA:
            runtime_paths_clear(Path(env['GITHUB_WORKSPACE']), env)
            require(stock_identity(policy, stock) == identities[stock], 'STOCK_DIRECTORY_CHANGED')
            removed = subprocess.run(REMOVE[label], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                timeout=120, check=False)
            require(removed.returncode == 0, 'STOCK_REMOVAL_FAILED')
            try:
                stock.lstat()
            except FileNotFoundError:
                result['removed'].append(label)
            require(label in result['removed'], 'STOCK_DIRECTORY_REMAINS')
        result['after_free_bytes'] = policy.free_bytes()
        require(result['after_free_bytes'] >= result['before_free_bytes'], 'DISK_FREE_DECREASED')
        result.update(result='READY_FOR_UNCHANGED_ORIGINAL_GUARD', reason='FIXED_UNUSED_STOCK_REMOVED')
    except Rejected as error:
        result['reason'] = str(error)
    except Exception:
        result['reason'] = 'CAPACITY_OBSERVATION_UNVERIFIED'
    return result


if __name__ == '__main__':
    require(len(sys.argv) == 1, 'NO_ARGUMENTS_ALLOWED')
    result = prepare(os.environ)
    print('KEEPER_RUNTIME_STOCK_CODEQL ' + json.dumps(result, sort_keys=True), flush=True)
    raise SystemExit(0 if result['result'] == 'READY_FOR_UNCHANGED_ORIGINAL_GUARD' else 1)
