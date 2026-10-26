"""Scheduling policy only; host checks supply no native runtime evidence."""
from pathlib import Path
import unittest
import yaml


class PrivateIOSScheduling(unittest.TestCase):
    def test_only_selected_jobs_hold_shared_slot(self):
        workflows = Path(__file__).resolve().parents[1] / 'workflows'
        cases = (
            ('keeper-private-ios-fresh-runtime.yml', 'fresh', 'keeper/ios-fresh-runtime'),
            ('keeper-private-ios-retained-runtime.yml', 'runtime', 'keeper/ios-retained-runtime'),
            ('keeper-private-ios-signature-comparison.yml', 'compare', 'keeper/ios-signature-comparison'),
            ('keeper-private-ios-launch-debug.yml', 'investigate', 'keeper/ios-launch-debug'),
        )
        for filename, job, label in cases:
            with self.subTest(filename=filename):
                workflow = yaml.load((workflows / filename).read_text(), Loader=yaml.BaseLoader)
                self.assertNotIn('concurrency', workflow)
                selected = workflow['jobs'][job]
                self.assertEqual(selected['concurrency'], {
                    'group': 'private-ios-launch-debug-${{ github.event.pull_request.number }}',
                    'cancel-in-progress': 'false',
                })
                self.assertIn("github.event.label.name == '" + label + "'", selected['if'])
                self.assertIn("github.event.repository.private == true", selected['if'])
                self.assertEqual(workflow['on']['pull_request']['types'], ['labeled'])


if __name__ == '__main__':
    unittest.main()
