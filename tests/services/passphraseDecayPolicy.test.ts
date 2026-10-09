import * as bip39 from 'bip39';
import {
  generateSeedWordsKey,
  generateMiniscriptScheme,
} from 'src/services/wallets/factories/VaultFactory';
import { MiniscriptTypes, NetworkType } from 'src/services/wallets/enums';
import {
  ENHANCED_VAULT_TIMELOCKS_TIMESTAMP_MAINNET,
  generateEnhancedVaultElements,
} from 'src/services/wallets/operations/miniscript/default/EnhancedVault';
import WalletUtilities from 'src/services/wallets/operations/utils';

jest.mock('src/store/store', () => ({
  store: { getState: () => ({ settings: { bitcoinNetworkType: 'MAINNET' } }) },
}));
jest.mock('src/utils/utilities', () => ({
  getKeyUID: (signer) => signer.masterFingerprint,
}));
jest.mock('src/utils/service-utilities/utils', () => ({
  getDerivationPath: (path) => path.replace('m/', ''),
}));

const mnemonic = bip39.entropyToMnemonic('00000000000000000000000000000000');
const networkType = NetworkType.MAINNET;
const network = WalletUtilities.getNetworkByType(networkType);
const derivationPath = WalletUtilities.getDerivationPath(true, networkType);

const externalSigner = (passphrase: string) => {
  const masterFingerprint = WalletUtilities.getMasterFingerprintFromMnemonic(mnemonic, passphrase);
  return {
    masterFingerprint,
    xfp: masterFingerprint,
    derivationPath,
    xpub: WalletUtilities.generateExtendedKey(
      mnemonic,
      false,
      network,
      derivationPath,
      passphrase
    ),
  };
};

describe('Disposable passphrase and absolute-lock policy fixture', () => {
  it('derives distinct signer keys from the same public test words with and without a passphrase', () => {
    const primary = externalSigner('TREZOR');
    const inheritance = externalSigner('');
    const inAppSeedWordsKey = generateSeedWordsKey(mnemonic, networkType, true);

    expect(primary.masterFingerprint).not.toBe(inheritance.masterFingerprint);
    expect(primary.xpub).not.toBe(inheritance.xpub);
    expect(inAppSeedWordsKey.xpub).toBe(inheritance.xpub);
    expect(inAppSeedWordsKey.xpub).not.toBe(primary.xpub);
  });

  it('compiles a one-key inheritance branch at one fixed six-month mainnet timestamp', () => {
    const primary = externalSigner('TREZOR');
    const inheritance = externalSigner('');
    const fixedStart = 1800000000;
    // Production's MONTHS_6 is a fixed 180-day interval; Testnet uses a shorter fixture interval.
    expect(ENHANCED_VAULT_TIMELOCKS_TIMESTAMP_MAINNET.MONTHS_6).toBe(180 * 24 * 60 * 60);
    const absoluteUnlock = fixedStart + ENHANCED_VAULT_TIMELOCKS_TIMESTAMP_MAINNET.MONTHS_6;
    const elements = generateEnhancedVaultElements(
      [primary],
      [{ signer: inheritance, timelock: absoluteUnlock }],
      [],
      { m: 1, n: 1 },
      0
    );
    const scheme = generateMiniscriptScheme(elements, [MiniscriptTypes.INHERITANCE]);

    expect(scheme.miniscriptPolicy).toContain(`after(${absoluteUnlock})`);
    expect(scheme.miniscriptPolicy).toContain('pk(IK1');
    expect(scheme.miniscriptPolicy).toContain('pk(K1');
    expect(scheme.miniscript).toBeTruthy();
    expect(scheme.miniscriptElements.timelocks).toEqual([absoluteUnlock]);
    expect(Object.values(scheme.keyInfoMap)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${primary.xpub}/<`),
        expect.stringContaining(`${inheritance.xpub}/<`),
      ])
    );
    expect(Object.values(scheme.keyInfoMap).every((key) => key.endsWith('/*'))).toBe(true);
  });
});
