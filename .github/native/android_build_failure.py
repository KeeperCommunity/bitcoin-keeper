"""Failure-only Gradle log identities; no raw output or native acceptance."""
import json
import io
import math
import os
from pathlib import Path
import re
import stat
import time
from urllib.parse import urlsplit

SCAN_BYTES = 64 * 1024 ** 2
TAIL_BYTES = 262144
LINE_BYTES = 4096
SCAN_LINES = 100000
TAIL_LINES = 2000
REPOSITORIES = {
    ('repo.maven.apache.org', '/maven2/'): 'MAVEN_CENTRAL',
    ('repo1.maven.org', '/maven2/'): 'MAVEN_CENTRAL',
    ('dl.google.com', '/dl/android/maven2/'): 'GOOGLE_MAVEN',
    ('maven.google.com', '/'): 'GOOGLE_MAVEN',
    ('plugins.gradle.org', '/m2/'): 'GRADLE_PLUGINS',
    ('jitpack.io', '/'): 'JITPACK',
    ('dl.google.com', '/android/repository/'): 'GOOGLE_ANDROID_REPOSITORY',
}
SIGNALS = {
    'could not resolve': 'DEPENDENCY_RESOLUTION', 'could not get': 'DEPENDENCY_HTTP',
    'read timed out': 'NETWORK_TIMEOUT', 'connect timed out': 'NETWORK_TIMEOUT',
    'connection timed out': 'NETWORK_TIMEOUT', 'sslhandshakeexception': 'DEPENDENCY_TLS',
    'pkix path building failed': 'DEPENDENCY_TLS', 'outofmemoryerror': 'JVM_MEMORY',
    'daemon disappeared': 'GRADLE_DAEMON_LOST', 'no space left on device': 'DISK_SPACE',
    'build failed': 'GRADLE_FAILURE',
}
TASK = re.compile(r'^> Task (:[A-Za-z0-9_.:\-\[\]]{1,255})(?: (UP-TO-DATE|FROM-CACHE|SKIPPED|NO-SOURCE|FAILED))?$')
STARTED = re.compile(r'^(:[A-Za-z0-9_.:\-\[\]]{1,255}) \(Thread\[[^\r\n]{1,256}\]\) started\.$')


def module_names(root):
    """Only static dependency names can become exported project identities."""
    data = json.loads((Path(root) / 'package.json').read_text())
    result = {'app', 'gradle-plugin', 'react-native-gradle-plugin', 'settings-plugin',
              'react-settings-plugin', 'shared'}
    for section in ('dependencies', 'devDependencies'):
        for name in data.get(section, {}):
            if re.fullmatch(r'(?:@[a-z0-9_.-]+/)?[a-z0-9_.-]{1,100}', name):
                result.add(name.removeprefix('@').replace('/', '_'))
    return result


def task_identity(raw, modules):
    parts = raw.removeprefix(':').split(':')
    if not 1 <= len(parts) <= 5 or any(part not in modules for part in parts[:-1]):
        return None
    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,95}(?:\[(?:x86_64|x86|arm64-v8a|armeabi-v7a)\])?', parts[-1]):
        return None
    return ':' + ':'.join(parts)


def dependency_identity(raw):
    try:
        value = urlsplit(raw)
        if value.scheme != 'https' or value.username or value.password or value.query or value.fragment or value.port:
            return None
        for (host, prefix), repository in REPOSITORIES.items():
            if value.hostname != host or not value.path.startswith(prefix):
                continue
            relative = value.path[len(prefix):]
            if (not 1 <= len(relative) <= 384 or '..' in relative.split('/') or
                    not re.fullmatch(r'[A-Za-z0-9_+./-]+', relative) or
                    not relative.endswith(('.pom', '.jar', '.aar', '.module', '.xml', '.zip', '.sha1', '.sha256', '.sha512'))):
                return None
            return {'repository': repository, 'artifact_path': relative}
    except ValueError:
        pass
    return None


def compiler_location(line, root):
    match = re.match(r'^(?:e: )?(?:file://)?(/[^\n:]{1,512}):(\d{1,7})(?::(\d{1,7}))?(?::| )', line)
    if not match:
        return None
    try:
        path = Path(match[1])
        relative = path.relative_to(root)
        if relative.parts[0] not in ('android', 'node_modules') or path.suffix not in ('.java', '.kt', '.kts', '.c', '.cpp', '.h', '.hpp'):
            return None
        # No arbitrary diagnostic/source content is forwarded, only a location
        # in the actual workspace and its finite compiler category.
        if not re.fullmatch(r'[A-Za-z0-9_@+./-]{1,384}', str(relative)) or '..' in relative.parts:
            return None
        category = 'COMPILER_DIAGNOSTIC'
        for marker, code in (('unresolved reference', 'UNRESOLVED_REFERENCE'),
                             ('cannot find symbol', 'CANNOT_FIND_SYMBOL'),
                             ('type mismatch', 'TYPE_MISMATCH'),
                             ('no matching function', 'NO_MATCHING_FUNCTION')):
            if marker in line.lower():
                category = code
                break
        return {'source_path': str(relative), 'line': int(match[2]),
                'column': int(match[3]) if match[3] else None, 'category': category}
    except (ValueError, IndexError):
        return None


