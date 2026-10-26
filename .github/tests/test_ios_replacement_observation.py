"""Real private-tree comparisons and fake read-only tools; no native credit."""
import copy
import importlib.util
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

NATIVE = Path(__file__).parents[1] / 'native'


def load(name):
    spec = importlib.util.spec_from_file_location(name, NATIVE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


observe = load('ios_replacement_observation')
hosted = load('hosted_native')
policy = load('simulator_signing')
commands = load('ios_startup_command_observation')
DEVICE = '12345678-1234-1234-1234-123456789ABC'
CONTAINER = 'ABCDEF12-1234-1234-1234-123456789ABC'


class ReplacementObservation(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.private = Path(temporary.name)
        self.home = self.private / 'home'
        self.built = self.private / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
        self.built.mkdir(parents=True)
        (self.built / 'Info.plist').write_bytes(plistlib.dumps({
            'CFBundleIdentifier': observe.APP, 'CFBundleExecutable': 'hexa_keeper_dev'}))
        (self.built / 'hexa_keeper_dev').write_bytes(b'PRIVATE_SENTINEL_EXECUTABLE')
        (self.built / 'resource').write_text('PRIVATE_SENTINEL_RESOURCE')
        (self.built / 'internal-link').symlink_to('resource')
        self.installed = (self.home / 'Library/Developer/CoreSimulator/Devices' / DEVICE /
            'data/Containers/Bundle/Application' / CONTAINER / self.built.name)
        shutil.copytree(self.built, self.installed, symlinks=True)
        self.state = {'smoke': 'FAIL', 'installed_artifact_verified': True,
            'built_artifact': {'PRIVATE_SENTINEL': 'immutable'}}
        self.original = copy.deepcopy(self.state)
        self.native = SimpleNamespace(PLATFORM='IOS', PRIVATE=self.private, MAESTRO_VERSION=hosted.MAESTRO_VERSION,
            read=lambda: self.state, artifact_identity=mock.Mock(return_value=self.state['built_artifact']),
            _bundle_inventory=hosted._bundle_inventory, owned_ios_bundle_path=hosted.owned_ios_bundle_path)

    def tool(self, private, args):
        self.assertEqual(private, self.private)
        if args[:4] == ['xcrun', 'simctl', 'get_app_container', DEVICE]:
            self.assertEqual(args[4:], [observe.APP, 'app'])
            return 'EXIT_ZERO', str(self.installed).encode()
        self.assertEqual(args[0], 'codesign')
        self.assertEqual(args[-1], str(self.installed))
        if args[1:4] == ['--verify', '--deep', '--strict']:
            return 'EXIT_ZERO', b''
        if args[1:3] == ['--display', '--verbose=4']:
            return 'EXIT_ZERO', b'PRIVATE_SENTINEL\nSignature=adhoc\n'
        self.assertEqual(args[1:4], ['--display', '--entitlements', ':-'])
        return 'EXIT_ZERO', b'PRIVATE_SENTINEL\n' + plistlib.dumps(policy.ENTITLEMENTS)

    def collect(self, tool=None):
        with mock.patch.object(hosted.Path, 'home', return_value=self.home), \
                mock.patch.object(observe, 'query', side_effect=tool or self.tool):
            result = observe.collect(self.native, DEVICE)
        self.assertEqual(self.state, self.original)
        encoded = json.dumps(result)
        for secret in ('PRIVATE_SENTINEL', str(self.private), observe.APP, DEVICE, 'KEEPERCI00'):
            self.assertNotIn(secret, encoded)
        return result

    def test_exact_current_instance_bytes_signature_entitlements_are_observed_without_promotion(self):
        result = self.collect()
        self.assertEqual((result['state'], result['stage']), ('OBSERVED', 'COMPLETE'))
        self.assertEqual((result['bytes'], result['signature'], result['identity'], result['entitlements']),
                         ('MATCH', 'VERIFIED', 'ADHOC', 'MATCH'))
        self.assertEqual((result['built_internal_links'], result['installed_internal_links']), (1, 1))
        self.assertIn('NOT_LAUNCH_CAUSE_OR_ACCEPTANCE', result['scope'])

    def test_real_link_and_file_mutation_remain_mismatch_with_no_equivalence_allowance(self):
        (self.installed / 'internal-link').unlink()
        (self.installed / 'internal-link').write_bytes(b'PRIVATE_SENTINEL_RESOURCE')
        (self.installed / 'resource').write_text('changed')
        result = self.collect()
        self.assertEqual(result['bytes'], 'MISMATCH')
        self.assertEqual((result['built_internal_links'], result['installed_internal_links']), (1, 0))

    def test_normal_retained_profile_adds_recorded_comparison_without_overwriting_legacy_mismatch(self):
        self.state.update(compiled_app_source_sha='ff3cc6b2721de986d9f6211ef333df57ebc3b1fa',
            source_sha='a' * 40, native_acceptance=False,
            build_execution_scope='REUSED_EXACT_NORMAL_XCODE_APP_NO_CURRENT_COMPILATION_OR_RESIGNING',
            retained_xcode_restore='PASS', original_signature_preserved=True,
            app_inputs_sha256='6112e0e18e093e5e65e754fc607aa7e44ee73682576a31a168a6ad01f06a2b85',
            original_build={'source_sha': 'ff3cc6b2721de986d9f6211ef333df57ebc3b1fa', 'artifact_id': 12667427189,
                'artifact_zip_sha256': '89806c9d8d71dc032d2ce3ca8b444768705d1ca3ab565aa9ec0652f0277b76f5'},
            toolchain={'ios_simulator_signature': {'verified': True, 'certificate_or_profile_used': False,
                'scope': 'XCODE_GENERATED_ADHOC_SIMULATOR_ONLY_NOT_RELEASE_SIGNING', 'bundle_id': observe.APP,
                'entitlement_policy': 'XCODE_GENERATED_SIGNED_AND_LINKER_EMBEDDED_SIMULATOR_ENTITLEMENTS',
                'entitlements_sha256': '97704a8960b4facceef54397a08fb5d0a456247c3627359215aa2a27df22656c'}})
        self.original = copy.deepcopy(self.state)
        def tool(private, args):
            if args[1:3] == ['--display', '--entitlements']:
                return 'EXIT_ZERO', plistlib.dumps({})
            return self.tool(private, args)
        result = self.collect(tool)
        self.assertEqual(result['entitlements'], 'MISMATCH')
        self.assertEqual(result['entitlement_comparison']['state'], 'MATCH')
        self.assertEqual(result['bytes'], 'MATCH')

    def test_pinned_maestro_timestamped_name_is_observed_but_canonical_acceptance_stays_strict(self):
        replacement = self.installed.with_name(observe.APP + '-1792838180000.app')
        self.installed.rename(replacement)
        self.installed = replacement
        result = self.collect()
        self.assertEqual((result['state'], result['bytes'], result['signature'], result['entitlements']),
                         ('OBSERVED', 'MATCH', 'VERIFIED', 'MATCH'))
        with mock.patch.object(hosted.Path, 'home', return_value=self.home), self.assertRaises(ValueError):
            hosted.owned_ios_bundle_path(str(self.installed), DEVICE, self.built)

    def test_timestamped_name_requires_exact_owned_id_ascii_milliseconds_and_pinned_tool(self):
        original = self.installed
        for name in ('Foreign-1792838180000.app', observe.APP + '-179283818000.app',
                observe.APP + '-17928381800000.app', observe.APP + '-0000000000000.app',
                observe.APP + '-1792838180000.app.extra', observe.APP + '-1792838180000.app\n',
                observe.APP + '-１７９２８３８１８００００.app'):
            target = original.with_name(name)
            self.installed.rename(target); self.installed = target
            self.assertEqual(self.collect()['stage'], 'INSTALLED_CONTAINER_POLICY')
            self.installed.rename(original); self.installed = original
        target = original.with_name(observe.APP + '-1792838180000.app')
        self.installed.rename(target); self.installed = target
        self.native.MAESTRO_VERSION = 'cli-future'
        self.assertEqual(self.collect()['stage'], 'INSTALLED_CONTAINER_POLICY')

    def test_timestamped_name_does_not_admit_foreign_devices_or_symlink_escape(self):
        original = self.installed
        alias = original.with_name(observe.APP + '-1792838180000.app')
        outside = self.private / 'outside.app'
        shutil.copytree(self.built, outside, symlinks=True)
        alias.symlink_to(outside, target_is_directory=True)
        self.installed = alias
        self.assertEqual(self.collect()['stage'], 'INSTALLED_CONTAINER_POLICY')
        alias.unlink()
        self.installed = original
        foreign = self.home / 'Library/Developer/CoreSimulator/Devices' / CONTAINER / 'data/Containers/Bundle/Application' / CONTAINER / alias.name
        shutil.copytree(self.built, foreign, symlinks=True)
        self.installed = foreign
        self.assertEqual(self.collect()['stage'], 'INSTALLED_CONTAINER_POLICY')

    def test_late_timestamped_name_change_discards_all_conclusions(self):
        first = self.installed.with_name(observe.APP + '-1792838180000.app')
        self.installed.rename(first); self.installed = first
        second = first.with_name(observe.APP + '-1792838180001.app')
        shutil.copytree(self.built, second, symlinks=True)
        calls = 0
        def changing(private, args):
            nonlocal calls
            if args[0] == 'xcrun':
                calls += 1
                if calls == 2:
                    return 'EXIT_ZERO', str(second).encode()
            return self.tool(private, args)
        result = self.collect(changing)
        self.assertEqual((result['state'], result['stage'], result['bytes'], result['signature']),
                         ('UNKNOWN', 'INSTALLED_STABILITY', 'UNKNOWN', 'UNKNOWN'))

    def test_missing_foreign_and_aliased_containers_are_unknown_and_not_inspected(self):
        for target in (self.private / self.built.name, self.installed.parent / 'Foreign.app'):
            with self.subTest(target=target.name):
                def tool(private, args):
                    self.assertEqual(args[0], 'xcrun')
                    return 'EXIT_ZERO', str(target).encode()
                result = self.collect(tool)
                self.assertEqual((result['state'], result['stage']), ('UNKNOWN', 'INSTALLED_CONTAINER_POLICY'))
                self.assertEqual(result['bytes'], 'UNKNOWN')
        shutil.rmtree(self.installed)
        self.assertEqual(self.collect()['stage'], 'INSTALLED_CONTAINER_POLICY')

    def test_built_drift_and_installed_drift_discard_all_conclusions(self):
        self.native.artifact_identity.side_effect = [self.state['built_artifact'], {'changed': True}]
        result = self.collect()
        self.assertEqual((result['stage'], result['bytes']), ('BUILT_ARTIFACT_STABILITY', 'UNKNOWN'))
        self.native.artifact_identity.side_effect = None
        def changing(private, args):
            answer = self.tool(private, args)
            if args[1:3] == ['--display', '--entitlements']:
                (self.installed / 'resource').write_text('changed during signature read')
            return answer
        result = self.collect(changing)
        self.assertEqual((result['stage'], result['bytes'], result['signature']),
                         ('INSTALLED_STABILITY', 'UNKNOWN', 'UNKNOWN'))

    def test_replaced_container_or_failed_final_query_discards_all_conclusions(self):
        replacement = self.installed.parent.parent / '11111111-1111-1111-1111-111111111111' / self.built.name
        shutil.copytree(self.built, replacement, symlinks=True)
        for status, payload in (('EXIT_ZERO', str(replacement).encode()), ('TIMEOUT', None)):
            count = 0
            def changing(private, args):
                nonlocal count
                if args[0] == 'xcrun':
                    count += 1
                    if count == 2:
                        return status, payload
                return self.tool(private, args)
            result = self.collect(changing)
            self.assertEqual(result['state'], 'UNKNOWN')
            self.assertEqual(result['bytes'], 'UNKNOWN')
            self.assertEqual(result['stage'], 'INSTALLED_STABILITY' if status == 'EXIT_ZERO' else 'FINAL_CONTAINER_QUERY')

    def test_same_byte_built_link_replacement_is_detected_by_final_typed_inventory(self):
        def changing(private, args):
            answer = self.tool(private, args)
            if args[1:3] == ['--display', '--entitlements']:
                link = self.built / 'internal-link'
                content = link.read_bytes()
                link.unlink()
                link.write_bytes(content)
            return answer
        result = self.collect(changing)
        self.assertEqual((result['state'], result['stage'], result['bytes']),
                         ('UNKNOWN', 'BUILT_ARTIFACT_STABILITY', 'UNKNOWN'))

    def test_signature_tool_rejection_and_unavailable_entitlements_stay_explicit(self):
        def rejected(private, args):
            if args[:2] == ['codesign', '--verify']:
                return 'NONZERO_EXIT', None
            if args[1:3] == ['--display', '--entitlements']:
                return 'TIMEOUT', None
            return self.tool(private, args)
        result = self.collect(rejected)
        self.assertEqual((result['bytes'], result['signature'], result['entitlements']),
                         ('MATCH', 'NOT_VERIFIED', 'UNKNOWN'))
        self.assertEqual(result['queries']['entitlements'], 'TIMEOUT')

    def test_effective_entitlements_require_complete_typed_policy_and_parseable_xml(self):
        self.assertEqual(observe.entitlement_state(plistlib.dumps(policy.ENTITLEMENTS)), 'MATCH')
        for changed in ({**policy.ENTITLEMENTS, 'get-task-allow': 1},
                        {**policy.ENTITLEMENTS, 'private-extra': 'PRIVATE_SENTINEL'},
                        {**policy.ENTITLEMENTS, 'keychain-access-groups': []}):
            self.assertEqual(observe.entitlement_state(plistlib.dumps(changed)), 'MISMATCH')
        for payload in (b'PRIVATE_SENTINEL', b'<?xml malformed</plist>', b'x' * (observe.LIMIT + 1),
                        plistlib.dumps(policy.ENTITLEMENTS) * 2):
            self.assertEqual(observe.entitlement_state(payload), 'UNKNOWN')

    def test_private_queries_are_read_only_bounded_timed_and_always_close_output(self):
        captured = []
        def run(args, **kwargs):
            self.assertEqual(args, ['codesign', '--verify', '--deep', '--strict', str(self.installed)])
            self.assertEqual(kwargs['timeout'], 20)
            self.assertEqual(kwargs['stderr'], subprocess.STDOUT)
            captured.append(kwargs['stdout'])
            kwargs['stdout'].write(b'PRIVATE_SENTINEL')
            return SimpleNamespace(returncode=0)
        args = ['codesign', '--verify', '--deep', '--strict', str(self.installed)]
        with mock.patch.object(observe.subprocess, 'run', side_effect=run):
            self.assertEqual(observe.query(self.private, args), ('EXIT_ZERO', b'PRIVATE_SENTINEL'))
        self.assertTrue(captured[0].closed)
        for failure, state in ((subprocess.TimeoutExpired(args, 20), 'TIMEOUT'),
                               (OSError('PRIVATE_SENTINEL'), 'UNAVAILABLE')):
            with mock.patch.object(observe.subprocess, 'run', side_effect=failure):
                self.assertEqual(observe.query(self.private, args), (state, None))
        def oversized(args, **kwargs):
            kwargs['stdout'].write(b'x' * (observe.LIMIT + 1))
            return SimpleNamespace(returncode=0)
        with mock.patch.object(observe.subprocess, 'run', side_effect=oversized):
            self.assertEqual(observe.query(self.private, args), ('OVERSIZED', None))
        self.assertEqual(sorted(path.name for path in self.private.iterdir()), ['DerivedData', 'home'])


class LaunchCodes(unittest.TestCase):
    def test_exact_top_and_underlying_headers_export_only_allowlisted_pairs(self):
        result = commands.launch_error_codes({'message':
            'An error was encountered processing the command (domain=FBSOpenApplicationServiceErrorDomain, code=1):\n'
            'PRIVATE_SENTINEL description\nUnderlying error (domain=NSOSStatusErrorDomain, code=-10814):\n'
            'PRIVATE_SENTINEL path'})
        self.assertEqual(result['state'], 'RECORDED')
        self.assertEqual(result['pairs'], [{'domain': 'FBSOpenApplicationServiceErrorDomain', 'code': 1},
                                         {'domain': 'NSOSStatusErrorDomain', 'code': -10814}])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_unsupported_ambiguous_overflow_and_excess_pairs_are_unknown_without_partial_values(self):
        top = 'An error was encountered processing the command (domain=%s, code=%s):'
        for message in (top % ('PRIVATE_SENTINEL', 1), top % ('NSPOSIXErrorDomain', '01'),
                        top % ('NSPOSIXErrorDomain', '2147483648'), top % ('NSPOSIXErrorDomain', '1.0'),
                        top % ('NSPOSIXErrorDomain', 1) + ' PRIVATE_SENTINEL',
                        '\u00a0' + top % ('NSPOSIXErrorDomain', 1),
                        'Error Domain=NSPOSIXErrorDomain Code=1 PRIVATE_SENTINEL',
                        '\n'.join(top % ('NSPOSIXErrorDomain', number) for number in range(9))):
            result = commands.launch_error_codes({'message': message})
            self.assertEqual((result['state'], result['pairs']), ('UNKNOWN', []))

    def test_code_projection_only_attaches_to_recorded_failed_owned_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            flow = output / commands.FLOW
            flow.mkdir()
            message = 'Underlying error (domain=NSPOSIXErrorDomain, code=3):'
            row = {'command': {'launchAppCommand': {'appId': commands.APP}},
                   'metadata': {'status': 'FAILED', 'sequenceNumber': 0, 'error': {'message': message}}}
            path = flow / 'commands.json'
            path.write_text(json.dumps([row]))
            self.assertEqual(commands.commands(output)['rows'][0]['launch_error_codes']['state'], 'RECORDED')
            row['metadata']['status'] = 'RUNNING'
            path.write_text(json.dumps([row]))
            self.assertNotIn('launch_error_codes', commands.commands(output)['rows'][0])
            row['metadata']['status'] = 'FAILED'
            row['command']['launchAppCommand']['appId'] = 'PRIVATE_SENTINEL'
            path.write_text(json.dumps([row]))
            self.assertNotIn('launch_error_codes', commands.commands(output)['rows'][0])


if __name__ == '__main__':
    unittest.main()
