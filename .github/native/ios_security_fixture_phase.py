"""Fixed fresh-source iOS entrypoints with measured, session-only fixture tools.

Fixture readiness never supplies app/native acceptance. The original child CLI
owns every native assertion, metadata result and disposable-resource cleanup.
"""
import os
import stat
import sys

if not stat.S_ISCHR(os.stat(os.devnull, follow_symlinks=False).st_mode):
    raise RuntimeError('IOS_FIXTURE_NULL_DEVICE_REQUIRED')
sys.pycache_prefix = os.devnull
sys.dont_write_bytecode = True
os.environ.update(PYTHONPYCACHEPREFIX=os.devnull, PYTHONDONTWRITEBYTECODE='1')

import copy
import importlib.util
from pathlib import Path
import re
import runpy
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PHASES = {'tls': ('hosted_native.py', 'tls'),
          'realm109': ('r52_realm109_native.py',),
          # Trust UI is an existing nested companion. Preserve the full product
          # sequence and its assertions rather than inventing a standalone flow.
          'trust-ui': ('product_measurements.py', 'run')}
OUTER_PHASE_SECONDS = 14400  # Existing iOS worker's 240-minute bound; no narrower phase budget.
ENTRYPOINTS = ('hosted_native.py', 'r52_realm109_native.py', 'product_measurements.py')
FILES = ('ios_security_fixture_phase.py', 'ios_r52_fixture_diagnostic.py', 'ios_r52_fixture_probe.cjs', *ENTRYPOINTS)


def require(value):
    if not value:
        raise RuntimeError('IOS_SECURITY_FIXTURE_PHASE_REJECTED')


def source_guard(root, source):
    require(type(source) is str and re.fullmatch('[a-f0-9]{40}', source))
    environment = dict(PATH=os.environ.get('PATH', ''), GIT_CONFIG_NOSYSTEM='1',
        GIT_CONFIG_GLOBAL=os.devnull, GIT_TERMINAL_PROMPT='0', GIT_ALLOW_PROTOCOL='')
    def git(*args):
        return subprocess.check_output(['git', '--no-replace-objects', *args], cwd=root,
            env=environment, stderr=subprocess.DEVNULL, timeout=30)
    require(git('rev-parse', 'HEAD').decode().strip() == source)
    require(root.resolve(strict=True) == root)
    for name in FILES:
        path = root / '.github/native' / name
        require(not any(parent.is_symlink() for parent in [path, *path.parents]))
        require(path.is_file() and path.stat().st_size <= 1024 * 1024 and
            path.read_bytes() == git('show', source + ':.github/native/' + name))


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / '.github/native' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def exception_kind(error):
    name = type(error).__name__
    return name if name in ('RuntimeError', 'ValueError', 'TypeError', 'OSError',
        'AssertionError', 'JSONDecodeError', 'KeyboardInterrupt') else 'OTHER_EXCEPTION'


def original_phase(root, phase):
    """Execute the unchanged source CLI in this process and inherit its streams.

    run_path installs the temporary __main__ module needed by hosted_native.tls.
    The existing workflow and original drivers own all timeouts and cleanup;
    there is no extra child, output limit, signal, elapsed gate or cleanup credit.
    """
    require(phase in PHASES)
    prior = sys.argv
    try:
        sys.argv = [str(root / '.github/native' / PHASES[phase][0]), *PHASES[phase][1:]]
        try:
            runpy.run_path(sys.argv[0], run_name='__main__')
            code = 0
        except SystemExit as error:
            code = error.code
            if code is None:
                code = 0
            elif not isinstance(code, int):
                # Match Python's original SystemExit(message) stream/exit behavior.
                print(code, file=sys.stderr)
                code = 1
        except BaseException as error:
            # An uncaught original Python CLI exception exits unsuccessfully.
            # Record its fixed type without adding a raw traceback/log dump.
            return dict(exit_code=130 if isinstance(error, KeyboardInterrupt) else 1,
                category='ORIGINAL_PHASE_EXCEPTION', exception_type=exception_kind(error),
                execution='IN_PROCESS_ORIGINAL_SOURCE_CLI', stdio='INHERITED_ORIGINAL_CLI_NO_OUTPUT_LIMIT',
                cleanup='ORIGINAL_PHASE_OWNS_CLEANUP_NO_WRAPPER_CREDIT')
        return dict(exit_code=code, category=None, execution='IN_PROCESS_ORIGINAL_SOURCE_CLI',
            stdio='INHERITED_ORIGINAL_CLI_NO_OUTPUT_LIMIT', cleanup='ORIGINAL_PHASE_OWNS_CLEANUP_NO_WRAPPER_CREDIT')
    finally:
        sys.argv = prior


