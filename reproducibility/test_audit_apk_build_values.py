import contextlib
import hashlib
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).with_name("audit-apk-build-values.py")
SPEC = importlib.util.spec_from_file_location("audit_apk_build_values", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

VALUES = {
    "CHANNEL_URL": "https://channel.example.test/",
    "ENVIRONMENT": "PRODUCTION",
    "HEXA_ID_MAINNET": "a" * 64,
    "HEXA_ID_TESTNET": "b" * 64,
    "RELAY": "https://relay.example.test/",
    "SIGNING_SERVER_MAINNET": "https://sign.example.test/",
    "SIGNING_SERVER_TESTNET": "https://test-sign.example.test/",
}
PRIVATE_FIXTURE = "never-print-this-fixture-value"


def resource_dump(values=VALUES):
    rows = ["Package Group 0 id=0x7f package=io.example"]
    for index, (name, value) in enumerate(values.items()):
        rows.extend(
            [f"    resource 0x7f110{index:03x} string/{name}", f'      () "{value}"']
        )
    rows.extend(
        ["    resource 0x7f110100 string/OTHER_FIELD", f'      () "{PRIVATE_FIXTURE}"']
    )
    return "\n".join(rows)


class BuildValueAuditTests(unittest.TestCase):
    def test_seven_audited_names_match_tracked_allowlist(self):
        MODULE.check_tracked_allowlist()

    def test_apk_fields_and_candidate_match_without_other_resources(self):
        actual = MODULE.read_apk_fields(resource_dump())
        self.assertEqual(actual, VALUES)
        self.assertEqual(MODULE.compare_fields(actual, VALUES), [])
        self.assertNotIn("OTHER_FIELD", actual)

    def test_apk_resource_missing_duplicate_or_ambiguous_is_rejected(self):
        missing = {key: value for key, value in VALUES.items() if key != "RELAY"}
        with self.assertRaisesRegex(MODULE.AuditError, "exactly one.*RELAY"):
            MODULE.read_apk_fields(resource_dump(missing))
        duplicate = resource_dump() + '\n    resource 0x7f110200 string/RELAY\n      () "https://other.example.test/"'
        with self.assertRaisesRegex(MODULE.AuditError, "exactly one.*RELAY"):
            MODULE.read_apk_fields(duplicate)
        ambiguous = resource_dump().replace(
            '      () "https://relay.example.test/"',
            '      () "https://relay.example.test/"\n      () "https://other.example.test/"',
        )
        with self.assertRaisesRegex(MODULE.AuditError, "one plain default value for RELAY"):
            MODULE.read_apk_fields(ambiguous)

    def test_apk_values_must_have_expected_noncredential_shapes(self):
        for name, value in (
            ("ENVIRONMENT", "DEVELOPMENT"),
            ("HEXA_ID_MAINNET", "not-an-id"),
            ("CHANNEL_URL", "http://channel.example.test/"),
        ):
            with self.subTest(name=name):
                changed = dict(VALUES)
                changed[name] = value
                with self.assertRaises(MODULE.AuditError):
                    MODULE.read_apk_fields(resource_dump(changed))

    def test_candidate_env_accepts_simple_values_and_rejects_extras(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "candidate.env"
            path.write_text("# reviewed\n" + "\n".join(f"{k}={v}" for k, v in VALUES.items()))
            self.assertEqual(MODULE.read_candidate_env(path), VALUES)
            path.write_text(path.read_text() + "\nUNEXPECTED_CREDENTIAL=" + PRIVATE_FIXTURE)
            candidate = MODULE.read_candidate_env(path)
            with self.assertRaises(MODULE.AuditError) as caught:
                MODULE.compare_fields(VALUES, candidate)
            self.assertNotIn(PRIVATE_FIXTURE, str(caught.exception))
            self.assertNotIn("UNEXPECTED_CREDENTIAL", str(caught.exception))

    def test_candidate_mismatch_reports_name_only_even_via_cli(self):
        with tempfile.TemporaryDirectory() as directory:
            apk = Path(directory) / "official.apk"
            apk.write_bytes(b"synthetic APK identity")
            expected_hash = hashlib.sha256(apk.read_bytes()).hexdigest()
            env = Path(directory) / "candidate.env"
            changed = dict(VALUES)
            changed["RELAY"] = "https://different.example.test/"
            env.write_text("\n".join(f"{k}={v}" for k, v in changed.items()))
            stdout = io.StringIO()
            stderr = io.StringIO()
            args = [
                str(SCRIPT), "--apk", str(apk), "--expected-apk-sha256", expected_hash,
                "--aapt2", "fixture-aapt2", "--env-file", str(env),
            ]
            with mock.patch.object(sys, "argv", args), mock.patch.object(
                MODULE, "run_aapt2", return_value=resource_dump()
            ), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                self.assertEqual(MODULE.main(), 1)
            output = stdout.getvalue() + stderr.getvalue()
            self.assertIn("RELAY", output)
            self.assertNotIn(changed["RELAY"], output)
            self.assertNotIn(VALUES["RELAY"], output)
            self.assertNotIn(PRIVATE_FIXTURE, output)

    def test_apk_digest_mismatch_is_rejected_before_resource_parsing(self):
        with tempfile.TemporaryDirectory() as directory:
            apk = Path(directory) / "untrusted.apk"
            apk.write_bytes(b"fixture")
            with self.assertRaisesRegex(MODULE.AuditError, "SHA-256"):
                MODULE.verify_apk_hash(apk, "0" * 64)

    def test_aapt2_failure_never_echoes_its_output(self):
        failed = subprocess.CompletedProcess(
            ["aapt2"], 1, stdout=PRIVATE_FIXTURE, stderr=PRIVATE_FIXTURE
        )
        with mock.patch.object(MODULE.subprocess, "run", return_value=failed):
            with self.assertRaises(MODULE.AuditError) as caught:
                MODULE.run_aapt2("aapt2", Path("official.apk"))
        self.assertNotIn(PRIVATE_FIXTURE, str(caught.exception))


if __name__ == "__main__":
    unittest.main()
