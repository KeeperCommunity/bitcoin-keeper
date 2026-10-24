#!/usr/bin/env python3
"""Protected release adapter. Called only by the installed Node authorization driver.

Never invoke for validation. Contracts inject fake actions; real operations need
the workflow's protected review, exact owner receipt and fresh API authorization.
"""
import base64
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import plistlib
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import zipfile

APP_ID = {"ios": "io.hexawallet.keeper", "android": "io.hexawallet.bitcoinkeeper"}
CLIENT_KEYS = set("CHANNEL_URL ENVIRONMENT RELAY SIGNING_SERVER_TESTNET SIGNING_SERVER_MAINNET HEXA_ID_TESTNET HEXA_ID_MAINNET ADDRESS BIP85_IMAGE_ENCRYPTIONKEY_DERIVATION_PATH ENC_KEY_STORAGE_IDENTIFIER GAP_LIMIT LETS_EXCHANGE_BASE_URL RENEWAL_WINDOW SENTRY_DNS WALLET_INSTANCE_SERIES".split())
CURRENT_STAGE = "input-validation"
CLEANUP_FAILED = False


def demand(condition):
    if not condition:
        raise ValueError("protected release boundary failed")


def digest(path):
    with pathlib.Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(arguments, *, env=None, cwd=None, data=None):
    # Never log commands, raw native/provider output or exceptions: they can
    # contain signing passwords, request bodies or embedded client configuration.
    result = subprocess.run([str(arg) for arg in arguments], input=data, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, env=env, cwd=cwd, check=False)
    demand(result.returncode == 0)
    return result.stdout


def decode_secret(name, target):
    raw = os.environ.get(name, "")
    demand(bool(raw))
    data = base64.b64decode(raw, validate=True)
    demand(0 < len(data) <= 16 * 1024 * 1024)
    with pathlib.Path(target).open("xb") as stream:
        os.chmod(target, 0o600)
        stream.write(data)


def validate_client_config(data, expected):
    demand(hashlib.sha256(data).hexdigest() == expected)
    names = []
    for line in data.decode("utf8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=([^\r\n]*)", line)
        demand(match is not None and match[1] in CLIENT_KEYS and match[1] not in names)
        names.append(match[1])
    demand(set("CHANNEL_URL ENVIRONMENT RELAY SIGNING_SERVER_TESTNET SIGNING_SERVER_MAINNET HEXA_ID_TESTNET HEXA_ID_MAINNET".split()) <= set(names))


def package_overlay(root, record=None):
    before = run(["git", "show", "HEAD:package.json"], cwd=root)
    after = (root / "package.json").read_bytes()
    allowed = ["browser", "react-native", "browserify"]
    old, new = json.loads(before), json.loads(after)
    for field in allowed:
        old.pop(field, None); new.pop(field, None)
    demand(old == new)
    demand(set(run(["git", "diff", "HEAD", "--name-only"], cwd=root).decode().splitlines()) <= {"package.json"})
    actual = {"sourceSha": run(["git", "rev-parse", "HEAD"], cwd=root).decode().strip(),
              "allowed_fields": allowed, "before_sha256": hashlib.sha256(before).hexdigest(), "after_sha256": hashlib.sha256(after).hexdigest()}
    if record is not None:
        demand(actual == record)
    return actual


