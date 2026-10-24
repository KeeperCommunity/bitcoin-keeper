#!/usr/bin/env python3
"""Project reviewed observations from one original ZIP using the fixed 044 kernel."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import zipfile

ROOT = Path(__file__).parent
KERNEL_SHA256 = 'c2dd21633de27f44d2bd8c7ef50907384094d64d67060852339e97af42821abf'
SOURCE = 'd27007078808617a97ee460b592eefb44e7e5325'
WORKFLOW = 'f5f20e6d959109cdc2e0096099992d72307255bf'
WORKFLOW_REF = 'KeeperCommunity/bitcoin-keeper/.github/workflows/keeper-native-diagnostic.yml@refs/pull/7149/merge'
RUN, ATTEMPT = '40065599904', '1'
ZIP_SIZE = 7339
DIGEST = '5891036cd8225b97c7edaff9bc057e2c70a8f8720e8f9def3ef0369de043d032'
SCOPE = 'OBSERVATIONS_ONLY_NOT_NATIVE_ACCEPTANCE_OR_CAUSE'
STARTUP_SCOPE = 'Owned simulator launch window; fixed facts only; cause UNKNOWN.'
HIERARCHY_SCOPE = 'ANY_RETAINED_SNAPSHOT_NOT_FINAL_ROUTE_OR_VISIBILITY_PROOF'
PHASE = 'PRIVATE_FILE'
FIELDS = frozenset(('schema', 'source_sha', 'workflow_sha', 'workflow_ref', 'run_id', 'run_attempt',
    'platform', 'diagnostic_only', 'build', 'smoke', 'native_probe', 'r5_features', 'hardware', 'signing',
    'app_id', 'install_succeeded', 'installed_artifact_verified', 'installed_artifact',
    'startup_diagnostics', 'startup_observation', 'driver_preflight', 'simulator_app_service_readiness',
    'failed_phase', 'startup_observation_capture', 'startup_observation_cleanup',
    'startup_cleanup_errors', 'cleanup_failures', 'disposable_cleanup'))
ADDITIONAL_LITERALS = frozenset(('--info', 'CONNECTION_ERROR', 'EXCEPTION_MARKER', 'FATAL_MARKER',
    'HERMES_ERROR', 'JS_EXCEPTION', 'NATIVE_EXCEPTION', 'SCRIPT_LOAD_ERROR', 'SCRIPT_URL_MISSING',
    'PREFIXED_OWN_PROCESS_MARKERS_ONLY_NOT_CAUSE_OR_ACCEPTANCE', 'ios_simulator_signature',
    'verified', 'ADHOC_SIMULATOR_ONLY_NOT_RELEASE_SIGNING', 'bundle_id', 'entitlements_sha256',
    'embedded_code_count', STARTUP_SCOPE))


def project(blob):
    global PHASE
    PHASE = 'KERNEL'
    source = ROOT / 'read-044-ios-artifact.py'
    if hashlib.sha256(source.read_bytes()).hexdigest() != KERNEL_SHA256:
        raise ValueError('Fixed kernel changed.')
    spec = importlib.util.spec_from_file_location('fixed_044_kernel', source)
    kernel = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(kernel)
    literals = kernel.public_literals()  # Original hash-checked 044 policy remains unchanged.
    kernel.SOURCE, kernel.WORKFLOW, kernel.WORKFLOW_REF = SOURCE, WORKFLOW, WORKFLOW_REF
    kernel.RUN, kernel.ATTEMPT = RUN, ATTEMPT
    kernel.public_literals = lambda: literals | ADDITIONAL_LITERALS | {SOURCE, WORKFLOW, WORKFLOW_REF, RUN, ATTEMPT}
    old_hierarchy = kernel.validate_hierarchy

    def current_hierarchy(value, product=False):
        if product:
            return old_hierarchy(value, product=True)
        if type(value) is not dict or value.get('scope') != HIERARCHY_SCOPE:
            kernel.rejected()
        # Current d270 adds this fixed conservative scope. Keep it in output;
        # apply the unchanged 044 flag/type/bound checks to its original fields.
        return old_hierarchy({key: item for key, item in value.items() if key != 'scope'})

    kernel.validate_hierarchy = current_hierarchy
    PHASE = 'ZIP_IDENTITY'
    if type(blob) is not bytes or len(blob) != ZIP_SIZE or hashlib.sha256(blob).hexdigest() != DIGEST:
        kernel.rejected()
    PHASE = 'ZIP_LAYOUT'
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        members = archive.infolist()
        if len(members) != 1:
            kernel.rejected()
        entry = members[0]
        if (entry.filename != 'ios/metadata.json' or entry.orig_filename != entry.filename or
                entry.flag_bits & 1 or stat.S_IFMT(entry.external_attr >> 16) not in (0, stat.S_IFREG) or
                entry.file_size > kernel.LIMIT or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
            kernel.rejected()
        raw = kernel.canonical_payload(blob, entry, archive.start_dir, archive.comment)
    PHASE = 'JSON'
    data = json.loads(raw, object_pairs_hook=kernel.pairs, parse_float=kernel.finite,
                      parse_constant=lambda _: kernel.rejected())
    PHASE = 'ROOT_KEYS'
    if type(data) is not dict or not set(data) <= kernel.ROOT_KEYS:
        kernel.rejected()
    projected = {key: value for key, value in data.items() if key in FIELDS}
    PHASE = 'SIGNATURE_POLICY'
    signature = data.get('toolchain', {}).get('ios_simulator_signature')
    if (type(signature) is not dict or set(signature) != {'verified', 'scope', 'bundle_id',
            'entitlements_sha256', 'embedded_code_count'} or signature['verified'] is not True or
            signature['scope'] != 'ADHOC_SIMULATOR_ONLY_NOT_RELEASE_SIGNING' or
            signature['bundle_id'] != 'io.hexawallet.hexakeeper.dev' or
            not kernel.re.fullmatch(r'[a-f0-9]{64}', signature['entitlements_sha256']) or
            not kernel.bounded_int(signature['embedded_code_count'], 0, 128)):
        kernel.rejected()
    projected['toolchain'] = {'ios_simulator_signature': signature}
    observation = projected.get('startup_observation')
    PHASE = 'STARTUP_OBSERVATION'
    if observation is not None and (type(observation) is not dict or observation.get('scope') != STARTUP_SCOPE):
        kernel.rejected()
    identity = {key: projected.get(key) for key in ('schema', 'source_sha', 'workflow_sha', 'workflow_ref',
                                                  'run_id', 'run_attempt', 'platform', 'diagnostic_only')}
    for key, value in projected.items():
        PHASE = {'startup_diagnostics': 'STARTUP_DIAGNOSTICS', 'startup_observation': 'STARTUP_OBSERVATION',
                 'driver_preflight': 'DRIVER', 'installed_artifact': 'INSTALLED',
                 'toolchain': 'SIGNATURE'}.get(key, 'IDENTITY')
        kernel.validate_metadata(dict(identity, **{key: value}))
    PHASE = 'PROJECTED_METADATA'
    kernel.validate_metadata(projected)
    return {'schema': 1, 'scope': SCOPE, 'original_zip_sha256': DIGEST,
            'metadata_sha256': hashlib.sha256(raw).hexdigest(), 'observations': projected}


def main(argv=None):
    global PHASE
    PHASE = 'PRIVATE_FILE'
    try:
        if argv:
            raise ValueError('No selectors.')
        path = Path(os.environ['RUNNER_TEMP']) / 'r5-d270-ios-fixed.zip'
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size != ZIP_SIZE:
                raise ValueError('Invalid private file.')
            result = project(source.read(ZIP_SIZE + 1))
    except Exception:
        print('D270_IOS_OBSERVATION_READOUT_FAILED:' + PHASE)
        return 1
    print('D270_IOS_OBSERVATIONS_BEGIN')
    print(json.dumps(result, sort_keys=True, separators=(',', ':')))
    print('D270_IOS_OBSERVATIONS_END')
    return 0


if __name__ == '__main__':
    import sys
    raise SystemExit(main(sys.argv[1:]))
