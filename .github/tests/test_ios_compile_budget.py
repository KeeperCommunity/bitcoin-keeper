"""Actual compile-call budgets and failure-only bounded Xcode observations."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(os.environ.get('KEEPER_IOS_COMPILE_SOURCE_ROOT', Path(__file__).resolve().parents[2]))
SPEC = importlib.util.spec_from_file_location('compile_budget_native', ROOT / '.github/native/hosted_native.py')
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)
LABEL = 'Build unsigned development simulator app'
PHASES = {'C_COMPILE', 'SWIFT_COMPILE', 'SWIFT_MODULE', 'LINK', 'ARCHIVE',
          'SCRIPT', 'RESOURCE', 'COPY', 'SIGN'}
SCOPE = 'FAILURE_ONLY_BOUNDED_XCODE_TAIL_NOT_PROGRESS_RATE_CAUSE_OR_ACCEPTANCE'


class CompileBudgets(unittest.TestCase):
    def exercise(self, platform='IOS', architecture='x86_64', fail=False, observer_fail=False,
                 receipt_fail=False, descriptor_fail=False):
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory)
            primary = RuntimeError('PRIMARY_PRIVATE_SENTINEL')
            calls = []
            def command(args, label, **kwargs):
                calls.append((args, label, kwargs))
                data = native.read()
                data['commands'].append({'label': label, 'command': args})
                native.save(data)
                log = private / ('command-%03d.log' % len(data['commands']))
                log.write_text('CompileC /private/PRIVATE_SENTINEL.mm target SECRET\n')
                if label == LABEL and fail:
                    raise primary
                return 'synthetic Gradle version' if kwargs.get('capture') else ''
            with mock.patch.multiple(native, PLATFORM=platform, PRIVATE=private,
                    EVIDENCE=private / 'metadata.json'), \
                    mock.patch.object(native.platform, 'machine', return_value=architecture), \
                    mock.patch.object(native, 'disk_preflight'), \
                    mock.patch.object(native, 'command', side_effect=command), \
                    mock.patch.object(native, 'artifact_identity', return_value={'synthetic': True}), \
                    mock.patch.object(native, 'sign_simulator_app') as sign:
                native.save({'commands': [], 'build': 'NOT RUN', 'toolchain': {}})
                real_save = native.save
                def save(data):
                    if receipt_fail and 'ios_build_progress' in data:
                        raise OSError('RECEIPT_PRIVATE_SENTINEL')
                    return real_save(data)
                patches = [mock.patch.object(native, 'save', side_effect=save)]
                if observer_fail:
                    patches.append(mock.patch.object(native, 'ios_build_progress',
                        side_effect=OSError('OBSERVER_PRIVATE_SENTINEL')))
                if descriptor_fail:
                    patches.append(mock.patch.object(native.os, 'open',
                        side_effect=OSError('DESCRIPTOR_PRIVATE_SENTINEL')))
                for patch in patches:
                    patch.start()
                try:
                    if fail:
                        with self.assertRaises(RuntimeError) as raised:
                            native.build()
                        self.assertIs(raised.exception, primary)
                        sign.assert_not_called()
                    else:
                        native.build()
                        self.assertEqual(sign.call_count, int(platform == 'IOS'))
                    result = native.read()
                finally:
                    for patch in reversed(patches):
                        patch.stop()
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result.get('ios_build_progress')))
            return calls, result

    def test_real_build_calls_apply_larger_budget_only_to_Intel_iOS_compile(self):
        for platform, architecture, expected in [('IOS', 'x86_64', 3600),
                ('IOS', 'arm64', 2400), ('ANDROID', 'x86_64', 2100)]:
            with self.subTest(platform=platform, architecture=architecture):
                calls, result = self.exercise(platform, architecture)
                label = LABEL if platform == 'IOS' else 'Build debug-key-only development APK'
                args, _, kwargs = next(call for call in calls if call[1] == label)
                self.assertEqual(kwargs['timeout'], expected)
                if platform == 'IOS':
                    self.assertIn('ARCHS=' + architecture, args)
                    self.assertIn('CODE_SIGNING_ALLOWED=NO', args)
                self.assertNotIn('ios_build_progress', result)
                self.assertEqual(result['build'], 'PASS')

    def test_actual_build_failure_hook_collects_only_fixed_tail_and_cannot_grant_pass(self):
        _, result = self.exercise(fail=True)
        observation = result['ios_build_progress']
        self.assertEqual(observation['status'], 'OBSERVED')
        self.assertEqual(observation['phase_counts']['C_COMPILE'], 1)
        self.assertEqual(observation['scope'], SCOPE)
        self.assertEqual(result['build'], 'NOT RUN')

    def test_observer_or_receipt_failure_cannot_replace_primary_compile_failure(self):
        for options in ({'observer_fail': True}, {'receipt_fail': True}, {'descriptor_fail': True}):
            with self.subTest(options=options):
                _, result = self.exercise(fail=True, **options)
                self.assertEqual(result['build'], 'NOT RUN')
                if options.get('descriptor_fail'):
                    self.assertEqual(result['ios_build_progress']['status'], 'UNAVAILABLE')


class BuildTail(unittest.TestCase):
    def observe(self, payload):
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory)
            log = private / 'command-023.log'
            log.write_bytes(payload)
            with mock.patch.object(native, 'PRIVATE', private):
                result = native.ios_build_progress(log)
            self.assertEqual(set(result), {'schema', 'status', 'log_bytes', 'tail_bytes',
                'input_truncated', 'line_scan_truncated', 'lines_scanned', 'phase_counts',
                'last_phase', 'scope', 'terminal_record_incomplete'})
            self.assertEqual(result['scope'], SCOPE)
            self.assertEqual(set(result['phase_counts']), PHASES)
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
            self.assertNotIn('/private/', json.dumps(result))
            return result

    def test_only_anchored_Xcode_phase_names_create_fixed_counts(self):
        commands = [('CompileC', 'C_COMPILE'), ('SwiftCompile', 'SWIFT_COMPILE'),
            ('SwiftEmitModule', 'SWIFT_MODULE'), ('Ld', 'LINK'), ('Libtool', 'ARCHIVE'),
            ('PhaseScriptExecution', 'SCRIPT'), ('CompileAssetCatalog', 'RESOURCE'),
            ('Copy', 'COPY'), ('CodeSign', 'SIGN')]
        data = '\n'.join(name + ' /private/PRIVATE_SENTINEL target SECRET' for name, _ in commands) + '\n'
        result = self.observe(data.encode())
        self.assertEqual(result['status'], 'OBSERVED')
        self.assertEqual(result['phase_counts'], dict.fromkeys(PHASES, 1))
        self.assertEqual(result['last_phase'], 'SIGN')
        unknown = self.observe(b'error: PRIVATE_SENTINEL CompileC secret\n arbitrary Ld target\n')
        self.assertEqual(sum(unknown['phase_counts'].values()), 0)
        self.assertEqual(unknown['last_phase'], 'UNKNOWN')
        unfinished = self.observe(b'Ld PRIVATE_SENTINEL\nCompileC PRIVATE_SENTINEL')
        self.assertTrue(unfinished['terminal_record_incomplete'])
        self.assertEqual(unfinished['phase_counts']['C_COMPILE'], 0)
        self.assertEqual(unfinished['phase_counts']['LINK'], 1)
        self.assertEqual(unfinished['last_phase'], 'LINK')

    def test_tail_and_line_caps_do_not_classify_discarded_prefix_or_partial_line(self):
        result = self.observe(b'CompileC PRIVATE_SENTINEL\n' + b'x' * 70000 + b'\nLd PRIVATE_SENTINEL\n')
        self.assertTrue(result['input_truncated'])
        self.assertLessEqual(result['tail_bytes'], 65536)
        self.assertEqual(result['phase_counts']['C_COMPILE'], 0)
        self.assertEqual(result['phase_counts']['LINK'], 1)
        header, footer = b'CompileC PRIVATE_SENTINEL\n', b'\nLd PRIVATE_SENTINEL\n'
        tail = header + b'x' * (65536 - len(header) - len(footer)) + footer
        partial = self.observe(b'prefix_without_newline' + tail)
        self.assertTrue(partial['input_truncated'])
        self.assertEqual(partial['phase_counts']['C_COMPILE'], 0)
        self.assertEqual(partial['phase_counts']['LINK'], 1)
        capped = self.observe(b'CompileC PRIVATE_SENTINEL\n' * 1100 + b'Ld PRIVATE_SENTINEL\n')
        self.assertTrue(capped['line_scan_truncated'])
        self.assertEqual(capped['lines_scanned'], 1024)
        self.assertEqual(capped['phase_counts']['C_COMPILE'], 1023)
        self.assertEqual(capped['phase_counts']['LINK'], 1)

    def test_foreign_and_symlink_logs_are_unavailable_and_empty_log_is_not_progress_proof(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            private = parent / 'private'
            private.mkdir()
            foreign = parent / 'foreign.log'
            foreign.write_text('CompileC PRIVATE_SENTINEL\n')
            link = private / 'command-023.log'
            link.symlink_to(foreign)
            fifo = private / 'fifo.log'
            os.mkfifo(fifo)
            with mock.patch.object(native, 'PRIVATE', private):
                for path in (foreign, link, fifo, private / 'missing.log', private):
                    result = native.ios_build_progress(path)
                    self.assertEqual(result['status'], 'UNAVAILABLE')
                    self.assertEqual(sum(result['phase_counts'].values()), 0)
                    self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
            alias = parent / 'alias'
            alias.symlink_to(private, target_is_directory=True)
            with mock.patch.object(native, 'PRIVATE', alias):
                self.assertEqual(native.ios_build_progress(alias / 'fifo.log')['status'], 'UNAVAILABLE')
        empty = self.observe(b'')
        self.assertEqual(empty['status'], 'OBSERVED')
        self.assertEqual(empty['last_phase'], 'UNKNOWN')


if __name__ == '__main__':
    unittest.main()
