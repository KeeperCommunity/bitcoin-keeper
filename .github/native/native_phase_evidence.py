"""Revalidate bounded original app/server receipts, never a top-level PASS."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

TLS_ROWS = [('explicit_root_valid_before', 'ACCEPT'), ('selfsigned_untrusted', 'REJECT'),
    ('expired_leaf', 'REJECT'), ('wrong_host', 'REJECT'), ('forged_signature', 'REJECT'),
    ('explicit_custom_ca', 'ACCEPT'), ('explicit_selfsigned_leaf', 'ACCEPT'),
    ('explicit_wrong_host', 'REJECT'), ('expired_custom_ca', 'REJECT'),
    ('expired_selfsigned_leaf', 'REJECT'), ('custom_trust_not_inherited', 'REJECT'),
    ('wrong_custom_anchor', 'REJECT'), *[(f'withdrawn_anchor_{i}', 'REJECT') for i in range(3)],
    *[(f'compromised_spki_anchor_{i}', 'REJECT') for i in range(8)], ('explicit_root_valid_after', 'ACCEPT')]


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


def require(value):
    if not value: raise ValueError('NATIVE_PHASE_RAW_EVIDENCE_INVALID')


def parse(raw):
    def pairs(rows):
        result = {}
        for key, value in rows:
            require(key not in result); result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: require(False))


def configuration(row, digest_field):
    raw = row['raw_evidence']['configuration_json']
    require(type(raw) is str and 0 < len(raw.encode()) <= 262144 and 'PRIVATE KEY' not in raw)
    require(hashlib.sha256(raw.encode()).hexdigest() == row[digest_field])
    return parse(raw)


def validate(value):
    platform, source = value['platform'], value['sourceSha']
    require(platform in ['IOS', 'ANDROID'] and re.fullmatch('[a-f0-9]{40}', source))
    tls, realm = value['tls'], value['realm']
    config = configuration(tls, 'fixture_sha256')
    expected = TLS_ROWS + ([('disposable_simulator_system_root', 'ACCEPT')] if platform == 'IOS' else [])
    require(type(config['schema']) is int and config['schema'] == 1 and config['platform'] == platform and re.fullmatch('[a-f0-9]{48}', config['nonce']) and
            [(row['id'], row['expected']) for row in config['cases']] == expected and
            all(row['host'] == '127.0.0.1' and type(row['port']) is int and 1024 < row['port'] < 65536 for row in config['cases']))
    rpc = config['rpc']
    require(type(rpc['schema']) is int and rpc['schema'] == 1 and all(row['host'] == '127.0.0.1' for row in [rpc['selected'], rpc['other']]) and
            rpc['expected']['fake_transaction'] == 'keeper-r52-invalid-nontransaction:' + config['nonce'])
    ports = [row['port'] for row in config['cases']] + [rpc['selected']['port'], rpc['other']['port'], rpc['control_port']]
    require(all(type(port) is int and 1024 < port < 65536 for port in ports) and len(set(ports)) == len(ports))
    raw = tls['raw_evidence']; app, server = raw['app_payload'], raw['server_witnesses']
    require(all(type(row['schema']) is int and row['schema'] == 1 for row in [app, app['rpc'], server['rpc']]))
    require(app.get('status') == 'PASS')
    require(module('r52_tls_native').validate(config, app, server['tls'], platform) == tls['cases'])
    require(module('r52_rpc_evidence').validate_rpc(config, app['rpc'], server['rpc'], platform) == tls['rpc'])
    config = configuration(realm, 'config_sha256')
    native = module('r52_realm109_native')
    manifest_raw = (Path(__file__).resolve().parents[2] / 'tests/recovery/fixtures/realm109-node-source.json').read_bytes()
    require(hashlib.sha256(manifest_raw).hexdigest() == native.MANIFEST)
    manifest = parse(manifest_raw)
    names = {row['path'][:-3] + '.js' for row in manifest['files'] if row['path'] != 'src/storage/realm/realm.ts'}
    generated = config['generated']
    require(type(config['schema']) is int and config['schema'] == 1 and config['scope'] == native.SCOPE and
            config['source_sha'] == source and config['platform'] == platform and
            config['historical_commit'] == native.HISTORICAL and config['manifest_sha256'] == native.MANIFEST and
            config['realm_package'] == '12.15.0' and config['schema_count'] == 50 and
            re.fullmatch('[a-f0-9]{48}', config['nonce']) and type(config['public_ca']) is str and
            config['public_ca'].startswith('-----BEGIN CERTIFICATE-----') and
            config['public_ca'].rstrip().endswith('-----END CERTIFICATE-----') and
            len(generated) == 16 and {row['name'] for row in generated} == names and
            all(set(row) == {'name', 'sha256'} and re.fullmatch('[a-f0-9]{64}', row['sha256']) for row in generated))
    require(native.validate(config, realm['raw_evidence']['app_payload'], platform, source) == realm['cases'])
    require(realm['historical_commit'] == native.HISTORICAL and realm['manifest_sha256'] == native.MANIFEST)
    return {'tls': 'PASS', 'rpc': 'PASS', 'realm109': 'PASS'}


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(1048577); require(len(raw) <= 1048576)
        print(json.dumps(validate(parse(raw))))
    except Exception:
        print('Native phase raw evidence rejected.', file=sys.stderr)
        sys.exit(1)
