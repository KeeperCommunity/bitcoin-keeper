"""Meet the full install budget using only three unused stock CI toolchains."""
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
TOOLS = (('DOTNET', Path('/usr/share/dotnet')),
         ('LINUX_SWIFT', Path('/usr/share/swift')),
         ('GHCUP', Path('/usr/local/.ghcup')))
TARGET = 24 * 1024 ** 3
RESERVE = 12 * 1024 ** 3  # The existing hosted_native.disk_preflight remains unchanged.
# Actual e7 dependency/SDK installation consumed this amount on the stock image.
# The remaining 3.81 GiB is margin above that cost AND the unchanged12GiB reserve.
OBSERVED_PREPARE = 8790994944
REMOVE = {
    'DOTNET': ['/usr/bin/sudo', '-n', '--', '/usr/bin/rm', '--recursive', '--force',
               '--one-file-system', '--preserve-root=all', '--', '/usr/share/dotnet'],
    'LINUX_SWIFT': ['/usr/bin/sudo', '-n', '--', '/usr/bin/rm', '--recursive', '--force',
                    '--one-file-system', '--preserve-root=all', '--', '/usr/share/swift'],
    'GHCUP': ['/usr/bin/sudo', '-n', '--', '/usr/bin/rm', '--recursive', '--force',
              '--one-file-system', '--preserve-root=all', '--', '/usr/local/.ghcup'],
}


class GuardError(Exception):
    pass


def context(env):
    expected = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
                'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64', 'ImageOS': 'ubuntu24',
                'KEEPER_NATIVE_PLATFORM': 'ANDROID', 'KEEPER_DIAGNOSTIC': 'true',
                'GITHUB_REPOSITORY': 'KeeperCommunity/bitcoin-keeper-private',
                'GITHUB_REPOSITORY_ID': '839671816'}
    if any(env.get(key) != value for key, value in expected.items()):
        raise GuardError('CONTEXT_REJECTED')
    release = platform.freedesktop_os_release()
    if (platform.system() != 'Linux' or platform.machine() != 'x86_64' or
            release.get('ID') != 'ubuntu' or release.get('VERSION_ID') != '24.04'):
        raise GuardError('SYSTEM_REJECTED')
    workspace = Path(env.get('GITHUB_WORKSPACE', ''))
    if (not workspace.is_absolute() or workspace.resolve(strict=True) != workspace or
            ROOT != workspace or any(workspace.is_relative_to(path) or path.is_relative_to(workspace)
                                     for _, path in TOOLS)):
        raise GuardError('WORKSPACE_REJECTED')


def stock_identity(stock):
    if stock not in tuple(path for _, path in TOOLS):
        raise GuardError('STOCK_PATH_REJECTED')
    identities = []
    for path in (*reversed(stock.parents[:-1]), stock):
        try:
            info = path.lstat()
        except FileNotFoundError:
            if path == stock:
                return None
            raise GuardError('STOCK_ANCESTOR_UNVERIFIED') from None
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0:
            raise GuardError('STOCK_DIRECTORY_UNVERIFIED')
        identities.append((info.st_dev, info.st_ino))
    if os.path.ismount(stock) or identities[-1][0] != identities[-2][0]:
        raise GuardError('STOCK_MOUNT_REJECTED')
    mount_inventory_clear(stock)
    return tuple(identities)


def mount_inventory_clear(stock):
    # Bind mounts may share a device number. Reject the target and nested
    # mounts too, rather than relying only on rm --one-file-system.
    with Path('/proc/self/mountinfo').open('rb') as source:
        raw = source.read(262145)
    if len(raw) > 262144 or not raw.endswith(b'\n'):
        raise GuardError('MOUNT_INVENTORY_UNVERIFIED')
    lines = raw.decode('utf-8', errors='strict').splitlines()
    if not 1 <= len(lines) <= 2048:
        raise GuardError('MOUNT_INVENTORY_UNVERIFIED')
    for line in lines:
        fields = line.split()
        if (len(fields) < 10 or not fields[0].isdigit() or not fields[1].isdigit() or
                '-' not in fields[6:] or not fields[4].startswith('/')):
            raise GuardError('MOUNT_INVENTORY_UNVERIFIED')
        point = re.sub(r'\\(040|011|012|134)', lambda match: chr(int(match[1], 8)), fields[4])
        if '\\' in point or '\x00' in point:
            raise GuardError('MOUNT_INVENTORY_UNVERIFIED')
        if point == str(stock) or point.startswith(str(stock) + '/'):
            raise GuardError('STOCK_MOUNT_REJECTED')


