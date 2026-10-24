#!/usr/bin/env python3
"""Exercise disposable local fixtures, never a hosted backend or real wallet."""
import argparse
import base64
import hashlib
import hmac
import json
import re
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

from keeper import compose, settings


def require(condition, description):
    if not condition:
        raise RuntimeError(description)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('Local check refused an HTTP redirect')


def request(port, path, data=None, expected=200):
    req = urllib.request.Request(f'http://127.0.0.1:{port}{path}',
        data=None if data is None else json.dumps(data).encode(),
        headers={'Content-Type': 'application/json', 'appversion': '2.5.15',
                 'os': 'ANDROID', 'HEXA-ID': 'keeper-local-only'})
    try:
        response = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(req, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        statuses = expected if isinstance(expected, tuple) else (expected,)
        require(response.code in statuses, f'{path}: expected HTTP {expected}, got {response.code}')
        body = response.read().decode()
    return body if path.startswith('/socket.io/') else json.loads(body)


def token(secret):
    key = base64.b32decode(secret + '=' * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack('>Q', int(time.time()) // 30), hashlib.sha1).digest()
    offset = digest[-1] & 15
    return str((struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7fffffff) % 1000000).zfill(6)


def health(relay, signing):
    for port in (relay, signing):
        result = request(port, '/health')
        require(result.get('ready') is True and result.get('mode') == 'local' and
                result.get('network') == 'TESTNET', 'Expected healthy local TESTNET service')
        require(result['capabilities']['pushDelivery'] is False, 'Push must be disabled')
    require(request(signing, '/health')['capabilities']['scheduledJobs'] is False, 'Scheduled jobs must be disabled')
    print('PASS local/testnet health and disabled cloud capabilities')


def boundaries():
    cases = [('relay', 'BITCOIN_NETWORK=MAINNET', 'LOCAL_DEV requires'),
             ('relay', 'DATABASE_URL=mongodb://example.invalid/keeper_local', 'LOCAL_DEV requires'),
             ('signing', 'ENVIRONMENT=MAIN', 'Local signing requires'),
             ('signing', 'LOCAL_DATABASE_URL=mongodb://example.invalid/keeper_signing_local', 'Local signing requires')]
    for service, override, message in cases:
        try:
            compose('run', '--rm', '--no-deps', '-e', override, service, 'node', '-e',
                    "require('./dist/config')", capture_output=True, text=True)
        except subprocess.CalledProcessError as error:
            require(message in error.stdout + error.stderr, f'{service}: failed for an unexpected reason')
        else:
            raise RuntimeError(f'{service}: unsafe configuration was accepted')
    print('PASS mainnet and hosted database configuration rejected')


def backup_roundtrip(relay, fixture):
    snapshot = request(relay, '/getBackupSnapshot', {'appId': fixture})
    require(snapshot.get('exists') is True and
            re.fullmatch(r'[a-f0-9]{64}', snapshot.get('revision', '')),
            'Created app backup snapshot unavailable')
    replacement = {'appId': fixture, 'publicId': fixture, 'version': '2.6.3',
                   'expectedRevision': snapshot['revision'],
                   'walletObject': {'qa': 'synthetic-encrypted-wallet'},
                   'signersObject': {}, 'vaultObject': {}, 'nodes': [], 'labels': []}
    result = request(relay, '/repairAppBackup', replacement)
    require(result.get('updated') is True, 'Revisioned backup repair failed')
    repaired = request(relay, '/getBackupSnapshot', {'appId': fixture})
    require(repaired.get('revision') != snapshot['revision'] and
            repaired.get('appImage', {}).get('wallets', {}).get('qa') ==
            replacement['walletObject']['qa'], 'Backup repair did not persist its image')
    stale = dict(replacement, walletObject={'qa': 'stale-replacement-must-not-persist'})
    result = request(relay, '/repairAppBackup', stale, expected=409)
    require(result.get('updated') is False and result.get('error') == 'BACKUP_CHANGED',
            'Stale backup revision was accepted')
    require(request(relay, '/getBackupSnapshot', {'appId': fixture}) == repaired,
            'Rejected stale repair changed the backup')
    print('PASS revisioned backup create/read and stale-revision preservation')
    changed = dict(replacement, expectedRevision=repaired['revision'],
                   walletObject={'qa': 'second-synthetic-encrypted-wallet'})
    require(request(relay, '/repairAppBackup', changed).get('updated') is True,
            'Second disposable backup image was not saved')
    second = request(relay, '/getBackupSnapshot', {'appId': fixture})
    restored = dict(replacement, expectedRevision=second['revision'])
    require(request(relay, '/repairAppBackup', restored).get('updated') is True,
            'Restoring disposable backup content failed')
    final = request(relay, '/getBackupSnapshot', {'appId': fixture})
    require(len({repaired['revision'], second['revision'], final['revision']}) == 3 and
            final['appImage']['wallets'] == repaired['appImage']['wallets'],
            'A backup revision repeated after its content changed and returned')
    obsolete = dict(changed, expectedRevision=repaired['revision'])
    require(request(relay, '/repairAppBackup', obsolete, expected=409).get('error') ==
            'BACKUP_CHANGED', 'An obsolete revision was accepted after content returned')
    require(request(relay, '/getBackupSnapshot', {'appId': fixture}) == final,
            'Rejected obsolete repair changed the restored backup')
    print('PASS restored content retains a new revision and rejects obsolete repairs')
    return final


def verify_invalid_two_fa(signing, auth):
    rejected = request(signing, '/v3/validateSingerSetup',
                       dict(auth, verificationToken='abcdef'), expected=400)
    require(rejected.get('err') ==
            'Validation failed: verification token is either invalid or has expired',
            'Invalid 2FA check returned an unrelated error')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--persistence', action='store_true', help='Recreate this Compose stack, retaining volumes, and recheck fixtures')
    parser.add_argument('--boundaries', action='store_true', help='Check startup rejection of mainnet and external databases')
    args = parser.parse_args()
    config = settings()
    relay, channel, signing = (config[f'KEEPER_{key}_PORT'] for key in ('RELAY', 'CHANNEL', 'SIGNING'))
    health(relay, signing)  # Must pass before any mutations.
    handshake = request(channel, '/socket.io/?EIO=4&transport=polling')
    require(handshake.startswith('0') and json.loads(handshake[1:]).get('sid'), 'Socket.IO handshake failed')
    print('PASS Socket.IO handshake')
    unavailable = request(relay, '/local-unavailable-probe', {}, expected=503)
    require(unavailable.get('error') == 'LOCAL_INTEGRATION_UNAVAILABLE', 'Unavailable route silently succeeded')
    print('PASS unsupported integration fails explicitly')
    fixture = 'contributor-smoke-' + uuid.uuid4().hex
    created = request(relay, '/createNewApp', {'publicId': fixture, 'appID': fixture})
    require(created.get('created') is True, 'App record creation failed')
    # Existing relay acknowledges creation before its app save callback completes.
    # Poll the non-throwing subscription endpoint before retrieving the app image.
    for attempt in range(20):
        subscription = request(relay, '/getSubscriptionDetails', {'id': fixture, 'appID': fixture})
        if subscription.get('currentSubscription'):
            break
        time.sleep(0.25)
    else:
        raise RuntimeError('Created app did not become readable within 5 seconds')
    app = request(relay, '/getAppImage', {'appId': fixture})
    require(app.get('appImage', {}).get('appId') == fixture and
            app['appImage'].get('publicId') == fixture and app['appImage'].get('_id'),
            'Persisted app record round trip failed')
    print('PASS relay app record create/read')
    backup = backup_roundtrip(relay, fixture)
    app = request(relay, '/getAppImage', {'appId': fixture})
    rejected = request(signing, '/v3/setupSigner', {'HEXA_ID': 'invalid'}, expected=400)
    require(rejected.get('err') == 'Unauthorized request', 'Signing authorization failed')
    result = request(signing, '/v3/setupSigner', {'HEXA_ID': 'keeper-local-only', 'policy': {'verification': {'method': 'TWO_FA'},
                   'restrictions': {'none': True, 'maxTransactionAmount': None, 'timeWindow': None},
                   'signingDelay': None}})
    require(result.get('setupSuccessful') is True, 'Signer setup failed')
    data = result['setupData']
    require(data['bhXpub'].startswith('tpub'), 'Signer must use testnet public key')
    secret = data['verification']['verifier']  # Disposable fixture; never print or write to source.
    auth = {'HEXA_ID': 'keeper-local-only', 'id': data['id'], 'verificationToken': token(secret)}
    # Pinned backend uses a save callback here too; wait only for record visibility.
    for attempt in range(20):
        result = request(signing, '/v3/validateSingerSetup', auth, expected=(200, 400))
        if result.get('valid') is True:
            break
        require(result.get('err', '').startswith('Singer not found'), 'Valid 2FA token rejected')
        time.sleep(0.25)
        auth['verificationToken'] = token(secret)
    else:
        raise RuntimeError('Created signer did not become readable within 5 seconds')
    verify_invalid_two_fa(signing, auth)
    print('PASS testnet signer setup, authorization and valid/invalid 2FA')
    if args.persistence:
        compose('down')
        compose('up', '-d', '--wait', '--wait-timeout', '180')
        health(relay, signing)
        require(request(relay, '/getAppImage', {'appId': fixture}) == app, 'App data changed after recreation')
        require(request(relay, '/getBackupSnapshot', {'appId': fixture}) == backup,
                'Revisioned backup changed after recreation')
        auth['verificationToken'] = token(secret)
        restored = request(signing, '/v3/fetchSignerSetup', auth)
        require(restored.get('valid') is True and restored.get('xpub') == data['bhXpub'], 'Signing identity changed after recreation')
        print('PASS database and signing identity persist after container recreation')
    if args.boundaries:
        boundaries()
    print('Local backend checks passed. Disposable records retained in this project\'s local volumes.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'FAIL: {error}', file=sys.stderr)
        sys.exit(1)
