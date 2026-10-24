import './encoding';
import { Buffer } from 'buffer';
import { HDKey, HARDENED_OFFSET } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { equalBytes } from '@noble/curves/utils.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export type ProtectedBackupPath = '/backup/v3/enroll' | '/backup/v3/snapshot' | '/backup/v3/mutate';
export type PublicBackupJwk = Readonly<{
  kty: 'EC';
  crv: 'secp256k1';
  x: string;
  y: string;
}>;
export type BackupAuthority = Readonly<{
  namespaceId: string;
  publicJwk: PublicBackupJwk;
  kid: string;
  signRawBody: (
    rawBytes: Uint8Array,
    path: ProtectedBackupPath,
    audience: string,
    nowSeconds?: number
  ) => string;
  dispose: () => void;
}>;
export type ExpectedBackupAccount = Readonly<{ id: string; primarySeed: string }>;

const PATHS = new Set(['/backup/v3/enroll', '/backup/v3/snapshot', '/backup/v3/mutate']);
const OPERATIONS = new Set([
  'updateAppImage',
  'migrateXfps',
  'deleteAppImageEntity',
  'deleteVaults',
  'updateVaultImage',
  'modifyLabels',
  'deleteBackup',
  'repairAppBackup',
]);
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const unavailable = (): never => {
  throw new Error('PROTECTED_BACKUP_AUTHORITY_UNAVAILABLE');
};
const unsigned = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: unknown, keys: string[]) => {
  if (
    !object(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  )
    unavailable();
};
const base64url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64').replace(/[=]/g, '').replace(/\+/g, '-').replace(/\//g, '_');

// Prevent signing a different namespace/key or operation envelope by mistake.
// Transport constructs this JSON; Relay independently applies its strict parser.
function assertBodyTarget(
  raw: Uint8Array,
  path: ProtectedBackupPath,
  namespaceId: string,
  jwk: PublicBackupJwk
) {
  const text = Buffer.from(raw).toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(Buffer.from(raw))) unavailable();
  const body = JSON.parse(text);
  exactKeys(
    body,
    path === '/backup/v3/mutate'
      ? [
          'namespaceId',
          'publicJwk',
          'operation',
          'expectedRevision',
          'expectedGeneration',
          'authEpoch',
          'data',
        ]
      : ['namespaceId', 'publicJwk']
  );
  exactKeys(body.publicJwk, ['kty', 'crv', 'x', 'y']);
  if (
    body.namespaceId !== namespaceId ||
    Object.keys(jwk).some((key) => body.publicJwk[key] !== jwk[key])
  )
    unavailable();
  if (
    path === '/backup/v3/mutate' &&
    (!OPERATIONS.has(body.operation) ||
      typeof body.expectedRevision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.expectedRevision) ||
      !unsigned(body.expectedGeneration) ||
      !unsigned(body.authEpoch) ||
      !object(body.data))
  )
    unavailable();
}

