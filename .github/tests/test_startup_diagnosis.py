import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('startup_diagnosis_fixture', Path(__file__).resolve().parents[1] / 'native/startup_diagnosis.py')
diagnosis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnosis)


class StartupDiagnosisTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.native = SimpleNamespace(PRIVATE=self.root, PLATFORM='ANDROID')

    def test_rejects_physical_device_and_closes_failed_capture(self):
        with self.assertRaises(ValueError):
            diagnosis.start(self.native, 'physical-PRIVATE_SENTINEL')
        with mock.patch.object(diagnosis.subprocess, 'Popen', side_effect=OSError('PRIVATE_SENTINEL')):
            with self.assertRaises(OSError):
                diagnosis.start(self.native, 'emulator-5554')
        diagnosis.stop(None)

    def test_owned_capture_stops_only_its_process(self):
        process = mock.Mock()
        process.poll.return_value = None
        with mock.patch.object(diagnosis.subprocess, 'Popen', return_value=process) as popen:
            handle = diagnosis.start(self.native, 'emulator-5554')
        self.assertIn('ReactHost:V', popen.call_args.args[0])
        self.assertIn('-T', popen.call_args.args[0])
        diagnosis.stop(handle)
        process.terminate.assert_called_once_with()
        process.wait.assert_called_once_with(timeout=3)
        self.assertTrue(handle.output.closed)

    def test_regenerates_only_allowlisted_metadata(self):
        (self.root / 'startup-logcat.log').write_text('E/ReactHost(123): TypeError PRIVATE_SENTINEL\nANR in ' + diagnosis.APP)
        observations = [
            {'time_ms': 100, 'kind': 'ERROR', 'event': 'bundling_error', 'error_type': 'PRIVATE_SENTINEL', 'categories': ['TYPE', 'PRIVATE_SENTINEL'] * 100, 'raw': 'PRIVATE_SENTINEL'},
            {'time_ms': 200, 'kind': 'REQUEST', 'request': 'ENTRY_BUNDLE', 'options': {'lazy': True, 'app': 'PRIVATE_SENTINEL', 'platform': 'android', 'unknown': 'PRIVATE_SENTINEL'}},
            {'time_ms': 200, 'kind': 'RESPONSE', 'request': 'ENTRY_BUNDLE', 'outer_http_status': 500, 'url': 'PRIVATE_SENTINEL'},
            {'time_ms': 200, 'kind': 'PRIVATE_SENTINEL'},
        ]
        (self.root / 'startup-observer.jsonl').write_text('\n'.join(json.dumps(row) for row in observations))
        directory = self.root / 'maestro-output' / 'screen-hierarchy'
        directory.mkdir(parents=True)
        values = ['Unable to check your passcode. Please try again.', 'Retry', 'Dismiss', 'Minimize', 'PRIVATE_SENTINEL']
        (directory / 'step-1.json').write_text(json.dumps({'children': [{'attributes': {'text': value}} for value in values]}))
        def subprocess_result(args, **kwargs):
            if 'pidof' in args:
                return SimpleNamespace(returncode=0, stdout=b'123\n')
            kwargs['stdout'].write(('mResumedActivity: ActivityRecord{abc u0 ' + diagnosis.APP + '/.MainActivity t42} PRIVATE_SENTINEL').encode())
            return SimpleNamespace(returncode=0)
        with mock.patch.object(diagnosis.subprocess, 'run', side_effect=subprocess_result):
            facts = diagnosis.collect(self.native, 'emulator-5554', SimpleNamespace(started_ms=150))
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))
        self.assertEqual(facts['metro']['rows'][0]['categories'], ['TYPE'])
        self.assertEqual(facts['metro']['rows'][0]['stage'], 'BEFORE_APP')
        self.assertEqual(facts['metro']['rows'][1]['stage'], 'APP_WINDOW')
        self.assertEqual(facts['metro']['invalid_rows'], 1)
        self.assertTrue(facts['hierarchy']['credential_error'])
        self.assertTrue(facts['hierarchy']['logbox_controls'])
        self.assertTrue(facts['foreground']['own_app_resumed'])
        self.assertTrue(facts['process']['alive'])

    def test_failed_malformed_foreign_and_truncated_queries_do_not_claim_absence(self):
        for code, pid, foreground, oversized in [
            (1, b'', 'permission denied PRIVATE_SENTINEL', False),
            (0, b'PRIVATE_SENTINEL', 'malformed PRIVATE_SENTINEL', False),
            (0, b'', 'mResumedActivity: ActivityRecord{x u0 ' + diagnosis.APP + '.foreign/.MainActivity t1}', False),
            (0, b'', 'mResumedActivity: ActivityRecord{x u0 foreign/.MainActivity t1} ' + diagnosis.APP + '/.MainActivity', False),
            (0, b'123\n', 'mResumedActivity: ActivityRecord{x u0 ' + diagnosis.APP + '/.MainActivity t1}', True),
        ]:
            with self.subTest(code=code, oversized=oversized):
                def run(args, **kwargs):
                    if 'pidof' in args:
                        return SimpleNamespace(returncode=code, stdout=pid)
                    kwargs['stdout'].write((foreground + ('x' * (1024 * 1024 + 1) if oversized else '')).encode())
                    return SimpleNamespace(returncode=code)
                with mock.patch.object(diagnosis.subprocess, 'run', side_effect=run):
                    facts = diagnosis.collect(self.native, 'emulator-5554')
                self.assertIsNone(facts['foreground']['own_app_resumed'])
                if not oversized:
                    self.assertIsNone(facts['process']['alive'])
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))

    def test_private_size_bounds_and_symlink_rejection(self):
        path = self.root / 'large.log'
        path.write_bytes(b'a' * (1024 * 1024 + 1))
        payload, truncated = diagnosis._read(self.native, path)
        self.assertTrue(truncated)
        self.assertLessEqual(len(payload), 1024 * 1024 + 1)
        link = self.root / 'link.log'
        link.symlink_to(path)
        with self.assertRaises(ValueError):
            diagnosis._read(self.native, link)
        small = self.root / 'small.json'
        small.write_text(json.dumps({'padding': 'x' * (600 * 1024)}))
        payload, truncated = diagnosis._read(self.native, small)
        self.assertFalse(truncated)
        self.assertEqual(len(json.loads(payload)['padding']), 600 * 1024)

    def test_ios_observation_uses_no_extra_capture_process_or_device_queries(self):
        native = SimpleNamespace(PRIVATE=self.root, PLATFORM='IOS')
        device = '12345678-1234-1234-1234-123456789ABC'
        (self.root / 'startup-observer.jsonl').write_text(json.dumps({
            'time_ms': 1000, 'kind': 'REQUEST', 'request': 'ENTRY_BUNDLE',
            'options': {'platform': 'ios', 'app': 'EXPECTED', 'lazy': True,
                        'arbitrary': 'PRIVATE_SENTINEL'}})+'\n')
        with mock.patch.object(diagnosis.time, 'time', return_value=1), \
                mock.patch.object(diagnosis.subprocess, 'Popen') as popen, \
                mock.patch.object(diagnosis.subprocess, 'run') as run:
            handle = diagnosis.start(native, device)
            facts = diagnosis.collect(native, device, handle)
            diagnosis.stop(handle)
        popen.assert_not_called()
        run.assert_not_called()
        self.assertIsNone(handle.process)
        self.assertEqual(facts['metro']['rows'][0]['options']['platform'], 'ios')
        self.assertEqual(facts['metro']['rows'][0]['options']['app'], 'EXPECTED')
        self.assertEqual(facts['metro']['rows'][0]['stage'], 'APP_WINDOW')
        self.assertEqual(facts['hierarchy']['observation_state'], 'UNKNOWN')
        self.assertEqual(facts['process']['state'], 'UNKNOWN')
        for key in ['logcat', 'foreground']:
            self.assertNotIn(key, facts)
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))
        with self.assertRaises(ValueError):
            diagnosis.start(native, 'physical-PRIVATE_SENTINEL')

    def test_malformed_future_and_capped_metro_rows_remain_honest_on_ios(self):
        native = SimpleNamespace(PRIVATE=self.root, PLATFORM='IOS')
        device = '12345678-1234-1234-1234-123456789ABC'
        rows = [[], {'time_ms': True},
                {'time_ms': 1000, 'kind': 'ERROR', 'event': 'bundling_error', 'categories': 'TYPE PRIVATE_SENTINEL'},
                {'time_ms': 1000, 'kind': 'REQUEST', 'request': 'ENTRY_BUNDLE', 'options': 'PRIVATE_SENTINEL'},
                {'time_ms': 2001, 'kind': 'BUILD', 'event': 'bundle_build_done', 'platform': 'PRIVATE_SENTINEL'}]
        (self.root / 'startup-observer.jsonl').write_text('\n'.join(map(json.dumps, rows)))
        with mock.patch.object(diagnosis.time, 'time', return_value=2):
            facts = diagnosis.collect(native, device, SimpleNamespace(started_ms=1500))
        self.assertEqual(facts['metro']['invalid_rows'], 4)
        self.assertEqual(facts['metro']['rows'][0]['stage'], 'UNKNOWN')
        self.assertEqual(facts['metro']['rows'][0]['platform'], 'OTHER')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))
        row = {'time_ms': 1000, 'kind': 'BUILD', 'event': 'bundle_build_done', 'platform': 'ios'}
        (self.root / 'startup-observer.jsonl').write_text((json.dumps(row)+'\n')*1100)
        facts = diagnosis.collect(native, device)
        self.assertEqual(len(facts['metro']['rows']), 512)
        self.assertTrue(facts['metro']['line_scan_truncated'])
        self.assertTrue(facts['metro']['producer_limit_may_be_reached'])
        self.assertEqual(facts['metro']['coverage'], 'PARTIAL_OR_CAPPED')
        self.assertEqual(facts['metro']['rows'][0]['stage'], 'UNKNOWN')

    def test_ios_missing_or_private_alias_inputs_cannot_create_observation_pass(self):
        native = SimpleNamespace(PRIVATE=self.root, PLATFORM='IOS')
        device = '12345678-1234-1234-1234-123456789ABC'
        facts = diagnosis.collect(native, device)
        self.assertIn('metro', facts['collection_errors'])
        self.assertEqual(facts['metro']['coverage'], 'UNKNOWN')
        self.assertEqual(facts['metro']['rows'], [])
        actual = self.root / 'private-actual.jsonl'
        actual.write_text('PRIVATE_SENTINEL')
        (self.root / 'startup-observer.jsonl').symlink_to(actual)
        facts = diagnosis.collect(native, device)
        self.assertIn('metro', facts['collection_errors'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))


    def test_ios_timestamp_only_start_collects_metro_on_success_without_native_commands(self):
        native = SimpleNamespace(PRIVATE=self.root, PLATFORM='IOS')
        device = '12345678-1234-1234-1234-123456789ABC'
        rows = [
            {'time_ms': 149, 'kind': 'BUILD', 'event': 'bundle_build_done'},
            {'time_ms': 150, 'kind': 'REQUEST', 'request': 'ENTRY_BUNDLE',
             'options': {'platform': 'ios', 'app': 'EXPECTED', 'private': 'PRIVATE_SENTINEL'}},
            {'time_ms': 151, 'kind': 'RESPONSE', 'request': 'ENTRY_BUNDLE', 'outer_http_status': 200},
        ]
        (self.root / 'startup-observer.jsonl').write_text('\n'.join(json.dumps(row) for row in rows))
        with mock.patch.object(diagnosis.time, 'time', side_effect=[0.150, 0.152]), \
                mock.patch.object(diagnosis.subprocess, 'Popen') as popen, \
                mock.patch.object(diagnosis.subprocess, 'run') as run:
            handle = diagnosis.start(native, device)
            facts = diagnosis.collect(native, device, handle)
            diagnosis.stop(handle)
        self.assertEqual(handle.started_ms, 150)
        self.assertIsNone(handle.process)
        self.assertIsNone(handle.output)
        popen.assert_not_called()
        run.assert_not_called()
        self.assertEqual([row['stage'] for row in facts['metro']['rows']],
                         ['BEFORE_APP', 'APP_WINDOW', 'APP_WINDOW'])
        self.assertEqual(facts['metro']['rows'][-1]['outer_http_status'], 200)
        self.assertEqual(facts['metro']['observation_state'], 'ROWS_OBSERVED')
        self.assertEqual(facts['metro']['coverage'], 'BOUNDED_INPUT_ONLY')
        self.assertEqual(facts['metro']['valid_rows_in_scanned_input'], 3)
        self.assertEqual(facts['metro']['exported_rows'], 3)
        self.assertEqual(facts['process']['state'], 'UNKNOWN')
        self.assertEqual(facts['hierarchy']['observation_state'], 'UNKNOWN')
        self.assertIsNone(facts['hierarchy']['login'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))


    def test_ios_missing_or_malformed_observation_does_not_invent_absence_or_app_stage(self):
        native = SimpleNamespace(PRIVATE=self.root, PLATFORM='IOS')
        device = '12345678-1234-1234-1234-123456789ABC'
        facts = diagnosis.collect(native, device)
        self.assertEqual(facts['metro']['observation_state'], 'UNKNOWN')
        self.assertEqual(facts['hierarchy']['observation_state'], 'UNKNOWN')
        self.assertIn('metro', facts['collection_errors'])
        (self.root / 'startup-observer.jsonl').write_text(json.dumps(
            {'time_ms': 150, 'kind': 'REQUEST', 'request': 'ENTRY_BUNDLE', 'options': {'platform': 'ios'}}))
        folder = self.root / 'maestro-output' / 'screen-hierarchy'
        folder.mkdir(parents=True)
        (folder / 'step-1.json').write_text('{PRIVATE_SENTINEL')
        facts = diagnosis.collect(native, device)
        self.assertEqual(facts['metro']['rows'][0]['stage'], 'UNKNOWN')
        self.assertEqual(facts['hierarchy']['observation_state'], 'UNKNOWN')
        self.assertIsNone(facts['hierarchy']['credential_error'])
        self.assertIn('hierarchy', facts['collection_errors'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))
        for invalid in ['booted', 'emulator-5554', 'physical-PRIVATE_SENTINEL']:
            with self.assertRaises(ValueError):
                diagnosis.start(native, invalid)


    def test_ios_public_login_and_modern_logbox_text_is_presence_only_and_fixed(self):
        native = SimpleNamespace(PRIVATE=self.root, PLATFORM='IOS')
        folder = self.root / 'maestro-output' / 'screen-hierarchy'
        folder.mkdir(parents=True)
        path = folder / 'step-1.json'
        def snapshot(values):
            path.write_text(json.dumps({'children': [
                {'attributes': {'accessibilityText': value}} for value in values]}))
            return diagnosis.hierarchy(native, folder.parent)
        public = ['Enter your passcode', 'Welcome Back',
                  'Unable to check your passcode. Please try again.', 'Retry',
                  'Uncaught Error', 'Console Warning', 'Failed to compile',
                  'This error cannot be dismissed.', 'Dismiss', 'Minimize',
                  'Log 2 of 11', 'please wait', 'PRIVATE_SENTINEL']
        facts = snapshot(public)
        for name in ['login', 'welcome_back', 'credential_error', 'retry', 'loading',
                     'logbox_error_header', 'logbox_warning_header', 'logbox_syntax_footer',
                     'logbox_controls', 'logbox_counter']:
            self.assertTrue(facts[name], name)
        self.assertFalse(facts['redbox_resource'], 'modern text need not expose native IDs')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))
        facts = snapshot(['Retry', 'PRIVATE_SENTINEL Enter your passcode', 'Log 0 of 3'])
        self.assertTrue(facts['retry'])
        for name in ['login', 'credential_error', 'loading', 'logbox_controls', 'logbox_counter']:
            self.assertFalse(facts[name], name)


    def test_ios_incomplete_or_excess_hierarchy_stays_unknown(self):
        native = SimpleNamespace(PRIVATE=self.root, PLATFORM='IOS')
        device = '12345678-1234-1234-1234-123456789ABC'
        folder = self.root / 'maestro-output' / 'screen-hierarchy'
        folder.mkdir(parents=True)
        path = folder / 'step-1.json'
        path.write_bytes(b'PRIVATE_SENTINEL' + b'x' * (1024 * 1024 + 1))
        facts = diagnosis.collect(native, device)
        self.assertEqual(facts['hierarchy']['observation_state'], 'UNKNOWN')
        self.assertIsNone(facts['hierarchy']['login'])
        for index in range(1, 10):
            (folder / ('step-%d.json' % index)).write_text('{}')
        facts = diagnosis.collect(native, device)
        self.assertEqual(facts['hierarchy']['observation_state'], 'UNKNOWN')
        self.assertIsNone(facts['hierarchy']['logbox_error_header'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))


    def test_ios_malformed_category_shapes_are_invalid_not_substring_or_key_matches(self):
        native = SimpleNamespace(PRIVATE=self.root, PLATFORM='IOS')
        device = '12345678-1234-1234-1234-123456789ABC'
        invalid = ['PRIVATE_SENTINELTYPE', {'TYPE': 'PRIVATE_SENTINEL'}, None, True, [True], [['TYPE']]]
        rows = [{'time_ms': 150, 'kind': 'ERROR', 'event': 'bundling_error',
                 'categories': value} for value in invalid]
        rows.append({'time_ms': 150, 'kind': 'ERROR', 'event': 'bundling_error',
                     'categories': ['TYPE', 'PRIVATE_SENTINEL']})
        (self.root / 'startup-observer.jsonl').write_text('\n'.join(json.dumps(row) for row in rows))
        facts = diagnosis.collect(native, device)
        self.assertEqual(facts['metro']['invalid_rows'], len(invalid))
        self.assertEqual(len(facts['metro']['rows']), 1)
        self.assertEqual(facts['metro']['rows'][0]['categories'], ['TYPE'])
        self.assertEqual(facts['metro']['valid_rows_in_scanned_input'], 1)
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))


    def test_ios_row_caps_expose_bounded_counts_and_conservative_coverage(self):
        native = SimpleNamespace(PRIVATE=self.root, PLATFORM='IOS')
        device = '12345678-1234-1234-1234-123456789ABC'
        row = {'time_ms': 150, 'kind': 'BUILD', 'event': 'bundle_build_done'}
        for count in [511, 512, 513, 1025]:
            with self.subTest(count=count):
                (self.root / 'startup-observer.jsonl').write_text('\n'.join(json.dumps(row) for _ in range(count)))
                facts = diagnosis.collect(native, device)['metro']
                self.assertEqual((facts['producer_row_limit'], facts['export_row_limit'], facts['line_scan_limit']),
                                 (512, 512, 1024))
                self.assertEqual(facts['valid_rows_in_scanned_input'], min(count, 1024))
                self.assertEqual(facts['exported_rows'], min(count, 512))
                self.assertEqual(len(facts['rows']), min(count, 512))
                self.assertEqual(facts['producer_limit_may_be_reached'], count >= 512)
                self.assertEqual(facts['export_truncated'], count > 512)
                self.assertEqual(facts['line_scan_truncated'], count > 1024)
                self.assertEqual(facts['coverage'], 'BOUNDED_INPUT_ONLY' if count < 512 else 'PARTIAL_OR_CAPPED')

    def test_ios_invalid_rows_and_possible_emitter_cap_cannot_claim_complete_coverage(self):
        native = SimpleNamespace(PRIVATE=self.root, PLATFORM='IOS')
        device = '12345678-1234-1234-1234-123456789ABC'
        row = json.dumps({'time_ms': 150, 'kind': 'BUILD', 'event': 'bundle_build_done'})
        for invalid_count in [1, 500]:
            with self.subTest(invalid_count=invalid_count):
                (self.root / 'startup-observer.jsonl').write_text(
                    ('PRIVATE_SENTINEL\n' * invalid_count) + ((row + '\n') * 12))
                facts = diagnosis.collect(native, device)['metro']
                self.assertEqual(facts['invalid_rows'], invalid_count)
                self.assertEqual(facts['valid_rows_in_scanned_input'], 12)
                self.assertEqual(facts['coverage'], 'PARTIAL_OR_CAPPED')
                self.assertEqual(facts['producer_limit_may_be_reached'], invalid_count == 500)
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))


    def test_ios_supplied_falsey_nonobject_attributes_and_nonlist_children_stay_unknown(self):
        native = SimpleNamespace(PRIVATE=self.root, PLATFORM='IOS')
        device = '12345678-1234-1234-1234-123456789ABC'
        folder = self.root / 'maestro-output' / 'screen-hierarchy'
        folder.mkdir(parents=True)
        for field, values in [('attributes', [[], None, False, 0, '']),
                              ('children', [{}, None, False, 0, ''])]:
            for value in values:
                with self.subTest(field=field, value=value):
                    (folder / 'step-1.json').write_text(json.dumps({field: value}))
                    facts = diagnosis.collect(native, device)
                    self.assertEqual(facts['hierarchy']['observation_state'], 'UNKNOWN')
                    self.assertIsNone(facts['hierarchy']['credential_error'])
                    self.assertIn('hierarchy', facts['collection_errors'])

    def test_ios_future_rows_are_unknown_and_build_options_remain_fixed_without_inheritance(self):
        native = SimpleNamespace(PRIVATE=self.root, PLATFORM='IOS')
        device = '12345678-1234-1234-1234-123456789ABC'
        rows = [
            {'time_ms': 149, 'kind': 'BUILD', 'event': 'bundle_build_started',
             'platform': 'ios', 'dev': True, 'minify': False},
            {'time_ms': 150, 'kind': 'BUILD', 'event': 'bundle_build_done'},
            {'time_ms': 200, 'kind': 'BUILD', 'event': 'bundle_build_failed',
             'platform': 'PRIVATE_SENTINEL', 'dev': 1, 'minify': 'PRIVATE_SENTINEL'},
            {'time_ms': 201, 'kind': 'REQUEST', 'request': 'ENTRY_BUNDLE', 'options': {'platform': 'ios'}},
        ]
        (self.root / 'startup-observer.jsonl').write_text('\n'.join(json.dumps(row) for row in rows))
        with mock.patch.object(diagnosis.time, 'time', return_value=0.200):
            facts = diagnosis.collect(native, device, SimpleNamespace(started_ms=150))['metro']
        self.assertEqual([row['stage'] for row in facts['rows']], ['BEFORE_APP', 'APP_WINDOW', 'APP_WINDOW', 'UNKNOWN'])
        self.assertEqual({key: facts['rows'][0][key] for key in ['platform', 'dev', 'minify']},
                         {'platform': 'ios', 'dev': True, 'minify': False})
        self.assertEqual({key: facts['rows'][1][key] for key in ['platform', 'dev', 'minify']},
                         {'platform': None, 'dev': None, 'minify': None})
        self.assertEqual({key: facts['rows'][2][key] for key in ['platform', 'dev', 'minify']},
                         {'platform': 'OTHER', 'dev': None, 'minify': None})
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))

    def test_ios_row_and_options_shapes_are_invalid_and_android_retains_canonical_fields(self):
        native = SimpleNamespace(PRIVATE=self.root, PLATFORM='IOS')
        device = '12345678-1234-1234-1234-123456789ABC'
        rows = [[], None, 'PRIVATE_SENTINEL',
                {'time_ms': 150, 'kind': 'REQUEST', 'request': 'ENTRY_BUNDLE', 'options': []},
                {'time_ms': 150, 'kind': 'REQUEST', 'request': 'ENTRY_BUNDLE', 'options': 'PRIVATE_SENTINEL'}]
        path = self.root / 'startup-observer.jsonl'
        path.write_text('\n'.join(json.dumps(row) for row in rows))
        facts = diagnosis.collect(native, device)['metro']
        self.assertEqual(facts['invalid_rows'], len(rows))
        self.assertEqual(facts['rows'], [])
        self.assertEqual(facts['coverage'], 'UNKNOWN')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(facts))
        path.write_text(json.dumps({'time_ms': 201, 'kind': 'BUILD', 'event': 'bundle_build_started',
                                    'platform': 'android', 'dev': True, 'minify': False}))
        with mock.patch.object(diagnosis.time, 'time', return_value=0.200), \
                mock.patch.object(diagnosis.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout=b'')):
            facts = diagnosis.collect(self.native, 'emulator-5554', SimpleNamespace(started_ms=150))['metro']
        self.assertEqual(facts['rows'][0]['stage'], 'UNKNOWN', 'retain the reviewed canonical future bound')
        self.assertEqual(facts['rows'][0]['platform'], 'android')
        self.assertIs(facts['rows'][0]['dev'], True)
        self.assertIs(facts['rows'][0]['minify'], False)
        self.assertNotIn('coverage', facts)



if __name__ == '__main__':
    unittest.main()
