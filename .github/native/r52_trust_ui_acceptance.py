"""Normal product trust UI companion, only on the product runner's disposable app.

No standalone device selector, app setters, account/key export or native PASS from
host contracts. Fixture server, native persisted row and actual UI must all agree.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

STAGES = ['baseline', 'custom_saved', 'failed_update_preserved', 'cold_reopen',
          'disconnected', 'reconnected', 'untrusted_peer_rejected', 'selfsigned_saved',
          'fixture_nodes_removed']


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def validate_receipt(value, config, platform):
    if (value.get('schema') != 1 or value.get('nonce') != config['nonce'] or
            value.get('platform') != platform or value.get('status') != 'PASS' or
            value.get('scope') != 'ACTUAL_NORMAL_PRODUCT_UI_WITH_READ_ONLY_NATIVE_REALM_OBSERVER' or
            [s.get('stage') for s in value.get('stages', [])] != STAGES or
            any(s.get('status') != 'PASS' for s in value['stages'])):
        raise RuntimeError('TRUST_UI_COMPLETE_NATIVE_RECEIPT_REQUIRED')
    return value


def run_companion(h, data, device, private, backend_receipt, switch_entrypoint):
    if (os.environ.get('GITHUB_ACTIONS') != 'true' or
            os.environ.get('GITHUB_REPOSITORY') != 'KeeperCommunity/bitcoin-keeper-private' or
            os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted' or
            h.PLATFORM not in ('IOS', 'ANDROID') or
            (h.PLATFORM == 'ANDROID' and not re.fullmatch('emulator-[0-9]+', device))):
        raise RuntimeError('TRUST_UI_PRIVATE_OWNED_HOSTED_DEVICE_REQUIRED')
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=h.ROOT, text=True).strip()
    if (data.get('build') != 'PASS' or data.get('smoke') != 'PASS' or
            source != data['source_sha'] or source != os.environ.get('KEEPER_SOURCE_SHA') or
            h.artifact_identity() != data['built_artifact']):
        raise RuntimeError('TRUST_UI_EXACT_APP_STARTUP_REQUIRED')
    if subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--', '.github/native', 'src', 'tests/electrum',
                       'index.js', 'App.tsx', 'metro.config.js', 'babel.config.js', 'package.json', 'yarn.lock'],
                      cwd=h.ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        raise RuntimeError('TRUST_UI_COMMITTED_SOURCE_REQUIRED')
    before = backend_receipt.snapshot(passed=True)
    if (before.get('status') != 'PASS' or before.get('sample') != 6 or
            before.get('scenario') != 'CONTROLLED_DISCONNECT_BEFORE_COMMIT_NOT_WAN_OFFLINE' or
            before.get('create_new_app_calls') != 2 or before.get('visible_wallet_count_after_relaunch') != 1):
        raise RuntimeError('TRUST_UI_DISPOSABLE_PRODUCT_FIXTURE_REQUIRED')
    key_ui, tls = module('product_key_acceptance'), module('r52_tls_native')
    generated = h.ROOT / '.github/native/.generated/r52_trust_ui.json'
    if generated.exists() or generated.is_symlink():
        raise RuntimeError('TRUST_UI_STALE_CONFIG')
    output = Path(private) / 'trust-ui'
    output.mkdir(mode=0o700)
    fixture = None
    result = {'status': 'RUNNING', 'source_sha': source, 'platform': h.PLATFORM,
              'product_entrypoint': 'index.js', 'development_observer': 'r52_trust_observer.js',
              'scope': 'NORMAL_PRODUCT_TRUST_UI_AND_NATIVE_REALM_READBACK', 'full_r52_acceptance': False,
              'not_run': ['109to110 historical app upgrade', 'Automatic failover', 'Actual Tor provider',
                          'Physical devices', 'Synthetic loopback sync fee and fake broadcast through app caller']}

    def save():
        state = h.read()
        state['r52_trust_ui'] = result
        h.save(state)

    try:
        save()
        installed = key_ui.installed_proof(h, device)
        with (output / 'fixture.log').open('w') as log:
            fixture = subprocess.Popen(['node', '.github/native/r52_trust_ui_fixture.cjs', h.PLATFORM],
                cwd=h.ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True)
        ready = tls.receive(fixture)
        raw = generated.read_bytes()
        config = json.loads(raw)
        if (len(raw) > 16384 or hashlib.sha256(raw).hexdigest() != ready.get('sha256') or
                ready.get('ready') is not True or ready.get('http_port') != 8768 or
                not re.fullmatch('[a-f0-9]{48}', ready.get('metric_token', '')) or
                ready.get('ports') != [config['a']['port'], config['b']['port'], config['c']['port']] or
                config.get('platform') != h.PLATFORM or config.get('schema') != 1 or
                not re.fullmatch('[a-f0-9]{48}', config.get('nonce', ''))):
            raise RuntimeError('TRUST_UI_CONFIG_BINDING')
        h.reverse_trust_loopback(config)
        switch_entrypoint('trust')
        report = output / 'junit.xml'
        args = [data['maestro']['binary'], '--device', device, 'test', '--env', 'APP_ID=' + h.APP_IDS[h.PLATFORM],
                '--env', 'METRIC_TOKEN=' + ready['metric_token'], '--env', 'PORT_A=' + str(config['a']['port']),
                '--env', 'PORT_B=' + str(config['b']['port']), '--env', 'CA_A=' + config['a']['ca'],
                '--env', 'PORT_C=' + str(config['c']['port']), '--env', 'CA_C=' + config['c']['ca'],
                '--flatten-debug-output', '--debug-output', str(output),
                '--test-output-dir', str(output), '--format', 'junit', '--output', str(report),
                '.github/native/r52_trust_ui.yaml']
        h.command(args, 'Normal trust UI probe save cold reopen and reconnect', timeout=720, error_details=False)
        h.successful_junit(report)
        fixture.stdin.write('snapshot\n')
        fixture.stdin.flush()
        result['native_evidence'] = validate_receipt(tls.receive(fixture), config, h.PLATFORM)
        if h.artifact_identity() != data['built_artifact'] or key_ui.installed_proof(h, device) != installed:
            raise RuntimeError('TRUST_UI_INSTALLED_ARTIFACT_CHANGED')
        if backend_receipt.snapshot(passed=True)['create_new_app_calls'] != before['create_new_app_calls']:
            raise RuntimeError('TRUST_UI_ACCOUNT_CHANGED')
        switch_entrypoint('product')
        result.update(status='PASS', installed_artifact=installed, installed_artifact_verified=True,
                      fixture_nodes_removed_by_product_ui=True, configuration_sha256=ready['sha256'])
    except Exception as error:
        result.update(status='FAIL', failure_category=type(error).__name__)
        raise
    finally:
        def close():
            if fixture is not None:
                try:
                    tls.close_fixture(fixture)
                finally:
                    if fixture.poll() is None:
                        fixture.kill()
                        fixture.wait(timeout=10)
            if generated.exists():
                raise RuntimeError('TRUST_UI_CONFIG_CLEANUP_UNVERIFIED')
        key_ui.finalize_companion(result, save, [('fixture-keys-and-config', close),
            ('private-ui-output', lambda: shutil.rmtree(output))], 'failure_category' in result,
            'TRUST_UI_CLEANUP_FAILED')
    return result