def ruby_lock_compatibility(root):
    gems = (root / "Gemfile.lock").read_text()
    pods = (root / "ios/Podfile.lock").read_text()
    gem_version = re.search(r"^    cocoapods \(([^)]+)\)$", gems, re.M)
    pod_version = re.search(r"^COCOAPODS: (\S+)$", pods, re.M)
    project = re.search(r"^    xcodeproj \(([^)]+)\)$", gems, re.M)
    demand(gem_version is not None and pod_version is not None and project is not None)
    demand(gem_version[1] == pod_version[1] == "1.16.2")
    demand(tuple(map(int, project[1].split('.'))) >= (1, 27, 0))
    demand(re.search(r"gem\s+['\"]xcodeproj['\"],\s*['\"]<\s*1\.26", (root / "Gemfile").read_text()) is None)
    # The reviewed Pod lock also updates Nitro. Accept the frozen tuple only
    # when the manifest, Yarn resolution and native Pod agree; never repair it.
    nitro = json.loads((root / "package.json").read_text())["dependencies"]["react-native-nitro-modules"]
    demand(isinstance(nitro, str) and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", nitro) is not None)
    yarn = (root / "yarn.lock").read_text()
    # Reject quoted/combined/duplicate Nitro selectors as ambiguous rather than
    # ignoring them while accepting an earlier matching unquoted stanza.
    headers = [line for line in yarn.splitlines() if line and not line[0].isspace()
               and not line.startswith('#') and 'react-native-nitro-modules@' in line]
    demand(headers == [f'react-native-nitro-modules@{nitro}:'])
    resolutions = re.findall(r"^react-native-nitro-modules@([^\n]+):\n((?:[ \t][^\n]*\n|\n)*)", yarn, re.M)
    demand(len(resolutions) == 1 and resolutions[0][0] == nitro)
    demand(re.findall(r'^  version "([^"]+)"$', resolutions[0][1], re.M) == [nitro])
    demand(re.findall(r"^  - NitroModules \(([^)]+)\):$", pods, re.M) == [nitro])


def safe_unzip(archive, destination, *, exact_names=None):
    destination = pathlib.Path(destination)
    with zipfile.ZipFile(archive) as source:
        members = source.infolist()
        demand(len(members) <= 100000 and sum(item.file_size for item in members) <= 4 * 1024 ** 3)
        names = [item.filename for item in members]
        demand(len(names) == len(set(names)))
        if exact_names is not None:
            demand(set(names) == set(exact_names))
        for item in members:
            relative = pathlib.PurePosixPath(item.filename)
            demand(not relative.is_absolute() and ".." not in relative.parts and "\\" not in item.filename)
            demand((item.external_attr >> 16) & 0o170000 != 0o120000)
            target = destination.joinpath(*relative.parts)
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.open(item) as src, target.open("xb") as dst:
                    shutil.copyfileobj(src, dst)
                mode = (item.external_attr >> 16) & 0o777
                if mode:
                    os.chmod(target, mode)


def unpack(context, private):
    payload = "release.ipa" if context["operation"] == "testflight-upload" else "release.aab"
    safe_unzip(private / "artifact.zip", private / "input", exact_names=[payload, "receipt.json"])
    demand(digest(private / "input" / payload) == context["artifactSha256"])
    receipt_path = private / "input/receipt.json"
    demand(receipt_path.stat().st_size <= 16384)
    return json.loads(receipt_path.read_text())


def cert_der_from_pem(pem):
    return run(["openssl", "x509", "-outform", "DER"], data=pem)


def validate_profile(profile, expected_cert, team, uuid):
    expiry = profile.get("ExpirationDate")
    demand(isinstance(expiry, datetime.datetime))
    expiry = expiry.replace(tzinfo=datetime.timezone.utc) if expiry.tzinfo is None else expiry
    demand(expiry > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=2))
    entitlements = profile.get("Entitlements", {})
    demand(profile.get("UUID") == uuid and team in profile.get("TeamIdentifier", []))
    demand(entitlements.get("application-identifier") == team + "." + APP_ID["ios"])
    demand(entitlements.get("get-task-allow") is False and not profile.get("ProvisionedDevices") and not profile.get("ProvisionsAllDevices"))
    demand(any(hashlib.sha256(cert).hexdigest() == expected_cert for cert in profile.get("DeveloperCertificates", [])))


def verify_ios(artifact, context, private):
    app_dir = private / "ipa-check"
    app_dir.mkdir()
    safe_unzip(artifact, app_dir)
    apps = list((app_dir / "Payload").glob("*.app"))
    demand(len(apps) == 1)
    app = apps[0]
    run(["codesign", "--verify", "--deep", "--strict", app])
    certificate_prefix = private / "signed-cert"
    run(["codesign", "-d", "--extract-certificates", certificate_prefix, app])
    certificate = pathlib.Path(str(certificate_prefix) + "0").read_bytes()
    demand(hashlib.sha256(certificate).hexdigest() == context["identitySha256"])
    run(["openssl", "x509", "-inform", "DER", "-checkend", "7200", "-noout"], data=certificate)
    profile = plistlib.loads(run(["security", "cms", "-D", "-i", app / "embedded.mobileprovision"]))
    team, uuid = os.environ.get("KEEPER_IOS_TEAM_ID", ""), os.environ.get("KEEPER_IOS_PROFILE_UUID", "")
    demand(re.fullmatch(r"[A-Z0-9]{10}", team) is not None)
    validate_profile(profile, context["identitySha256"], team, uuid)
    entitlements = plistlib.loads(run(["codesign", "-d", "--entitlements", ":-", app]))
    demand(entitlements.get("application-identifier") == team + "." + APP_ID["ios"])
    demand(entitlements.get("com.apple.developer.team-identifier") == team and entitlements.get("get-task-allow") is False)


