"""Failure capture exercises real Gradle8.14.3 headers, never an Android build."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('android_progress_test',
    Path(__file__).resolve().parents[1] / 'native/android_build_failure.py')
progress = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(progress)


class AndroidBuildFailureTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.private = self.root / 'private'
        self.private.mkdir()
        self.log = self.private / 'command-013.log'
        (self.root / 'package.json').write_text(json.dumps({'dependencies': {
            'react-native-tcp-socket': '6.4.1', '@react-native-community/netinfo': 'locked'}}))

    def project(self, raw):
        return progress.project(raw.encode(), self.root, progress.module_names(self.root))

    def test_actual_released_gradle_failure_headers_retain_last_exact_task(self):
        # Verbatim header records from the digest-pinned SDK-free8.14.3 probe.
        raw = '> Task :app:prepareSyntheticDependency\n> Task :app:compileDevelopmentDebugKotlin FAILED\nFAILURE: Build failed with an exception.\n'
        result = self.project(raw)
        self.assertEqual(result['last_task'], {'task': ':app:compileDevelopmentDebugKotlin', 'state': 'FAILED'})
        self.assertEqual(result['signals'], ['GRADLE_FAILURE'])

    def test_native_task_architecture_and_composite_namespace_are_kept(self):
        result = self.project('> Task :react-native-tcp-socket:buildCMakeDebug[x86_64]\n')
        self.assertEqual(result['last_task']['task'], ':react-native-tcp-socket:buildCMakeDebug[x86_64]')
        self.assertEqual(result['last_task']['state'], 'HEADER_OBSERVED')

    def test_unknown_namespace_and_arbitrary_lines_never_escape(self):
        result = self.project('PRIVATE_SENTINEL token=secret\n> Task :PRIVATE_SENTINEL:compileDebugKotlin\n')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        self.assertIsNone(result['last_task'])
        self.assertEqual(result['unrecognized_task_records'], 1)

    def test_heap_dump_jvm_flag_is_not_an_out_of_memory_error(self):
        self.assertNotIn('JVM_MEMORY', self.project('-XX:+HeapDumpOnOutOfMemoryError\n')['signals'])
        self.assertIn('JVM_MEMORY', self.project('java.lang.OutOfMemoryError: Java heap space\n')['signals'])

    def test_only_allowlisted_public_origin_artifact_identity_is_exported(self):
        result = self.project('Downloading https://repo.maven.apache.org/maven2/com/android/tools/build/gradle/8.8.0/gradle-8.8.0.pom\n')
        self.assertEqual(result['last_dependency'], {'repository': 'MAVEN_CENTRAL',
            'artifact_path': 'com/android/tools/build/gradle/8.8.0/gradle-8.8.0.pom'})

    def test_query_credentials_unknown_origin_and_traversal_are_discarded(self):
        for url in ('https://private.invalid/PRIVATE_SENTINEL.jar',
                    'https://token@repo.maven.apache.org/maven2/a.jar',
                    'https://repo.maven.apache.org/maven2/a.jar?token=PRIVATE_SENTINEL',
                    'https://repo.maven.apache.org/maven2/a.jar#PRIVATE_SENTINEL',
                    'https://repo.maven.apache.org/maven2/../PRIVATE_SENTINEL.jar',
                    'https://repo.maven.apache.org/maven2/%50RIVATE_SENTINEL.jar'):
            result = self.project('Downloading ' + url + '\n')
            self.assertIsNone(result['last_dependency'], url)
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_compiler_location_is_preserved_without_diagnostic_message(self):
        raw = 'e: file://' + str(self.root / 'node_modules/react-native-tcp-socket/android/TcpSocketClient.kt') + ':42:9 Unresolved reference: PRIVATE_SENTINEL\n'
        result = self.project(raw)
        self.assertEqual(result['compiler_locations'], [{'source_path': 'node_modules/react-native-tcp-socket/android/TcpSocketClient.kt',
            'line': 42, 'column': 9, 'category': 'UNRESOLVED_REFERENCE'}])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_foreign_source_locations_are_not_exported(self):
        result = self.project('e: file:///private/PRIVATE_SENTINEL.kt:1:1 error\n')
        self.assertEqual(result['compiler_locations'], [])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_read_owned_log_retains_size_age_and_failure_scope_only(self):
        self.log.write_text('> Task :app:compileDevelopmentDebugKotlin\n')
        result = progress.collect(self.private, self.log, self.root)
        self.assertEqual(result['state'], 'OBSERVED')
        self.assertFalse(result['native_acceptance'])
        self.assertEqual(result['log_bytes'], self.log.stat().st_size)
        self.assertGreaterEqual(result['last_write_age_seconds'], 0)

    def test_streaming_preserves_task_before_noise_beyond_old_tail_size(self):
        self.log.write_text('> Task :app:compileDevelopmentDebugKotlin\n' + 'PRIVATE_SENTINEL\n' * 40000)
        result = progress.collect(self.private, self.log, self.root)
        self.assertFalse(result['input_truncated'])
        self.assertEqual(result['scanned_bytes'], self.log.stat().st_size)
        self.assertEqual(result['last_task']['task'], ':app:compileDevelopmentDebugKotlin')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_byte_caps_still_retain_recent_tail_without_unbounded_records(self):
        self.log.write_text('PRIVATE_SENTINEL\n' * 40000 + '> Task :app:compileDevelopmentDebugKotlin\n')
        with mock.patch.object(progress, 'SCAN_BYTES', 4096), mock.patch.object(progress, 'TAIL_BYTES', 1024):
            result = progress.collect(self.private, self.log, self.root)
        self.assertTrue(result['input_truncated'])
        self.assertLessEqual(result['scanned_bytes'], 4096 + 1024)
        self.assertEqual(result['last_task']['task'], ':app:compileDevelopmentDebugKotlin')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_actual_released_info_start_discards_thread_payload(self):
        result = self.project(':app:compileDevelopmentDebugKotlin (Thread[Execution worker,5,main]) started.\n')
        self.assertEqual(result['last_task'], {'task': ':app:compileDevelopmentDebugKotlin', 'state': 'STARTED_OBSERVED'})
        self.assertNotIn('Thread', json.dumps(result))

    def test_oversized_and_incomplete_lines_are_not_treated_as_task_records(self):
        result = self.project('> Task :app:compileDevelopmentDebugKotlin' + 'x' * 5000 + '\n> Task :app:compileDevelopmentDebugKotlin')
        self.assertIsNone(result['last_task'])
        self.assertEqual(result['overlong_line_records'], 1)
        self.assertTrue(result['terminal_record_incomplete'])

    def test_retained_records_and_scan_line_count_have_fixed_caps(self):
        raw = ('> Task :app:compileDevelopmentDebugKotlin\n' * 100).encode()
        with mock.patch.object(progress, 'SCAN_LINES', 10), mock.patch.object(progress, 'TAIL_LINES', 3):
            result = progress.project(raw, self.root, {'app'})
        self.assertLessEqual(result['lines_scanned'], 13)
        self.assertTrue(result['line_scan_truncated'])
        self.assertLessEqual(len(result['task_records']), 20)

    def test_symlink_hardlink_foreign_and_missing_logs_remain_unavailable(self):
        self.assertEqual(progress.collect(self.private, self.log, self.root)['state'], 'UNAVAILABLE')
        other = self.root / 'other.log'
        other.write_text('PRIVATE_SENTINEL')
        self.log.symlink_to(other)
        self.assertEqual(progress.collect(self.private, self.log, self.root)['state'], 'UNAVAILABLE')
        self.log.unlink()
        self.log.hardlink_to(other)
        self.assertEqual(progress.collect(self.private, self.log, self.root)['state'], 'UNAVAILABLE')
        self.assertEqual(progress.collect(self.private, other, self.root)['state'], 'UNAVAILABLE')

    def exercise_failed_build(self, break_capture=False):
        spec = importlib.util.spec_from_file_location('android_failure_harness',
            Path(__file__).resolve().parents[1] / 'native/hosted_native.py')
        native = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(native)
        def command(args, label, **kwargs):
            data = native.read()
            data['commands'].append({'label': label})
            native.save(data)
            if label == 'Record actual Gradle and JVM version':
                return 'Gradle8.14.3'
            self.assertEqual(args, ['./gradlew', ':app:assembleDevelopmentDebug', '--no-daemon',
                '--max-workers=2', '-PreactNativeArchitectures=x86_64', '-Pandroid.buildOnlyTargetAbi=true',
                '-Pandroid.injected.build.abi=x86_64', '-Pandroid.injected.testOnly=false',
                '-Pandroid.injected.apk.location=' + str(self.root / 'android/app/build/outputs/apk'),
                '--info', '--console=plain'])
            self.assertEqual(kwargs, {'timeout': 3000, 'cwd': self.root / 'android'})
            (self.private / 'command-002.log').write_text('> Task :app:compileDevelopmentDebugKotlin\n')
            raise RuntimeError('ORIGINAL_BUILD_TIMEOUT')
        with mock.patch.multiple(native, ROOT=self.root, PRIVATE=self.private,
                EVIDENCE=self.root / 'metadata.json', PLATFORM='ANDROID'), \
                mock.patch.object(native, 'disk_preflight') as preflight, \
                mock.patch.object(native, 'command', side_effect=command):
            native.save({'commands': [], 'toolchain': {}, 'build': 'NOT RUN'})
            with mock.patch.object(native.importlib.util, 'spec_from_file_location',
                    side_effect=RuntimeError('PRIVATE_SENTINEL')) if break_capture else mock.patch.dict(os.environ, {}):
                with self.assertRaisesRegex(RuntimeError, '^ORIGINAL_BUILD_TIMEOUT$'):
                    native.run_phase('build')
            preflight.assert_called_once_with('before_native_build')
            result = native.read()
        self.assertEqual(result['build'], 'FAIL')
        self.assertEqual(result['failed_phase'], 'build')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        return result

    def test_actual_failure_hook_retains_progress_and_original_fail(self):
        result = self.exercise_failed_build()
        self.assertEqual(result['android_build_failure']['last_task']['task'], ':app:compileDevelopmentDebugKotlin')
        self.assertFalse(result['android_build_failure']['native_acceptance'])

    def test_capture_failure_never_replaces_original_exception_or_fail(self):
        result = self.exercise_failed_build(break_capture=True)
        self.assertNotIn('android_build_failure', result)


if __name__ == '__main__':
    unittest.main()
