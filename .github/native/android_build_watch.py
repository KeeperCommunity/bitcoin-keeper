"""Bounded private build observations survive runner termination; no build credit."""
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
INTERVAL_SECONDS = 60
TAIL_BYTES = 262144
MAX_JSON = 1024 * 1024
BUILD_LABEL = 'Build debug-key-only development APK'
REPO = 'KeeperCommunity/bitcoin-keeper-private'


class Interrupted(BaseException):
    def __init__(self, signum):
        self.signum = signum


def require(value):
    if not value:
        raise ValueError('PRIVATE_ANDROID_BUILD_WATCH_REJECTED')


def directory(path):
    require(path.is_absolute() and path.resolve(strict=True) == path)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid())


def regular(path, cap):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as source:
        before = os.fstat(source.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1)
        require(0 < before.st_size <= cap)
        raw = source.read(cap + 1)
        after = os.fstat(source.fileno())
        require(len(raw) == before.st_size and (before.st_dev, before.st_ino, before.st_size,
                before.st_mtime_ns) == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns))
        return raw


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL, timeout=30)


def context(root, env):
    directory(root)
    directory(Path(env['RUNNER_TEMP']))
    expected = {'GITHUB_ACTIONS': 'true', 'GITHUB_EVENT_NAME': 'pull_request',
        'GITHUB_REPOSITORY': REPO, 'GITHUB_REPOSITORY_ID': '839671816',
        'RUNNER_ENVIRONMENT': 'github-hosted', 'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64',
        'ImageOS': 'ubuntu24', 'KEEPER_NATIVE_PLATFORM': 'ANDROID', 'KEEPER_DIAGNOSTIC': 'true',
        'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_WORKSPACE': str(root),
        'GITHUB_WORKFLOW_REF': REPO + '/.github/workflows/keeper-native-diagnostic.yml@refs/pull/73/merge'}
    require(all(env.get(key) == value for key, value in expected.items()))
    for key in ('KEEPER_SOURCE_SHA', 'GITHUB_WORKFLOW_SHA'):
        require(re.fullmatch('[0-9a-f]{40}', env.get(key, '')))
    require(re.fullmatch('[1-9][0-9]{0,15}', env.get('GITHUB_RUN_ID', '')))
    event = json.loads(regular(Path(env['GITHUB_EVENT_PATH']), MAX_JSON))
    require(event['repository']['id'] == 839671816 and event['repository']['private'] is True)
    require(event['pull_request']['number'] == 73 and
            event['pull_request']['head']['sha'] == env['KEEPER_SOURCE_SHA'] and
            event['pull_request']['head']['repo']['id'] == 839671816)
    require(git(root, 'rev-parse', 'HEAD').decode().strip() == env['KEEPER_SOURCE_SHA'])
    git(root, 'diff', '--exit-code', 'HEAD', '--', '.github/native', '.github/workflows')
    return {'source_sha': env['KEEPER_SOURCE_SHA'],
            'source_tree': git(root, 'rev-parse', 'HEAD^{tree}').decode().strip(),
            'run_id': int(env['GITHUB_RUN_ID']), 'run_attempt': 1,
            'workflow_sha': env['GITHUB_WORKFLOW_SHA']}


def policy_module(root):
    path = root / '.github/native/android_build_failure.py'
    raw = regular(path, MAX_JSON)
    require(raw == git(root, 'show', 'HEAD:.github/native/android_build_failure.py'))
    spec = importlib.util.spec_from_file_location('bound_android_progress_policy', path)
    module = importlib.util.module_from_spec(spec)
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def progress(root, temporary, policy):
    result = {'state': 'UNAVAILABLE', 'log_bytes': None, 'sample_bytes': 0,
              'tail_only': False, 'last_write_age_seconds': None,
              'task_records': [], 'signals': []}
    try:
        metadata = root / 'artifacts/native/android/metadata.json'
        for parent in (root / 'artifacts', metadata.parent.parent, metadata.parent):
            directory(parent)
        data = json.loads(regular(metadata, MAX_JSON))
        require(data['source_sha'] == git(root, 'rev-parse', 'HEAD').decode().strip())
        commands = data['commands']
        require(type(commands) is list and len(commands) <= 512)
        selected = [(index, row) for index, row in enumerate(commands, 1)
                    if type(row) is dict and row.get('label') == BUILD_LABEL]
        if not selected:
            result['state'] = 'BUILD_COMMAND_NOT_STARTED'
            return result
        require(len(selected) == 1)
        private = temporary / 'keeper-native-private'
        directory(private)
        descriptor = os.open(private / ('command-%03d.log' % selected[0][0]),
                             os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, 'rb') as source:
            before = os.fstat(source.fileno())
            require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1)
            require(0 <= before.st_size < 2 ** 53)
            start = max(0, before.st_size - TAIL_BYTES)
            source.seek(start)
            raw = source.read(before.st_size - start)
            after = os.fstat(source.fileno())
            require(len(raw) == before.st_size - start and
                    (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino) and
                    after.st_size >= before.st_size and after.st_nlink == 1)
        if start:
            # A record cut by the bounded tail is never treated as a whole task.
            raw = raw.partition(b'\n')[2]
        projection = policy.project(raw, root, policy.module_names(root))
        age = time.time() - before.st_mtime
        result.update(state='OBSERVED', log_bytes=before.st_size, sample_bytes=len(raw),
            tail_only=start > 0,
            last_write_age_seconds=round(age, 1) if math.isfinite(age) and 0 <= age <= 86400 else None,
            task_records=projection['task_records'][-8:], signals=projection['signals'])
    except Exception:
        pass  # Observation failure cannot change a build's actual result.
    return result


