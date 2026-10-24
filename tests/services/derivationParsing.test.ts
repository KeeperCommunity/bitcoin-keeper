// Disposable public derivations only. The real metadata factory and KeyUID
// functions verify that parser hardening preserves normal signer identities.
jest.mock('src/store/store', () => ({ store: { getState: jest.fn(() => ({
  settings: { bitcoinNetworkType: 'TESTNET' },
})), dispatch: jest.fn(), subscribe: jest.fn(), replaceReducer: jest.fn() } }));

import BIP32Factory from 'bip32';
import { networks } from 'bitcoinjs-lib';
import { generateSignerFromMetaData } from 'src/hardware';
import { NetworkType, SignerStorage, SignerType } from 'src/services/wallets/enums';
import ecc from 'src/services/wallets/operations/taproot-utils/noble_ecc';
import { store } from 'src/store/store';
import { accountNoFromDerivationPath, parseTextforVaultConfig } from 'src/utils/service-utilities/utils';
import { getAccountFromSigner, getKeyUID } from 'src/utils/utilities';

const bip32 = BIP32Factory(ecc);
const root = bip32.fromSeed(Buffer.alloc(32, 43), networks.testnet);
const fingerprint = root.fingerprint.toString('hex').toUpperCase();
const xpub = root.derivePath("m/84'/1'/13'").neutered().toBase58();

describe('validated derivation account segments', () => {
  test.each([
    ["m/84'/0'/0'", '0'],
    ["m/84'/1'/13'/0/1", '13'],
    ["m/48h/1h/13h/2h", '13'],
    ["m/86'/0'/2147483647'", '2147483647'],
    ["m/84'/0'/0013'", '0013'],
    ['m/84/0/12', '12'],
  ])('preserves the account text in %s', (path, account) => {
    expect(accountNoFromDerivationPath(path)).toBe(account);
  });

  test.each([
    undefined, null, 13, '', 'm', "m/84'", "m/84'/0'", "m/84'/0'/",
    "x/84'/0'/1'", "m//0'/1'", "m/84'/0'/1''", "m/84'/0'/1h'",
    "m/84'/0'/-1'", "m/84'/0'/+1'", "m/84'/0'/1.5'", "m/84'/0'/1e3'",
    "m/84'/0'/ 1'", "m/84'/0'/1H", "m/84'/0'/１'", "m/84'/0'/1'\n",
    "m/84'/0'/2147483648'", "m/84'/0'/9007199254740993'",
    "m/84'/0'/1'/2''", "m/84'/0'/1'/bad", "m/2147483648'/0'/1'",
    "m/84'/0'/1'/", "m/84'/0'/1'junk",
  ])('rejects the malformed or unsupported path %p', (path) => {
    expect(() => accountNoFromDerivationPath(path as string)).toThrow('Invalid derivation path');
  });
});

describe('vault descriptor origin parsing', () => {
  test('apostrophe and h origins import the same public key and account path', () => {
    const apostrophe = `wpkh([${fingerprint}/84'/1'/13']${xpub}/<0;1>/*)`;
    const h = `wpkh([${fingerprint.toLowerCase()}/84h/1h/13h]${xpub}/<0;1>/*)`;
    const expected = { isMultisig: false, scheme: { m: 1, n: 1 }, signersDetails: [{
      masterFingerprint: fingerprint, path: "m/84'/1'/13'", xpub,
    }] };
    expect(parseTextforVaultConfig(apostrophe)).toEqual(expected);
    expect(parseTextforVaultConfig(h)).toEqual(expected);
  });

  test('bare apostrophe origin expressions retain the account path', () => {
    expect(parseTextforVaultConfig(`wpkh(${fingerprint}/84'/1'/13'${xpub})`).signersDetails)
      .toEqual([{ masterFingerprint: fingerprint, path: "m/84'/1'/13'", xpub }]);
  });

  test('mixed multisig origins normalize without changing either public key', () => {
    const second = bip32.fromSeed(Buffer.alloc(32, 44), networks.testnet);
    const secondFingerprint = second.fingerprint.toString('hex').toUpperCase();
    const secondXpub = second.derivePath("m/48'/1'/7'/2'").neutered().toBase58();
    const multiXpub = root.derivePath("m/48'/1'/13'/2'").neutered().toBase58();
    const parsed = parseTextforVaultConfig(`wsh(sortedmulti(2,[${fingerprint}/48h/1'/13h/2']${multiXpub}/<0;1>/*,[${secondFingerprint}/48'/1h/7'/2h]${secondXpub}/<0;1>/*))`);
    expect(parsed.scheme).toEqual({ m: 2, n: 2 });
    expect(parsed.signersDetails).toEqual([
      { masterFingerprint: fingerprint, path: "m/48'/1'/13'/2'", xpub: multiXpub },
      { masterFingerprint: secondFingerprint, path: "m/48'/1'/7'/2'", xpub: secondXpub },
    ]);
  });

  test('extra origin apostrophes remain invalid', () => {
    expect(parseTextforVaultConfig(`wpkh([${fingerprint}/84'/1'/13'']${xpub})`).signersDetails)
      .toEqual([null]);
  });
});

describe('real signer identity compatibility', () => {
  test.each([
    [NetworkType.MAINNET, networks.bitcoin, '0', 'M'],
    [NetworkType.TESTNET, networks.testnet, '1', 'T'],
  ])('normal account imports keep existing KeyUIDs on %s', (networkType, network, coin, chain) => {
    (store.getState as jest.Mock).mockReturnValue({ settings: { bitcoinNetworkType: networkType } });
    const master = bip32.fromSeed(Buffer.alloc(32, 45), network);
    const masterFingerprint = master.fingerprint.toString('hex').toUpperCase();
    for (const account of [0, 13]) {
      const canonicalPath = `m/48'/${coin}'/${account}'/2'`;
      const publicKey = master.derivePath(canonicalPath).neutered().toBase58();
      for (const path of [canonicalPath, canonicalPath.replace(/'/g, 'h')]) {
        const { signer, key } = generateSignerFromMetaData({
          xpub: publicKey, derivationPath: path, masterFingerprint,
          signerType: SignerType.COLDCARD, storageType: SignerStorage.COLD, isMultisig: true,
        });
        expect(key.derivationPath).toBe(canonicalPath);
        expect(accountNoFromDerivationPath(path)).toBe(String(account));
        expect(getAccountFromSigner(signer)).toBe(account);
        expect(getAccountFromSigner(key)).toBe(account);
        expect(signer.id).toBe(`${masterFingerprint}${account}${chain}`);
        expect(getKeyUID(signer)).toBe(signer.id);
        expect(getKeyUID(key)).toBe(signer.id);
      }
    }
  });
});
