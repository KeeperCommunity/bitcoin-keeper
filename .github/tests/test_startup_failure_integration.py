"""Optional receipt integration; subprocesses are fake and no native app runs."""
import importlib.util
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('startup_failure_integration',
    Path(__file__).resolve().parents[1] / 'native/hosted_native.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
MARKER = 'KEEPER_STARTUP_FAILURE_V1|1500|NATIVE_CREDENTIAL_READ|REJECTED|Error|-34018'


def record(message=MARKER, process='hexa_keeper_dev', pid='123', severity='E'):
    return '2026-10-22 20:00:00.123 %s %s[%s:abc] %s\n' % (severity, process, pid, message)


class StartupFailureIntegrationTests(unittest.TestCase):
    def receipt(self, payload, **kwargs):
        return native.ios_startup_diagnostics(payload, 'hexa_keeper_dev', 1000, 2000,
                                              **kwargs)['startup_failure_receipt']

    def test_one_validated_own_error_marker_has_only_fixed_fields_and_no_cause_claim(self):
        result = self.receipt(record('[com.facebook.react.log:javascript] ' + MARKER))
        self.assertEqual(result['status'], 'OBSERVED')
        self.assertEqual(result['records'], [{'phase': 'NATIVE_CREDENTIAL_READ', 'outcome': 'REJECTED',
            'error_name': 'Error', 'code': -34018, 'window_relation': 'IN_WINDOW'}])
        self.assertEqual(result['cause'], 'UNDETERMINED')
        encoded = json.dumps(result)
        for private in ('hexa_keeper_dev', '2026-10-22', '1500', '123', MARKER):
            self.assertNotIn(private, encoded)

    def test_invalid_compact_info_foreign_and_multiple_process_records_cannot_claim_one_failure(self):
        for payload in (MARKER, record(severity='Info'), record(process='OtherApp'),
                        '2026-02-31 20:00:00 E hexa_keeper_dev[123:abc] ' + MARKER,
                        record() + record('ordinary startup', pid='124')):
            with self.subTest(payload_shape=len(payload)):
                self.assertNotEqual(self.receipt(payload)['status'], 'OBSERVED')
        self.assertEqual(self.receipt(record() + record())['status'], 'AMBIGUOUS')
        self.assertEqual(self.receipt(record(), input_partial=True)['status'], 'AMBIGUOUS')
        missing = native.ios_startup_diagnostics(record(), 'hexa_keeper_dev')['startup_failure_receipt']
        self.assertEqual(missing['status'], 'UNKNOWN')
        self.assertEqual(missing['records'], [])

    def test_optional_import_failure_does_not_change_existing_error_classification(self):
        original = native.importlib.util.spec_from_file_location
        def optional_only(name, path):
            if name == 'startup_failure_receipts':
                raise OSError('PRIVATE_SENTINEL')
            return original(name, path)
        with mock.patch.object(native.importlib.util, 'spec_from_file_location', side_effect=optional_only):
            result = native.ios_startup_diagnostics(record('TypeError PRIVATE_SENTINEL'), 'hexa_keeper_dev')
        self.assertEqual(result['category_record_counts']['JS_TYPE_ERROR'], 1)
        self.assertEqual(result['startup_failure_receipt']['status'], 'UNKNOWN')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_unsupported_unicode_header_spacing_cannot_supply_one_fixed_failure(self):
        for separator in ('\u0085', '\u2028', '\u00a0'):
            for payload in ('2026-10-22 20:00:00.123' + separator + 'E hexa_keeper_dev[123:abc] ' + MARKER,
                            '2026-10-22 20:00:00.123 E' + separator + 'hexa_keeper_dev[123:abc] ' + MARKER,
                            '2026-10-22 20:00:00.123 E hexa_keeper_dev[123:abc]' + separator + MARKER):
                with self.subTest(separator=ord(separator), position=len(payload)):
                    result = self.receipt(payload)
                    self.assertEqual(result['status'], 'UNKNOWN')
                    self.assertEqual(result['records'], [])
                    self.assertIn('INVALID_COMPACT_RECORD', result['reasons'])

    def test_original_query_deadline_and_failed_smoke_are_unchanged_and_window_is_supplied(self):
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory)
            with mock.patch.multiple(native, PRIVATE=private, EVIDENCE=private / 'metadata.json', PLATFORM='IOS'):
                native.save({'commands': [], 'smoke': 'FAIL', 'built_artifact': {'executable': 'hexa_keeper_dev'}})
                def query(args, stdout, stderr, **kwargs):
                    self.assertEqual(args, ['xcrun', 'simctl', 'spawn', 'owned-simulator', 'log', 'show',
                        '--info', '--style', 'compact', '--last', '10m', '--predicate',
                        'process == "hexa_keeper_dev" AND (messageType == "error" OR messageType == "fault" '
                        'OR eventMessage CONTAINS[c] "error" OR eventMessage CONTAINS[c] "exception" '
                        'OR eventMessage CONTAINS[c] "fatal")'])
                    self.assertEqual(kwargs, {'timeout': 25, 'check': False})
                    stdout.write(record().encode())
                    return subprocess.CompletedProcess(args, 0)
                with mock.patch.object(native.subprocess, 'run', side_effect=query), \
                        mock.patch.object(native.time, 'time', return_value=2), redirect_stdout(io.StringIO()):
                    native.record_startup_failure(private / 'missing.xml', 'owned-simulator', 1000)
                data = native.read()
                self.assertEqual(data['smoke'], 'FAIL')
                self.assertEqual(data['startup_diagnostics']['ios_errors']['startup_failure_receipt']['status'], 'OBSERVED')

    def test_failed_query_discards_valid_looking_marker_output(self):
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory)
            with mock.patch.multiple(native, PRIVATE=private, EVIDENCE=private / 'metadata.json', PLATFORM='IOS'):
                native.save({'commands': [], 'smoke': 'FAIL', 'built_artifact': {'executable': 'hexa_keeper_dev'}})
                def query(args, stdout, stderr, **kwargs):
                    stdout.write(record().encode())
                    return subprocess.CompletedProcess(args, 2)
                with mock.patch.object(native.subprocess, 'run', side_effect=query), redirect_stdout(io.StringIO()):
                    native.record_startup_failure(private / 'missing.xml', 'owned-simulator', 1000)
                result = native.read()['startup_diagnostics']['ios_errors']['startup_failure_receipt']
                self.assertEqual(result['status'], 'UNKNOWN')
                self.assertEqual(result['records'], [])
                self.assertEqual(result['reasons'], ['QUERY_UNAVAILABLE'])

    def test_optional_clock_failure_keeps_original_query_and_failure_unknown(self):
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory)
            with mock.patch.multiple(native, PRIVATE=private, EVIDENCE=private / 'metadata.json', PLATFORM='IOS'):
                native.save({'commands': [], 'smoke': 'FAIL', 'built_artifact': {'executable': 'hexa_keeper_dev'}})
                def query(args, stdout, stderr, **kwargs):
                    stdout.write(record('TypeError PRIVATE_SENTINEL').encode())
                    return subprocess.CompletedProcess(args, 0)
                with mock.patch.object(native.subprocess, 'run', side_effect=query) as called, \
                        mock.patch.object(native.time, 'time', side_effect=OSError('PRIVATE_SENTINEL')), \
                        redirect_stdout(io.StringIO()):
                    native.record_startup_failure(private / 'missing.xml', 'owned-simulator', 1000)
                called.assert_called_once()
                data = native.read()
                result = data['startup_diagnostics']['ios_errors']
                self.assertEqual(result['category_record_counts']['JS_TYPE_ERROR'], 1)
                self.assertEqual(result['startup_failure_receipt']['status'], 'UNKNOWN')
                self.assertEqual(data['smoke'], 'FAIL')
                self.assertNotIn('PRIVATE_SENTINEL', json.dumps(data))


if __name__ == '__main__':
    unittest.main()
