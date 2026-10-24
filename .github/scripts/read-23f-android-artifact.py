#!/usr/bin/env python3
"""Finite diagnostic readout of one pinned artifact; never acceptance evidence."""
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import zipfile

SOURCE = '23f14e01f3437c213f1443c3167d96022f3a43bc'
WORKFLOW = '1f084ee4486709e0066034a452349df897eb2434'
WORKFLOW_REF = 'KeeperCommunity/bitcoin-keeper/.github/workflows/keeper-native-diagnostic.yml@refs/pull/7107/merge'
RUN, ATTEMPT, ARTIFACT = '39846002094', '1', '12458149136'
ZIP_SHA256 = '4d464ef5f8faa7de4f02292e683f0dad8242544843610da9371f2c675dc183f0'
ZIP_SIZE, LIMIT = 8395, 1024 * 1024
STAGES = ('startup_start', 'startup_ready', 'wallet_start', 'wallet_ready', 'home_ready',
          'relaunch_start', 'relaunch_login', 'relaunch_home', 'version_history_verified',
          'key_management_entry_verified', 'navigation_verified')
RETRY = ('retry_fixture_start', 'retry_error_visible', 'retry_submit', 'retry_home_ready',
         'retry_relaunch_start', 'retry_relaunch_login', 'retry_relaunch_home')
PIN = ('confirm_passcode_visible', 'confirmation_digits_tapped', 'create_tapped', 'continue_visible',
       'continue_tapped', 'cancel_visible', 'cancel_tapped', 'skip_visible', 'skip_tapped', 'start_new_visible')
DURATIONS = ('startup_to_passcode_ms', 'start_new_to_ready_ms', 'start_new_to_home_ms',
             'cold_relaunch_to_login_ms', 'cold_relaunch_to_authenticated_home_ms')
SCENARIOS = ('production-setup-offline-retry-native-counts', 'production-deletion-retained-native-references',
             'production-deletion-native-rollback', 'production-worker-stale-session-rejection',
             'native-worker-process-relaunch-counts')
TYPES = ('TypeError', 'SyntaxError', 'ReferenceError', 'RangeError', 'EvalError', 'URIError',
         'AggregateError', 'TransformError', 'UnableToResolveError', 'InternalError', 'RuntimeException',
         'IllegalStateException', 'IllegalArgumentException', 'NullPointerException', 'SecurityException',
         'UnsatisfiedLinkError', 'NoClassDefFoundError', 'ClassNotFoundException', 'OutOfMemoryError', 'Error')
FAULTS = ('JS_TYPE_ERROR', 'JS_SYNTAX_ERROR', 'JS_REFERENCE_ERROR', 'JS_RANGE_ERROR',
          'MODULE_RESOLUTION_ERROR', 'TRANSFORM_ERROR', 'APP_NOT_REGISTERED', 'NATIVE_MODULE_UNAVAILABLE',
          'NATIVE_LIBRARY_LOAD_ERROR', 'NATIVE_FATAL_SIGNAL', 'JAVA_FATAL_EXCEPTION', 'MEMORY_EXHAUSTION',
          'TRANSPORT_ERROR', 'FILESYSTEM_ERROR', 'WORKER_HEAP_EXHAUSTION', 'PROCESS_KILLED_MARKER')
SOURCES = (
    ('signer_identity', 'src/utils/utilities.ts', ['getAccountFromSigner', 'getKeyUID'], 'c64954ef892c8782324afcda57f69e510bab33649a47baaf702daf51eeae919a'),
    ('storage_worker', 'src/store/sagas/storage.ts', ['setupKeeperAppWorker'], 'ef18f4962decfa11fb69825ff7b983fd086c243b5d2bbe4ed55f6aa5a4a68169'),
    ('wallet_worker', 'src/store/sagas/wallets.ts', ['currentWalletAccountId', 'assertWalletAccount', 'deleteSigningDeviceWorker'], '88a35d8dc409c63d70459295112c6a9484f6b14bbff75b3e23965c31f700ef0e'),
    ('backup_worker', 'src/store/sagas/bhr.ts', ['currentBackupAppId', 'deleteAppImageEntityWorker'], '548fd95fa62f675f0b42340e72a5e2558f33cff9272207f4523962531124d702'),
    ('backup_transport', 'src/services/backup/transport.ts', ['observeBackupAccount', 'currentBackupAccountSession', 'clearVerifiedRemoteRevision'], '22ba1d5bbf45ab23c7db661a0635096b2a19878cbc0817c0eb1bfeebd8f24920'))


def obj(value):
    return value if type(value) is dict else {}


def enum(value, allowed=('PASS', 'FAIL', 'NOT RUN', 'RUNNING')):
    return value if type(value) is str and value in allowed else 'UNKNOWN'


def number(value, maximum=1000000):
    return value if type(value) in (int, float) and 0 <= value <= maximum and math.isfinite(value) else None


def boolean(value):
    return value if type(value) is bool else None


def count(value, maximum=1000000):
    return value if type(value) is int and 0 <= value <= maximum else None


