"""Execute real child env/timeout contracts; never simulate native success."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(os.environ.get('KEEPER_DRIVER_BUDGET_SOURCE_ROOT',
    Path(__file__).resolve().parents[2]))
SPEC = importlib.util.spec_from_file_location('maestro_ci_native', ROOT / '.github/native/hosted_native.py')
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)

# Source oracle: pinned cli-2.11.0, c8c361be1cc89b2e742f185466a302a22778be6b.
# SDK LocalXCTestInstaller.kt blob34c0a0905a210049b62099308727bd1dceed3822
# defaults120000ms; own test-e2e-ios-intel.yaml blob03e419195e0bc826caa4222fff3b31eb4cd5830f
# explicitly configures240000ms on macos-15-intel/iPhone16/iOS18.5.
UPSTREAM_CI_MS = 240000
UPSTREAM_SDK_MS = 120000


class MaestroCIBudget(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.patch = mock.patch.multiple(native, ROOT=self.root, PRIVATE=self.root / 'private',
            EVIDENCE=self.root / 'metadata.json', PLATFORM='IOS')
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.script = self.root / 'verified-test-cli'
        self.script.write_text('#!' + sys.executable + '\nimport os\nprint(os.environ.get("MAESTRO_DRIVER_STARTUP_TIMEOUT", "UNSET"))\n')
        self.script.chmod(0o700)
        native.save({'commands': [], 'maestro': {'binary': str(self.script),
            'version': native.MAESTRO_VERSION, 'sha256': native.MAESTRO_SHA256}})

    def run_command(self, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()):
            return native.command([str(self.script)], 'Fixed CLI boundary', **kwargs)

    def test_real_ios_child_receives_pinned_upstream_ci_value_and_extra_setup_only(self):
        with mock.patch.dict(os.environ, {'MAESTRO_DRIVER_STARTUP_TIMEOUT': 'PRIVATE_SENTINEL'}):
            output = self.run_command(capture=True, timeout=420)
            self.assertEqual(os.environ['MAESTRO_DRIVER_STARTUP_TIMEOUT'], 'PRIVATE_SENTINEL',
                'the parent and another platform must not inherit this override')
        self.assertEqual(output, str(UPSTREAM_CI_MS))
        entry = native.read()['commands'][0]
        self.assertEqual(entry['timeout_seconds'], 420 + (UPSTREAM_CI_MS - UPSTREAM_SDK_MS) // 1000)
        self.assertEqual(entry['maestro_driver_setup']['base_process_timeout_seconds'], 420)
        self.assertEqual(entry['maestro_driver_setup']['scope'],
            'IOS_DRIVER_SETUP_ONLY_NOT_UI_WAIT_OR_PERFORMANCE')
        self.assertNotIn('PRIVATE_SENTINEL', native.EVIDENCE.read_text())

    def test_android_preserves_original_child_env_and_process_timeout(self):
        with mock.patch.object(native, 'PLATFORM', 'ANDROID'), \
                mock.patch.dict(os.environ, {'MAESTRO_DRIVER_STARTUP_TIMEOUT': 'ORIGINAL_ANDROID_VALUE'}):
            output = self.run_command(capture=True, timeout=420)
        self.assertEqual(output, 'ORIGINAL_ANDROID_VALUE')
        entry = native.read()['commands'][0]
        self.assertEqual(entry['timeout_seconds'], 420)
        self.assertNotIn('maestro_driver_setup', entry)

    def test_other_ios_tool_is_not_given_a_maestro_override_or_extra_time(self):
        data = native.read()
        data['maestro']['binary'] = '/different/verified/maestro'
        native.save(data)
        with mock.patch.dict(os.environ, {'MAESTRO_DRIVER_STARTUP_TIMEOUT': 'ORIGINAL_OTHER_TOOL'}):
            output = self.run_command(capture=True, timeout=120)
        self.assertEqual(output, 'ORIGINAL_OTHER_TOOL')
        self.assertEqual(native.read()['commands'][0]['timeout_seconds'], 120)
        self.assertNotIn('maestro_driver_setup', native.read()['commands'][0])

    def test_unverified_maestro_cannot_receive_the_driver_override_or_start(self):
        for key in ('version', 'sha256'):
            data = native.read()
            data['maestro'][key] = 'foreign'
            native.save(data)
            with mock.patch.object(native.subprocess, 'Popen') as spawn:
                with self.assertRaisesRegex(ValueError, 'verified pinned Maestro'):
                    self.run_command()
                spawn.assert_not_called()
            native.save({'commands': [], 'maestro': {'binary': str(self.script),
                'version': native.MAESTRO_VERSION, 'sha256': native.MAESTRO_SHA256}})

    def test_actual_wait_receives_only_the_exact_setup_delta_for_every_caller_budget(self):
        for base in (300, 420, 600, 660):
            process = mock.Mock()
            process.wait.return_value = 0
            with mock.patch.object(native.subprocess, 'Popen', return_value=process) as spawn:
                self.run_command(timeout=base)
            process.wait.assert_called_once_with(timeout=base + 120)
            self.assertEqual(spawn.call_args.kwargs['env']['MAESTRO_DRIVER_STARTUP_TIMEOUT'], '240000')

    def test_original_failed_command_remains_failed_and_does_not_export_private_output(self):
        self.script.write_text('#!' + sys.executable + '\nprint("PRIVATE_SENTINEL")\nraise SystemExit(7)\n')
        with self.assertRaisesRegex(RuntimeError, 'exit 7'):
            self.run_command(timeout=420)
        entry = native.read()['commands'][0]
        self.assertEqual(entry['exit_code'], 7)
        self.assertEqual(entry['timeout_seconds'], 540)
        self.assertNotIn('PRIVATE_SENTINEL', native.EVIDENCE.read_text())


if __name__ == '__main__':
    unittest.main()
