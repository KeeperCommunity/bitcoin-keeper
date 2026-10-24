"""Own the existing public CI replica; failed queries never prove absence."""
import json
import os
import re
import subprocess
import sys
import tempfile
import time

IMAGE = 'mongo:7.0@sha256:9854f7139445d766a9523571d6f047530c45547460ffcf8259eb2bf4264632ca'
LABEL = 'keeper.r5.public-ci.owner'
PORT = '27058'
INIT = ('try { rs.status(); } catch (e) { if (e.code !== 94) throw e; '
        'rs.initiate({_id: "keeperQA", members: [{_id: 0, host: "127.0.0.1:27058"}]}); } '
        'quit(db.hello().isWritablePrimary ? 0 : 1)')


class ReplicaError(Exception):
    pass


def identity(env):
    if (env.get('GITHUB_ACTIONS') != 'true' or env.get('RUNNER_ENVIRONMENT') != 'github-hosted' or
            env.get('GITHUB_REPOSITORY') != 'KeeperCommunity/bitcoin-keeper'):
        raise ReplicaError('HOSTED_PUBLIC_CI_REQUIRED')
    values = [env.get(key, '') for key in ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT')]
    if not all(isinstance(value, str) and re.fullmatch(r'[1-9][0-9]{0,19}', value) for value in values):
        raise ReplicaError('INVALID_RUN_IDENTITY')
    token = '-'.join(values)
    return 'keeper-r5-public-ci-' + token, token


def docker(args, timeout=10):
    try:
        with tempfile.TemporaryFile() as output:
            result = subprocess.run(['docker', *args], stdout=output, stderr=subprocess.DEVNULL,
                                    timeout=timeout, check=False)
            output.seek(0)
            raw = output.read(4097)
        if len(raw) > 4096:
            raise ReplicaError('DOCKER_OUTPUT_UNKNOWN')
        return result.returncode, raw.decode('utf-8').rstrip('\r\n')
    except (OSError, subprocess.SubprocessError, UnicodeError):
        raise ReplicaError('DOCKER_QUERY_FAILED') from None


def present(name):
    code, value = docker(['container', 'ls', '--all', '--filter', 'name=^/' + name + '$',
                          '--format', '{{.Names}}'])
    if code or value not in ('', name):
        raise ReplicaError('DOCKER_INVENTORY_UNKNOWN')
    return value == name


def owned(name, token, *, live=False):
    template = '{{ index .Config.Labels "' + LABEL + '" }}|{{.Config.Image}}|{{.State.Running}}'
    code, value = docker(['inspect', '--format', template, name])
    expected = token + '|' + IMAGE + '|'
    if code or value not in (expected + 'true', expected + 'false'):
        raise ReplicaError('CONTAINER_OWNER_OR_IMAGE_UNKNOWN')
    if live and value != expected + 'true':
        raise ReplicaError('OWNED_CONTAINER_NOT_RUNNING')


def start(name, token):
    if present(name):
        raise ReplicaError('CONTAINER_ALREADY_EXISTS')
    # The deterministic name/label survive a committed start whose CLI reply is
    # lost. The always-run cleanup independently discovers that exact resource.
    code, _ = docker(['run', '--detach', '--name', name, '--label', LABEL + '=' + token,
                      '--publish', '127.0.0.1:27058:27058', IMAGE,
                      'mongod', '--replSet', 'keeperQA', '--bind_ip_all', '--port', PORT], 120)
    if code:
        raise ReplicaError('CONTAINER_START_FAILED')
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        owned(name, token, live=True)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        code, _ = docker(['exec', name, 'mongosh', '--port', PORT, '--quiet', '--eval', INIT],
                         min(10, remaining))
        if code == 0 and time.monotonic() <= deadline:
            owned(name, token, live=True)
            if time.monotonic() > deadline:
                break
            return 'writable'
        time.sleep(min(2, max(0, deadline - time.monotonic())))
    raise ReplicaError('REPLICA_NOT_WRITABLE')


def cleanup(name, token):
    if not present(name):
        return 'absent'
    owned(name, token)
    code, removed = docker(['rm', '--force', '--volumes', name], 30)
    if code or removed != name:
        raise ReplicaError('CONTAINER_REMOVAL_FAILED')
    if present(name):
        raise ReplicaError('CONTAINER_REMAINS')
    return 'removed'


def main(args=None, env=None):
    args = sys.argv[1:] if args is None else args
    phase = args[0] if len(args) == 1 and args[0] in ('start', 'cleanup') else 'INVALID'
    try:
        if phase == 'INVALID':
            raise ReplicaError('INVALID_PHASE')
        name, token = identity(os.environ if env is None else env)
        disposition = (start if phase == 'start' else cleanup)(name, token)
        print(json.dumps({'schema': 1, 'scope': 'PUBLIC_LEGACY_MATRIX_REPLICA_ONLY',
                          'phase': phase, 'result': 'PASS', 'container': name,
                          'disposition': disposition}))
        return 0
    except ReplicaError as error:
        print(json.dumps({'schema': 1, 'phase': phase, 'result': 'FAIL', 'error': str(error)}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
