"""Regression checks for setup operations that must preserve developer work."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import keeper


class PreserveDeveloperWork(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = Path(self.temp.name)
        self.here = self.app / 'dev/local-backend'
        self.here.mkdir(parents=True)
        self.contexts = [patch.object(keeper, 'HERE', self.here), patch.object(keeper, 'APP', self.app),
                         patch.dict('os.environ', {}, clear=True)]
        for context in self.contexts:
            context.start()
            self.addCleanup(context.stop)

    def test_environment_is_exclusive_and_preserves_production(self):
        (self.here / 'app.env.local.example').write_text('RELAY=http://localhost:3000/\n')
        production = self.app / '.env.production'
        production.write_text('existing-production-sentinel\n')
        keeper.app_env()
        self.assertEqual((self.app / '.env.local').stat().st_mode & 0o777, 0o600)
        keeper.app_env()  # Same configuration is repeatable.
        (self.app / '.env.local').write_text('developer-settings\n')
        with self.assertRaisesRegex(ValueError, 'already exists'):
            keeper.app_env()
        self.assertEqual((self.app / '.env.local').read_text(), 'developer-settings\n')
        self.assertEqual(production.read_text(), 'existing-production-sentinel\n')

    def test_adapter_tampering_is_rejected_before_fetch(self):
        adapter = self.here / 'adapters/relay'
        adapter.mkdir(parents=True)
        (adapter / 'local.patch').write_text('changed')
        (self.here / 'sources.lock.json').write_text(json.dumps({'relay': {
            'assets': {'local.patch': hashlib.sha256(b'original').hexdigest()}}}))
        with patch.object(keeper, 'run') as command:
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                keeper.prepare()
            command.assert_not_called()

    def test_unknown_existing_checkout_is_not_overwritten(self):
        source = self.here / '.sources/relay'
        source.mkdir(parents=True)
        edit = source / 'my-work.ts'
        edit.write_text('keep this')
        (self.here / 'sources.lock.json').write_text(json.dumps({'relay': {'assets': {}}}))
        with patch.object(keeper, 'run') as command:
            with self.assertRaisesRegex(ValueError, 'not overwritten'):
                keeper.prepare()
            command.assert_not_called()
        self.assertEqual(edit.read_text(), 'keep this')

    def test_port_collision_is_rejected(self):
        (self.here / '.env').write_text('KEEPER_RELAY_PORT=3003\n')
        with self.assertRaisesRegex(ValueError, 'distinct ports'):
            keeper.settings()


if __name__ == '__main__':
    unittest.main()