def empty_projection():
    return {'task_records': [], 'last_task': None, 'unrecognized_task_records': 0,
            'dependency_records': [], 'last_dependency': None, 'compiler_locations': [],
            'signals': [], 'lines_scanned': 0, 'overlong_line_records': 0,
            'line_scan_truncated': False, 'scanned_bytes': 0, 'tail_bytes': 0,
            'terminal_record_incomplete': False}


def retain(records, value, limit):
    records.append(value)
    del records[:-limit]


def consume(line, result, root, modules):
    line = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', line.decode('utf-8', errors='replace')).strip()
    match, started = TASK.fullmatch(line), STARTED.fullmatch(line)
    identity_match = match or started
    if identity_match:
        identity = task_identity(identity_match[1], modules)
        if identity:
            record = {'task': identity, 'state': (match[2] or 'HEADER_OBSERVED') if match else 'STARTED_OBSERVED'}
            retain(result['task_records'], record, 20)
            result['last_task'] = record
        else:
            result['unrecognized_task_records'] += 1
    for url in re.findall(r'https://[^\s<>\"\']{1,768}', line):
        identity = dependency_identity(url.rstrip('.,);]'))
        if identity and (not result['dependency_records'] or result['dependency_records'][-1] != identity):
            retain(result['dependency_records'], identity, 10)
            result['last_dependency'] = identity
    location = compiler_location(line, root)
    if location:
        retain(result['compiler_locations'], location, 10)
    for needle, signal in SIGNALS.items():
        observed = (re.search(r'(?<![a-z0-9_])(?:java\.lang\.)?outofmemoryerror(?=[:\s]|$)', line.lower())
                    if needle == 'outofmemoryerror' else needle in line.lower())
        if observed and signal not in result['signals']:
            result['signals'].append(signal)


def scan(source, root, modules, result, byte_limit, line_limit):
    count, lines, overlong = 0, 0, False
    while count < byte_limit and lines < line_limit:
        raw = source.readline(min(LINE_BYTES + 1, byte_limit - count))
        if not raw:
            break
        count += len(raw)
        complete = raw.endswith(b'\n')
        if len(raw) > LINE_BYTES or overlong:
            if not overlong:
                result['overlong_line_records'] += 1
            overlong = not complete
        elif complete:
            consume(raw, result, root, modules)
        else:
            result['terminal_record_incomplete'] = True
        if complete:
            lines += 1
    if overlong:
        result['terminal_record_incomplete'] = True
    result['scanned_bytes'] += count
    result['lines_scanned'] += lines
    result['line_scan_truncated'] |= lines == line_limit
    return count


def scan_log(source, size, root, modules):
    result = empty_projection()
    scan(source, root, modules, result, SCAN_BYTES, SCAN_LINES)
    if source.tell() < size:
        prefix_end = source.tell()
        start = max(prefix_end, size - TAIL_BYTES)
        source.seek(start)
        # A jumped-to partial line is not a whole Gradle record.
        if start > prefix_end or result['terminal_record_incomplete']:
            skipped = source.readline(min(TAIL_BYTES, LINE_BYTES + 1))
            while skipped and not skipped.endswith(b'\n') and source.tell() < size:
                skipped = source.readline(min(LINE_BYTES + 1, size - source.tell()))
        result['tail_bytes'] = scan(source, root, modules, result, TAIL_BYTES, TAIL_LINES)
    result['input_truncated'] = result['scanned_bytes'] < size
    return result


def project(raw, root, modules):
    return scan_log(io.BytesIO(raw), len(raw), root, modules)


def collect(private, log_path, root):
    result = {'schema': 1, 'state': 'UNAVAILABLE',
              'scope': 'FAILURE_ONLY_LAST_GRADLE_LOG_IDENTITIES_NOT_CAUSE_OR_ACCEPTANCE',
              'native_acceptance': False, 'log_bytes': None, 'tail_bytes': 0,
              'input_truncated': False, 'last_write_age_seconds': None}
    try:
        private, log_path, root = Path(private), Path(log_path), Path(root)
        if log_path.parent != private or not re.fullmatch(r'command-[0-9]{3}\.log', log_path.name):
            return result
        directory = os.open(private, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            if os.fstat(directory).st_uid != os.getuid():
                return result
            descriptor = os.open(log_path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        finally:
            os.close(directory)
        with os.fdopen(descriptor, 'rb') as source:
            before = os.fstat(source.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_nlink != 1:
                return result
            projection = scan_log(source, before.st_size, root, module_names(root))
            after = os.fstat(source.fileno())
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
                    after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
                return result
        age = time.time() - after.st_mtime
        result.update(projection)
        result.update(state='OBSERVED', log_bytes=after.st_size,
                      last_write_age_seconds=round(age, 1) if math.isfinite(age) and 0 <= age <= 86400 else None)
    except (OSError, ValueError, TypeError, UnicodeError, RecursionError):
        pass
    return result
