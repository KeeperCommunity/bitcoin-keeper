"""Negative host receipt controls only; no native execution or acceptance."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('r52_rpc_evidence', Path(__file__).parents[1] / 'native/r52_rpc_evidence.py')
rpc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rpc)

class NativeEvidence(unittest.TestCase):
    def fixture(self):
        config = {'nonce': 'a' * 48, 'rpc': {'selected': {'port': 31000, 'ca': 'public-fixture-ca'}}}
        app = {'schema': 1, 'status': 'PASS', 'nonce': config['nonce'], 'platform': 'ANDROID',
               'scope': 'ACTUAL_APP_ELECTRUM_CALLER_AND_NATIVE_TLS_SYNTHETIC_RPC',
               'account_scope': 'EMPTY_OWNED_APP_NO_ACCOUNT_OR_REALM_MUTATION',
               'peer_scope': 'SELECTED_PRIVATE_RETRY_AND_INDEPENDENT_OTHER_ENDPOINT_NOT_PUBLIC_ROTATION',
               'cases': [{'id': case, 'status': 'PASS'} for case in rpc.CASES]}
        app['cases'][5].update(generation_before=2, generation_after=4, client_replaced=True,
            selected_port=31000, ca_sha256=hashlib.sha256(b'public-fixture-ca').hexdigest(), eligible_peer_count=1)
        stages = []
        for i, name in enumerate(rpc.STAGES):
            n = 1 if i == 0 else 2
            other_connections, other_versions = [0, 0, 1, 2, 2][i], [0, 0, 0, 1, 1][i]
            stages.append({'id': name, 'status': 'PASS', 'witnesses': {
                'selected': {'connections': n, 'secure_connections': n, 'versions': n, 'invalid': 0,
                             'drops': 1, 'methods': {'server.version': n, **{m: 1 for m in rpc.METHODS}}},
                'other': {'connections': other_connections, 'secure_connections': other_versions,
                          'versions': other_versions, 'invalid': 0, 'drops': 0,
                          'methods': {'server.version': other_versions} if other_versions else {}}}})
        server = {'schema': 1, 'status': 'PASS', 'nonce': config['nonce'],
                  'scope': 'OWNED_SYNTHETIC_RPC_SERVER_WITNESSES', 'stages': stages,
                  'witnesses': copy.deepcopy(stages[-1]['witnesses'])}
        return config, app, server

    def test_bound_app_methods_replacement_client_and_all_network_windows_are_required(self):
        value = rpc.validate_rpc(*self.fixture(), 'ANDROID')
        self.assertEqual(len(value['cases']), 9)
        self.assertTrue(value['native_app_caller_executed'])
        self.assertFalse(value['normal_product_ui'])
        self.assertFalse(value['real_transaction_or_network'])

    def test_host_result_missing_case_changed_nonce_or_wrong_scope_never_becomes_native(self):
        for mutate in (lambda a, s: a.update(scope='HOST_NODE_ONLY'),
                       lambda a, s: a.update(status='NOT RUN'),
                       lambda a, s: a.update(nonce='b' * 48),
                       lambda a, s: a['cases'].pop(),
                       lambda a, s: s['stages'].pop(),
                       lambda a, s: s.update(status='INCOMPLETE')):
            config, app, server = self.fixture(); mutate(app, server)
            with self.assertRaises(ValueError): rpc.validate_rpc(config, app, server, 'ANDROID')

    def test_library_only_retry_inherited_ca_or_extra_peer_cannot_claim_production_retry(self):
        for mutation in ({'generation_after': 2}, {'client_replaced': False},
                         {'eligible_peer_count': 2}, {'ca_sha256': 'f' * 64}, {'selected_port': 31001}):
            config, app, server = self.fixture(); app['cases'][5].update(mutation)
            with self.assertRaises(ValueError): rpc.validate_rpc(config, app, server, 'ANDROID')

    def test_unreachable_negative_missing_rpc_no_reset_or_post_disconnect_retry_reject(self):
        for mutate in (
            lambda s: s['stages'][2]['witnesses']['other'].update(connections=0),
            lambda s: s['stages'][2]['witnesses']['other'].update(secure_connections=1),
            lambda s: s['stages'][2]['witnesses']['other'].update(versions=1, secure_connections=1),
            lambda s: s['stages'][0]['witnesses']['selected'].update(drops=0),
            lambda s: s['stages'][1]['witnesses']['selected']['methods'].update({'blockchain.estimatefee': 0}),
            lambda s: s['stages'][3]['witnesses']['selected']['methods'].update({'unexpected.rpc': 1}),
            lambda s: s['witnesses']['selected'].update(connections=3),
            lambda s: s['stages'][4]['witnesses']['selected'].update(invalid=1),
        ):
            config, app, server = self.fixture(); mutate(server)
            with self.assertRaises(ValueError): rpc.validate_rpc(config, app, server, 'ANDROID')

if __name__ == '__main__': unittest.main()
