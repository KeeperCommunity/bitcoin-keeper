"""Offline source preparation controls; these do not run native acceptance."""
import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).with_name('prepare_private_native_parent.py')
spec = importlib.util.spec_from_file_location('private_parent', MODULE)
parent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parent)


class PrivateParentPreparation(unittest.TestCase):
    def files(self):
        # Minimal synthetic text around the exact versioned policy bytes. The
        # separate real-f0 local regeneration validates the complete real files.
        files = {name: (parent.OLD_APP + '\n' + parent.OLD_TREE).encode() for name in parent.PIN_PATHS}
        files[parent.POLICY] = (MODULE.parents[1] / '.github/tests/fixtures/private-parent-f0-policy.json').read_bytes()
        files[parent.CONTRACT] += ('\n' + parent.OLD_POLICY).encode()
        files['tests/nativeIntegrationSource.test.cjs'] += b"""
  assert.ok(!text.includes('secrets.') && !text.includes('continue-on-error:') && !text.includes('workflow_dispatch:'));
  assert.equal(fs.existsSync(path.join(root, contract.MARKER)), false);
"""
        files.update({name: b"assert.equal(process.versions.node, '22.23.3');" for name in parent.NODE_PATHS})
        files[parent.WORKFLOW] = ("KEEPER_SOURCE_SHA: " + parent.OLD_APP + "\n"
            "      - name: Fetch fixed public app anonymously\n        run: old-fetch\n"
            "      - name: Set up reviewed Node runtime\n        node-version: '22.23.3'\n").encode()
        return files

    def test_repins_exact_source_policy_runtime_and_scoped_checkout(self):
        files = self.files()
        result = parent.render(files, 'a' * 40, 'b' * 40)
        self.assertIn(parent.private_checkout('a' * 40).encode(), result[parent.WORKFLOW])
        self.assertEqual(result[parent.WORKFLOW].count(b'secrets.'), 1)
        self.assertNotIn(b'old-fetch', result[parent.WORKFLOW])
        self.assertNotIn(parent.OLD_APP.encode(), b''.join(result.values()))
        self.assertNotIn(parent.OLD_TREE.encode(), b''.join(result.values()))
        self.assertIn(hashlib.sha256(result[parent.POLICY]).hexdigest().encode(), result[parent.CONTRACT])
        self.assertNotEqual(files[parent.POLICY], result[parent.POLICY])
        for name in parent.NODE_PATHS:
            self.assertIn(b"'22.23.4'", result[name])

    def test_wrong_baseline_policy_or_source_shape_is_rejected(self):
        for mutate in (
            lambda f: f.__setitem__(parent.POLICY, f[parent.POLICY] + b' '),
            lambda f: f.__setitem__(parent.CONTRACT, f[parent.CONTRACT] + parent.OLD_POLICY.encode()),
            lambda f: f.__setitem__(parent.PIN_PATHS[0], b'no exact source'),
            lambda f: f.__setitem__(parent.NODE_PATHS[0], b"'22.23.3' '22.23.3'"),
        ):
            files = self.files()
            mutate(files)
            with self.assertRaises(ValueError):
                parent.render(files, 'a' * 40, 'b' * 40)

    def test_only_immutable_hex_source_inputs_are_accepted(self):
        for value in ('HEAD', 'sprint', 'A' * 40, 'a' * 39, ['a' * 40], None, 'a' * 40 + '\n'):
            with self.assertRaises(ValueError):
                parent.private_checkout(value)
            with self.assertRaises(ValueError):
                parent.render(self.files(), value, 'b' * 40)

    def test_paths_reject_existing_output_and_symlink_components(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            alias = root / 'alias'
            alias.symlink_to(root, target_is_directory=True)
            for value, exists in ((root, False), (alias, True), (alias / 'new', False)):
                with self.assertRaises(ValueError):
                    parent.exact_path(value, exists=exists)

    def test_children_inherit_no_credentials_or_git_environment_overrides(self):
        with patch.dict(os.environ, {'GITHUB_TOKEN': 'DISPOSABLE', 'UNRELATED_SECRET': 'DISPOSABLE',
                                     'GIT_SSH_COMMAND': 'untrusted', 'GIT_CONFIG_COUNT': '10'}, clear=False):
            environment = parent.safe_environment()
        for name in ('GITHUB_TOKEN', 'UNRELATED_SECRET', 'GIT_SSH_COMMAND', 'GIT_CONFIG_COUNT', 'HOME'):
            self.assertNotIn(name, environment)
        self.assertEqual(environment['GIT_ALLOW_PROTOCOL'], '')
        self.assertEqual(environment['GIT_CONFIG_GLOBAL'], '/dev/null')

    def test_output_cannot_modify_either_input_checkout(self):
        with tempfile.TemporaryDirectory() as directory:
            app, relay = Path(directory) / 'app', Path(directory) / 'relay'
            app.mkdir()
            relay.mkdir()
            for source in (app, relay):
                with self.assertRaisesRegex(ValueError, 'ISOLATED_OUTPUT_REQUIRED'):
                    parent.prepare(app, relay, 'a' * 40, source / 'output')
                self.assertFalse((source / 'output').exists())

    def test_local_object_restore_has_no_remote_and_source_commits_are_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, target = root / 'source', root / 'target'
            source.mkdir()
            parent.git(source, '-c', 'init.templateDir=', 'init', '--quiet')
            (source / 'source.txt').write_text('actual local Git object\n')
            source_sha = parent.commit(source, 'Synthetic original source', 1700000000)
            parent.local_checkout(source, target, source_sha)
            self.assertEqual((target / 'source.txt').read_text(), 'actual local Git object\n')
            self.assertEqual(parent.git(target, 'remote'), b'')
            (target / 'source.txt').write_text('separate generated source\n')
            generated = parent.commit(target, 'Synthetic generated source', 1700000001)
            self.assertNotEqual(generated, source_sha)
            self.assertEqual(parent.git(source, 'rev-parse', 'HEAD').strip().decode(), source_sha)
            self.assertEqual((source / 'source.txt').read_text(), 'actual local Git object\n')


if __name__ == '__main__':
    unittest.main()
