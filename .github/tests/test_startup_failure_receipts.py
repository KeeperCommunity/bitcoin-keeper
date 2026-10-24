"""Pure fixed-marker controls; no native query, launch, or credential operation."""

import importlib.util
import json
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location(
    'startup_failure_receipts',
    Path(__file__).resolve().parents[1] / 'native/startup_failure_receipts.py')
receipts = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(receipts)
APP = 'hexa_keeper_dev'
EPOCH = 1792710000000
STAMP = '2026-10-22 20:41:18.941'


def marker(epoch=EPOCH, phase='NATIVE_CREDENTIAL_READ', outcome='REJECTED',
           name='Error', code='-34018'):
    return '%s|%s|%s|%s|%s|%s' % (
        receipts.MARKER, epoch, phase, outcome, name, code)


class StartupFailureReceiptsTests(unittest.TestCase):
    def collector(self):
        return receipts.Collector(APP, EPOCH - 100, EPOCH + 100)

    def observe(self, collector, message=None, process=APP, pid='123', timestamp=STAMP):
        collector.observe(timestamp, process, pid, marker() if message is None else message)

    def assert_private_and_optional(self, result):
        encoded = json.dumps(result)
        for private in ['PRIVATE_SENTINEL', 'https://private.invalid/', '/private/seed.js',
                        APP, STAMP, str(EPOCH), 'service-name', 'username', 'password']:
            self.assertNotIn(private, encoded)
        self.assertEqual(result['cause'], 'UNDETERMINED')
        self.assertNotIn('PASS', encoded)
        self.assertNotIn('selected_failure', result)
        self.assertLessEqual(len(result['records']), 32)

    def test_one_exact_original_read_rejection_exports_fixed_facts_only(self):
        collector = self.collector()
        self.observe(collector)
        result = collector.result()
        self.assertEqual(result['status'], 'OBSERVED')
        self.assertEqual(result['window'], 'BOUNDED')
        self.assertEqual(result['records'], [{
            'phase': 'NATIVE_CREDENTIAL_READ', 'outcome': 'REJECTED',
            'error_name': 'Error', 'code': -34018, 'window_relation': 'IN_WINDOW',
        }])
        self.assertEqual(result['marker_records_seen'], 1)
        self.assertEqual(result['own_process_count'], 1)
        self.assertEqual(result['reasons'], [])
        self.assert_private_and_optional(result)

    def test_supported_compact_prefix_is_grammar_not_a_hosted_transport_claim(self):
        collector = self.collector()
        self.observe(collector, receipts.COMPACT_PREFIX + marker())
        result = collector.result()
        self.assertEqual(result['status'], 'OBSERVED')
        self.assertEqual(result['records'][0]['code'], -34018)
        self.assert_private_and_optional(result)
        for prefix in [' ', 'sender: ', '[OTHER:javascript] ', receipts.COMPACT_PREFIX + ' ']:
            with self.subTest(prefix_kind=prefix.split(':')[0]):
                collector = self.collector()
                self.observe(collector, prefix + marker())
                result = collector.result()
                self.assertEqual(result['status'], 'UNKNOWN')
                self.assertEqual(result['records'], [])
                self.assertIn('UNSUPPORTED_FRAMING', result['reasons'])
                self.assert_private_and_optional(result)

    def test_each_phase_and_fixed_error_name_preserves_failure_scope(self):
        for phase in receipts.PHASES:
            for name in receipts.ERROR_NAMES:
                with self.subTest(phase=phase, name=name):
                    collector = self.collector()
                    self.observe(collector, marker(phase=phase, outcome='THREW', name=name, code='NONE'))
                    result = collector.result()
                    self.assertEqual(result['status'], 'OBSERVED')
                    self.assertEqual(result['records'][0], {
                        'phase': phase, 'outcome': 'THREW', 'error_name': name,
                        'code': None, 'window_relation': 'IN_WINDOW',
                    })
                    self.assert_private_and_optional(result)

    def test_code_is_canonical_int32_only_at_native_rejection_boundary(self):
        for code in ['-2147483648', '2147483647', '0', '-25300', 'NONE']:
            with self.subTest(code=code):
                collector = self.collector()
                self.observe(collector, marker(code=code))
                result = collector.result()
                self.assertEqual(result['status'], 'OBSERVED')
                self.assertEqual(result['records'][0]['code'], None if code == 'NONE' else int(code))
                self.assert_private_and_optional(result)
        invalid = ['-2147483649', '2147483648', '+1', '01', '-0', '1.0',
                   'NaN', '1e3', '1\u0662', '', 'PRIVATE_SENTINEL']
        for code in invalid:
            with self.subTest(code_kind=code[:4]):
                collector = self.collector()
                self.observe(collector, marker(code=code))
                result = collector.result()
                self.assertEqual(result['status'], 'UNKNOWN')
                self.assertEqual(result['records'], [])
                self.assertIn('MALFORMED_MARKER', result['reasons'])
                self.assert_private_and_optional(result)
        for phase, outcome in [('ACCOUNT_STATE', 'THREW'), ('CREDENTIAL_JSON', 'THREW'),
                               ('NAVIGATION', 'THREW'), ('NATIVE_CREDENTIAL_READ', 'THREW')]:
            collector = self.collector()
            self.observe(collector, marker(phase=phase, outcome=outcome, code='-34018'))
            self.assertEqual(collector.result()['status'], 'UNKNOWN')
        for phase in ['ACCOUNT_STATE', 'CREDENTIAL_JSON', 'NAVIGATION']:
            collector = self.collector()
            self.observe(collector, marker(phase=phase, outcome='REJECTED', code='NONE'))
            result = collector.result()
            self.assertEqual(result['status'], 'UNKNOWN')
            self.assertIn('MALFORMED_MARKER', result['reasons'])

    def test_missing_invalid_and_partial_capture_cannot_establish_attribution(self):
        for start, end, reason in [(None, None, 'MISSING_WINDOW'), (EPOCH, None, 'MISSING_WINDOW'),
                                   (EPOCH + 1, EPOCH, 'INVALID_WINDOW'),
                                   (True, EPOCH, 'INVALID_WINDOW'), (-1, EPOCH, 'INVALID_WINDOW')]:
            with self.subTest(reason=reason):
                collector = receipts.Collector(APP, start, end)
                self.observe(collector)
                result = collector.result()
                self.assertEqual(result['status'], 'UNKNOWN')
                self.assertEqual(result['records'], [])
                self.assertIn(reason, result['reasons'])
                self.assert_private_and_optional(result)
        collector = self.collector()
        self.observe(collector)
        for partial in [True, 'PRIVATE_SENTINEL']:
            result = collector.result(input_partial=partial)
            self.assertEqual(result['status'], 'AMBIGUOUS')
            self.assertIn('PARTIAL_INPUT', result['reasons'])
            self.assert_private_and_optional(result)

    def test_marker_epoch_selects_window_without_guessing_compact_timezone(self):
        for epoch in [EPOCH - 100, EPOCH + 100]:
            collector = self.collector()
            self.observe(collector, marker(epoch=epoch), timestamp='2026-10-22 20:41:18.941')
            result = collector.result()
            self.assertEqual(result['status'], 'OBSERVED')
            self.assertEqual(result['records'][0]['window_relation'], 'IN_WINDOW')
            self.assert_private_and_optional(result)
        for epoch in [EPOCH - 101, EPOCH + 101]:
            collector = self.collector()
            self.observe(collector, marker(epoch=epoch))
            result = collector.result()
            self.assertEqual(result['status'], 'UNKNOWN')
            self.assertEqual(result['outside_window_markers'], 1)
            self.assertEqual(result['records'], [])
            self.assertIn('OUTSIDE_WINDOW', result['reasons'])
            self.assert_private_and_optional(result)

    def test_foreign_process_and_multiple_own_pids_never_select_one_failure(self):
        collector = self.collector()
        self.observe(collector, process='OtherApp')
        result = collector.result()
        self.assertEqual(result['status'], 'UNKNOWN')
        self.assertEqual(result['foreign_process_markers'], 1)
        self.assertEqual(result['own_process_count'], 0)
        self.assertEqual(result['records'], [])
        self.assert_private_and_optional(result)
        collector = self.collector()
        for pid, epoch in [('123', EPOCH), ('124', EPOCH + 1), ('125', EPOCH + 2)]:
            self.observe(collector, marker(epoch=epoch), pid=pid)
        result = collector.result()
        self.assertEqual(result['status'], 'AMBIGUOUS')
        self.assertEqual(result['own_process_count'], 2)
        self.assertTrue(result['own_process_count_capped'])
        self.assertIn('MULTIPLE_OWN_PIDS', result['reasons'])
        self.assertEqual(len(result['records']), 3)
        self.assert_private_and_optional(result)

    def test_duplicate_and_distinct_markers_remain_ambiguous(self):
        collector = self.collector()
        self.observe(collector)
        self.observe(collector, receipts.COMPACT_PREFIX + marker())
        result = collector.result()
        self.assertEqual(result['status'], 'AMBIGUOUS')
        self.assertEqual(result['duplicate_records'], 1)
        self.assertEqual(len(result['records']), 1)
        self.assertIn('DUPLICATE_MARKER', result['reasons'])
        self.assert_private_and_optional(result)
        collector = self.collector()
        self.observe(collector)
        self.observe(collector, marker(epoch=EPOCH + 1, phase='NAVIGATION', outcome='THREW', code='NONE'))
        result = collector.result()
        self.assertEqual(result['status'], 'AMBIGUOUS')
        self.assertEqual(len(result['records']), 2)
        self.assertEqual(result['duplicate_records'], 0)
        self.assertIn('MULTIPLE_MARKERS', result['reasons'])
        self.assert_private_and_optional(result)

    def test_ordinary_own_process_records_also_constrain_pid_attribution(self):
        for ordinary_first in [True, False]:
            with self.subTest(ordinary_first=ordinary_first):
                collector = self.collector()
                if ordinary_first:
                    self.observe(collector, 'ordinary startup PRIVATE_SENTINEL', pid='124')
                self.observe(collector, pid='123')
                if not ordinary_first:
                    self.observe(collector, 'ordinary startup PRIVATE_SENTINEL', pid='124')
                result = collector.result()
                self.assertEqual(result['status'], 'AMBIGUOUS')
                self.assertEqual(result['own_process_count'], 2)
                self.assertIn('MULTIPLE_OWN_PIDS', result['reasons'])
                self.assertEqual(len(result['records']), 1)
                self.assert_private_and_optional(result)

    def test_malformed_or_invalid_compact_markers_poison_single_marker_certainty(self):
        malformed = [marker() + '|PRIVATE_SENTINEL', marker(name='PrivateError'),
                     marker(phase='PRIVATE_SENTINEL'), marker(outcome='PASS'),
                     marker(epoch='NaN'), marker(epoch='-1'), marker(epoch='01'), marker(epoch='17\u0661'),
                     marker(epoch=str(receipts.MAX_EPOCH_MS + 1)), marker() + '\n',
                     marker(code='-34018\x00PRIVATE_SENTINEL')]
        for message in malformed:
            with self.subTest(message_length=len(message)):
                collector = self.collector()
                self.observe(collector, message)
                result = collector.result()
                self.assertEqual(result['status'], 'UNKNOWN')
                self.assertEqual(result['records'], [])
                self.assertEqual(result['malformed_markers'], 1)
                self.assert_private_and_optional(result)
        collector = self.collector()
        self.observe(collector)
        collector.invalid_record(marker_present=True)
        result = collector.result()
        self.assertEqual(result['status'], 'AMBIGUOUS')
        self.assertEqual(result['invalid_compact_markers'], 1)
        self.assertIn('INVALID_COMPACT_RECORD', result['reasons'])
        self.assert_private_and_optional(result)

    def test_field_validation_is_fixed_and_does_not_reparse_raw_record_content(self):
        for fields in [dict(pid='0'), dict(pid='2147483648'), dict(pid='1\u0662'), dict(pid=True),
                       dict(timestamp=None), dict(timestamp=''), dict(process=None),
                       dict(message=None), dict(message='x' * (receipts.MAX_MESSAGE_CHARS + 1))]:
            collector = self.collector()
            values = dict(timestamp=STAMP, process=APP, pid='123', message=marker())
            values.update(fields)
            collector.observe(**values)
            result = collector.result()
            self.assertEqual(result['status'], 'UNKNOWN')
            self.assertIn('INVALID_RECORD_FIELDS', result['reasons'])
            self.assert_private_and_optional(result)
        for executable in ['', '../PRIVATE_SENTINEL', 'app\nPRIVATE_SENTINEL', 'a' * 129, None]:
            with self.assertRaisesRegex(ValueError, '^Expected a validated executable selector\\.$'):
                receipts.Collector(executable)

    def test_storage_and_export_counts_are_bounded_and_never_choose_cap_tail(self):
        collector = self.collector()
        for index in range(100):
            self.observe(collector, marker(epoch=EPOCH - 50 + index))
        result = collector.result()
        self.assertEqual(result['status'], 'AMBIGUOUS')
        self.assertEqual(result['marker_records_seen'], 32)
        self.assertEqual(len(result['records']), 32)
        self.assertTrue(result['limit_reached'])
        self.assertIn('OBSERVATION_LIMIT', result['reasons'])
        self.assertLess(len(json.dumps(result)), 7000)
        self.assert_private_and_optional(result)
        collector = self.collector()
        for _ in range(100):
            collector.invalid_record(marker_present=True)
        result = collector.result()
        self.assertEqual(result['status'], 'UNKNOWN')
        self.assertEqual(result['invalid_compact_markers'], 32)
        self.assertTrue(result['limit_reached'])
        self.assert_private_and_optional(result)

    def test_noise_absence_and_result_copy_do_not_invent_or_mutate_observations(self):
        collector = self.collector()
        self.observe(collector, 'PRIVATE_SENTINEL https://private.invalid/ /private/seed.js')
        collector.invalid_record(marker_present=False)
        absent = collector.result()
        self.assertEqual(absent['status'], 'UNKNOWN')
        self.assertEqual(absent['records'], [])
        self.assertIn('NO_MARKER_OBSERVED', absent['reasons'])
        self.assert_private_and_optional(absent)
        self.observe(collector)
        first = collector.result(input_partial=True)
        first['records'][0]['phase'] = 'PRIVATE_SENTINEL'
        first['reasons'].append('PRIVATE_SENTINEL')
        second = collector.result()
        self.assertEqual(second['status'], 'OBSERVED')
        self.assertEqual(second['records'][0]['phase'], 'NATIVE_CREDENTIAL_READ')
        self.assertEqual(second['reasons'], [])
        self.assert_private_and_optional(second)


if __name__ == '__main__':
    unittest.main()
