import * as bip39 from 'bip39';
import { hash256 } from 'src/utils/service-utilities/encryption';
import config, { APP_STAGE } from 'src/utils/service-utilities/config';
import idx from 'idx';
import { getAccountFromSigner } from 'src/utils/utilities';
import {
  DerivationPurpose,
  EntityKind,
  MiniscriptTypes,
  MultisigScriptType,
  NetworkType,
  ScriptTypes,
  SignerType,
  VaultType,
  VisibilityType,
} from '../enums';
import {
  MiniscriptElements,
  MiniscriptScheme,
  Signer,
  Vault,
  VaultPresentationData,
  VaultScheme,
  VaultSigner,
  VaultSpecs,
} from '../interfaces/vault';

import WalletUtilities from '../operations/utils';
import WalletOperations from '../operations';
import { generateMiniscript } from '../operations/miniscript/miniscript';
import { generateMiniscriptPolicy } from '../operations/miniscript/policy-generator';

// *TODO: Remove this and update the generateVaultId function
const STANDARD_VAULT_SCHEME = [
  { m: 1, n: 1 },
  { m: 2, n: 3 },
  { m: 3, n: 5 },
];

export const generateVaultId = (signers: VaultSigner[], scheme: VaultScheme) => {
  const xpubs = signers.map((signer) => signer.xpub).sort();
  const xpubMap = {};
  signers.forEach((signer) => {
    xpubMap[signer.xpub] = signer;
  });
  const fingerprints = xpubs.map((xpub) => {
    const signer = xpubMap[xpub];
    return signer.xfp;
  });

  if (scheme.multisigScriptType === MultisigScriptType.MINISCRIPT_MULTISIG) {
    fingerprints.push(JSON.stringify(scheme));
  } else {
    STANDARD_VAULT_SCHEME.forEach((s) => {
      if (s.m !== scheme.m || s.n !== scheme.n) {
        fingerprints.push(JSON.stringify(scheme));
      }
    });
  }

  const hashedFingerprints = hash256(fingerprints.join(''));
  const id = hashedFingerprints.slice(hashedFingerprints.length - fingerprints[0].length);
  return id;
};

export const generateVault = async ({
  type,
  vaultName,
  vaultDescription,
  scheme,
  signers,
  networkType,
}: {
  type: VaultType;
  vaultName: string;
  vaultDescription: string;
  scheme: VaultScheme;
  signers: VaultSigner[];
  networkType: NetworkType;
}): Promise<Vault> => {
  const id = generateVaultId(signers, scheme);
  const xpubs = signers.map((signer) => signer.xpub);

  if (scheme.multisigScriptType === MultisigScriptType.MINISCRIPT_MULTISIG) {
    if (!scheme.miniscriptScheme) throw new Error('Input missing: miniscriptScheme');
  } else {
    if (scheme.m > scheme.n) throw new Error(`scheme error: m:${scheme.m} > n:${scheme.n}`);
  }

  const isMultiSig = scheme.n !== 1 || type === VaultType.MINISCRIPT; // single key Vault is BIP-84 P2WPKH single-sig and not 1-of-1 BIP-48 P2WSH multi-sig
  const scriptType = isMultiSig ? ScriptTypes.P2WSH : ScriptTypes.P2WPKH;

  // Safety check, must use correct derivations:
  signers.map((signer) => {
    const accountNumber = getAccountFromSigner(signer);
    const expectedDerivationPath = isMultiSig
      ? networkType === NetworkType.MAINNET
        ? `m/48'/0'/${accountNumber}'/2'`
        : `m/48'/1'/${accountNumber}'/2'`
      : networkType === NetworkType.MAINNET
      ? `m/84'/0'/${accountNumber}'`
      : `m/84'/1'/${accountNumber}'`;

    if (expectedDerivationPath !== signer.derivationPath) {
      throw new Error(
        `Invalid derivation path for signer. Expected: ${expectedDerivationPath}, but got: ${signer.derivationPath}`
      );
    }
  });

  const presentationData: VaultPresentationData = {
    name: vaultName,
    description: vaultDescription,
    visibility: VisibilityType.DEFAULT,
  };

  const specs: VaultSpecs = {
    xpubs,
    nextFreeAddressIndex: 0,
    nextFreeChangeAddressIndex: 0,
    totalExternalAddresses: 1,
    confirmedUTXOs: [],
    unconfirmedUTXOs: [],
    balances: {
      confirmed: 0,
      unconfirmed: 0,
    },
    transactions: [],
    hasNewUpdates: false,
    lastSynched: 0,
  };

  const vault: Vault = {
    id,
    entityKind: EntityKind.VAULT,
    type,
    networkType,
    isMultiSig,
    scheme,
    signers,
    presentationData,
    specs,
    archived: false,
    isMigrating: false,
    scriptType,
  };
  vault.specs.receivingAddress = WalletOperations.getNextFreeAddress(vault);

  return vault;
};

