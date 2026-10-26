"""Finite transport facts, exact producer comparison and privacy controls."""
import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / '.github/native' / (name + '.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
d = load('startup_diagnosis'); e = load('ios_startup_errors'); o = load('ios_replacement_observation')


class TransportBoundary(unittest.TestCase):
    def collect(self, rows):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'startup-observer.jsonl').write_text('\n'.join(json.dumps({'time_ms': 200, **row}) for row in rows))
            return d.collect(SimpleNamespace(PRIVATE=root, PLATFORM='IOS'),
                '12345678-1234-1234-1234-123456789ABC', SimpleNamespace(started_ms=150))['metro']

    def test_request_finish_close_error_and_abort_keep_timing_and_identity_without_text(self):
        rows = [{'kind': 'REQUEST', 'request': 'ENTRY_BUNDLE', 'request_id': 2, 'options': {'platform': 'ios'}},
            {'kind': 'RESPONSE', 'request': 'ENTRY_BUNDLE', 'request_id': 2, 'duration_ms': 3500, 'outer_http_status': 200},
            {'kind': 'TRANSPORT', 'request': 'ENTRY_BUNDLE', 'request_id': 2, 'event': 'RESPONSE_CLOSE',
             'duration_ms': 3501, 'outer_http_status': 200, 'headers_sent': True, 'writable_ended': False, 'writable_finished': False},
            {'kind': 'TRANSPORT', 'request': 'ENTRY_BUNDLE', 'request_id': 2, 'event': 'RESPONSE_ERROR',
             'duration_ms': 3502, 'error_code': 'EPIPE'},
            {'kind': 'TRANSPORT', 'request': 'ENTRY_BUNDLE', 'request_id': 2, 'event': 'REQUEST_ABORTED', 'duration_ms': 3503}]
        for row in rows: row['body'] = 'PRIVATE_SENTINEL'; row['url'] = 'PRIVATE_SENTINEL'
        result = self.collect(rows)
        self.assertEqual(result['invalid_rows'], 0)
        self.assertTrue(all(row['stage'] == 'APP_WINDOW' and row['request_id'] == 2 for row in result['rows']))
        self.assertEqual(result['rows'][2]['writable_finished'], False)
        self.assertEqual(result['rows'][3]['error_code'], 'EPIPE')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        self.assertEqual(result['rows'][1]['duration_ms'], 3500)

    def test_malformed_transport_identity_duration_flags_and_error_codes_are_gaps(self):
        original = {'kind': 'TRANSPORT', 'request': 'ENTRY_BUNDLE', 'request_id': 1,
            'event': 'RESPONSE_CLOSE', 'duration_ms': 20, 'outer_http_status': 200,
            'headers_sent': True, 'writable_ended': True, 'writable_finished': True}
        for change in ({'request_id': True}, {'request_id': 513}, {'duration_ms': -1},
                {'duration_ms': 600001}, {'duration_ms': True}, {'headers_sent': 1},
                {'event': 'PRIVATE_SENTINEL'}, {'event': 'RESPONSE_ERROR', 'error_code': 'PRIVATE_SENTINEL'}):
            result = self.collect([{**original, **change}])
            self.assertEqual(result['invalid_rows'], 1); self.assertFalse(result['rows'])

    def test_only_valid_own_process_finite_native_url_error_codes_are_exported(self):
        record = lambda text, process='hexa_keeper_dev': '2026-10-26 16:00:00.123+0000 E ' + process + '[123:0xabc] ' + text
        raw = '\n'.join([record('Error Domain=NSURLErrorDomain Code=-1001 PRIVATE_SENTINEL'),
            record('NSURLErrorDomain error -1001 PRIVATE_SENTINEL'), record('NSURLErrorDomain Code=-1004'),
            record('NSURLErrorDomain Code=-1009', 'Foreign'), record('NSURLErrorDomain Code=-1999'),
            record('NSURLErrorDomain Code=-10011'), record('NSURLErrorDomain Code=-1001.0')])
        value = e.classify(raw, 'hexa_keeper_dev')
        self.assertEqual(value['url_error_codes'], [
            {'domain': 'NSURLErrorDomain', 'code': -1004, 'records': 1},
            {'domain': 'NSURLErrorDomain', 'code': -1001, 'records': 2}])
        self.assertEqual(value['cause'], 'UNDETERMINED'); self.assertNotIn('PRIVATE_SENTINEL', json.dumps(value))

    def normal(self):
        return {'compiled_app_source_sha': 'ff3cc6b2721de986d9f6211ef333df57ebc3b1fa',
            'source_sha': 'a' * 40, 'native_acceptance': False, 'installed_artifact_verified': True,
            'build_execution_scope': 'REUSED_EXACT_NORMAL_XCODE_APP_NO_CURRENT_COMPILATION_OR_RESIGNING',
            'retained_xcode_restore': 'PASS', 'original_signature_preserved': True,
            'app_inputs_sha256': '6112e0e18e093e5e65e754fc607aa7e44ee73682576a31a168a6ad01f06a2b85',
            'original_build': {'source_sha': 'ff3cc6b2721de986d9f6211ef333df57ebc3b1fa', 'artifact_id': 12667427189,
                'artifact_zip_sha256': '89806c9d8d71dc032d2ce3ca8b444768705d1ca3ab565aa9ec0652f0277b76f5'},
            'toolchain': {'ios_simulator_signature': {'verified': True, 'certificate_or_profile_used': False,
                'scope': 'XCODE_GENERATED_ADHOC_SIMULATOR_ONLY_NOT_RELEASE_SIGNING', 'bundle_id': o.APP,
                'entitlement_policy': 'XCODE_GENERATED_SIGNED_AND_LINKER_EMBEDDED_SIMULATOR_ENTITLEMENTS',
                'entitlements_sha256': hashlib.sha256(plistlib.dumps({}, sort_keys=True)).hexdigest()}}}

    def test_normal_dictionary_comparison_keeps_legacy_mismatch_and_requires_exact_producer_and_bytes(self):
        payload = plistlib.dumps({})
        value = self.normal()
        compared = o.recorded_xcode_entitlements(payload, value, 'MATCH')
        self.assertEqual(compared['state'], 'MATCH')
        self.assertEqual(compared['legacy_fixed_policy_comparison'], 'MISMATCH')
        self.assertEqual(o.entitlement_state(payload), 'MISMATCH')
        self.assertIsNone(o.recorded_xcode_entitlements(payload, {}, 'MATCH'))
        for change in ({'compiled_app_source_sha': 'a' * 40}, {'retained_xcode_restore': 'FAIL'},
                {'original_signature_preserved': False}, {'installed_artifact_verified': False}, {'native_acceptance': True}):
            self.assertEqual(o.recorded_xcode_entitlements(payload, {**value, **change}, 'MATCH')['state'], 'UNKNOWN')
        self.assertEqual(o.recorded_xcode_entitlements(payload, value, 'MISMATCH')['state'], 'UNKNOWN')
        self.assertEqual(o.recorded_xcode_entitlements(plistlib.dumps({'unexpected': True}), value, 'MATCH')['state'], 'MISMATCH')
        self.assertEqual(o.recorded_xcode_entitlements(payload * 2, value, 'MATCH')['state'], 'UNKNOWN')


if __name__ == '__main__': unittest.main()