/** Derive only from the original Keeper account Recovery Key, without a passphrase. */
export function deriveBackupAuthority(
  primaryMnemonic: string,
  expectedAccount?: ExpectedBackupAccount
): BackupAuthority {
  let seed: Uint8Array | undefined;
  let signingSeed: Uint8Array | undefined;
  let master: HDKey | undefined;
  let child: HDKey | undefined;
  let delivered = false;
  try {
    if (
      typeof primaryMnemonic !== 'string' ||
      primaryMnemonic.length > 1024 ||
      !validateMnemonic(primaryMnemonic, wordlist)
    )
      unavailable();
    seed = mnemonicToSeedSync(primaryMnemonic, '');
    if (expectedAccount !== undefined) {
      if (
        !object(expectedAccount) ||
        typeof expectedAccount.id !== 'string' ||
        !/^[a-f0-9]{64}$/.test(expectedAccount.id) ||
        typeof expectedAccount.primarySeed !== 'string' ||
        // Existing image encryption hashes the stored hex text. Clean restore
        // derives lowercase hex, so accepting uppercase here could authorize
        // ciphertext that its recovery mnemonic cannot decrypt.
        !/^[a-f0-9]{128}$/.test(expectedAccount.primarySeed)
      )
        unavailable();
      const expectedSeed = hexToBytes(expectedAccount.primarySeed);
      try {
        if (!equalBytes(seed, expectedSeed) || bytesToHex(sha256(seed)) !== expectedAccount.id)
          unavailable();
      } finally {
        expectedSeed.fill(0);
      }
    }
    signingSeed = hkdf(
      sha256,
      seed,
      utf8ToBytes('BitcoinKeeper/BackupAuthority/v1'),
      utf8ToBytes('secp256k1-signing-seed'),
      32
    );
    // Invalid masters throw. The pinned BIP32 implementation handles hardened
    // invalid-child skipping/overflow; no alternate seed or profile is chosen.
    master = HDKey.fromMasterSeed(signingSeed);
    child = master.deriveChild(HARDENED_OFFSET);
    const compressed = child.publicKey;
    if (!compressed) unavailable();
    const point = secp256k1.Point.fromBytes(compressed).toBytes(false);
    const publicJwk: PublicBackupJwk = Object.freeze({
      kty: 'EC',
      crv: 'secp256k1',
      x: base64url(point.slice(1, 33)),
      y: base64url(point.slice(33, 65)),
    });
    const canonical = JSON.stringify({
      crv: publicJwk.crv,
      kty: publicJwk.kty,
      x: publicJwk.x,
      y: publicJwk.y,
    });
    const kid = base64url(sha256(utf8ToBytes(canonical)));
    const namespaceId = `bk3_${kid}`;
    const authority: BackupAuthority = Object.freeze({
      namespaceId,
      publicJwk,
      kid,
      signRawBody(rawBytes, path, audience, nowSeconds = Math.floor(Date.now() / 1000)) {
        try {
          if (
            !child ||
            !(rawBytes instanceof Uint8Array) ||
            rawBytes.length > MAX_BODY_BYTES ||
            !PATHS.has(path) ||
            typeof audience !== 'string' ||
            !audience.length ||
            audience.length > 256 ||
            utf8ToBytes(audience).length > 256 ||
            Array.from(audience).some(
              (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
            ) ||
            !unsigned(nowSeconds) ||
            nowSeconds > Number.MAX_SAFE_INTEGER - 120
          )
            unavailable();
          const raw = Uint8Array.from(rawBytes);
          assertBodyTarget(raw, path, namespaceId, publicJwk);
          const header = { alg: 'ES256K', kid, typ: 'keeper-backup+jws' };
          const claims = {
            v: 3,
            aud: audience,
            method: 'POST',
            path,
            namespaceId,
            bodySha256: bytesToHex(sha256(raw)),
            iat: nowSeconds,
            exp: nowSeconds + 120,
          };
          const input = `${base64url(utf8ToBytes(JSON.stringify(header)))}.${base64url(
            utf8ToBytes(JSON.stringify(claims))
          )}`;
          // Pinned2.4.0 HDKey.sign accepts a SHA256 digest with prehash:false
          // and returns deterministic, compact low-S ECDSA; hash exactly once.
          const signature = child.sign(sha256(utf8ToBytes(input)));
          if (signature.length !== 64) unavailable();
          return `${input}.${base64url(signature)}`;
        } catch {
          return unavailable();
        }
      },
      dispose() {
        try {
          child?.wipePrivateData();
        } finally {
          child = undefined;
        }
      },
    });
    delivered = true;
    return authority;
  } catch {
    return unavailable();
  } finally {
    // Best effort only: JavaScript/library temporaries cannot promise erasure.
    seed?.fill(0);
    signingSeed?.fill(0);
    master?.wipePrivateData();
    if (!delivered) child?.wipePrivateData();
  }
}
