"""Pure compact-log controls; these do not run iOS or establish native cause."""

import importlib.util
import json
import re
from pathlib import Path
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    'ios_startup_errors', Path(__file__).resolve().parents[1] / 'native/ios_startup_errors.py')
ios = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ios)
APP = 'hexa_keeper_dev'


def record(message, process=APP, severity='Df', timestamp='2026-10-22 09:22:33.123+0000'):
    return f'{timestamp} {severity} {process}[123:0xabc] {message}'


class IOSStartupErrorsTest(unittest.TestCase):
    def test_precise_development_marker_uses_the_shared_final_vocabulary(self):
        source = (Path(__file__).resolve().parents[2] /
                  'src/storage/startup-failure-observer.ts').read_text()
        phases = re.search(r"const PHASES = \[(.*?)\];", source, re.S)[1]
        names = re.search(r"const NAMES = \[(.*?)\];", source, re.S)[1]
        spec = importlib.util.spec_from_file_location('receipt_vocab',
            Path(__file__).resolve().parents[1] / 'native/startup_failure_receipts.py')
        receipts = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(receipts)
        self.assertEqual(tuple(re.findall(r"'([^']+)'", phases)), receipts.PHASES)
        self.assertEqual(tuple(re.findall(r"'([^']+)'", names)), receipts.ERROR_NAMES)
        for phase in receipts.PHASES:
            for name in receipts.ERROR_NAMES:
                marker = f'KEEPER_STARTUP_FAILURE_V1|1500|{phase}|THREW|{name}|NONE'
                for envelope in ('', receipts.COMPACT_PREFIX):
                    result = ios.classify(record(envelope + marker, severity='E'), APP, 1000, 2000)
                    observed = result['startup_failure_receipt']
                    self.assertEqual(observed['status'], 'OBSERVED')
                    self.assertEqual(observed['records'], [{'phase': phase, 'outcome': 'THREW',
                        'error_name': name, 'code': None, 'window_relation': 'IN_WINDOW'}])
                    self.assertEqual(result['error_records'], 1)
                    self.assertEqual(result['cause'], 'UNDETERMINED')

    def test_foreign_malformed_and_private_marker_variants_cannot_claim_one_fixed_fact(self):
        marker = 'KEEPER_STARTUP_FAILURE_V1|1500|NATIVE_CREDENTIAL_READ|REJECTED|Error|-34018'
        for payload in [record(marker, process='OtherApp'), marker,
                        record('prefix ' + marker), record(marker + ' PRIVATE_SENTINEL'),
                        record('[com.facebook.react:javascript] ' + marker),
                        record('[com.facebook.react.log:native] ' + marker),
                        record('[com.facebook.react.log:javascriptX] ' + marker),
                        record('[com.facebook.react.log:javascript]  ' + marker),
                        record('[com.facebook.react.log:javascript] ' + marker + ' suffix'),
                        record(marker.replace('NATIVE_CREDENTIAL_READ', 'PRIVATE_SENTINEL')),
                        record(marker.replace('Error', 'PRIVATE_SENTINEL'))]:
            result = ios.classify(payload, APP, 1000, 2000)
            self.assertNotEqual(result['startup_failure_receipt']['status'], 'OBSERVED')
            self.assertEqual(result['startup_failure_receipt']['records'], [])
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_marker_observations_remain_bounded_and_never_establish_native_cause(self):
        marker = 'KEEPER_STARTUP_FAILURE_V1|1500|ACCOUNT_STATE|THREW|UNKNOWN|NONE'
        result = ios.classify('\n'.join([record(marker, severity='E')] * 40), APP, 1000, 2000)
        observed = result['startup_failure_receipt']
        self.assertEqual(len(observed['records']), 1)
        self.assertTrue(observed['limit_reached'])
        self.assertEqual(observed['status'], 'AMBIGUOUS')
        self.assertEqual(result['error_records'], 40)
        self.assertEqual(result['cause'], 'UNDETERMINED')
        self.assertNotIn('PASS', json.dumps(result))

    def test_exact_process_prefix_preserves_existing_generic_error_contract(self):
        payload = '\n'.join([
            'Filtering the log data using the process predicate',
            'Timestamp               Ty Process[PID:TID]',
            record('NSException: PRIVATE_SENTINEL', severity='E'),
            record('normal startup message'),
            record('ReferenceError: private startup module'),
            record('NSException: native startup failed', timestamp='2026-10-22T09:22:33.123Z'),
            record('Error: ' + APP, process='OtherApp', severity='E'),
            record('TypeError: private', process=APP + '_foreign'),
            record('TypeError: private', process='prefix_' + APP),
            'Error: ' + APP + '[123:abc] missing timestamp',
        ])
        result = ios.classify(payload, APP)
        self.assertEqual((result['format'], result['matching_process_records'], result['errors']),
                         ('compact', 4, ['IOS_STARTUP_ERROR']))
        self.assertEqual(result['error_records'], 3)
        self.assertEqual(result['category_record_counts']['NATIVE_EXCEPTION'], 2)
        self.assertEqual(result['category_record_counts']['JS_REFERENCE_ERROR'], 1)
        self.assertEqual(result['parse_status'], 'PARSED')

    def test_fixed_categories_count_records_without_retaining_messages(self):
        samples = {
            'JS_TYPE_ERROR': 'TypeError: PRIVATE_SENTINEL',
            'JS_REFERENCE_ERROR': 'ReferenceError: PRIVATE_SENTINEL',
            'JS_SYNTAX_ERROR': 'SyntaxError: PRIVATE_SENTINEL',
            'JS_RANGE_ERROR': 'RangeError: PRIVATE_SENTINEL',
            'JS_EXCEPTION': 'Unhandled JS Exception: PRIVATE_SENTINEL',
            'JS_INVARIANT': 'Invariant Violation: PRIVATE_SENTINEL has not been registered',
            'SCRIPT_URL_MISSING': 'No script URL provided. PRIVATE_SENTINEL',
            'SCRIPT_LOAD_ERROR': 'Unable to load script PRIVATE_SENTINEL',
            'MODULE_RESOLUTION_ERROR': 'Unable to resolve module PRIVATE_SENTINEL',
            'NATIVE_MODULE_UNAVAILABLE': 'TurboModuleRegistry: PRIVATE_SENTINEL could not be found',
            'NATIVE_LIBRARY_LOAD_ERROR': 'dlopen failed PRIVATE_SENTINEL',
            'CONNECTION_ERROR': 'ECONNREFUSED PRIVATE_SENTINEL',
            'NATIVE_EXCEPTION': 'NSInvalidArgumentException PRIVATE_SENTINEL',
            'EXCEPTION_MARKER': 'SyntheticPrivateException PRIVATE_SENTINEL',
            'FATAL_MARKER': 'fatal error PRIVATE_SENTINEL',
        }
        for category, message in samples.items():
            with self.subTest(category=category):
                result = ios.classify(record(message) + '\n' + record(message), APP)
                self.assertEqual(result['category_record_counts'][category], 2)
                self.assertEqual(result['error_records'], 2)
                self.assertEqual(result['unclassified_error_records'], 0)
                self.assertEqual(set(result['category_record_counts']), set(ios.CATEGORIES))
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        result = ios.classify(record('TypeError TypeError: PRIVATE_SENTINEL'), APP)
        self.assertEqual(result['category_record_counts']['JS_TYPE_ERROR'], 1)

    def test_normal_module_method_name_does_not_establish_an_error(self):
        result = ios.classify(record('TurboModuleRegistry.getEnforcing normal call PRIVATE_SENTINEL'), APP)
        self.assertEqual(result['matching_process_records'], 1)
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['category_record_counts']['NATIVE_MODULE_UNAVAILABLE'], 0)
        for marker in ['missing', 'null', 'failed', 'could not be found']:
            with self.subTest(marker=marker):
                result = ios.classify(record('TurboModuleRegistry.getEnforcing: PRIVATE_SENTINEL ' + marker), APP)
                self.assertEqual(result['category_record_counts']['NATIVE_MODULE_UNAVAILABLE'], 1)

    def test_replacement_text_preserves_positive_counts_without_claiming_complete_parse(self):
        result = ios.classify(record('TypeError: PRIVATE_SENTINEL \ufffd'), APP)
        self.assertTrue(result['replacement_character_observed'])
        self.assertEqual(result['matching_process_records'], 1)
        self.assertEqual(result['category_record_counts']['JS_TYPE_ERROR'], 1)
        self.assertEqual(result['errors'], ['IOS_STARTUP_ERROR'])
        self.assertEqual(result['parse_status'], 'PARTIAL')
        result = ios.classify('malformed PRIVATE_SENTINEL \ufffd', APP)
        self.assertTrue(result['replacement_character_observed'])
        self.assertEqual(result['parse_status'], 'UNKNOWN')
        self.assertEqual(result['errors'], [])

    def test_generic_errors_remain_visible_and_do_not_invent_a_category(self):
        result = ios.classify('\n'.join([
            record('PRIVATE_SENTINEL arbitrary text', severity='E'),
            record('Error: PRIVATE_SENTINEL arbitrary text'),
            record('ordinary startup message'),
        ]), APP)
        self.assertEqual(result['matching_process_records'], 3)
        self.assertEqual(result['error_records'], 2)
        self.assertEqual(result['unclassified_error_records'], 2)
        self.assertFalse(any(result['category_record_counts'].values()))
        self.assertEqual(result['errors'], ['IOS_STARTUP_ERROR'])

    def test_multiline_foreign_and_embedded_prefix_text_are_never_attributed(self):
        own = record('normal startup message')
        payload = '\n'.join([
            record('TypeError: PRIVATE_SENTINEL', process='OtherApp', severity='E'),
            '    ' + record('ReferenceError: PRIVATE_SENTINEL'),
            record('foreign message ' + record('NSException: PRIVATE_SENTINEL'), process='OtherApp'),
            own, 'TypeError: PRIVATE_SENTINEL unprefixed stack continuation',
            '  at PRIVATE_SENTINEL (/private/seed.js:1)',
        ])
        result = ios.classify(payload, APP)
        self.assertEqual(result['matching_process_records'], 1)
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['error_records'], 0)
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_malformed_dates_severity_pid_tid_and_control_injection_are_skipped(self):
        malformed = [
            record('TypeError: PRIVATE_SENTINEL', timestamp='2026-99-22 09:22:33'),
            record('TypeError: PRIVATE_SENTINEL', severity='INJECTED'),
            record('TypeError: PRIVATE_SENTINEL').replace('[123:', '[0:'),
            record('TypeError: PRIVATE_SENTINEL').replace('[123:', '[9999999999:'),
            record('TypeError: PRIVATE_SENTINEL').replace('0xabc]', 'xxx]'),
            record('TypeError: PRIVATE_SENTINEL\x00'),
            record('TypeError: PRIVATE_SENTINEL\rforged'),
        ]
        result = ios.classify('\n'.join(malformed), APP)
        self.assertEqual(result['matching_process_records'], 0)
        self.assertEqual(result['malformed_record_lines'], len(malformed))
        self.assertEqual(result['parse_status'], 'UNKNOWN')
        self.assertEqual(result['errors'], [])

    def test_invalid_selectors_and_payload_types_raise_only_fixed_errors(self):
        for executable in ['', '../PRIVATE_SENTINEL', 'app" OR true', 'app[1:abc]',
                           'app\nPRIVATE_SENTINEL', 'a' * 129, None, 123]:
            with self.subTest(executable=type(executable).__name__), self.assertRaises(ValueError) as error:
                ios.classify('', executable)
            self.assertEqual(str(error.exception), 'Unsafe iOS executable selector.')
        for payload in [None, b'PRIVATE_SENTINEL', 123, {}]:
            with self.subTest(payload=type(payload).__name__), self.assertRaises(TypeError) as error:
                ios.classify(payload, APP)
            self.assertEqual(str(error.exception), 'Expected compact log text.')

    def test_oversized_records_are_not_partially_classified(self):
        result = ios.classify(record('TypeError ' + 'x' * ios.MAX_RECORD_BYTES) + '\n' +
                              record('normal startup message'), APP)
        self.assertEqual(result['matching_process_records'], 1)
        self.assertEqual(result['oversized_record_lines'], 1)
        self.assertEqual(result['parse_status'], 'PARTIAL')
        self.assertEqual(result['errors'], [])
        result = ios.classify(record('TypeError ' + '\u79d8' * (ios.MAX_RECORD_BYTES // 2)), APP)
        self.assertEqual(result['oversized_record_lines'], 1)
        self.assertEqual(result['matching_process_records'], 0)

    def test_input_limit_keeps_launch_prefix_and_discards_partial_record(self):
        first = record('No script URL provided. PRIVATE_SENTINEL') + '\n'
        # The first byte beyond the cap belongs to a record, not a continuation.
        padding = 'x' * (ios.MAX_INPUT_BYTES - len(first) - 10) + '\n'
        result = ios.classify(first + padding + record('TypeError PRIVATE_SENTINEL'), APP)
        self.assertTrue(result['input_truncated'])
        self.assertEqual(result['matching_process_records'], 1)
        self.assertEqual(result['category_record_counts']['SCRIPT_URL_MISSING'], 1)
        self.assertEqual(result['category_record_counts']['JS_TYPE_ERROR'], 0)
        self.assertEqual(result['parse_status'], 'PARTIAL')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        result = ios.classify(record('TypeError ' + '\u79d8' * ios.MAX_INPUT_BYTES), APP)
        self.assertTrue(result['input_truncated'])
        self.assertEqual(result['matching_process_records'], 0)

    def test_scan_and_record_limits_are_explicit_and_do_not_parse_tail(self):
        with mock.patch.object(ios, 'MAX_SCAN_LINES', 2):
            result = ios.classify('notice\n' + record('ordinary startup') + '\n' +
                                  record('TypeError PRIVATE_SENTINEL'), APP)
        self.assertTrue(result['scan_limit_reached'])
        self.assertEqual(result['matching_process_records'], 1)
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['parse_status'], 'PARTIAL')
        with mock.patch.object(ios, 'MAX_OWN_RECORDS', 1):
            result = ios.classify(record('ordinary startup') + '\n' +
                                  record('TypeError PRIVATE_SENTINEL'), APP)
        self.assertTrue(result['record_limit_reached'])
        self.assertEqual(result['matching_process_records'], 1)
        self.assertEqual(result['errors'], [])

    def test_existing_short_2446_record_launch_window_remains_observable(self):
        result = ios.classify((record('NSException: private startup message') + '\n') * 2446, APP)
        self.assertEqual(result['matching_process_records'], 2446)
        self.assertEqual(result['error_records'], 2446)
        self.assertEqual(result['category_record_counts']['NATIVE_EXCEPTION'], 2446)
        self.assertFalse(result['scan_limit_reached'])
        self.assertFalse(result['input_truncated'])

    def test_empty_foreign_normal_and_error_logs_never_infer_cause_or_acceptance(self):
        for payload in ['', 'not compact PRIVATE_SENTINEL', record('normal startup'),
                        record('TypeError PRIVATE_SENTINEL', process='OtherApp'),
                        record('TypeError PRIVATE_SENTINEL')]:
            with self.subTest(payload=bool(payload)):
                result = ios.classify(payload, APP)
                self.assertEqual(result['cause'], 'UNDETERMINED')
                self.assertNotIn('PASS', json.dumps(result))
                self.assertNotIn('executable', result)
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
                self.assertNotIn(APP, json.dumps(result))
        self.assertEqual(ios.classify('', APP)['parse_status'], 'UNKNOWN')
        self.assertEqual(ios.classify(record('TypeError', process='OtherApp'), APP)['parse_status'], 'UNKNOWN')


if __name__ == '__main__':
    unittest.main()
