"""Controlled stale/empty native Realm histories, followed by ordinary app login.

This companion is deliberately separate from first-wallet measurements. The
runner owns Metro/app switching, the exact installed artifact, and the device.
Fixture entries change VersionHistory only; normal index.js performs observation.
"""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess

PHASES = (
    'history_seed_stale', 'stale_first_ui', 'history_verify_stale_first',
    'stale_repeat_ui', 'history_verify_stale_repeat', 'history_seed_empty',
    'empty_first_ui', 'history_verify_empty_first', 'empty_repeat_ui',
    'history_verify_empty_repeat', 'history_restore', 'history_verify_restored',
)


def run_companion(h, data, device, private, backend_receipt, switch_entrypoint):
    if (os.environ.get('GITHUB_ACTIONS') != 'true' or
            os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted' or
            h.PLATFORM not in ['IOS', 'ANDROID'] or
            (h.PLATFORM == 'ANDROID' and not device.startswith('emulator-'))):
        raise RuntimeError('PRODUCT_HISTORY_OWNED_HOSTED_DEVICE_REQUIRED')
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=h.ROOT, text=True).strip()
    if (data['build'] != 'PASS' or actual != data['source_sha'] or
            actual != os.environ.get('KEEPER_SOURCE_SHA') or
            h.artifact_identity() != data['built_artifact']):
        raise RuntimeError('PRODUCT_HISTORY_EXACT_BUILD_REQUIRED')
    if subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--', '.github/native', 'src',
                       'index.js', 'App.tsx', 'metro.config.js', 'babel.config.js', 'release/version.json'],
                      cwd=h.ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        raise RuntimeError('PRODUCT_HISTORY_COMMITTED_SOURCE_REQUIRED')
    before = backend_receipt.snapshot(passed=True)
    if (before.get('status') != 'PASS' or before.get('sample') != 6 or
            before.get('scenario') != 'CONTROLLED_DISCONNECT_BEFORE_COMMIT_NOT_WAN_OFFLINE' or
            before.get('create_new_app_calls') != 2 or
            before.get('visible_wallet_count_after_relaunch') != 1):
        raise RuntimeError('PRODUCT_HISTORY_DISPOSABLE_RETRY_FIXTURE_REQUIRED')
    spec = importlib.util.spec_from_file_location(
        'product_key_acceptance', Path(__file__).with_name('product_key_acceptance.py'))
    key_ui = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(key_ui)
    measure_spec = importlib.util.spec_from_file_location(
        'product_measurements', Path(__file__).with_name('product_measurements.py'))
    measurements = importlib.util.module_from_spec(measure_spec)
    measure_spec.loader.exec_module(measurements)
    import json
    expected = measurements.version_expectation(
        json.loads((h.ROOT / 'release/version.json').read_text()), h.PLATFORM)
    output = Path(private) / 'history-ui'
    output.mkdir(mode=0o700)
    result = {'status': 'RUNNING', 'completed_stages': [], 'stage_evidence': [],
              'scenario': 'CONTROLLED_STALE_AND_EMPTY_NATIVE_VERSION_HISTORY',
              'product_entrypoint': 'index.js', 'network': 'TESTNET',
              'fixture_scope': 'Actual encrypted native Realm histories only; unchanged KeeperApp and shared version. Not an authentic historical installation or migration test.',
              'credentials_exported': False, 'physical_devices': 'NOT RUN',
              'performance_sample': False}

    def save():
        state = h.read()
        state['product_version_history_ui'] = result
        h.save(state)

    try:
        save()
        installed = key_ui.installed_proof(h, device)
        for stage in PHASES:
            fixture = stage.startswith('history_')
            switch_entrypoint(stage if fixture else 'product')
            if key_ui.installed_proof(h, device) != installed:
                raise RuntimeError('PRODUCT_HISTORY_INSTALLED_BYTES_CHANGED')
            flow = 'history_fixture.yaml' if fixture else 'history_product.yaml'
            args = [data['maestro']['binary'], '--device', device, 'test',
                    '--env', 'APP_ID=' + h.APP_IDS[h.PLATFORM]]
            if fixture:
                args += ['--env', 'EXPECTED_FIXTURE_ID=history-fixture-' + stage[8:] + '-pass']
            else:
                args += ['--env', 'EXPECTED_INSTALLED_REGEX=' + expected['installed_regex'],
                         '--env', 'EXPECTED_HISTORY_REGEX=' + expected['history_regex']]
            report = output / 'junit.xml'
            report.unlink(missing_ok=True)
            args += ['--flatten-debug-output', '--debug-output', str(output),
                     '--test-output-dir', str(output), '--format', 'junit', '--output', str(report),
                     '.github/native/' + flow]
            h.command(args, 'Native controlled history fixture' if fixture else
                      'Normal cold-login current history observation', timeout=300, error_details=False)
            h.successful_junit(report)
            if (h.artifact_identity() != data['built_artifact'] or
                    key_ui.installed_proof(h, device) != installed):
                raise RuntimeError('PRODUCT_HISTORY_EXACT_INSTALLED_ARTIFACT_CHANGED')
            result['completed_stages'].append(stage)
            result['stage_evidence'].append({'stage': stage, 'status': 'PASS',
                'installed_artifact_verified': True, 'installed_artifact': installed})
            save()
            # Never retain UI hierarchy, PIN input, app ID or screenshot output.
            shutil.rmtree(output)
            output.mkdir(mode=0o700)
        after = backend_receipt.snapshot(passed=True)
        if after['create_new_app_calls'] != before['create_new_app_calls']:
            raise RuntimeError('PRODUCT_HISTORY_UNEXPECTED_ACCOUNT_SETUP')
        switch_entrypoint('product')
        if (h.artifact_identity() != data['built_artifact'] or
                key_ui.installed_proof(h, device) != installed):
            raise RuntimeError('PRODUCT_HISTORY_FINAL_INSTALLED_ARTIFACT_CHANGED')
        result.update(status='PASS', original_history_restored=True,
                      stale_initial_and_recovery_dates_preserved=True,
                      stale_current_observation_count=1, empty_current_observation_count=1,
                      repeat_login_observation_date_unchanged=True,
                      account_version_unchanged=True, visible_wallet_count=1,
                      new_account_requests_during_history_flow=0,
                      installed_artifact_verified=True, installed_artifact=installed)
    except Exception as error:
        result['status'] = 'FAIL'
        result['failure_category'] = type(error).__name__
        raise
    finally:
        key_ui.finalize_companion(result, save,
            [('private-output', lambda: shutil.rmtree(output))], 'failure_category' in result,
            'PRODUCT_HISTORY_CLEANUP_FAILED')
    return result
