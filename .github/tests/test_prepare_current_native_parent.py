"""Host-only finite profile rendering controls, no native acceptance."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


current = load('keeper_current_parent', ROOT / '.github/native/prepare_current_native_parent.py')
baseline = load('keeper_parent_baseline_tests', ROOT / 'scripts/test_prepare_private_native_parent.py')


class CurrentParentProfile(unittest.TestCase):
    def files(self):
        files = baseline.PrivateParentPreparation().files()
        files[current.parent.WORKFLOW] += b"""      runs-on: 'macos-15-intel'
      - name: Build one unsigned development native candidate
      - name: Check hosted iOS driver before the app build
        if: env.KEEPER_NATIVE_PLATFORM == 'IOS'
        working-directory: app
        run: python3 .github/native/hosted_native.py driver
"""
        files['tests/nativeIntegrationSource.test.cjs'] += b"""
  ['IOS', 'macos-15-intel']
  source.replace('macos-15-intel', 'macos-15')
"""
        return files

    def test_reuses_original_preparer_and_only_normalizes_finite_profile(self):
        files = self.files()
        original = current.original_render(files, 'a' * 40, 'b' * 40)
        result = current.render(files, 'a' * 40, 'b' * 40)
        self.assertEqual(set(result), set(original))
        for name in result:
            if name not in (current.parent.WORKFLOW, 'tests/nativeIntegrationSource.test.cjs'):
                self.assertEqual(result[name], original[name])
        workflow = result[current.parent.WORKFLOW]
        self.assertIn(b"'macos-15'", workflow)
        self.assertIn(b'Build one current-source development native candidate', workflow)
        self.assertNotIn(b'Check hosted iOS driver', workflow)
        self.assertEqual(workflow.count(b'secrets.'), 1)
        self.assertIs(current.parent.render, current.render)

    def test_changed_or_duplicate_profile_shape_stops(self):
        for old, new in ((b"'macos-15-intel'", b"'macos-14'"),
                         (b'Build one unsigned development native candidate', b'Other build'),
                         (b'Check hosted iOS driver before the app build', b'Changed driver')):
            files = self.files()
            files[current.parent.WORKFLOW] = files[current.parent.WORKFLOW].replace(old, new)
            with self.assertRaises(ValueError):
                current.render(files, 'a' * 40, 'b' * 40)
        files = self.files()
        files[current.parent.WORKFLOW] += b"'macos-15-intel'"
        with self.assertRaises(ValueError):
            current.render(files, 'a' * 40, 'b' * 40)

    def test_original_immutable_policy_admission_still_runs_first(self):
        files = self.files()
        files[current.parent.POLICY] += b' '
        with self.assertRaisesRegex(ValueError, 'BASELINE_POLICY_CHANGED'):
            current.render(files, 'a' * 40, 'b' * 40)


if __name__ == '__main__':
    unittest.main()
