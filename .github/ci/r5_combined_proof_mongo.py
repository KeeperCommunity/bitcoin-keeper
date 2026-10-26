"""Own one disposable CI replica; never infer absence from a failed query."""
import json
import os
import re
import subprocess
import sys
import tempfile
import time

IMAGE = 'mongo:7.0.16@sha256:c630c59342c1493d50345136df2af14a76b9e827dd5316bfabee07a0880a5f3a'
LABEL = 'keeper-r5-final624-proof-run'
INIT = ('try { rs.status(); } catch (e) { if (e.code !== 94) throw e; '
        'rs.initiate({_id: "keeperQA", members: [{_id: 0, host: "127.0.0.1:27038"}]}); } '
        'quit(db.hello().isWritablePrimary ? 0 : 1)')


class ProofError(Exception):
    pass


def identity(env):
    values = [env.get(key, '') for key in ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']]
    if not all(isinstance(value, str) and re.fullmatch(r'[1-9][0-9]{0,19}', value) for value in values):
        raise ProofError('INVALID_RUN_IDENTITY')
    token = '-'.join(values)
    return 'keeper-r5-final624-' + token, token


def docker(args, timeout=10):
    # Raw command output never enters receipts; temporary output is read bounded.
    try:
        with tempfile.TemporaryFile() as output:
            result = subprocess.run(['docker', *args], stdout=output,
                                    stderr=subprocess.DEVNULL, timeout=timeout, check=False)
            output.seek(0)
            raw = output.read(4097)
        if len(raw) > 4096:
            raise ProofError('DOCKER_OUTPUT_UNKNOWN')
        return result.returncode, raw.decode('utf-8', errors='strict').rstrip('\r\n')
    except (OSError, subprocess.SubprocessError, UnicodeError):
        raise ProofError('DOCKER_QUERY_FAILED') from None


def present(name):
    code, value = docker(['container', 'ls', '--all', '--filter', 'name=^/' + name + '$',
                          '--format', '{{.Names}}'])
    if code or value not in ['', name]:
        raise ProofError('DOCKER_INVENTORY_UNKNOWN')
    return value == name


def start(name, token):
    if present(name):
        raise ProofError('CONTAINER_ALREADY_EXISTS')
    code, _ = docker(['run', '--detach', '--name', name, '--label', LABEL + '=' + token,
                      '--publish', '127.0.0.1:27038:27038', IMAGE,
                      'mongod', '--replSet', 'keeperQA', '--bind_ip_all', '--port', '27038'], 120)
    if code:
        raise ProofError('CONTAINER_START_FAILED')
    deadline = time.monotonic() + 60
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        code, _ = docker(['exec', name, 'mongosh', '--port', '27038', '--quiet', '--eval', INIT],
                         min(10, remaining))
        if code == 0:
            if time.monotonic() > deadline:
                break
            return 'writable'
        time.sleep(min(2, max(0, deadline - time.monotonic())))
    raise ProofError('REPLICA_NOT_WRITABLE')


def cleanup(name, token):
    if not present(name):
        return 'absent'
    code, owner = docker(['inspect', '--format', '{{ index .Config.Labels "' + LABEL + '" }}', name])
    if code:
        raise ProofError('CONTAINER_OWNER_UNKNOWN')
    if owner != token:
        raise ProofError('FOREIGN_CONTAINER')
    code, removed = docker(['rm', '--force', '--volumes', name], 30)
    if code or removed != name:
        raise ProofError('CONTAINER_REMOVAL_FAILED')
    if present(name):
        raise ProofError('CONTAINER_REMAINS')
    return 'removed'


def main(args=None, env=None):
    args = sys.argv[1:] if args is None else args
    phase = args[0] if len(args) == 1 and args[0] in ['start', 'cleanup'] else 'INVALID'
    try:
        if phase == 'INVALID':
            raise ProofError('INVALID_PHASE')
        name, token = identity(os.environ if env is None else env)
        disposition = (start if phase == 'start' else cleanup)(name, token)
        print(json.dumps({'schema': 1, 'phase': phase, 'result': 'PASS',
                          'container': name, 'disposition': disposition}))
        return 0
    except ProofError as error:
        print(json.dumps({'schema': 1, 'phase': phase, 'result': 'FAIL', 'error': str(error)}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
