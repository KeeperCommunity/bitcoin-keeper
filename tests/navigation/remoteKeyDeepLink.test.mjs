import assert from 'node:assert/strict';
import test from 'node:test';
import { getRemoteKeyFromDeepLink } from '../../src/navigation/remoteKeyDeepLink.ts';

const key = '0123456789abcdef01234567';

test('accepts generated production and development remote-key exchange links', () => {
  assert.equal(
    getRemoteKeyFromDeepLink(`https://www.bitcoinkeeper.app/app/prod/remote/${key}`, 'PRODUCTION'),
    key
  );
  assert.equal(
    getRemoteKeyFromDeepLink(`https://bitcoinkeeper.app/app/dev/remote/${key}`, 'DEVELOPMENT'),
    key
  );
  assert.equal(
    getRemoteKeyFromDeepLink(`https://www.bitcoinkeeper.app/app/prod/remote/${key}?source=share`, 'PRODUCTION'),
    key
  );
});

test('rejects a different stage, site, route, or malformed encryption key before fetching', () => {
  for (const url of [
    `https://www.bitcoinkeeper.app/app/dev/remote/${key}`,
    `https://bitcoinkeeper.app.evil.test/app/prod/remote/${key}`,
    `http://www.bitcoinkeeper.app/app/prod/remote/${key}`,
    `https://www.bitcoinkeeper.app.evil.test/app/prod/remote/${key}`,
    `https://www.bitcoinkeeper.app/app/prod/remote/${key}/extra`,
    `https://www.bitcoinkeeper.app/app/prod/remote/${key.toUpperCase()}`,
    `https://www.bitcoinkeeper.app/app/prod/remote/${key.slice(0, -1)}`,
    `https://www.bitcoinkeeper.app/app/prod/remote/${key}zz`,
    'not a link',
  ]) {
    assert.equal(getRemoteKeyFromDeepLink(url, 'PRODUCTION'), null, url);
  }
});
