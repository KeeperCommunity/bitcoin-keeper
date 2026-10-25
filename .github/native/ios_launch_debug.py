"""Private post-build launch investigation. Raw evidence never reaches stdout."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import select
import shutil
import signal
import subprocess
import tarfile
import threading
import time

APP = 'io.hexawallet.hexakeeper.dev'
MAX_LOG = 2 * 1024 * 1024
MAX_REPORT = 4 * 1024 * 1024
REPOSITORY = 'KeeperCommunity/bitcoin-keeper-private'
REPOSITORY_ID = '839671816'


def load_native():
    spec = importlib.util.spec_from_file_location('private_launch_debug_native',
        Path(__file__).with_name('hosted_native.py'))
    native = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native)
    return native


def require_private_job(native):
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    if (os.environ.get('GITHUB_REPOSITORY') != REPOSITORY or
            os.environ.get('GITHUB_REPOSITORY_ID') != REPOSITORY_ID or
            os.environ.get('KEEPER_PRIVATE_IOS_LAUNCH_DEBUG') != '1' or native.PLATFORM != 'IOS' or
            event.get('repository', {}).get('private') is not True or
            str(event['repository'].get('id')) != REPOSITORY_ID or
            event['pull_request']['head']['repo']['id'] != int(REPOSITORY_ID) or
            event['pull_request']['head']['sha'] != os.environ.get('KEEPER_SOURCE_SHA') or
            event.get('action') != 'labeled' or event.get('label', {}).get('name') != 'keeper/ios-launch-debug'):
        raise ValueError('Private exact-source debug selection required.')
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=native.ROOT, text=True).strip()
    if not re.fullmatch('[a-f0-9]{40}', head) or head != os.environ['KEEPER_SOURCE_SHA']:
        raise ValueError('Private debug source moved.')


def write_json(path, value):
    with path.open('x') as target:
        json.dump(value, target, indent=2)
        target.write('\n')
    path.chmod(0o600)


class Stream:
    """Drain a scoped OS stream without an unbounded file or blocking reader."""
    def __init__(self, path, args):
        self.path, self.total, self.drain_error = path, 0, False
        self.stopping = threading.Event()
        self.child = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                      start_new_session=True)
        try:
            os.set_blocking(self.child.stdout.fileno(), False)
            self.initial_exit_code = self.child.poll()
            self.thread = threading.Thread(target=self.drain, daemon=True)
            self.thread.start()
        except Exception:
            try:
                try:
                    os.killpg(self.child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                self.child.wait(timeout=2)
            finally:
                self.child.stdout.close()
            raise

    def drain(self):
        tail = bytearray()
        try:
            with self.path.open('xb') as target:
                self.path.chmod(0o600)
                while not self.stopping.is_set():
                    if not select.select([self.child.stdout], [], [], 0.2)[0]:
                        continue
                    block = os.read(self.child.stdout.fileno(), 4096)
                    if not block:
                        break
                    tail.extend(block)
                    if len(tail) > MAX_LOG:
                        del tail[:-MAX_LOG]
                    self.total += len(block)
                for _ in range(16):
                    try:
                        block = os.read(self.child.stdout.fileno(), 4096)
                    except BlockingIOError:
                        break
                    if not block:
                        break
                    tail.extend(block)
                    if len(tail) > MAX_LOG:
                        del tail[:-MAX_LOG]
                    self.total += len(block)
                target.write(tail)  # A bounded chronological tail, never a prefix that loses the late cause.
        except Exception:
            self.drain_error = True

    def stop(self):
        cleanup_failed = False
        try:
            # Dispose the owned group even if its parent exited with a live pipe.
            try:
                os.killpg(self.child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                self.child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(self.child.pid, signal.SIGKILL)
                self.child.wait(timeout=2)
        except Exception:
            cleanup_failed = True
        finally:
            self.stopping.set()
            self.thread.join(timeout=3)
            cleanup_failed |= self.thread.is_alive()
            self.child.stdout.close()
        return {'bytes_observed': self.total, 'bytes_retained': min(self.total, MAX_LOG),
                'truncated': self.total > MAX_LOG, 'exit_code': self.child.returncode,
                'drain_failed': self.drain_error, 'cleanup_failed': cleanup_failed,
                'initial_exit_code': self.initial_exit_code,
                'attachment_and_full_window_coverage': 'UNKNOWN_POPEN_NOT_SUBSCRIPTION_ATTESTATION'}


def original_launch_error(private):
    spec = importlib.util.spec_from_file_location('private_launch_error_json',
        Path(__file__).with_name('maestro_failure_snapshot.py'))
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    directory = private / 'maestro-output'
    rows = reader.read_json(reader.commands_file(directory), directory)
    errors = []
    for row in rows:
        command, metadata = row.get('command', {}), row.get('metadata', {})
        launch = command.get('launchAppCommand')
        if (type(launch) is dict and launch.get('appId') in (APP, '${APP_ID}') and
                metadata.get('status') == 'FAILED'):
            value = metadata.get('error', {})
            if (type(value) is dict and set(value) <= {'message', 'debugMessage'} and
                    all(type(text) is str and len(text.encode()) <= 65536 for text in value.values())):
                errors.append(value)
    return {'scope': 'ORIGINAL_FAILED_LAUNCH_ONLY_NO_UI_HIERARCHY_OR_ENVIRONMENT', 'errors': errors[:1]}


def crash_reasons(private, device, executable, started, ended):
    """Keep owned crash reasons and symbols; omit registers, memory and app data."""
    roots = [Path.home() / 'Library/Logs/DiagnosticReports', Path.home() /
        ('Library/Developer/CoreSimulator/Devices/' + device + '/data/Library/Logs/CrashReporter')]
    result = []
    for root in roots:
        if not root.is_dir() or root.is_symlink():
            continue
        for path in sorted(root.glob('*.ips'))[-32:]:
            try:
                info = path.stat()
                if (path.is_symlink() or not path.is_file() or info.st_uid != os.getuid() or
                        not started <= info.st_mtime <= ended + 5 or info.st_size > MAX_REPORT):
                    continue
                raw = path.read_bytes()
                _, body = raw.split(b'\n', 1)
                value = json.loads(body)
                if (value.get('procName') != executable or
                        value.get('bundleInfo', {}).get('CFBundleIdentifier') != APP or
                        ('/CoreSimulator/Devices/' + device + '/data/') not in value.get('procPath', '')):
                    continue
                selected = {key: value[key] for key in ('exception', 'termination', 'asi') if key in value}
                thread = value.get('faultingThread')
                if type(thread) is int and 0 <= thread < len(value.get('threads', [])):
                    selected['faulting_symbols'] = [frame['symbol'] for frame in
                        value['threads'][thread].get('frames', [])[:32] if type(frame.get('symbol')) is str]
                payload = json.dumps(selected)
                if len(payload.encode()) <= 65536:
                    result.append(selected)
                if len(result) == 4:
                    return result
            except (OSError, ValueError, TypeError, KeyError):
                continue
    return result


class Session:
    def __init__(self, native):
        self.native, self.streams = native, []
        self.frozen, self.stream_results = False, []
        self.directory = native.PRIVATE / 'ios-launch-debug'
        self.directory.mkdir(mode=0o700)
        self.started = None
        self.capture_phase = 'OWNED_SIMULATOR_BOOT_AND_INSTALL'

    def before_boot(self, device):
        if (self.started is not None or
                not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', device)):
            raise ValueError('One fresh owned simulator UUID required.')
        self.device, self.started = device, time.time()
        host = '(process == "CoreSimulatorService" OR process == "simctl") AND eventMessage CONTAINS "' + device + '"'
        try:
            self.streams.append(Stream(self.directory / 'host-simulator.log',
                ['log', 'stream', '--style', 'ndjson', '--level', 'debug', '--predicate', host]))
        except Exception as error:
            # Failure to attach an observer must not prevent the real boot.
            self.stream_results.append({'stream': 'host-simulator.log',
                'start_failed': type(error).__name__, 'error': str(error)[:4096]})

    def start(self, device):
        data = self.native.read()
        if (not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', device) or
                data.get('device', {}).get('id') != device or
                data.get('device', {}).get('fresh_disposable_state') is not True or
                data.get('installed_artifact_verified') is not True):
            raise ValueError('Owned byte-verified simulator install required.')
        if self.started is None:
            self.before_boot(device)
        if device != self.device:
            raise ValueError('The owned simulator changed before app launch.')
        self.capture_phase = 'VERIFIED_INSTALL_AND_APP_LAUNCH'
        services = '(process == "SpringBoard" OR process == "runningboardd" OR process == "launchd" OR process == "lsd" OR process == "amfid")'
        # The entire selected service stream belongs to this fresh owned UUID.
        # Underlying reasons often occupy records without the app identifier.
        predicate = services
        self.streams.append(Stream(self.directory / 'simulator-launch.log',
            ['xcrun', 'simctl', 'spawn', device, 'log', 'stream', '--style', 'ndjson',
             '--level', 'debug', '--predicate', predicate]))

    def setup_commands(self, device):
        """Retain actual failed owned setup output privately, with no extra query."""
        expected = [['xcrun', 'simctl', 'boot', device],
                    ['xcrun', 'simctl', 'bootstatus', device, '-b'],
                    ['xcrun', 'simctl', 'install', device, str(self.native.PRIVATE /
                     'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app')]]
        result = []
        for index, entry in enumerate(self.native.read().get('commands', []), 1):
            if entry.get('command') not in expected:
                continue
            row = {key: entry[key] for key in ('label', 'exit_code', 'duration_seconds',
                                               'timeout_seconds') if key in entry}
            if entry.get('exit_code') != 0:
                path = self.native.PRIVATE / ('command-%03d.log' % index)
                try:
                    if path.is_symlink() or not path.is_file():
                        raise ValueError('Owned command output unavailable.')
                    with path.open('rb') as source:
                        size = source.seek(0, os.SEEK_END)
                        source.seek(max(0, size - 16384))
                        row.update(output=source.read(16384).decode(errors='replace'),
                                   output_bytes=size, output_truncated=size > 16384)
                except (OSError, ValueError) as error:
                    row['output_unavailable'] = type(error).__name__
            result.append(row)
        return result

    def freeze(self):
        if self.frozen:
            return
        self.frozen = True
        for stream in self.streams:
            try:
                self.stream_results.append(stream.stop())
            except Exception:
                self.stream_results.append({'cleanup': 'FAILED'})

    def finish(self, device, original_error):
        ended = time.time()
        self.freeze()
        streams = self.stream_results
        if self.started is None or device != self.device:
            write_json(self.directory / 'summary.json', {'state': 'NO_OWNED_CAPTURE', 'native_acceptance': False})
            return
        if self.capture_phase == 'VERIFIED_INSTALL_AND_APP_LAUNCH':
            try:
                errors = original_launch_error(self.native.PRIVATE)
            except Exception:
                errors = {'state': 'ORIGINAL_ERROR_JSON_UNAVAILABLE'}
            write_json(self.directory / 'original-launch-error.json', errors)
            executable = self.native.read()['built_artifact']['executable']
            write_json(self.directory / 'owned-crash-reasons.json',
                {'reports': crash_reasons(self.native.PRIVATE, device, executable, self.started, ended),
                 'scope': 'OWNED_UUID_APP_AND_CAPTURE_WINDOW_ONLY_NO_MEMORY_OR_USER_DATA'})
        write_json(self.directory / 'summary.json', {'state': 'CAPTURED_BEFORE_OWNED_DEVICE_CLEANUP',
            'original_smoke_failed': original_error is not None, 'streams': streams,
            'capture_phase': self.capture_phase, 'setup_commands': self.setup_commands(device),
            'capture_started_epoch': self.started, 'inspection_completed_epoch': ended,
            'scope': 'PRIVATE_LAUNCH_DIAGNOSIS_NOT_NATIVE_ACCEPTANCE', 'native_acceptance': False})
        if any(row.get('cleanup') == 'FAILED' or row.get('cleanup_failed') or row.get('drain_failed') for row in streams):
            raise RuntimeError('Private launch stream capture or cleanup failed.')


def retain(native):
    output = native.ROOT / 'artifacts/private-ios-launch-debug'
    output.mkdir(parents=True, mode=0o700)
    directory = native.PRIVATE / 'ios-launch-debug'
    for name in ('simulator-launch.log', 'host-simulator.log', 'original-launch-error.json',
                 'owned-crash-reasons.json', 'summary.json'):
        source = directory / name
        if source.is_file() and not source.is_symlink() and source.stat().st_size <= MAX_LOG:
            shutil.copyfile(source, output / name)
            (output / name).chmod(0o600)
    if native.EVIDENCE.is_file():
        shutil.copyfile(native.EVIDENCE, output / 'native-metadata.json')
    data = native.read()
    if data.get('build') != 'PASS':
        return
    built = native.PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
    inventory, executable = native._bundle_inventory(built)
    if (native.artifact_identity() != data['built_artifact'] or
            data.get('toolchain', {}).get('ios_simulator_signature', {}).get('verified') is not True or
            sum(path.stat().st_size for path in built.rglob('*') if path.is_file()) > 512 * 1024 * 1024 or
            any(path.suffix in ('.p12', '.p8', '.jks', '.keystore', '.mobileprovision') for path in built.rglob('*'))):
        raise ValueError('Only the unchanged simulator build without signing credentials may be retained.')
    app_output = native.ROOT / 'artifacts/private-ios-simulator-app'
    app_output.mkdir(parents=True, mode=0o700)
    archive = app_output / 'simulator-app.tar.gz'
    with tarfile.open(archive, 'x:gz') as target:
        target.add(built, arcname=built.name)
    if native._bundle_inventory(built) != (inventory, executable) or native.artifact_identity() != data['built_artifact']:
        archive.unlink()
        raise ValueError('Built app changed during private retention.')
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=native.ROOT, text=True).strip()
    tree = subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=native.ROOT, text=True).strip()
    manifest = {'schema': 1, 'source_sha': source, 'source_tree': tree,
        'run_id': os.environ.get('GITHUB_RUN_ID'), 'run_attempt': os.environ.get('GITHUB_RUN_ATTEMPT'),
        'bundle_inventory_sha256': hashlib.sha256(json.dumps(inventory, sort_keys=True).encode()).hexdigest(),
        'executable_sha256': inventory[executable][1],
        'toolchain_sha256': hashlib.sha256(json.dumps(data['toolchain'], sort_keys=True).encode()).hexdigest(),
        'archive_sha256': native._file_sha256(archive),
        'scope': 'SIMULATOR_BUILD_ONLY_NO_CONTAINERS_KEYCHAINS_USER_DATA_OR_RELEASE_SIGNING',
        'native_acceptance': False}
    write_json(app_output / 'manifest.json', manifest)
    write_json(output / 'app-manifest.json', manifest)


def main(phase):
    native = load_native()
    require_private_job(native)
    os.environ.update({'ENVFILE': '.env.ci', 'RCT_NO_LAUNCH_PACKAGER': '1',
                       'RCT_NEW_ARCH_ENABLED': '1', 'MAESTRO_CLI_NO_ANALYTICS': '1'})
    if phase == 'run':
        native.smoke(debug_session=Session(native))
    elif phase == 'retain':
        retain(native)
    else:
        raise ValueError('Unknown private debug phase.')


if __name__ == '__main__':
    import sys
    try:
        main(sys.argv[1])
    except Exception:
        print('Private launch investigation failed; inspect the private retained evidence.', file=sys.stderr)
        raise SystemExit(1) from None
