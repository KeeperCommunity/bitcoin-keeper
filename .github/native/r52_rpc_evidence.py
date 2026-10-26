"""Fail-closed binding of actual RN app-caller results and independent loopback witnesses."""
import hashlib

CASES = ['synthetic_headers', 'synthetic_utxo', 'synthetic_history', 'synthetic_fee',
         'synthetic_fake_broadcast', 'forced_selected_socket_retry', 'other_endpoint_no_inherited_ca',
         'other_endpoint_explicit_same_ca', 'explicit_disconnect_no_retry']
STAGES = ['drop_after_rpc', 'selected_retry', 'other_untrusted', 'other_explicit', 'disconnected']
METHODS = ['blockchain.headers.subscribe', 'blockchain.scripthash.listunspent',
           'blockchain.scripthash.get_history', 'blockchain.estimatefee', 'blockchain.transaction.broadcast']


def validate_rpc(config, app, server, platform):
    rpc = config['rpc']
    if (app.get('schema') != 1 or app.get('status') != 'PASS' or app.get('nonce') != config['nonce'] or
            app.get('platform') != platform or
            app.get('scope') != 'ACTUAL_APP_ELECTRUM_CALLER_AND_NATIVE_TLS_SYNTHETIC_RPC' or
            app.get('account_scope') != 'EMPTY_OWNED_APP_NO_ACCOUNT_OR_REALM_MUTATION' or
            app.get('peer_scope') != 'SELECTED_PRIVATE_RETRY_AND_INDEPENDENT_OTHER_ENDPOINT_NOT_PUBLIC_ROTATION' or
            [row.get('id') for row in app.get('cases', [])] != CASES or
            any(row.get('status') != 'PASS' for row in app['cases'])):
        raise ValueError('RPC_ACTUAL_APP_RECEIPT_REQUIRED')
    for row in app['cases']:
        expected = {'id', 'status'}
        if row['id'] == 'forced_selected_socket_retry':
            expected |= {'generation_before', 'generation_after', 'client_replaced', 'selected_port',
                         'ca_sha256', 'eligible_peer_count'}
            if (type(row.get('generation_before')) is not int or type(row.get('generation_after')) is not int or
                    not 0 < row['generation_before'] < row['generation_after'] < 100 or
                    row.get('client_replaced') is not True or row.get('selected_port') != rpc['selected']['port'] or
                    row.get('ca_sha256') != hashlib.sha256(rpc['selected']['ca'].strip().encode()).hexdigest() or
                    type(row.get('eligible_peer_count')) is not int or row['eligible_peer_count'] != 1):
                raise ValueError('RPC_PRODUCTION_SELECTED_RETRY_REQUIRED')
        if set(row) != expected:
            raise ValueError('RPC_CASE_SHAPE')
    if (server.get('schema') != 1 or server.get('status') != 'PASS' or server.get('nonce') != config['nonce'] or
            server.get('scope') != 'OWNED_SYNTHETIC_RPC_SERVER_WITNESSES' or
            [row.get('id') for row in server.get('stages', [])] != STAGES or
            any(row.get('status') != 'PASS' for row in server['stages'])):
        raise ValueError('RPC_COMPLETE_SERVER_WITNESS_REQUIRED')
    for index, stage in enumerate(server['stages']):
        witnesses = stage.get('witnesses', {})
        if set(witnesses) != {'selected', 'other'}:
            raise ValueError('RPC_ENDPOINT_WITNESSES_REQUIRED')
        for name, witness in witnesses.items():
            if (set(witness) != {'connections', 'secure_connections', 'invalid', 'versions', 'methods', 'drops'} or
                    any(type(witness[key]) is not int or not 0 <= witness[key] <= 8 for key in witness if key != 'methods') or
                    witness['invalid'] != 0 or witness['secure_connections'] > witness['connections'] or
                    witness['versions'] > witness['secure_connections']):
                raise ValueError('RPC_SERVER_COUNTS_INVALID')
            methods = witness['methods']
            allowed = {'server.version', 'server.ping', *(METHODS if name == 'selected' else [])}
            if (not isinstance(methods, dict) or not set(methods).issubset(allowed) or
                    any(type(value) is not int or not 0 <= value <= 8 for value in methods.values()) or
                    methods.get('server.version', 0) != witness['versions']):
                raise ValueError('RPC_SERVER_METHODS_INVALID')
        selected, other = witnesses['selected'], witnesses['other']
        if (selected['connections'] != (1 if index == 0 else 2) or
                selected['secure_connections'] != selected['connections'] or
                selected['versions'] != selected['connections'] or selected['drops'] != 1 or
                any(selected['methods'].get(method) != 1 for method in METHODS) or
                other['drops'] != 0 or other['connections'] != [0, 0, 1, 2, 2][index] or
                other['versions'] != [0, 0, 0, 1, 1][index] or
                other['secure_connections'] != [0, 0, 0, 1, 1][index]):
            raise ValueError('RPC_STAGE_NETWORK_WITNESS_MISMATCH')
    if server.get('witnesses') != server['stages'][-1]['witnesses']:
        raise ValueError('RPC_POST_DISCONNECT_ACTIVITY')
    return {'status': 'PASS', 'scope': app['scope'], 'cases': app['cases'],
            'server_stages': server['stages'], 'account_scope': app['account_scope'],
            'peer_scope': app['peer_scope'], 'native_app_caller_executed': True,
            'normal_product_ui': False, 'real_transaction_or_network': False}
