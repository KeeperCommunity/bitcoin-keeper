"""Finite same-run producer observations. Never supplies APK or native acceptance."""
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = Path('artifacts/android-compile-observation/metadata.json')
BUILD = 'Build debug-key-only development APK'
MAX_BYTES = 1024 * 1024
TERMINATIONS = {'NOT_STARTED', 'CHILD_EXIT', 'CHILD_SIGNAL', 'COMMAND_TIMEOUT',
                'PROCESS_IO_ERROR', 'HOST_SIGNAL', 'EXECUTION_INTERRUPTED'}
SIGNALS = {'DEPENDENCY_RESOLUTION', 'DEPENDENCY_HTTP', 'NETWORK_TIMEOUT', 'DEPENDENCY_TLS',
           'JVM_MEMORY', 'GRADLE_DAEMON_LOST', 'DISK_SPACE', 'GRADLE_FAILURE'}
TASK = re.compile(r':(?:[a-z0-9_.-]+:){0,4}(?:'
    r'(?:compile(?:Development)?Debug(?:Kotlin|JavaWithJavac|Shaders))|'
    r'(?:(?:build|configure)CMake(?:Development)?Debug\[x86_64\])|'
    r'(?:(?:check|merge|process|generate|package|assemble|validate|write|strip|extract|parse|map|create)'
    r'(?:Development)?Debug(?:AarMetadata|Resources|Assets|Manifest|MainManifest|NativeLibs|'
    r'JniLibFolders|JavaResource|JavaRes|Shaders|BuildConfig|ResValues|RFile|SymbolList|'
    r'AppMetadata|SigningConfigVersions|DebugMetadata|ArtProfile|DuplicateClasses|DeepLinks|'
    r'SupportedLocales|NavigationJson|CompatibleScreenManifests|LocalResources|SourceSetPaths|'
    r'NativeDebugMetadata|Dex|GlobalSynthetics|Signing|Kotlin|JavaWithJavac)?)|'
    r'(?:preBuild|pre(?:Development)?DebugBuild|generateCodegenArtifactsFromSchema|'
    r'generateCodegenSchemaFromJavaScript|checkKotlinGradlePluginConfigurationErrors))')


def require(value):
    if not value:
        raise ValueError('ANDROID_COMPILE_OBSERVATION_REJECTED')


def document(path):
    require(path.is_absolute() and path.resolve(strict=True) == path)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1
                and 0 < info.st_size <= MAX_BYTES)
        raw = source.read(MAX_BYTES + 1)
        require(len(raw) == info.st_size)
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result)
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: require(False))


def identity(h, env):
    fixed = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted', 'RUNNER_OS': 'Linux',
             'RUNNER_ARCH': 'X64', 'ImageOS': 'ubuntu24', 'KEEPER_NATIVE_PLATFORM': 'ANDROID',
             'KEEPER_ANDROID_CUSTODY_ROLE': 'producer', 'GITHUB_WORKSPACE': str(h.ROOT)}
    require(all(env.get(k) == v for k, v in fixed.items()))
    admitted = document(Path(env['RUNNER_TEMP']) / 'keeper-android-host-admission.json')
    require(admitted.get('schema') == 1 and admitted.get('role') == 'producer')
    for key, variable in [('source_sha', 'KEEPER_SOURCE_SHA'), ('workflow_sha', 'GITHUB_WORKFLOW_SHA')]:
        require(re.fullmatch('[a-f0-9]{40}', env.get(variable, '')) and admitted.get(key) == env[variable])
    result = {key: admitted[key] for key in ['source_sha', 'workflow_sha']}
    for key, variable in [('run_id', 'GITHUB_RUN_ID'), ('run_attempt', 'GITHUB_RUN_ATTEMPT')]:
        require(type(admitted.get(key)) is int and 0 < admitted[key] < 2**53 and str(admitted[key]) == env.get(variable))
        result[key] = admitted[key]
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=h.ROOT, text=True, timeout=30).strip()
    require(source == result['source_sha'] and h.PLATFORM == 'ANDROID')
    return result


def metadata(h, bound):
    data = document(h.EVIDENCE)
    require(data.get('schema') == 1 and data.get('platform') == 'ANDROID')
    for key in ('source_sha', 'workflow_sha'):
        require(data.get(key) == bound[key])
    for key in ('run_id', 'run_attempt'):
        require(data.get(key) == str(bound[key]))
    require(data.get('build') in ('NOT RUN', 'PASS', 'FAIL'))
    return data


def number(value, maximum):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= maximum