def verify_android(artifact, context, private):
    pem = run(["keytool", "-printcert", "-jarfile", artifact, "-rfc"])
    cert = cert_der_from_pem(pem)
    demand(hashlib.sha256(cert).hexdigest() == context["identitySha256"])
    run(["openssl", "x509", "-inform", "DER", "-checkend", "7200", "-noout"], data=cert)
    cert_file = private / "public-certificate.der"
    cert_file.write_bytes(cert)
    trust = private / "public-trust.jks"
    env = {**os.environ, "KEEPER_PUBLIC_TRUST_PASSWORD": secrets.token_hex(24)}
    run(["keytool", "-importcert", "-noprompt", "-alias", "approved-upload-certificate", "-file", cert_file,
         "-keystore", trust, "-storepass:env", "KEEPER_PUBLIC_TRUST_PASSWORD"], env=env)
    # Trust only the independently pinned certificate; strict verification also
    # rejects unsigned payload entries without rejecting its self-signed chain.
    run(["jarsigner", "-verify", "-strict", "-keystore", trust, "-storepass:env", "KEEPER_PUBLIC_TRUST_PASSWORD", artifact], env=env)


def verify_artifact(artifact, context, root, private):
    spec = importlib.util.spec_from_file_location("artifact_guard", pathlib.Path(__file__).with_name("verify-release-artifact.py"))
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    manifest = json.loads((root / "release/version.json").read_text())
    result = verifier.inspect(artifact, manifest)
    demand(result["sha256"] == digest(artifact) and result["version"] == context["version"] and result["build"] == context["build"])
    if artifact.suffix == ".ipa":
        verify_ios(artifact, context, private)
    else:
        verify_android(artifact, context, private)


def build_android(root, private, context):
    key = private / "upload.keystore"
    decode_secret("KEEPER_ANDROID_KEYSTORE_BASE64", key)
    demand(all(os.environ.get(name) for name in ("STORE_PASSWORD", "KEY_PASSWORD", "KEY_ALIAS")))
    cert = run(["keytool", "-exportcert", "-keystore", key, "-storepass:env", "STORE_PASSWORD", "-alias", os.environ["KEY_ALIAS"]])
    demand(hashlib.sha256(cert).hexdigest() == context["identitySha256"])
    run(["openssl", "x509", "-inform", "DER", "-checkend", "7200", "-noout"], data=cert)
    env = {**os.environ, "KEEPER_ANDROID_KEYSTORE": str(key), "ENVFILE": str(root / ".env.production")}
    run([root / "android/gradlew", "-p", root / "android", ":app:bundleProductionRelease", "--no-daemon", "--console=plain"], cwd=root, env=env)
    artifact = root / "android/app/build/outputs/bundle/productionRelease/app-production-release.aab"
    demand(artifact.is_file())
    return artifact


