"""Execute actual driver ordering and original warm callback with bounded fake I/O.

No simulator, native Realm binding, app, HTTP server or native acceptance is used.
"""
import ast
import copy
from contextlib import ExitStack
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
NATIVE = ROOT / '.github/native'
SOURCE = 'a' * 40
DEVICE = '12345678-1234-1234-1234-123456789ABC'

def load(name):
    spec = importlib.util.spec_from_file_location(name, NATIVE / (name + '.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

PROFILE = 'OBSERVED_RN_IOS_APP_REQUEST_OPTIONS_FF3CC6'
URL = ('http://127.0.0.1:8081/index.bundle?platform=ios&dev=true&minify=false'
       '&lazy=true&excludeSource=true&modulesOnly=false&runModule=true'
       '&sourcePaths=url-server&app=io.hexawallet.hexakeeper.dev')

class Process:
    def __init__(self):
        self.pid = 918273; self.returncode = None
        self.stdin = io.StringIO(); self.stdout = io.StringIO()
    def poll(self): return self.returncode
    def wait(self, **_options): self.returncode = 0
    def kill(self): self.returncode = -9

class PredeviceWarm(unittest.TestCase):
    def exercise(self, suite, platform='IOS', warm_error=None, cleanup_error=False, final_save_error=False, log_close_error=False):
        module = load('r52_' + suite + '_native')
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as patches:
            root = Path(temporary); private = root / 'private'; private.mkdir()
            generated = root / '.github/native/.generated/r52_tls_fixture.json'
            generated.parent.mkdir(parents=True)
            state = dict(build='PASS', smoke='PASS', source_sha=SOURCE, controller_source_sha=SOURCE,
                compiled_app_source_sha=SOURCE, diagnostic_only=False, native_acceptance=False,
                workflow_sha=SOURCE, workflow_ref='KeeperCommunity/bitcoin-keeper-private/.github/workflows/keeper-release-acceptance.yml@refs/pull/999/merge',
                run_id='123', run_attempt='1', built_artifact={'fixed': True},
                maestro={'binary': '/fixed/maestro'}, commands=[])
            events = []; processes = []; curl_calls = []; primary = RuntimeError('CONTROL_STOP_BEFORE_NATIVE_APP')
            config = dict(schema=1, platform=platform, nonce='b' * 48)
            if suite == 'tls':
                config.update(cases=[{'port': 21001}], rpc=dict(selected={'port':21002}, other={'port':21003}, control_port=21004))
            else:
                config.update(scope=module.SCOPE, source_sha=SOURCE, historical_commit=module.HISTORICAL,
                    manifest_sha256=module.MANIFEST, realm_package='12.15.0', schema_count=50)
            def read(): return copy.deepcopy(state)
            def save(value):
                if final_save_error and ('r52_tls_native' in value or 'r52_realm109_native' in value):
                    raise OSError('CONTROL_FINAL_RECEIPT_ERROR')
                state.clear(); state.update(copy.deepcopy(value))
            def command(args, label, **options):
                events.append(label)
                row = dict(command=args, label=label, exit_code=0, timeout_seconds=options.get('timeout'), duration_seconds=0.1)
                state['commands'].append(row)
                if args[0] == 'curl':
                    curl_calls.append((args, options))
                    self.assertTrue(processes[-1].poll() is None)
                    if warm_error is not None:
                        row['exit_code'] = 28; raise warm_error
                    Path(args[args.index('--output') + 1]).write_bytes(b'CONTROL_NONEMPTY_BUNDLE')
                    return '200'
                if args[0] == 'node' and suite == 'realm109':
                    return json.dumps(dict(config_sha256='f' * 64, generated_modules=16, historical_files=17))
                if args[0] == 'node': return json.dumps({'status': 'CONTROL_ONLY'})
                if args[0] == 'xcrun' and args[2] == 'create': return DEVICE
                if args[0] == 'adb' and args[1] == 'get-serialno': return 'emulator-5554'
                if 'clear' in args: return 'Success'
                if args[0] == '/fixed/maestro': raise primary
                return ''
            def verify_installed(device):
                events.append('CONTROL_VERIFY_INSTALLED')
                if platform == 'IOS': self.assertTrue(processes[-1].poll() is None)
            harness = SimpleNamespace(PLATFORM=platform, ROOT=root, PRIVATE=private,
                APP_IDS={'IOS':'io.hexawallet.hexakeeper.dev','ANDROID':'io.hexawallet.hexakeeper.dev'},
                read=read, save=save, command=command, artifact_identity=lambda:state['built_artifact'],
                verify_installed_artifact=verify_installed, wait_for_simulator_app_services=lambda _d:None)
            source = ast.parse((NATIVE / 'hosted_native.py').read_text())
            function = next(n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == 'warm_metro_bundle')
            namespace = dict(PLATFORM=platform, PRIVATE=private, re=re, hashlib=hashlib, time=time,
                             command=command, read=read, save=save)
            exec(compile(ast.Module(body=[function], type_ignores=[]), 'actual_original_warm', 'exec'), namespace)
            original = namespace['warm_metro_bundle']
            harness.warm_metro_bundle = original
            def popen(args, **options):
                process = Process(); processes.append(process)
                events.append('CONTROL_START_FIXTURE' if any(arg.endswith('r52_tls_fixture.cjs') for arg in args) else 'CONTROL_START_METRO')
                if any(arg.endswith('r52_tls_fixture.cjs') for arg in args): generated.write_text(json.dumps(config))
                return process
            def receive(process):
                return dict(ready=True, ports=[21001,21002,21003,21004],
                    config_sha256=hashlib.sha256(generated.read_bytes()).hexdigest(), rootPath=str(root / 'root.pem'))
            def close_fixture(process):
                events.append('CONTROL_CLOSE_FIXTURE'); generated.unlink(missing_ok=True); process.wait()
            def stop_group(*_args):
                events.append('CONTROL_STOP_OWNED_METRO')
                if cleanup_error: raise OSError('CONTROL_CLEANUP_ERROR')
            response = SimpleNamespace(read=lambda _n:b'packager-status:running')
            class Response:
                def __enter__(self): return response
                def __exit__(self, *_args): pass
            original_open = Path.open
            closed_logs = []
            class OwnedLog:
                def __init__(self, stream, name): self.stream=stream; self.name=name
                def close(self):
                    closed_logs.append(self.name); self.stream.close()
                    if log_close_error: raise OSError('CONTROL_LOG_CLOSE')
            def open_file(path, *args, **kwargs):
                stream=original_open(path, *args, **kwargs)
                return OwnedLog(stream,path.name) if path.name in ('metro.log','fixture.log') else stream
            patches.enter_context(patch.object(Path, 'open', open_file))
            patches.enter_context(patch.dict(os.environ, GITHUB_ACTIONS='true', RUNNER_ENVIRONMENT='github-hosted',
                GITHUB_REPOSITORY='KeeperCommunity/bitcoin-keeper-private', KEEPER_SOURCE_SHA=SOURCE,
                KEEPER_DIAGNOSTIC='false', GITHUB_REPOSITORY_ID='839671816',
                GITHUB_WORKFLOW_SHA=SOURCE, GITHUB_WORKFLOW_REF=state['workflow_ref'], GITHUB_RUN_ID='123',
                GITHUB_RUN_ATTEMPT='1', GITHUB_EVENT_NAME='pull_request', GITHUB_REF='refs/pull/999/merge'))
            patches.enter_context(patch.object(module.subprocess, 'check_output', return_value=SOURCE))
            patches.enter_context(patch.object(module, 'verify_source'))
            patches.enter_context(patch.object(module, 'require_free_metro_port'))
            patches.enter_context(patch.object(module.subprocess, 'Popen', side_effect=popen))
            patches.enter_context(patch.object(module.subprocess, 'run'))
            patches.enter_context(patch.object(module.os, 'killpg', side_effect=stop_group))
            patches.enter_context(patch.object(module.urllib.request, 'urlopen', return_value=Response()))
            if suite == 'tls':
                patches.enter_context(patch.object(module, 'receive', side_effect=receive))
                patches.enter_context(patch.object(module, 'close_fixture', side_effect=close_fixture))
            else: patches.enter_context(patch.object(module, 'verify_generated', return_value=config))
            expected = warm_error if warm_error is not None else primary
            with self.assertRaises(BaseException) as thrown: module.run(harness)
            self.assertIs(thrown.exception, expected)
            self.assertEqual(len(curl_calls), 1)
            args, options = curl_calls[0]
            self.assertEqual(options, dict(timeout=250, capture=True))
            self.assertEqual(args[args.index('--max-time') + 1], '240')
            expected_url = URL if platform == 'IOS' else 'http://127.0.0.1:8081/index.bundle?platform=android&dev=true&minify=false'
            self.assertEqual(args[-1], expected_url)
            self.assertIn('metro.log', closed_logs)
            if suite == 'tls': self.assertIn('fixture.log', closed_logs)
            if final_save_error: return events
            result = state['r52_' + suite + '_native']
            self.assertEqual(result['status'], 'FAIL')
            self.assertEqual(result['cleanup'], 'FAIL' if cleanup_error or log_close_error else 'PASS')
            self.assertIn('CONTROL_STOP_OWNED_METRO', events)
            if platform == 'IOS':
                receipt = result['ios_warm_before_device']
                self.assertEqual(receipt['state'], 'PRESENT')
                self.assertEqual(receipt['request_profile'], PROFILE)
                self.assertFalse(receipt['native_acceptance'])
                warm_index = receipt['warm_command_index']
                self.assertEqual(state['commands'][warm_index-1]['command'][-1], URL)
                if warm_error is not None:
                    self.assertIsNone(receipt['device_create_command_index'])
                    self.assertFalse(any('Create owned' in event for event in events))
                    self.assertEqual(receipt['result'], 'FAIL')
                else:
                    self.assertLess(warm_index, receipt['device_create_command_index'])
                    self.assertLess(events.index('Warm IOS development bundle (setup only)'), events.index('CONTROL_VERIFY_INSTALLED'))
                    self.assertGreater(events.index('CONTROL_STOP_OWNED_METRO'), events.index('CONTROL_VERIFY_INSTALLED'))
            else:
                self.assertNotIn('ios_warm_before_device', result)
                self.assertGreater(events.index('Warm ANDROID development bundle (setup only)'), events.index('CONTROL_VERIFY_INSTALLED'))
            return events

    def test_both_ios_drivers_use_actual_generic_client_query_once_before_create_and_install(self):
        for suite in ('tls','realm109'):
            with self.subTest(suite=suite): self.exercise(suite)

    def test_both_android_drivers_retain_install_verify_then_original_warm_order(self):
        for suite in ('tls','realm109'):
            with self.subTest(suite=suite): self.exercise(suite, 'ANDROID')

    def test_warm_failure_prevents_device_creation_and_cleans_owned_processes(self):
        for suite in ('tls','realm109'):
            with self.subTest(suite=suite): self.exercise(suite, warm_error=RuntimeError('CONTROL_HTTP28'))

    def test_interruption_identity_survives_owned_metro_cleanup_failure(self):
        for suite in ('tls','realm109'):
            for error in (KeyboardInterrupt(), SystemExit(19)):
                with self.subTest(suite=suite, error=type(error).__name__):
                    self.exercise(suite, warm_error=error, cleanup_error=True)

    def test_original_warm_failure_survives_final_receipt_and_each_owned_log_close_failure(self):
        for suite in ('tls','realm109'):
            with self.subTest(suite=suite):
                self.exercise(suite, warm_error=KeyboardInterrupt(), final_save_error=True, log_close_error=True)


if __name__ == '__main__': unittest.main()
