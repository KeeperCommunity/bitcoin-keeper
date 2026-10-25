"""Fixed own-process log classification controls; no native execution."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('ios_log_controls',
    Path(__file__).resolve().parents[1] / 'native/hosted_native.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)

ios_spec = importlib.util.spec_from_file_location('ios_pure_controls',
    Path(__file__).resolve().parents[1] / 'native/ios_startup_errors.py')
ios = importlib.util.module_from_spec(ios_spec)
ios_spec.loader.exec_module(ios)


class IOSStartupDiagnosticsTests(unittest.TestCase):
    def record(self, message, process='hexa_keeper_dev', severity='Df',
               timestamp='2026-10-22 20:00:00.123+0000', pid='123', tid='abc'):
        return '%s %s %s[%s:%s] %s' % (timestamp, severity, process, pid, tid, message)

    def assert_private_and_undetermined(self, result):
        encoded = json.dumps(result)
        for value in ['PRIVATE_SENTINEL', '/private/seed.js', 'https://private.invalid/',
                      'hexa_keeper_dev']:
            self.assertNotIn(value, encoded)
        self.assertEqual(result['cause'], 'UNDETERMINED')

    def test_known_js_native_bundle_and_network_markers_are_fixed_not_error_excerpts(self):
        cases = {
            'JS_TYPE_ERROR': 'TypeError: private value',
            'JS_REFERENCE_ERROR': 'ReferenceError: private identifier',
            'JS_SYNTAX_ERROR': 'SyntaxError: private source',
            'JS_RANGE_ERROR': 'RangeError: private value',
            'JS_INVARIANT': 'Invariant Violation: private details',
            'JS_EXCEPTION': 'Unhandled JS Exception: private details',
            'NATIVE_EXCEPTION': 'NSInvalidArgumentException: private details',
            'NATIVE_MODULE_UNAVAILABLE': 'TurboModuleRegistry: module could not be found',
            'NATIVE_LIBRARY_LOAD_ERROR': 'dyld: Library not loaded: private path',
            'HERMES_ERROR': 'Hermes fatal error: private details',
            'SCRIPT_URL_MISSING': 'No bundle URL present: private URL',
            'ATS_BLOCKED': 'NSURLErrorDomain Code=-1022 private URL',
            'CONNECTION_ERROR': 'NSURLErrorDomain Code=-1004 private URL',
        }
        for category, message in cases.items():
            with self.subTest(category=category):
                result = native.ios_startup_diagnostics(
                    self.record(message + ' PRIVATE_SENTINEL'), 'hexa_keeper_dev')
                self.assertEqual(result['category_record_counts'][category], 1)
                self.assertEqual(result['error_records'], 1)
                self.assertEqual(result['unclassified_error_records'], 0)
                self.assertEqual(result['errors'], ['IOS_STARTUP_ERROR'])
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
                self.assertNotIn(message, json.dumps(result))

    def test_foreign_process_continuation_and_ordinary_hermes_records_cannot_become_app_errors(self):
        payload = '\n'.join([
            self.record('TypeError PRIVATE_SENTINEL', process='OtherApp', severity='E'),
            'TypeError PRIVATE_SENTINEL unprefixed continuation',
            'hexa_keeper_dev[123:abc] SyntaxError PRIVATE_SENTINEL missing timestamp',
            self.record('Hermes engine initialized normally'),
        ])
        result = native.ios_startup_diagnostics(payload, 'hexa_keeper_dev')
        self.assertEqual(result['matching_process_records'], 1)
        self.assertEqual(result['error_records'], 0)
        self.assertFalse(any(result['category_record_counts'].values()))
        self.assertEqual(result['errors'], [])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_generic_errors_remain_unclassified_and_missing_records_remain_unknown(self):
        result = native.ios_startup_diagnostics('\n'.join([
            self.record('PRIVATE_SENTINEL arbitrary application text', severity='E'),
            self.record('ReferenceError PRIVATE_SENTINEL', severity='E'),
            self.record('TypeError and ReferenceError PRIVATE_SENTINEL', severity='E'),
        ]), 'hexa_keeper_dev')
        self.assertEqual(result['error_records'], 3)
        self.assertEqual(result['unclassified_error_records'], 1)
        self.assertEqual(result['category_record_counts']['JS_REFERENCE_ERROR'], 2)
        self.assertEqual(result['category_record_counts']['JS_TYPE_ERROR'], 1)
        self.assertEqual(result['parse_status'], 'PARSED')
        absent = native.ios_startup_diagnostics('PRIVATE_SENTINEL no compact records', 'hexa_keeper_dev')
        self.assertEqual(absent['parse_status'], 'UNKNOWN')
        self.assertFalse(any(absent['category_record_counts'].values()))
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps((result, absent)))

    def test_supported_compact_timestamps_severity_and_thread_formats_keep_positive_records(self):
        cases = [
            ('2026-01-15 20:41:18.941', 'Df', '11135', '3f6df'),
            ('2026-10-22 09:22:33', 'Db', '123', 'abc'),
            ('2026-10-22T09:22:33Z', 'I', '1', '0xabc'),
            ('2026-10-22 09:22:33.123456+0000', 'E', '4321', '0x58ff'),
            ('2026-10-22T09:22:33.123456789+00:00', 'F', '2147483647', 'ABCDEF0123456789'),
            ('2026-10-22 09:22:33.1-0700', 'Df', '123', 'abc'),
            ('2026-10-22T09:22:33-07:00', 'Df', '123', 'abc'),
        ]
        for timestamp, severity, pid, tid in cases:
            with self.subTest(timestamp=timestamp, severity=severity):
                result = native.ios_startup_diagnostics(self.record(
                    'TypeError\tPRIVATE_SENTINEL', timestamp=timestamp,
                    severity=severity, pid=pid, tid=tid) + '\r\n', 'hexa_keeper_dev')
                self.assertEqual(result['matching_process_records'], 1)
                self.assertEqual(result['error_records'], 1)
                self.assertEqual(result['category_record_counts']['JS_TYPE_ERROR'], 1)
                self.assertEqual(result['parse_status'], 'PARSED')
                self.assertEqual(result['malformed_record_lines'], 0)
                self.assert_private_and_undetermined(result)

    def test_invalid_record_framing_cannot_create_own_process_error_evidence(self):
        bad_records = {
            'invalid month': self.record('TypeError PRIVATE_SENTINEL', timestamp='2026-99-22 09:22:33'),
            'invalid day': self.record('TypeError PRIVATE_SENTINEL', timestamp='2026-02-30 09:22:33'),
            'invalid time': self.record('TypeError PRIVATE_SENTINEL', timestamp='2026-10-22 25:22:33'),
            'unknown severity': self.record('TypeError PRIVATE_SENTINEL', severity='INJECTED'),
            'zero pid': self.record('TypeError PRIVATE_SENTINEL', pid='0'),
            'pid beyond signed range': self.record('TypeError PRIVATE_SENTINEL', pid='2147483648'),
            'oversized pid': self.record('TypeError PRIVATE_SENTINEL', pid='9999999999'),
            'nonhex thread': self.record('TypeError PRIVATE_SENTINEL', tid='xxx'),
            'nul': self.record('TypeError PRIVATE_SENTINEL\x00'),
            'embedded carriage return': self.record('TypeError PRIVATE_SENTINEL\rforged'),
            'vertical tab forged prefix': self.record('ordinary startup') + '\x0b' +
                self.record('TypeError PRIVATE_SENTINEL'),
        }
        for kind, payload in bad_records.items():
            with self.subTest(kind=kind):
                result = native.ios_startup_diagnostics(payload, 'hexa_keeper_dev')
                self.assertEqual(result['matching_process_records'], 0)
                self.assertEqual(result['error_records'], 0)
                self.assertFalse(any(result['category_record_counts'].values()))
                self.assertEqual(result['errors'], [])
                self.assertEqual(result['malformed_record_lines'], 1)
                self.assertEqual(result['parse_status'], 'UNKNOWN')
                self.assert_private_and_undetermined(result)

    def test_record_byte_boundary_keeps_complete_records_and_rejects_oversized_utf8(self):
        limit = 16 * 1024
        self.assertEqual(ios.MAX_RECORD_BYTES, limit)
        prefix = self.record('TypeError PRIVATE_SENTINEL ')
        exact = prefix + 'x' * (limit - len(prefix.encode()))
        result = native.ios_startup_diagnostics(exact + '\n', 'hexa_keeper_dev')
        self.assertEqual(result['matching_process_records'], 1)
        self.assertEqual(result['category_record_counts']['JS_TYPE_ERROR'], 1)
        self.assertEqual(result['oversized_record_lines'], 0)
        self.assertEqual(result['parse_status'], 'PARSED')
        self.assert_private_and_undetermined(result)

        multibyte = self.record('TypeError PRIVATE_SENTINEL ' + '\u79d8' * (limit // 2))
        self.assertLess(len(multibyte), limit)
        self.assertGreater(len(multibyte.encode()), limit)
        for payload in [exact + 'x', multibyte]:
            with self.subTest(multibyte=payload is multibyte):
                result = native.ios_startup_diagnostics(
                    payload + '\n' + self.record('ordinary startup'), 'hexa_keeper_dev')
                self.assertEqual(result['matching_process_records'], 1)
                self.assertEqual(result['error_records'], 0)
                self.assertEqual(result['oversized_record_lines'], 1)
                self.assertEqual(result['parse_status'], 'PARTIAL')
                self.assert_private_and_undetermined(result)

    def test_one_mebibyte_prefix_discards_a_cut_record_even_when_its_error_marker_fits(self):
        limit = 1024 * 1024
        self.assertEqual(ios.MAX_INPUT_BYTES, limit)
        first = self.record('No bundle URL present PRIVATE_SENTINEL') + '\n'
        cut = self.record('TypeError PRIVATE_SENTINEL ')
        padding = 'x' * (limit - len(first.encode()) - len(cut.encode()) - 9) + '\n'
        payload = first + padding + cut + 'z' * 100
        self.assertGreater(len(payload.encode()), limit)
        self.assertIn('TypeError', payload[:limit])
        result = native.ios_startup_diagnostics(payload, 'hexa_keeper_dev')
        self.assertTrue(result['input_truncated'])
        self.assertEqual(result['matching_process_records'], 1)
        self.assertEqual(result['category_record_counts']['SCRIPT_URL_MISSING'], 1)
        self.assertEqual(result['category_record_counts']['JS_TYPE_ERROR'], 0)
        self.assertEqual(result['parse_status'], 'PARTIAL')
        self.assert_private_and_undetermined(result)

        # A multibyte cut with no complete newline contributes no partial row.
        result = native.ios_startup_diagnostics(
            self.record('TypeError PRIVATE_SENTINEL ' + '\u79d8' * limit), 'hexa_keeper_dev')
        self.assertTrue(result['input_truncated'])
        self.assertEqual(result['matching_process_records'], 0)
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['parse_status'], 'UNKNOWN')
        self.assert_private_and_undetermined(result)

    def test_scan_and_own_record_limits_do_not_classify_unobserved_tail(self):
        self.assertEqual(ios.MAX_SCAN_LINES, 4096)
        self.assertEqual(ios.MAX_OWN_RECORDS, 4096)
        with mock.patch.object(ios, 'MAX_SCAN_LINES', 2):
            result = ios.classify('notice\n' +
                self.record('ordinary startup') + '\n' +
                self.record('TypeError PRIVATE_SENTINEL'), 'hexa_keeper_dev')
        self.assertTrue(result['scan_limit_reached'])
        self.assertEqual(result['matching_process_records'], 1)
        self.assertEqual(result['error_records'], 0)
        self.assertEqual(result['parse_status'], 'PARTIAL')
        self.assert_private_and_undetermined(result)

        with mock.patch.object(ios, 'MAX_OWN_RECORDS', 1):
            result = ios.classify('\n'.join([
                self.record('TypeError PRIVATE_SENTINEL', process='OtherApp'),
                self.record('ordinary startup'),
                self.record('TypeError PRIVATE_SENTINEL'),
            ]), 'hexa_keeper_dev')
        self.assertTrue(result['record_limit_reached'])
        self.assertEqual(result['matching_process_records'], 1)
        self.assertEqual(result['error_records'], 0)
        self.assertEqual(result['parse_status'], 'PARTIAL')
        self.assert_private_and_undetermined(result)

    def test_partial_input_retains_valid_positive_counts_without_claiming_complete_parse(self):
        result = native.ios_startup_diagnostics(
            self.record('TypeError PRIVATE_SENTINEL \ufffd'), 'hexa_keeper_dev')
        self.assertTrue(result['replacement_character_observed'])
        self.assertEqual(result['matching_process_records'], 1)
        self.assertEqual(result['category_record_counts']['JS_TYPE_ERROR'], 1)
        self.assertEqual(result['errors'], ['IOS_STARTUP_ERROR'])
        self.assertEqual(result['parse_status'], 'PARTIAL')
        self.assert_private_and_undetermined(result)

        result = native.ios_startup_diagnostics(self.record('ordinary startup') + '\n' +
            self.record('TypeError PRIVATE_SENTINEL', timestamp='2026-99-22 09:22:33'),
            'hexa_keeper_dev')
        self.assertEqual(result['matching_process_records'], 1)
        self.assertEqual(result['error_records'], 0)
        self.assertEqual(result['malformed_record_lines'], 1)
        self.assertEqual(result['parse_status'], 'PARTIAL')
        self.assert_private_and_undetermined(result)

    def test_observed_size_2446_generic_records_remains_complete_and_unclassified(self):
        payload = (self.record('PRIVATE_SENTINEL arbitrary application text', severity='E') + '\n') * 2446
        result = native.ios_startup_diagnostics(payload, 'hexa_keeper_dev')
        self.assertEqual(result['matching_process_records'], 2446)
        self.assertEqual(result['error_records'], 2446)
        self.assertEqual(result['unclassified_error_records'], 2446)
        self.assertFalse(any(result['category_record_counts'].values()))
        self.assertFalse(result['input_truncated'])
        self.assertFalse(result['scan_limit_reached'])
        self.assertFalse(result['record_limit_reached'])
        self.assertEqual(result['parse_status'], 'PARSED')
        self.assert_private_and_undetermined(result)

    def test_empty_foreign_and_unframed_text_remain_unknown_without_private_output(self):
        payloads = ['', 'PRIVATE_SENTINEL /private/seed.js https://private.invalid/',
                    self.record('TypeError PRIVATE_SENTINEL', process='OtherApp'),
                    '    ' + self.record('TypeError PRIVATE_SENTINEL'),
                    'malformed PRIVATE_SENTINEL \ufffd']
        for payload in payloads:
            with self.subTest(payload_present=bool(payload)):
                result = native.ios_startup_diagnostics(payload, 'hexa_keeper_dev')
                self.assertEqual(result['matching_process_records'], 0)
                self.assertEqual(result['parse_status'], 'UNKNOWN')
                self.assertEqual(result['errors'], [])
                self.assert_private_and_undetermined(result)


if __name__ == '__main__':
    unittest.main()