def build_ios(root, private, context):
    global CLEANUP_FAILED, CURRENT_STAGE
    team, uuid = os.environ.get("KEEPER_IOS_TEAM_ID", ""), os.environ.get("KEEPER_IOS_PROFILE_UUID", "")
    demand(re.fullmatch(r"[A-Z0-9]{10}", team) is not None and re.fullmatch(r"[A-Fa-f0-9-]{36}", uuid) is not None)
    cert_file, profile_file = private / "signing.p12", private / "profile.mobileprovision"
    decode_secret("KEEPER_IOS_P12_BASE64", cert_file)
    decode_secret("KEEPER_IOS_PROFILE_BASE64", profile_file)
    demand(bool(os.environ.get("KEEPER_IOS_P12_PASSWORD")))
    cert = cert_der_from_pem(run(["openssl", "pkcs12", "-in", cert_file, "-clcerts", "-nokeys", "-passin", "env:KEEPER_IOS_P12_PASSWORD"]))
    demand(hashlib.sha256(cert).hexdigest() == context["identitySha256"])
    run(["openssl", "x509", "-inform", "DER", "-checkend", "7200", "-noout"], data=cert)
    profile = plistlib.loads(run(["security", "cms", "-D", "-i", profile_file]))
    validate_profile(profile, context["identitySha256"], team, uuid)
    identity = hashlib.sha1(cert).hexdigest()  # Xcode identity selector; SHA256 pin was checked above.
    keychain = private / "release.keychain-db"
    password = secrets.token_hex(32)
    profile_target = pathlib.Path.home() / "Library/MobileDevice/Provisioning Profiles" / (uuid + ".mobileprovision")
    profile_target.parent.mkdir(parents=True, exist_ok=True)
    previous_profile = profile_target.read_bytes() if profile_target.exists() else None
    previous_mode = profile_target.stat().st_mode & 0o777 if profile_target.exists() else None
    previous_keychains = shlex.split(run(["security", "list-keychains", "-d", "user"]).decode())
    primary_failed = False
    created_keychain = False
    changed_search = False
    try:
        run(["security", "create-keychain", "-p", password, keychain])
        created_keychain = True
        run(["security", "unlock-keychain", "-p", password, keychain])
        run(["security", "set-keychain-settings", "-lut", "7200", keychain])
        changed_search = True
        run(["security", "list-keychains", "-d", "user", "-s", keychain, *previous_keychains])
        run(["security", "import", cert_file, "-k", keychain, "-P", os.environ["KEEPER_IOS_P12_PASSWORD"], "-T", "/usr/bin/codesign"])
        run(["security", "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", password, keychain])
        profile_target.write_bytes(profile_file.read_bytes())
        os.chmod(profile_target, 0o600)
        archive, exported = private / "Keeper.xcarchive", private / "export"
        settings = ["CODE_SIGN_STYLE=Manual", "DEVELOPMENT_TEAM=" + team, "CODE_SIGN_IDENTITY=" + identity,
                    "PROVISIONING_PROFILE_SPECIFIER=" + uuid, "OTHER_CODE_SIGN_FLAGS=--keychain " + str(keychain)]
        run(["xcodebuild", "-workspace", root / "ios/hexa_keeper.xcworkspace", "-scheme", "hexa_keeper", "-configuration", "Release",
             "-destination", "generic/platform=iOS", "-archivePath", archive, "archive", *settings], cwd=root,
            env={**os.environ, "ENVFILE": str(root / ".env.production")})
        options = private / "ExportOptions.plist"
        options.write_bytes(plistlib.dumps({"method": "app-store", "signingStyle": "manual", "teamID": team,
                                           "signingCertificate": identity, "provisioningProfiles": {APP_ID["ios"]: uuid},
                                           "manageAppVersionAndBuildNumber": False}))
        run(["xcodebuild", "-exportArchive", "-archivePath", archive, "-exportPath", exported,
             "-exportOptionsPlist", options, "OTHER_CODE_SIGN_FLAGS=--keychain " + str(keychain)], cwd=root)
        artifacts = list(exported.glob("*.ipa"))
        demand(len(artifacts) == 1)
        return artifacts[0]
    except BaseException:
        primary_failed = True
        raise
    finally:
        cleanup_failed = False
        for command in ([['security', 'list-keychains', '-d', 'user', '-s', *previous_keychains]] if changed_search else []) + ([['security', 'delete-keychain', str(keychain)]] if created_keychain else []):
            try:
                result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, timeout=30)
                cleanup_failed |= result.returncode != 0
            except (OSError, subprocess.TimeoutExpired):
                cleanup_failed = True
        try:
            if previous_profile is None:
                profile_target.unlink(missing_ok=True)
            else:
                profile_target.write_bytes(previous_profile)
                os.chmod(profile_target, previous_mode)
        except OSError:
            cleanup_failed = True
        CLEANUP_FAILED |= cleanup_failed
        if cleanup_failed and not primary_failed:
            CURRENT_STAGE = "signing-cleanup"
            demand(False)


def upload(artifact, root, private, context):
    # Use a standalone reviewed Fastfile; legacy Appfiles/live/dev lanes are not
    # loaded. No auto-provisioning, Slack, metadata publication or rollout.
    work = private / "uploader"
    (work / "fastlane").mkdir(parents=True)
    shutil.copyfile(pathlib.Path(__file__).parents[1] / "release/cloud/Fastfile", work / "fastlane/Fastfile")
    env = {**os.environ, "BUNDLE_GEMFILE": str(pathlib.Path(__file__).parents[1] / "Gemfile"), "KEEPER_VERIFIED_ARTIFACT": str(artifact),
           "KEEPER_RELEASE_OPERATION": context["operation"], "FASTLANE_SKIP_UPDATE_CHECK": "1", "FASTLANE_OPT_OUT_USAGE": "1"}
    platform = "ios" if context["operation"] == "testflight-upload" else "android"
    run(["bundle", "exec", "fastlane", platform, "approved_upload"], cwd=work, env=env)


