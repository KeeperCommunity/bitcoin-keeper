"""Synthetic APK tests for the payload comparison aid."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile


spec = importlib.util.spec_from_file_location(
    "compare_android_apks", Path(__file__).with_name("compare-android-apks.py")
)
comparator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparator)


class ApkComparisonTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)

    def apk(self, name, entries, *, compression=zipfile.ZIP_STORED):
        path = self.directory / name
        with zipfile.ZipFile(path, "w", compression=compression) as archive:
            for entry_name, content in entries.items():
                archive.writestr(entry_name, content)
        return path

    def result(self, reference, rebuilt):
        return comparator.compare(
            comparator.inspect_apk(reference), comparator.inspect_apk(rebuilt)
        )

    def test_only_root_signing_material_is_excluded(self):
        common = {
            "classes.dex": b"same dex",
            "META-INF/services/provider": b"same non-signing metadata",
        }
        reference = self.apk("published.apk", {
            **common,
            "META-INF/MANIFEST.MF": b"original manifest digest",
            "META-INF/CERT.SF": b"original signature file",
            "META-INF/CERT.RSA": b"original certificate",
            "stamp-cert-sha256": b"original stamp",
        })
        rebuilt = self.apk("rebuilt.apk", {
            **common,
            "META-INF/MANIFEST.MF": b"different manifest digest",
            "META-INF/CERT.SF": b"different signature file",
            "META-INF/CERT.RSA": b"different certificate",
            "stamp-cert-sha256": b"different stamp",
        }, compression=zipfile.ZIP_DEFLATED)

        result = self.result(reference, rebuilt)
        self.assertEqual(result["verdict"], "match")
        self.assertEqual(result["summary"], {
            "matching_payload_entries": 2,
            "payload_differences": 0,
            "ignored_signing_differences": 4,
        })
        self.assertNotEqual(result["reference"]["apk_sha256"], result["rebuilt"]["apk_sha256"])

    def test_every_executable_and_resource_category_remains_critical(self):
        entries = {
            "AndroidManifest.xml": "manifest",
            "resources.arsc": "resource",
            "res/drawable/icon.png": "resource",
            "classes.dex": "dex",
            "assets/index.android.bundle": "javascript_bundle",
            "lib/arm64-v8a/librealm.so": "native_library",
            "assets/dexopt/baseline.prof": "baseline_profile",
            "META-INF/com.android.tools.build.gradle/app-metadata.properties": "metadata",
        }
        reference = self.apk("published.apk", {name: b"old" for name in entries})
        rebuilt = self.apk("rebuilt.apk", {name: b"new" for name in entries})

        result = self.result(reference, rebuilt)
        self.assertEqual(result["verdict"], "mismatch")
        self.assertEqual(result["summary"]["payload_differences"], len(entries))
        self.assertEqual(result["summary"]["ignored_signing_differences"], 0)
        self.assertEqual(
            {entry["path"]: entry["category"] for entry in result["differences"]},
            entries,
        )
        self.assertTrue(all(entry["status"] == "content_mismatch" for entry in result["differences"]))

    def test_added_removed_and_nested_signature_named_entries_are_reported(self):
        reference = self.apk("published.apk", {
            "classes.dex": b"same",
            "assets/META-INF/CERT.RSA": b"old nested asset",
            "assets/retired.dat": b"removed",
        })
        rebuilt = self.apk("rebuilt.apk", {
            "classes.dex": b"same",
            "assets/META-INF/CERT.RSA": b"new nested asset",
            "assets/added.dat": b"added",
        })

        result = self.result(reference, rebuilt)
        self.assertEqual(result["verdict"], "mismatch")
        self.assertEqual(result["summary"]["matching_payload_entries"], 1)
        self.assertEqual(result["summary"]["payload_differences"], 3)
        self.assertEqual(result["ignored_signing_entries"], [])
        self.assertEqual(
            {entry["path"]: entry["status"] for entry in result["differences"]},
            {
                "assets/META-INF/CERT.RSA": "content_mismatch",
                "assets/retired.dat": "only_reference",
                "assets/added.dat": "only_rebuilt",
            },
        )

    def test_duplicate_zip_paths_are_rejected(self):
        path = self.directory / "duplicate.apk"
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("classes.dex", b"first")
                archive.writestr("classes.dex", b"second")
        with self.assertRaisesRegex(ValueError, "Duplicate ZIP entry names"):
            comparator.inspect_apk(path)

    def test_cli_exit_codes_and_machine_readable_reports(self):
        reference = self.apk("published.apk", {"classes.dex": b"same"})
        rebuilt = self.apk("rebuilt.apk", {"classes.dex": b"different"})
        invalid = self.directory / "invalid.apk"
        invalid.write_bytes(b"not an APK")

        for candidate, expected_code, expected_verdict in (
            (reference, 0, "match"),
            (rebuilt, 1, "mismatch"),
            (invalid, 2, "invalid_input"),
        ):
            with self.subTest(candidate=candidate.name), patch.object(
                sys, "argv", ["compare-android-apks.py", str(reference), str(candidate)]
            ), contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(comparator.main(), expected_code)
            self.assertEqual(json.loads(output.getvalue())["verdict"], expected_verdict)


if __name__ == "__main__":
    unittest.main()
