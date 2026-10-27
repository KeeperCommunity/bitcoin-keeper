import copy
import importlib.util
import io
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('tls_failure_matrix', Path(__file__).parents[1] / 'native/r52_tls_native.py')
matrix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(matrix)


class FailureObservation(unittest.TestCase):
    def setUp(self):
        self.config = dict(nonce='a' * 48, cases=[dict(id='valid', expected='ACCEPT'), dict(id='expired', expected='REJECT')])
        self.rows = [dict(id='valid', outcome='ACCEPT', connected=True), dict(id='expired', outcome='TIMEOUT', connected=False)]
        self.final = dict(schema=1, scope='ACTUAL_APP_RN_PRODUCTION_TLS_BRIDGE', nonce='a' * 48,
                          platform='ANDROID', status='FAIL', transport_status='FAIL', cases=self.rows,
                          rpc=dict(status='NOT RUN', reason='TLS_MATRIX_FAILED'))
        self.progress = dict(schema=1, scope='ACTUAL_APP_RN_PRODUCTION_TLS_PROGRESS', nonce='a' * 48,
                             platform='ANDROID', state='RUNNING', phase='TLS', active_case='expired', cases=self.rows[:1])

    def test_bound_completed_failure_retains_exact_case_without_acceptance(self):
        result = matrix.failure_receipt(json.dumps(self.final), self.config, 'ANDROID')
        self.assertEqual(result['probe_status'], 'FAIL')
        self.assertEqual(result['completed_cases'][1], dict(id='expired', outcome='TIMEOUT', connected=False, matches_expected=False))
        self.assertNotIn('nonce', result)
        self.assertEqual(matrix.failure_receipt(json.dumps(self.progress), self.config, 'ANDROID', True)['active_case'], 'expired')

    def test_stale_platform_nonce_unknown_outcome_and_reordered_cases_rejected(self):
        for update in [dict(nonce='b' * 48), dict(platform='IOS'), dict(schema=True), dict(cases=list(reversed(self.rows))),
                       dict(cases=[dict(self.rows[0], outcome='PRIVATE_SECRET'), self.rows[1]]),
                       dict(cases=[dict(self.rows[0], connected=1), self.rows[1]])]:
            with self.subTest(update=update), self.assertRaises((ValueError, TypeError)):
                matrix.failure_receipt(json.dumps(dict(self.final, **update)), self.config, 'ANDROID')
        for update in [dict(phase='PRIVATE_SECRET'), dict(active_case='valid'), dict(state='PASS')]:
            with self.subTest(update=update), self.assertRaises((ValueError, TypeError)):
                matrix.failure_receipt(json.dumps(dict(self.progress, **update)), self.config, 'ANDROID', True)
        with self.assertRaises(ValueError):
            matrix.failure_receipt('x' * 65537, self.config, 'ANDROID')
        with self.assertRaisesRegex(ValueError, 'TLS_DIAGNOSTIC_DUPLICATE_KEY'):
            matrix.failure_receipt('{"schema":0,' + json.dumps(self.final)[1:], self.config, 'ANDROID')

    def test_rpc_fixed_failure_and_prefix_only_no_raw_extra_fields(self):
        data = copy.deepcopy(self.final)
        data['rpc'] = dict(status='FAIL', failure='RPC_APP_TIMEOUT', cases=[dict(id='synthetic_headers', status='PASS', secret='PRIVATE_SECRET')])
        data['secret'] = 'PRIVATE_SECRET'
        result = matrix.failure_receipt(json.dumps(data), self.config, 'ANDROID')
        self.assertEqual(result['rpc_failure'], 'RPC_APP_TIMEOUT')
        self.assertEqual(result['rpc_completed_cases'], ['synthetic_headers'])
        self.assertNotIn('PRIVATE_SECRET', json.dumps(result))
        data['rpc']['failure'] = 'RPC_PRIVATE_SECRET'
        self.assertEqual(matrix.failure_receipt(json.dumps(data), self.config, 'ANDROID')['rpc_failure'], 'UNKNOWN_RPC_FAILURE')

    def harness(self, root, callback):
        class Harness:
            PLATFORM = 'ANDROID'
            APP_IDS = {'ANDROID': 'owned.test.app'}
            command = staticmethod(callback)
            maestro_preflight_diagnostics = staticmethod(lambda *_args: dict(exception_types=['IOException']))
            startup_hierarchy_signals = staticmethod(lambda _path: dict(RNredbox=True))
            private_log_prefix = staticmethod(lambda _path: ('PRIVATE_SECRET', False))
            metro_startup_errors = staticmethod(lambda _text: ['METRO_ERROR'])
            android_startup_errors = staticmethod(lambda _text: ['REACT_NATIVE_JS_ERROR'])
        return Harness()

    def test_owned_collection_recovers_receipts_junit_ui_and_server_before_cleanup(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); calls = []
            (root / 'junit.xml').write_text('<testsuite><testcase><failure>PRIVATE_SECRET</failure></testcase></testsuite>')
            hierarchy = root / 'screen-hierarchy'; hierarchy.mkdir()
            (hierarchy / 'step-1.json').write_text(json.dumps(dict(attributes={'resource-id': 'owned:id/logbox_footer_button_dismiss', 'text': 'PRIVATE_SECRET'}, children=[])))
            def command(args, label, **kwargs):
                calls.append(args)
                self.assertNotIn('uninstall', args)
                self.assertLessEqual(kwargs['timeout'], 15)
                self.assertFalse(kwargs['error_details'])
                return json.dumps(self.progress if 'progress' in args[-1] else self.final) if args[3] == 'exec-out' else 'PRIVATE_SECRET'
            fixture = type('Fixture', (), dict(stdin=io.StringIO()))()
            counters = dict(connections=1, secure_connections=0, requests=0, invalid_payloads=0)
            with patch.object(matrix, 'receive', return_value={'tls': {row['id']: dict(counters) for row in self.config['cases']}}):
                result = matrix.collect_android_failure(self.harness(root, command), 'emulator-5554', self.config, root, fixture)
            self.assertFalse(result['native_acceptance'])
            self.assertEqual(result['final_receipt']['probe_status'], 'FAIL')
            self.assertEqual(result['junit']['failure_count'], 1)
            self.assertEqual(result['probe_ui']['observed_ids'], ['logbox_footer_button_dismiss'])
            self.assertEqual(result['server_witnesses'][1]['connections'], 1)
            self.assertEqual(fixture.stdin.getvalue(), 'snapshot\n')
            self.assertNotIn('PRIVATE_SECRET', json.dumps(result))
            self.assertTrue(all(args[:3] == ['adb', '-s', 'emulator-5554'] for args in calls))

    def test_missing_invalid_receipts_tool_failure_and_invalid_owned_target_never_pass(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def missing(*_args, **_kwargs):
                raise RuntimeError('PRIVATE_SECRET')
            result = matrix.collect_android_failure(self.harness(root, missing), 'emulator-5554', self.config, root)
            self.assertEqual(result['final_receipt']['state'], 'ABSENT_OR_UNREADABLE')
            self.assertEqual(result['junit']['state'], 'MISSING')
            self.assertEqual(result['android_errors']['state'], 'COLLECTION_FAILED')
            self.assertNotIn('PRIVATE_SECRET', json.dumps(result))
            result = matrix.collect_android_failure(self.harness(root, lambda *_a, **_kw: '{"secret":"PRIVATE_SECRET"}'), 'emulator-5554', self.config, root)
            self.assertEqual(result['final_receipt']['state'], 'INVALID_OR_UNBOUND')
            with self.assertRaises(RuntimeError):
                matrix.collect_android_failure(self.harness(root, missing), 'physical-device', self.config, root)

    def test_actual_failure_path_collects_before_uninstall_preserving_original_error(self):
        original = RuntimeError('original private tool failure')
        data, events, raised = self.exercise_failure_path(original, RuntimeError('collection private failure'))
        self.assertIs(raised, original)
        self.assertEqual(events, ['failure_observation', 'uninstall'])
        self.assertFalse(data['r52_tls_native']['failure_observation']['native_acceptance'])

    def test_cancellation_starts_no_observation_and_keeps_finally_cleanup(self):
        for original in [SystemExit(143), KeyboardInterrupt()]:
            with self.subTest(kind=type(original).__name__):
                data, events, raised = self.exercise_failure_path(original, RuntimeError('must not collect'))
                self.assertIs(raised, original)
                self.assertEqual(events, ['uninstall'])
                self.assertNotIn('failure_observation', data['r52_tls_native'])

    def test_fresh_cancellation_during_observation_is_not_swallowed(self):
        stop = SystemExit(143)
        data, events, raised = self.exercise_failure_path(RuntimeError('original private failure'), stop)
        self.assertIs(raised, stop)
        self.assertEqual(events, ['failure_observation', 'uninstall'])
        self.assertNotIn('failure_observation', data['r52_tls_native'])

    def exercise_failure_path(self, original, collection_error):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); private = root / 'private'; private.mkdir()
            generated = root / '.github/native/.generated/r52_tls_fixture.json'; generated.parent.mkdir(parents=True)
            config = dict(schema=1, nonce='a' * 48, platform='ANDROID', cases=[dict(id='valid', port=31000, expected='ACCEPT')],
                          rpc=dict(selected=dict(port=31001), other=dict(port=31002), control_port=31003))
            raw = json.dumps(config); digest = hashlib.sha256(raw.encode()).hexdigest()
            data = dict(build='PASS', smoke='PASS', source_sha='a' * 40, built_artifact={'hash': 'fixed'}, maestro={'binary': 'maestro'})
            events = []
            class Harness:
                ROOT = root
                PRIVATE = private
                PLATFORM = 'ANDROID'
                APP_IDS = {'ANDROID': 'owned.test.app'}
                def read(self): return data
                def save(self, value): data.update(value)
                def artifact_identity(self): return data['built_artifact']
                def warm_metro_bundle(self, _suite): pass
                def verify_installed_artifact(self, _device): pass
                def command(self, args, *_args, **_kwargs):
                    if args[0] == 'maestro': raise original
                    if args[:2] == ['adb', 'get-serialno']: return 'emulator-5554'
                    if 'clear' in args: return 'Success'
                    return ''
            class Child:
                stdin = io.StringIO(); stdout = io.StringIO(); returncode = None; pid = 123
                def poll(self): return self.returncode
                def wait(self, **_kwargs):
                    generated.unlink(missing_ok=True); self.returncode = 0; return 0
            def spawn(args, **_kwargs):
                if any(arg.endswith('r52_tls_fixture.cjs') for arg in args): generated.write_text(raw)
                return Child()
            response = Mock(); response.__enter__ = Mock(return_value=response); response.__exit__ = Mock(return_value=False)
            response.read.return_value = b'packager-status:running'
            def collect(*_args):
                events.append('failure_observation')
                raise collection_error
            def cleanup(args, **_kwargs):
                if 'uninstall' in args: events.append('uninstall')
            ready = dict(ready=True, ports=[31000, 31001, 31002, 31003], config_sha256=digest)
            with patch.dict('os.environ', dict(GITHUB_ACTIONS='true', RUNNER_ENVIRONMENT='github-hosted',
                            GITHUB_REPOSITORY='KeeperCommunity/bitcoin-keeper-private', KEEPER_SOURCE_SHA='a' * 40)), \
                 patch.object(matrix.subprocess, 'check_output', return_value='a' * 40), \
                 patch.object(matrix.subprocess, 'Popen', side_effect=spawn), \
                 patch.object(matrix, 'receive', return_value=ready), \
                 patch.object(matrix, 'verify_source'), patch.object(matrix, 'require_free_metro_port'), \
                 patch.object(matrix.os, 'killpg'), patch.object(matrix.subprocess, 'run', side_effect=cleanup), \
                 patch.object(matrix.urllib.request, 'urlopen', return_value=response), \
                 patch.object(matrix, 'collect_android_failure', side_effect=collect):
                expected = collection_error if isinstance(original, Exception) and not isinstance(collection_error, Exception) else original
                with self.assertRaises(type(expected)) as raised: matrix.run(Harness())
            self.assertEqual(data['r52_tls_native']['failure_stage'], 'MAESTRO')
            self.assertEqual(data['r52_tls_native']['status'], 'FAIL')
            self.assertEqual(data['r52_tls_native']['cleanup'], 'PASS')
            return data, events, raised.exception


if __name__ == '__main__':
    unittest.main()
