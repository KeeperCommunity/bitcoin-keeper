#!/usr/bin/env python3
"""Validate one immutable metadata ZIP and transport its original bytes only."""
import base64
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import stat
import struct
import sys
import unicodedata
import zipfile
import zlib

SOURCE = '1bc34890cb8618b2fffd446a63924974e0fe15b5'
WORKFLOW = '3c44ab6412a8118b183273c402dd08136db05b28'
WORKFLOW_REF = 'KeeperCommunity/bitcoin-keeper/.github/workflows/keeper-native-diagnostic.yml@refs/pull/7116/merge'
RUN, ATTEMPT, JOB = '39858617273', '1', '120125972406'
# Immutable artifact and completed-job conclusions observed through the API.
ARTIFACT = '12466091444'
ZIP_SHA256 = '5c3210a6b0af7bf9ea0cddb61fd1494714e8cfac0db8385960fb6390f92aa545'
ZIP_SIZE = 8950
NATIVE_CONCLUSION = 'failure'
BUILD_CONCLUSION = 'success'
PROBES_CONCLUSION = 'failure'
LIMIT = 1024 * 1024
MAX_COMMANDS = 512
POLICY_SHA256 = '68a022c4548babf23d95ae1c19f23077eb6b176127efbce9187bd4b5a6ab0a93'
BEGIN = 'FIXED_ANDROID_ARTIFACT_ZIP_BASE64_BEGIN'
END = 'FIXED_ANDROID_ARTIFACT_ZIP_BASE64_END'
ROOT_KEYS = frozenset(('schema', 'platform', 'source_sha', 'diagnostic_only', 'workflow_ref',
    'workflow_sha', 'run_id', 'run_attempt', 'runner', 'os', 'commands', 'build', 'smoke',
    'native_probe', 'r5_features', 'hardware', 'signing', 'app_id', 'smoke_scope',
    'startup_timing_scope', 'artifact_policy', 'toolchain', 'disk_preflight', 'nodeify_overlay',
    'configuration', 'configuration_overlays', 'maestro', 'built_artifact', 'metro_warmup',
    'probe_bundle', 'features_bundle', 'device', 'install_succeeded',
    'installed_artifact_verified', 'installed_artifact_scope', 'installed_artifact',
    'startup_diagnostics', 'startup_observation_capture', 'failed_phase', 'startup_observation',
    'startup_observation_cleanup', 'startup_cleanup_errors', 'disposable_cleanup', 'cleanup_failures',
    'probe_diagnostics', 'probe_scope', 'smoke_test_cases', 'native_probe_test_cases',
    'r5_features_test_cases', 'r5_feature_evidence', 'product_ui', 'product_key_ui',
    'product_credential_ui', 'product_version_history_ui', 'product_vault_ui'))
FORBIDDEN_KEYS = frozenset(('raw', 'raw_logs', 'raw_output', 'log', 'logs', 'stdout', 'stderr',
    'screenshot', 'screenshots', 'hierarchy', 'password', 'pin', 'seed', 'mnemonic',
    'credentials', 'private_key', 'token', 'sas', 'authorization', 'attributes', 'children',
    'text', 'accessibilitytext', 'title', 'value', 'resource-id'))
STARTUP_FLAGS = frozenset(('credential_error', 'retry', 'logbox_controls', 'redbox_resource', 'loading'))
PRODUCT_FLAGS = frozenset(('onboarding_skip', 'start_new_tile', 'recover_tile', 'app_settings',
    'start_new_text', 'welcome', 'create_passcode', 'confirm_passcode', 'login', 'welcome_back',
    'credential_error', 'retry', 'dismiss_control', 'minimize_control', 'allow_control',
    'dont_allow_control', 'logbox_error_header', 'logbox_warning_header', 'logbox_counter',
    'logbox_controls', 'logbox_syntax_footer', 'notification_prompt_phrase',
    'notification_permission_controls'))
PRODUCT_HIERARCHY_SCOPE = 'ANY_RETAINED_SNAPSHOT_NOT_FINAL_ROUTE_OR_VISIBILITY_PROOF'
PUBLIC_PATTERNS = tuple(re.compile(pattern) for pattern in (
    r'[a-f0-9]{40}(?:[a-f0-9]{24})?',
    r'[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}',
    r'[0-9]{1,20}',
    r'[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?',
    r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)',
    r'[0-9]{8}\.[0-9]{4}\.[0-9]{1,2}',
    r'emulator-[0-9]{1,8}',
    # Source-owned mkdtemp name, six samples and fixed companion output names.
    r'/home/runner/work/_temp/keeper-native-private/keeper-product-ui-[a-z0-9_]{8}/'
    r'(?:sample-[1-6]|key-ui|history-ui|vault-ui|credential-ui/'
    r'(?:credential_fixture-(?:armed|restored)|product_credential_(?:blocked|recovered)))'
    r'(?:/junit\.xml)?',
))


def rejected():
    raise ValueError('Artifact rejected.')


def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            rejected()
        result[key] = value
    return result


