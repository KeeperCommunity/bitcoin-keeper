#!/usr/bin/env python3
"""Inspect packaged release metadata and required feature markers without dumping secrets.

APK: Android SDK aapt and apksigner are required.
AAB: BUNDLETOOL_JAR and Java are required.
IPA: Python standard library; signing is verified separately by codesign/export evidence.
This verifier supplements device tests; bytecode markers do not prove feature behavior.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET

ANDROID_NS = "{http://schemas.android.com/apk/res/android}"


def require_equal(actual, expected, label):
    if str(actual) != str(expected):
        raise ValueError(f"{label}: expected {expected}, got {actual}")


def verify_features(bundle):
    missing = []
    # Route names and data properties survive Metro/Hermes optimization;
    # implementation function names (e.g. DustReportScreen) do not.
    for feature in ("HelpAiEntry", "DustReport", "doNotSpend"):
        if feature.encode() not in bundle and feature.encode("utf-16-le") not in bundle:
            missing.append(feature)
    if missing:
        raise ValueError("Required packaged feature markers absent: " + ", ".join(missing))


def output(command):
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise ValueError(f"{Path(command[0]).name} failed; inspect tool/environment configuration")
    return result.stdout


def inspect(path, manifest):
    suffix = path.suffix.lower()
    with zipfile.ZipFile(path) as archive:
        if suffix == ".ipa":
            names = [n for n in archive.namelist() if re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", n)]
            if len(names) != 1:
                raise ValueError("Expected one main app Info.plist")
            info = plistlib.loads(archive.read(names[0]))
            app_id, version, build = (info.get(k) for k in ("CFBundleIdentifier", "CFBundleShortVersionString", "CFBundleVersion"))
            platform = "ios"
            bundle = archive.read(names[0].rsplit("/", 1)[0] + "/main.jsbundle")
        elif suffix == ".apk":
            text = output([os.environ.get("AAPT", "aapt"), "dump", "badging", str(path)])
            match = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", text)
            if not match:
                raise ValueError("Cannot read APK package/version metadata")
            app_id, build, version = match.groups()
            platform = "android"
            bundle = archive.read("assets/index.android.bundle")
        elif suffix == ".aab":
            jar = os.environ.get("BUNDLETOOL_JAR")
            if not jar or not Path(jar).is_file():
                raise ValueError("Set BUNDLETOOL_JAR to the installed bundletool jar")
            xml = output(["java", "-jar", jar, "dump", "manifest", "--bundle=" + str(path), "--module=base"])
            root = ET.fromstring(xml)
            app_id, build, version = root.get("package"), root.get(ANDROID_NS + "versionCode"), root.get(ANDROID_NS + "versionName")
            platform = "android"
            bundle = archive.read("base/assets/index.android.bundle")
        else:
            raise ValueError("Expected an IPA, APK or AAB")
    expected_id = {"ios": "io.hexawallet.keeper", "android": "io.hexawallet.bitcoinkeeper"}[platform]
    require_equal(app_id, expected_id, "Application identifier")
    require_equal(version, manifest["version"], "Marketing version")
    require_equal(build, manifest["iosBuildNumber" if platform == "ios" else "androidVersionCode"], "Build counter")
    verify_features(bundle)
    result = {"artifact": path.name, "applicationId": app_id, "version": version, "build": str(build),
              "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
              "bundleSha256": hashlib.sha256(bundle).hexdigest(), "featureMarkers": "present",
              "signing": "separate verification required"}
    if suffix == ".apk":
        certs = output([os.environ.get("APKSIGNER", "apksigner"), "verify", "--print-certs", str(path)])
        expected = os.environ.get("KEEPER_ANDROID_CERT_SHA256", "").lower().replace(":", "")
        if not re.fullmatch(r"[0-9a-f]{64}", expected):
            raise ValueError("Set KEEPER_ANDROID_CERT_SHA256 to the independently verified release certificate")
        actual = re.findall(r"certificate SHA-256 digest: ([0-9a-fA-F]+)", certs)
        if len(actual) != 1 or actual[0].lower() != expected:
            raise ValueError("APK signing certificate differs from verified release identity")
        result["signing"] = "APK certificate verified"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path)
    parser.add_argument("--manifest", type=Path, default=Path(__file__).resolve().parents[1] / "release/version.json")
    args = parser.parse_args()
    try:
        print(json.dumps(inspect(args.artifact, json.loads(args.manifest.read_text())), indent=2))
    except (ValueError, OSError, KeyError, zipfile.BadZipFile, ET.ParseError) as exc:
        print("Artifact verification failed: " + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
