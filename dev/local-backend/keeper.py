#!/usr/bin/env python3
"""Contributor setup using only Python's standard library, Git and Compose."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent


def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def output(args, **kwargs):
    return subprocess.check_output([str(a) for a in args], text=True, **kwargs).strip()


def settings():
    values = {}
    envfile = HERE / '.env'
    if envfile.exists():
        for line in envfile.read_text().splitlines():
            if line.strip() and not line.lstrip().startswith('#'):
                key, sep, value = line.partition('=')
                if not sep:
                    raise ValueError('Use KEY=value lines in dev/local-backend/.env')
                values[key.strip()] = value.strip()
    defaults = {'COMPOSE_PROJECT_NAME': 'keeper-contributor',
                'KEEPER_RELAY_PORT': '3000', 'KEEPER_CHANNEL_PORT': '4002',
                'KEEPER_SIGNING_PORT': '3003'}
    for key, default in defaults.items():
        values[key] = os.environ.get(key, values.get(key, default))
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', values['COMPOSE_PROJECT_NAME']):
        raise ValueError('COMPOSE_PROJECT_NAME must contain lowercase letters, digits, _ or -')
    ports = [int(values[k]) for k in defaults if k.endswith('_PORT')]
    if len(set(ports)) != 3 or any(p < 1024 or p > 65535 for p in ports):
        raise ValueError('Choose three distinct ports between 1024 and 65535')
    return {k: values[k] for k in defaults}


def compose(*args, **kwargs):
    env = dict(os.environ, **settings())
    return run(['docker', 'compose', '--env-file', HERE / '.env.example',
                '-f', HERE / 'compose.yaml', *args], env=env, **kwargs)


def prepare(only=None):
    lock = json.loads((HERE / 'sources.lock.json').read_text())
    sources = HERE / '.sources'
    sources.mkdir(exist_ok=True)
    for name, spec in lock.items():
        if only is not None and name != only:
            continue
        adapter = HERE / 'adapters' / name
        for asset, digest in spec['assets'].items():
            if hashlib.sha256((adapter / asset).read_bytes()).hexdigest() != digest:
                raise ValueError(f'{name}: adapter checksum mismatch: {asset}')
        fingerprint = hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()
        target = sources / name
        marker = target / '.keeper-source.json'
        if target.exists():
            if not marker.exists() or json.loads(marker.read_text()) != spec:
                raise ValueError(f'{target}: existing checkout does not match this setup. '
                                 'Move it aside after saving your edits, then retry; it was not overwritten.')
            if output(['git', '-C', target, 'rev-parse', 'HEAD']) != spec['revision']:
                raise ValueError(f'{target}: HEAD changed; save your work and move this checkout aside.')
            print(f'{name}: already prepared; preserving local backend edits ({fingerprint[:12]})')
            continue
        with tempfile.TemporaryDirectory(prefix=f'.{name}-', dir=sources) as temp:
            checkout = Path(temp) / 'checkout'
            run(['git', 'init', '--quiet', checkout])
            run(['git', '-C', checkout, 'remote', 'add', 'origin', spec['url']])
            print(f'{name}: fetching {spec["revision"]}', flush=True)
            try:
                run(['git', '-C', checkout, 'fetch', '--quiet', '--depth=1', 'origin', spec['revision']])
            except subprocess.CalledProcessError as error:
                raise ValueError(f'{name}: cannot fetch the pinned public backend revision. '
                                 'Check the revision and network connection. '
                                 'No existing checkout was replaced.') from error
            run(['git', '-C', checkout, 'checkout', '--quiet', '--detach', spec['revision']])
            if spec['assets']:
                run(['git', '-C', checkout, 'apply', '--check', adapter / 'local.patch'])
                run(['git', '-C', checkout, 'apply', adapter / 'local.patch'])
                for asset in (adapter / 'files').rglob('*'):
                    if asset.is_file():
                        dest = checkout / asset.relative_to(adapter / 'files')
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copyfile(asset, dest)
            (checkout / '.keeper-source.json').write_text(json.dumps(spec, indent=2) + '\n')
            checkout.rename(target)


def app_env():
    config = settings()
    template = (HERE / 'app.env.local.example').read_text()
    for port, name in [('3000', 'RELAY'), ('4002', 'CHANNEL'), ('3003', 'SIGNING')]:
        template = template.replace(f':{port}/', f':{config[f"KEEPER_{name}_PORT"]}/')
    dest = APP / '.env.local'
    if dest.exists():
        if dest.read_text() != template:
            raise ValueError('.env.local already exists with different settings. Compare it with '
                             'dev/local-backend/app.env.local.example; no file was overwritten.')
        print('.env.local already matches this setup')
        return
    fd = os.open(dest, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(template)
    print('Created .env.local (local test settings only)')


def doctor():
    failed = False
    for label, args in [('Git', ['git', '--version']), ('Docker Engine', ['docker', 'info', '--format', '{{.ServerVersion}}']),
                        ('Docker Compose', ['docker', 'compose', 'version']), ('Node', ['node', '--version']),
                        ('Yarn', ['yarn', '--version'])]:
        try:
            print(f'{label}: {output(args, stderr=subprocess.DEVNULL)}')
        except (OSError, subprocess.CalledProcessError):
            print(f'MISSING: {label}')
            failed = True
    print('Python:', sys.version.split()[0])
    print('Android SDK:', os.environ.get('ANDROID_HOME', 'set ANDROID_HOME before Android builds'))
    print('JAVA_HOME:', os.environ.get('JAVA_HOME', 'set JAVA_HOME to JDK 17 before Android builds'))
    if sys.platform == 'darwin':
        for label, args in [('Xcode', ['xcodebuild', '-version']), ('Ruby', ['ruby', '--version']),
                            ('Bundler', ['bundle', '--version'])]:
            try:
                print(f'{label}: {output(args, stderr=subprocess.DEVNULL)}')
            except (OSError, subprocess.CalledProcessError):
                print(f'MISSING for iOS: {label}')
    print('See README.md for required native tool versions; this checks availability, not native builds.')
    if failed:
        raise ValueError('Install/start the missing prerequisites and rerun doctor.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['doctor', 'prepare', 'prepare-signing', 'up', 'stop', 'status', 'logs', 'verify', 'env', 'android-forward'])
    parser.add_argument('--serial', help='Android emulator/device serial for android-forward')
    args = parser.parse_args()
    if args.command == 'doctor':
        doctor()
    elif args.command == 'prepare':
        prepare()
    elif args.command == 'prepare-signing':
        prepare(only='signing')
    elif args.command == 'up':
        prepare()
        compose('up', '-d', '--build', '--wait', '--wait-timeout', '180')
        run([sys.executable, HERE / 'verify.py'])
    elif args.command == 'stop':
        compose('down')  # Retain both databases and signing keys. No implicit data reset.
    elif args.command == 'status':
        compose('ps')
    elif args.command == 'logs':
        compose('logs', '--tail', '100')
    elif args.command == 'verify':
        run([sys.executable, HERE / 'verify.py'])
    elif args.command == 'env':
        app_env()
    elif args.command == 'android-forward':
        if not args.serial:
            parser.error('android-forward requires --serial; use adb devices to choose one')
        for port in ['8081'] + [v for k, v in settings().items() if k.endswith('_PORT')]:
            run(['adb', '-s', args.serial, 'reverse', f'tcp:{port}', f'tcp:{port}'])


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f'Setup failed: {error}', file=sys.stderr)
        sys.exit(1)
