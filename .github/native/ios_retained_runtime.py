"""Private runtime continuation over one preserved app; never compile Keeper."""
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

LABEL = 'keeper/ios-retained-runtime'
SCOPE = 'REUSED_ORIGINAL_APP_NO_CURRENT_COMPILATION'
# Actual bounded OS launch evidence only. The overall comparison failed because
# its teamless control never completed simulator setup. UI/Keychain remain untested.
# These pins admit a disposable diagnostic, never a default or release policy.
POLICY_PROOF = {
    'schema': 1, 'repository_id': 839671816,
    'controller_source_sha': 'a13807473f4072236e9eb71bfb40ee4d1dec6f1a',
    'run_id': 40282251540, 'run_attempt': 1, 'job_id': 121437916024,
    'workflow_sha': '8ec748c5942356fc9312745779b98534eb2ecff4',
    'artifact_id': 12633406300,
    'artifact_zip_sha256': '971dc3e104d11820d42f479305980262ef2bd935d932fb8deced4b05a1f3c67d',
    'policy': 'empty_entitlements', 'launch_request': 'ACCEPTED',
    'process_after_10_seconds': 'OWNED_RUNNING_ENTRY_OBSERVED',
    'effective_entitlements_sha256': '97704a8960b4facceef54397a08fb5d0a456247c3627359215aa2a27df22656c',
    'observed_executable_sha256': 'e72183894698157804476a121e28f09655354ac0d6b06a74188a17032d6ef76f',
    'observed_bundle_tree_sha256': '62fc7ca394a287589c6076b071f6dcb869e76c547017c8e43a1f65004531b1c4',
    'comparison_run_conclusion': 'failure', 'comparison_job_conclusion': 'failure',
    'eligibility_scope': 'CONTROL_SIMULATOR_SETUP_FAILED_ELIGIBLE_VARIANT_OBSERVATION_COMPLETE',
    'qualification': 'OS_LAUNCH_AND_PROCESS_ONLY_UI_KEYCHAIN_NOT_RUN',
    'installed_artifact_verified': True, 'observation_complete': True,
    'owned_crash_count': 0, 'cleanup_complete': True, 'native_acceptance': False,
}


