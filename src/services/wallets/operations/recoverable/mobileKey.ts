import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import * as bitcoinJS from 'bitcoinjs-lib';
import BIP85 from '../BIP85';
import ecc from '../taproot-utils/noble_ecc';
import {
  RECOVERABLE_MOBILE_KEY_INDEX_START,
  RECOVERABLE_MOBILE_KEY_MAX_ORDINAL,
  RECOVERABLE_MOBILE_KEY_VERSION,
  RECOVERABLE_MOBILE_KEY_SIGNER_PATH,
} from './mobileKeyConstants';

export {
  RECOVERABLE_MOBILE_KEY_INDEX_START,
  RECOVERABLE_MOBILE_KEY_MAX_ORDINAL,
  RECOVERABLE_MOBILE_KEY_VERSION,
  RECOVERABLE_MOBILE_KEY_SIGNER_PATH,
} from './mobileKeyConstants';

const bip32 = BIP32Factory(ecc);

export interface RecoverableMobileKeyPublic {
  version: typeof RECOVERABLE_MOBILE_KEY_VERSION;
  ordinal: number;
  bip85Index: number;
  bip85Path: string;
  signerPath: typeof RECOVERABLE_MOBILE_KEY_SIGNER_PATH;
  network: 'testnet';
  masterFingerprint: string;
  xpub: string;
}

/** Derive public signer details without returning or persisting the child words/private key. */
export const deriveRecoverableMobileKeyPublic = async (
  recoveryKey: string,
  ordinal: number
): Promise<RecoverableMobileKeyPublic> => {
  if (
    !Number.isSafeInteger(ordinal) ||
    ordinal < 0 ||
    ordinal > RECOVERABLE_MOBILE_KEY_MAX_ORDINAL
  ) {
    throw new Error('Invalid Recoverable Wallet ordinal');
  }

  const normalizedRecoveryKey =
    typeof recoveryKey === 'string'
      ? recoveryKey.normalize('NFKD').trim().replace(/\s+/g, ' ').toLowerCase()
      : '';
  if (
    normalizedRecoveryKey.split(' ').length !== 12 ||
    !bip39.validateMnemonic(normalizedRecoveryKey)
  ) {
    throw new Error('A valid 12-word Keeper Recovery Key is required');
  }

  const bip85Index = RECOVERABLE_MOBILE_KEY_INDEX_START + ordinal;
  const bip85Path = `m/83696968'/39'/0'/12'/${bip85Index}'`;
  const entropy = await BIP85.bip39MnemonicToEntropy(bip85Path, normalizedRecoveryKey);
  const childMnemonic = BIP85.entropyToBIP39(entropy, 12);
  const childSeed = await bip39.mnemonicToSeed(childMnemonic);
  const root = bip32.fromSeed(childSeed, bitcoinJS.networks.testnet);
  const signer = root.derivePath(RECOVERABLE_MOBILE_KEY_SIGNER_PATH);

  return {
    version: RECOVERABLE_MOBILE_KEY_VERSION,
    ordinal,
    bip85Index,
    bip85Path,
    signerPath: RECOVERABLE_MOBILE_KEY_SIGNER_PATH,
    network: 'testnet',
    masterFingerprint: root.fingerprint.toString('hex').toUpperCase(),
    xpub: signer.neutered().toBase58(),
  };
};