export const generateMobileKey = async (
  primaryMnemonic: string,
  networkType: NetworkType,
  isMultisig: boolean
): Promise<{
  xpub: string;
  xpriv: string;
  derivationPath: string;
  masterFingerprint: string;
}> => {
  const seed = bip39.mnemonicToSeedSync(primaryMnemonic);
  const masterFingerprint = WalletUtilities.getFingerprintFromSeed(seed);

  const DEFAULT_CHILD_PATH = 0;
  const xDerivationPath = WalletUtilities.getDerivationPath(
    isMultisig,
    networkType,
    DEFAULT_CHILD_PATH
  );

  const network = WalletUtilities.getNetworkByType(networkType);
  const extendedKeys = WalletUtilities.generateExtendedKeyPairFromSeed(
    seed.toString('hex'),
    network,
    xDerivationPath
  );

  return {
    xpub: extendedKeys.xpub,
    xpriv: extendedKeys.xpriv,
    derivationPath: xDerivationPath,
    masterFingerprint,
  };
};

export const generateSeedWordsKey = (
  mnemonic: string,
  networkType: NetworkType,
  isMultisig: boolean,
  isTaproot: boolean = false
): {
  xpub: string;
  xpriv: string;
  derivationPath: string;
  masterFingerprint: string;
} => {
  const isValid = bip39.validateMnemonic(mnemonic);
  if (!isValid) throw new Error('Invalid Mnemonic');

  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const masterFingerprint = WalletUtilities.getFingerprintFromSeed(seed);

  const DEFAULT_CHILD_PATH = 0;
  const xDerivationPath = WalletUtilities.getDerivationPath(
    isMultisig,
    networkType,
    DEFAULT_CHILD_PATH,
    isTaproot ? DerivationPurpose.BIP86 : DerivationPurpose.BIP84
  );

  const network = WalletUtilities.getNetworkByType(networkType);
  const extendedKeys = WalletUtilities.generateExtendedKeyPairFromSeed(
    seed.toString('hex'),
    network,
    xDerivationPath
  );
  return {
    xpub: extendedKeys.xpub,
    xpriv: extendedKeys.xpriv,
    derivationPath: xDerivationPath,
    masterFingerprint,
  };
};

export const MOCK_SD_MNEMONIC_MAP = {
  [SignerType.TAPSIGNER]:
    'result pink oyster iron journey social winter pattern cricket core leader behave',
  [SignerType.SATOCHIP]:
    'frozen myself eternal matter attract frost slogan buffalo liberty another private twelve',
  [SignerType.COLDCARD]:
    'keen credit hold warfare nasty address poverty roast novel ranch system nasty',
  [SignerType.LEDGER]:
    'hold address journey ranch result poverty cricket keen system core iron winter',
  [SignerType.JADE]:
    'galaxy wealth badge cloud educate inquiry member timber shaft promote symptom sting',
  [SignerType.KEYSTONE]:
    'congress judge talent affair client lift dash canal utility among spin tube',
  [SignerType.SEEDSIGNER]:
    'rug shrug rebuild name normal way scrub permit keen enable sorry episode',
  [SignerType.PASSPORT]:
    'grass journey few toilet rhythm day provide decline position weapon pave monitor',
  [SignerType.TREZOR]:
    'equal gospel mirror humor early liberty finger breeze super celery invite proof',
  [SignerType.BITBOX02]:
    'journey gospel position invite winter pattern inquiry scrub sorry early enable badge',
  [SignerType.SPECTER]:
    'journey invite inquiry day among poverty inquiry affair keen pave nasty position',
  [SignerType.PORTAL]: 'spring input elevator wire people floor scan weird weekend belt hip lava',
  [SignerType.KRUX]:
    'december punch famous wool oak remember quarter suspect violin sock invite round',
};