def digest(value):
    return value if type(value) is str and re.fullmatch('[a-f0-9]{64}', value) else None


def failure(value):
    return enum(value, ('RuntimeError', 'AssertionError', 'OSError', 'ValueError', 'TypeError',
                        'TimeoutExpired', 'TimeoutError', 'FileNotFoundError', 'PermissionError', 'OTHER_ERROR'))


def prefix(value, vocabulary):
    return value if type(value) is list and len(value) <= len(vocabulary) and value == list(vocabulary[:len(value)]) else None


def fixed_list(value, vocabulary):
    selected = {item for item in value[:64] if type(item) is str and item in vocabulary} if type(value) is list else set()
    return [item for item in vocabulary if item in selected]


def proof(value, built, verified):
    value = obj(value)
    found = digest(value.get('sha256'))
    matches = (found == built and built is not None) if found and value.get('method') == 'SINGLE_INSTALLED_BASE_APK_SHA256' and verified is True else None
    return {'method': enum(value.get('method'), ('SINGLE_INSTALLED_BASE_APK_SHA256',)),
            'installed_byte_proof_matches_built': matches}


def commands(value):
    labels = {'build_apk': 'Build debug-key-only development APK',
              'startup_ui': 'Assert startup and disposable passcode transition',
              'persistence_ui': 'Assert native persistence across process launches',
              'workers_ui': 'Assert R5 production workers over native storage',
              'product_ui': 'Full-product first-wallet and relaunch UI sample'}
    rows = value[:1000] if type(value) is list else []
    return {key: [{'exit_code': count(row.get('exit_code'), 255),
                   'duration_seconds': number(row.get('duration_seconds'), 7200),
                   'timeout_seconds': number(row.get('timeout_seconds'), 7200)}
                  for row in rows if type(row) is dict and row.get('label') == label][:5]
            for key, label in labels.items()}


def sample(value, built, retry=False):
    value = obj(value)
    stages = prefix(value.get('completed_stages'), RETRY if retry else STAGES)
    progress = obj(value.get('pin_onboarding_progress'))
    pins = prefix(progress.get('completed_markers'), PIN)
    next_pin = PIN[len(pins)] if pins is not None and len(pins) < len(PIN) else None
    result = {'sample': count(value.get('sample'), 6), 'reported_status': enum(value.get('status')),
              'completed_stages': stages or [], 'stage_prefix_valid': stages is not None,
              'raw_durations': {name: number(obj(value.get('raw_durations')).get(name), 3600000) for name in DURATIONS},
              'pin_progress': {'completed_markers': pins or [], 'prefix_valid': pins is not None,
                               'next_marker': next_pin if pins is not None and progress.get('next_marker') == next_pin else 'UNKNOWN',
                               'complete': boolean(progress.get('complete')) if pins is not None and progress.get('complete') == (len(pins) == len(PIN)) else None},
              'installed_apk': proof(value.get('installed_artifact'), built, value.get('installed_artifact_verified'))}
    for field in ('create_new_app_calls', 'other_backend_calls_rejected', 'visible_wallet_count_before_relaunch',
                  'visible_wallet_count_after_relaunch', 'transport_requests_dropped_without_commit',
                  'acknowledged_create_responses', 'unexpected_create_attempts'):
        result[field] = count(value.get(field))
    runtime = obj(value.get('android_runtime_diagnostic'))
    facts = obj(runtime.get('facts'))
    errors = obj(facts.get('runtime_errors'))
    result['android_runtime'] = {'collection_status': enum(runtime.get('status'), ('COLLECTED', 'UNAVAILABLE')),
        'process_state': enum(obj(facts.get('processes')).get('state'), ('PRESENT', 'ABSENT', 'UNKNOWN')),
        'matching_process_count': count(obj(facts.get('processes')).get('matching_process_count')),
        'foreground_relation': enum(obj(facts.get('foreground_activity')).get('relation'), ('OWN_APP', 'OTHER_APP', 'NONE', 'UNKNOWN')),
        'error_counts': {field: count(errors.get(field)) for field in ('parsed_error_records', 'own_error_records', 'unclassified_own_error_records', 'unparsed_nonempty_lines')},
        'exception_types': fixed_list(errors.get('exception_types'), TYPES),
        'fault_categories': fixed_list(errors.get('fault_categories'), FAULTS),
        'attribution': enum(errors.get('attribution'), ('CURRENT_OWN_PID_MATCH_HISTORY_FRESHNESS_UNKNOWN', 'UNKNOWN_NO_CURRENT_OWN_PROCESS')),
        'input_truncated': boolean(errors.get('input_truncated')),
        'cleanup': enum(facts.get('cleanup_status'), ('DELETED', 'UNKNOWN')), 'cause': 'UNDETERMINED'}
    return result


