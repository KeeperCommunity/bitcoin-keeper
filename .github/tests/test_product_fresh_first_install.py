import copy
import importlib.util
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('product', ROOT / '.github/native/product_measurements.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
DEVICE = '12345678-1234-1234-1234-123456789ABC'


class FreshFirstInstall(unittest.TestCase):
    def setUp(self):
        expected = [(['xcrun', 'simctl', 'create', 'Keeper-product-ui-disposable',
            'com.apple.CoreSimulator.SimDeviceType.iPhone-16', 'com.apple.CoreSimulator.SimRuntime.iOS-18-5'], 'Create task-owned product UI simulator'),
            (['xcrun', 'simctl', 'boot', DEVICE], 'Boot product UI simulator'),
            (['xcrun', 'simctl', 'bootstatus', DEVICE, '-b'], 'Wait for product UI simulator')]
        self.rows = [{'command': command, 'label': label, 'exit_code': 0, 'timeout_seconds': 240 if i == 2 else 120}
                     for i, (command, label) in enumerate(expected)]
        self.h = SimpleNamespace(PLATFORM='IOS', read=lambda: {'commands': copy.deepcopy(self.rows)}, command=mock.Mock())

    def test_first_fresh_sample_omits_only_uninstall_and_still_requires_keychain_reset_then_one_120s_install(self):
        result = {}; save = mock.Mock()
        with mock.patch.object(m.subprocess, 'run') as run:
            m.install_ios_product_sample(self.h, DEVICE, 'app', '/owned/app', 1, 1, result, save)
        run.assert_not_called(); save.assert_called_once()
        self.assertEqual(self.h.command.call_args_list, [
            mock.call(['xcrun', 'simctl', 'keychain', DEVICE, 'reset'], 'Reset task-owned simulator credentials'),
            mock.call(['xcrun', 'simctl', 'install', DEVICE, '/owned/app'], 'Install exact product UI app', timeout=120)])

    def test_existing_unknown_failed_or_previously_installed_device_never_gets_first_uninstall_omission(self):
        original = copy.deepcopy(self.rows)
        for change in (lambda: self.rows[-1].update(exit_code=124), lambda: self.rows[-1].update(exit_code=True),
                lambda: self.rows[-1].update(timeout_seconds=300), lambda: self.rows[0]['command'].__setitem__(3, 'foreign'),
                lambda: self.rows.append({'command': ['xcrun', 'simctl', 'install', DEVICE, '/old/app']})):
            self.rows = copy.deepcopy(original); change()
            with self.assertRaises(RuntimeError), mock.patch.object(m.subprocess, 'run') as run:
                m.install_ios_product_sample(self.h, DEVICE, 'app', '/owned/app', 1, 1, {}, mock.Mock())
            run.assert_not_called(); self.h.command.assert_not_called()

    def test_subsequent_sample_requires_successful_uninstall_and_preserves_reset_and_install(self):
        with mock.patch.object(m.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as run:
            m.install_ios_product_sample(self.h, DEVICE, 'app', '/owned/app', 2, 1, {}, mock.Mock())
        self.assertEqual(run.call_args.kwargs['timeout'], 30); self.assertTrue(run.call_args.kwargs['check'])
        self.assertEqual(self.h.command.call_count, 2)

    def test_failed_subsequent_uninstall_or_any_keychain_reset_stops_before_actual_install(self):
        for error in (subprocess.TimeoutExpired(['uninstall'], 30), subprocess.CalledProcessError(1, ['uninstall'])):
            with mock.patch.object(m.subprocess, 'run', side_effect=error), self.assertRaises(type(error)):
                m.install_ios_product_sample(self.h, DEVICE, 'app', '/owned/app', 2, 1, {}, mock.Mock())
            self.h.command.assert_not_called()
        self.h.command.side_effect = RuntimeError('RESET_FAILED')
        with self.assertRaises(RuntimeError), mock.patch.object(m.subprocess, 'run'):
            m.install_ios_product_sample(self.h, DEVICE, 'app', '/owned/app', 1, 1, {}, mock.Mock())
        self.assertEqual(self.h.command.call_count, 1)


if __name__ == '__main__': unittest.main()
