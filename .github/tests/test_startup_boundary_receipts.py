"""Reserved startup status protocol; no device, native, network or secret calls."""
import importlib.util
import json
from pathlib import Path
import re
from types import SimpleNamespace
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / '.github/native' / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


receipts = load('startup_receipts_tested', 'startup_boundary_receipts.py')
diag = load('startup_diagnosis_tested', 'android_startup_diagnosis.py')


def row(stage='APP_RENDERED', pid=321, level='I', version='v1'):
    return ('10-25 12:00:00.123 %d 322 %s ReactNativeJS: KEEPER_STARTUP_BOUNDARY|%s|%s\n'
            % (pid, level, version, stage))


class StartupBoundaryTests(unittest.TestCase):
    def test_actual_app_protocol_agrees_and_all_info_events_roundtrip_without_values(self):
        source = (ROOT / 'src/utils/startup-boundary-observer.tsx').read_text()
        array = re.search(r'STARTUP_BOUNDARY_STAGES = (?:Object\.freeze\()?\[([\s\S]*?)\] as const', source)
        self.assertIsNotNone(array)
        actual_stages = tuple(re.findall(r"'([A-Z_]+)'", array[1]))
        self.assertEqual(actual_stages, receipts.STAGES)
        result = receipts.parse(''.join(row(stage) for stage in actual_stages), {321})
        self.assertEqual(result['state'], 'OBSERVED')
        self.assertEqual(result['ordered_stages'], list(actual_stages))
        self.assertEqual(result['producer_per_stage_limit'], 1)
        self.assertEqual(result['producer_total_limit'], 20)
        self.assertTrue(all(value is True for value in result['stages'].values()))
        self.assertNotIn('pid', result)
        self.assertNotIn('timestamp', result)

    def test_missing_unowned_and_unavailable_events_remain_unknown(self):
        for payload, owned in [('', {321}), (row(), set()), (row(pid=999), {321})]:
            result = receipts.parse(payload, owned)
            self.assertEqual(result['state'], 'UNKNOWN')
            self.assertTrue(all(value is None for value in result['stages'].values()))
        for owned in [{True}, {0}, {'321'}]:
            self.assertFalse(receipts.parse(row(), owned)['ownership_usable'])
        self.assertEqual(receipts.parse(row(), {321}, usable=False)['state'], 'UNKNOWN')

    def test_reserved_prefix_at_each_priority_is_never_an_ordinary_error(self):
        for level in 'VDIWEF':
            result = receipts.parse(row(level=level), {321})
            self.assertIs(result['stages']['APP_RENDERED'], True)
        result = diag.android_log(row(level='E') +
            '10-25 12:00:00.124 321 322 E ReactNativeJS: TypeError: disposable\n', {321})
        self.assertEqual(result['diagnostic_marker_records'], 1)
        self.assertEqual(result['own_error_records'], 1)
        self.assertEqual(result['fault_categories'], ['JS_TYPE_ERROR'])
        ordinary = row(level='E').replace('ReactNativeJS: KEEPER_', 'ReactNativeJS: real error mentioning KEEPER_')
        self.assertEqual(diag.android_log(ordinary, {321})['diagnostic_marker_records'], 0)

    def test_malformed_private_text_and_unsupported_fields_cannot_escape(self):
        for invalid in [row(stage='PRIVATE_SENTINEL'), row(version='v2'),
                        row().replace('|APP_RENDERED', '|APP_RENDERED|PRIVATE_SENTINEL'),
                        row().replace('|APP_RENDERED', '|APP_RENDERED\x00PRIVATE_SENTINEL'),
                        row().replace('|APP_RENDERED', '|APP_RENDERED\u2028PRIVATE_SENTINEL')]:
            result = receipts.parse(row() + invalid, {321})
            self.assertEqual(result['state'], 'PARTIAL')
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        self.assertEqual(receipts.parse(row().rstrip('\n'), {321})['state'], 'UNKNOWN')
        self.assertEqual(receipts.parse(row().replace('\n', '\r\n'), {321})['state'], 'OBSERVED')

    def test_caps_duplicates_and_partial_inputs_preserve_positive_only_scope(self):
        result = receipts.parse(row() * 41, {321})
        self.assertTrue(result['marker_limit_reached'])
        self.assertEqual(result['owned_marker_records'], 40)
        self.assertEqual(result['duplicate_records'], 39)
        self.assertEqual(result['state'], 'PARTIAL')
        self.assertEqual(receipts.parse(row(), {321}, full_input=False)['state'], 'PARTIAL')
        self.assertTrue(receipts.parse('x' * (receipts.LIMIT + 1), {321})['input_limit_exceeded'])
        self.assertTrue(all(value is None for value in receipts.parse('', {321})['stages'].values()))

    def test_actual_collector_queries_fixed_prefix_and_cleans_private_capture(self):
        calls = []
        def run(args, stdout, **options):
            calls.append((args, options))
            payload = ''
            if 'ps' in args:
                payload = 'PID NAME\n321 %s\n' % diag.APP
            elif 'activities' in args:
                payload = 'mResumedActivity: ActivityRecord{x u0 %s/.MainActivity}\n' % diag.APP
            elif '--regex' in args and '^KEEPER_STARTUP_BOUNDARY\\|' in args:
                payload = row('APP_RENDERED') + row('APP_COMMITTED')
            stdout.write(payload.encode())
            return SimpleNamespace(returncode=0)
        with tempfile.TemporaryDirectory() as name:
            private = Path(name)
            (private / 'metro.log').write_text('BUNDLE\n')
            with mock.patch.object(diag.subprocess, 'run', side_effect=run), \
                    mock.patch.object(diag, 'host_memory', return_value={}):
                result = diag.collect(private, 'emulator-5554')
            self.assertEqual(result['startup_boundary_observation']['ordered_stages'],
                             ['APP_RENDERED', 'APP_COMMITTED'])
            self.assertEqual(result['cleanup_status'], 'DELETED')
            self.assertFalse((private / 'android-startup-diagnosis').exists())
        startup = [args for args, _ in calls if '^KEEPER_STARTUP_BOUNDARY\\|' in args]
        self.assertEqual(len(startup), 1)
        self.assertIn('-d', startup[0]); self.assertIn('ReactNativeJS:V', startup[0])
        self.assertEqual(startup[0][startup[0].index('--max-count') + 1], '41')
        self.assertTrue(all(options['timeout'] == 15 for _, options in calls))

    def test_optional_parser_failure_remains_unknown_without_error_payload(self):
        with mock.patch.object(diag.importlib.util, 'spec_from_file_location',
                               side_effect=RuntimeError('PRIVATE_SENTINEL')):
            result = diag.startup_boundary_receipt(row(), {321}, usable=True, full_input=True)
        self.assertEqual(result['state'], 'UNKNOWN')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
