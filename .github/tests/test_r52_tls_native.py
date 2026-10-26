import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('tls_native', Path(__file__).parents[1] / 'native/r52_tls_native.py')
matrix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(matrix)


class EvidenceControls(unittest.TestCase):
    def fixture(self):
        config = {'nonce': 'c' * 48, 'cases': [
            {'id': 'valid', 'expected': 'ACCEPT'}, {'id': 'expired', 'expected': 'REJECT'}]}
        app = {'schema': 1, 'scope': 'ACTUAL_APP_RN_PRODUCTION_TLS_BRIDGE', 'nonce': config['nonce'],
               'platform': 'IOS', 'status': 'PASS', 'cases': [
                   {'id': 'valid', 'outcome': 'ACCEPT', 'connected': True},
                   {'id': 'expired', 'outcome': 'REJECT', 'connected': False}]}
        server = {'valid': {'connections': 1, 'secure_connections': 1, 'requests': 1, 'invalid_payloads': 0},
                  'expired': {'connections': 1, 'secure_connections': 0, 'requests': 0, 'invalid_payloads': 0}}
        return config, app, server

    def test_exact_native_and_server_evidence_required(self):
        args = self.fixture()
        self.assertEqual(len(matrix.validate(*args, 'IOS')), 2)

    def test_unreachable_negative_cannot_pass_as_certificate_rejection(self):
        config, app, server = self.fixture()
        server['expired']['connections'] = 0
        with self.assertRaises(ValueError):
            matrix.validate(config, app, server, 'IOS')

    def test_missing_reply_wrong_nonce_timeout_and_plaintext_are_rejected(self):
        mutations = [lambda c, a, s: a.update(nonce='d' * 48),
                     lambda c, a, s: a['cases'][1].update(outcome='TIMEOUT'),
                     lambda c, a, s: a['cases'][1].update(connected=True),
                     lambda c, a, s: s['expired'].update(requests=1),
                     lambda c, a, s: s['valid'].update(requests=0),
                     lambda c, a, s: a['cases'].pop(),
                     lambda c, a, s: a.update(platform='ANDROID'),
                     lambda c, a, s: s['valid'].update(connections=True)]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                args = copy.deepcopy(self.fixture())
                mutation(*args)
                with self.assertRaises(ValueError):
                    matrix.validate(*args, 'IOS')

    def test_local_or_public_runner_never_executes_app_probe(self):
        class Harness:
            def read(self):
                return {'build': 'PASS', 'smoke': 'PASS'}
        with self.assertRaisesRegex(RuntimeError, 'TLS_PRIVATE_HOSTED'):
            matrix.run(Harness())

    def test_child_failure_before_ready_is_not_successful_cleanup(self):
        class DeadFixture:
            def poll(self):
                return 1
        with self.assertRaisesRegex(RuntimeError, 'TLS_FIXTURE_CLEANUP_UNVERIFIED'):
            matrix.close_fixture(DeadFixture())


if __name__ == '__main__':
    unittest.main()
