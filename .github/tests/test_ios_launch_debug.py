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

    def failed_compiler(self, folder, profile='legacy_unsigned'):
        native=debug.load_native();native.ROOT=folder;native.PRIVATE=folder/'private'
        native.PRIVATE.mkdir(parents=True);native.EVIDENCE=folder/'metadata.json';native.PLATFORM='IOS'
        native.save({'commands':[],'build':'NOT RUN','smoke':'NOT RUN','toolchain':{},
            'native_acceptance':False,
            'build_execution_scope':'FRESH_PRIVATE_SIMULATOR_BUILD_CURRENT_CONTROLLER_NO_RELEASE_ACCEPTANCE'})
        popen=subprocess.Popen
        def compiler(args,**options):
            self.assertEqual(args[0],'xcodebuild')
            return popen([sys.executable,'-c','import sys;sys.stderr.write("x"*70000+"\\nCompileC owned-unit.mm\\nclang: error: actual controlled compiler reason\\n");sys.exit(2)'],**options)
        with mock.patch.object(native.platform,'machine',return_value='arm64'),mock.patch.object(
                native.shutil,'disk_usage',return_value=SimpleNamespace(free=32*1024**3)),mock.patch.object(
                native.subprocess,'Popen',side_effect=compiler):
            with self.assertRaises(RuntimeError):
                if profile == 'xcode_simulator':
                    data=native.read();data['toolchain']['ios_simulator_architecture']='arm64';native.save(data)
                    native.command(debug.xcode_simulator_build_command(native),
                        'Build Xcode-signed development simulator app',timeout=2400)
                else:
                    with mock.patch.dict(os.environ, {'KEEPER_IOS_BUILD_PROFILE': 'legacy-unsigned'}):
                        native.build()
        data=native.read();data['build']='FAIL';native.save(data)
        return native

    def test_actual_new_xcode_command_failure_retains_owned_redacted_tail_without_pass(self):
        native=self.failed_compiler(self.root,profile='xcode_simulator')
        output=self.root/'fresh-output';output.mkdir()
        with (native.PRIVATE/'command-001.log').open('ab') as target:
            target.write(b'\nAUTH_TOKEN=PRIVATE_SENTINEL\nclang: error: new xcode controlled reason\n')
        original=native.EVIDENCE.read_bytes()
        with mock.patch.object(debug.subprocess,'check_output',return_value=str(16*1024**3)):
            debug.retain_build_failure(native,native.read(),output,profile='xcode_simulator')
        summary=json.loads((output/'summary.json').read_text())
        self.assertIn('new xcode controlled reason',summary['compiler_tail'])
        self.assertNotIn('PRIVATE_SENTINEL',summary['compiler_tail'])
        self.assertEqual(summary['command']['label'],'Build Xcode-signed development simulator app')
        self.assertEqual(summary['command']['timeout_seconds'],2400)
        self.assertFalse(summary['native_acceptance'])
        self.assertEqual(native.EVIDENCE.read_bytes(),original)
        self.assertEqual(native.read()['build'],'FAIL')

    def test_new_compiler_profile_rejects_wrong_mode_label_argv_or_deadline(self):
        native=self.failed_compiler(self.root,profile='xcode_simulator');original=native.read()
        import copy
        for index,change in enumerate(('scope','label','argv','deadline','acceptance')):
            data=copy.deepcopy(original)
            if change=='scope':data['build_execution_scope']='REUSED_APK'
            elif change=='label':data['commands'][0]['label']='UNRELATED'
            elif change=='argv':data['commands'][0]['command'].append('-allowProvisioningUpdates')
            elif change=='deadline':data['commands'][0]['timeout_seconds']=2500
            else:data['native_acceptance']=True
            output=self.root/('rejected-%d'%index);output.mkdir()
            debug.retain_build_failure(native,data,output,profile='xcode_simulator')
            self.assertFalse((output/'summary.json').exists())

    def test_actual_failed_arm_build_retains_late_compiler_cause_and_existing_deadline_only_privately(self):
        native=self.failed_compiler(self.root)
        original=native.EVIDENCE.read_bytes()
        (native.PRIVATE/'unrelated.log').write_text('UNRELATED_PRIVATE_DATA')
        with mock.patch.object(debug.subprocess,'check_output',return_value=str(16*1024**3)+'\n'):
            debug.retain(native)
        output=self.root/'artifacts/private-ios-launch-debug'
        summary=json.loads((output/'summary.json').read_text())
        self.assertEqual(summary['architecture'],'arm64')
        self.assertEqual(summary['command']['timeout_seconds'],2400)
        self.assertIn('actual controlled compiler reason',summary['compiler_tail'])
        self.assertLessEqual(len(summary['compiler_tail'].encode()),65536)
        self.assertTrue(summary['compiler_tail_truncated'])
        self.assertEqual(summary['host_memory_bytes'],16*1024**3)
        self.assertFalse(summary['native_acceptance'])
        self.assertNotIn('UNRELATED_PRIVATE_DATA',json.dumps(summary))
        self.assertEqual(native.EVIDENCE.read_bytes(),original)
        self.assertFalse((self.root/'artifacts/private-ios-simulator-app').exists())

    def test_compiler_capture_rejects_foreign_symlink_and_fifo_without_reading_or_blocking(self):
        for kind in ('symlink','fifo','hardlink','directory-symlink'):
            with self.subTest(kind=kind):
                folder=self.root/kind;native=self.failed_compiler(folder)
                log=native.PRIVATE/'command-001.log';log.unlink()
                secret=folder/'foreign';secret.write_text('FOREIGN_PRIVATE_DATA')
                if kind=='symlink':log.symlink_to(secret)
                elif kind=='fifo':os.mkfifo(log)
                elif kind=='hardlink':os.link(secret,log)
                else:
                    log.write_text('PRIVATE_DIRECTORY_DATA')
                    native.PRIVATE.rename(folder/'moved-private')
                    native.PRIVATE.symlink_to(folder/'moved-private',target_is_directory=True)
                started=time.monotonic()
                with mock.patch.object(debug.subprocess,'check_output',return_value='invalid memory value'):
                    debug.retain(native)
                self.assertLess(time.monotonic()-started,1)
                summary=json.loads((folder/'artifacts/private-ios-launch-debug/summary.json').read_text())
                self.assertIn('compiler_output_unavailable',summary)
                self.assertIn('host_memory_unavailable',summary)
                self.assertNotIn('FOREIGN_PRIVATE_DATA',json.dumps(summary))

    def test_compiler_capture_rejects_actual_mutation_during_bounded_read(self):
        native=self.failed_compiler(self.root);fstat=os.fstat;observed=0
        identity=(native.PRIVATE/'command-001.log').stat()
        def changed(descriptor):
            nonlocal observed
            info=fstat(descriptor)
            if (info.st_dev,info.st_ino)==(identity.st_dev,identity.st_ino):
                observed+=1
                if observed==2:
                    with (native.PRIVATE/'command-001.log').open('ab') as target:target.write(b'changed')
                    return fstat(descriptor)
            return info
        with mock.patch.object(debug.os,'fstat',side_effect=changed),mock.patch.object(
                debug.subprocess,'check_output',return_value=str(16*1024**3)):
            debug.retain(native)
        summary=json.loads((self.root/'artifacts/private-ios-launch-debug/summary.json').read_text())
        self.assertEqual(summary['compiler_output_unavailable'],'ValueError')
        self.assertNotIn('compiler_tail',summary)

    def test_compiler_token_echo_and_environment_exports_are_removed_without_losing_reason(self):
        native=self.failed_compiler(self.root)
        controlled={'ACTIONS_RUNTIME_TOKEN':'CONTROLLED_RUNTIME_VALUE','GITHUB_TOKEN':'CONTROLLED_GITHUB_VALUE',
            'ACTIONS_ID_TOKEN_REQUEST_TOKEN':'CONTROLLED_ID_VALUE','PRIVATE_KEY':'CONTROLLED_MULTI_LINE\nSECOND_CONTROLLED_LINE'}
        log=native.PRIVATE/'command-001.log'
        with log.open('ab') as output:
            output.write(b'    export NORMAL_CONFIG=CONTROLLED_EXPORT_VALUE\nDB_PASSWORD=UNBOUND_PASSWORD_VALUE\n')
            output.write(('\n'.join(controlled.values())+'\nclang: error: actual controlled compiler reason\n').encode())
        with mock.patch.dict(os.environ,controlled,clear=True),mock.patch.object(
                debug.subprocess,'check_output',return_value=str(16*1024**3)):
            debug.retain(native)
        text=(self.root/'artifacts/private-ios-launch-debug/summary.json').read_text()
        for value in (*controlled.values(),'CONTROLLED_EXPORT_VALUE','UNBOUND_PASSWORD_VALUE','SECOND_CONTROLLED_LINE'):
            self.assertNotIn(value,text)
        self.assertIn('actual controlled compiler reason',text)
        self.assertIn('[REDACTED]',text)

    def test_unmatched_failed_command_cannot_export_its_output(self):
        native=self.failed_compiler(self.root);data=native.read()
        data['commands'][0]['command']=['unrelated-private-tool'];native.save(data)
        with mock.patch.object(debug.subprocess,'check_output') as query:
            debug.retain(native)
        query.assert_not_called()
        self.assertFalse((self.root/'artifacts/private-ios-launch-debug/summary.json').exists())

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
        guest = streams[1][1]
        self.assertEqual(guest[:4], ['xcrun','simctl','spawn',DEVICE])
        self.assertIn('SpringBoard', guest[-1])
        self.assertNotIn('eventMessage CONTAINS', guest[-1])
        session.freeze();session.freeze()
        self.assertEqual(len(session.stream_results),2)

    def test_failed_owned_boot_output_keeps_actual_late_cause_without_other_command_logs(self):
        native=debug.load_native();native.PRIVATE=self.root;native.EVIDENCE=self.root/'metadata.json'
        native.save({'commands':[]})
        session=debug.Session(native)
        popen=subprocess.Popen
        actual_reason='Error Domain=NSPOSIXErrorDomain Code=60: actual boot service refusal'
        def child(args,**options):
            return popen([sys.executable,'-c',
                'import sys;sys.stderr.write("x"*20000+'+repr(actual_reason)+');sys.exit(1)'],**options)
        with mock.patch.object(native.subprocess,'Popen',side_effect=child):
            with self.assertRaises(RuntimeError):
                native.command(['xcrun','simctl','bootstatus',DEVICE,'-b'],
                               'Wait for simulator boot',timeout=240)
        data=native.read();data['commands'].append({'command':['unrelated-private-tool'],
                                                  'label':'unrelated','exit_code':1})
        native.save(data);(self.root/'command-002.log').write_text('UNRELATED_PRIVATE_DATA')
        rows=session.setup_commands(DEVICE)
        self.assertEqual(len(rows),1)
        self.assertIn(actual_reason,rows[0]['output'])
        self.assertTrue(rows[0]['output_truncated'])
        self.assertEqual(rows[0]['timeout_seconds'],240)
        self.assertNotIn('UNRELATED_PRIVATE_DATA',json.dumps(rows))

    def test_host_log_attachment_failure_keeps_actual_os_error_private_and_allows_boot(self):
        session=debug.Session(SimpleNamespace(PRIVATE=self.root))
        with mock.patch.object(debug,'Stream',side_effect=OSError('actual host log error: unavailable')):
            session.before_boot(DEVICE)
        self.assertEqual(session.device,DEVICE)
        self.assertEqual(session.stream_results[0]['error'],'actual host log error: unavailable')
        session.freeze()

    def test_observer_initialization_failure_reaps_owned_process_and_closes_pipe(self):
        popen=subprocess.Popen
        children=[]
        def child(*args,**options):
            process=popen(*args,**options);children.append(process)
            return process
        for owner,name,error in [(debug.os,'set_blocking',OSError('controlled observer setup failure')),
                                 (debug.threading.Thread,'start',RuntimeError('controlled thread setup failure'))]:
            with self.subTest(stage=name),mock.patch.object(debug.subprocess,'Popen',side_effect=child),mock.patch.object(
                    owner,name,side_effect=error):
                with self.assertRaises(type(error)):
                    debug.Stream(self.root/'failed-stream.log',
                                 [sys.executable,'-c','import time;time.sleep(30)'])
            self.assertIsNotNone(children[-1].poll())
            self.assertTrue(children[-1].stdout.closed)

    def test_private_debug_builds_before_actual_smoke_and_always_retains_app(self):
        workflow=(ROOT/'workflows/keeper-private-ios-launch-debug.yml').read_text()
        self.assertIn('runs-on: macos-15\n',workflow)
        self.assertNotIn('hosted_native.py driver',workflow)
        self.assertLess(workflow.index('hosted_native.py build'),workflow.index('ios_launch_debug.py run'))
        self.assertIn('name: Retain exact build and scoped private error evidence\n        if: always()',workflow)
        ordinary=(ROOT/'workflows/keeper-native-platform.yml').read_text()
        self.assertNotIn('hosted_native.py driver',ordinary)
        self.assertLess(ordinary.index('hosted_native.py build'),ordinary.index('hosted_native.py smoke'))
        self.assertIn('Run disposable native Keychain across three processes',ordinary)
        legacy=(ROOT/'workflows/keeper-hosted-native.yml').read_text()
        self.assertIn('hosted_native.py driver',legacy)

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
        native.save({'build':'PASS','smoke':'FAIL','built_artifact':native.artifact_identity(),
                     'toolchain':{'ios_simulator_signature':{'verified':True}}})
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
    def test_thread_attachment_failure_still_executes_real_boot_and_preserves_boot_failure(self):
        fixture=load('private_debug_attachment_lifecycle', ROOT/'tests/test_startup_integration.py')
        case=fixture.StartupIntegrationTest(methodName='runTest');case.setUp()
        original=fixture.native.smoke;sessions=[]
        def smoke(suite):
            session=debug.Session(fixture.native);sessions.append(session)
            return original(suite,debug_session=session)
        try:
            with mock.patch.object(fixture.native,'smoke',side_effect=smoke),mock.patch.object(
                    debug,'Stream',side_effect=RuntimeError('actual controlled thread attachment failure')):
                result=case.exercise(platform='IOS',boot_fails=True)
            self.assertIs(result['error'],case.original_error)
            self.assertIn('command-Boot disposable simulator',case.events)
            self.assertIn('command-Wait for simulator boot',case.events)
            self.assertIn('device-delete',case.events)
            summary=json.loads((sessions[0].directory/'summary.json').read_text())
            self.assertEqual(summary['streams'][0]['start_failed'],'RuntimeError')
            self.assertFalse(summary['native_acceptance'])
            self.assertEqual(result['metadata']['smoke'],'FAIL')
        finally:case.doCleanups()

    def test_original_failure_survives_capture_failures_and_all_cleanup_still_runs(self):
        fixture=load('private_debug_existing_lifecycle', ROOT/'tests/test_startup_integration.py')
        for finish_fails in (False,True):
            case=fixture.StartupIntegrationTest(methodName='runTest');case.setUp()
            def before_boot(device):case.events.append('debug-before-boot')
            def start(device):case.events.append('debug-start')
            def freeze():case.events.append('debug-freeze')
            def finish(device,error):
                self.assertIs(error,case.original_error);case.events.append('debug-finish')
                if finish_fails:raise RuntimeError('private debug capture failed')
            session=SimpleNamespace(before_boot=before_boot,start=start,freeze=freeze,finish=finish)
            original=fixture.native.smoke
            try:
                with mock.patch.object(fixture.native,'smoke',side_effect=lambda suite:original(suite,debug_session=session)):
                    result=case.exercise(platform='IOS',smoke_fails=True)
                self.assertIs(result['error'],case.original_error)
                self.assertEqual(result['metadata']['smoke'],'FAIL')
                self.assertNotIn('ios_direct_launch_observation',result['metadata'])
                for before,after in [('debug-before-boot','command-Boot disposable simulator'),
                        ('installed-proof','debug-start'),('debug-start','maestro'),
                        ('maestro','debug-freeze'),('debug-freeze','failure-diagnostics'),
                        ('capture-stop','debug-finish'),('debug-finish','metro-stop'),('metro-stop','device-delete')]:
                    self.assertLess(case.events.index(before),case.events.index(after))
            finally:case.doCleanups()

    def test_actual_boot_failure_stops_private_capture_and_preserves_original_and_cleanup(self):
        fixture=load('private_debug_boot_lifecycle', ROOT/'tests/test_startup_integration.py')
        case=fixture.StartupIntegrationTest(methodName='runTest');case.setUp()
        sessions=[]
        def stream(path,args):
            case.events.append('host-stream-start')
            def stop():
                case.events.append('host-stream-stop')
                return {'cleanup_failed':False,'drain_failed':False}
            return SimpleNamespace(stop=stop)
        original=fixture.native.smoke
        def smoke(suite):
            session=debug.Session(fixture.native);sessions.append(session)
            return original(suite,debug_session=session)
        try:
            with mock.patch.object(fixture.native,'smoke',side_effect=smoke),mock.patch.object(debug,'Stream',side_effect=stream):
                result=case.exercise(platform='IOS',boot_fails=True)
            self.assertIs(result['error'],case.original_error)
            self.assertEqual(result['metadata']['smoke'],'FAIL')
            self.assertEqual(result['metadata']['build'],'PASS')
            self.assertNotIn('maestro',case.events)
            for before,after in [('host-stream-start','command-Boot disposable simulator'),
                    ('command-Wait for simulator boot','host-stream-stop'),
                    ('host-stream-stop','failure-diagnostics'),('host-stream-stop','device-delete')]:
                self.assertLess(case.events.index(before),case.events.index(after))
            summary=json.loads((sessions[0].directory/'summary.json').read_text())
            self.assertEqual(summary['capture_phase'],'OWNED_SIMULATOR_BOOT_AND_INSTALL')
            self.assertTrue(summary['original_smoke_failed'])
            self.assertFalse(summary['native_acceptance'])
            self.assertFalse((sessions[0].directory/'original-launch-error.json').exists())
            self.assertEqual(len(sessions[0].stream_results),1)
        finally:case.doCleanups()

if __name__=='__main__':unittest.main()