export const generateMockExtendedKeyForSigner = (
  isMultisig: boolean,
  signer: SignerType,
  networkType = NetworkType.TESTNET
) => {
  if (config.ENVIRONMENT !== APP_STAGE.DEVELOPMENT) {
    throw new Error('Mock key not allowed in production app');
  }
  const mockMnemonic = MOCK_SD_MNEMONIC_MAP[signer];
  if (!mockMnemonic) {
    throw new Error("We don't support mock flow for soft keys");
  }
  const seed = bip39.mnemonicToSeedSync(mockMnemonic);
  const masterFingerprint = WalletUtilities.getFingerprintFromSeed(seed);
  const xDerivationPath = WalletUtilities.getDerivationPath(isMultisig, networkType, 123);
  const network = WalletUtilities.getNetworkByType(networkType);
  const extendedKeys = WalletUtilities.generateExtendedKeyPairFromSeed(
    seed.toString('hex'),
    network,
    xDerivationPath
  );
  return { ...extendedKeys, derivationPath: xDerivationPath, masterFingerprint };
};

export const generateMiniscriptScheme = (
  miniscriptElements: MiniscriptElements,
  miniscriptTypes: MiniscriptTypes[],
  existingMiniscriptScheme?: MiniscriptScheme,
  importedKeyUsageCounts?: Record<string, number>
): MiniscriptScheme => {
  const {
    miniscriptPhases,
    policy: miniscriptPolicy,
    keyInfoMap,
  } = generateMiniscriptPolicy(
    miniscriptElements,
    existingMiniscriptScheme,
    importedKeyUsageCounts
  );

  const { miniscript } = generateMiniscript(miniscriptPolicy);
  const miniscriptScheme: MiniscriptScheme = {
    miniscriptElements: {
      ...miniscriptElements,
      phases: miniscriptPhases, // w/ unique key identifiers
    },
    keyInfoMap,
    miniscriptPolicy,
    miniscript,
    usedMiniscriptTypes: miniscriptTypes,
  };

  return miniscriptScheme;
};

export const getAvailableMiniscriptPhase = (
  vault: Vault,
  currentBlockHeightOrTimestamp: number
) => {
  const miniscriptScheme = idx(vault, (_) => _.scheme.miniscriptScheme);
  if (!miniscriptScheme) return {};

  const { miniscriptElements } = miniscriptScheme;
  const { signerFingerprints, phases } = miniscriptElements;

  const availablePhases = [];
  const availableSignerFingerprints = {};

  for (const phase of phases) {
    if (phase.timelock <= currentBlockHeightOrTimestamp) {
      availablePhases.push(phase);
      phase.paths.forEach((path) => {
        path.keys.forEach((key) => {
          availableSignerFingerprints[key.identifier] = signerFingerprints[key.identifier];
        });
      });
    }
  }

  const availableSigners = {};
  for (const [id, fingerprint] of Object.entries(availableSignerFingerprints)) {
    const signer = vault.signers.find((s) => s.masterFingerprint === fingerprint);
    if (signer) availableSigners[id] = signer;
  }

  return {
    phases: availablePhases,
    signers: availableSigners,
  };
};

export const getBlockHeightOrTimestampForVault = (
  vault: Vault,
  currentBlockHeight: number,
  currentTimestamp: number
): number | null => {
  const miniscriptScheme = idx(vault, (_) => _.scheme.miniscriptScheme);
  if (!miniscriptScheme) return null;

  const { miniscriptElements } = miniscriptScheme;
  if (miniscriptElements?.timelocks && miniscriptElements?.timelocks?.length) {
    if (miniscriptElements?.timelocks[0] < 500000000) {
      return currentBlockHeight;
    } else {
      return currentTimestamp;
    }
  } else {
    return null;
  }
};

export const isVaultUsingBlockHeightTimelock = (vault: Vault): boolean | null => {
  const miniscriptScheme = idx(vault, (_) => _.scheme.miniscriptScheme);
  if (!miniscriptScheme) return null;

  const { miniscriptElements } = miniscriptScheme;
  if (miniscriptElements?.timelocks && miniscriptElements?.timelocks?.length) {
    if (miniscriptElements?.timelocks[0] < 500000000) {
      return true;
    } else {
      return false;
    }
  } else {
    return null;
  }
};
