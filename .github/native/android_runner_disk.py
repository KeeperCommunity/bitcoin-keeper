"""Prepare only unused stock .NET on a disposable private Android CI runner."""
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
STOCK = Path('/usr/share/dotnet')
TARGET = 18 * 1024 ** 3
RESERVE = 12 * 1024 ** 3  # The existing hosted_native.disk_preflight remains unchanged.
REMOVE = ['/usr/bin/sudo', '-n', '--', '/usr/bin/rm', '--recursive', '--force',
          '--one-file-system', '--preserve-root=all', '--', '/usr/share/dotnet']


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
            ROOT != workspace or workspace.is_relative_to(STOCK) or STOCK.is_relative_to(workspace)):
        raise GuardError('WORKSPACE_REJECTED')


def stock_identity():
    identities = []
    for path in (Path('/usr'), Path('/usr/share'), STOCK):
        try:
            info = path.lstat()
        except FileNotFoundError:
            if path == STOCK:
                return None
            raise GuardError('STOCK_ANCESTOR_UNVERIFIED') from None
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0:
            raise GuardError('STOCK_DIRECTORY_UNVERIFIED')
        identities.append((info.st_dev, info.st_ino))
    if os.path.ismount(STOCK) or identities[-1][0] != identities[-2][0]:
        raise GuardError('STOCK_MOUNT_REJECTED')
    mount_inventory_clear()
    return tuple(identities)


def mount_inventory_clear():
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
        if point == str(STOCK) or point.startswith(str(STOCK) + '/'):
            raise GuardError('STOCK_MOUNT_REJECTED')


def free_bytes():
    value = shutil.disk_usage(ROOT).free
    if type(value) is not int or not 0 <= value <= 2 ** 63 - 1:
        raise GuardError('DISK_QUERY_UNVERIFIED')
    return value


def prepare(env):
    result = {'schema': 1, 'scope': 'DISPOSABLE_PRIVATE_ANDROID_STOCK_TOOL_DISK_PREPARATION',
              'result': 'FAIL', 'reason': None, 'preparation_target_bytes': TARGET,
              'existing_reserve_bytes': RESERVE, 'before_free_bytes': None,
              'after_free_bytes': None, 'removed_unused_dotnet': False}
    try:
        context(env)
        result['before_free_bytes'] = before = free_bytes()
        if before >= TARGET:
            result.update(result='PASS', reason='TARGET_ALREADY_AVAILABLE', after_free_bytes=before)
            return result
        identity = stock_identity()
        if identity is None:
            result['reason'] = 'STOCK_DOTNET_ABSENT'
        else:
            # Recheck every root-owned path component immediately before the
            # one literal removal. No workspace, SDK, toolcache or fallback path.
            if stock_identity() != identity:
                raise GuardError('STOCK_DIRECTORY_CHANGED')
            command = subprocess.run(REMOVE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                     timeout=120, check=False)
            if command.returncode:
                raise GuardError('STOCK_REMOVAL_FAILED')
            try:
                STOCK.lstat()
            except FileNotFoundError:
                result['removed_unused_dotnet'] = True
            else:
                raise GuardError('STOCK_DIRECTORY_REMAINS')
            result['reason'] = 'REMOVED_UNUSED_STOCK_DOTNET'
        result['after_free_bytes'] = free_bytes()
        if result['after_free_bytes'] < RESERVE:
            raise GuardError('EXISTING_RESERVE_UNAVAILABLE')
        result['result'] = 'PASS'
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
