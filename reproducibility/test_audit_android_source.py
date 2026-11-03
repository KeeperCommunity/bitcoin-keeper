import base64
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("audit-android-source.py")
SPEC = importlib.util.spec_from_file_location("audit_android_source", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
PRIVATE_VALUE = "private-fixture-do-not-print"
SRI = "sha512-" + base64.b64encode(hashlib.sha512(b"fixture").digest()).decode()


class SourceAuditTest(unittest.TestCase):
    def test_configuration_reports_names_without_values_or_comment_false_positives(self):
        source = f"""import config from 'react-native-config';
        const defaultConfig = {{ RELAY: '{PRIVATE_VALUE}' }};
        // config.COMMENTED
        const text = 'config.STRING';
        config.RELAY; config['ENVIRONMENT']; config[computedName];
        """
        names, dynamic, unsupported = MODULE.configuration_names(source)
        self.assertEqual(names, ["ENVIRONMENT", "RELAY"])
        self.assertEqual(dynamic, 1)
        self.assertEqual(unsupported, 0)

    def test_optional_access_supported_and_destructuring_reported_unresolved(self):
        source = """import cfg from 'react-native-config';
        cfg?.GASFREE_API_KEY; cfg?.['RELAY'];
        const { GASFREE_API_SECRET } = cfg;
        const copied = { ...cfg };
        other.cfg.UNRELATED;
        """
        names, dynamic, unsupported = MODULE.configuration_names(source)
        self.assertEqual(names, ["GASFREE_API_KEY", "RELAY"])
        self.assertEqual(dynamic, 0)
        self.assertEqual(unsupported, 2)

    def test_configuration_requires_supported_import(self):
        with self.assertRaises(MODULE.AuditError):
            MODULE.configuration_names("const config = {}; config.RELAY;")

    def test_names_manifest_rejects_duplicates_and_invalid_names(self):
        for names in (["RELAY", "RELAY"], [PRIVATE_VALUE], [], "RELAY"):
            with self.subTest(names=names), self.assertRaises(MODULE.AuditError):
                MODULE.approved_names({"environment_names": names})

    def test_yarn_reports_pinned_git_and_missing_integrity_without_remote_values(self):
        source = f'''# yarn lockfile v1
"@scope/pkg@^1", "@scope/pkg@~1":
  version "1.0.0"
  resolved "https://registry.example/{PRIVATE_VALUE}/pkg.tgz"
  integrity {SRI}
"native@git+https://{PRIVATE_VALUE}@example.invalid/native.git#{'a' * 40}":
  version "1.0.0"
  resolved "git+https://{PRIVATE_VALUE}@example.invalid/native.git#{'a' * 40}"
"rn-nodeify@github:tradle/rn-nodeify#{'b' * 40}":
  resolved "https://codeload.github.com/tradle/rn-nodeify/tar.gz/{'b' * 40}"
'''
        report = MODULE.yarn_report(source)
        self.assertEqual(report["entries"], 3)
        self.assertEqual(report["integrity_algorithms"], {"sha512": 1})
        self.assertEqual(report["packages_without_integrity"], ["native", "rn-nodeify"])
        self.assertEqual(report["git_entries"], [{"packages": ["native"], "full_commit_pinned": True}])
        self.assertEqual(report["github_commit_archive_entries"], [{"packages": ["rn-nodeify"], "full_commit_pinned": True}])
        self.assertNotIn(PRIVATE_VALUE, json.dumps(report))

    def test_yarn_rejects_corrupt_integrity_and_noncommit_git_pin(self):
        source = '''"native@git+https://example.invalid/native.git#main":
  resolved "git+https://example.invalid/native.git#main"
  integrity sha512-Zm9v
'''
        report = MODULE.yarn_report(source)
        self.assertEqual(report["packages_with_invalid_integrity"], ["native"])
        self.assertFalse(report["git_entries"][0]["full_commit_pinned"])

    def test_gradle_dynamic_selectors_exclude_comments_and_fixed_versions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "build.gradle"
            path.write_text('''// implementation 'org.example:comment:+'
implementation 'org.example:fixed:1.0'
implementation 'org.example:dynamic:+'
implementation "org.example:range:[1,2)"
implementation 'org.example:nightly:1.0-SNAPSHOT'
''')
            report = MODULE.gradle_dynamic_declarations(path, "android/build.gradle")
        self.assertEqual([item["line"] for item in report], [3, 4, 5])
        self.assertEqual([item["coordinate"] for item in report],
                         ["org.example:dynamic:+", "org.example:range:[1,2)", "org.example:nightly:1.0-SNAPSHOT"])

    def test_realm_detects_checksum_omission_without_exporting_url(self):
        with tempfile.TemporaryDirectory() as directory:
            package = Path(directory)
            path = package / "prebuilds/android/arm64-v8a/share/cmake/Realm/AcquireRealmDependency.cmake"
            path.parent.mkdir(parents=True)
            path.write_text(f'file(DOWNLOAD "https://example.invalid/{PRIVATE_VALUE}" "archive" STATUS result)')
            report = MODULE.realm_report(package)
            self.assertFalse(report["outside_gradle_downloads"][0]["literal_expected_hash_argument"])
            self.assertFalse(report["outside_gradle_downloads"][0]["conditional_checksum_options_present"])
            self.assertNotIn(PRIVATE_VALUE, json.dumps(report))
            path.write_text('file(DOWNLOAD "url" "archive" EXPECTED_HASH "SHA256=pin" STATUS result)')
            inline = MODULE.realm_report(package)["outside_gradle_downloads"][0]
            self.assertTrue(inline["literal_expected_hash_argument"])
            self.assertFalse(inline["conditional_checksum_options_present"])

    def test_original_and_patched_realm_helper_distinguish_conditional_checksum_options(self):
        original = '''function(realm_acquire_dependency dep_name dep_version out_dep_cmake)
        if(NOT EXISTS ${CMAKE_CURRENT_BINARY_DIR}/${dep_name}/include.cmake)
            file(DOWNLOAD "${DEP_URL}" "archive" STATUS download_status)
        endif()
        endfunction()
        '''
        patched = original.replace('        if(NOT EXISTS', '''        set(_realm_download_verification_args)
        if(ANDROID AND dep_name STREQUAL "openssl")
            set(_realm_download_verification_args EXPECTED_HASH "SHA256=${_realm_expected_sha256}")
        endif()
        if(NOT EXISTS''').replace('STATUS download_status)', '${_realm_download_verification_args} STATUS download_status)')
        with tempfile.TemporaryDirectory() as directory:
            package = Path(directory)
            path = package / "prebuilds/android/arm64-v8a/share/cmake/Realm/AcquireRealmDependency.cmake"
            path.parent.mkdir(parents=True)
            path.write_text(original)
            upstream = MODULE.realm_report(package)["outside_gradle_downloads"][0]
            self.assertFalse(upstream["literal_expected_hash_argument"])
            self.assertFalse(upstream["conditional_checksum_options_present"])
            path.write_text(patched)
            report = MODULE.realm_report(package)
            declarations = report["outside_gradle_downloads"][0]
            self.assertFalse(declarations["literal_expected_hash_argument"])
            self.assertTrue(declarations["conditional_checksum_options_present"])
            self.assertFalse(report["runtime_checksum_verification_executed"])
            self.assertFalse(report["archive_bytes_verified"])

    def test_report_names_allowlist_gap_passively_and_has_stable_input_fingerprint(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            config = repo / MODULE.CONFIG_PATH
            config.parent.mkdir(parents=True)
            config.write_text(f"import cfg from 'react-native-config'; cfg.RELAY; cfg.GASFREE_API_KEY; const value='{PRIVATE_VALUE}';")
            (repo / "android").mkdir()
            (repo / "package.json").write_text("{}")
            (repo / "yarn.lock").write_text(f'realm@12.15.0:\n  resolved "https://example.invalid/realm.tgz"\n  integrity {SRI}\n')
            inputs = repo / "inputs.json"
            inputs.write_text(json.dumps({"environment_names": ["RELAY"], "yarn_lock_sha256": MODULE.sha256(repo / "yarn.lock")}))
            first = MODULE.audit(repo, inputs)
            second = MODULE.audit(repo, inputs)
            self.assertEqual(first["configuration"]["used_names_outside_allowlist"], ["GASFREE_API_KEY"])
            self.assertTrue(first["chosen_manifest_yarn_hash_matches"])
            self.assertEqual(first["source_input_fingerprint_sha256"], second["source_input_fingerprint_sha256"])
            self.assertNotIn(PRIVATE_VALUE, json.dumps(first))
            config.write_text(config.read_text() + "\n// change\n")
            self.assertNotEqual(first["source_input_fingerprint_sha256"], MODULE.audit(repo, inputs)["source_input_fingerprint_sha256"])

    def test_cli_read_failure_does_not_export_private_path(self):
        stderr = io.StringIO()
        with patch("sys.argv", [str(SCRIPT), "--repo", f"/missing/{PRIVATE_VALUE}"]), contextlib.redirect_stderr(stderr):
            self.assertEqual(MODULE.main(), 1)
        self.assertNotIn(PRIVATE_VALUE, stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
