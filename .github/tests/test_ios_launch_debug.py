"""Private capture, provenance and lifecycle controls; no native execution."""
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tarfile
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

debug = load('private_ios_debug_tested', ROOT / 'native/ios_launch_debug.py')
DEVICE = '12345678-1234-1234-1234-123456789ABC'

class PrivateLaunchDebug(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_rolling_tail_retains_late_actual_reason_after_prefix_saturation(self):
        path = self.root / 'stream.log'
        with mock.patch.object(debug, 'MAX_LOG', 32):
            stream = debug.Stream(path, [sys.executable, '-c',
                'import sys;sys.stdout.buffer.write(b"x"*64+b"ORIGINAL_OS_REASON");sys.stdout.flush()'])
            try:
                stream.child.wait(timeout=3)
            finally:
                result = stream.stop()
        self.assertTrue(result['truncated'])
        self.assertIn(b'ORIGINAL_OS_REASON', path.read_bytes())
        self.assertEqual(path.stat().st_size, 32)
        self.assertFalse(stream.thread.is_alive())
        self.assertTrue(stream.child.stdout.closed)

    def test_parent_exit_with_descendant_pipe_is_disposed_without_blocking_or_traceback(self):
        script = 'import subprocess,sys;subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"])'
        stream = debug.Stream(self.root / 'descendant.log', [sys.executable, '-c', script])
        stream.child.wait(timeout=3)
        started = time.monotonic()
        result = stream.stop()
        self.assertLess(time.monotonic() - started, 4)
        self.assertFalse(result['cleanup_failed'])
        self.assertFalse(stream.thread.is_alive())
        self.assertTrue(stream.child.stdout.closed)

    def test_drain_failure_is_signaled_and_foreign_output_is_not_overwritten(self):
        path = self.root / 'existing.log'
        path.write_text('keep')
        stream = debug.Stream(path, [sys.executable, '-c', 'print("private")'])
        stream.child.wait(timeout=3)
        result = stream.stop()
        self.assertTrue(result['drain_failed'])
        self.assertEqual(path.read_text(), 'keep')
        self.assertTrue(stream.child.stdout.closed)

    def test_original_error_is_retained_verbatim_without_unrelated_ui_or_environment(self):
        directory = self.root / 'maestro-output' / 'Disposable startup and passcode input'
        directory.mkdir(parents=True)
        rows = [{'command': {'launchAppCommand': {'appId': debug.APP}},
            'metadata': {'status': 'FAILED', 'error': {'message': 'Actual OS refusal: POSIX 2',
            'debugMessage': 'Underlying error: Library not loaded'}}},
            {'command': {'tapOnElement': {'text': 'UNRELATED_UI_DATA'}},
             'metadata': {'status': 'FAILED', 'error': {'message': 'UNRELATED_UI_DATA'}}}]
        (directory / 'commands.json').write_text(json.dumps(rows))
        result = debug.original_launch_error(self.root)
        self.assertEqual(result['errors'][0]['debugMessage'], 'Underlying error: Library not loaded')
        self.assertNotIn('UNRELATED_UI_DATA', json.dumps(result))

    def test_owned_crash_reason_retains_actual_dyld_text_but_excludes_memory_and_foreign_device(self):
        reports = self.root / 'Library/Logs/DiagnosticReports'
        reports.mkdir(parents=True)
        body = {'procName': 'hexa_keeper_dev', 'bundleInfo': {'CFBundleIdentifier': debug.APP},
            'procPath': '/Library/Developer/CoreSimulator/Devices/' + DEVICE + '/data/Containers/Bundle/Application/owned/hexa_keeper_dev.app/hexa_keeper_dev',
            'termination': {'namespace': 'DYLD', 'code': 1, 'indicator': 'Library not loaded: actual-missing.dylib'},
            'exception': {'type': 'EXC_CRASH'}, 'asi': {'dyld': ['actual underlying launch reason']},
            'faultingThread': 0, 'threads': [{'frames': [{'symbol': 'actual_symbol'}],
                'threadState': {'registers': 'PRIVATE_MEMORY'}}], 'usedImages': ['PRIVATE_MEMORY']}
        (reports / 'owned.ips').write_text('{}\n' + json.dumps(body))
        body['procPath'] = body['procPath'].replace(DEVICE, '00000000-0000-0000-0000-000000000000')
        (reports / 'foreign.ips').write_text('{}\n' + json.dumps(body))
        with mock.patch.object(Path, 'home', return_value=self.root):
            result = debug.crash_reasons(self.root, DEVICE, 'hexa_keeper_dev', time.time()-5, time.time()+1)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['termination']['indicator'], 'Library not loaded: actual-missing.dylib')
        self.assertNotIn('PRIVATE_MEMORY', json.dumps(result))

    def test_guest_stream_covers_underlying_service_records_without_app_identifier(self):
        data = {'device': {'id': DEVICE, 'fresh_disposable_state': True}, 'installed_artifact_verified': True}
        native = SimpleNamespace(PRIVATE=self.root, read=lambda: data)
        session = debug.Session(native)
        streams = []
        def stream(path, args):
            streams.append((path, args))
            return SimpleNamespace(stop=lambda: {'cleanup_failed':False,'drain_failed':False})
        with mock.patch.object(debug, 'Stream', side_effect=stream):
            session.start(DEVICE)
        guest = streams[0][1]
        self.assertEqual(guest[:4], ['xcrun','simctl','spawn',DEVICE])
        self.assertIn('SpringBoard', guest[-1])
        self.assertNotIn('eventMessage CONTAINS', guest[-1])
        session.freeze();session.freeze()
        self.assertEqual(len(session.stream_results),2)

    def test_public_or_moved_source_cannot_enter_private_capture(self):
        event = {'repository': {'id':839671816,'private':True}, 'pull_request': {'head': {
            'repo': {'id':839671816},'sha':'a'*40}}, 'action':'labeled','label': {'name':'keeper/ios-launch-debug'}}
        path=self.root/'event.json';path.write_text(json.dumps(event))
        env={'GITHUB_EVENT_PATH':str(path),'GITHUB_REPOSITORY':debug.REPOSITORY,
             'GITHUB_REPOSITORY_ID':'839671816','KEEPER_PRIVATE_IOS_LAUNCH_DEBUG':'1','KEEPER_SOURCE_SHA':'a'*40}
        native=SimpleNamespace(PLATFORM='IOS',ROOT=self.root)
        with mock.patch.dict(os.environ,env,clear=True),mock.patch.object(debug.subprocess,'check_output',return_value='a'*40+'\n'):
            debug.require_private_job(native)
            with mock.patch.dict(os.environ,{'GITHUB_REPOSITORY':'KeeperCommunity/bitcoin-keeper'}):
                with self.assertRaises(ValueError):debug.require_private_job(native)
            with mock.patch.object(debug.subprocess,'check_output',return_value='b'*40+'\n'):
                with self.assertRaises(ValueError):debug.require_private_job(native)

    def test_retained_archive_contains_only_unchanged_simulator_app_and_provenance(self):
        native=debug.load_native();native.ROOT=self.root;native.PRIVATE=self.root/'private';native.PLATFORM='IOS';native.EVIDENCE=self.root/'metadata.json'
        app=native.PRIVATE/'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app';app.mkdir(parents=True)
        (app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleExecutable':'hexa_keeper_dev','CFBundleIdentifier':debug.APP,'CFBundleSupportedPlatforms':['iPhoneSimulator']}))
        (app/'hexa_keeper_dev').write_bytes(b'controlled-simulator-binary')
        (app/'hexa_keeper_dev').chmod(0o755)
        secret=native.PRIVATE/'Keychains/do-not-export';secret.parent.mkdir();secret.write_text('PRIVATE_USER_DATA')
        native.save({'build':'PASS','built_artifact':native.artifact_identity(),'toolchain':{'ios_simulator_signature':{'verified':True}}})
        with mock.patch.object(debug.subprocess,'check_output',side_effect=['a'*40+'\n','b'*40+'\n']):
            debug.retain(native)
        folder=self.root/'artifacts/private-ios-simulator-app';manifest=json.loads((folder/'manifest.json').read_text())
        self.assertEqual(manifest['source_sha'],'a'*40)
        self.assertFalse(manifest['native_acceptance'])
        with tarfile.open(folder/'simulator-app.tar.gz') as archive:
            names=archive.getnames()
            self.assertIn('hexa_keeper_dev.app/hexa_keeper_dev',names)
            self.assertFalse(any('Keychain' in name or 'Containers' in name for name in names))
        self.assertEqual(manifest['archive_sha256'],native._file_sha256(folder/'simulator-app.tar.gz'))

class ActualSmokeLifecycle(unittest.TestCase):
    def test_original_failure_survives_capture_failures_and_all_cleanup_still_runs(self):
        fixture=load('private_debug_existing_lifecycle', ROOT/'tests/test_startup_integration.py')
        for finish_fails in (False,True):
            case=fixture.StartupIntegrationTest(methodName='runTest');case.setUp()
            def start(device):case.events.append('debug-start')
            def freeze():case.events.append('debug-freeze')
            def finish(device,error):
                self.assertIs(error,case.original_error);case.events.append('debug-finish')
                if finish_fails:raise RuntimeError('private debug capture failed')
            session=SimpleNamespace(start=start,freeze=freeze,finish=finish)
            original=fixture.native.smoke
            try:
                with mock.patch.object(fixture.native,'smoke',side_effect=lambda suite:original(suite,debug_session=session)):
                    result=case.exercise(platform='IOS',smoke_fails=True)
                self.assertIs(result['error'],case.original_error)
                self.assertEqual(result['metadata']['smoke'],'FAIL')
                self.assertNotIn('ios_direct_launch_observation',result['metadata'])
                for before,after in [('installed-proof','debug-start'),('debug-start','maestro'),
                        ('maestro','debug-freeze'),('debug-freeze','failure-diagnostics'),
                        ('capture-stop','debug-finish'),('debug-finish','metro-stop'),('metro-stop','device-delete')]:
                    self.assertLess(case.events.index(before),case.events.index(after))
            finally:case.doCleanups()

if __name__=='__main__':unittest.main()