def resources(root):
    result = {'free_disk_bytes': None, 'available_memory_bytes': None, 'logical_cpus': None}
    try:
        free = shutil.disk_usage(root).free
        require(type(free) is int and 0 <= free < 2 ** 63)
        result['free_disk_bytes'] = free
    except Exception:
        pass
    try:
        raw = Path('/proc/meminfo').read_bytes()
        require(len(raw) <= 16384)
        matches = re.findall(rb'^MemAvailable: +([0-9]{1,16}) kB$', raw, re.MULTILINE)
        require(len(matches) == 1)
        value = int(matches[0]) * 1024
        require(value < 2 ** 63)
        result['available_memory_bytes'] = value
    except Exception:
        pass
    cpus = os.cpu_count()
    if type(cpus) is int and 0 < cpus <= 1024:
        result['logical_cpus'] = cpus
    return result


def emit(identity, root, temporary, policy, started, event, code=None):
    elapsed = time.monotonic() - started
    require(event in ('START', 'SAMPLE', 'EXIT', 'SIGTERM', 'SIGINT'))
    require(math.isfinite(elapsed) and elapsed >= 0)
    require(code is None or type(code) is int and -128 <= code <= 255)
    value = {'schema': 1, 'scope': 'PRIVATE_ANDROID_BUILD_OBSERVATION_NOT_CAUSE_OR_ACCEPTANCE',
        'native_acceptance': False, **identity, 'event': event,
        'elapsed_seconds': round(elapsed, 1), 'child_exit_code': code,
        'progress': progress(root, temporary, policy), 'resources': resources(root)}
    print('KEEPER_ANDROID_BUILD_OBSERVATION ' + json.dumps(value, sort_keys=True), flush=True)


def terminate_owned(proc):
    if proc.poll() is not None:
        return
    # start_new_session binds this group to our child; never signal the runner.
    require(proc.pid > 1 and proc.pid != os.getpgrp())
    try:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=10)
    except ProcessLookupError:
        return
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait(timeout=10)


def run(root, env, interval=INTERVAL_SECONDS):
    identity = context(root, env)
    policy = policy_module(root)
    temporary = Path(env['RUNNER_TEMP'])
    started = time.monotonic()
    proc = None
    old_handlers = {}
    received_signal = None
    def interrupted(signum, _frame):
        nonlocal received_signal
        if received_signal is not None:
            return
        received_signal = signum
        raise Interrupted(signum)
    try:
        for signum in (signal.SIGTERM, signal.SIGINT):
            old_handlers[signum] = signal.signal(signum, interrupted)
        child_env = {**env, 'KEEPER_ANDROID_BUILD_WATCHED': '1'}
        proc = subprocess.Popen([sys.executable, str(root / '.github/native/hosted_native.py'), 'build'],
                                cwd=root, env=child_env, start_new_session=True)
        emit(identity, root, temporary, policy, started, 'START')
        while True:
            try:
                code = proc.wait(timeout=interval)
                emit(identity, root, temporary, policy, started, 'EXIT', code)
                return code if code >= 0 else 128 - code
            except subprocess.TimeoutExpired:
                emit(identity, root, temporary, policy, started, 'SAMPLE')
    except Interrupted as stop:
        # Emit while the host still permits output, then clean only our child.
        emit(identity, root, temporary, policy, started,
             'SIGTERM' if stop.signum == signal.SIGTERM else 'SIGINT')
        if proc is not None:
            terminate_owned(proc)
        return 128 + stop.signum
    finally:
        if proc is not None and proc.poll() is None:
            terminate_owned(proc)
        for signum, previous in old_handlers.items():
            signal.signal(signum, previous)


def main():
    try:
        require(len(sys.argv) == 1)
        return run(ROOT, os.environ.copy())
    except Exception:
        print('PRIVATE_ANDROID_BUILD_WATCH_REJECTED_NO_RAW_VALUES', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