def free_bytes():
    value = shutil.disk_usage(ROOT).free
    if type(value) is not int or not 0 <= value <= 2 ** 63 - 1:
        raise GuardError('DISK_QUERY_UNVERIFIED')
    return value


def stock_allocated_bytes(stock):
    """Retain fixed-path numeric inventory even when cleanup cannot meet budget."""
    if stock not in tuple(path for _, path in TOOLS):
        return None
    try:
        observed = subprocess.run(['/usr/bin/du', '-s', '-x', '--block-size=1', '--', str(stock)],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30, check=False)
        match = re.fullmatch(rb'([0-9]{1,20})\t' + re.escape(str(stock).encode()) + rb'\n',
                             observed.stdout)
        if observed.returncode == 0 and match and int(match[1]) < 2 ** 63:
            return int(match[1])
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    return None


def prepare(env):
    result = {'schema': 1, 'scope': 'DISPOSABLE_PRIVATE_ANDROID_STOCK_TOOL_DISK_PREPARATION',
              'result': 'FAIL', 'reason': None, 'preparation_target_bytes': TARGET,
              'existing_reserve_bytes': RESERVE, 'before_free_bytes': None,
              'observed_prepare_bytes': OBSERVED_PREPARE,
              'dependency_growth_margin_bytes': TARGET - RESERVE - OBSERVED_PREPARE,
              'after_free_bytes': None, 'removed_unused_dotnet': False,
              'tools': {label: 'NOT_EXAMINED' for label, _ in TOOLS},
              'tool_inventory': {label: {'allocated_bytes': None, 'before_free_bytes': None,
                                         'after_free_bytes': None} for label, _ in TOOLS}}
    try:
        context(env)
        result['before_free_bytes'] = available = free_bytes()
        if available >= TARGET:
            result.update(result='PASS', reason='TARGET_ALREADY_AVAILABLE', after_free_bytes=available)
            return result
        for label, stock in TOOLS:
            inventory = result['tool_inventory'][label]
            inventory['before_free_bytes'] = available
            identity = stock_identity(stock)
            if identity is None:
                result['tools'][label] = 'ABSENT'
                inventory.update(allocated_bytes=0, after_free_bytes=available)
                continue
            inventory['allocated_bytes'] = stock_allocated_bytes(stock)
            # Each literal unused tool is independently checked immediately
            # before removal. No SDK, Java, Node, cache or workspace is selected.
            if stock_identity(stock) != identity:
                raise GuardError('STOCK_DIRECTORY_CHANGED')
            command = subprocess.run(REMOVE[label], stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL, timeout=120, check=False)
            if command.returncode:
                raise GuardError('STOCK_REMOVAL_FAILED')
            try:
                stock.lstat()
            except FileNotFoundError:
                result['tools'][label] = 'REMOVED'
                if label == 'DOTNET':
                    result['removed_unused_dotnet'] = True
            else:
                raise GuardError('STOCK_DIRECTORY_REMAINS')
            result['after_free_bytes'] = available = free_bytes()
            inventory['after_free_bytes'] = available
            if result['after_free_bytes'] >= TARGET:
                result.update(result='PASS', reason='FULL_INSTALL_BUDGET_AVAILABLE')
                return result
        result['after_free_bytes'] = free_bytes()
        raise GuardError('FULL_INSTALL_BUDGET_UNAVAILABLE')
    except GuardError as error:
        result['reason'] = str(error)  # Fixed local vocabulary, never tool output.
    except (OSError, ValueError, subprocess.SubprocessError):
        result['reason'] = 'PREPARATION_IO_UNVERIFIED'
    return result


def main():
    if len(sys.argv) != 1:
        print('Android runner preparation takes no path or override arguments.')
        return 1
    result = prepare(os.environ)
    print(json.dumps(result, sort_keys=True))
    return 0 if result['result'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