def module(name):
    spec = importlib.util.spec_from_file_location('retained_runtime_' + name,
        Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def require_policy():
    if POLICY_PROOF is None:
        raise RuntimeError('RETAINED_RUNTIME_POLICY_NOT_YET_PROVEN')
    # Actual result identity is committed with the policy, never supplied by a label
    # or environment variable. These pins select the one reviewed experiment.
    fixed = {'schema': 1, 'repository_id': 839671816,
        'controller_source_sha': 'a13807473f4072236e9eb71bfb40ee4d1dec6f1a',
        'run_id': 40282251540, 'run_attempt': 1, 'job_id': 121437916024,
        'workflow_sha': '8ec748c5942356fc9312745779b98534eb2ecff4',
        'artifact_id': 12633406300,
        'artifact_zip_sha256': '971dc3e104d11820d42f479305980262ef2bd935d932fb8deced4b05a1f3c67d',
        'effective_entitlements_sha256': '97704a8960b4facceef54397a08fb5d0a456247c3627359215aa2a27df22656c',
        'observed_executable_sha256': 'e72183894698157804476a121e28f09655354ac0d6b06a74188a17032d6ef76f',
        'observed_bundle_tree_sha256': '62fc7ca394a287589c6076b071f6dcb869e76c547017c8e43a1f65004531b1c4',
        'policy': 'empty_entitlements',
        'launch_request': 'ACCEPTED',
        'comparison_run_conclusion': 'failure', 'comparison_job_conclusion': 'failure',
        'eligibility_scope': 'CONTROL_SIMULATOR_SETUP_FAILED_ELIGIBLE_VARIANT_OBSERVATION_COMPLETE',
        'qualification': 'OS_LAUNCH_AND_PROCESS_ONLY_UI_KEYCHAIN_NOT_RUN',
        'installed_artifact_verified': True, 'observation_complete': True,
        'owned_crash_count': 0, 'cleanup_complete': True,
        'process_after_10_seconds': 'OWNED_RUNNING_ENTRY_OBSERVED', 'native_acceptance': False}
    if (type(POLICY_PROOF) is not dict or set(POLICY_PROOF) != set(fixed) or
            any(type(POLICY_PROOF.get(key)) is not type(value) or POLICY_PROOF[key] != value
                for key, value in fixed.items())):
        raise RuntimeError('RETAINED_RUNTIME_POLICY_PROOF_INVALID')
    expected_policy_hash = hashlib.sha256(plistlib.dumps(module('ios_signature_comparison').entitlement_policy(
        'empty_entitlements'), sort_keys=True)).hexdigest()
    if POLICY_PROOF['effective_entitlements_sha256'] != expected_policy_hash:
        raise RuntimeError('RETAINED_RUNTIME_POLICY_DIGEST_MISMATCH')
    return POLICY_PROOF


def require_selection(native):
    event = module('ios_signature_comparison').strict_json(Path(os.environ['GITHUB_EVENT_PATH']).read_bytes())
    repo, pr = event.get('repository', {}), event.get('pull_request', {})
    if (os.environ.get('GITHUB_REPOSITORY') != 'KeeperCommunity/bitcoin-keeper-private' or
            os.environ.get('GITHUB_REPOSITORY_ID') != '839671816' or
            os.environ.get('GITHUB_ACTIONS') != 'true' or
            os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted' or
            os.environ.get('KEEPER_PRIVATE_IOS_RETAINED_RUNTIME') != '1' or
            native.PLATFORM != 'IOS' or native.platform.machine() != 'arm64' or
            repo.get('id') != 839671816 or repo.get('private') is not True or
            pr.get('head', {}).get('repo', {}).get('id') != 839671816 or
            pr.get('head', {}).get('sha') != os.environ.get('KEEPER_SOURCE_SHA') or
            event.get('action') != 'labeled' or event.get('label', {}).get('name') != LABEL):
        raise RuntimeError('PRIVATE_RETAINED_RUNTIME_SELECTION_REQUIRED')
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=native.ROOT, text=True).strip()
    if source != os.environ['KEEPER_SOURCE_SHA'] or not re.fullmatch('[a-f0-9]{40}', source):
        raise RuntimeError('RETAINED_RUNTIME_SOURCE_MOVED')
    comparison = module('ios_signature_comparison')
    subprocess.run(['git', 'diff', '--exit-code', comparison.SOURCE, 'HEAD', '--', '.', ':(exclude).github'],
        cwd=native.ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


def qualify(native):
    data = native.read()
    data.update(build='NOT RUN', current_source_compilation='NOT RUN',
        build_execution_scope=SCOPE, native_acceptance=False,
        controller_source_sha=os.environ['KEEPER_SOURCE_SHA'],
        compiled_app_source_sha=module('ios_signature_comparison').SOURCE,
        scope='PRIVATE_REUSED_APP_RUNTIME_DIAGNOSTIC_NOT_CURRENT_BUILD_OR_NATIVE_ACCEPTANCE')
    native.save(data)


def require_state(native):
    data = native.read()
    if (data.get('source_sha') != os.environ['KEEPER_SOURCE_SHA'] or
            data.get('run_id') != os.environ['GITHUB_RUN_ID'] or
            data.get('run_attempt') != os.environ['GITHUB_RUN_ATTEMPT'] or
            data.get('native_acceptance') is not False or data.get('build_execution_scope') != SCOPE):
        raise RuntimeError('RETAINED_RUNTIME_METADATA_MISMATCH')
    return data


def require_worktree(native):
    """Only the existing recorded disposable configuration/nodeify overlays may vary."""
    data = require_state(native)
    overlays = {row['path']: row['sha256'] for row in data.get('configuration_overlays', [])}
    nodeify = data.get('nodeify_overlay')
    if nodeify:
        overlays['package.json'] = nodeify['after_sha256']
    changed = subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=native.ROOT, text=True).splitlines()
    for name in changed:
        if name not in overlays or hashlib.sha256((native.ROOT / name).read_bytes()).hexdigest() != overlays[name]:
            raise RuntimeError('UNRECORDED_RUNTIME_SOURCE_CHANGE')