def _decode(blob):
    """Decode bounded semantic fixtures too; the CLI additionally pins ZIP bytes."""
    if type(blob) is not bytes or len(blob) > LIMIT + 4096:
        raise ValueError('Artifact rejected.')
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        members = archive.infolist()
        if len(members) != 1:
            raise ValueError('Artifact rejected.')
        entry = members[0]
        if (entry.filename != 'android/metadata.json' or entry.orig_filename != entry.filename or
                entry.flag_bits & 1 or stat.S_IFMT(entry.external_attr >> 16) not in (0, stat.S_IFREG) or
                entry.file_size > LIMIT or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
            raise ValueError('Artifact rejected.')
        with archive.open(entry) as source:
            raw = source.read(LIMIT + 1)
        if len(raw) > LIMIT or len(raw) != entry.file_size:
            raise ValueError('Artifact rejected.')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Artifact rejected.')
            result[key] = value
        return result
    def finite(value):
        value = float(value)
        if not math.isfinite(value):
            raise ValueError('Artifact rejected.')
        return value
    def reject(_):
        raise ValueError('Artifact rejected.')
    data = json.loads(raw, object_pairs_hook=pairs, parse_float=finite, parse_constant=reject)
    expected = {'schema': 1, 'source_sha': SOURCE, 'workflow_sha': WORKFLOW, 'workflow_ref': WORKFLOW_REF,
                'run_id': RUN, 'run_attempt': ATTEMPT, 'platform': 'ANDROID', 'diagnostic_only': True}
    if type(data) is not dict or any(type(data.get(key)) is not type(value) or data.get(key) != value for key, value in expected.items()):
        raise ValueError('Artifact rejected.')
    built = digest(obj(data.get('built_artifact')).get('sha256'))
    product = obj(data.get('product_ui'))
    samples = product.get('samples', [])
    if type(samples) is not list or len(samples) > 5:
        raise ValueError('Artifact rejected.')
    workers = obj(data.get('r5_feature_evidence'))
    functions = workers.get('source_functions')
    expected_sources = [{'path': path, 'names': names, 'sha256': sha} for _, path, names, sha in SOURCES]
    source_bound = type(functions) is list and functions == expected_sources
    scenarios = workers.get('scenarios')
    fixed_scenarios = {name: enum(obj(scenarios[index]).get('status')) if type(scenarios) is list and len(scenarios) == 5 and obj(scenarios[index]).get('id') == name else 'UNKNOWN' for index, name in enumerate(SCENARIOS)}
    result = {'tag': 'SAFE_R5_ANDROID_READOUT', 'source_sha': SOURCE, 'workflow_sha': WORKFLOW,
              'run_id': RUN, 'run_attempt': ATTEMPT, 'artifact_id': ARTIFACT, 'diagnostic_only': True,
              'readout_only': True, 'authorization_eligible': False, 'trusted_native_acceptance': False,
              'release_acceptance': 'NOT ESTABLISHED', 'cause': 'UNDETERMINED',
              'reported_phases': {key: enum(data.get(key)) for key in ('build', 'smoke', 'native_probe', 'r5_features', 'hardware', 'signing')},
              'fixed_command_receipts': commands(data.get('commands')),
              'installed_apk': proof(data.get('installed_artifact'), built, data.get('installed_artifact_verified')),
              'workers': {'reported_status': enum(workers.get('status')), 'reported_scenarios': fixed_scenarios,
                          'scope': 'SCOPED_WORKER_RECEIPT_NOT_PRODUCT_OR_RELEASE_ACCEPTANCE',
                          'committed_sources_verified': source_bound,
                          'source_sha256': {label: sha if source_bound else None for label, _, _, sha in SOURCES}},
              'product': {'reported_status': enum(product.get('status')), 'failure_category': failure(product.get('failure_category')),
                          'requested_samples': count(product.get('requested_samples'), 5), 'reported_samples': len(samples),
                          'samples': [sample(value, built) for value in samples],
                          'retry': sample(product.get('controlled_disconnect_retry'), built, True),
                          'companions': {key: enum(obj(product.get(key)).get('status')) for key in ('key_management_ui', 'credential_errors_ui', 'version_history_ui', 'vault_references_ui')},
                          'cleanup': enum(product.get('cleanup'), ('FAILED',)),
                          'cleanup_failure_categories': sorted({failure(value) for value in product.get('cleanup_failure_categories', [])[:16]}) if type(product.get('cleanup_failure_categories', [])) is list else ['UNKNOWN']}}
    return result


def decode(blob):
    try:
        return _decode(blob)
    except Exception:
        raise ValueError('Artifact rejected.') from None


def main(argv=None):
    try:
        arguments = sys.argv[1:] if argv is None else argv
        if arguments:
            raise ValueError('Artifact rejected.')
        path = Path(os.environ['RUNNER_TEMP']) / 'r5-23f-android-fixed.zip'
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size != ZIP_SIZE:
                raise ValueError('Artifact rejected.')
            blob = source.read(ZIP_SIZE + 1)
        if len(blob) != ZIP_SIZE or hashlib.sha256(blob).hexdigest() != ZIP_SHA256:
            raise ValueError('Artifact rejected.')
        result = decode(blob)
    except Exception:
        print('FIXED_ANDROID_ARTIFACT_READOUT_FAILED')
        return 1
    print('SAFE_R5_ANDROID_READOUT ' + json.dumps(result, sort_keys=True, allow_nan=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
