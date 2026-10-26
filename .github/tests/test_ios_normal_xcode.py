"""Generic current-source build/identity controls; no Xcode or simulator runs."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import struct
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location('test_normal_' + name, ROOT / '.github/native' / (name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


m, h = load('ios_normal_xcode'), load('hosted_native')
APP_ID = h.APP_IDS['IOS']
SOURCE = 'a' * 40


def binary(identifier=APP_ID, sdk=0x00120500, platform=7, der=True):
    xml = plistlib.dumps({'application-identifier': identifier} if identifier is not None else {})
    header = struct.pack('<8I', 0xfeedfacf, 0x0100000c, 0, 2, 2, 256, 0, 0)
    segment = struct.pack('<II16sQQQQIIII', 0x19, 232, b'__TEXT', 0, 4096, 0, 4096, 7, 5, 2, 0)
    def section(name, data, offset):
        return struct.pack('<16s16sQQIIIIIIII', name, b'__TEXT', 0, len(data), offset, 0, 0, 0, 0, 0, 0, 0)
    version = struct.pack('<6I', 0x32, 24, platform, 0x000f0100, sdk, 0)
    return header + segment + section(b'__entitlements', xml, 288) + section(
        b'__ents_der' if der else b'__other', b'\x30\x00', 288 + len(xml)) + version + xml + b'\x30\x00'


class NormalXcode(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.app = self.root / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
        self.app.mkdir(parents=True)
        (self.app / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': APP_ID,
            'CFBundleSupportedPlatforms': ['iPhoneSimulator'], 'CFBundleExecutable': 'hexa_keeper_dev'}))
        (self.app / 'hexa_keeper_dev').write_bytes(binary())
        (self.root / 'package.json').write_text(json.dumps({'version': '2.6.5'}))
        self.state = {'source_sha': SOURCE, 'build': 'NOT RUN', 'commands': [], 'toolchain': {}}
        self.native = SimpleNamespace(ROOT=self.root, PRIVATE=self.root, PLATFORM='IOS', APP_IDS=h.APP_IDS,
            platform=SimpleNamespace(machine=lambda: 'arm64', system=lambda: 'Darwin'), read=lambda: copy.deepcopy(self.state),
            save=self.save, command=mock.Mock(side_effect=self.command), _bundle_inventory=h._bundle_inventory,
            artifact_identity=lambda: {'sha256': 'b' * 64}, disk_preflight=mock.Mock(), ios_build_progress=mock.Mock())

    def save(self, data): self.state = copy.deepcopy(data)

    def command(self, args, label, **kwargs):
        if '--verbose=4' in args:
            return 'Signature=adhoc\n'
        if '--entitlements' in args:
            return plistlib.dumps({'get-task-allow': True}).decode()
        return None

    def test_real_xml_der_platform_sdk_and_no_certificate_are_required(self):
        signature = m.verify_signature(self.native)
        self.assertTrue(signature['verified'])
        self.assertFalse(signature['certificate_or_profile_used'])
        self.assertEqual(signature['keychain_behavior'], 'NOT_YET_TESTED')
        commands = [call.args[0] for call in self.native.command.call_args_list]
        self.assertEqual(commands[0][0:4], ['codesign', '--verify', '--deep', '--strict'])
        self.assertTrue(all('--sign' not in command for command in commands))
        for payload in (binary('wrong.bundle'), binary(platform=2), binary(sdk=0x00120000), binary(der=False)):
            with self.subTest(payload=payload[-6:]):
                (self.app / 'hexa_keeper_dev').write_bytes(payload)
                with self.assertRaises((RuntimeError, ValueError)):
                    m.verify_signature(self.native)

    def test_split_debug_image_binds_identifier_and_rejects_conflicting_sibling(self):
        (self.app / 'hexa_keeper_dev').write_bytes(binary(None))
        debug = self.app / 'hexa_keeper_dev.debug.dylib'; debug.write_bytes(binary())
        self.assertTrue(m.verify_signature(self.native)['verified'])
        (self.app / 'hexa_keeper_dev').write_bytes(binary('wrong.bundle'))
        with self.assertRaises(RuntimeError): m.verify_signature(self.native)

    def test_unknown_unsigned_identity_certificate_and_strict_verifier_failure_reject(self):
        for identity in ('', 'Signature=none\n', 'Signature=adhoc\nAuthority=certificate\n'):
            def command(args, label, **kwargs):
                return identity if '--verbose=4' in args else self.command(args, label, **kwargs)
            self.native.command.side_effect = command
            with self.subTest(identity=identity), self.assertRaises(RuntimeError):
                m.verify_signature(self.native)
        self.native.command.side_effect = RuntimeError('STRICT_SIGNATURE_FAILURE')
        with self.assertRaises(RuntimeError): m.verify_signature(self.native)

    def test_profile_or_symlink_identity_files_and_escape_are_rejected(self):
        profile = self.app / 'embedded.mobileprovision'; profile.write_bytes(b'fake')
        with self.assertRaises(RuntimeError): m.verify_signature(self.native)
        profile.unlink(); profile.symlink_to(self.root / 'nonexistent')
        with self.assertRaises((RuntimeError, ValueError, FileNotFoundError)): m.verify_signature(self.native)
        profile.unlink()
        original = (self.app / 'Info.plist').read_bytes()
        for name in ('Info.plist', 'hexa_keeper_dev'):
            target = self.app / name; saved = target.read_bytes(); target.unlink()
            other = self.root / name; other.write_bytes(saved); target.symlink_to(other)
            with self.assertRaises((RuntimeError, ValueError)): m.verify_signature(self.native)
            target.unlink(); target.write_bytes(saved)
        alias = self.root / 'alias.app'; alias.symlink_to(self.app, target_is_directory=True)
        with self.assertRaises(RuntimeError): m.verify_signature(self.native, alias)
        self.assertEqual((self.app / 'Info.plist').read_bytes(), original)

    def run_build(self, fail_compile=False, fail_signature=False):
        self.native.PRIVATE = self.root / 'fresh-private'
        if fail_compile: self.native.command.side_effect = RuntimeError('COMPILE_FAILURE')
        with mock.patch.object(m, 'require_source', return_value=SOURCE), \
                mock.patch.object(m.subprocess, 'check_output', return_value='c' * 40), \
                mock.patch.object(m, 'verify_signature', side_effect=RuntimeError('SIGNATURE_FAILURE')
                    if fail_signature else None, return_value={'verified': True}):
            m.build(self.native)

    def test_fresh_build_uses_current_source_and_future_version_without_team_or_signer(self):
        self.run_build()
        args = self.native.command.call_args.args[0]
        for option in ('CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-',
            'CODE_SIGN_LOCAL_EXECUTION_IDENTITY=Ad Hoc', 'DEVELOPMENT_TEAM=',
            'PROVISIONING_PROFILE=', 'PROVISIONING_PROFILE_SPECIFIER=', 'ARCHS=arm64'):
            self.assertIn(option, args)
        for option in ('-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration', '-exportArchive', 'archive'):
            self.assertNotIn(option, args)
        self.assertEqual(self.native.command.call_args.kwargs['timeout'], 2400)
        self.assertEqual(self.state['current_source_compilation'], 'PASS')
        self.assertEqual(self.state['compiled_app_source_sha'], SOURCE)
        self.assertEqual(self.state['compiled_app_version'], '2.6.5')
        self.assertEqual(self.state['build'], 'PASS')
        self.assertEqual(self.state['build_execution_scope'], m.SCOPE)

    def test_failed_compiler_and_failed_signature_never_create_build_pass(self):
        for compile_failure, compilation in ((True, 'FAIL'), (False, 'PASS')):
            self.state['build'] = 'NOT RUN'
            self.native.command.side_effect = self.command
            with self.assertRaises(RuntimeError):
                self.run_build(fail_compile=compile_failure, fail_signature=not compile_failure)
            self.assertEqual(self.state['build'], 'FAIL')
            self.assertEqual(self.state['current_source_compilation'], compilation)
            self.assertNotIn('built_artifact', self.state)

    def test_intel_unknown_architecture_or_already_built_cannot_invoke_xcode(self):
        for architecture in ('x86_64', 'unknown', ''):
            self.native.platform.machine = lambda: architecture
            with self.assertRaises(RuntimeError): m.build(self.native)
            self.native.command.assert_not_called()
        self.native.platform.machine = lambda: 'arm64'
        self.state['build'] = 'PASS'
        with self.assertRaises(RuntimeError): m.build(self.native)
        self.native.command.assert_not_called()

    def test_existing_derived_data_or_alias_cannot_supply_a_fresh_compilation(self):
        with self.assertRaises(RuntimeError): m.build(self.native)
        self.native.command.assert_not_called()
        self.native.PRIVATE = self.root / 'alias-private'; self.native.PRIVATE.mkdir()
        (self.native.PRIVATE / 'DerivedData').symlink_to(self.root / 'missing')
        with self.assertRaises(RuntimeError): m.build(self.native)
        self.native.command.assert_not_called()

    def test_unknown_profile_cannot_select_legacy_or_normal_signing(self):
        with mock.patch.object(h, 'PLATFORM', 'IOS'), mock.patch.object(h, 'normal_ios') as helper, \
                mock.patch.dict(os.environ, {'KEEPER_IOS_BUILD_PROFILE': 'unknown'}), self.assertRaises(RuntimeError):
            h.build()
        helper.assert_not_called()

    def test_default_build_dispatches_generic_helper_without_legacy_signing(self):
        with mock.patch.object(h, 'PLATFORM', 'IOS'), mock.patch.object(h, 'normal_ios') as helper, \
                mock.patch.object(h, 'sign_simulator_app') as signer, mock.patch.dict(os.environ):
            os.environ.pop('KEEPER_IOS_BUILD_PROFILE', None)
            h.build()
            helper.return_value.build.assert_called_once()
            signer.assert_not_called()

    def test_retained_private_build_cannot_supply_fresh_compilation_runtime(self):
        self.state.update(build='PASS', current_source_compilation='NOT RUN',
            build_execution_scope='REUSED_EXACT_NORMAL_XCODE_APP_NO_CURRENT_COMPILATION_OR_RESIGNING')
        with self.assertRaises(RuntimeError): m.require_runtime(self.native)

    def test_keychain_binding_uses_exact_current_source_run_and_artifact_after_both_verifiers(self):
        self.state.update(platform='IOS', workflow_sha='c' * 40, workflow_ref='repo/workflow@sprint',
            run_id='123', run_attempt='2', built_artifact={'sha256': 'd' * 64},
            installed_artifact={'method': 'FULL_SIMULATOR_BUNDLE_TREE_AND_EXECUTABLE_SHA256'},
            installed_artifact_verified=True, installed_normal_signature_verified=True)
        binding = m.keychain_binding(self.native)
        self.assertEqual(binding, {'scope': 'CURRENT_SOURCE_NATIVE_PHASE', **{key: self.state[key] for key in
            ('platform', 'source_sha', 'workflow_sha', 'workflow_ref', 'run_id', 'run_attempt',
             'built_artifact', 'installed_artifact')}})
        for field in ('installed_artifact_verified', 'installed_normal_signature_verified'):
            self.state[field] = False
            with self.assertRaises(RuntimeError): m.keychain_binding(self.native)
            self.state[field] = True


class RawSource(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / 'src').mkdir(); (self.root / 'src/app.ts').write_text('original')
        (self.root / 'App.tsx').write_text('export default function App() {}')
        (self.root / 'package.json').write_text('{"version":"2.6.5"}')
        self.git('init', '-q'); self.git('add', '.')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=f@example.invalid', 'commit', '-qm', 'fixture')
        source = self.git('rev-parse', 'HEAD').decode().strip()
        patch = mock.patch.dict(os.environ, {'KEEPER_SOURCE_SHA': source}); patch.start(); self.addCleanup(patch.stop)
        self.native = SimpleNamespace(ROOT=self.root, PLATFORM='IOS', read=lambda: {'source_sha': source})

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.DEVNULL)

    def test_any_exact_source_sha_and_version_admitted_but_hidden_modification_rejected(self):
        m.require_source(self.native, prepared=False)
        self.git('update-index', '--assume-unchanged', 'src/app.ts')
        (self.root / 'src/app.ts').write_text('hidden modification')
        with self.assertRaises(RuntimeError): m.require_source(self.native, prepared=False)

    def test_untracked_platform_override_and_symlink_source_rejected(self):
        override = self.root / 'src/app.ios.ts'; override.write_text('override')
        with self.assertRaises(RuntimeError): m.require_source(self.native, prepared=False)
        override.unlink()
        target = self.root / 'src/app.ts'; target.unlink(); target.symlink_to(self.root / 'package.json')
        with self.assertRaises((RuntimeError, ValueError, OSError)): m.require_source(self.native, prepared=False)

    def test_unknown_overlay_or_missing_overlay_receipt_rejected(self):
        with self.assertRaises(RuntimeError): m.require_source(self.native)

    def test_raw_source_guard_admits_only_current_recorded_generated_fixture(self):
        generated = self.root / '.github/native/.generated'; generated.mkdir(parents=True)
        path = generated / 'r52_tls_fixture.json'
        path.write_text(json.dumps({'schema': 1, 'platform': 'IOS', 'nonce': 'b' * 48}))
        source = self.git('rev-parse', 'HEAD').decode().strip()
        state = {'source_sha': source, 'native_generated_inputs': {'tls': {'source_sha': source,
            'path': '.github/native/.generated/r52_tls_fixture.json', 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}}}
        self.native.read = lambda: copy.deepcopy(state)
        m.require_source(self.native, prepared=False)
        (generated / 'override.ios.js').write_text('unreviewed platform override')
        with self.assertRaises(RuntimeError): m.require_source(self.native, prepared=False)

    def test_real_git_ignored_platform_source_patch_and_harness_overrides_are_rejected(self):
        exclude = self.root / '.git/info/exclude'
        for name in ('App.ios.tsx', 'AndroidFontFix.ios.ts', 'src/screens/Screen.ios.js',
                     'index.ios.js', '.babelrc.json', 'patches/ignored.patch',
                     '.github/native/keychain_probe.ios.js', '.github/native/.generated/r5_workers.ios.js'):
            with self.subTest(name=name):
                exclude.write_text(name + '\n')
                path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text('ignored override')
                self.assertEqual(self.git('ls-files', '--others', '--exclude-standard', '-z', '--', name), b'')
                self.assertEqual(self.git('ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', name), name.encode() + b'\0')
                with self.assertRaises(RuntimeError): m.require_source(self.native, prepared=False)
                path.unlink()

    def test_real_git_ignored_generated_fixture_requires_current_record_and_exact_bytes(self):
        generated = self.root / '.github/native/.generated'; generated.mkdir(parents=True)
        path = generated / 'r52_tls_fixture.json'; full = '.github/native/.generated/r52_tls_fixture.json'
        raw = json.dumps({'schema': 1, 'platform': 'IOS', 'nonce': 'b' * 48}).encode(); path.write_bytes(raw)
        (self.root / '.git/info/exclude').write_text('.github/native/.generated/\n')
        self.assertEqual(self.git('ls-files', '--others', '--exclude-standard', '-z', '--', full), b'')
        source = self.git('rev-parse', 'HEAD').decode().strip()
        state = {'source_sha': source, 'native_generated_inputs': {'tls': {'source_sha': source,
            'path': full, 'sha256': hashlib.sha256(raw).hexdigest()}}}
        self.native.read = lambda: copy.deepcopy(state)
        m.require_source(self.native, prepared=False)
        path.write_bytes(raw + b' ')
        with self.assertRaises(RuntimeError): m.require_source(self.native, prepared=False)
        path.write_bytes(raw); state['native_generated_inputs'] = {}
        with self.assertRaises(RuntimeError): m.require_source(self.native, prepared=False)
        path.unlink(); m.require_source(self.native, prepared=False)

    def test_nul_delimiters_reject_source_names_with_embedded_newline(self):
        name = '.github/native/override\nmodule.py'
        path = self.root / name; path.parent.mkdir(parents=True); path.write_text('override')
        (self.root / '.git/info/exclude').write_text('.github/native/\n')
        self.assertEqual(self.git('ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', '.github/native'), name.encode() + b'\0')
        with self.assertRaises(RuntimeError): m.require_source(self.native, prepared=False)

    def test_force_staging_an_ignored_override_cannot_hide_it_from_current_head_guard(self):
        name = 'App.ios.tsx'; path = self.root / name; path.write_text('ignored staged platform override')
        (self.root / '.git/info/exclude').write_text(name + '\n')
        self.git('add', '--force', name)
        self.assertEqual(self.git('ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', name), b'')
        self.assertEqual(self.git('ls-files', '--cached', '-z', '--', name), name.encode() + b'\0')
        with self.assertRaises(RuntimeError): m.require_source(self.native, prepared=False)

    def test_ignored_native_build_products_remain_valid_but_all_native_cache_is_rejected(self):
        names = ['ios/Pods/ignored.m', 'ios/build/Debug-iphonesimulator/generated-output',
                 'android/app/build/generated-output']
        (self.root / '.git/info/exclude').write_text('\n'.join(names) + '\n')
        for name in names:
            path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text('generated build output')
        m.require_source(self.native, prepared=False)
        cache = self.root / '.github/native/__pycache__'; cache.mkdir(parents=True)
        known = cache / 'owned.cpython-312.pyc'; known.write_bytes(b'bytecode is not a source exception')
        with self.assertRaises(RuntimeError): m.require_source(self.native, prepared=False)
        known.unlink()
        unknown = cache / 'override.py'; unknown.write_text('Python source override')
        with self.assertRaises(RuntimeError): m.require_source(self.native, prepared=False)


if __name__ == '__main__': unittest.main()
