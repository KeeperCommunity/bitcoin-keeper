import contextlib
import importlib.util
import io
import json
from pathlib import Path
import platform
import stat
import subprocess
from types import SimpleNamespace
import unittest
from unittest import mock
import yaml
from frozen_private_ff_profile import original_bytes

ROOT = Path(__file__).resolve().parents[2]
def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
m = load(ROOT / '.github/native/android_runtime_stock_codeql.py', 'extra_stock_test')
consumer = load(Path(__file__).with_name('test_android_runtime_checkpoint.py'), 'consumer_fixture_only')


class ExtraStockTests(unittest.TestCase):
    def policy(self):
        return SimpleNamespace(free_bytes=mock.Mock(side_effect=[9_152_458_752, 12_952_458_752]),
            mount_inventory_clear=mock.Mock(), ROOT=SimpleNamespace(stat=lambda: SimpleNamespace(st_dev=1)))

    def prepared(self, *, small=False, changed=False, failed=False):
        policy = self.policy()
        policy.TOOLS = (('DOTNET', Path('/usr/share/dotnet')),
            ('LINUX_SWIFT', Path('/usr/share/swift')), ('GHCUP', Path('/usr/local/.ghcup')))
        policy.stock_identity = mock.Mock(return_value=((1, 1),))
        sizes = {m.STOCK: 1_423_044_608, m.NDK: 2_000_000_000,
            Path('/usr/share/dotnet'): 6_166_843_392, Path('/usr/share/swift'): 3_710_935_040,
            Path('/usr/local/.ghcup'): 3_925_278_720}
        if small: sizes[m.NDK] = 1
        calls = 0
        def identity(policy, stock):
            nonlocal calls
            calls += 1
            return ((1, 99 if changed and calls > 2 else 2),)
        with mock.patch.object(m, 'admitted_context', return_value=policy), \
             mock.patch.object(m, 'stock_identity', side_effect=identity), \
             mock.patch.object(m, 'allocated_bytes', return_value=sizes), \
             mock.patch.object(m, 'runtime_paths_clear'), \
             mock.patch.object(m.subprocess, 'run', return_value=SimpleNamespace(returncode=1 if failed else 0)) as command, \
             mock.patch.object(Path, 'lstat', side_effect=FileNotFoundError):
            result = m.prepare({'GITHUB_WORKSPACE': '/workspace/app'})
        return result, command

    def test_combined_capacity_allows_measured_small_codeql_with_fixed_ndk29(self):
        result, command = self.prepared()
        self.assertEqual(result['result'], 'READY_FOR_UNCHANGED_ORIGINAL_GUARD')
        self.assertEqual(result['target_bytes'], 24 * 1024 ** 3)
        self.assertEqual(result['reserve_bytes'], 12 * 1024 ** 3)
        self.assertEqual(result['removed'], ['CODEQL', 'NDK29'])
        self.assertFalse(result['native_acceptance'])
        self.assertLess(result['after_free_bytes'], result['target_bytes'])
        self.assertEqual(command.call_args_list[0].args[0], m.REMOVE['CODEQL'])
        self.assertEqual(command.call_args_list[1].args[0], m.REMOVE['NDK29'])
        self.assertNotIn('shell', command.call_args.kwargs)
        self.assertNotIn('27.1.12297006', str(m.REMOVE))
        self.assertNotIn('27.3.13750724', str(m.REMOVE))
        self.assertNotIn('30.0.16248370', str(m.REMOVE))

    def test_small_changed_or_failed_stock_stops_without_fallback(self):
        for mode, reason in [('small', 'COMBINED_FIXED_STOCK_TOO_SMALL_STOP'),
            ('changed', 'STOCK_DIRECTORY_CHANGED'), ('failed', 'STOCK_REMOVAL_FAILED')]:
            with self.subTest(mode=mode):
                result, command = self.prepared(**{mode: True})
                self.assertEqual(result['result'], 'FAIL'); self.assertEqual(result['reason'], reason)
                self.assertFalse(result['removed'])
                self.assertEqual(command.call_count, 1 if mode == 'failed' else 0)

    def test_canonical_stocks_reject_symlink_foreign_owner_alias_mount_or_unknown_path(self):
        for stock in (m.STOCK, m.NDK):
            for mode in ('symlink', 'foreign_owner', 'foreign_parent', 'runner_root', 'alias', 'mount', 'different_device'):
                def info(path):
                    bad_owner = mode == 'foreign_owner' and path == stock or mode == 'foreign_parent' and path == stock.parent
                    return SimpleNamespace(st_mode=stat.S_IFREG if path.name == 'source.properties' else stat.S_IFLNK if mode == 'symlink' and path == stock else stat.S_IFDIR | 0o777,
                        st_uid=1002 if bad_owner else 1001 if mode == 'runner_root' and path == Path('/') else 0,
                        st_dev=2 if mode == 'different_device' and path == stock else 1, st_ino=hash(str(path)), st_size=32)
                with self.subTest(stock=stock, mode=mode), mock.patch.object(Path, 'lstat', info), \
                     mock.patch.object(Path, 'resolve', lambda path, strict=False: Path('/alias') if mode == 'alias' and path == stock else path), \
                     mock.patch.object(m.os.path, 'ismount', return_value=mode == 'mount'), mock.patch.object(m.os, 'getuid', return_value=1001):
                    with self.assertRaises(m.Rejected): m.stock_identity(self.policy(), stock)
        with self.assertRaises(m.Rejected): m.stock_identity(self.policy(), Path('/arbitrary'))

    def test_canonical_stocks_accept_root_or_actual_runner_owners_and_mount_inventory_required(self):
        for stock in (m.STOCK, m.NDK):
            for parent_owner, stock_owner in ((0, 0), (1001, 0), (0, 1001), (1001, 1001)):
                def info(path):
                    owner = stock_owner if path == stock else parent_owner if path == stock.parent else 0
                    return SimpleNamespace(st_mode=stat.S_IFREG if path.name == 'source.properties' else stat.S_IFDIR | 0o777, st_uid=owner, st_dev=1, st_ino=hash(str(path)), st_size=32)
                policy = self.policy()
                with self.subTest(stock=stock, parent_owner=parent_owner, stock_owner=stock_owner), mock.patch.object(Path, 'read_bytes', return_value=b'Pkg.Revision = 29.0.14206865\n'), mock.patch.object(Path, 'lstat', info), \
                     mock.patch.object(Path, 'resolve', lambda path, strict=False: path), \
                     mock.patch.object(m.os.path, 'ismount', return_value=False), mock.patch.object(m.os, 'getuid', return_value=1001):
                    self.assertEqual(len(m.stock_identity(policy, stock)), len(stock.parents) + 1)
                    policy.mount_inventory_clear.assert_called_once_with(stock)
                    policy.mount_inventory_clear.side_effect = RuntimeError('nested mount')
                    with self.assertRaises(RuntimeError): m.stock_identity(policy, stock)

    def test_single_bounded_du_uses_exact_fixed_paths_deduplicates_hardlinks_and_rejects_bad_output(self):
        good = b'1423044608\t/opt/hostedtoolcache/CodeQL\n2000000000\t/usr/local/lib/android/sdk/ndk/29.0.14206865\n'
        for raw, code, accepted in [(good, 0, True), (good, 1, False),
            (good.replace(b'29.0.14206865', b'27.1.12297006'), 0, False),
            (good.replace(b'1423044608', b'PRIVATE_SENTINEL'), 0, False), (good + b'extra\n', 0, False)]:
            with self.subTest(raw=raw), mock.patch.object(m.subprocess, 'run', return_value=SimpleNamespace(stdout=raw, returncode=code)) as command:
                if accepted: self.assertEqual(sum(m.allocated_bytes([m.STOCK, m.NDK]).values()), 3_423_044_608)
                else:
                    with self.assertRaises(m.Rejected): m.allocated_bytes([m.STOCK, m.NDK])
                self.assertEqual(command.call_args.args[0][-2:], [str(m.STOCK), str(m.NDK)])
                self.assertNotIn('--count-links', command.call_args.args[0])
                self.assertEqual(command.call_args.kwargs['timeout'], 30)
        for paths in ([m.STOCK, m.STOCK], [Path('/arbitrary')], []):
            with self.assertRaises(m.Rejected): m.allocated_bytes(paths)

    def test_live_runtime_aliases_executables_fd_and_maps_reject_ndk_target(self):
        m.runtime_paths_clear(Path('/workspace/app'), {})
        for mode in ('alias', 'tool', 'fd', 'maps'):
            with self.subTest(mode=mode), contextlib.ExitStack() as stack:
                env = {'ANDROID_NDK': str(m.NDK)} if mode == 'alias' else {}
                if mode == 'tool': stack.enter_context(mock.patch.object(m.shutil, 'which', return_value=str(m.NDK / 'tool')))
                if mode == 'fd': stack.enter_context(mock.patch.object(m.os, 'readlink', return_value=str(m.NDK / 'lib.so')))
                if mode == 'maps': stack.enter_context(mock.patch.object(Path, 'open', return_value=io.BytesIO(b'1-2 r-xp 0 0 0 ' + str(m.NDK / 'lib.so').encode() + b'\n')))
                with self.assertRaises(m.Rejected): m.runtime_paths_clear(Path('/workspace/app'), env)
        with self.assertRaises(m.Rejected): m.runtime_paths_clear(Path('/usr/local/lib/android'), {})

    def test_missing_extra_and_dynamic_current_host_deficit_fail_before_mutation(self):
        policy = self.policy()
        policy.TOOLS = (('DOTNET', Path('/usr/share/dotnet')),)
        policy.stock_identity = mock.Mock(return_value=None)
        for absent in (True, False):
            with self.subTest(absent=absent), mock.patch.object(m, 'admitted_context', return_value=policy), \
                 mock.patch.object(m, 'stock_identity', return_value=None if absent else ((1, 2),)), \
                 mock.patch.object(m, 'allocated_bytes', return_value={m.STOCK: 1_423_044_608, m.NDK: 2_000_000_000}), \
                 mock.patch.object(m.subprocess, 'run') as command:
                result = m.prepare({'GITHUB_WORKSPACE': '/workspace/app'})
                self.assertEqual(result['reason'], 'FIXED_EXTRA_STOCK_ABSENT_STOP' if absent else 'COMBINED_FIXED_STOCK_TOO_SMALL_STOP')
                command.assert_not_called()
            policy.free_bytes.reset_mock(side_effect=True)
            policy.free_bytes.side_effect = [9_152_458_752, 12_952_458_752]

    def test_ndk_package_revision_regular_file_and_size_are_required(self):
        for mode in ('revision', 'duplicate', 'symlink', 'large'):
            def info(path):
                return SimpleNamespace(st_mode=stat.S_IFLNK if mode == 'symlink' and path.name == 'source.properties' else
                    stat.S_IFREG if path.name == 'source.properties' else stat.S_IFDIR | 0o777,
                    st_uid=0, st_dev=1, st_ino=hash(str(path)), st_size=20000 if mode == 'large' else 32)
            raw = b'Pkg.Revision = 27.1.12297006\n' if mode == 'revision' else b'Pkg.Revision = 29.0.14206865\n' * (2 if mode == 'duplicate' else 1)
            with self.subTest(mode=mode), mock.patch.object(Path, 'lstat', info), \
                 mock.patch.object(Path, 'resolve', lambda path, strict=False: path), \
                 mock.patch.object(m.os.path, 'ismount', return_value=False), \
                 mock.patch.object(Path, 'read_bytes', return_value=raw):
                with self.assertRaises(m.Rejected): m.stock_identity(self.policy(), m.NDK)

    def test_real_git_controller_staging_context_and_hash_before_any_cleanup(self):
        fixture = consumer.RuntimeCheckpointTest(methodName='runTest')
        put = fixture.put
        hosted_path = '.github/native/hosted_native.py'
        # Build the legacy app fixture with its actually recorded hosted helper;
        # the current generic helper is deliberately outside this frozen profile.
        with mock.patch.object(fixture, 'put', side_effect=lambda path, raw:
                put(path, original_bytes(hosted_path) if path == hosted_path else raw)):
            fixture.setUp()
        self.addCleanup(fixture.doCleanups); fixture.admitted()
        self.assertFalse((fixture.root / '.github/native/android_runtime_stock_codeql.py').exists(), 'new helper belongs only to controller')
        staged = load(fixture.control / 'android_runtime_stock_codeql.py', 'actual_staged_cleanup')
        event = fixture.base / 'event.json'
        event.write_text(json.dumps({'action': 'labeled', 'label': {'name': 'keeper/android-runtime-reuse'}, 'repository': {'id': 839671816, 'private': True}, 'pull_request': {
            'number': 73, 'head': {'sha': fixture.env['KEEPER_CONTROLLER_SHA'], 'repo': {'id': 839671816}},
            'labels': [{'name': 'keeper/android-runtime-reuse'}]}}))
        env = {**fixture.env, 'GITHUB_EVENT_PATH': str(event), 'RUNNER_ENVIRONMENT': 'github-hosted',
            'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64', 'ImageOS': 'ubuntu24', 'RUNNER_TOOL_CACHE': '/opt/hostedtoolcache', 'ANDROID_HOME': str(m.SDK), 'ANDROID_SDK_ROOT': str(m.SDK)}
        with mock.patch.object(platform, 'freedesktop_os_release', return_value={'ID': 'ubuntu', 'VERSION_ID': '24.04'}):
            policy = staged.admitted_context(env)
            self.assertEqual(policy.TARGET, m.TARGET); self.assertEqual(policy.RESERVE, m.RESERVE)
            hosted = fixture.root / hosted_path
            hosted.write_bytes((ROOT / hosted_path).read_bytes())
            with self.assertRaisesRegex(staged.Rejected, 'PINNED_NDK_DEPENDENCY_REJECTED'):
                staged.admitted_context(env)
            hosted.write_bytes(original_bytes(hosted_path))
            staged.admitted_context(env)
            with (fixture.control / 'android_runtime_stock_codeql.py').open('a') as target: target.write('\n# changed\n')
            with self.assertRaises(Exception): staged.admitted_context(env)
        for key, bad in [('GITHUB_REPOSITORY_ID', '1'), ('KEEPER_DIAGNOSTIC', 'false'), ('GITHUB_RUN_ATTEMPT', '2'), ('RUNNER_TOOL_CACHE', '/other')]:
            with self.subTest(key=key), mock.patch.object(m.subprocess, 'run') as command:
                result = m.prepare({**env, key: bad})
                self.assertEqual(result['reason'], 'CONTEXT_REJECTED'); command.assert_not_called()

    def test_actual_workflow_runs_extra_before_unchanged_original_and_guards_missing_metadata(self):
        value = yaml.load((ROOT / '.github/workflows/keeper-private-android-runtime-reuse.yml').read_text(), Loader=yaml.BaseLoader)
        steps = value['jobs']['reuse']['steps']; names = [row['name'] for row in steps]
        self.assertLess(names.index('Admit original source and artifact without acceptance transfer'), names.index('Reclaim two measured fixed unused stock tools before unchanged disk budget'))
        self.assertLess(names.index('Reclaim two measured fixed unused stock tools before unchanged disk budget'), names.index('Prepare disposable runtime runner disk with existing budget'))
        extra = next(row for row in steps if row['name'].startswith('Reclaim two measured'))
        self.assertIn("KEEPER_STOCK_CODEQL_SHA256", extra['run'])
        original = next(row for row in steps if row['name'] == 'Prepare disposable runtime runner disk with existing budget')
        self.assertEqual(original['run'], 'python3 .github/native/android_runner_disk.py')
        terminal = next(row for row in steps if row['name'] == 'Project bounded private Android terminal observations')
        self.assertIn("hashFiles('artifacts/native/android/metadata.json') != ''", terminal['if'])


if __name__ == '__main__': unittest.main()
