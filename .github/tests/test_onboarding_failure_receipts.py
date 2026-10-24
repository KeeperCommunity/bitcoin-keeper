import importlib.util
import json
from pathlib import Path
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location(
    'onboarding_failure_receipts',
    Path(__file__).resolve().parents[1] / 'native' / 'onboarding_failure_receipts.py')
receipts = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(receipts)


def record(stage='SKIP_PRESS', pid=100, *, version='v1', severity='E', tag='ReactNativeJS'):
    return ('10-22 23:01:02.003 %d 101 %s %s: %s%s|%s' %
            (pid, severity, tag, receipts.PREFIX, version, stage))


class ReceiptsTests(unittest.TestCase):
    def test_exact_owned_records_are_positive_only_and_have_unverified_freshness(self):
        payload = '\n'.join(record(stage) for stage in receipts.STAGES) + '\n'
        result = receipts.parse(payload, {100})
        self.assertEqual(result['state'], 'OBSERVED')
        self.assertTrue(all(value is True for value in result['stages'].values()))
        self.assertEqual(result['owned_marker_records'], 5)
        self.assertEqual(result['freshness'], 'GUEST_CLOCK_UNVERIFIED')
        self.assertEqual(result['cause'], 'UNDETERMINED')
        self.assertEqual(result['coverage'], 'POSITIVE_ONLY_MISSING_STAGES_UNKNOWN')
        self.assertEqual(result['producer_per_stage_limit'], 4)
        self.assertEqual(result['producer_total_limit'], 20)
        self.assertEqual(result['consumer_marker_limit'], 64)
        self.assertEqual(result['input_byte_limit'], 512 * 1024)
        self.assertEqual(result['scan_record_limit'], 10000)
        missing = receipts.parse(record() + '\n', {100})
        self.assertIsNone(missing['stages']['NEW_KEEPER_EFFECT'])
        self.assertNotIn(False, missing['stages'].values())

    def test_foreign_and_duplicate_records_have_separate_bounded_counts(self):
        payload = record(pid=200) + '\n' + (record() + '\n') * 2
        result = receipts.parse(payload, {100})
        self.assertEqual(result['foreign_pid_records'], 1)
        self.assertEqual(result['duplicate_records'], 1)
        self.assertEqual(result['owned_marker_records'], 2)
        self.assertEqual(result['marker_records'], 3)
        self.assertTrue(receipts.is_diagnostic_marker_record(record(pid=200)))
        self.assertTrue(receipts.has_diagnostic_marker_prefix(record(pid=200)))

    def test_calendar_validation_rejects_impossible_dates_without_using_a_clock(self):
        for calendar in ('02-30', '02-31', '04-31', '06-31', '09-31', '11-31'):
            line = record().replace('10-22', calendar)
            with self.subTest(calendar=calendar):
                self.assertFalse(receipts.is_diagnostic_marker_record(line))
                self.assertFalse(receipts.has_diagnostic_marker_prefix(line))
                result = receipts.parse(line + '\n', {100})
                self.assertEqual(result['state'], 'UNKNOWN')
                self.assertEqual(result['malformed_marker_records'], 1)
        for calendar in ('02-29', '04-30', '12-31'):
            self.assertTrue(receipts.is_diagnostic_marker_record(record().replace('10-22', calendar)))

    def test_unusable_or_invalid_ownership_never_accepts_receipts(self):
        for owned in (set(), {True}, {'100'}, [100], {0}, {-1}, {2147483648}):
            with self.subTest(owned=owned):
                result = receipts.parse(record() + '\n', owned)
                self.assertEqual(result['state'], 'UNKNOWN')
                self.assertTrue(all(value is None for value in result['stages'].values()))
        result = receipts.parse(record() + '\n', {100}, usable=False)
        self.assertEqual(result['scanned_records'], 0)
        self.assertEqual(result['state'], 'UNKNOWN')

    def test_incomplete_input_keeps_positives_but_missing_stages_unknown(self):
        complete = record() + '\n'
        for payload, full_input in ((complete, False), (complete + record('NEW_KEEPER_EFFECT'), True)):
            with self.subTest(full_input=full_input):
                result = receipts.parse(payload, {100}, full_input=full_input)
                self.assertEqual(result['state'], 'PARTIAL')
                self.assertTrue(result['stages']['SKIP_PRESS'])
                self.assertIsNone(result['stages']['NEW_KEEPER_EFFECT'])
        self.assertEqual(receipts.parse(record(), {100})['state'], 'UNKNOWN')
        self.assertEqual(receipts.parse(record() + '\r\n', {100})['state'], 'OBSERVED')

    def test_strict_frame_and_complete_marker_reject_substrings_controls_and_unicode(self):
        original = record()
        malformed = [
            original + ' PRIVATE_SENTINEL', original + '|PRIVATE_SENTINEL',
            original.replace(': KEEPER_', ': TypeError PRIVATE_SENTINEL KEEPER_'),
            original.replace('ReactNativeJS:', 'PrivateTag:'),
            original.replace(' E ', ' F '), original.replace(' E ', ' I '),
            original.replace('23:01:02.003', '25:01:02.003'),
            original.replace('.003', '.0030'), original.replace('100 101', '0 101'),
            original.replace('100 101', '2147483648 101'),
            original.replace(' E ', '\tE '), original + '\x00',
            original.replace('|v1|', '|v1|\r'),
            original + '\ufffd', original + '\u2028', original + '\u2029',
            original + '\x85', original + '\x1b', original + '\t',
        ]
        for line in malformed:
            with self.subTest(line=repr(line)):
                self.assertFalse(receipts.is_diagnostic_marker_record(line))
                result = receipts.parse(line + '\n', {100})
                self.assertEqual(result['state'], 'UNKNOWN')
                self.assertTrue(all(value is None for value in result['stages'].values()))
                self.assertEqual(result['malformed_marker_records'], 1)
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_reserved_prefix_is_separate_from_strict_success_and_ordinary_faults(self):
        for line in (record(stage='UNKNOWN_STAGE'), record(version='v2'),
                     record() + '|PRIVATE_SENTINEL', record() + '\x00'):
            self.assertTrue(receipts.has_diagnostic_marker_prefix(line))
            self.assertFalse(receipts.is_diagnostic_marker_record(line))
        for line in ('TypeError: PRIVATE_SENTINEL',
                     record().replace(': KEEPER_', ': TypeError KEEPER_'),
                     record(tag='PrivateTag'), record(severity='F')):
            self.assertFalse(receipts.has_diagnostic_marker_prefix(line))
        result = receipts.parse(record(stage='UNKNOWN_STAGE') + '\n' + record(version='v2') + '\n', {100})
        self.assertEqual(result['unsupported_marker_records'], 2)
        self.assertEqual(result['malformed_marker_records'], 0)

    def test_input_record_and_marker_budgets_fail_closed_and_never_echo_input(self):
        oversized = record() + '\n' + 'PRIVATE_SENTINEL' * (receipts.LIMIT // 10)
        result = receipts.parse(oversized, {100})
        self.assertTrue(result['input_limit_exceeded'])
        self.assertEqual(result['state'], 'UNKNOWN')
        with mock.patch.object(receipts, 'LIMIT', 100):
            result = receipts.parse('\u20ac' * 34, {100})
            self.assertTrue(result['input_limit_exceeded'])
        with mock.patch.object(receipts, 'MAX_RECORDS', 2):
            result = receipts.parse('private\nprivate\n' + record() + '\n', {100})
            self.assertTrue(result['record_limit_reached'])
            self.assertEqual(result['scanned_records'], 2)
            self.assertEqual(result['state'], 'UNKNOWN')
        with mock.patch.object(receipts, 'MAX_MARKERS', 2):
            result = receipts.parse((record() + '\n') * 3, {100})
            self.assertTrue(result['marker_limit_reached'])
            self.assertEqual(result['marker_records'], 2)
            self.assertEqual(result['state'], 'PARTIAL')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_private_content_surrogates_and_terminal_fragments_never_escape(self):
        for payload in ('PRIVATE_SENTINEL\n', record() + ' PRIVATE_SENTINEL',
                        '\ud800PRIVATE_SENTINEL\n', None):
            result = receipts.parse(payload, {100})
            serialized = json.dumps(result)
            self.assertNotIn('PRIVATE_SENTINEL', serialized)
            self.assertNotIn('ReactNativeJS', serialized)
            self.assertEqual(result['state'], 'UNKNOWN')


if __name__ == '__main__':
    unittest.main()
