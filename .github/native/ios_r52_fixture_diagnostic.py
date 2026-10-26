"""Bounded host fixture capability, never app/native acceptance or a CA override."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import tempfile
import time

FIELD = 'retained_r52_fixture_initialization'
SCOPE = 'HOST_FIXTURE_READINESS_ONLY_NOT_NATIVE_ACCEPTANCE'
BREW = Path('/opt/homebrew/opt/openssl@3/bin/openssl')
ERRORS = {'OPENSSL_OPTION_UNSUPPORTED', 'REQUIRED_FILE_OR_TOOL_MISSING', 'LOOPBACK_LISTEN_FAILED',
    'OPENSSL_COMMAND_FAILED', 'FIXTURE_INITIALIZATION_FAILED', 'FIXTURE_CLOSE_FAILED', 'PROBE_CONTEXT_REJECTED'}


def require(value):
    if not value: raise RuntimeError('PRIVATE_FIXTURE_INITIALIZATION_REJECTED')


def directory(path):
    require(path.is_absolute() and path.resolve(strict=True) == path)
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid in (0, os.getuid()) and not info.st_mode & 0o022)


def identity(path):
    """Record the canonical executable, never trust an unmeasured PATH alias."""
    target = path.resolve(strict=True)
    require(target.is_absolute() and re.fullmatch(r'/[A-Za-z0-9_./+@-]{1,511}', str(target)))
    directory(target.parent)
    before = target.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid in (0, os.getuid()) and
        not before.st_mode & 0o022 and before.st_mode & 0o111 and 0 < before.st_size <= 256 * 1024 * 1024)
    with os.fdopen(os.open(target, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as source:
        hashed, remaining = hashlib.sha256(), before.st_size + 1
        while remaining:
            block = source.read(min(65536, remaining))
            if not block: break
            hashed.update(block); remaining -= len(block)
        require(remaining == 1)
        digest = hashed.hexdigest(); after = os.fstat(source.fileno())
    require(all(getattr(before, key) == getattr(after, key) for key in
        ('st_dev', 'st_ino', 'st_mode', 'st_size', 'st_mtime_ns', 'st_ctime_ns')))
    return {'path': str(target), 'sha256': digest, 'bytes': before.st_size}


def owned_run(args, cwd, env, timeout, maximum=16384):
    """Bound pipes, wall time and only the process group created by this call."""
    directory(cwd)
    output, category, child = bytearray(), None, None
    try:
        child = subprocess.Popen(args, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        deadline = time.monotonic() + timeout
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ)
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0: category = 'TIMEOUT'; break
                for key, _ in selector.select(min(remaining, 0.2)):
                    block = os.read(key.fd, 4096)
                    if not block: selector.unregister(key.fileobj); continue
                    if len(output) + len(block) > maximum: category = 'OUTPUT_LIMIT'; break
                    output.extend(block)
                if category: break
        if category is None:
            try: child.wait(timeout=max(0.01, deadline - time.monotonic()))
            except subprocess.TimeoutExpired: category = 'TIMEOUT'
    except OSError: category = 'SPAWN_UNAVAILABLE'
    finally:
        cleanup = 'PASS'
        if child is not None:
            # The dedicated session ID is this Popen's original PID. No discovery,
            # name matching, foreign PID or live-port killing is permitted.
            for sig in (signal.SIGTERM, signal.SIGKILL):
                try: os.killpg(child.pid, sig)
                except ProcessLookupError: break
                except OSError: cleanup = 'FAIL'; break
                try: child.wait(timeout=2)
                except subprocess.TimeoutExpired: continue
            try: child.wait(timeout=2)
            except subprocess.TimeoutExpired: cleanup = 'FAIL'
            child.stdout.close()
            try: os.killpg(child.pid, 0)
            except ProcessLookupError: pass
            except OSError: cleanup = 'FAIL'
            else: cleanup = 'FAIL'
    return {'exit_code': child.returncode if child else None, 'category': category,
        'process_group_cleanup': cleanup}, bytes(output)


def cli_guards(root):
    target = root / '.github/native/.generated/r52_tls_fixture.json'
    expected = (root / '.github/native/r52_tls_fixture.cjs').parent / '.generated/r52_tls_fixture.json'
    absent, canonical = False, False
    try: target.lstat()
    except FileNotFoundError: absent = True
    except OSError: pass
    try:
        require(root.resolve(strict=True) == root)
        current = target.parent
        while not current.exists() and not current.is_symlink(): current = current.parent
        directory(current); canonical = True
    except Exception: pass
    return {'state': 'PASS' if absent and canonical and target == expected else 'FAIL',
        'fixed_platform': 'IOS', 'fixed_target': '.github/native/.generated/r52_tls_fixture.json',
        'target_absent': absent, 'target_matches_original_cli': target == expected, 'parent_canonical': canonical,
        'parent': ('PRESENT_CANONICAL' if target.parent.exists() else 'ABSENT_CANONICAL_EXISTING_ANCESTORS')
            if canonical else 'UNAVAILABLE_OR_ALIASED', 'argv_shape': 'NODE_FIXED_DRIVER_IOS_FIXED_TARGET'}


def version(tool, temporary, env):
    run, raw = owned_run([tool['path'], 'version'], temporary, env, 5, 4096)
    require(run['process_group_cleanup'] == 'PASS')
    match = re.fullmatch(rb'(OpenSSL|LibreSSL) ([0-9]+\.[0-9]+\.[0-9]+[a-z]?)\b[^\r\n]*\r?\n?', raw)
    result = {'state': 'UNAVAILABLE', **run}
    if run['exit_code'] == 0 and run['category'] is None and match:
        result.update(state='PRESENT', implementation=match[1].decode(), version=match[2].decode())
    require(identity(Path(tool['path'])) == tool)
    return result


def attempt(label, tool, node, worker, base, env):
    temporary = Path(tempfile.mkdtemp(prefix=label + '-', dir=base))
    try:
        # A single fixed shim selects only openssl; unrelated tool resolution and
        # all CA/trust environment values are unchanged.
        shim = temporary / 'bin'; shim.mkdir(mode=0o700); (shim / 'openssl').symlink_to(tool['path'])
        child_env = dict(env, TMPDIR=str(temporary), PATH=str(shim) + os.pathsep + env.get('PATH', ''))
        result = {'candidate': label, 'tool': tool, 'version': version(tool, temporary, child_env)}
        command, raw = owned_run([node['path'], str(worker)], temporary, child_env, 90)
        result['command'] = command
        try:
            value = json.loads(raw)
            require(type(value) is dict and type(value.get('schema')) is int and value['schema'] == 1 and
                value.get('native_acceptance') is False and value.get('readiness') in ('PASS', 'FAIL') and
                value.get('cleanup') in ('PASS', 'FAIL', 'NOT_RUN') and value.get('error_category') in ERRORS | {None})
            if value['readiness'] == 'PASS':
                require(value.get('scope') == SCOPE and value.get('case_count') == 25 and
                    type(value.get('loopback_listener_count')) is int and value['loopback_listener_count'] == 28 and
                    value['cleanup'] == 'PASS' and value['error_category'] is None)
            result['probe'] = {key: value[key] for key in
                ('readiness', 'cleanup', 'error_category', 'case_count', 'loopback_listener_count') if key in value}
        except Exception: result['probe'] = {'readiness': 'UNAVAILABLE', 'error_category': 'INVALID_PROBE_OUTPUT'}
        require(identity(Path(tool['path'])) == tool and identity(Path(node['path'])) == node)
        result['capable'] = (command['exit_code'] == 0 and command['category'] is None and
            command['process_group_cleanup'] == 'PASS' and result['probe'].get('readiness') == 'PASS' and
            result['version'].get('state') == 'PRESENT' and result['version'].get('implementation') in ('OpenSSL', 'LibreSSL'))
        return result
    finally:
        directory(temporary); shutil.rmtree(temporary)


@contextmanager
def session(native, compare=False, select=True):
    """Select an existing alternative only after actual full fixture capability."""
    root = native.ROOT; directory(root)
    base = Path(os.environ['RUNNER_TEMP']); directory(base)
    worker = root / '.github/native/ios_r52_fixture_probe.cjs'
    require(worker.read_bytes() == subprocess.check_output(['git', '--no-replace-objects', 'show',
        'HEAD:.github/native/ios_r52_fixture_probe.cjs'], cwd=root, timeout=30))
    record = {'schema': 1, 'scope': SCOPE, 'status': 'FAIL', 'native_acceptance': False,
        'attempts': [], 'selection': 'NONE', 'ca_or_trust_environment_changed': False,
        'cli_guards': {'state': 'UNAVAILABLE', 'fixed_target': '.github/native/.generated/r52_tls_fixture.json'}}
    temporary, prior_path, primary = None, os.environ.get('PATH', ''), None
    try:
        record['cli_guards'] = cli_guards(root)
        require(record['cli_guards']['state'] == 'PASS')
        node = identity(Path(shutil.which('node') or '')); record['node'] = node
        node_command, node_raw = owned_run([node['path'], '--version'], base, dict(os.environ), 5, 4096)
        require(node_command['exit_code'] == 0 and node_command['category'] is None and node_command['process_group_cleanup'] == 'PASS')
        node_version = re.fullmatch(rb'(v[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\r?\n?', node_raw)
        record['node_version'] = node_version[1].decode('ascii') if node_version else 'UNAVAILABLE'
        require(node_version is not None)
        default = identity(Path(shutil.which('openssl') or ''))
        temporary = Path(tempfile.mkdtemp(prefix='keeper-fixture-init-', dir=base))
        env = dict(os.environ)
        first = attempt('default', default, node, worker, temporary, env); record['attempts'].append(first)
        require(first['command']['process_group_cleanup'] == 'PASS')
        selected = default if first['capable'] else None
        if (selected is None or compare) and (BREW.exists() or BREW.is_symlink()):
            alternative = identity(BREW)
            require(re.fullmatch(r'/opt/homebrew/Cellar/openssl@3/[0-9]+\.[0-9]+\.[0-9]+(?:_[0-9]+)?/bin/openssl', alternative['path']))
            second = attempt('existing_homebrew_openssl3', alternative, node, worker, temporary, env)
            record['attempts'].append(second)
            require(second['command']['process_group_cleanup'] == 'PASS')
            if selected is None and second['capable'] and second['version'].get('implementation') == 'OpenSSL' and second['version'].get('version', '').startswith('3.'):
                selected = alternative
        elif selected is None or compare:
            record['alternative'] = 'FIXED_EXISTING_HOMEBREW_OPENSSL3_ABSENT'
        require(selected is not None)
        require(identity(Path(selected['path'])) == selected)
        if select:
            shim = temporary / 'selected'; shim.mkdir(mode=0o700); (shim / 'openssl').symlink_to(selected['path'])
            os.environ['PATH'] = str(shim) + os.pathsep + prior_path
            require(identity(Path(shutil.which('openssl'))) == selected)
        record.update(status='PASS', selection=('DEFAULT_CAPABLE' if selected == default else 'MEASURED_EXISTING_HOMEBREW_OPENSSL3')
            if select else 'READINESS_ONLY_NO_RUNTIME_TOOL_SELECTION', selected_tool=selected)
        data = native.read(); data[FIELD] = record; native.save(data)
        yield record
    except BaseException as error:
        primary = error
        if record['status'] != 'PASS': record['error_category'] = 'FIXTURE_CAPABILITY_OR_CONTEXT_REJECTED'
        raise
    finally:
        os.environ['PATH'] = prior_path
        if temporary is not None:
            try: directory(temporary); shutil.rmtree(temporary); record['temporary_cleanup'] = 'PASS'
            except Exception: record['temporary_cleanup'] = 'FAIL'; record['status'] = 'FAIL'
        try:
            data = native.read(); data[FIELD] = record; native.save(data)
            require(record.get('temporary_cleanup') != 'FAIL')
        except Exception:
            if primary is None: raise