def read_build_proof():
    proof = module('ios_signature_comparison').strict_json(
        (Path(os.environ['RUNNER_TEMP']) / 'keeper-original-ios-build-proof.json').read_bytes())
    fixed = {'schema': 1, 'repository_id': 839671816,
        'source_sha': 'ddcd0970f80e23adf86a093cf3eebf8ad363cec9', 'run_id': 40189694110,
        'run_attempt': 1, 'job_id': 121157855365, 'artifact_id': 12598443612,
        'artifact_zip_sha256': 'fd1f27948a19811ecd9c80a6fe0a400a290766fbdaa5b55ef5eaa02b1224db37',
        'native_acceptance': False}
    if any(type(proof.get(key)) is not type(value) or proof[key] != value for key, value in fixed.items()):
        raise RuntimeError('ORIGINAL_BUILD_API_PROOF_MISMATCH')
    step = proof.get('build_step', {})
    if (step.get('name') != 'Build simulator app once' or step.get('status') != 'completed' or
            step.get('conclusion') != 'success' or not step.get('started_at') or not step.get('completed_at')):
        raise RuntimeError('ORIGINAL_BUILD_STEP_NOT_SUCCESSFUL')
    return proof


def record(native):
    api_proof = read_build_proof()
    try:
        native.record()
    finally:
        if native.EVIDENCE.is_file():
            data = native.read()
            data['original_build'] = {**module('ios_signature_comparison').metadata()['original_build'],
                'api_build_step_proof': api_proof, 'build': 'PASS', 'original_smoke': 'FAIL_PRESERVED'}
            native.save(data)


def restore_app(native):
    policy_proof = require_policy()
    data = require_state(native)
    if data.get('retained_runtime_dependencies') != 'PASS':
        raise RuntimeError('RETAINED_RUNTIME_DEPENDENCIES_REQUIRED')
    require_worktree(native)
    api_proof = read_build_proof()
    comparison = module('ios_signature_comparison')
    manifest = comparison.restore(native, Path(os.environ['RUNNER_TEMP']) / 'keeper-original-ios-app.zip')
    data = native.read()
    data.update(original_build={**comparison.metadata()['original_build'], 'api_build_step_proof': api_proof,
        'build': 'PASS', 'original_manifest': manifest, 'original_smoke': 'FAIL_PRESERVED'},
        reused_original_build='PASS', retained_runtime_restore='INCOMPLETE')
    native.save(data)
    native.sign_simulator_app()
    policy = comparison.entitlement_policy(policy_proof['policy'])
    comparison.resign_outer_for_comparison(native, policy)
    app = native.PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
    raw = native.command(['codesign', '--display', '--entitlements', ':-', str(app)],
        'Verify exact proven retained-runtime entitlements', capture=True, error_details=False)
    start, end = raw.find('<?xml'), raw.find('</plist>')
    if start < 0 or end < start or plistlib.loads(raw[start:end + len('</plist>')].encode()) != policy:
        raise RuntimeError('RETAINED_RUNTIME_EFFECTIVE_POLICY_MISMATCH')
    policy_hash = hashlib.sha256(plistlib.dumps(policy, sort_keys=True)).hexdigest()
    if policy_hash != policy_proof['effective_entitlements_sha256']:
        raise RuntimeError('RETAINED_RUNTIME_POLICY_DIGEST_MISMATCH')
    observed = native.artifact_identity()
    if (observed['executable_sha256'] != policy_proof['observed_executable_sha256'] or
            observed['bundle_tree_sha256'] != policy_proof['observed_bundle_tree_sha256']):
        raise RuntimeError('REPRODUCED_SIGNED_APP_DIFFERS_FROM_PROVEN_APP')
    data = native.read()
    data['toolchain']['ios_simulator_signature'].update(verified=True, entitlements_sha256=policy_hash,
        entitlement_policy='REVIEWED_PRIVATE_DIAGNOSTIC_EMPTY_ENTITLEMENTS_OS_LAUNCH_ONLY',
        keychain_behavior='NOT_YET_TESTED')
    data.update(retained_runtime_policy_proof=policy_proof,
        built_artifact=observed, retained_runtime_restore='PASS')
    native.save(data)