def tool_guard(fixture, readiness):
    for name, expected in [('openssl', readiness['selected_tool']), ('node', readiness['node'])]:
        require(fixture.identity(Path(expected['path'])) == expected)
        require(fixture.identity(Path(fixture.shutil.which(name) or '')) == expected)


def execute(native, phase, fixture):
    require(phase in PHASES and native.PLATFORM == 'IOS')
    data = native.read()
    source = os.environ.get('KEEPER_SOURCE_SHA')
    source_guard(native.ROOT, source)
    require(data.get('source_sha') == source and data.get('run_id') == os.environ.get('GITHUB_RUN_ID') and
        data.get('run_attempt') == os.environ.get('GITHUB_RUN_ATTEMPT'))
    record = dict(scope='HOST_FIXTURE_TOOLCHAIN_ONLY_NOT_APP_OR_NATIVE_ACCEPTANCE',
        source_sha=source, native_acceptance=False, phase=phase, existing_workflow_ceiling_seconds=OUTER_PHASE_SECONDS,
        original_entrypoint=list(PHASES[phase]), command=None, readiness=None, phase_started=False,
        tool_identity_before='NOT RUN', tool_identity_after='NOT RUN')
    primary = None
    try:
        with fixture.session(native) as readiness:
            record['readiness'] = copy.deepcopy(readiness)
            record['tool_identity_before'] = 'FAIL'
            tool_guard(fixture, readiness)
            record['tool_identity_before'] = 'PASS'
            source_guard(native.ROOT, source)
            record['phase_started'] = True
            command = original_phase(native.ROOT, phase)
            record['command'] = command
            source_guard(native.ROOT, source)
            record['tool_identity_after'] = 'FAIL'
            tool_guard(fixture, readiness)
            record['tool_identity_after'] = 'PASS'
            # Never infer native PASS from fixture readiness or wrapper success.
            # Preserve the original nonzero exit even if wrapper cleanup fails.
            if command['exit_code'] not in (None, 0):
                return command['exit_code']
            return 0 if command['exit_code'] == 0 and command['category'] is None else 1
    except BaseException as error:
        primary = error
        record['wrapper_failure'] = 'SESSION_SOURCE_TOOL_OR_ORIGINAL_PHASE_FAILURE'
        if record['phase_started'] and record['command'] is None:
            record['command'] = dict(exit_code=1, category='ORIGINAL_PHASE_EXCEPTION',
                exception_type=exception_kind(error), cleanup='ORIGINAL_PHASE_OWNS_CLEANUP_NO_WRAPPER_CREDIT')
        if record['command'] is not None and record['command']['exit_code'] not in (None, 0):
            return record['command']['exit_code']
        raise
    finally:
        try:
            current = native.read()
            record['readiness'] = copy.deepcopy(current.get(fixture.FIELD, record['readiness']))
            current.setdefault('ios_security_fixture_toolchain', {})[phase] = record
            native.save(current)
        except Exception:
            if primary is None and (record['command'] is None or record['command']['exit_code'] in (None, 0)):
                raise


def main():
    require(len(sys.argv) == 2 and sys.argv[1] in PHASES and os.environ.get('KEEPER_NATIVE_PLATFORM') == 'IOS')
    source_guard(ROOT, os.environ.get('KEEPER_SOURCE_SHA'))
    native = load('hosted_native')
    return execute(native, sys.argv[1], load('ios_r52_fixture_diagnostic'))


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('iOS fixture toolchain or original phase failed; inspect scoped metadata.', file=sys.stderr)
        sys.exit(1)
