"""Raw source and owned-device boundaries for prepared native diagnostic apps.

Ported from independently reviewed native109 boundary8e43c2a12d99e5ce0f4f2da6bcfa0fbd4a79abac.
Nodeify may alter only its three recorded package mapping fields; no Git diff/index
flag can conceal changed production bytes. A candidate is never a cleanup target.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess

SOURCE_PATHS = ['.github/native', 'tests/electrum', 'src', 'package.json', 'yarn.lock',
                'app.json', 'babel.config.js', 'metro.config.js', 'shim.js', 'index.js',
                'tsconfig.json', 'react-native.config.js', 'patches']

def owned_device(candidate, platform):
    pattern = r'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}' if platform == 'IOS' else 'emulator-[0-9]+'
    if platform not in ['IOS', 'ANDROID'] or not re.fullmatch(pattern, candidate):
        raise RuntimeError('TLS_OWNED_DEVICE_REQUIRED')
    return candidate


def require_free_metro_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        # Match Node's reusable TCP bind: a closed owned server's TIME_WAIT
        # tuple is not a live listener. An active listener still rejects bind.
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            listener.bind(('127.0.0.1', 8081))
        except OSError as error:
            raise RuntimeError('TLS_METRO_PORT_OCCUPIED') from error


def verify_package_overlay(original, installed, overlay):
    allowed = ['browser', 'react-native', 'browserify']
    if (not isinstance(overlay, dict) or overlay.get('path') != 'package.json'
            or overlay.get('allowed_fields') != allowed
            or overlay.get('before_sha256') != hashlib.sha256(original).hexdigest()
            or overlay.get('after_sha256') != hashlib.sha256(installed).hexdigest()):
        raise RuntimeError('TLS_PACKAGE_OVERLAY_UNRECORDED')
    before, after = json.loads(original), json.loads(installed)
    for name in allowed:
        before.pop(name, None); after.pop(name, None)
    if json.dumps(before, sort_keys=True) != json.dumps(after, sort_keys=True):
        raise RuntimeError('TLS_PACKAGE_PROTECTED_FIELDS')


def verify_source(root, source, overlay=None):
    """Compare immutable Git blob bytes, including files hidden from git diff."""
    environment = dict(PATH=os.environ.get('PATH', ''), GIT_CONFIG_NOSYSTEM='1',
                       GIT_CONFIG_GLOBAL=os.devnull, GIT_TERMINAL_PROMPT='0', GIT_ALLOW_PROTOCOL='')
    def git(*args):
        return subprocess.check_output(['git', '--no-replace-objects', *args], cwd=root, env=environment)
    if not re.fullmatch('[a-f0-9]{40}', source) or git('rev-parse', 'HEAD').decode().strip() != source:
        raise RuntimeError('TLS_RAW_SOURCE_HEAD')
    entries = git('ls-tree', '-r', '-z', source, '--', *SOURCE_PATHS).split(b'\0')
    entries = [entry for entry in entries if entry]
    if not entries:
        raise RuntimeError('TLS_RAW_SOURCE_EMPTY')
    for ignored in [[], ['--ignored']]:
        extra = git('ls-files', '--others', '--exclude-standard', *ignored, '-z', '--', *SOURCE_PATHS)
        for raw_name in extra.split(b'\0'):
            if not raw_name:
                continue
            name = raw_name.decode('utf8')
            if name.startswith('.github/native/.generated/'):
                continue  # the selected driver validates its owned generated config separately
            if re.fullmatch(r'\.github/native/__pycache__/[A-Za-z0-9_]+\.cpython-[0-9]+\.pyc', name):
                continue
            raise RuntimeError('TLS_UNTRACKED_SOURCE')
    process = subprocess.Popen(['git', '--no-replace-objects', 'cat-file', '--batch'], cwd=root,
                               env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        for entry in entries:
            metadata, name = entry.split(b'\t', 1)
            mode, kind, oid = metadata.split(b' ')
            relative = Path(name.decode('utf8'))
            file = root / relative
            if (mode not in [b'100644', b'100755'] or kind != b'blob' or relative.is_absolute()
                    or '..' in relative.parts or not file.is_file() or file.is_symlink()
                    or any((root / parent).is_symlink() for parent in relative.parents)
                    or file.stat().st_size > 32 * 1024 * 1024):
                raise RuntimeError('TLS_RAW_SOURCE_PATH')
            process.stdin.write(oid + b'\n'); process.stdin.flush()
            header = process.stdout.readline(128).split()
            if len(header) != 3 or header[0] != oid or header[1] != b'blob':
                raise RuntimeError('TLS_RAW_SOURCE_OBJECT')
            size = int(header[2])
            if size < 0 or size > 32 * 1024 * 1024:
                raise RuntimeError('TLS_RAW_SOURCE_SIZE')
            raw = process.stdout.read(size)
            if len(raw) != size or process.stdout.read(1) != b'\n':
                raise RuntimeError('TLS_RAW_SOURCE_BYTES')
            installed = file.read_bytes()
            if relative.as_posix() == 'package.json' and overlay is not None:
                verify_package_overlay(raw, installed, overlay)
            elif raw != installed:
                if relative.as_posix() != 'package.json':
                    raise RuntimeError('TLS_RAW_SOURCE_BYTES')
                verify_package_overlay(raw, installed, overlay)
        process.stdin.close()
        if process.wait(timeout=10) != 0:
            raise RuntimeError('TLS_RAW_SOURCE_GIT')
    finally:
        if not process.stdin.closed:
            process.stdin.close()
        if process.poll() is None:
            process.kill(); process.wait(timeout=10)
        process.stdout.close()
    if git('rev-parse', 'HEAD').decode().strip() != source:
        raise RuntimeError('TLS_RAW_SOURCE_HEAD')
