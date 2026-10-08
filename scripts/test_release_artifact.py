"""Packaged-build regression tests; no store access or signing keys required."""
import hashlib
import importlib.util
import os
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("artifact", Path(__file__).with_name("verify-release-artifact.py"))
artifact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifact)
MANIFEST = {"version": "2.5.15", "iosBuildNumber": 615, "androidVersionCode": 622}
FEATURES = b"HelpAiEntry\0DustReport\0doNotSpend"


class PackagedBuildTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)

    def ipa(self, *, app_id="io.hexawallet.keeper", version="2.5.15", build="615", bundle=FEATURES):
        path = Path(self.directory.name) / "Keeper.ipa"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("Payload/Keeper.app/Info.plist", plistlib.dumps({
                "CFBundleIdentifier": app_id, "CFBundleShortVersionString": version,
                "CFBundleVersion": build, "CFBundleExecutable": "Keeper",
            }, fmt=plistlib.FMT_BINARY))
            archive.writestr("Payload/Keeper.app/main.jsbundle", bundle)
            archive.writestr("Payload/Keeper.app/Keeper", artifact.LIVE_CHANNEL.encode())
        return path

    def test_candidate_metadata_and_hashes(self):
        path = self.ipa()
        result = artifact.inspect(path, MANIFEST)
        self.assertEqual(result["sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertEqual(result["bundleSha256"], hashlib.sha256(FEATURES).hexdigest())
        self.assertEqual(result["signing"], "separate verification required")

    def test_stale_binary_rejected_even_if_source_manifest_is_correct(self):
        for kwargs, message in [({"version": "2.5.14"}, "Marketing version"),
                                ({"build": "614"}, "Build counter"),
                                ({"app_id": "io.hexawallet.hexakeeper.dev"}, "Application identifier")]:
            with self.subTest(kwargs=kwargs), self.assertRaisesRegex(ValueError, message):
                artifact.inspect(self.ipa(**kwargs), MANIFEST)

    def test_missing_feature_rejected_despite_correct_versions(self):
        with self.assertRaisesRegex(ValueError, "DustReport"):
            artifact.inspect(self.ipa(bundle=b"HelpAiEntry\0doNotSpend"), MANIFEST)

    def test_utf16_feature_table(self):
        artifact.verify_features(FEATURES.decode().encode("utf-16-le"))

    def test_missing_bundle_is_not_a_pass(self):
        path = self.ipa()
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("Payload/Keeper.app/Info.plist", plistlib.dumps({}))
        with self.assertRaises(KeyError):
            artifact.inspect(path, MANIFEST)

    def test_apk_must_match_independent_signing_identity(self):
        path = Path(self.directory.name) / "Keeper.apk"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("assets/index.android.bundle", FEATURES)
            archive.writestr("classes.dex", artifact.LIVE_CHANNEL.encode())
        metadata = "package: name='io.hexawallet.bitcoinkeeper' versionCode='622' versionName='2.5.15'"
        for actual, should_pass in [("a" * 64, True), ("b" * 64, False)]:
            with self.subTest(actual=actual), patch.dict(os.environ, {"KEEPER_ANDROID_CERT_SHA256": "a" * 64}), \
                    patch.object(artifact, "output", side_effect=[metadata, "Signer #1 certificate SHA-256 digest: " + actual]):
                if should_pass:
                    self.assertEqual(artifact.inspect(path, MANIFEST)["signing"], "APK certificate verified")
                else:
                    with self.assertRaisesRegex(ValueError, "signing certificate"):
                        artifact.inspect(path, MANIFEST)

    def test_aab_reads_base_manifest_and_bundle(self):
        path = Path(self.directory.name) / "Keeper.aab"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("base/assets/index.android.bundle", FEATURES)
            archive.writestr("base/classes.dex", artifact.LIVE_CHANNEL.encode())
        xml = '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="io.hexawallet.bitcoinkeeper" android:versionCode="622" android:versionName="2.5.15" />'
        with patch.dict(os.environ, {"BUNDLETOOL_JAR": str(path)}), patch.object(artifact, "output", return_value=xml):
            self.assertEqual(artifact.inspect(path, MANIFEST)["build"], "622")


if __name__ == "__main__":
    unittest.main()
