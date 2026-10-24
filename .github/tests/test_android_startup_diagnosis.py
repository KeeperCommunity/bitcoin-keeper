"""Synthetic metadata/privacy controls; no Android execution or startup credit."""
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

NATIVE = Path(__file__).resolve().parents[1] / 'native'


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, NATIVE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


diag = load('android_diagnosis_test', 'android_startup_diagnosis.py')
native = load('hosted_android_diagnosis_test', 'hosted_native.py')
APP = diag.APP


class ParserTests(unittest.TestCase):
    def test_fixed_types_and_fault_categories_never_export_unknown_names_or_messages(self):
        for kind in diag.TYPES:
            observed = diag.faults(kind + ': PRIVATE_SENTINEL /private/wallet seed=x')
            self.assertIn(kind, observed['exception_types'])
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(observed))
        self.assertEqual(diag.faults('PrivateWalletError: PRIVATE_SENTINEL')['exception_types'], [])

    def test_metro_context_recognizes_new_types_without_codeframes_or_bundle_inference(self):
        result = diag.metro('ERROR PRIVATE_SENTINEL\n /private/file: TypeError: PRIVATE_SENTINEL\n'
                            ' 12 | ReferenceError: PRIVATE_SENTINEL\n'
                            ' at /private/RangeError:12\nRangeError: PRIVATE_SENTINEL\n'
                            'TransformError: PRIVATE_SENTINEL\nBUNDLE PRIVATE_SENTINEL')
        self.assertEqual(result['observed_error_headers'], 3)
        self.assertEqual(result['exception_types'], ['TypeError', 'RangeError', 'TransformError'])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        self.assertNotIn('PASS', json.dumps(result))
        source = diag.metro('ERROR PRIVATE_SENTINEL\n> 14 | throw new TypeError("PRIVATE_SENTINEL")\n')
        self.assertEqual(source['exception_types'], [])
        self.assertEqual(source['fault_categories'], [])
        oom = diag.metro('FATAL ERROR: Reached heap limit PRIVATE_SENTINEL')
        self.assertEqual(oom['fault_categories'], ['WORKER_HEAP_EXHAUSTION'])

    def test_inventory_distinguishes_actual_absence_from_failed_malformed_or_partial_lookup(self):
        data, owned = diag.processes('PID NAME\n100 ' + APP + '\n101 ' + APP + ':worker\n102 private.other\n')
        self.assertEqual((data['state'], data['matching_process_count']), ('PRESENT', 2))
        self.assertEqual(owned, {100, 101})
        data, _ = diag.processes('PID NAME\n102 ' + APP + '.other\n')
        self.assertEqual(data['state'], 'ABSENT')
        for payload, usable in [('', True), ('PID NAME', True), ('permission denied', True),
                                ('PID NAME\n100 ' + APP + '\nmalformed', True),
                                ('PID NAME\n100 ' + APP + '\n100 private.other', True),
                                ('PID NAME\n100 ' + APP, False)]:
            with self.subTest(payload=payload):
                data, owned = diag.processes(payload, usable)
                self.assertEqual(data['state'], 'UNKNOWN')
                self.assertIsNone(data['matching_process_count'])
                self.assertEqual(owned, set())

    def test_resumed_activity_is_unknown_on_missing_failed_ambiguous_or_malformed_output(self):
        own = 'topResumedActivity=ActivityRecord{abc u0 ' + APP + '/.MainActivity t1}'
        other = 'mResumedActivity: ActivityRecord{def u0 private.other/.Private t2}'
        self.assertEqual(diag.foreground(own)['relation'], 'OWN_APP')
        self.assertEqual(diag.foreground(other)['relation'], 'OTHER_APP')
        self.assertEqual(diag.foreground('topResumedActivity=null')['relation'], 'NONE')
        for payload, usable in [('', True), (own, False), (own + '\n' + other, True),
                                (own + '\nmResumedActivity: PRIVATE_SENTINEL', True)]:
            self.assertEqual(diag.foreground(payload, usable)['relation'], 'UNKNOWN')
        self.assertNotIn('private.other', json.dumps(diag.foreground(other)))

    def test_android_log_requires_current_own_process_and_counts_unclassified_records(self):
        payload = ('10-22 12:00:00.000 100 101 E ReactNativeJS: undefined is not a function PRIVATE_SENTINEL\n'
                   '10-22 12:00:00.001 100 101 F libc: Fatal signal 11 PRIVATE_SENTINEL\n'
                   '10-22 12:00:00.002 100 101 E NewPrivateTag: PRIVATE_SENTINEL\n'
                   '10-22 12:00:00.003 200 201 E ReactNativeJS: RangeError: PRIVATE_SENTINEL\n'
                   'malformed PRIVATE_SENTINEL\n')
        result = diag.android_log(payload, {100})
        self.assertEqual(result['parsed_error_records'], 4)
        self.assertEqual(result['own_error_records'], 3)
        self.assertEqual(result['unclassified_own_error_records'], 1)
        self.assertEqual(result['unparsed_nonempty_lines'], 1)
        self.assertEqual(result['fault_categories'], ['JS_TYPE_ERROR', 'NATIVE_FATAL_SIGNAL'])
        self.assertEqual(result['exception_types'], [])
        unknown = diag.android_log(payload, set())
        self.assertEqual(unknown['fault_categories'], [])
        self.assertEqual(unknown['attribution'], 'UNKNOWN_NO_CURRENT_OWN_PROCESS')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        self.assertNotIn('NewPrivateTag', json.dumps(result))

    def test_exit_reasons_are_app_scoped_history_with_unknown_freshness_not_current_cause(self):
        payload = ('process=' + APP + ' reason=5 (APP CRASH(NATIVE)) status=11 PRIVATE_SENTINEL\n'
                   'process=' + APP + ':worker reason=777 (PRIVATE_SENTINEL)\n'
                   'process=private.other reason=6 (ANR)\n')
        result = diag.exit_history(payload)
        self.assertEqual(result['matching_records'], 2)
        self.assertEqual(result['reason_categories'], ['NATIVE_CRASH', 'UNRECOGNIZED_REASON'])
        self.assertEqual(result['freshness'], 'UNKNOWN')
        self.assertEqual(diag.exit_history(payload, False)['reason_categories'], [])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))


class CollectionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.private = self.root / 'private'
        self.private.mkdir()
        (self.private / 'metro.log').write_text('ERROR RangeError: PRIVATE_SENTINEL\n')

    def responder(self, args, stdout, **kwargs):
        if 'ps' in args:
            payload = 'PID NAME\n100 ' + APP + '\n200 private.other\n'
        elif 'activities' in args:
            payload = 'topResumedActivity=ActivityRecord{abc u0 ' + APP + '/.MainActivity t1}\n'
        elif 'exit-info' in args:
            payload = 'process=' + APP + ' reason=5 (APP CRASH(NATIVE)) PRIVATE_SENTINEL\n'
        else:
            payload = '10-22 12:00:00.000 100 101 E ReactNativeJS: TypeError: PRIVATE_SENTINEL\n'
        stdout.write(payload.encode())
        return subprocess.CompletedProcess(args, 0)

    def test_collection_exports_fixed_facts_and_immediately_purges_private_output(self):
        with mock.patch.object(subprocess, 'run', side_effect=self.responder):
            result = diag.collect(self.private, 'emulator-5554')
        self.assertEqual(result['processes']['state'], 'PRESENT')
        self.assertEqual(result['foreground_activity']['relation'], 'OWN_APP')
        self.assertEqual(result['runtime_errors']['fault_categories'], ['JS_TYPE_ERROR'])
        self.assertEqual(result['metro']['fault_categories'], ['JS_RANGE_ERROR'])
        self.assertEqual(result['cause'], 'UNDETERMINED')
        self.assertEqual(result['cleanup_status'], 'DELETED')
        self.assertFalse((self.private / 'android-startup-diagnosis').exists())
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        self.assertNotIn('private.other', json.dumps(result))
        self.assertNotIn(APP, json.dumps(result))

    def test_failed_and_timed_out_commands_never_claim_absence_or_foreground_state(self):
        for timed_out in [False, True]:
            def failure(args, stdout, **kwargs):
                self.responder(args, stdout, **kwargs)
                if timed_out:
                    raise subprocess.TimeoutExpired(args, 15, output='PRIVATE_SENTINEL')
                return subprocess.CompletedProcess(args, 1)
            with self.subTest(timed_out=timed_out), mock.patch.object(subprocess, 'run', side_effect=failure):
                result = diag.collect(self.private, 'emulator-5554')
            self.assertEqual(result['processes']['state'], 'UNKNOWN')
            self.assertEqual(result['foreground_activity']['relation'], 'UNKNOWN')
            self.assertTrue(all(command['lookup_status'] == 'UNKNOWN' for command in result['commands']))
            self.assertEqual(result['runtime_errors']['fault_categories'], [])
            self.assertEqual(result['exit_history']['reason_categories'], [])
            self.assertFalse((self.private / 'android-startup-diagnosis').exists())
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_truncated_inventory_never_establishes_absence_and_reports_read_coverage(self):
        def oversize(args, stdout, **kwargs):
            stdout.write(b'PID NAME\n200 private.other\n' + b'PRIVATE_SENTINEL\n' * 40)
            return subprocess.CompletedProcess(args, 0)
        with mock.patch.object(diag, 'LIMIT', 32), mock.patch.object(subprocess, 'run', side_effect=oversize):
            result = diag.collect(self.private, 'emulator-5554')
        self.assertEqual(result['processes']['state'], 'UNKNOWN')
        self.assertTrue(all(command['input_truncated'] for command in result['commands']))
        self.assertTrue(all(command['bytes_read'] <= 64 for command in result['commands']))
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_bounded_reads_reject_symlink_and_preserve_contiguous_medium_files(self):
        target = self.root / 'private-target'
        target.write_text('PRIVATE_SENTINEL')
        link = self.private / 'link'
        link.symlink_to(target)
        with self.assertRaises(ValueError):
            diag.bounded(link, self.private)
        path = self.private / 'medium'
        path.write_text('x' * 60)
        with mock.patch.object(diag, 'LIMIT', 32):
            payload, coverage = diag.bounded(path, self.private)
        self.assertEqual(payload, 'x' * 60)
        self.assertEqual(coverage['read_scope'], 'FULL')
        self.assertFalse(coverage['input_truncated'])

    def test_host_memory_reports_only_fixed_numeric_fields_and_unknown_on_invalid_or_missing_files(self):
        (self.root / 'proc').mkdir()
        cgroup = self.root / 'sys/fs/cgroup'
        cgroup.mkdir(parents=True)
        (self.root / 'proc/meminfo').write_text('MemTotal: 100 kB\nMemAvailable: 50 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n')
        (cgroup / 'memory.current').write_text('1234')
        (cgroup / 'memory.max').write_text('max')
        (cgroup / 'memory.events').write_text('oom 2\noom_kill 1\nprivate PRIVATE_SENTINEL')
        result = diag.host_memory(self.root)
        self.assertEqual(result['meminfo']['bytes']['MemAvailable'], 50 * 1024)
        self.assertEqual(result['cgroup']['memory.max']['limit'], 'UNLIMITED')
        self.assertEqual(result['cgroup']['memory.events']['counts'], {'oom': 2, 'oom_kill': 1})
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        for extra in ['MemTotal: 200 kB\n', 'MemTotal: PRIVATE_SENTINEL\n']:
            with (self.root / 'proc/meminfo').open('a') as output:
                output.write(extra)
            self.assertEqual(diag.host_memory(self.root)['meminfo']['lookup_status'], 'UNKNOWN')
        for extra in ['oom 3\n', 'oom PRIVATE_SENTINEL\n']:
            (cgroup / 'memory.events').write_text('oom 2\noom_kill 1\n' + extra)
            self.assertEqual(diag.host_memory(self.root)['cgroup']['memory.events']['lookup_status'], 'UNKNOWN')
        (self.root / 'proc/meminfo').write_text('PRIVATE_SENTINEL')
        (cgroup / 'memory.current').unlink()
        result = diag.host_memory(self.root)
        self.assertEqual(result['meminfo']['lookup_status'], 'UNKNOWN')
        self.assertEqual(result['cgroup']['memory.current']['lookup_status'], 'UNKNOWN')

    def test_unsafe_device_selector_never_invokes_adb(self):
        with mock.patch.object(subprocess, 'run') as run, self.assertRaises(ValueError):
            diag.collect(self.private, 'physical-or-unowned-device')
        run.assert_not_called()

    def test_existing_failure_hook_preserves_smoke_failure_and_privacy(self):
        metadata = self.root / 'metadata.json'
        console = io.StringIO()
        with mock.patch.multiple(native, PRIVATE=self.private, EVIDENCE=metadata, PLATFORM='ANDROID'), \
                mock.patch.object(subprocess, 'run', side_effect=self.responder), redirect_stdout(console):
            native.save({'commands': [], 'build': 'PASS', 'smoke': 'FAIL'})
            native.record_startup_failure(self.private / 'missing.xml', 'emulator-5554')
            result = native.read()
        self.assertEqual(result['smoke'], 'FAIL')
        self.assertEqual(result['startup_diagnostics']['android_runtime_diagnosis']['cause'], 'UNDETERMINED')
        self.assertNotIn('PRIVATE_SENTINEL', metadata.read_text() + console.getvalue())


if __name__ == '__main__':
    unittest.main()