def run_suite(native, suite):
    data = require_state(native)
    require_worktree(native)
    if (data.get('retained_runtime_restore') != 'PASS' or data.get('reused_original_build') != 'PASS' or
            data.get('retained_runtime_policy_proof') != require_policy() or
            native.artifact_identity() != data.get('built_artifact')):
        raise RuntimeError('EXACT_RESTORED_APP_REQUIRED')
    if suite != 'startup' and data.get('smoke') != 'PASS':
        raise RuntimeError('ACTUAL_STARTUP_PASS_REQUIRED')
    if suite in ('probe', 'features') and data.get('native_keychain') != 'PASS':
        raise RuntimeError('ACTUAL_KEYCHAIN_DIAGNOSTIC_PASS_REQUIRED')
    if suite == 'features' and data.get('native_probe') != 'PASS':
        raise RuntimeError('ACTUAL_NATIVE_PROBE_PASS_REQUIRED')
    if suite not in ('startup', 'keychain', 'probe', 'features'):
        raise ValueError('Unknown retained-runtime suite.')
    key = {'startup': 'smoke', 'keychain': 'native_keychain', 'probe': 'native_probe', 'features': 'r5_features'}[suite]
    # The unchanged harness requires an actual successful build. This PASS refers
    # only to the byte-verified original build; it is never exported as a new build.
    data['build'] = 'PASS'
    native.save(data)
    original_command = native.command if suite == 'startup' else None
    try:
        if suite == 'startup':
            driver = module('ios_retained_driver_observation')
            native.command = lambda args, label, **kwargs: driver.observe(
                native, original_command, args, label, **kwargs)
            native.smoke(debug_session=module('ios_launch_debug').Session(native))
        else:
            native.smoke(suite)
    except Exception:
        data = native.read()
        data[key] = 'FAIL'
        native.save(data)
        raise
    finally:
        if original_command is not None:
            native.command = original_command
        qualify(native)


def retain(native):
    output = native.ROOT / 'artifacts/private-ios-retained-runtime'
    output.mkdir(parents=True, mode=0o700)
    if native.EVIDENCE.is_file():
        qualify(native)
        if native.EVIDENCE.stat().st_size > 4 * 1024 * 1024:
            raise RuntimeError('RETAINED_RUNTIME_METADATA_OVERSIZED')
        shutil.copyfile(native.EVIDENCE, output / 'native-metadata.json')
        (output / 'native-metadata.json').chmod(0o600)
    # Only existing scoped startup evidence, never app bytes or data containers.
    for name in ('simulator-launch.log', 'host-simulator.log', 'original-launch-error.json',
                 'owned-crash-reasons.json', 'summary.json'):
        source = native.PRIVATE / 'ios-launch-debug' / name
        if source.is_file() and not source.is_symlink() and source.stat().st_size <= 2 * 1024 * 1024:
            shutil.copyfile(source, output / name)
            (output / name).chmod(0o600)
    print('KEEPER_RETAINED_RUNTIME_SUMMARY=' + json.dumps(project_summary(native), sort_keys=True))
    if native.EVIDENCE.is_file():
        data = native.read()
        for key in ('retained_live_driver_observation', 'direct_keychain_diagnostic'):
            if key in data:
                print('KEEPER_RETAINED_DIAGNOSTIC=' + json.dumps({key: data[key]}, sort_keys=True))


