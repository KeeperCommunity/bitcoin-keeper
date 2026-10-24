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
RUN, ATTEMPT, ARTIFACT = '39858617273', '1', '12462694619'
ZIP_SHA256 = '550142809a0faf812741a586630b17d6f458b2b6c935b5bab4b00f84da67c84f'
ZIP_SIZE, LIMIT = 6884, 1024 * 1024
POLICY_SHA256 = 'ab720280a30f521ff0aed139f376bdabcba295632d3081b6dbeb21fb5e9a830c'
BEGIN = 'FIXED_IOS_ARTIFACT_ZIP_BASE64_BEGIN'
END = 'FIXED_IOS_ARTIFACT_ZIP_BASE64_END'
ROOT_KEYS = frozenset(('schema', 'platform', 'source_sha', 'diagnostic_only', 'workflow_ref',
    'workflow_sha', 'run_id', 'run_attempt', 'runner', 'os', 'commands', 'build', 'smoke',
    'native_probe', 'r5_features', 'hardware', 'signing', 'app_id', 'smoke_scope',
    'startup_timing_scope', 'artifact_policy', 'toolchain', 'disk_preflight', 'nodeify_overlay',
    'configuration', 'configuration_overlays', 'maestro', 'simulator_app_service_readiness',
    'driver_preflight', 'built_artifact', 'metro_warmup', 'install_diagnoses', 'device',
    'install_succeeded', 'installed_artifact_verified', 'installed_artifact_scope',
    'installed_artifact', 'startup_diagnostics', 'startup_observation_capture', 'failed_phase',
    'startup_observation', 'startup_observation_cleanup', 'startup_cleanup_errors',
    'disposable_cleanup', 'cleanup_failures'))
FORBIDDEN_KEYS = frozenset(('raw', 'raw_logs', 'raw_output', 'log', 'logs', 'stdout', 'stderr',
    'screenshot', 'screenshots', 'hierarchy', 'password', 'pin', 'seed', 'mnemonic',
    'credentials', 'private_key', 'token', 'sas', 'authorization'))
PUBLIC_PATTERNS = tuple(re.compile(pattern) for pattern in (
    r'[a-f0-9]{40}(?:[a-f0-9]{24})?',
    r'[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}',
    r'[0-9]{1,20}',
    r'[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?',
    r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)',
    r'[0-9]{8}\.[0-9]{4}\.[0-9]{1,2}',
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
    raw = Path(__file__).with_name('current-ios-metadata-policy.json').read_bytes()
    if len(raw) > 65536 or hashlib.sha256(raw).hexdigest() != POLICY_SHA256:
        rejected()
    policy = json.loads(raw, object_pairs_hook=pairs)
    if policy['source_sha'] != SOURCE:
        rejected()
    return frozenset(policy['public_literals']) | {SOURCE, WORKFLOW, WORKFLOW_REF, RUN, ATTEMPT,
        'private_startup-logcat', 'private_startup-observer', 'private_startup-foreground'}


def validate_metadata(data, expected=None):
    """No reconstruction: accept reviewed public vocabulary or reject the whole ZIP."""
    identity = {'schema': 1, 'source_sha': SOURCE, 'workflow_sha': WORKFLOW,
        'workflow_ref': WORKFLOW_REF, 'run_id': RUN, 'run_attempt': ATTEMPT,
        'platform': 'IOS', 'diagnostic_only': True} if expected is None else expected
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
    if 'commands' in data and (type(data['commands']) is not list or len(data['commands']) > 100):
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
                safe_hierarchy = key == 'hierarchy' and path == ('startup_observation',)
                if (type(key) is not str or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_-]{0,80}', key) or
                        key not in literals or
                        key.lower() in FORBIDDEN_KEYS and not safe_hierarchy):
                    rejected()
                if safe_hierarchy:
                    flags = {'credential_error', 'retry', 'logbox_controls', 'redbox_resource', 'loading',
                        'login', 'welcome_back', 'logbox_error_header', 'logbox_warning_header',
                        'logbox_syntax_footer', 'logbox_counter'}
                    if (type(item) is not dict or set(item) != flags | {'observation_state', 'snapshot_count'} or
                            item['observation_state'] not in ('UNKNOWN', 'SNAPSHOTS_PARSED') or
                            type(item['snapshot_count']) is not int or not 0 <= item['snapshot_count'] <= 8 or
                            any(item[name] is not None and type(item[name]) is not bool for name in flags)):
                        rejected()
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
    name = b'ios/metadata.json'
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
        if (entry.filename != 'ios/metadata.json' or entry.orig_filename != entry.filename or
                entry.flag_bits & 1 or stat.S_IFMT(entry.external_attr >> 16) not in (0, stat.S_IFREG) or
                entry.file_size > LIMIT or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
            rejected()
        raw = canonical_payload(blob, entry, archive.start_dir, archive.comment)
        if len(raw) > LIMIT or len(raw) != entry.file_size:
            rejected()
    data = json.loads(raw, object_pairs_hook=pairs, parse_float=finite, parse_constant=lambda _: rejected())
    validate_metadata(data, expected)


def checked_bytes(path):
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
        blob = checked_bytes(Path(os.environ['RUNNER_TEMP']) / 'r5-current-ios-fixed.zip')
    except Exception:
        print('FIXED_IOS_ARTIFACT_BYTE_READOUT_FAILED')
        return 1
    print(BEGIN)
    print(base64.b64encode(blob).decode('ascii'))
    print(END)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
