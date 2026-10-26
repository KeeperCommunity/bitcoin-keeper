"""One fresh private simulator build, checkpointed before any runtime diagnostic."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys

LABEL = 'keeper/ios-fresh-runtime'
APP_REFERENCE = '84084981f66082c6d3d533e191d8270b81b842cf'
APP_REFERENCE_TREE = 'c1104c1b30a65f86c0ecc967744a84ce2cedf585'
# All 2398 tracked entries outside .github, including native projects and locks.
APP_INPUTS_SHA256 = '6ebdde4926571c663600861acf714a25d38163d1eb23704228834092909b1529'
SCOPE = 'FRESH_PRIVATE_SIMULATOR_BUILD_CURRENT_CONTROLLER_NO_RELEASE_ACCEPTANCE'
OVERLAYS = {'.env.ci', 'firebase.json', 'ios/GoogleService-Info.plist',
            'ios/GoogleServices/dev/GoogleService-Info.plist'}


def module(name):
    spec = importlib.util.spec_from_file_location('fresh_ios_' + name, Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def require(value):
    if not value:
        raise RuntimeError('Fresh private iOS diagnostic rejected.')


def require_selection(native):
    env = os.environ
    require(all(env.get(k) == v for k, v in {'GITHUB_ACTIONS': 'true',
        'RUNNER_ENVIRONMENT': 'github-hosted', 'GITHUB_REPOSITORY': 'KeeperCommunity/bitcoin-keeper-private',
        'GITHUB_REPOSITORY_ID': '839671816', 'GITHUB_EVENT_NAME': 'pull_request',
        'GITHUB_RUN_ATTEMPT': '1', 'KEEPER_PRIVATE_IOS_FRESH_RUNTIME': '1'}.items()))
    event = module('ios_signature_comparison').strict_json(Path(env['GITHUB_EVENT_PATH']).read_bytes())
    require(native.PLATFORM == 'IOS' and native.platform.machine() == 'arm64' and
        event['repository']['id'] == 839671816 and event['repository']['private'] is True and
        event['pull_request']['head']['repo']['id'] == 839671816 and
        event['pull_request']['head']['sha'] == env['KEEPER_SOURCE_SHA'] and
        event['action'] == 'labeled' and event['label']['name'] == LABEL)
    require(re.fullmatch('[a-f0-9]{40}', env['KEEPER_SOURCE_SHA']) and
        subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=native.ROOT, text=True).strip() == env['KEEPER_SOURCE_SHA'])
    entries = subprocess.check_output(['git', '--no-replace-objects', 'ls-tree', '-rz', 'HEAD'], cwd=native.ROOT).split(b'\0')
    app = [row for row in entries if row and not row.split(b'\t', 1)[1].startswith(b'.github/')]
    require(hashlib.sha256(b'\0'.join(app) + b'\0').hexdigest() == APP_INPUTS_SHA256)


def require_state(native):
    data = native.read()
    require(data.get('source_sha') == os.environ['KEEPER_SOURCE_SHA'] and
        data.get('run_id') == os.environ['GITHUB_RUN_ID'] and data.get('run_attempt') == '1' and
        data.get('workflow_sha') == os.environ['GITHUB_WORKFLOW_SHA'] and
        data.get('build_execution_scope') == SCOPE and data.get('native_acceptance') is False)
    return data


def source_bytes(native, prepared=True):
    """Reuse the reviewed owned-file reader; Git index flags cannot hide edits."""
    reader = module('android_apk_checkpoint')
    data = require_state(native)
    hashes = {}
    if prepared:
        overlays = data.get('configuration_overlays', [])
        require(len(overlays) == 4 and {row['path'] for row in overlays} == OVERLAYS)
        hashes = {row['path']: row['sha256'] for row in overlays}
    base = reader.directory(native.ROOT)
    try:
        for path, digest in hashes.items():
            require(reader.read_file(base, path, 1024 * 1024)['sha256'] == digest)
        entries = reader.git(native.ROOT, 'ls-tree', '-rz', 'HEAD').split(b'\0')
        for entry in entries:
            if not entry:
                continue
            header, raw_path = entry.split(b'\t', 1)
            mode, kind, blob = header.split()
            path = raw_path.decode()
            require(kind == b'blob' and mode in (b'100644', b'100755'))
            if path in hashes:
                continue
            observed = reader.read_file(base, path, 64 * 1024 * 1024, minimum=0)
            require(observed['executable'] == (mode == b'100755'))
            if path == 'package.json' and prepared:
                original = reader.git(native.ROOT, 'cat-file', 'blob', blob.decode())
                overlay = data.get('nodeify_overlay', {})
                require(overlay.get('path') == path and overlay.get('allowed_fields') == ['browser', 'react-native', 'browserify'] and
                    overlay.get('before_sha256') == hashlib.sha256(original).hexdigest() and overlay.get('after_sha256') == observed['sha256'])
                before, after = reader.json_document(original), reader.json_document(observed['bytes'])
                for name in overlay['allowed_fields']:
                    before.pop(name, None); after.pop(name, None)
                require(json.dumps(before, sort_keys=True) == json.dumps(after, sort_keys=True))
            else:
                require(observed['git_blob'] == blob.decode())
    finally:
        os.close(base)
    # Reject untracked source overrides; generated dependency/build directories
    # remain governed by the existing immutable dependency and artifact checks.
    extra = reader.git(native.ROOT, 'ls-files', '--others', '--exclude-standard', '--',
                       'src', 'ios', 'android', 'patches', '.github/native', 'App.*',
                       'index.*', 'shim.*', 'metro.config.*', 'babel.config.*', 'react-native.config.*')
    require(all(re.fullmatch(r'\.github/native/__pycache__/[A-Za-z0-9_]+\.cpython-[0-9]+\.pyc', name)
                for name in extra.decode().splitlines()))


def checkpoint(native):
    data = require_state(native)
    require(data.get('build') == 'PASS' and native.artifact_identity() == data.get('built_artifact'))
    source_bytes(native)
    comparison = module('ios_signature_comparison')
    proof = module('ios_retained_runtime').require_policy()
    policy = comparison.entitlement_policy(proof['policy'])
    require(policy == {})
    comparison.resign_outer_for_comparison(native, policy)
    app = native.PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
    raw = native.command(['codesign', '--display', '--entitlements', ':-', str(app)],
        'Verify fresh diagnostic empty entitlements', capture=True, error_details=False)
    start, end = raw.find('<?xml'), raw.find('</plist>')
    require(start >= 0 and end >= start and plistlib.loads(raw[start:end + 8].encode()) == {})
    signature = native.command(['codesign', '--display', '--verbose=4', str(app)],
        'Verify fresh ad-hoc signature without signing identity', capture=True, error_details=False)
    require('Signature=adhoc' in signature.splitlines() and not any(row.startswith('Authority=') for row in signature.splitlines()))
    data = native.read()
    data['toolchain']['ios_simulator_signature'].update(verified=True,
        entitlements_sha256=hashlib.sha256(plistlib.dumps(policy, sort_keys=True)).hexdigest(),
        entitlement_policy='REVIEWED_PRIVATE_DIAGNOSTIC_EMPTY_ENTITLEMENTS_OS_LAUNCH_ONLY',
        keychain_behavior='NOT_YET_TESTED')
    data.update(built_artifact=native.artifact_identity(), fresh_policy='PASS',
        historical_policy_reference=proof, fresh_checkpoint='INCOMPLETE')
    native.save(data)
    # This existing producer writes a NEW manifest containing actual current
    # source/tree/run, tar/app hashes and toolchain digest. No old app is reused.
    module('ios_launch_debug').retain(native)
    data = native.read(); data['fresh_checkpoint'] = 'PASS'; native.save(data)


def require_runtime(native, suite):
    data = require_state(native)
    source_bytes(native)
    require(data.get('build') == 'PASS' and data.get('fresh_policy') == 'PASS' and
        data.get('fresh_checkpoint') == 'PASS' and data.get('fresh_checkpoint_uploaded') == 'PASS' and
        native.artifact_identity() == data.get('built_artifact'))
    if suite not in ('direct_keychain', 'startup'):
        require(data.get('smoke') == 'PASS')
    if suite in ('probe', 'features'):
        require(data.get('native_keychain') == 'PASS')
    if suite == 'features':
        require(data.get('native_probe') == 'PASS')


def run_suite(native, suite):
    require(suite in ('direct_keychain', 'startup', 'keychain', 'probe', 'features'))
    require_runtime(native, suite)
    if suite == 'direct_keychain':
        return module('ios_keychain_direct').run(native)
    key = {'startup': 'smoke', 'keychain': 'native_keychain', 'probe': 'native_probe', 'features': 'r5_features'}[suite]
    command = native.command
    try:
        if suite == 'startup':
            driver = module('ios_retained_driver_observation')
            native.command = lambda args, label, **kwargs: driver.observe(native, command, args, label, **kwargs)
            native.smoke(debug_session=module('ios_launch_debug').Session(native))
        else:
            native.smoke(suite)
    except Exception:
        data = native.read(); data[key] = 'FAIL'; native.save(data)
        raise
    finally:
        native.command = command


def retain(native):
    output = native.ROOT / 'artifacts/private-ios-fresh-runtime'
    output.mkdir(parents=True, mode=0o700, exist_ok=True)
    if native.EVIDENCE.is_file():
        require(native.EVIDENCE.stat().st_size <= 4 * 1024 * 1024)
        shutil.copyfile(native.EVIDENCE, output / 'native-metadata.json')
        data = native.read()
        if data.get('build') == 'FAIL':
            module('ios_launch_debug').retain_build_failure(native, data, output)
        print('KEEPER_FRESH_IOS_SUMMARY=' + json.dumps({key: data.get(key) for key in
            ('source_sha', 'build', 'fresh_policy', 'fresh_checkpoint', 'fresh_checkpoint_uploaded',
             'smoke', 'native_keychain', 'native_probe', 'r5_features', 'direct_keychain_diagnostic',
             'retained_live_driver_observation', 'native_acceptance')}, sort_keys=True))
    for name in ('simulator-launch.log', 'host-simulator.log', 'original-launch-error.json', 'owned-crash-reasons.json', 'summary.json'):
        source = native.PRIVATE / 'ios-launch-debug' / name
        if source.is_file() and not source.is_symlink() and source.stat().st_size <= 2 * 1024 * 1024:
            shutil.copyfile(source, output / name)


def main(phase):
    os.umask(0o077)
    native = module('ios_launch_debug').load_native()
    require_selection(native)
    if phase == 'verify':
        return
    os.environ.update(ENVFILE='.env.ci', RCT_NO_LAUNCH_PACKAGER='1', RCT_NEW_ARCH_ENABLED='1', MAESTRO_CLI_NO_ANALYTICS='1')
    if phase == 'retain':
        return retain(native)
    if phase == 'record':
        native.record()
        data = native.read(); data.update(native_acceptance=False, build_execution_scope=SCOPE,
            reviewed_app_input_source_sha=APP_REFERENCE, reviewed_app_input_tree=APP_REFERENCE_TREE,
            app_inputs_sha256=APP_INPUTS_SHA256, compiled_app_source_sha=os.environ['KEEPER_SOURCE_SHA'])
        native.save(data)
        return
    data = require_state(native)
    if phase == 'prepare':
        source_bytes(native, prepared=False)
        native.prepare()
        source_bytes(native)
    elif phase == 'build':
        require(data.get('build') == 'NOT RUN')
        source_bytes(native)
        native.run_phase('build')
    elif phase == 'checkpoint':
        checkpoint(native)
    elif phase == 'uploaded':
        require(data.get('fresh_checkpoint') == 'PASS' and re.fullmatch('[1-9][0-9]{0,19}', os.environ.get('KEEPER_FRESH_ARTIFACT_ID', '')) and
                re.fullmatch('[a-f0-9]{64}', os.environ.get('KEEPER_FRESH_ARTIFACT_DIGEST', '')))
        data.update(fresh_checkpoint_uploaded='PASS', fresh_checkpoint_artifact={
            'id': os.environ['KEEPER_FRESH_ARTIFACT_ID'], 'archive_sha256': os.environ['KEEPER_FRESH_ARTIFACT_DIGEST'],
            'source_sha': os.environ['KEEPER_SOURCE_SHA'], 'run_id': os.environ['GITHUB_RUN_ID'], 'run_attempt': 1})
        native.save(data)
    else:
        run_suite(native, phase)


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 2)
        main(sys.argv[1])
    except Exception:
        print('Private fresh iOS phase failed; inspect source-qualified bounded evidence.')
        raise SystemExit(1) from None