def projection(h, bound, step_outcome=None):
    data = metadata(h, bound)
    rows = data.get('commands')
    require(type(rows) is list and len(rows) <= 512)
    selected = [row for row in rows if type(row) is dict and row.get('label') == BUILD]
    require(len(selected) <= 1)
    result = dict(schema=1, scope='CURRENT_SOURCE_ANDROID_COMPILE_OBSERVATION_NOT_ACCEPTANCE',
                  **bound, build=data['build'], command=None, progress={'state': 'NOT_OBSERVED'},
                  native_acceptance=False, release_acceptance=False)
    if step_outcome is not None:
        require(step_outcome in ('success', 'failure', 'cancelled', 'skipped'))
        result['workflow_build_step_outcome'] = step_outcome
        if step_outcome in ('failure', 'cancelled'):
            result['build'] = 'FAIL'
    if not selected:
        require(result['build'] != 'PASS')
        return result
    row = selected[0]
    observation = row.get('android_compile_process')
    if observation is not None:
        require(type(row.get('timeout_seconds')) is int and row['timeout_seconds'] == 3000)
        require(type(observation) is dict and observation.get('termination') in TERMINATIONS)
        require(observation.get('host_signal') in (None, signal.SIGTERM, signal.SIGINT))
        code = observation.get('child_exit_code')
        require(code is None or type(code) is int and -128 <= code <= 255)
        require(number(observation.get('duration_seconds'), 7200))
        require(observation.get('budget_seconds') == 3000)
        require(observation.get('cleanup') in ('NOT_STARTED', 'OWNED_CHILD_REAPED', 'UNVERIFIED'))
        # Construct every field; arbitrary metadata keys cannot escape.
        result['command'] = {key: observation[key] for key in
            ('termination', 'host_signal', 'child_exit_code', 'duration_seconds', 'budget_seconds', 'cleanup')}
        code = row.get('exit_code')
        require(code is None or type(code) is int and -128 <= code <= 255)
        result['command']['harness_exit_code'] = code
    if result['build'] == 'PASS':
        require(result['command'] is not None and result['command']['termination'] == 'CHILD_EXIT'
                and result['command']['child_exit_code'] == result['command']['harness_exit_code'] == 0
                and result['command']['cleanup'] == 'OWNED_CHILD_REAPED')
    # Re-run the existing bounded collector over this command's owned log. Raw
    # paths, compiler messages and dependency URLs never enter this projection.
    index = next(i for i, value in enumerate(rows, 1) if value is selected[0])
    spec = importlib.util.spec_from_file_location('producer_build_failure', Path(__file__).with_name('android_build_failure.py'))
    collector = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(collector)
    observed = collector.collect(h.PRIVATE, h.PRIVATE / ('command-%03d.log' % index), h.ROOT)
    progress = {'state': 'OBSERVED' if observed.get('state') == 'OBSERVED' else 'UNAVAILABLE'}
    for key in ('log_bytes', 'scanned_bytes', 'lines_scanned', 'tail_bytes', 'last_write_age_seconds'):
        if number(observed.get(key), 2**53):
            progress[key] = observed[key]
    progress['input_truncated'] = observed.get('input_truncated') is True
    progress['signals'] = [value for value in sorted(SIGNALS) if value in observed.get('signals', [])]
    last = observed.get('last_task')
    progress['last_fixed_task'] = None
    if (type(last) is dict and type(last.get('task')) is str and TASK.fullmatch(last['task'])
            and last.get('state') in ('STARTED_OBSERVED', 'HEADER_OBSERVED', 'UP-TO-DATE', 'FROM-CACHE', 'SKIPPED', 'NO-SOURCE', 'FAILED')):
        progress['last_fixed_task'] = {'task': last['task'], 'state': last['state']}
    result['progress'] = progress
    return result


def emit(h, result, initial=False):
    output = h.ROOT / OUTPUT
    output.parent.mkdir(parents=True, exist_ok=True)
    require(output.parent.resolve(strict=True) == output.parent)
    raw = (json.dumps(result, sort_keys=True) + '\n').encode()
    require(len(raw) <= 16384)
    if output.exists() or output.is_symlink():
        require(not initial)
        previous = document(output)
        require(all(previous.get(key) == result.get(key) for key in ('source_sha', 'workflow_sha', 'run_id', 'run_attempt')))
    descriptor, temporary = tempfile.mkstemp(prefix='compile-observation-', dir=output.parent)
    try:
        with os.fdopen(descriptor, 'wb') as target:
            require(os.fstat(target.fileno()).st_nlink == 1)
            target.write(raw)
            target.flush()
        os.replace(temporary, output)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    print('KEEPER_ANDROID_COMPILE_OBSERVATION ' + raw.decode().strip(), flush=True)


def build(h, env):
    bound = identity(h, env)
    before = metadata(h, bound)
    require(before['build'] == 'NOT RUN' and not any(row.get('label') == BUILD for row in before.get('commands', [])))
    emit(h, projection(h, bound), initial=True)
    original = None
    try:
        h.run_phase('build')
    except BaseException as error:
        original = error
        raise
    finally:
        try:
            result = projection(h, bound, 'failure' if original else 'success')
            emit(h, result)
        except Exception:
            print('ANDROID_COMPILE_OBSERVATION_UNAVAILABLE_NO_RAW_VALUES', flush=True)
            if original is None:
                raise RuntimeError('ANDROID_COMPILE_OBSERVATION_UNAVAILABLE') from None


def main():
    import hosted_native as h
    require(len(sys.argv) == 2 and sys.argv[1] in ('build', 'project'))
    os.environ.update(ENVFILE='.env.ci', RCT_NO_LAUNCH_PACKAGER='1', RCT_NEW_ARCH_ENABLED='1', MAESTRO_CLI_NO_ANALYTICS='1')
    if sys.argv[1] == 'build':
        build(h, os.environ)
    else:
        emit(h, projection(h, identity(h, os.environ), os.environ.get('KEEPER_ANDROID_BUILD_STEP_OUTCOME')))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('ANDROID_COMPILE_OBSERVATION_REJECTED_NO_RAW_VALUES', file=sys.stderr)
        sys.exit(1)
