import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import * as bitcoinJS from 'bitcoinjs-lib';
import BIP85 from 'src/services/wallets/operations/BIP85';
import ecc from 'src/services/wallets/operations/taproot-utils/noble_ecc';
import {
  deriveRecoverableMobileKeyPublic,
  RECOVERABLE_MOBILE_KEY_INDEX_START,
  RECOVERABLE_MOBILE_KEY_MAX_ORDINAL,
  RECOVERABLE_MOBILE_KEY_SIGNER_PATH,
} from 'src/services/wallets/operations/recoverable/mobileKey';

const RECOVERY_KEY =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const bip32 = BIP32Factory(ecc);

describe('Recoverable Wallet Mobile Key derivation', () => {
  it('matches the published BIP85 12-word application vector', () => {
    const rootXpriv =
      'xprv9s21ZrQH143K2LBWUUQRFXhucrQqBpKdRRxNVq2zBqsx8HVqFk2uYo8kmbaLLHRdqtQpUm98uKfu3vca1LqdGhUtyoFnCNkfmXRyPXLjbKb';
    const entropy = BIP85.bip32XPRVToEntropy("m/83696968'/39'/0'/12'/0'", rootXpriv);

    expect(entropy.subarray(0, 16).toString('hex')).toBe('6250b68daf746d12a24d58b4787a714b');
    expect(BIP85.entropyToBIP39(entropy, 12)).toBe(
      'girl mad pet galaxy egg matter matrix prison refuse sense ordinary nose'
    );
  });

  it('derives a stable testnet signer and records its recovery metadata', async () => {
    const first = await deriveRecoverableMobileKeyPublic(RECOVERY_KEY, 0);
    const second = await deriveRecoverableMobileKeyPublic(RECOVERY_KEY, 0);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      version: 1,
      ordinal: 0,
      bip85Index: RECOVERABLE_MOBILE_KEY_INDEX_START,
      bip85Path: "m/83696968'/39'/0'/12'/1000000'",
      signerPath: RECOVERABLE_MOBILE_KEY_SIGNER_PATH,
      network: 'testnet',
    });
    expect(first.masterFingerprint).toBe('1C45613D');
    expect(first.xpub).toBe(
      'tpubDEJAyvFpnqeSg7auuzzkG66AUHDeBnbzLbg8aDqBBnf6CMjDmMjkJGeMsHzVtQAizAmEe99D1eQahcbysVbg5M5A9ab7Z2bJNGEBjmzKVVM'
    );
    expect(Object.keys(first)).toEqual([
      'version',
      'ordinal',
      'bip85Index',
      'bip85Path',
      'signerPath',
      'network',
      'masterFingerprint',
      'xpub',
    ]);
  });

  it('uses distinct children for different wallets and never reuses hot-wallet child zero', async () => {
    const first = await deriveRecoverableMobileKeyPublic(RECOVERY_KEY, 0);
    const next = await deriveRecoverableMobileKeyPublic(RECOVERY_KEY, 1);
    const hotEntropy = await BIP85.bip39MnemonicToEntropy(
      "m/83696968'/39'/0'/12'/0'",
      RECOVERY_KEY
    );
    const hotMnemonic = BIP85.entropyToBIP39(hotEntropy, 12);
    const hotSeed = await bip39.mnemonicToSeed(hotMnemonic);
    const hotSigner = bip32
      .fromSeed(hotSeed, bitcoinJS.networks.testnet)
      .derivePath(RECOVERABLE_MOBILE_KEY_SIGNER_PATH)
      .neutered()
      .toBase58();

    expect(next.bip85Index).toBe(first.bip85Index + 1);
    expect(next.xpub).not.toBe(first.xpub);
    expect(first.xpub).not.toBe(hotSigner);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, RECOVERABLE_MOBILE_KEY_MAX_ORDINAL + 1])(
    'rejects invalid ordinal %s',
    async (ordinal) => {
      await expect(deriveRecoverableMobileKeyPublic(RECOVERY_KEY, ordinal)).rejects.toThrow(
        'Invalid Recoverable Wallet ordinal'
      );
    }
  );

  it('rejects an invalid or non-12-word Recovery Key', async () => {
    await expect(deriveRecoverableMobileKeyPublic('abandon'.repeat(12), 0)).rejects.toThrow(
      'A valid 12-word Keeper Recovery Key is required'
    );
    await expect(
      deriveRecoverableMobileKeyPublic(`${RECOVERY_KEY} ${RECOVERY_KEY}`, 0)
    ).rejects.toThrow('A valid 12-word Keeper Recovery Key is required');
  });
});
