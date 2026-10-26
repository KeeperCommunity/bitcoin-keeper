"""Original validator-shaped HOST fixtures, never executed native evidence."""
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).parents[3]
def load(path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value
evidence = load(ROOT / '.github/native/native_phase_evidence.py')
rpc_test = load(ROOT / '.github/tests/test_r52_rpc_evidence.py')
realm_test = load(ROOT / '.github/tests/test_r52_realm109_native.py')
config, rpc_app, rpc_server = rpc_test.NativeEvidence().fixture()
config['rpc'].update(schema=1, other=dict(host='127.0.0.1', port=31001, ca='public-fixture-ca'),
    control_port=31002, expected=dict(
        scripthash=hashlib.sha256(bytes([0, 20]) + bytes([7]) * 20).digest()[::-1].hex(),
        txid=hashlib.sha256((config['nonce'] + ':synthetic-txid').encode()).hexdigest(),
        height=123, value=7000, header_hex='00' * 80, fee_btc_per_kb=0.0001024, fee_sat_per_byte=10,
        fake_transaction='keeper-r52-invalid-nontransaction:' + config['nonce']))
config['rpc']['selected']['host'] = '127.0.0.1'
config.update(schema=1, platform='ANDROID', cases=[dict(id=name, expected=expected, host='127.0.0.1',
    port=32000+i, ca='public-host-fixture') for i, (name, expected) in enumerate(evidence.TLS_ROWS)])
app = dict(schema=1, scope='ACTUAL_APP_RN_PRODUCTION_TLS_BRIDGE', nonce=config['nonce'], platform='ANDROID',
    status='PASS', transport_status='PASS', cases=[dict(id=name, outcome=expected, connected=expected=='ACCEPT')
    for name, expected in evidence.TLS_ROWS], rpc=rpc_app)
server = dict(tls={name:dict(connections=1, secure_connections=int(expected=='ACCEPT'),
    requests=int(expected=='ACCEPT'), invalid_payloads=0) for name, expected in evidence.TLS_ROWS}, rpc=rpc_server)
realm_app = realm_test.NativeReceiptContracts().payload(); realm_app['platform'] = 'ANDROID'
realm_config = dict(schema=1, scope=realm_app['scope'], nonce=realm_app['nonce'], platform='ANDROID',
    source_sha=realm_app['source_sha'], historical_commit=realm_app['historical_commit'],
    manifest_sha256=realm_app['manifest_sha256'], realm_package='12.15.0', schema_count=50,
    public_ca='-----BEGIN CERTIFICATE-----\nHOST FIXTURE ONLY\n-----END CERTIFICATE-----\n',
    generated=[dict(name=row['path'][:-3] + '.js', sha256='e' * 64)
               for row in json.loads((ROOT / 'tests/recovery/fixtures/realm109-node-source.json').read_bytes())['files']
               if row['path'] != 'src/storage/realm/realm.ts'])
print(json.dumps(dict(config=config, app=app, server=server,
    cases=load(ROOT / '.github/native/r52_tls_native.py').validate(config, app, server['tls'], 'ANDROID'),
    rpc=rpc_test.rpc.validate_rpc(config, rpc_app, rpc_server, 'ANDROID'),
    realm_config=realm_config, realm_app=realm_app, realm_cases=realm_test.fixture.CASES)))
