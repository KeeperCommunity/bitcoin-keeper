import importlib.util
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("verify-android-inputs.py")
SPEC = importlib.util.spec_from_file_location("verify_android_inputs", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class AndroidInputTests(unittest.TestCase):
    def test_unapproved_environment_name_is_rejected_without_value(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            env = root / ".env.production"
            env.write_text("ENVIRONMENT=production\nUNREVIEWED_TOKEN=private-example-value\n")
            with self.assertRaises(MODULE.InputError) as caught:
                MODULE.check_env_names(env, ["ENVIRONMENT"])
            self.assertIn("UNREVIEWED_TOKEN", str(caught.exception))
            self.assertNotIn("private-example-value", str(caught.exception))

    def test_missing_or_duplicate_approved_name_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            env = root / ".env.production"
            env.write_text("ENVIRONMENT=production\n")
            with self.assertRaisesRegex(MODULE.InputError, "missing environment names: RELAY"):
                MODULE.check_env_names(env, ["ENVIRONMENT", "RELAY"])
            with self.assertRaisesRegex(MODULE.InputError, "duplicate pinned environment name"):
                MODULE.check_env_names(env, ["ENVIRONMENT", "ENVIRONMENT"])

    def test_external_or_root_dependency_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            outside = root / "outside"
            outside.mkdir()
            dependencies = root / "checkout/node_modules"
            dependencies.parent.mkdir()
            dependencies.symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(MODULE.InputError, "real directory"):
                MODULE.check_local_dependencies(dependencies.parent)
            dependencies.unlink()
            dependencies.mkdir()
            (dependencies / "escaped").symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(MODULE.InputError, "outside this checkout"):
                MODULE.check_local_dependencies(dependencies.parent)

    def test_internal_dependency_symlink_is_allowed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dependencies = root / "node_modules"
            package = dependencies / "some-package"
            package.mkdir(parents=True)
            bin_directory = dependencies / ".bin"
            bin_directory.mkdir()
            (bin_directory / "some-package").symlink_to(package, target_is_directory=True)
            MODULE.check_local_dependencies(root)

    def test_sdk_revision_accepts_android_property_spacing(self):
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary)
            (package / "source.properties").write_text("Pkg.Revision = 3.22.1\n")
            self.assertEqual(MODULE.sdk_revision(package), "3.22.1")


if __name__ == "__main__":
    unittest.main()
