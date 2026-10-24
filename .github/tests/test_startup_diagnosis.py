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


if __name__ == '__main__':
    unittest.main()
