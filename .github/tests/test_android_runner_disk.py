"""Hosted-only stock-tool cleanup guards; no privileged removal in these tests."""
import contextlib
import ast
import importlib.util
import io
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock
import yaml
from frozen_private_ff_profile import original_bytes

FROZEN_FF_WORKFLOW = original_bytes('.github/workflows/keeper-native-platform.yml').decode()

SPEC = importlib.util.spec_from_file_location('android_disk_test',
    Path(__file__).resolve().parents[1] / 'native/android_runner_disk.py')
disk = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(disk)


class AndroidDiskTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.env = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
            'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64', 'ImageOS': 'ubuntu24',
            'KEEPER_NATIVE_PLATFORM': 'ANDROID', 'KEEPER_DIAGNOSTIC': 'true',
            'GITHUB_REPOSITORY': 'KeeperCommunity/bitcoin-keeper-private',
            'GITHUB_REPOSITORY_ID': '839671816', 'GITHUB_WORKSPACE': str(self.root)}
        self.present = {str(path) for _, path in disk.TOOLS}
        self.infos = {path: SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0,
                                           st_dev=1, st_ino=index)
                      for index, path in enumerate(['/usr', '/usr/share', '/usr/local',
                          '/usr/share/dotnet', '/usr/share/swift', '/usr/local/.ghcup'], 1)}
        self.frees = [12807135232, 18973986816, 22 * 1024 ** 3, disk.TARGET]
        self.real_mount_inventory = disk.mount_inventory_clear
        self.real_allocated_bytes = disk.stock_allocated_bytes
        patches = [mock.patch.object(disk, 'ROOT', self.root),
            mock.patch.object(disk.platform, 'system', return_value='Linux'),
            mock.patch.object(disk.platform, 'machine', return_value='x86_64'),
            mock.patch.object(disk.platform, 'freedesktop_os_release',
                              return_value={'ID': 'ubuntu', 'VERSION_ID': '24.04'}),
            mock.patch.object(disk.shutil, 'disk_usage', side_effect=lambda _: SimpleNamespace(free=self.frees.pop(0))),
            mock.patch.object(disk.Path, 'lstat', autospec=True, side_effect=self.lstat),
            mock.patch.object(disk.os.path, 'ismount', return_value=False),
            mock.patch.object(disk, 'mount_inventory_clear'),
            mock.patch.object(disk, 'stock_allocated_bytes', return_value=123456),
            mock.patch.object(disk.subprocess, 'run', side_effect=self.remove)]
        self.mocks = [patch.start() for patch in patches]
        for patch in patches:
            self.addCleanup(patch.stop)
        self.remove_mock = self.mocks[-1]

    def lstat(self, path):
        if str(path) in (str(tool) for _, tool in disk.TOOLS) and str(path) not in self.present:
            raise FileNotFoundError()
        if str(path) not in self.infos:
            raise AssertionError('Unexpected cleanup path')
        return self.infos[str(path)]

    def remove(self, args, **kwargs):
        self.assertIn(args, list(disk.REMOVE.values()))
        self.assertEqual(args[:-1], ['/usr/bin/sudo', '-n', '--', '/usr/bin/rm', '--recursive',
            '--force', '--one-file-system', '--preserve-root=all', '--'])
        self.assertEqual(kwargs, {'stdout': disk.subprocess.DEVNULL, 'stderr': disk.subprocess.DEVNULL,
                                  'timeout': 120, 'check': False})
        self.present.remove(args[-1])
        return SimpleNamespace(returncode=0)

    def test_full_budget_requires_more_than_actual_e7_post_dotnet_space(self):
        result = disk.prepare({**self.env, 'KEEPER_DISK_CLEAN_TARGET': '/tmp/PRIVATE_SENTINEL'})
        self.assertEqual(result['result'], 'PASS')
        self.assertTrue(result['removed_unused_dotnet'])
        self.assertEqual(result['before_free_bytes'], 12807135232)
        self.assertEqual(result['after_free_bytes'], 24 * 1024 ** 3)
        self.assertEqual(result['tools'], {label: 'REMOVED' for label, _ in disk.TOOLS})
        self.assertEqual(self.remove_mock.call_count, 3)
        self.assertEqual(result['existing_reserve_bytes'], 12 * 1024 ** 3)
        self.assertEqual(result['observed_prepare_bytes'], 8790994944)
        self.assertEqual(result['dependency_growth_margin_bytes'], 4093906944)
        self.assertNotIn('PRIVATE_SENTINEL', str(result))

    def test_e7_actual_remaining_space_never_passes_as_sufficient(self):
        self.frees = [12807135232, 18973986816, 18973986816, 18973986816, 18973986816]
        result = disk.prepare(self.env)
        self.assertEqual(result['reason'], 'FULL_INSTALL_BUDGET_UNAVAILABLE')
        self.assertEqual(result['result'], 'FAIL')
        self.assertEqual(result['preparation_target_bytes'], 25769803776)
        for inventory in result['tool_inventory'].values():
            self.assertEqual(inventory['allocated_bytes'], 123456)
            self.assertEqual(inventory['after_free_bytes'], 18973986816)

    def test_reaches_budget_then_stops_without_touching_remaining_tool(self):
        self.frees = [12807135232, 18973986816, disk.TARGET]
        result = disk.prepare(self.env)
        self.assertEqual(result['result'], 'PASS')
        self.assertEqual(result['tools']['GHCUP'], 'NOT_EXAMINED')
        self.assertEqual(self.remove_mock.call_count, 2)

    def test_one_byte_below_budget_always_fails_before_dependency_installation(self):
        self.present.clear()
        self.frees = [disk.TARGET - 1, disk.TARGET - 1]
        result = disk.prepare(self.env)
        self.assertEqual(result['result'], 'FAIL')
        self.assertEqual(result['reason'], 'FULL_INSTALL_BUDGET_UNAVAILABLE')
        self.remove_mock.assert_not_called()

    def test_above_target_never_inspects_or_removes_stock_tools(self):
        self.frees = [disk.TARGET]
        with mock.patch.object(disk, 'stock_identity') as identity:
            result = disk.prepare(self.env)
        self.assertEqual(result['reason'], 'TARGET_ALREADY_AVAILABLE')
        self.assertEqual(result['result'], 'PASS')
        identity.assert_not_called()
        self.remove_mock.assert_not_called()

    def test_any_non_private_hosted_android_context_stops_before_removal(self):
        for field in self.env:
            result = disk.prepare({**self.env, field: 'PRIVATE_SENTINEL'})
            self.assertEqual(result['result'], 'FAIL', field)
        self.remove_mock.assert_not_called()
        self.assertEqual(len(self.frees), 4)

    def test_actual_wrong_os_or_architecture_stops_before_removal(self):
        for name, value in [('system', 'Darwin'), ('machine', 'aarch64'),
                            ('freedesktop_os_release', {'ID': 'ubuntu', 'VERSION_ID': '22.04'})]:
            with mock.patch.object(disk.platform, name, return_value=value):
                self.assertEqual(disk.prepare(self.env)['reason'], 'SYSTEM_REJECTED')
        self.remove_mock.assert_not_called()

    def test_stock_and_ancestors_must_be_root_owned_non_symlink_directories(self):
        for path in self.infos:
            original = self.infos[path]
            for mode, owner in [(stat.S_IFLNK | 0o777, 0), (stat.S_IFREG | 0o644, 0),
                                (stat.S_IFDIR | 0o755, 1001)]:
                self.infos[path] = SimpleNamespace(st_mode=mode, st_uid=owner, st_dev=1, st_ino=3)
                stock = next(tool for _, tool in disk.TOOLS if Path(path) == tool or Path(path) in tool.parents)
                with self.assertRaisesRegex(disk.GuardError, 'STOCK_DIRECTORY_UNVERIFIED'):
                    disk.stock_identity(stock)
                self.remove_mock.assert_not_called()
            self.infos[path] = original

    def test_mount_or_inode_replacement_stops_before_removal(self):
        with mock.patch.object(disk.os.path, 'ismount', return_value=True):
            self.assertEqual(disk.prepare(self.env)['reason'], 'STOCK_MOUNT_REJECTED')
        self.frees = [12808486912]
        self.infos['/usr/share/dotnet'].st_dev = 2
        self.assertEqual(disk.prepare(self.env)['reason'], 'STOCK_MOUNT_REJECTED')
        self.frees = [12808486912]
        with mock.patch.object(disk, 'stock_identity', side_effect=[((1, 1),), ((1, 2),)]):
            self.assertEqual(disk.prepare(self.env)['reason'], 'STOCK_DIRECTORY_CHANGED')
        self.remove_mock.assert_not_called()

    def test_missing_stock_tool_never_selects_another_path_or_weakens_the_reserve(self):
        self.present.clear()
        self.frees = [12808486912, 12808486912]
        result = disk.prepare(self.env)
        self.assertEqual(result['reason'], 'FULL_INSTALL_BUDGET_UNAVAILABLE')
        self.assertEqual(result['result'], 'FAIL')
        self.remove_mock.assert_not_called()

    def test_privileged_command_failure_is_not_hidden_or_retried(self):
        self.remove_mock.side_effect = lambda *args, **kwargs: SimpleNamespace(returncode=1)
        result = disk.prepare(self.env)
        self.assertEqual(result['reason'], 'STOCK_REMOVAL_FAILED')
        self.assertEqual(result['result'], 'FAIL')
        self.remove_mock.assert_called_once()

    def test_exact_and_nested_bind_mounts_and_unreadable_inventory_fail_closed(self):
        valid = b'31 1 0:1 / / rw - ext4 /dev/root rw\n'
        with mock.patch.object(disk.Path, 'open', return_value=io.BytesIO(valid)):
            self.real_mount_inventory(Path('/usr/share/dotnet'))
        for raw in [valid + b'32 31 0:1 /stock /usr/share/dotnet rw - ext4 /dev/root rw\n',
                    valid + b'32 31 0:1 /stock /usr/share/dotnet/nested rw - ext4 /dev/root rw\n',
                    b'', valid[:-1], b'x' * 262145, b'malformed\n']:
            with mock.patch.object(disk.Path, 'open', return_value=io.BytesIO(raw)):
                with self.assertRaises(disk.GuardError):
                    self.real_mount_inventory(Path('/usr/share/dotnet'))

    def test_every_cleanup_path_rejects_nested_mounts(self):
        for _, stock in disk.TOOLS:
            raw = ('31 1 0:1 / / rw - ext4 /dev/root rw\n'
                   '32 31 0:1 /stock ' + str(stock) + '/nested rw - ext4 /dev/root rw\n').encode()
            with mock.patch.object(disk.Path, 'open', return_value=io.BytesIO(raw)):
                with self.assertRaisesRegex(disk.GuardError, 'STOCK_MOUNT_REJECTED'):
                    self.real_mount_inventory(stock)

    def test_no_sdk_ndk_java_node_or_cache_paths_can_be_selected(self):
        self.assertEqual({str(path) for _, path in disk.TOOLS},
            {'/usr/share/dotnet', '/usr/share/swift', '/usr/local/.ghcup'})
        for label, stock in disk.TOOLS:
            self.assertEqual(disk.REMOVE[label][-1], str(stock))
        with self.assertRaisesRegex(disk.GuardError, 'STOCK_PATH_REJECTED'):
            disk.stock_identity(Path('/usr/local/lib/android/sdk'))

    def test_timeout_does_not_retry_or_move_to_another_tool(self):
        self.remove_mock.side_effect = disk.subprocess.TimeoutExpired('rm', 120)
        result = disk.prepare(self.env)
        self.assertEqual(result['result'], 'FAIL')
        self.assertEqual(result['reason'], 'PREPARATION_IO_UNVERIFIED')
        self.remove_mock.assert_called_once()

    def test_allocated_inventory_accepts_only_one_fixed_numeric_du_record(self):
        self.remove_mock.side_effect = None
        self.remove_mock.return_value = SimpleNamespace(returncode=0, stdout=b'987654\t/usr/share/swift\n')
        self.assertEqual(self.real_allocated_bytes(Path('/usr/share/swift')), 987654)
        self.remove_mock.assert_called_once_with(
            ['/usr/bin/du', '-s', '-x', '--block-size=1', '--', '/usr/share/swift'],
            stdout=disk.subprocess.PIPE, stderr=disk.subprocess.DEVNULL, timeout=30, check=False)

    def test_failed_or_unknown_inventory_never_exports_raw_tool_output(self):
        for output, code in [(b'PRIVATE_SENTINEL', 0),
                (b'12\t/usr/share/swift\nPRIVATE_SENTINEL', 0),
                (b'12\t/usr/share/swift\n', 1),
                (b'9223372036854775808\t/usr/share/swift\n', 0)]:
            self.remove_mock.side_effect = None
            self.remove_mock.return_value = SimpleNamespace(returncode=code, stdout=output)
            self.assertIsNone(self.real_allocated_bytes(Path('/usr/share/swift')))
        self.remove_mock.side_effect = disk.subprocess.TimeoutExpired('du', 30)
        self.assertIsNone(self.real_allocated_bytes(Path('/usr/share/swift')))
        self.remove_mock.reset_mock()
        self.assertIsNone(self.real_allocated_bytes(Path('/workspace/PRIVATE_SENTINEL')))
        self.remove_mock.assert_not_called()

    def test_unknown_inventory_does_not_replace_the_measured_budget_failure(self):
        self.frees = [12807135232, 18973986816, 18973986816, 18973986816, 18973986816]
        with mock.patch.object(disk, 'stock_allocated_bytes', return_value=None):
            result = disk.prepare(self.env)
        self.assertEqual(result['reason'], 'FULL_INSTALL_BUDGET_UNAVAILABLE')
        self.assertTrue(all(entry['allocated_bytes'] is None for entry in result['tool_inventory'].values()))

    def test_success_exit_without_actual_removal_is_rejected(self):
        self.remove_mock.side_effect = None
        self.remove_mock.return_value = SimpleNamespace(returncode=0)
        result = disk.prepare(self.env)
        self.assertEqual(result['reason'], 'STOCK_DIRECTORY_REMAINS')
        self.remove_mock.assert_called_once()

    def test_frozen_ff_workflow_runs_private_disk_prep_before_existing_preflight(self):
        text = FROZEN_FF_WORKFLOW
        block = ("      - name: Prepare disposable Android runner disk\n"
                 "        if: inputs.platform == 'ANDROID' && inputs.diagnostic && github.repository_id == '839671816' && github.event.repository.private == true\n"
                 "        run: python3 .github/native/android_runner_disk.py\n")
        self.assertEqual(text.count(block), 1)
        self.assertLess(text.index(block), text.index('      - name: Record runner and toolchain'))
        self.assertLess(text.index(block), text.index('      - name: Install immutable native dependencies'))
        expression = ast.parse(block.splitlines()[1].strip()[4:].replace('&&', 'and')
                               .replace('== true', '== True'), mode='eval').body
        def selected(node, values):
            if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.And):
                return all(selected(value, values) for value in node.values)
            if isinstance(node, ast.Compare) and len(node.ops) == 1 and isinstance(node.ops[0], ast.Eq):
                return selected(node.left, values) == selected(node.comparators[0], values)
            if isinstance(node, ast.Attribute):
                return getattr(selected(node.value, values), node.attr)
            if isinstance(node, ast.Name):
                return values[node.id]
            if isinstance(node, ast.Constant):
                return node.value
            raise AssertionError('Unexpected workflow condition')
        for repo, private, platform, diagnostic, expected in [
                ('839671816', True, 'ANDROID', True, True),
                ('470904030', False, 'ANDROID', True, False),
                ('470904030', True, 'ANDROID', True, False),
                ('839671816', False, 'ANDROID', True, False),
                ('839671816', True, 'IOS', True, False),
                ('839671816', True, 'ANDROID', False, False)]:
            values = {'inputs': SimpleNamespace(platform=platform, diagnostic=diagnostic),
                      'github': SimpleNamespace(repository_id=repo,
                          event=SimpleNamespace(repository=SimpleNamespace(private=private)))}
            self.assertEqual(selected(expression, values), expected)

    def test_current_generic_disk_admission_precedes_both_host_preparation_phases(self):
        path = Path(__file__).resolve().parents[1] / 'workflows/keeper-native-platform.yml'
        jobs = yaml.load(path.read_text(), Loader=yaml.BaseLoader)['jobs']
        for name in ('android-build', 'native'):
            steps = jobs[name]['steps']; names = [s.get('name') for s in steps]
            self.assertLess(names.index('Verify Android hosted source admission'), names.index('Prepare bounded Android runner disk'))
            self.assertLess(names.index('Prepare bounded Android runner disk'), names.index('Record runner and toolchain'))
            self.assertLess(names.index('Prepare bounded Android runner disk'), names.index('Install immutable native dependencies'))
            step = next(s for s in steps if s.get('name') == 'Prepare bounded Android runner disk')
            self.assertEqual(step['run'], 'python3 .github/native/android_canonical_disk.py')
            self.assertNotIn('android_runner_disk.py', step['run'])

    def test_no_path_or_override_arguments_are_accepted(self):
        with mock.patch.object(disk.sys, 'argv', ['helper', '/tmp/PRIVATE_SENTINEL']), \
             mock.patch.object(disk, 'prepare') as prepare, contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(disk.main(), 1)
        prepare.assert_not_called()
        self.assertNotIn('PRIVATE_SENTINEL', output.getvalue())
