"""Private, source-pinned simulator signature comparison; no app build or UI credit."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import time
import zipfile

SOURCE = 'ddcd0970f80e23adf86a093cf3eebf8ad363cec9'
TREE = '16ef813be34993807884b4c9d3efc6058d1bebd5'
ZIP_HASH = 'fd1f27948a19811ecd9c80a6fe0a400a290766fbdaa5b55ef5eaa02b1224db37'
MANIFEST_HASH = '7479b4e4cf54dd99169b9fa55bae613de2c987f71163399ef85eb5f7cb0d6b7f'
ARCHIVE_HASH = 'b0196a03fae71d9c14343a2cdfe181b6f4d53bfac529c7589305c90afc959137'
EXECUTABLE_HASH = '22b60dbe7e3a373cd055c330a1ebd6ab308f95caaa25e57dd16a2d6fa4853d02'
INVENTORY_HASH = '65b5b80f4e0215cb56e483a35a1d1c281fba0363f76de9924e30f82c22ee44be'
ZIP_BYTES = 33100856
ARCHIVE_BYTES = 33746377
MEMBERS = 80
EXPANDED_BYTES = 179379624
MAX_FILE = 171016360
APP = 'io.hexawallet.hexakeeper.dev'
HOST_PREDICATE = '(process == "taskgated-helper" OR process == "taskgated" OR process == "amfid")'
LABEL = "keeper/ios-signature-comparison"


def module(name):
    spec = importlib.util.spec_from_file_location('signature_comparison_' + name,
        Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def strict_json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate JSON field.')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique)


def restore(native, input_zip):
    """Admit only the exact retained package; never follow a tar link or owner."""
    parent = os.open(input_zip.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    staging = None
    try:
        if os.fstat(parent).st_uid != os.getuid():
            raise ValueError('Owned input directory required.')
        descriptor = os.open(input_zip.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(descriptor, 'rb') as source:
            info = os.fstat(source.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or
                    info.st_nlink != 1 or info.st_size != ZIP_BYTES):
                raise ValueError('Exact owned retained ZIP required.')
            digest = hashlib.sha256()
            for block in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(block)
            if digest.hexdigest() != ZIP_HASH:
                raise ValueError('Retained ZIP identity changed.')
            source.seek(0)
            with zipfile.ZipFile(source) as archive:
                entries = archive.infolist()
                if (len(entries) != 2 or {x.filename for x in entries} != {'manifest.json', 'simulator-app.tar.gz'} or
                        any(x.filename != x.orig_filename or x.flag_bits & 1 or
                            stat.S_IFMT(x.external_attr >> 16) != stat.S_IFREG or
                            x.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) for x in entries) or
                        archive.getinfo('manifest.json').file_size > 65536 or
                        archive.getinfo('simulator-app.tar.gz').file_size != ARCHIVE_BYTES):
                    raise ValueError('Unexpected retained ZIP layout.')
                manifest_raw = archive.read('manifest.json')
                manifest = strict_json(manifest_raw)
                if (hashlib.sha256(manifest_raw).hexdigest() != MANIFEST_HASH or
                        manifest.get('source_sha') != SOURCE or manifest.get('source_tree') != TREE or
                        manifest.get('run_id') != '40189694110' or manifest.get('run_attempt') != '1' or
                        manifest.get('native_acceptance') is not False or
                        manifest.get('archive_sha256') != ARCHIVE_HASH or
                        manifest.get('executable_sha256') != EXECUTABLE_HASH or
                        manifest.get('bundle_inventory_sha256') != INVENTORY_HASH):
                    raise ValueError('Original build manifest does not match the reviewed source.')
                digest = hashlib.sha256()
                with archive.open('simulator-app.tar.gz') as compressed:
                    for block in iter(lambda: compressed.read(1024 * 1024), b''):
                        digest.update(block)
                if digest.hexdigest() != ARCHIVE_HASH:
                    raise ValueError('Original app archive changed.')
                staging = Path(tempfile.mkdtemp(prefix='restore-', dir=native.PRIVATE))
                staging.chmod(0o700)
                names, total = set(), 0
                with archive.open('simulator-app.tar.gz') as compressed, tarfile.open(fileobj=compressed, mode='r|gz') as tar:
                    for member in tar:
                        name = member.name.rstrip('/')
                        path = PurePosixPath(name)
                        if (len(names) >= MEMBERS or name in names or path.is_absolute() or '..' in path.parts or
                                path.as_posix() != name or not path.parts or path.parts[0] != 'hexa_keeper_dev.app' or
                                not (member.isdir() or member.isfile()) or member.mode & 0o7000 or
                                not 0 <= member.size <= MAX_FILE):
                            raise ValueError('Unexpected retained tar member.')
                        names.add(name)
                        total += member.size
                        if total > EXPANDED_BYTES:
                            raise ValueError('Retained app exceeded its reviewed size.')
                        destination = staging.joinpath(*path.parts)
                        if member.isdir():
                            destination.mkdir(mode=member.mode & 0o777)
                        else:
                            with tar.extractfile(member) as content, destination.open('xb') as target:
                                shutil.copyfileobj(content, target, 1024 * 1024)
                            destination.chmod(member.mode & 0o777)
                if len(names) != MEMBERS or total != EXPANDED_BYTES:
                    raise ValueError('Retained app inventory is incomplete.')
                inventory, executable = native._bundle_inventory(staging / 'hexa_keeper_dev.app')
                if (hashlib.sha256(json.dumps(inventory, sort_keys=True).encode()).hexdigest() != INVENTORY_HASH or
                        inventory[executable] != ['file', EXECUTABLE_HASH]):
                    raise ValueError('Restored app bytes differ from the original build.')
                destination = native.PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
                destination.parent.mkdir(parents=True, mode=0o700)
                (staging / 'hexa_keeper_dev.app').rename(destination)
            after = os.fstat(source.fileno())
            if any(getattr(info, key) != getattr(after, key) for key in
                   ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')):
                raise ValueError('Retained input changed during admission.')
        return manifest
    finally:
        if staging is not None:
            shutil.rmtree(staging)
        os.close(parent)


def require_private_job(native):
    event = strict_json(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    repo = event.get('repository', {})
    pr = event.get('pull_request', {})
    if (os.environ.get('GITHUB_REPOSITORY') != 'KeeperCommunity/bitcoin-keeper-private' or
            os.environ.get('GITHUB_REPOSITORY_ID') != '839671816' or
            os.environ.get('KEEPER_PRIVATE_IOS_SIGNATURE_COMPARISON') != '1' or native.PLATFORM != 'IOS' or
            repo.get('private') is not True or repo.get('id') != 839671816 or
            pr.get('head', {}).get('repo', {}).get('id') != 839671816 or
            pr.get('head', {}).get('sha') != os.environ.get('KEEPER_SOURCE_SHA') or
            event.get('action') != 'labeled' or event.get('label', {}).get('name') != LABEL):
        raise ValueError('Private exact-source signature comparison required.')
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=native.ROOT, text=True).strip()
    if not re.fullmatch('[a-f0-9]{40}', head) or head != os.environ['KEEPER_SOURCE_SHA']:
        raise ValueError('Private comparison source moved.')


def metadata():
    return {'schema': 1, 'platform': 'IOS', 'diagnostic_only': True,
        'source_sha': os.environ['KEEPER_SOURCE_SHA'], 'run_id': os.environ['GITHUB_RUN_ID'],
        'run_attempt': os.environ['GITHUB_RUN_ATTEMPT'], 'workflow_ref': os.environ['GITHUB_WORKFLOW_REF'],
        'workflow_sha': os.environ['GITHUB_WORKFLOW_SHA'], 'commands': [], 'toolchain': {},
        'build': 'NOT RUN', 'smoke': 'NOT RUN', 'native_probe': 'NOT RUN', 'r5_features': 'NOT RUN',
        'hardware': 'NOT RUN', 'signing': 'NOT RUN', 'native_acceptance': False,
        'original_build': {'source_sha': SOURCE, 'source_tree': TREE, 'run_id': 40189694110,
            'run_attempt': 1, 'job_id': 121157855365, 'artifact_id': 12598443612,
            'artifact_zip_sha256': ZIP_HASH, 'archive_sha256': ARCHIVE_HASH},
        'scope': 'REUSED_SIMULATOR_APP_OS_SIGNATURE_COMPARISON_NO_COMPILE_METRO_UI_OR_RELEASE_ACCEPTANCE'}


def compare_variant(name, base, output, input_zip, debug, observer):
    native = debug.load_native()
    native.PRIVATE = base / name
    native.PRIVATE.mkdir(mode=0o700)
    native.EVIDENCE = native.PRIVATE / 'metadata.json'
    native.save(metadata())
    result = {'variant': name, 'native_acceptance': False, 'cleanup_errors': [], 'observation_complete': False, 'phase': 'RESTORE'}
    device, stream = None, None
    started = ended = None
    try:
        restore(native, input_zip)
        result['phase'] = 'STATIC_SIGNATURE'
        if name == 'complete_nested':
            native.sign_simulator_app()
        else:
            app = native.PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
            native.command(['codesign', '--verify', '--deep', '--strict', str(app)],
                'Verify original static simulator signature', error_details=False)
        app = native.PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
        effective = native.command(['codesign', '--display', '--entitlements', ':-', str(app)],
            'Read comparison effective entitlements', capture=True, error_details=False)
        start, end = effective.find('<?xml'), effective.find('</plist>')
        if start < 0 or end < start:
            raise ValueError('Comparison entitlements unavailable.')
        entitlements = plistlib.loads(effective[start:end + len('</plist>')].encode())
        if entitlements != module('simulator_signing').ENTITLEMENTS:
            raise ValueError('Comparison entitlement policy changed.')
        result['static_signature_verified'] = True
        result['effective_entitlements_sha256'] = hashlib.sha256(
            plistlib.dumps(entitlements, sort_keys=True)).hexdigest()
        data = native.read()
        data['built_artifact'] = native.artifact_identity()
        native.save(data)
        result['phase'] = 'SIMULATOR_SETUP'
        created = native.command(['xcrun', 'simctl', 'create', 'Keeper-signature-' + name,
            'com.apple.CoreSimulator.SimDeviceType.iPhone-16', 'com.apple.CoreSimulator.SimRuntime.iOS-18-5'],
            'Create owned signature-comparison simulator', timeout=120, capture=True)
        if not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', created):
            raise ValueError('Expected a fresh owned UUID.')
        device = created
        native.command(['xcrun', 'simctl', 'boot', device], 'Boot owned signature simulator', timeout=120)
        native.command(['xcrun', 'simctl', 'bootstatus', device, '-b'], 'Wait for signature simulator boot', timeout=240)
        native.wait_for_simulator_app_services(device)
        native.command(['xcrun', 'simctl', 'install', device, data['built_artifact']['path']],
            'Install exact comparison simulator app', timeout=120)
        data = native.read()
        data.update(device={'id': device, 'image': 'iPhone16;iOS18.5', 'fresh_disposable_state': True}, install_succeeded=True)
        native.save(data)
        native.verify_installed_artifact(device)
        result['before_process'] = observer.process(native.PRIVATE, device)
        stream_path = output / (name + '-host-signature.log')
        stream = debug.Stream(stream_path, ['log', 'stream', '--style', 'ndjson', '--level', 'debug', '--predicate', HOST_PREDICATE])
        result['phase'] = 'LAUNCH_AND_OBSERVE'
        started = time.time()
        try:
            response = native.command(['xcrun', 'simctl', 'launch', device, APP],
                'Launch ' + name + ' app once', timeout=20, capture=True, error_details=False)
            result['launch_request'] = 'ACCEPTED' if re.fullmatch(re.escape(APP) + r': [1-9][0-9]{0,9}', response) else 'UNRECOGNIZED_RESPONSE'
        except RuntimeError:
            result['launch_request'] = 'REJECTED_OR_TIMED_OUT'
        finally:
            ended = time.time()
        row = native.read()['commands'][-1]
        result['launch_command'] = {key: row.get(key) for key in ('exit_code', 'duration_seconds', 'timeout_seconds')}
        raw = (native.PRIVATE / ('command-%03d.log' % len(native.read()['commands']))).read_bytes()
        result['error_codes'] = observer.codes(raw[:65537])
        result['immediate_process'] = observer.process(native.PRIVATE, device)
        time.sleep(10)
        result['after_process'] = observer.process(native.PRIVATE, device)
        result['observation_delay_seconds'] = 10
        result['host_stream'] = stream.stop()
        stream = None
        # A short host-only retrospective query covers subscription startup gaps.
        try:
            native.command(['log', 'show', '--last', '2m', '--style', 'ndjson', '--debug', '--info',
                '--predicate', HOST_PREDICATE], 'Read retrospective host signature policy observations', timeout=10, error_details=False)
            result['host_retrospective'] = 'EXIT_ZERO'
        except RuntimeError:
            result['host_retrospective'] = 'NONZERO_OR_TIMEOUT'
        query_path = native.PRIVATE / ('command-%03d.log' % len(native.read()['commands']))
        with stream_path.open('ab') as target:
            target.write(b'\nHOST_RETROSPECTIVE_LAST_2M_NOT_WINDOW_ATTESTATION\n')
            with query_path.open('rb') as query:
                query.seek(max(0, query_path.stat().st_size - 1024 * 1024))
                target.write(query.read(1024 * 1024))
        if stream_path.stat().st_size > debug.MAX_LOG:
            tail = stream_path.read_bytes()[-debug.MAX_LOG:]
            stream_path.write_bytes(tail)
        result['owned_crashes'] = debug.crash_reasons(native.PRIVATE, device, 'hexa_keeper_dev', started, time.time())
        result['scope'] = 'OS_REQUEST_AND_OWNED_PROCESS_ONLY_NO_UI_KEYCHAIN_HEALTH_OR_NATIVE_ACCEPTANCE'
        result['observation_complete'] = True
        result['phase'] = 'OBSERVED'
    except Exception as error:
        result['setup_error_type'] = type(error).__name__
    finally:
        if stream is not None:
            try:
                result['host_stream'] = stream.stop()
            except Exception:
                result['cleanup_errors'].append('host_stream')
        if device:
            for action in ('shutdown', 'delete'):
                try:
                    subprocess.run(['xcrun', 'simctl', action, device], stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL, timeout=30, check=True)
                except Exception:
                    result['cleanup_errors'].append(action)
        result['capture_started_epoch'] = started
        result['launch_ended_epoch'] = ended
        result['observed_artifact'] = native.read().get('built_artifact')
        result['static_signature'] = native.read().get('toolchain', {}).get('ios_simulator_signature')
        state = native.read()
        result['commands'] = state['commands']
        result['installed_artifact_verified'] = state.get('installed_artifact_verified', False)
        result['installed_artifact'] = state.get('installed_artifact')
        stream_result = result.get('host_stream', {})
        for field in ('drain_failed', 'cleanup_failed'):
            if stream_result.get(field):
                result['cleanup_errors'].append('host_stream_' + field)
        if stream_result.get('initial_exit_code') is not None:
            result['cleanup_errors'].append('host_stream_exited_before_observation')
        if result['cleanup_errors']:
            result['observation_complete'] = False
    return result


def main():
    os.umask(0o077)
    debug = module('ios_launch_debug')
    native = debug.load_native()
    require_private_job(native)
    if native.platform.machine() != 'arm64':
        raise ValueError('The comparison requires the reviewed ARM host.')
    # Infrastructure-only successors may reuse this exact compiled app.
    changed = subprocess.run(['git', 'diff', '--exit-code', SOURCE, 'HEAD', '--', '.', ':(exclude).github'],
        cwd=native.ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    if changed.returncode:
        raise ValueError('App source differs from the preserved native build.')
    output = native.ROOT / 'artifacts/private-ios-launch-debug'
    output.mkdir(parents=True, mode=0o700)
    base = native.PRIVATE / 'signature-comparison'
    base.mkdir(parents=True, mode=0o700)
    result = metadata()
    debug.write_json(output / 'native-metadata.json', result)
    variants = []
    try:
        input_zip = Path(os.environ['RUNNER_TEMP']) / 'keeper-original-ios-app.zip'
        observer = module('ios_direct_launch_observation')
        for name in ('original', 'complete_nested'):
            variants.append(compare_variant(name, base, output, input_zip, debug, observer))
    finally:
        debug.write_json(output / 'summary.json', {'state': 'SIGNATURE_COMPARISON_ONLY',
            'original_build': result['original_build'], 'variants': variants,
            'entitlement_policy': 'UNCHANGED_EXISTING_SIMULATOR_POLICY', 'native_acceptance': False,
            'original_ddcd_smoke': 'FAIL_PRESERVED', 'metro_ui_keychain_and_r5': 'NOT_RUN'})
    if len(variants) != 2 or any(not value['observation_complete'] or value['cleanup_errors'] for value in variants):
        raise RuntimeError('Signature comparison was incomplete; inspect per-variant phase and outcome.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Private signature comparison failed; inspect the scoped retained evidence.')
        raise SystemExit(1) from None
