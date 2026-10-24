"""Finite CocoaPods failure facts; no message, URL, path or arbitrary value leaves."""
import hashlib
import os
from pathlib import Path
import re
import stat

LIMIT = 1024 * 1024
LINE_LIMIT = 5000
SCOPE = 'LOCKED_DEPENDENCY_INSTALL_ONLY_NOT_NATIVE_ACCEPTANCE_OR_CAUSE'
PATTERNS = (
    (r'\berror installing\b', 'POD_INSTALL_FAILURE'),
    (r'could not find compatible versions|deployment mode|lockfile needs to be updated|sandbox is not in sync',
     'POD_LOCK_CONFLICT'),
    (r'Gemfile.*(?:changed|change)|lockfile.*(?:frozen|deployment)|frozen mode|could not find gem',
     'RUBY_LOCK_OR_GEM_UNAVAILABLE'),
    (r'unable to find a specification|none of your spec sources contain', 'POD_SPEC_UNAVAILABLE'),
    (r'checksum.*(?:mismatch|not match|invalid)|verification checksum was incorrect', 'POD_CHECKSUM_MISMATCH'),
    (r'CDN:.*(?:couldn.t be downloaded|failed)|failed to download|error downloading', 'DEPENDENCY_DOWNLOAD_FAILURE'),
    (r'could not resolve (?:host|proxy)|getaddrinfo|name or service not known', 'DEPENDENCY_DNS_FAILURE'),
    (r'SSL certificate|certificate verify failed|SSL_connect|TLS handshake', 'DEPENDENCY_TLS_FAILURE'),
    (r'failed to connect|connection (?:refused|reset)|network is unreachable', 'DEPENDENCY_CONNECTION_FAILURE'),
    (r'operation timed out|connection timed out|execution expired', 'DEPENDENCY_COMMAND_TIMEOUT'),
    (r'no space left on device', 'DISK_SPACE_EXHAUSTED'),
    (r'requires a higher minimum deployment target', 'IOS_DEPLOYMENT_TARGET_UNSUPPORTED'),
    (r'command not found|No such file or directory', 'DEPENDENCY_TOOL_OR_FILE_UNAVAILABLE'),
    (r'\b(?:LoadError|NoMethodError|NameError|ArgumentError|SyntaxError)\b', 'RUBY_TOOL_FAILURE'),
    (r'unable to find compatibility version string|unknown ISA', 'XCODE_PROJECT_FORMAT_UNSUPPORTED'),
    (r'^fatal:.*(?:unable to access|could not read|repository|fetch|clone)|RPC failed', 'GIT_DOWNLOAD_FAILURE'),
)


def lock_state(root):
    """Only fixed committed input names and exact byte hashes are returned."""
    values = {}
    for name in ('Gemfile', 'Gemfile.lock', 'yarn.lock', 'ios/Podfile.lock'):
        try:
            path = root / name
            if path.is_symlink() or not path.is_file():
                raise ValueError('Unsupported lock input.')
            values[name] = hashlib.sha256(path.read_bytes()).hexdigest()
        except (OSError, ValueError):
            values[name] = None
    return values


def locked_pods(root):
    """Permit identifiers only from the committed lock's PODS section."""
    result = set()
    path = root / 'ios/Podfile.lock'
    if path.is_symlink():
        return result
    try:
        text = path.read_text()
    except (OSError, UnicodeError):
        return result
    if not text.startswith('PODS:\n'):
        return result
    for line in text.splitlines()[1:]:
        if line and not line[0].isspace():
            break
        match = re.fullmatch(r'  - ([A-Za-z0-9_+.-]+(?:/[A-Za-z0-9_+.-]+)*)(?: \([^()\r\n]+\))?:?', line)
        if match:
            result.add(match[1])
    return result


def observe(path, pods, before, after):
    facts = {'schema': 1, 'scope': SCOPE, 'state': 'UNKNOWN', 'categories': [],
             'reported_failed_locked_pods': [], 'curl_exit_codes': [], 'http_statuses': [],
             'bytes_read': 0, 'input_truncated': False, 'line_limit_reached': False,
             'unclassified_error_lines': 0, 'locks_before': before, 'locks_after': after,
             'locks_unchanged': before == after and all(before.values())}
    try:
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as source:
            if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                raise ValueError('Expected a private regular log.')
            raw = source.read(LIMIT + 1)
        facts['input_truncated'] = len(raw) > LIMIT
        raw = raw[:LIMIT]
        facts['bytes_read'] = len(raw)
        lines = raw.decode('utf-8', errors='replace').splitlines()
        facts['line_limit_reached'] = len(lines) > LINE_LIMIT
        categories, failed, curl_codes, statuses = set(), set(), set(), set()
        for raw_line in lines[:LINE_LIMIT]:
            line = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', raw_line).strip()
            found = False
            for pattern, category in PATTERNS:
                if re.search(pattern, line, re.IGNORECASE):
                    categories.add(category)
                    found = True
            match = re.match(r'^\[!\] Error installing ([A-Za-z0-9_+.-]+(?:/[A-Za-z0-9_+.-]+)*)(?:\s|$)', line)
            if match and match[1] in pods:
                failed.add(match[1])
            match = re.match(r'^curl: \(([1-9][0-9]?)\)(?:\s|$)', line)
            if match:
                code = int(match[1])
                curl_codes.add(code)
                found = True
                categories.add({5: 'DEPENDENCY_DNS_FAILURE', 6: 'DEPENDENCY_DNS_FAILURE',
                    7: 'DEPENDENCY_CONNECTION_FAILURE', 28: 'DEPENDENCY_COMMAND_TIMEOUT',
                    35: 'DEPENDENCY_TLS_FAILURE', 60: 'DEPENDENCY_TLS_FAILURE'}.get(
                    code, 'CURL_DOWNLOAD_FAILURE'))
            match = re.search(r'\b(?:HTTP/[12](?:\.[01])?\s+|requested URL returned error:\s*)([1-5][0-9]{2})(?:\s|$)', line)
            if match:
                status = int(match[1])
                statuses.add(status)
                if 400 <= status < 500:
                    categories.add('DEPENDENCY_HTTP_CLIENT_FAILURE')
                elif status >= 500:
                    categories.add('DEPENDENCY_HTTP_SERVER_FAILURE')
                found = True
            if re.match(r'^(?:\[!\]|curl:|fatal:|error:)', line, re.IGNORECASE) and not found:
                facts['unclassified_error_lines'] += 1
        facts.update(state='OBSERVED', categories=sorted(categories),
                     reported_failed_locked_pods=sorted(failed)[:16],
                     curl_exit_codes=sorted(curl_codes), http_statuses=sorted(statuses))
    except (OSError, ValueError):
        pass
    return facts
