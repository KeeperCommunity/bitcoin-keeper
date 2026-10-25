import contextlib
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock

NATIVE = Path(__file__).parents[1] / 'native'


def load(name):
    spec = importlib.util.spec_from_file_location(name, NATIVE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


diagnosis = load('product_failure_diagnosis')
product = load('product_measurements')


class FileObservations(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.flow = 'product_first_wallet.yaml'

    def report(self, message, **changes):
        from xml.sax.saxutils import escape
        body = ('<testsuites><testsuite><testcase status="ERROR" file=".github/native/' + self.flow + '">' +
                '<failure>' + escape(message) + '</failure></testcase></testsuite></testsuites>')
        for old, new in changes.items():
            body = body.replace(old, new)
        (self.root / 'junit.xml').write_text(body)
        return diagnosis.junit(self.root, self.flow)

    def snapshot(self, node, number=1):
        path = self.root / 'screen-hierarchy' / ('step-%d.json' % number)
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps(node))
        return path

    def test_pinned_junit_xml_text_exact_first_line_and_known_file_only(self):
        for message, kind in [('Assertion is false: id: view_startNewTile is visible', 'ASSERT_VISIBLE'),
                              ('Element not found: Id matching regex: btn_skip', 'ELEMENT_NOT_FOUND')]:
            value = self.report(message + '\nPRIVATE_SENTINEL diagnostic body')
            self.assertEqual(value['failure_kind'], kind)
            self.assertIn(value['failed_selector'], ('start_new_tile', 'onboarding_skip'))
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(value))
        for message in ['PRIVATE_SENTINEL id: view_startNewTile',
                        'Assertion is false: id: view_startNewTile is visible PRIVATE_SENTINEL',
                        'Assertion is false: id: view_startNewTile is visible\u2028PRIVATE_SENTINEL',
                        'Assertion is false: id: view_startNewTile is visible\u0085PRIVATE_SENTINEL',
                        'PRIVATE_SENTINEL\nAssertion is false: id: view_startNewTile is visible',
                        'Element not found: id: view_startNewTile']:
            self.assertIsNone(self.report(message)['failed_selector'])
        self.assertEqual(self.report('Assertion is false: id: view_startNewTile is visible',
            **{'status="ERROR"': 'status="SUCCESS"'})['state'], 'UNKNOWN')
        self.assertEqual(diagnosis.junit(self.root, 'private.yaml')['state'], 'UNKNOWN')
        for malformed in [{'<testsuite>': '', '</testsuite>': ''},
                          {'<testcase ': '<wrapper><testcase ', '</testcase>': '</testcase></wrapper>'},
                          {'<testsuite>': '<wrapper><testsuite>', '</testsuite>': '</testsuite></wrapper>'}]:
            result = self.report('Assertion is false: id: view_startNewTile is visible',
                                 **malformed)
            self.assertEqual(result['state'], 'UNKNOWN')

    def test_missing_malformed_entity_attribute_and_wrong_file_reports_are_unknown(self):
        path = self.root / 'junit.xml'
        for payload in [b'', b'<invalid>', b'<!DOCTYPE x [<!ENTITY e "PRIVATE_SENTINEL">]><testsuites/>',
            '<!DOCTYPE x [<!ENTITY e "PRIVATE_SENTINEL">]><testsuites/>'.encode('utf-16'),
            b'<testsuites><testcase status="ERROR" file=".github/native/product_first_wallet.yaml">'
            b'<failure message="Assertion is false: id: view_startNewTile is visible"/></testcase></testsuites>']:
            path.write_bytes(payload)
            self.assertEqual(diagnosis.junit(self.root, self.flow)['state'], 'UNKNOWN')
        self.report('Assertion is false: id: view_startNewTile is visible')
        self.assertEqual(diagnosis.junit(self.root, 'product_retry.yaml')['state'], 'UNKNOWN')
        path.unlink()
        self.assertEqual(diagnosis.junit(self.root, self.flow)['state'], 'UNKNOWN')
        path.symlink_to(self.root / 'outside.xml')
        self.assertEqual(diagnosis.junit(self.root, self.flow)['state'], 'UNKNOWN')

    def test_fixed_public_flags_leaf_omissions_and_no_arbitrary_values_escape(self):
        self.snapshot({'children': [
            {'attributes': {'resource-id': 'view_startNewTile', 'text': 'PRIVATE_SENTINEL'}},
            {'attributes': {'resource-id': 'io.hexawallet.keeper.development:id/btn_skip'}},
            *[{'attributes': {'text': value}} for value in [
                'Start New', 'Welcome to Bitcoin Keeper', 'Dismiss', 'Minimize', 'Render Error',
                'Unable to check your passcode. Please try again.', 'Retry',
                '“PRIVATE_SENTINEL” Would Like to Send You Notifications', 'Allow', "Don't Allow"]]]})
        result = diagnosis.hierarchy(self.root)
        self.assertEqual(result['state'], 'COMPLETE')
        for name in ('start_new_tile', 'onboarding_skip', 'start_new_text', 'welcome',
                     'credential_error', 'retry', 'logbox_controls', 'logbox_error_header',
                     'notification_permission_controls'):
            self.assertIs(result['flags'][name], True, name)
        self.assertIs(result['flags']['recover_tile'], False)
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_invalid_truncated_and_bounded_snapshots_do_not_clear_unknown_flags(self):
        self.assertTrue(all(value is None for value in diagnosis.hierarchy(self.root)['flags'].values()))
        self.snapshot({'attributes': {'resource-id': 'btn_skip'}})
        malformed = self.snapshot({'children': [42]}, 2)
        result = diagnosis.hierarchy(self.root)
        self.assertEqual(result['state'], 'PARTIAL')
        self.assertIs(result['flags']['onboarding_skip'], True)
        self.assertIsNone(result['flags']['start_new_tile'])
        malformed.write_bytes(b' ' * (diagnosis.FILE_LIMIT + 1))
        self.assertEqual(diagnosis.hierarchy(self.root)['rejected_snapshots'], 1)
        with mock.patch.object(diagnosis, 'NODE_LIMIT', 1):
            self.snapshot({'children': [{}]}, 1)
            self.assertEqual(diagnosis.hierarchy(self.root)['rejected_snapshots'], 2)
        for number in range(3, 11):
            self.snapshot({}, number)
        self.assertTrue(diagnosis.hierarchy(self.root)['snapshot_limit_exceeded'])

    def test_isolated_permission_buttons_and_cross_snapshot_logbox_are_not_dialog_proof(self):
        self.snapshot({'attributes': {'text': 'Allow'}, 'children': [{'attributes': {'text': 'Dismiss'}}]})
        self.snapshot({'attributes': {'text': "Don't Allow"}, 'children': [{'attributes': {'text': 'Minimize'}}]}, 2)
        result = diagnosis.hierarchy(self.root)
        self.assertIs(result['flags']['notification_permission_controls'], False)
        self.assertIs(result['flags']['logbox_controls'], False)

    def test_duplicate_falsey_malformed_and_symlink_inputs_stay_unknown(self):
        path = self.snapshot({})
        for payload in [b'{"attributes":{},"attributes":{"text":"PRIVATE_SENTINEL"}}',
                        b'{"attributes":null}', b'{"attributes":false}', b'{"attributes":[]}',
                        b'{"children":null}', b'{"children":false}', b'{"children":{}}',
                        b'{"attributes":{"text":42}}']:
            with self.subTest(payload=payload):
                path.write_bytes(payload)
                value = diagnosis.hierarchy(self.root)
                self.assertEqual(value['state'], 'UNKNOWN')
                self.assertTrue(all(flag is None for flag in value['flags'].values()))
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(value))
        path.unlink()
        outside = self.root / 'outside.json'
        outside.write_text('{}')
        path.symlink_to(outside)
        self.assertEqual(diagnosis.hierarchy(self.root)['state'], 'UNKNOWN')