def finite(value):
    value = float(value)
    if not math.isfinite(value):
        rejected()
    return value


def public_literals():
    raw = Path(__file__).with_name('current-android-metadata-policy.json').read_bytes()
    if len(raw) > 65536 or hashlib.sha256(raw).hexdigest() != POLICY_SHA256:
        rejected()
    policy = json.loads(raw, object_pairs_hook=pairs)
    if policy['source_sha'] != SOURCE:
        rejected()
    return frozenset(policy['public_literals']) | {SOURCE, WORKFLOW, WORKFLOW_REF, RUN, ATTEMPT, JOB}


def validate_hierarchy(value, product=False):
    # These are exported fixed flags, never a TreeNode/UI attribute tree.
    if value is None:
        return
    if type(value) is not dict:
        rejected()
    if not product:
        if (set(value) != STARTUP_FLAGS | {'snapshot_count'} or
                type(value['snapshot_count']) is not int or not 0 <= value['snapshot_count'] <= 8 or
                any(value[name] is not None and type(value[name]) is not bool for name in STARTUP_FLAGS)):
            rejected()
        return
    fields = {'state', 'snapshot_count', 'node_count', 'rejected_snapshots',
              'snapshot_limit_exceeded', 'scope', 'flags'}
    if (set(value) != fields or value['scope'] != PRODUCT_HIERARCHY_SCOPE or
            value['state'] not in ('UNKNOWN', 'COMPLETE', 'PARTIAL') or
            any(type(value[name]) is not int or not 0 <= value[name] <= maximum for name, maximum in
                (('snapshot_count', 8), ('node_count', 80000), ('rejected_snapshots', 8))) or
            type(value['snapshot_limit_exceeded']) is not bool or type(value['flags']) is not dict or
            set(value['flags']) != PRODUCT_FLAGS or
            any(flag is not None and type(flag) is not bool for flag in value['flags'].values())):
        rejected()


def validate_metadata(data, expected=None):
    """No reconstruction: accept reviewed public vocabulary or reject the whole ZIP."""
    identity = {'schema': 1, 'source_sha': SOURCE, 'workflow_sha': WORKFLOW,
        'workflow_ref': WORKFLOW_REF, 'run_id': RUN, 'run_attempt': ATTEMPT,
        'platform': 'ANDROID', 'diagnostic_only': True} if expected is None else expected
    if (type(data) is not dict or not set(data) <= ROOT_KEYS or
            any(type(data.get(key)) is not type(value) or data.get(key) != value
                for key, value in identity.items())):
        rejected()
    for key in ('build', 'smoke', 'native_probe', 'r5_features', 'hardware', 'signing'):
        if key in data and data[key] not in ('PASS', 'FAIL', 'NOT RUN', 'RUNNING', 'UNKNOWN', None):
            rejected()
    for key in ('runner', 'toolchain', 'maestro', 'built_artifact', 'device',
                'installed_artifact', 'startup_diagnostics', 'driver_preflight', 'startup_observation'):
        if key in data and data[key] is not None and type(data[key]) is not dict:
            rejected()
    if 'commands' in data and (type(data['commands']) is not list or len(data['commands']) > MAX_COMMANDS):
        rejected()
    fields = {'label', 'command', 'timeout_seconds', 'exit_code', 'duration_seconds'}
    for row in data.get('commands', []):
        if (type(row) is not dict or not fields <= set(row) or
                not set(row) <= fields | {'diagnostic', 'redacted_tool_errors'} or
                type(row['label']) is not str or type(row['command']) is not list or
                not 1 <= len(row['command']) <= 64 or
                any(type(argument) is not str for argument in row['command'])):
            rejected()
    literals = public_literals()
    nodes = 0

    def walk(value, depth=0, path=()):
        nonlocal nodes
        nodes += 1
        if depth > 24 or nodes > 25000:
            rejected()
        if type(value) is dict:
            if len(value) > 256:
                rejected()
            for key, item in value.items():
                safe_hierarchy = key == 'hierarchy' and path in (('startup_observation',),
                    ('product_ui', 'samples', 'failure_observation'),
                    ('product_ui', 'controlled_disconnect_retry', 'failure_observation'))
                safe_sdk_key = path == ('toolchain', 'observed_android_sdk') and key in (
                    'platforms/android-36', 'build-tools/35.0.0', 'ndk/27.1.12297006')
                if (type(key) is not str or not (safe_sdk_key or
                        re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.-]{0,80}', key)) or
                        key not in literals or
                        key.lower() in FORBIDDEN_KEYS and not safe_hierarchy):
                    rejected()
                if safe_hierarchy:
                    validate_hierarchy(item, product=path != ('startup_observation',))
                walk(item, depth + 1, (*path, key))
        elif type(value) is list:
            if len(value) > 1024:
                rejected()
            for item in value:
                walk(item, depth + 1, path)
        elif type(value) is str:
            if (any((unicodedata.category(char) in ('Cc', 'Cf', 'Zl', 'Zp') and char not in '\n\t')
                    for char in value) or len(value) > 4096 or value not in literals and
                    not any(pattern.fullmatch(value) for pattern in PUBLIC_PATTERNS)):
                rejected()
        elif type(value) in (int, float):
            if not math.isfinite(value) or abs(value) > 2 ** 53 - 1:
                rejected()
        elif value is not None and type(value) is not bool:
            rejected()
    walk(data)


