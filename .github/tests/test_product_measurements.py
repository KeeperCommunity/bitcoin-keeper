"""HTTP controls and fail-closed measurement receipts; these are not native tests."""
import importlib.util
import hashlib
import http.client
import json
from pathlib import Path
import threading
import types
import unittest
from unittest import mock
import urllib.error
import urllib.request

import yaml

SPEC = importlib.util.spec_from_file_location('product_measurements',
    Path(__file__).resolve().parents[1] / 'native/product_measurements.py')
product = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(product)


class FixtureTests(unittest.TestCase):
    def setUp(self):
        self.receipt = product.Receipt()
        self.server = product.make_server(self.receipt, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = 'http://127.0.0.1:%d' % self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def post(self, path, value):
        raw = value if isinstance(value, bytes) else json.dumps(value).encode()
        request = urllib.request.Request(self.base + path, data=raw, method='POST',
                                         headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def complete(self):
        self.post('/createNewApp', {'publicId': 'DO_NOT_RETAIN', 'fcmToken': 'DO_NOT_RETAIN'})
        for stage in product.STAGES:
            self.assertEqual(self.post('/metric', {'stage': stage}), (200, {'accepted': True}))

    def test_loopback_only(self):
        self.assertEqual(self.server.server_address[0], '127.0.0.1')

    def test_complete_numeric_receipt_does_not_retain_account_data(self):
        self.complete()
        evidence = self.receipt.snapshot(passed=True)
        self.assertEqual(evidence['status'], 'PASS')
        self.assertEqual(evidence['visible_wallet_count_after_relaunch'], 1)
        self.assertEqual(len(evidence['raw_durations']), 5)
        self.assertNotIn('DO_NOT_RETAIN', json.dumps(evidence))
        self.assertTrue(all(value >= 0 for value in evidence['raw_durations'].values()))
        self.assertFalse(evidence['pin_onboarding_progress']['complete'],
                         'optional progress must not add a new product acceptance requirement')

    def test_partial_pin_progress_is_ordered_and_independent_of_core_receipt(self):
        self.assertEqual(self.post('/metric', {'stage': 'startup_start'})[0], 200)
        before = self.receipt.snapshot()
        for marker in product.PIN_MARKERS[:4]:
            self.assertEqual(self.post('/pin-progress', {'marker': marker}), (200, {'accepted': True}))
        after = self.receipt.snapshot()
        progress = after.pop('pin_onboarding_progress')
        before.pop('pin_onboarding_progress')
        self.assertEqual(after, before, 'progress cannot change timing, stage or backend evidence')
        self.assertEqual(progress['completed_markers'], list(product.PIN_MARKERS[:4]))
        self.assertEqual(progress['next_marker'], product.PIN_MARKERS[4])
        self.assertFalse(progress['complete'])
        self.assertIn('acknowledgements only', progress['scope'])

    def test_pin_marker_parser_rejects_private_unknown_duplicate_and_malformed_payloads(self):
        bad = [
            {'marker': 'DO_NOT_RETAIN'},
            {'marker': product.PIN_MARKERS[1]},  # cannot skip the first marker
            {'marker': product.PIN_MARKERS[0], 'secret': 'DO_NOT_RETAIN'},
            {'marker': ['DO_NOT_RETAIN']}, {'marker': True}, {'marker': None},
            ['DO_NOT_RETAIN'], 'DO_NOT_RETAIN',
            b'{"marker":"confirm_passcode_visible","marker":"DO_NOT_RETAIN"}',
            b'{"marker":"DO_NOT_RETAIN"', b'\xffDO_NOT_RETAIN',
        ]
        for payload in bad:
            with self.subTest(payload=payload):
                status, response = self.post('/pin-progress', payload)
                self.assertEqual((status, response), (422, {'error': 'FIXED_PIN_PROGRESS_REJECTED'}))
                state = self.receipt.snapshot()
                self.assertEqual(state['pin_onboarding_progress']['completed_markers'], [])
                self.assertEqual(state['other_backend_calls_rejected'], 0)
                self.assertNotIn('DO_NOT_RETAIN', json.dumps((response, state)))

    def test_pin_marker_duplicate_and_completion_do_not_accept_extra_events(self):
        for index, marker in enumerate(product.PIN_MARKERS):
            self.assertEqual(self.post('/pin-progress', {'marker': marker})[0], 200)
            self.assertEqual(self.post('/pin-progress', {'marker': marker})[0], 422)
            self.assertEqual(self.receipt.snapshot()['pin_onboarding_progress']['completed_markers'],
                             list(product.PIN_MARKERS[:index + 1]))
        result = self.receipt.snapshot()['pin_onboarding_progress']
        self.assertTrue(result['complete'])
        self.assertIsNone(result['next_marker'])
        self.assertEqual(self.receipt.snapshot()['status'], 'FAIL',
                         'complete observer markers cannot grant application acceptance')

    def test_pin_body_bound_is_independent_of_backend_payload_limit(self):
        first = json.dumps({'marker': product.PIN_MARKERS[0]}).encode()
        self.assertEqual(self.post('/pin-progress', first + b' ' * (128 - len(first)))[0], 200)
        before = self.receipt.snapshot()
        oversized = b'{"marker":"DO_NOT_RETAIN"}' + b' ' * 129
        self.assertEqual(self.post('/pin-progress', oversized),
                         (413, {'error': 'FIXED_PIN_PROGRESS_REJECTED'}))
        self.assertEqual(self.receipt.snapshot(), before)
        self.assertNotIn('DO_NOT_RETAIN', json.dumps(before))

    def test_pin_prefix_resets_for_both_normal_and_retry_fixtures(self):
        for sample, retry in ((2, False), (6, True), (1, False)):
            for marker in product.PIN_MARKERS:
                self.assertEqual(self.post('/pin-progress', {'marker': marker})[0], 200)
            self.receipt.reset(sample, retry=retry)
            result = self.receipt.snapshot()
            self.assertEqual(result['sample'], sample)
            self.assertEqual(result['pin_onboarding_progress']['completed_markers'], [])
            self.assertEqual(result['pin_onboarding_progress']['next_marker'], product.PIN_MARKERS[0])
            self.assertFalse(result['pin_onboarding_progress']['complete'])
            self.assertEqual(result['create_new_app_calls'], 0)

    def test_out_of_order_and_duplicate_markers_are_rejected(self):
        self.assertEqual(self.post('/metric', {'stage': 'wallet_ready'})[0], 422)
        self.assertEqual(self.post('/metric', {'stage': 'startup_start'})[0], 200)
        self.assertEqual(self.post('/metric', {'stage': 'startup_start'})[0], 422)
        self.assertEqual(self.receipt.snapshot()['completed_stages'], ['startup_start'])

    def test_unknown_marker_and_additional_fields_are_rejected_without_echo(self):
        for payload in ({'stage': 'DO_NOT_RETAIN'}, {'stage': 'startup_start', 'secret': 'DO_NOT_RETAIN'}):
            status, response = self.post('/metric', payload)
            self.assertEqual(status, 422)
            self.assertNotIn('DO_NOT_RETAIN', json.dumps(response))
        self.assertEqual(self.receipt.snapshot()['completed_stages'], [])

    def test_duplicate_setup_fails_even_after_every_ui_stage(self):
        self.complete()
        self.post('/createNewApp', b'{}')
        with self.assertRaisesRegex(RuntimeError, 'DUPLICATE_SETUP'):
            self.receipt.snapshot(passed=True)

    def test_missing_setup_or_partial_flow_cannot_pass(self):
        self.receipt.mark('startup_start')
        with self.assertRaises(RuntimeError):
            self.receipt.snapshot(passed=True)
        self.assertEqual(self.receipt.snapshot()['status'], 'FAIL')

    def test_unknown_backend_route_fails_closed(self):
        status, response = self.post('/deleteBackup', b'{}')
        self.assertEqual(status, 503)
        self.assertNotIn('deleted', response)
        self.assertEqual(self.receipt.snapshot()['other_backend_calls_rejected'], 1)

    def test_rejected_get_is_counted_without_echoing_path_or_query(self):
        with self.assertRaises(urllib.error.HTTPError) as failure:
            urllib.request.urlopen(self.base + '/DO_NOT_RETAIN?secret=DO_NOT_RETAIN', timeout=2)
        self.assertEqual(failure.exception.code, 503)
        self.assertNotIn('DO_NOT_RETAIN', failure.exception.read().decode())
        self.assertEqual(self.receipt.snapshot()['other_backend_calls_rejected'], 1)
        self.assertNotIn('DO_NOT_RETAIN', json.dumps(self.receipt.snapshot()))

    def test_oversized_payload_is_rejected_without_retention(self):
        self.assertEqual(self.post('/createNewApp', b'x' * 8193)[0], 413)
        self.assertEqual(self.receipt.snapshot()['create_new_app_calls'], 0)

    def test_reset_discards_prior_sample_receipt(self):
        self.complete()
        self.receipt.reset(2)
        state = self.receipt.snapshot()
        self.assertEqual((state['sample'], state['create_new_app_calls']), (2, 0))
        self.assertEqual(state['completed_stages'], [])

    def start_retry_fixture(self):
        self.receipt.reset(6, retry=True)
        self.assertEqual(self.post('/metric', {'stage': 'retry_fixture_start'})[0], 200)
        with self.assertRaises(http.client.RemoteDisconnected):
            self.post('/createNewApp', {'publicId': 'DO_NOT_RETAIN'})

    def finish_retry_fixture(self):
        self.start_retry_fixture()
        for stage in ('retry_error_visible', 'retry_submit'):
            self.assertEqual(self.post('/metric', {'stage': stage})[0], 200)
        self.assertEqual(self.post('/createNewApp', b'{}'), (200, {'created': True}))
        for stage in product.RETRY_STAGES[3:]:
            self.assertEqual(self.post('/metric', {'stage': stage})[0], 200)

    def test_real_disconnect_then_explicit_retry_receipt_is_separate_from_timings(self):
        self.finish_retry_fixture()
        result = self.receipt.snapshot(passed=True)
        self.assertEqual(result['create_new_app_calls'], 2)
        self.assertEqual(result['transport_requests_dropped_without_commit'], 1)
        self.assertEqual(result['acknowledged_create_responses'], 1)
        self.assertEqual(result['visible_wallet_count_after_relaunch'], 1)
        self.assertFalse(result['performance_sample'])
        self.assertNotIn('raw_durations', result)
        self.assertNotIn('DO_NOT_RETAIN', json.dumps(result))
        self.assertFalse(result['pin_onboarding_progress']['complete'],
                         'optional progress must not change controlled Retry acceptance')

    def test_automatic_hidden_retry_prevents_error_marker_and_acceptance(self):
        self.start_retry_fixture()
        self.post('/createNewApp', b'{}')  # without explicit UI Retry marker
        self.assertEqual(self.post('/metric', {'stage': 'retry_error_visible'})[0], 422)
        self.assertEqual(self.receipt.snapshot()['unexpected_create_attempts'], 1)
        with self.assertRaises(RuntimeError):
            self.receipt.snapshot(passed=True)

    def test_extra_creation_after_relaunch_invalidates_retry_fixture(self):
        self.finish_retry_fixture()
        self.post('/createNewApp', b'{}')
        with self.assertRaises(RuntimeError):
            self.receipt.snapshot(passed=True)

    def test_ui_error_cannot_be_claimed_without_real_first_disconnect(self):
        self.receipt.reset(6, retry=True)
        self.post('/metric', {'stage': 'retry_fixture_start'})
        self.assertEqual(self.post('/metric', {'stage': 'retry_error_visible'})[0], 422)
        self.assertEqual(self.receipt.snapshot()['transport_requests_dropped_without_commit'], 0)


class PinFlowTests(unittest.TestCase):
    def test_markers_and_acceptance_remain_around_one_platform_scoped_skip_action(self):
        filename = Path(product.__file__).with_name('product_prepare_pin.yaml')
        header, commands = list(yaml.safe_load_all(filename.read_text()))
        self.assertEqual(header, {'appId': '${APP_ID}'})
        expected = [
            {'repeat': {'times': 4, 'commands': [{'tapOn': {'id': 'key_1'}}]}},
            {'assertVisible': 'Confirm your passcode'},
            {'repeat': {'times': 4, 'commands': [{'tapOn': {'id': 'key_1'}}]}},
            {'tapOn': 'Create'},
            {'extendedWaitUntil': {'visible': 'Continue', 'timeout': 30000}},
            {'tapOn': 'Continue'},
            {'extendedWaitUntil': {'visible': 'Cancel', 'timeout': 30000}},
            {'tapOn': 'Cancel'},
            {'extendedWaitUntil': {'visible': {'id': 'btn_skip'}, 'timeout': 30000}},
            {'tapOn': {'id': 'btn_skip'}},
            {'extendedWaitUntil': {'visible': {'id': 'view_startNewTile'}, 'timeout': 30000}},
        ]
        actions, markers, positions = [], [], []
        for command in commands:
            if 'runScript' not in command:
                actions.append(command)
                continue
            self.assertEqual(set(command), {'runScript'})
            script = command['runScript']
            self.assertEqual(set(script), {'file', 'env'})
            self.assertEqual(script['file'], 'product_pin_metric.js')
            self.assertEqual(set(script['env']), {'MARKER'})
            markers.append(script['env']['MARKER'])
            positions.append(len(actions))
        skip = actions[9:11]
        self.assertEqual(skip, [
            {'runFlow': {'when': {'platform': 'Android'}, 'commands': [{'tapOn': {
                'text': r'^Skip[ \u00A0]*$', 'childOf': {'id': 'btn_skip'}}}]}},
            {'runFlow': {'when': {'platform': 'iOS'}, 'commands': [{'tapOn': {'id': 'btn_skip'}}]}},
        ])
        for platform in ('Android', 'iOS'):
            resolved = []
            for action in actions:
                if 'runFlow' not in action:
                    resolved.append(action)
                elif action['runFlow']['when']['platform'] == platform:
                    resolved.extend(action['runFlow']['commands'])
            wanted = list(expected)
            if platform == 'Android':
                wanted[9] = {'tapOn': {'text': r'^Skip[ \u00A0]*$', 'childOf': {'id': 'btn_skip'}}}
            self.assertEqual(resolved, wanted)
            self.assertEqual(len(resolved), len(expected), 'one intended Skip command; no authored retries or extra waits')
        self.assertEqual(markers, list(product.PIN_MARKERS))
        self.assertEqual(positions, list(range(2, 10)) + [11, 12], 'both conditional source rows precede the same Skip acknowledgement')

    def test_android_label_regex_accepts_only_source_skip_label_and_space_variants(self):
        import re
        commands = list(yaml.safe_load_all(Path(product.__file__).with_name('product_prepare_pin.yaml').read_text()))[1]
        flow = next(row['runFlow'] for row in commands if 'runFlow' in row and
                    row['runFlow']['when']['platform'] == 'Android')
        tap = flow['commands'][0]['tapOn']
        self.assertEqual(tap['childOf'], {'id': 'btn_skip'})
        for text in ('Skip', 'Skip  ', 'Skip\u00a0\u00a0', 'Skip \u00a0'):
            self.assertIsNotNone(re.fullmatch(tap['text'], text))
        for text in ('Skip Backup', 'Skip for Now', 'Other Skip', 'Skip\n', 'skip'):
            self.assertIsNone(re.fullmatch(tap['text'], text))


class AndroidFailureObservationTests(unittest.TestCase):
    def test_only_sample_private_directory_and_device_are_passed_to_fixed_collector(self):
        facts = {'diagnostic_only': True, 'cause': 'UNDETERMINED', 'cleanup_status': 'DELETED'}
        module = types.SimpleNamespace(collect=mock.Mock(return_value=facts))
        spec = types.SimpleNamespace(loader=types.SimpleNamespace(exec_module=mock.Mock()))
        with mock.patch.object(product.importlib.util, 'spec_from_file_location', return_value=spec) as source, \
                mock.patch.object(product.importlib.util, 'module_from_spec', return_value=module):
            value = product.android_failure_observation(Path('/owned/sample-1'), 'emulator-5554')
        self.assertEqual(source.call_args.args[1], Path(product.__file__).with_name('android_startup_diagnosis.py'))
        module.collect.assert_called_once_with(Path('/owned/sample-1'), 'emulator-5554')
        self.assertEqual(value['facts'], facts)
        self.assertEqual(value['status'], 'COLLECTED')
        self.assertIn('no current product Metro log', value['scope'])

    def test_import_and_collector_failures_have_only_fixed_unavailable_metadata(self):
        for importing in (True, False):
            with self.subTest(importing=importing):
                loader = types.SimpleNamespace(exec_module=mock.Mock(
                    side_effect=RuntimeError('DO_NOT_RETAIN') if importing else None))
                spec = types.SimpleNamespace(loader=loader)
                module = types.SimpleNamespace(collect=mock.Mock(side_effect=RuntimeError('DO_NOT_RETAIN')))
                with mock.patch.object(product.importlib.util, 'spec_from_file_location', return_value=spec), \
                        mock.patch.object(product.importlib.util, 'module_from_spec', return_value=module):
                    value = product.android_failure_observation(Path('/owned/sample-1'), 'emulator-5554')
                self.assertEqual(value['status'], 'UNAVAILABLE')
                self.assertEqual(set(value), {'status', 'scope'})
                self.assertNotIn('DO_NOT_RETAIN', json.dumps(value))
                self.assertEqual(module.collect.call_count, 0 if importing else 1)


class PackageOverlayTests(unittest.TestCase):
    def setUp(self):
        self.original = {'name': 'fixture', 'dependencies': {'crypto-shim': '1.0.0'},
                         'scripts': {'start': 'react-native start'}, 'browser': {'path': 'before'}}
        self.installed = {**self.original, 'browser': {'path': 'react-native-path'},
                          'react-native': {'crypto': 'crypto-shim'}, 'browserify': {'transform': []}}

    def evidence(self, original=None, installed=None):
        original_bytes = json.dumps(self.original if original is None else original).encode()
        installed_bytes = json.dumps(self.installed if installed is None else installed).encode()
        return original_bytes, installed_bytes, {
            'path': 'package.json', 'allowed_fields': ['browser', 'react-native', 'browserify'],
            'before_sha256': hashlib.sha256(original_bytes).hexdigest(),
            'after_sha256': hashlib.sha256(installed_bytes).hexdigest(),
        }

    def test_recorded_mapping_overlay_is_accepted(self):
        product.verify_package_overlay(*self.evidence())

    def test_recorded_unchanged_mapping_is_accepted(self):
        product.verify_package_overlay(*self.evidence(installed=self.original))

    def test_unrecorded_changes_are_rejected(self):
        original, installed, overlay = self.evidence()
        for missing in (None, {}, {**overlay, 'after_sha256': '0' * 64}):
            with self.assertRaisesRegex(RuntimeError, 'UNRECORDED'):
                product.verify_package_overlay(original, installed, missing)

    def test_recording_must_match_committed_original_bytes(self):
        original, installed, overlay = self.evidence()
        with self.assertRaisesRegex(RuntimeError, 'UNRECORDED'):
            product.verify_package_overlay(original + b' ', installed, overlay)

    def test_hash_matching_protected_dependency_change_is_rejected(self):
        installed = {**self.installed, 'dependencies': {'crypto-shim': '2.0.0'}}
        with self.assertRaisesRegex(RuntimeError, 'PROTECTED_FIELDS_CHANGED'):
            product.verify_package_overlay(*self.evidence(installed=installed))

    def test_hash_matching_script_change_is_rejected(self):
        installed = {**self.installed, 'scripts': {'start': 'different-entrypoint'}}
        with self.assertRaisesRegex(RuntimeError, 'PROTECTED_FIELDS_CHANGED'):
            product.verify_package_overlay(*self.evidence(installed=installed))

    def test_expanded_field_allowlist_and_wrong_path_are_rejected(self):
        original, installed, overlay = self.evidence()
        for changed in ({**overlay, 'allowed_fields': overlay['allowed_fields'] + ['dependencies']},
                        {**overlay, 'path': 'another-package.json'}):
            with self.assertRaisesRegex(RuntimeError, 'UNRECORDED'):
                product.verify_package_overlay(original, installed, changed)


class VersionExpectationTests(unittest.TestCase):
    def test_installed_and_history_match_their_actual_native_format(self):
        manifest = {'version': '2.6.4', 'androidVersionCode': 627, 'iosBuildNumber': 620}
        for platform, build in [('ANDROID', 627), ('IOS', 620)]:
            expected = product.version_expectation(manifest, platform)
            self.assertRegex('2.6.4 (%d)' % build, expected['installed_regex'])
            self.assertRegex('2.6.4(%d)' % build, expected['history_regex'])
            self.assertNotRegex('2x6x4 (%d)' % build, expected['installed_regex'])

    def test_new_source_versions_do_not_reuse_previous_expected_tuple(self):
        expected = product.version_expectation({'version': '2.7.0', 'iosBuildNumber': 701}, 'IOS')
        self.assertRegex('2.7.0 (701)', expected['installed_regex'])
        self.assertNotRegex('2.6.4 (620)', expected['installed_regex'])

    def test_work_package_labels_or_missing_invalid_builds_are_rejected(self):
        for manifest in ({'version': '5.1', 'iosBuildNumber': 620},
                         {'version': '2.6.4'},
                         {'version': '2.6.4', 'iosBuildNumber': True},
                         {'version': '2.6.4', 'iosBuildNumber': -1}):
            with self.assertRaises(RuntimeError):
                product.version_expectation(manifest, 'IOS')


if __name__ == '__main__':
    unittest.main()
