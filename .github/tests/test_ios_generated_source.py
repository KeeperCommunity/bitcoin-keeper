"""Finite generated inventory/source controls. No native execution or fixture servers."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('ios_generated', ROOT / '.github/native/ios_generated_source.py')
m = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(m)
SOURCE = 'a' * 40


class GeneratedInputs(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.generated = self.root / m.PREFIX; self.generated.mkdir(parents=True)
        self.state = {'source_sha': SOURCE, 'native_generated_inputs': {}}
        self.native = SimpleNamespace(ROOT=self.root, PLATFORM='IOS', read=lambda: copy.deepcopy(self.state))

    def fixture(self, kind):
        name, maximum = m.FILES[kind]
        path = self.generated / name
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = json.dumps({'schema': 1, 'platform': 'IOS', 'nonce': 'b' * 48}).encode()
        path.write_bytes(raw)
        full = m.PREFIX + name
        self.state['native_generated_inputs'][kind] = {'source_sha': SOURCE, 'path': full,
            'sha256': hashlib.sha256(raw).hexdigest()}
        return full, path

    def test_owned_tls_and_trust_recorded_after_driver_validation_admit_only_exact_bytes(self):
        names = [self.fixture(kind)[0] for kind in ('tls', 'trust')]
        self.assertEqual(m.allowed(self.native, names), set(names))
        for kind in ('tls', 'trust'):
            name = self.state['native_generated_inputs'][kind]['path']
            path = self.root / name; raw = path.read_bytes(); path.write_bytes(raw + b' ')
            with self.assertRaises(RuntimeError): m.allowed(self.native, names)
            path.write_bytes(raw)

    def test_missing_wrong_source_wrong_path_unknown_field_and_unknown_kind_cannot_grant_exception(self):
        name, path = self.fixture('tls'); original = copy.deepcopy(self.state)
        for change in (
            lambda records: records.clear(),
            lambda records: records['tls'].update(source_sha='c' * 40),
            lambda records: records['tls'].update(path=m.PREFIX + 'foreign.json'),
            lambda records: records['tls'].update(extra=True),
            lambda records: records.update(unknown=records['tls'])):
            self.state = copy.deepcopy(original); change(self.state['native_generated_inputs'])
            with self.assertRaises(RuntimeError): m.allowed(self.native, [name])

    def test_unknown_generated_source_symlink_hardlink_and_executable_are_rejected(self):
        name, path = self.fixture('trust')
        unknown = self.generated / 'override.js'; unknown.write_text('override')
        with self.assertRaises(RuntimeError): m.allowed(self.native, [name, m.PREFIX + 'override.js'])
        unknown.unlink(); raw = path.read_bytes(); path.unlink()
        outside = self.root / 'outside.json'; outside.write_bytes(raw); path.symlink_to(outside)
        with self.assertRaises((RuntimeError, OSError, ValueError)): m.allowed(self.native, [name])
        path.unlink(); path.hardlink_to(outside)
        with self.assertRaises((RuntimeError, OSError, ValueError)): m.allowed(self.native, [name])
        path.unlink(); path.write_bytes(raw); path.chmod(0o755)
        with self.assertRaises(RuntimeError): m.allowed(self.native, [name])

    def test_closed_fixture_record_does_not_allow_other_generated_files(self):
        name, path = self.fixture('tls'); path.unlink()
        self.assertEqual(m.allowed(self.native, []), set())
        with self.assertRaises(RuntimeError): m.allowed(self.native, [m.PREFIX + 'r52_tls_foreign.json'])

    def test_invalid_fixture_platform_and_schema_cannot_be_admitted_by_matching_hash(self):
        name, path = self.fixture('tls')
        for change in ({'platform': 'ANDROID'}, {'schema': 2}, {'nonce': 'invalid'}):
            raw = json.dumps({'schema': 1, 'platform': 'IOS', 'nonce': 'b' * 48, **change}).encode()
            path.write_bytes(raw); self.state['native_generated_inputs']['tls']['sha256'] = hashlib.sha256(raw).hexdigest()
            with self.assertRaises(RuntimeError): m.allowed(self.native, [name])

    def test_r5_is_purely_regenerated_from_current_source_and_never_rewritten(self):
        producer = self.root / '.github/native/r5_prepare.cjs'
        producer.write_text("exports.render = root => ({outputText: 'current source workers\\n', provenance: []});")
        worker = self.root / m.R5; worker.write_text('current source workers\n')
        before = worker.read_bytes()
        self.assertEqual(m.allowed(self.native, [m.R5]), {m.R5})
        self.assertEqual(worker.read_bytes(), before)
        worker.write_text('modified workers\n')
        with self.assertRaises(RuntimeError): m.allowed(self.native, [m.R5])
        self.assertEqual(worker.read_text(), 'modified workers\n')
        producer.write_text("exports.prepare = () => {throw new Error('writer must not run')};")
        with self.assertRaises(RuntimeError): m.allowed(self.native, [m.R5])

    def test_realm_requires_all17_exact_generated_members_and_bound_source(self):
        realm = m.module('r52_realm109_native')
        generated = self.generated / 'r52_realm109'; generated.mkdir()
        rows = []
        for index in range(16):
            path = generated / ('member%d.js' % index); path.write_text('historical fixture%d' % index)
            rows.append({'name': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        config = {'schema': 1, 'platform': 'IOS', 'source_sha': SOURCE, 'nonce': 'b' * 48,
            'scope': realm.SCOPE, 'historical_commit': realm.HISTORICAL, 'manifest_sha256': realm.MANIFEST,
            'realm_package': '12.15.0', 'schema_count': 50, 'generated': rows}
        path = generated / 'config.json'; path.write_text(json.dumps(config))
        self.state['native_generated_inputs']['realm109'] = {'source_sha': SOURCE,
            'path': m.PREFIX + 'r52_realm109/config.json', 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        names = [m.PREFIX + 'r52_realm109/' + row['name'] for row in rows] + [m.PREFIX + 'r52_realm109/config.json']
        self.assertEqual(m.allowed(self.native, names), set(names))
        (generated / 'member1.js').write_text('mutated')
        with self.assertRaises(ValueError): m.allowed(self.native, names)
        (generated / 'member1.js').write_text('historical fixture1')
        unknown = generated / 'override.js'; unknown.write_text('override')
        with self.assertRaises(ValueError): m.allowed(self.native, names + [m.PREFIX + 'r52_realm109/override.js'])
        unknown.unlink(); config['source_sha'] = 'c' * 40; path.write_text(json.dumps(config))
        self.state['native_generated_inputs']['realm109']['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        with self.assertRaises(RuntimeError): m.allowed(self.native, names)


if __name__ == '__main__': unittest.main()