class MetroObservations(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / 'metro-01.log'
        self.path.write_text('ERROR TypeError: PRIVATE_EARLIER\n')
        self.process = types.SimpleNamespace(poll=lambda: None)
        self.metro = types.SimpleNamespace(private=self.root, process=self.process,
            phase='product', events=[{'phase': 'product'}], owned=[self.process])

    def append(self, value):
        with self.path.open('ab') as output:
            output.write(value)

    def test_only_bound_sample_lines_and_fixed_categories_are_retained_even_after_exit(self):
        bound = diagnosis.bind_metro(self.metro)
        self.append(b'ERROR ReferenceError: PRIVATE_SENTINEL https://example.test/?secret=value\n')
        self.process.poll = lambda: -9
        value = diagnosis.metro_window(self.metro, bound)
        self.assertEqual(value['state'], 'COMPLETE')
        self.assertEqual(value['fault_categories'], ['JS_REFERENCE_ERROR'])
        self.assertEqual((value['process_state'], value['exit_code']), ('EXITED', -9))
        self.assertEqual(value['error_headers'], 1)
        for forbidden in ('PRIVATE', 'example.test', 'secret', 'TYPE_ERROR'):
            self.assertNotIn(forbidden, json.dumps(value))

    def test_missing_replaced_shrunk_or_other_process_phase_event_cannot_be_adopted(self):
        for change in ('missing', 'replaced', 'shrunk', 'process', 'phase', 'event', 'unowned'):
            with self.subTest(change=change):
                self.setUp()
                bound = diagnosis.bind_metro(self.metro)
                if change == 'missing':
                    self.path.unlink()
                elif change == 'replaced':
                    replacement = self.root / 'replacement'
                    replacement.write_text('ERROR TypeError: PRIVATE_SENTINEL\n')
                    replacement.replace(self.path)
                elif change == 'shrunk':
                    self.path.write_bytes(b'')
                elif change == 'process':
                    self.metro.process = types.SimpleNamespace(poll=lambda: None)
                elif change == 'phase':
                    self.metro.phase = 'arm'
                elif change == 'event':
                    self.metro.events.append({'phase': 'product'})
                else:
                    self.metro.owned = []
                self.assertEqual(diagnosis.metro_window(self.metro, bound)['state'], 'UNKNOWN')

    def test_partial_start_end_limit_and_growth_are_disclosed(self):
        self.path.write_bytes(b'PRIVATE_EARLIER_PARTIAL')
        bound = diagnosis.bind_metro(self.metro)
        self.append(b' TypeError\nERROR ReferenceError: PRIVATE_SENTINEL\nERROR SyntaxError: unfinished')
        result = diagnosis.metro_window(self.metro, bound)
        self.assertEqual(result['state'], 'PARTIAL')
        self.assertTrue(result['partial_start'])
        self.assertTrue(result['partial_end'])
        self.assertEqual(result['fault_categories'], ['JS_REFERENCE_ERROR'])
        with mock.patch.object(diagnosis, 'METRO_LIMIT', 18):
            result = diagnosis.metro_window(self.metro, bound)
        self.assertTrue(result['input_truncated'])
        self.assertLessEqual(result['bytes_read'], 18)
        original = diagnosis.os.fstat
        calls = []
        def growing(fd):
            info = original(fd)
            calls.append(fd)
            if len(calls) == 2:
                return types.SimpleNamespace(st_size=info.st_size + 1)
            return info
        with mock.patch.object(diagnosis.os, 'fstat', side_effect=growing):
            result = diagnosis.metro_window(self.metro, bound)
        self.assertTrue(result['growth_detected'])
        self.assertEqual(result['state'], 'PARTIAL')

    def test_malformed_utf8_controls_and_non_lf_separators_cannot_create_error_facts(self):
        bound = diagnosis.bind_metro(self.metro)
        for payload in [b'INFO not a newline\rERROR TypeError: PRIVATE_SENTINEL\n',
                        b'ERROR TypeError: \xff PRIVATE_SENTINEL\n',
                        b'ERROR TypeError: PRIVATE_SENTINEL\x00\n',
                        'INFO\u2028ERROR TypeError: PRIVATE_SENTINEL\n'.encode()]:
            with self.subTest(payload=payload):
                self.path.write_bytes(self.path.read_bytes()[:bound.offset] + payload)
                result = diagnosis.metro_window(self.metro, bound)
                self.assertEqual(result['state'], 'UNKNOWN')
                self.assertEqual(result['fault_categories'], [])
                self.assertEqual(result['invalid_records'], 1)
                self.assertEqual(result['error_headers'], 0)
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        self.path.write_bytes(self.path.read_bytes()[:bound.offset] +
            b'ERROR TypeError: PRIVATE_SENTINEL\x00\n\x1b[31mERROR ReferenceError: fixed\x1b[0m\r\n')
        result = diagnosis.metro_window(self.metro, bound)
        self.assertEqual(result['state'], 'PARTIAL')
        self.assertEqual((result['valid_records'], result['invalid_records']), (1, 1))
        self.assertEqual(result['fault_categories'], ['JS_REFERENCE_ERROR'])


class FailureLifecycle(unittest.TestCase):
    def test_original_error_identity_and_purge_survive_failed_observer_and_cleanup(self):
        class PrimaryFailure(RuntimeError):
            pass
        with tempfile.TemporaryDirectory() as directory:
            root, order, receipts = Path(directory), [], []
            private = root / 'private'
            private.mkdir()
            (root / 'release').mkdir()
            manifest = b'{"name":"owned"}'
            (root / 'package.json').write_bytes(manifest)
            (root / 'release/version.json').write_text(json.dumps(
                {'version': '2.6.4', 'androidVersionCode': 627, 'iosBuildNumber': 620}))
            (root / '.env.ci').write_text('\n'.join([
                'ENVIRONMENT=DEVELOPMENT', 'RELAY=http://127.0.0.1:8765/',
                'SIGNING_SERVER_TESTNET=https://127.0.0.1:9/', 'SIGNING_SERVER_MAINNET=https://127.0.0.1:9/',
                'CHANNEL_URL=https://127.0.0.1:9/', 'SENTRY_DNS=https://public@127.0.0.1:9/1',
                'ENC_KEY_STORAGE_IDENTIFIER=KEEPER-HOSTED-DISPOSABLE']))
            sha, artifact = 'a' * 40, {'sha256': 'b' * 64}
            digest = hashlib.sha256(manifest).hexdigest()
            state = {'build': 'PASS', 'source_sha': sha, 'built_artifact': artifact,
                'commands': [], 'maestro': {'binary': 'fake-maestro'}, 'nodeify_overlay': {
                    'path': 'package.json', 'allowed_fields': ['browser', 'react-native', 'browserify'],
                    'before_sha256': digest, 'after_sha256': digest}}
            error = PrimaryFailure('PRIVATE_SENTINEL original')
            def save(value):
                receipts.append(copy.deepcopy(value['product_ui']))
                state.update(copy.deepcopy(value))
            def command(args, *_args, **_kwargs):
                state['commands'].append({})
                if args == ['adb', 'get-serialno']:
                    return 'emulator-5554'
                if args[0] == 'fake-maestro':
                    output = Path(args[args.index('--debug-output') + 1])
                    (output / 'junit.xml').write_text('PRIVATE_SENTINEL')
                    raise error
                return 'image'
            def observe(output, *_args):
                self.assertTrue((output / 'junit.xml').exists())
                order.append('observer')
                raise OSError('PRIVATE_SENTINEL observation')
            observer = types.SimpleNamespace(bind_metro=lambda _: None, collect=observe)
            def close():
                order.append('close')
                raise OSError('PRIVATE_SENTINEL cleanup')
            manager = types.SimpleNamespace(start=lambda *_a, **_k: None, close=close, events=[])
            server = types.SimpleNamespace(serve_forever=lambda: None, shutdown=lambda: None, server_close=lambda: None)
            def installed(_device):
                proof = {'method': 'SINGLE_INSTALLED_BASE_APK_SHA256', 'sha256': 'c' * 64}
                state.update(installed_artifact_verified=True, installed_artifact=proof)
                return proof
            h = types.SimpleNamespace(ROOT=root, PRIVATE=private, PLATFORM='ANDROID', APP_IDS={'ANDROID': 'owned.app'},
                read=lambda: copy.deepcopy(state), save=save, artifact_identity=lambda: artifact, command=command,
                verify_installed_artifact=installed)
            def module(name):
                return observer if name == 'product_failure_diagnosis' else types.SimpleNamespace(OwnedMetro=lambda *_: manager)
            with contextlib.ExitStack() as stack:
                stack.enter_context(mock.patch.dict(product.os.environ, {'GITHUB_ACTIONS': 'true',
                    'RUNNER_ENVIRONMENT': 'github-hosted', 'KEEPER_SOURCE_SHA': sha}))
                stack.enter_context(mock.patch.object(product.subprocess, 'check_output', side_effect=[sha, manifest]))
                stack.enter_context(mock.patch.object(product.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0)))
                stack.enter_context(mock.patch.object(product, 'native_module', side_effect=module))
                stack.enter_context(mock.patch.object(product, 'make_server', return_value=server))
                stack.enter_context(mock.patch.object(product, 'android_failure_observation', return_value={'status': 'UNAVAILABLE'}))
                with self.assertRaises(PrimaryFailure) as failure:
                    product.run(h)
            self.assertIs(failure.exception, error)
            self.assertEqual(order, ['observer', 'close'])
            self.assertEqual(list(private.iterdir()), [])
            self.assertEqual(len(state['product_ui']['samples']), 1)
            self.assertEqual(state['product_ui']['samples'][0]['failure_observation']['status'], 'UNKNOWN')
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(receipts))


if __name__ == '__main__':
    unittest.main()
