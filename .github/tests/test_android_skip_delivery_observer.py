import importlib.util
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock
from urllib import request, error
import yaml
from frozen_private_ff_profile import original_bytes, original_module

ROOT = Path(__file__).resolve().parents[2]


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


m = load(ROOT / '.github/native/android_skip_delivery_observer.py', 'skip_delivery_test')
p = original_module('.github/native/product_measurements.py', 'original_product_test')
consumer = load(Path(__file__).with_name('test_android_runtime_checkpoint.py'), 'skip_admission_fixture')

WINDOWS = b'''WINDOW MANAGER WINDOWS (dumpsys window windows)
  Window #0 Window{abc u0 io.hexawallet.keeper.development/io.hexawallet.keeper.MainActivity}:
    mDisplayId=0 mSession=Session{def 1234:u0a201} mClient=SECRET_SENTINEL
    mOwnerUid=10201 showForAllUsers=false package=io.hexawallet.keeper.development appop=NONE
    mAttrs={(0,0)(fillxfill) ty=BASE_APPLICATION}
    mViewVisibility=0x0 mHaveFrame=true mObscured=false
    mTouchableInsets=3 mGivenInsetsPending=false
    touchable region=SkRegion((0,63,1080,2322))
    Frames: parent=[0,0][1080,2400] display=[0,0][1080,2400] frame=[0,63][1080,2322] last=[0,63][1080,2322]
  Window #1 Window{aaa u0 StatusBar}:
    mOwnerUid=1000 package=com.android.systemui appop=NONE
    mAttrs={(0,0)(fillx63) ty=STATUS_BAR}
    Frames: parent=[0,0][1080,2400] display=[0,0][1080,2400] frame=[0,0][1080,63] last=[0,0][1080,63]
  mCurrentFocus=Window{abc u0 io.hexawallet.keeper.development/io.hexawallet.keeper.MainActivity}
'''
DISPLAYS = b'''  InsetsState
    mDisplayFrame=Rect(0, 0 - 1080, 2400)
    mDisplayCutout=DisplayCutout{insets=Rect(0, 63 - 0, 0) waterfall=SECRET_SENTINEL}
      InsetsSource id=abc type=statusBars frame=[0,0][1080,63] visible=true flags=NONE
      InsetsSource id=def type=navigationBars frame=[0,2322][1080,2400] visible=true flags=NONE
'''
INPUT = b'''Input Dispatcher State:
  DispatchEnabled: true
  DispatchFrozen: false
  FocusedWindows:
    displayId=0, name='io.hexawallet.keeper.development/io.hexawallet.keeper.MainActivity'
  FocusRequests: SECRET_SENTINEL
    0: name=io.hexawallet.keeper.development/io.hexawallet.keeper.MainActivity, id=8, displayId=0, inputConfig=NOT_FOCUSABLE, alpha=1, frame=[0,63][1080,2322], globalScale=1, applicationInfo.name=SECRET_SENTINEL, applicationInfo.token=SECRET_SENTINEL, touchableRegion=[0,63][1080,2322]|[0,0][1,1], ownerPid=1234, ownerUid=10201, dispatchingTimeout=5000ms, token=SECRET_SENTINEL
  RecentQueue: length=12
    KEY_EVENT_SECRET_SENTINEL_PIN_BODY
'''