def canonical_payload(blob, entry, start_dir, comment):
    """Every original byte belongs to one ordinary ZIP entry, directory or EOCD."""
    if (comment or entry.comment or entry.extra or entry.header_offset != 0 or
            entry.flag_bits not in (0, 8) or entry.compress_size > LIMIT + 4096):
        rejected()
    local = struct.unpack_from('<4s5H3I2H', blob)
    signature, version, flags, method, mtime, mdate, crc, compressed, size, namesize, extrasize = local
    name = b'android/metadata.json'
    if (signature != b'PK\x03\x04' or version != 20 or flags != entry.flag_bits or
            method != entry.compress_type or namesize != len(name) or extrasize or
            blob[30:30 + namesize] != name):
        rejected()
    begin = 30 + namesize
    end = begin + entry.compress_size
    if flags == 8:
        if (crc, compressed, size) != (0, 0, 0):
            rejected()
        if struct.unpack_from('<4s3I', blob, end) != (b'PK\x07\x08', entry.CRC, entry.compress_size, entry.file_size):
            rejected()
        central = end + 16
    else:
        if (crc, compressed, size) != (entry.CRC, entry.compress_size, entry.file_size):
            rejected()
        central = end
    # No hidden gaps, extra fields, comments, second entries, prefix or suffix.
    fields = struct.unpack_from('<4s6H3I5H2I', blob, central)
    if (start_dir != central or fields[0] != b'PK\x01\x02' or fields[2:10] !=
            (version, flags, method, mtime, mdate, entry.CRC, entry.compress_size, entry.file_size) or
            fields[10:15] != (len(name), 0, 0, 0, 0) or fields[16] != 0 or
            blob[central + 46:central + 46 + len(name)] != name):
        rejected()
    directory_size = 46 + len(name)
    finish = central + directory_size
    if (len(blob) != finish + 22 or struct.unpack_from('<4s4H2IH', blob, finish) !=
            (b'PK\x05\x06', 0, 0, 1, 1, directory_size, central, 0)):
        rejected()
    payload = blob[begin:end]
    if method == zipfile.ZIP_DEFLATED:
        inflater = zlib.decompressobj(-15)
        raw = inflater.decompress(payload, LIMIT + 1)
        if not inflater.eof or inflater.unused_data or inflater.unconsumed_tail:
            rejected()
    else:
        raw = payload
    if len(raw) != entry.file_size or zlib.crc32(raw) != entry.CRC:
        rejected()
    return raw


def validate_archive(blob, expected=None):
    if type(blob) is not bytes or len(blob) > LIMIT + 4096:
        rejected()
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        members = archive.infolist()
        if len(members) != 1:
            rejected()
        entry = members[0]
        if (entry.filename != 'android/metadata.json' or entry.orig_filename != entry.filename or
                entry.flag_bits & 1 or stat.S_IFMT(entry.external_attr >> 16) not in (0, stat.S_IFREG) or
                entry.file_size > LIMIT or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
            rejected()
        raw = canonical_payload(blob, entry, archive.start_dir, archive.comment)
        if len(raw) > LIMIT or len(raw) != entry.file_size:
            rejected()
    data = json.loads(raw, object_pairs_hook=pairs, parse_float=finite, parse_constant=lambda _: rejected())
    validate_metadata(data, expected)


def require_binding():
    # This finite conclusion tuple must match the completed selected job.
    if (type(ARTIFACT) is not str or not re.fullmatch(r'[1-9][0-9]{0,19}', ARTIFACT) or
            type(ZIP_SHA256) is not str or not re.fullmatch(r'[a-f0-9]{64}', ZIP_SHA256) or
            type(ZIP_SIZE) is not int or not 0 < ZIP_SIZE <= LIMIT + 4096 or
            (NATIVE_CONCLUSION, BUILD_CONCLUSION, PROBES_CONCLUSION) !=
            ('failure', 'success', 'failure')):
        rejected()


def checked_bytes(path):
    require_binding()
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size != ZIP_SIZE:
            rejected()
        blob = source.read(ZIP_SIZE + 1)
    if len(blob) != ZIP_SIZE or hashlib.sha256(blob).hexdigest() != ZIP_SHA256:
        rejected()
    validate_archive(blob)
    return blob


def main(argv=None):
    try:
        if sys.argv[1:] if argv is None else argv:
            rejected()
        require_binding()
        blob = checked_bytes(Path(os.environ['RUNNER_TEMP']) / 'r5-current-android-fixed.zip')
    except Exception:
        print('FIXED_ANDROID_ARTIFACT_BYTE_READOUT_FAILED')
        return 1
    print(BEGIN)
    print(base64.b64encode(blob).decode('ascii'))
    print(END)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
