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
        self.present = True
        self.infos = {path: SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0,
                                           st_dev=1, st_ino=index)
                      for index, path in enumerate(['/usr', '/usr/share', '/usr/share/dotnet'], 1)}
        self.frees = [12808486912, 12808486912 + 6 * 1024 ** 3]
        self.real_mount_inventory = disk.mount_inventory_clear
        patches = [mock.patch.object(disk, 'ROOT', self.root),
            mock.patch.object(disk.platform, 'system', return_value='Linux'),
            mock.patch.object(disk.platform, 'machine', return_value='x86_64'),
            mock.patch.object(disk.platform, 'freedesktop_os_release',
                              return_value={'ID': 'ubuntu', 'VERSION_ID': '24.04'}),
            mock.patch.object(disk.shutil, 'disk_usage', side_effect=lambda _: SimpleNamespace(free=self.frees.pop(0))),
            mock.patch.object(disk.Path, 'lstat', autospec=True, side_effect=self.lstat),
            mock.patch.object(disk.os.path, 'ismount', return_value=False),
            mock.patch.object(disk, 'mount_inventory_clear'),
            mock.patch.object(disk.subprocess, 'run', side_effect=self.remove)]
        self.mocks = [patch.start() for patch in patches]
        for patch in patches:
            self.addCleanup(patch.stop)
        self.remove_mock = self.mocks[-1]

    def lstat(self, path):
        if str(path) == '/usr/share/dotnet' and not self.present:
            raise FileNotFoundError()
        if str(path) not in self.infos:
            raise AssertionError('Unexpected cleanup path')
        return self.infos[str(path)]

    def remove(self, args, **kwargs):
        self.assertEqual(args, ['/usr/bin/sudo', '-n', '--', '/usr/bin/rm', '--recursive',
            '--force', '--one-file-system', '--preserve-root=all', '--', '/usr/share/dotnet'])
        self.assertEqual(kwargs, {'stdout': disk.subprocess.DEVNULL, 'stderr': disk.subprocess.DEVNULL,
                                  'timeout': 120, 'check': False})
        self.present = False
        return SimpleNamespace(returncode=0)

    def test_actual_shortfall_reclaims_only_the_fixed_unused_tool_and_keeps_reserve(self):
        # The18GiB value triggers preparation; it does not replace the12GiB gate.
        result = disk.prepare({**self.env, 'KEEPER_DISK_CLEAN_TARGET': '/tmp/PRIVATE_SENTINEL'})
        self.assertEqual(result['result'], 'PASS')
        self.assertTrue(result['removed_unused_dotnet'])
        self.assertEqual(result['before_free_bytes'], 12808486912)
        self.assertGreaterEqual(result['after_free_bytes'], 12 * 1024 ** 3)
        self.assertLess(result['after_free_bytes'], disk.TARGET)
        self.remove_mock.assert_called_once()
        self.assertNotIn('PRIVATE_SENTINEL', str(result))

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
        self.assertEqual(len(self.frees), 2)

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
                self.frees = [12808486912]
                self.infos[path] = SimpleNamespace(st_mode=mode, st_uid=owner, st_dev=1, st_ino=3)
                self.assertEqual(disk.prepare(self.env)['reason'], 'STOCK_DIRECTORY_UNVERIFIED')
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
        self.present = False
        self.frees = [12808486912, 12808486912]
        result = disk.prepare(self.env)
        self.assertEqual(result['reason'], 'EXISTING_RESERVE_UNAVAILABLE')
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
            self.real_mount_inventory()
        for raw in [valid + b'32 31 0:1 /stock /usr/share/dotnet rw - ext4 /dev/root rw\n',
                    valid + b'32 31 0:1 /stock /usr/share/dotnet/nested rw - ext4 /dev/root rw\n',
                    b'', valid[:-1], b'x' * 262145, b'malformed\n']:
            with mock.patch.object(disk.Path, 'open', return_value=io.BytesIO(raw)):
                with self.assertRaises(disk.GuardError):
                    self.real_mount_inventory()

    def test_workflow_runs_prep_only_for_android_diagnostics_before_existing_preflight(self):
        text = (Path(__file__).resolve().parents[1] / 'workflows/keeper-native-platform.yml').read_text()
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

    def test_no_path_or_override_arguments_are_accepted(self):
        with mock.patch.object(disk.sys, 'argv', ['helper', '/tmp/PRIVATE_SENTINEL']), \
             mock.patch.object(disk, 'prepare') as prepare, contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(disk.main(), 1)
        prepare.assert_not_called()
        self.assertNotIn('PRIVATE_SENTINEL', output.getvalue())
