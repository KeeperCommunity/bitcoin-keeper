#!/usr/bin/env python3
"""Project fixed bea Android failure facts using the unchanged 044 kernel."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import zipfile

ROOT = Path(__file__).parent
KERNEL_SHA256 = '1e9fc4370d733041fb5a48dc8c022e3461decafbf970ba030e90784208aed1d9'
SOURCE = 'bea6056724dd75d1db99f4ce394ba4896edd10bf'
WORKFLOW = 'fbb97bfe160e4b17d52bdf67aacc3f16aeb22f99'
WORKFLOW_REF = 'KeeperCommunity/bitcoin-keeper/.github/workflows/keeper-native-diagnostic.yml@refs/pull/7154/merge'
RUN, ATTEMPT = '40078818062', '1'
ZIP_SIZE = 9632
DIGEST = 'c653b9d73044a8cc67cc098ff561d5a42f0a11d49013ae88dfa9edf5bf69df1b'
PRODUCT_STATUS = 'FAIL'
SCOPE = 'OBSERVATIONS_ONLY_NOT_NATIVE_ACCEPTANCE_OR_CAUSE'
PHASE = 'SELECTION'
FIELDS = frozenset(('schema', 'source_sha', 'workflow_sha', 'workflow_ref', 'run_id', 'run_attempt',
    'platform', 'diagnostic_only', 'build', 'smoke', 'native_probe', 'r5_features', 'hardware', 'signing',
    'app_id', 'install_succeeded', 'installed_artifact_verified'))
SAMPLE_FIELDS = frozenset(('sample', 'status', 'completed_stages', 'pin_onboarding_progress',
    'create_new_app_calls', 'other_backend_calls_rejected', 'failure_observation',
    'failed_assertion_snapshot', 'android_runtime_diagnostic'))


def require_binding():
    import re
    if (type(WORKFLOW) is not str or not re.fullmatch(r'[a-f0-9]{40}', WORKFLOW) or
            type(WORKFLOW_REF) is not str or not re.fullmatch(
                r'KeeperCommunity/bitcoin-keeper/\.github/workflows/keeper-native-diagnostic\.yml@refs/pull/[1-9][0-9]*/merge', WORKFLOW_REF) or
            type(ZIP_SIZE) is not int or not 0 < ZIP_SIZE <= 1024 * 1024 + 4096 or
            type(DIGEST) is not str or not re.fullmatch(r'[a-f0-9]{64}', DIGEST) or
            PRODUCT_STATUS not in ('PASS', 'FAIL')):
        raise ValueError('Exact completed artifact bindings unavailable.')


def project(blob):
    global PHASE
    PHASE = 'SELECTION'
    require_binding()
    PHASE = 'KERNEL'
    source = ROOT / 'read-044-android-artifact.py'
    if hashlib.sha256(source.read_bytes()).hexdigest() != KERNEL_SHA256:
        raise ValueError('Fixed kernel changed.')
    spec = importlib.util.spec_from_file_location('fixed_044_android_kernel', source)
    kernel = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(kernel)
    literals = kernel.public_literals()  # Original hash-checked policy remains unchanged.
    kernel.SOURCE, kernel.WORKFLOW, kernel.WORKFLOW_REF = SOURCE, WORKFLOW, WORKFLOW_REF
    kernel.RUN, kernel.ATTEMPT = RUN, ATTEMPT
    kernel.public_literals = lambda: literals | {'onboarding-markers', SOURCE, WORKFLOW, WORKFLOW_REF, RUN, ATTEMPT}
    PHASE = 'ZIP_IDENTITY'
    if type(blob) is not bytes or len(blob) != ZIP_SIZE or hashlib.sha256(blob).hexdigest() != DIGEST:
        kernel.rejected()
    PHASE = 'ZIP_LAYOUT'
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        members = archive.infolist()
        if len(members) != 1:
            kernel.rejected()
        entry = members[0]
        if (entry.filename != 'android/metadata.json' or entry.orig_filename != entry.filename or
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
    PHASE = 'PRODUCT'
    product = data.get('product_ui')
    if (type(product) is not dict or product.get('status') != PRODUCT_STATUS or
            type(product.get('samples')) is not list or not 1 <= len(product['samples']) <= 6 or
            any(type(sample) is not dict for sample in product['samples'])):
        kernel.rejected()
    projected['product_ui'] = {key: product[key] for key in ('status', 'failure_category') if key in product}
    projected['product_ui']['samples'] = [{key: value for key, value in sample.items() if key in SAMPLE_FIELDS}
                                         for sample in product['samples']]
    PHASE = 'PROJECTED_METADATA'
    kernel.validate_metadata(projected)
    return {'schema': 1, 'scope': SCOPE, 'original_zip_sha256': DIGEST,
            'metadata_sha256': hashlib.sha256(raw).hexdigest(), 'observations': projected}


def main(argv=None):
    global PHASE
    PHASE = 'SELECTION'
    try:
        require_binding()
        if argv:
            raise ValueError('No selectors.')
        PHASE = 'PRIVATE_FILE'
        path = Path(os.environ['RUNNER_TEMP']) / 'r5-bea-android-fixed.zip'
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size != ZIP_SIZE:
                raise ValueError('Invalid private file.')
            result = project(source.read(ZIP_SIZE + 1))
    except Exception:
        print('BEA_ANDROID_OBSERVATION_READOUT_FAILED:' + PHASE)
        return 1
    print('BEA_ANDROID_OBSERVATIONS_BEGIN')
    print(json.dumps(result, sort_keys=True, separators=(',', ':')))
    print('BEA_ANDROID_OBSERVATIONS_END')
    return 0


if __name__ == '__main__':
    import sys
    raise SystemExit(main(sys.argv[1:]))