class SkipObserverTests(unittest.TestCase):
    def staged_fixture(self):
        fixture = consumer.RuntimeCheckpointTest(methodName='runTest'); fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        for name in m.STAGED:
            fixture.put('.github/native/' + name, (ROOT / '.github/native' / name).read_bytes())
        fixture.admitted()
        fixture.git('checkout', '--detach', '-q', fixture.env['KEEPER_CONTROLLER_SHA'])
        event = fixture.base / 'event.json'
        event.write_text(json.dumps({'action': 'labeled', 'label': {'name': 'keeper/android-runtime-reuse'},
            'repository': {'id': 839671816, 'private': True}, 'pull_request': {'number': 73,
            'head': {'sha': fixture.env['KEEPER_CONTROLLER_SHA'], 'repo': {'id': 839671816}},
            'labels': [{'name': 'keeper/android-runtime-reuse'}]}}))
        env = {**fixture.env, 'GITHUB_EVENT_PATH': str(event), 'RUNNER_ENVIRONMENT': 'github-hosted',
            'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64', 'ImageOS': 'ubuntu24'}
        m.stage(env)
        for line in Path(env['GITHUB_ENV']).read_text().splitlines():
            key, value = line.split('=', 1); env[key] = value
        fixture.git('checkout', '--detach', '-q', fixture.source)
        staged_path = fixture.runner / 'keeper-skip-delivery-controller/android_skip_delivery_observer.py'
        staged = load(staged_path, 'actual_staged_skip_observer')
        return fixture, env, staged

    def test_real_git_staging_preserves_original_checkpoint_and_verifies_all_three_staged_hashes(self):
        fixture, env, staged = self.staged_fixture()
        original = (fixture.control / 'android_runtime_checkpoint.py').read_bytes()
        self.assertEqual(m.digest(original), m.CHECKPOINT_SHA)
        with mock.patch.object(staged, 'SOURCE', fixture.source), mock.patch.object(staged, 'TREE', fixture.tree):
            root, state, identity = staged.admitted(env)
            self.assertEqual(root, fixture.root); self.assertEqual(set(identity['hashes']), set(m.STAGED))
            for name in m.STAGED:
                target = state / name; raw = target.read_bytes(); target.write_bytes(raw + b' ')
                with self.subTest(name=name), self.assertRaises(RuntimeError): staged.admitted(env)
                target.write_bytes(raw)
            identity_path = state / 'identity.json'; identity_path.write_bytes(identity_path.read_bytes() + b' ')
            with self.assertRaises(RuntimeError): staged.admitted(env)
        self.assertEqual((fixture.control / 'android_runtime_checkpoint.py').read_bytes(), original)

    def test_wrong_observer_context_cannot_reach_git_or_adb(self):
        for key, bad in [('GITHUB_REPOSITORY_ID', '1'), ('RUNNER_ENVIRONMENT', 'self-hosted'),
            ('GITHUB_RUN_ATTEMPT', '2'), ('KEEPER_NATIVE_PLATFORM', 'IOS')]:
            with self.subTest(key=key), mock.patch.object(m.subprocess, 'check_output') as tool:
                with self.assertRaises(RuntimeError): m.context({key: bad})
                tool.assert_not_called()

    def test_workflow_stages_outside_ff_and_keeps_exact_baseline_native_and_full_product_entrypoint(self):
        workflow = yaml.load((ROOT / '.github/workflows/keeper-private-android-runtime-reuse.yml').read_text(), Loader=yaml.BaseLoader)
        steps = workflow['jobs']['reuse']['steps']; names = [step['name'] for step in steps]
        self.assertLess(names.index('Stage hash-bound single-Skip observer and selected history objects'),
            names.index('Check out exact original APK app source'))
        self.assertLess(names.index('Admit original source and artifact without acceptance transfer'),
            names.index('Provision only selected authenticated Realm109 historical Git objects'))
        execution = next(step for step in steps if step['name'] == 'Run unchanged disposable native app scenarios')['with']['script']
        self.assertEqual(execution.count('hosted_native.py smoke'), 1)
        self.assertEqual(execution.count('hosted_native.py probe'), 1)
        self.assertEqual(execution.count('hosted_native.py features'), 1)
        self.assertIn('KEEPER_SKIP_HELPER_SHA256', execution); self.assertIn('" suite', execution)
        self.assertEqual(p.SAMPLE_COUNT, 5)
        self.assertEqual(m.digest(original_bytes('.github/native/product_measurements.py')), m.PRODUCT_SHA)
        self.assertEqual(m.digest((ROOT / '.github/native/android_runtime_checkpoint.py').read_bytes()), m.CHECKPOINT_SHA)

    def test_frozen_product_pin_accepts_original_ff_and_rejects_committed_updated_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            product = root / '.github/native/product_measurements.py'; product.parent.mkdir(parents=True)
            product.write_bytes(original_bytes('.github/native/product_measurements.py'))
            def git(*args): subprocess.run(['git', *args], cwd=root, check=True, capture_output=True)
            git('init', '-q'); git('add', '.')
            git('-c', 'user.name=Profile', '-c', 'user.email=profile@example.invalid', 'commit', '-qm', 'original ff product')
            original = m.pinned(root, 'product_measurements', m.PRODUCT_SHA)
            self.assertEqual(original.SAMPLE_COUNT, 5)
            product.write_bytes((ROOT / '.github/native/product_measurements.py').read_bytes())
            git('add', '.'); git('-c', 'user.name=Profile', '-c', 'user.email=profile@example.invalid',
                                'commit', '-qm', 'updated generic product')
            with self.assertRaises(RuntimeError): m.pinned(root, 'product_measurements', m.PRODUCT_SHA)

    def test_api35_window_inset_and_input_formats_project_only_allowlisted_numbers_and_enums(self):
        window = m.window_facts(WINDOWS, 1234)
        self.assertEqual(window['focus_relation'], 'OWN_APP_LABEL')
        self.assertEqual(window['windows'][0]['pid_binding'], 'CURRENT_OWN_PID')
        self.assertEqual(window['windows'][0]['frame']['top'], 63)
        self.assertEqual(window['windows'][0]['touchable_regions'][0]['bottom'], 2322)
        display = m.display_facts(DISPLAYS)
        self.assertEqual(display['cutout_safe_insets'][0]['top'], 63)
        self.assertEqual(display['inset_sources'][1]['type'], 'navigationBars')
        dispatched = m.input_facts(INPUT, 1234)
        self.assertTrue(dispatched['dispatch_enabled']); self.assertFalse(dispatched['dispatch_frozen'])
        self.assertEqual(dispatched['focused_window_relation'], 'OWN_APP_LABEL')
        self.assertEqual(len(dispatched['window_records'][0]['touchable_regions']), 2)
        self.assertEqual(dispatched['recent_dispatched_or_dropped_event_count'], 12)
        encoded = json.dumps([window, display, dispatched])
        for forbidden in ('SECRET_SENTINEL', 'MainActivity', m.APP, 'ownerUid', 'KEY_EVENT', 'PIN_BODY', 'mSession='):
            self.assertNotIn(forbidden, encoded)

    def test_unknown_foreign_or_oversized_formats_do_not_invent_geometry_or_owner(self):
        foreign = m.window_facts(WINDOWS.replace(b'1234:', b'4321:'), 1234)
        self.assertEqual(foreign['windows'][0]['pid_binding'], 'FOREIGN_PID')
        unknown = m.input_facts(b'unknown future format SECRET_SENTINEL\n', 1234)
        self.assertEqual(unknown['focused_window_relation'], 'UNKNOWN')
        self.assertIsNone(unknown['dispatch_enabled'])
        self.assertEqual(m.display_facts(b'futureInsets SECRET_SENTINEL\n')['inset_sources'], [])
        for raw in (b'a' * (m.LIMIT + 1), b'bad\x00\n', b'partial', b'\xff\n'):
            with self.subTest(raw=raw[:10]), self.assertRaises(Exception): m.text(raw)

    def test_existing_bound_post_failure_target_is_projected_but_missing_ancestors_never_invented(self):
        data = {'product_ui': {'samples': [{'sample': 1, 'failed_assertion_snapshot': {
            'binding_state': 'BOUND', 'skip': {'state': 'UNIQUE_VALID_BOUNDS',
                'bounds': {'left': 0, 'top': 78, 'right': 1038, 'bottom': 134},
                'enabled': True, 'clickable': True, 'SECRET_SENTINEL': 'PRIVATE'}}}]}}
        result = m.post_failure_geometry(data)
        self.assertEqual(result['scope'], 'POST_FAILURE_NOT_TAP_TIME')
        self.assertEqual(result['target']['bounds']['top'], 78)
        self.assertEqual(result['ancestors'], [])
        self.assertEqual(result['ancestors_status'], 'NOT_RECORDED')
        self.assertNotIn('SECRET_SENTINEL', json.dumps(result))
        data['product_ui']['samples'][0]['failed_assertion_snapshot']['binding_state'] = 'UNKNOWN'
        self.assertIsNone(m.post_failure_geometry(data)['target'])
        for malformed in (None, [], 'SECRET_SENTINEL', {'samples': [True]}):
            with self.subTest(malformed=malformed):
                self.assertEqual(m.post_failure_geometry({'product_ui': malformed})['status'], 'NOT_RECORDED')

    def test_markers_require_exact_enum_pid_and_current_guest_epoch_window(self):
        raw = b'''1000000000.123 1234 1235 E ReactNativeJS: KEEPER_ONBOARDING_BOUNDARY|v1|SKIP_PRESS
1000000001.123 4321 4322 E ReactNativeJS: KEEPER_ONBOARDING_BOUNDARY|v1|SKIP_PRESS
0999999999.123 1234 1235 E ReactNativeJS: KEEPER_ONBOARDING_BOUNDARY|v1|SKIP_PRESS_OUT
1000000000.456 1234 1235 E ReactNativeJS: KEEPER_ONBOARDING_BOUNDARY|v1|SECRET_SENTINEL
'''
        result = m.marker_facts(raw, 1234, 1000000000, 1000000001)
        self.assertEqual(result['ordered_stages'], ['SKIP_PRESS'])
        self.assertEqual(result['foreign_pid_records'], 1)
        self.assertEqual(result['outside_window_records'], 1)
        self.assertNotIn('SECRET_SENTINEL', json.dumps(result))

    def command_data(self, marker='skip_visible'):
        return {'pid_before': b'1234\n', 'pid_after': b'1234\n', 'guest_before': b'1000000000\n',
                'guest_after': b'1000000001\n', 'windows': WINDOWS, 'displays': DISPLAYS, 'input': INPUT,
                'size': b'Physical size: 1080x2400\n', 'density': b'Physical density: 420\n',
                'markers': b'1000000000.123 1234 1235 E ReactNativeJS: KEEPER_ONBOARDING_BOUNDARY|v1|SKIP_PRESS\n'}

    def test_two_pid_clock_bound_snapshots_and_duplicates_do_not_add_commands_or_input(self):
        observer = m.Observer('emulator-5554'); receipt = object(); data = self.command_data()
        def command(device, label, deadline):
            self.assertEqual(device, 'emulator-5554')
            return data[label], {'status': 'COLLECTED', 'duration_ms': 0.1}
        with mock.patch.object(m, 'bounded_command', side_effect=command) as commands:
            observer.capture(receipt, 'skip_visible'); observer.capture(receipt, 'skip_tapped')
            observer.capture(receipt, 'skip_tapped'); observer.capture(object(), 'skip_visible')
        self.assertEqual(commands.call_count, 2 * len(m.COMMANDS))
        self.assertEqual([row['position'] for row in observer.records], ['BEFORE_ORIGINAL_SKIP', 'AFTER_DRIVER_RETURN'])
        self.assertTrue(all(row['binding']['snapshot_pid_clock_bound'] for row in observer.records))
        self.assertTrue(observer.records[1]['binding']['same_pid_across_skip'])
        self.assertEqual(observer.records[0]['facts']['size'], {'width': 1080, 'height': 2400})
        self.assertNotIn('SECRET_SENTINEL', json.dumps(observer.records))
        self.assertTrue(all(parts[:2] not in (('shell', 'input'), ('shell', 'settings'),
            ('shell', 'uiautomator'), ('shell', 'setprop')) for parts in m.COMMANDS.values()))

    def test_failed_sampler_binding_is_unavailable_and_never_reports_current_geometry(self):
        data = self.command_data(); data['pid_after'] = b'9999\n'
        observer = m.Observer('emulator-5554')
        with mock.patch.object(m, 'bounded_command', side_effect=lambda device, label, deadline: (data[label], {'status': 'COLLECTED'})):
            observer.capture(object(), 'skip_visible')
        self.assertEqual(observer.records[0]['status'], 'UNAVAILABLE')
        self.assertEqual(observer.records[0]['facts'], {})

    def test_original_mark_pin_acceptance_exception_sample_scope_and_run_exception_are_preserved(self):
        observed = mock.Mock(); receipt = p.Receipt()
        def run(_):
            self.assertFalse(receipt.mark_pin('skip_visible'))
            for marker in p.PIN_MARKERS[:9]: self.assertTrue(receipt.mark_pin(marker))
            self.assertFalse(receipt.mark_pin('skip_tapped'))
            receipt.reset(2)
            for marker in p.PIN_MARKERS[:9]: self.assertTrue(receipt.mark_pin(marker))
            raise ValueError('ORIGINAL_PRODUCT_FAILURE')
        original = p.Receipt.mark_pin
        with mock.patch.object(p, 'run', side_effect=run):
            with self.assertRaisesRegex(ValueError, 'ORIGINAL_PRODUCT_FAILURE'):
                m.observe_product(p, object(), observed)
        self.assertIs(p.Receipt.mark_pin, original)
        self.assertEqual([call.args[1] for call in observed.capture.call_args_list], ['skip_visible', 'skip_tapped'])
        observed.capture.side_effect = RuntimeError('SAMPLER_FAILURE')
        with mock.patch.object(p, 'run', side_effect=lambda _: [receipt.mark_pin(marker) for marker in p.PIN_MARKERS[:9]]):
            receipt.reset(1); result = m.observe_product(p, object(), observed)
        self.assertTrue(all(result))

    def test_observer_artifact_failure_never_replaces_original_product_failure(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); (root / 'artifacts').mkdir()
            data = {'source_sha': m.SOURCE, 'build': 'PASS', 'smoke': 'PASS',
                'built_artifact': {'sha256': 'bound-original'},
                'build_execution_scope': 'REUSED_EXACT_ORIGINAL_PRIVATE_DEBUG_APK_NO_CURRENT_RUN_COMPILATION_OR_RELEASE'}
            harness = SimpleNamespace(read=lambda: data, artifact_identity=lambda: data['built_artifact'])
            original_failure = ValueError('ORIGINAL_PRODUCT_FAILURE_SECRET_SENTINEL')
            output = io.StringIO()
            with mock.patch.object(m, 'admitted', return_value=(root, root, {'controller_sha': 'a' * 40})), \
                 mock.patch.object(m, 'pinned', side_effect=[harness, p]), \
                 mock.patch.object(m.subprocess, 'check_output', return_value=b'emulator-5554\n'), \
                 mock.patch.object(p, 'run', side_effect=original_failure), \
                 mock.patch.object(m, 'new_file', side_effect=OSError('ARTIFACT_FAILED_SECRET_SENTINEL')), \
                 contextlib.redirect_stdout(output):
                with self.assertRaises(ValueError) as raised:
                    m.run({'GITHUB_RUN_ID': '123'})
            self.assertIs(raised.exception, original_failure)
            report = json.loads(output.getvalue().split('KEEPER_ANDROID_SKIP_DELIVERY ', 1)[1])
            self.assertEqual(report['original_product_result'], 'FAIL')
            self.assertEqual(report['sampler_status'], 'UNAVAILABLE')
            self.assertEqual(report['artifact_retention'], 'UNAVAILABLE')
            self.assertNotIn('SECRET_SENTINEL', output.getvalue())

    def test_real_existing_http_hook_waits_for_observer_before_reply_and_original_single_tap_order(self):
        reached, release, replied = threading.Event(), threading.Event(), threading.Event()
        receipt = p.Receipt(); calls = []
        class Collector:
            def capture(self, current, marker):
                calls.append(marker)
                if marker == 'skip_visible':
                    reached.set(); self.assert_release = release.wait(3)
        collector = Collector(); original = p.Receipt.mark_pin
        def run(_):
            server = p.make_server(receipt, port=0)
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            base = 'http://127.0.0.1:' + str(server.server_address[1])
            def post(marker):
                body = json.dumps({'marker': marker}).encode()
                with request.urlopen(request.Request(base + '/pin-progress', data=body,
                    headers={'Content-Type': 'application/json'}), timeout=4) as response:
                    self.assertEqual(response.status, 200)
            try:
                for marker in p.PIN_MARKERS[:7]: post(marker)
                def before(): post('skip_visible'); replied.set()
                pending = threading.Thread(target=before); pending.start()
                self.assertTrue(reached.wait(2)); self.assertFalse(replied.is_set())
                release.set(); pending.join(3); self.assertTrue(replied.is_set())
                calls.append('ORIGINAL_SINGLE_SKIP_ACTION')
                post('skip_tapped')
                with self.assertRaises(error.HTTPError): post('skip_tapped')
                return 'ORIGINAL_RUN_RETURN'
            finally:
                release.set(); server.shutdown(); server.server_close(); thread.join(2)
        with mock.patch.object(p, 'run', side_effect=run):
            self.assertEqual(m.observe_product(p, object(), collector), 'ORIGINAL_RUN_RETURN')
        self.assertIs(p.Receipt.mark_pin, original)
        self.assertEqual(calls, ['skip_visible', 'ORIGINAL_SINGLE_SKIP_ACTION', 'skip_tapped'])
        self.assertTrue(collector.assert_release)

    def test_real_owned_subprocess_output_cap_and_timeout_reap_without_exposing_text(self):
        real_popen = subprocess.Popen
        for mode, code in [('large', "import sys; sys.stdout.write('SECRET_SENTINEL'*50000); sys.stdout.flush()"),
                           ('slow', 'import time; time.sleep(10)')]:
            children, vectors = [], []
            def spawn(argv, **kwargs):
                vectors.append(argv)
                child = real_popen([sys.executable, '-c', code], **kwargs); children.append(child)
                return child
            with self.subTest(mode=mode), mock.patch.object(m.subprocess, 'Popen', side_effect=spawn):
                raw, meta = m.bounded_command('emulator-5554', 'windows', time.monotonic() + 3)
            self.assertIsNone(raw); self.assertEqual(meta['status'], 'UNAVAILABLE')
            self.assertLessEqual(meta['bytes_read'], m.LIMIT + 1)
            self.assertNotIn('SECRET_SENTINEL', json.dumps(meta))
            self.assertTrue(all(child.poll() is not None for child in children))
            self.assertEqual(vectors[0], ['adb', '-s', 'emulator-5554', *m.COMMANDS['windows']])
        with self.assertRaises(RuntimeError): m.bounded_command('real-device', 'windows', time.monotonic() + 1)
        with self.assertRaises(RuntimeError): m.bounded_command('emulator-5554', 'tap', time.monotonic() + 1)


if __name__ == '__main__': unittest.main()