def execute(context, root, private):
    global CURRENT_STAGE
    CURRENT_STAGE = "identity-validation"
    demand(os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted")
    demand(os.environ.get("KEEPER_EXPECTED_CERT_SHA256") == context["identitySha256"])
    demand(os.environ.get("KEEPER_EXPECTED_CONFIG_SHA256") == context["configSha256"])
    deadline = datetime.datetime.fromisoformat(context["approvalExpiresAt"].replace("Z", "+00:00"))
    demand(deadline > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=2))
    signing = context["operation"].endswith("-signed-build")
    env_file = root / ".env.production"
    created_env = False
    try:
        if signing:
            CURRENT_STAGE = "source-preflight"
            demand(context["sourceSha"] == context["driverSha"] and not env_file.exists())
            package_overlay(root, json.loads(pathlib.Path(os.environ["KEEPER_PACKAGE_OVERLAY_PATH"]).read_text()))
            if context["operation"] == "ios-signed-build":
                ruby_lock_compatibility(root)
            run(["node", pathlib.Path(__file__).with_name("release-version.cjs"), "release-check"], cwd=root,
                env={**os.environ, "KEEPER_RELEASE_COMMIT": context["sourceSha"]})
            inventory_spec = importlib.util.spec_from_file_location("source_inventory", pathlib.Path(__file__).with_name("cloud_release_inventory.py"))
            inventory = importlib.util.module_from_spec(inventory_spec)
            inventory_spec.loader.exec_module(inventory)
            demand(inventory.release_credential_literals((root / "android/app/build.gradle").read_text()) == [])
            config = base64.b64decode(os.environ.get("KEEPER_PRODUCTION_CONFIG_BASE64", ""), validate=True)
            CURRENT_STAGE = "config-validation"
            validate_client_config(config, context["configSha256"])
            with env_file.open("xb") as stream:
                created_env = True
                os.chmod(env_file, 0o600)
                stream.write(config)
            run(["node", pathlib.Path(__file__).with_name("verify-channel-config.cjs"), env_file], cwd=root)
            CURRENT_STAGE = "native-build"
            artifact = (build_ios if context["operation"] == "ios-signed-build" else build_android)(root, private, context)
        else:
            artifact = private / "input" / ("release.ipa" if context["operation"] == "testflight-upload" else "release.aab")
            demand(digest(artifact) == context["artifactSha256"])
        CURRENT_STAGE = "artifact-verification"
        verify_artifact(artifact, context, root, private)
        verified_digest = digest(artifact)
        if signing:
            package_overlay(root, json.loads(pathlib.Path(os.environ["KEEPER_PACKAGE_OVERLAY_PATH"]).read_text()))
        else:
            run(["git", "diff", "HEAD", "--exit-code"], cwd=root)
        if not signing:
            CURRENT_STAGE = "upload-command"
            upload(artifact, root, private, context)
        CURRENT_STAGE = "receipt"
        output = pathlib.Path(os.environ["RUNNER_TEMP"]) / "keeper-release-output"
        output.mkdir(mode=0o700)  # Refuse an existing output; never reuse an older artifact.
        receipt = {key: context[key] for key in ["sourceSha", "driverSha", "operation", "version", "build", "identitySha256", "configSha256", "runId", "runAttempt", "approvalCommentId", "approvalExpiresAt", "artifactId"]}
        if not signing:
            receipt.update(sourceRunId=context["sourceRunId"], sourceRunAttempt=context["sourceRunAttempt"])
        receipt.update(schema=1, artifactSha256=verified_digest, signatureVerified=True, storeUploaded=not signing,
                       storeProcessingVerified=False, publicPublication=False)
        if signing:
            copied = output / ("release.ipa" if artifact.suffix == ".ipa" else "release.aab")
            shutil.copyfile(artifact, copied)
            demand(digest(copied) == verified_digest)
        (output / "receipt.json").write_text(json.dumps(receipt, indent=2))
    finally:
        if created_env:
            env_file.unlink(missing_ok=True)


def main():
    try:
        command, context_path, argument = sys.argv[1:]
        if command == "overlay":
            record = package_overlay(pathlib.Path(context_path))
            with pathlib.Path(argument).open("x") as stream:
                os.chmod(argument, 0o600)
                json.dump(record, stream)
            return 0
        if command == "ruby-lock-check":
            ruby_lock_compatibility(pathlib.Path(context_path))
            return 0
        context = json.loads(pathlib.Path(context_path).read_text())
        if command == "unpack":
            print(json.dumps(unpack(context, pathlib.Path(argument))))
        elif command == "execute":
            execute(context, pathlib.Path(argument), pathlib.Path(os.environ["KEEPER_PRIVATE_DIRECTORY"]))
        else:
            demand(False)
    except Exception:
        print(json.dumps({"state": "FAILED", "stage": CURRENT_STAGE, "cleanupFailed": CLEANUP_FAILED}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