def project_summary(native):
    """Bounded fixed statuses/hashes only; never argv, paths, errors or app data."""
    data = {}
    if native.EVIDENCE.is_file() and native.EVIDENCE.stat().st_size <= 4 * 1024 * 1024:
        data = native.read()
    def digest(value, length=64):
        return value if type(value) is str and re.fullmatch('[a-f0-9]{%d}' % length, value) else None
    def status(value):
        return value if value in ('PASS', 'FAIL', 'NOT RUN', 'INCOMPLETE') else 'UNKNOWN'
    def number(value):
        return value if type(value) is str and re.fullmatch('[1-9][0-9]{0,19}', value) else None
    built = data.get('built_artifact', {})
    installed = data.get('installed_artifact', {})
    signature = data.get('toolchain', {}).get('ios_simulator_signature', {})
    keychain = data.get('native_keychain_evidence', {})
    return {'schema': 1, 'scope': SCOPE, 'native_acceptance': False, 'current_build': 'NOT RUN',
        'signing_policy': 'empty_entitlements',
        'policy_qualification': 'OS_LAUNCH_AND_PROCESS_ONLY_UI_KEYCHAIN_NOT_RUN',
        'comparison_run_id': 40282251540, 'comparison_job_id': 121437916024,
        'comparison_job_conclusion': 'failure',
        'controller_source_sha': digest(data.get('controller_source_sha'), 40),
        'compiled_app_source_sha': module('ios_signature_comparison').SOURCE,
        'workflow_sha': digest(data.get('workflow_sha'), 40),
        'run_id': number(data.get('run_id')), 'run_attempt': number(data.get('run_attempt')),
        'original_build_run_id': 40189694110, 'original_build_job_id': 121157855365,
        'original_build': status(data.get('original_build', {}).get('build')),
        'dependencies': status(data.get('retained_runtime_dependencies')),
        'restore': status(data.get('retained_runtime_restore')), 'startup': status(data.get('smoke')),
        'native_keychain': status(data.get('native_keychain')),
        'direct_keychain_diagnostic': status(data.get('direct_keychain_diagnostic', {}).get('status')),
        'keychain_stage': keychain.get('stage') if keychain.get('stage') in ('seeded', 'updated', 'pass', 'failed', 'unavailable') else 'UNKNOWN',
        'keychain_failure': keychain.get('failure_code') if keychain.get('failure_code') in
            (*module('keychain_evidence').CODES, 'RECEIPT_UNAVAILABLE') else None,
        'keychain_native_code': -34018 if keychain.get('native_code') == -34018 else None,
        'persistence_probe': status(data.get('native_probe')), 'worker_features': status(data.get('r5_features')),
        'effective_entitlements_sha256': digest(signature.get('entitlements_sha256')),
        'observed_executable_sha256': digest(built.get('executable_sha256')),
        'observed_bundle_tree_sha256': digest(built.get('bundle_tree_sha256')),
        'installed_executable_sha256': digest(installed.get('executable_sha256')),
        'installed_inventory_sha256': digest(installed.get('inventory_sha256')),
        'installed_bytes_verified': data.get('installed_artifact_verified') is True,
        'startup_cleanup': 'FAIL' if data.get('startup_cleanup_errors') else
            'PASS' if data.get('smoke') == 'PASS' else 'UNKNOWN'}


def main(phase):
    os.umask(0o077)
    native = module('ios_launch_debug').load_native()
    native.EVIDENCE = native.PRIVATE / 'retained-runtime-metadata.json'
    require_selection(native)
    if phase == 'retain':
        retain(native)
        return
    require_policy()
    if phase == 'verify':
        return
    os.environ.update(ENVFILE='.env.ci', RCT_NO_LAUNCH_PACKAGER='1', RCT_NEW_ARCH_ENABLED='1',
        MAESTRO_CLI_NO_ANALYTICS='1')
    # No phase can accidentally route a Keeper xcodebuild invocation through the
    # harness. Xcode's version query and Maestro's existing driver remain allowed.
    command = native.command
    def no_app_compile(args, *values, **kwargs):
        if args and Path(args[0]).name == 'xcodebuild' and args != ['xcodebuild', '-version']:
            raise RuntimeError('KEEPER_RECOMPILATION_FORBIDDEN')
        return command(args, *values, **kwargs)
    native.command = no_app_compile
    try:
        if phase == 'record':
            record(native)
        elif phase == 'prepare':
            require_worktree(native)
            native.prepare()
            data = native.read()
            data['retained_runtime_dependencies'] = 'PASS'
            native.save(data)
        elif phase == 'restore':
            restore_app(native)
        elif phase == 'direct_keychain':
            data = require_state(native)
            require_worktree(native)
            if (data.get('retained_runtime_restore') != 'PASS' or data.get('reused_original_build') != 'PASS' or
                    data.get('retained_runtime_policy_proof') != require_policy() or
                    native.artifact_identity() != data.get('built_artifact')):
                raise RuntimeError('EXACT_RESTORED_APP_REQUIRED')
            module('ios_keychain_direct').run(native)
        elif phase in ('startup', 'keychain', 'probe', 'features'):
            run_suite(native, phase)
        else:
            raise ValueError('Unknown retained-runtime phase.')
    finally:
        if native.EVIDENCE.is_file():
            qualify(native)


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('One retained-runtime phase required.')
        main(sys.argv[1])
    except Exception:
        print('Private retained-app runtime phase failed; inspect source-qualified private metadata.')
        raise SystemExit(1) from None
