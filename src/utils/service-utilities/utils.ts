import idx from 'idx';
import { DescriptorChecksum } from 'src/services/wallets/operations/descriptors/checksum';
import { EntityKind, MiniscriptTypes, MultisigScriptType } from '../../services/wallets/enums';
import {
  MiniscriptElements,
  Vault,
  VaultScheme,
  VaultSigner,
} from '../../services/wallets/interfaces/vault';
import { Wallet } from '../../services/wallets/interfaces/wallet';
import WalletOperations from '../../services/wallets/operations';
import WalletUtilities from 'src/services/wallets/operations/utils';
import config from './config';
import { generateMiniscriptScheme } from 'src/services/wallets/factories/VaultFactory';
import { isOdd } from '../utilities';
import { generateEnhancedVaultElements } from 'src/services/wallets/operations/miniscript/default/EnhancedVault';
import { store } from 'src/store/store';

const crypto = require('crypto');

export const getDerivationPath = (derivationPath: string) =>
  derivationPath.substring(2).split("'").join('h');

export const getMultiKeyExpressions = (
  signers: VaultSigner[],
  withPathRestrictions: boolean = true,
  nextFreeAddressIndex?: number,
  forDescriptor: boolean = false,
  abbreviated: boolean = false
) => {
  const keyExpressions = signers.map((signer: VaultSigner) =>
    getKeyExpression(
      signer.masterFingerprint,
      signer.derivationPath,
      signer.xpub,
      withPathRestrictions,
      nextFreeAddressIndex,
      forDescriptor,
      abbreviated
    )
  );
  return keyExpressions.join();
};

export const getKeyExpression = (
  masterFingerprint: string,
  derivationPath: string,
  xpub: string,
  withPathRestrictions: boolean = false,
  nextFreeAddressIndex?: number,
  forDescriptor: boolean = false,
  abbreviated: boolean = false
) => {
  if (nextFreeAddressIndex != undefined) {
    return `[${masterFingerprint}/${getDerivationPath(
      derivationPath
    )}]${xpub}/0/${nextFreeAddressIndex}`;
  } else if (abbreviated) return `[${masterFingerprint}/${getDerivationPath(derivationPath)}]`;
  else {
    return `[${masterFingerprint}/${getDerivationPath(derivationPath)}]${xpub}${
      withPathRestrictions ? '/**' : forDescriptor ? '/<0;1>/*' : ''
    }`;
  }
};

export const generateAbbreviatedOutputDescriptors = (wallet: Vault | Wallet) => {
  if (wallet.entityKind === EntityKind.WALLET) {
    const {
      derivationDetails: { xDerivationPath },
      specs: { xpub },
    } = wallet as Wallet;
    const des = `wpkh(${getKeyExpression(
      wallet.id,
      xDerivationPath,
      xpub,
      false,
      undefined,
      false,
      true
    )})`;
    return des;
  } else if (wallet.entityKind === EntityKind.VAULT) {
    const miniscriptScheme = idx(wallet as Vault, (_) => _.scheme.miniscriptScheme);
    if (miniscriptScheme) {
      const { miniscript, keyInfoMap } = miniscriptScheme;
      let walletPolicyDescriptor = miniscript;
      for (const keyId in keyInfoMap) {
        walletPolicyDescriptor = walletPolicyDescriptor.replace(
          `(${keyId}`,
          `(${keyInfoMap[keyId]}`
        );
        walletPolicyDescriptor = walletPolicyDescriptor.replace(
          `,${keyId}`,
          `,${keyInfoMap[keyId]}`
        );
      }
      const desc = `wsh(${walletPolicyDescriptor})`;
      return `${desc}#${DescriptorChecksum(desc)}`;
    }

    const { signers, scheme, isMultiSig } = wallet as Vault;
    if (isMultiSig) {
      return `wsh(sortedmulti(${scheme.m},${getMultiKeyExpressions(
        signers,
        false,
        undefined,
        false,
        true
      )}))`;
    } else {
      const signer: VaultSigner = signers[0];

      const des = `wpkh(${getKeyExpression(
        signer.masterFingerprint,
        signer.derivationPath,
        signer.xpub,
        false,
        undefined,
        false,
        true
      )})`;
      return des;
    }
  }
  throw Error('Unsupported wallet type');
};

export const generateOutputDescriptors = (
  wallet: Vault | Wallet,
  includePatchRestrictions: boolean = false,
  includeChecksum: boolean = true
) => {
  const receivingAddress = WalletOperations.getExternalInternalAddressAtIdx(wallet, 0);
  if (wallet.entityKind === EntityKind.WALLET) {
    const {
      derivationDetails: { xDerivationPath },
      specs: { xpub },
    } = wallet as Wallet;
    const desc = `wpkh(${getKeyExpression(
      wallet.id,
      xDerivationPath,
      xpub,
      includePatchRestrictions,
      undefined,
      true
    )})${includePatchRestrictions ? `\n/0/*,/1/*\n${receivingAddress}` : ''}`;
    return includeChecksum ? `${desc}#${DescriptorChecksum(desc)}` : desc;
  } else if (wallet.entityKind === EntityKind.VAULT) {
    const miniscriptScheme = idx(wallet as Vault, (_) => _.scheme.miniscriptScheme);
    if (miniscriptScheme) {
      const { miniscript, keyInfoMap } = miniscriptScheme;
      let walletPolicyDescriptor = miniscript;
      for (const keyId in keyInfoMap) {
        walletPolicyDescriptor = walletPolicyDescriptor.replace(
          `(${keyId}`,
          `(${keyInfoMap[keyId]}`
        );
        walletPolicyDescriptor = walletPolicyDescriptor.replace(
          `,${keyId}`,
          `,${keyInfoMap[keyId]}`
        );
      }
      const desc = `wsh(${walletPolicyDescriptor})`;
      return includeChecksum ? `${desc}#${DescriptorChecksum(desc)}` : desc;
    }

    const { signers, scheme, isMultiSig } = wallet as Vault;
    if (isMultiSig) {
      const desc = `wsh(sortedmulti(${scheme.m},${getMultiKeyExpressions(
        signers,
        includePatchRestrictions,
        undefined,
        true
      )}))${includePatchRestrictions ? `\n/0/*,/1/*\n${receivingAddress}` : ''}`;
      return includeChecksum ? `${desc}#${DescriptorChecksum(desc)}` : desc;
    } else {
      const signer: VaultSigner = signers[0];

      const desc = `wpkh(${getKeyExpression(
        signer.masterFingerprint,
        signer.derivationPath,
        signer.xpub,
        includePatchRestrictions,
        undefined,
        true
      )})${includePatchRestrictions ? `\n/0/*,/1/*\n${receivingAddress}` : ''}`;
      return includeChecksum ? `${desc}#${DescriptorChecksum(desc)}` : desc;
    }
  }
};

export const generateVaultAddressDescriptors = (wallet: Vault | Wallet, addressIndex: number) => {
  const receivingAddress = WalletOperations.getExternalInternalAddressAtIdx(
    wallet,
    addressIndex,
    false
  );

  if (wallet.entityKind === EntityKind.WALLET) {
    const {
      derivationDetails: { xDerivationPath },
      specs: { xpub },
    } = wallet as Wallet;
    const des = `wpkh(${getKeyExpression(wallet.id, xDerivationPath, xpub, true, addressIndex)})`;
    return {
      descriptorString: des,
      receivingAddress,
    };
  }
  const { signers, scheme, isMultiSig } = wallet as Vault;
  if (!isMultiSig) {
    const signer: VaultSigner = signers[0];
    const des = `wpkh(${getKeyExpression(
      signer.masterFingerprint,
      signer.derivationPath,
      signer.xpub,
      true,
      addressIndex
    )})`;
    return {
      descriptorString: des,
      receivingAddress,
    };
  }

  return {
    descriptorString: `wsh(sortedmulti(${scheme.m},${getMultiKeyExpressions(
      signers,
      true,
      addressIndex
    )}))`,
    receivingAddress,
  };
};

// PASRER
export interface ParsedSignersDetails {
  xpub: String;
  masterFingerprint: String;
  path: String;
  isMultisig: Boolean;
}

export interface ParsedVauleText {
  signersDetails: ParsedSignersDetails[] | null;
  isMultisig: Boolean | null;
  scheme: VaultScheme;
  miniscriptElements?: MiniscriptElements;
}

const isAllowedScheme = (m, n) => {
  return m <= n;
};

function removeEmptyLines(data) {
  const lines = data.split('\n');
  const nonEmptyLines = lines.filter((line) => line.trim() !== '');
  const output = nonEmptyLines.join('\n');
  return output;
}

function isValidMasterFingerprint(masterFingerprint) {
  return /^[0-9a-fA-F]{8}$/.test(masterFingerprint);
}

function isValidDerivationPath(derivationPath) {
  return /^m(\/\d+'?)+$/.test(derivationPath);
}

function isValidXpub(xpub) {
  return typeof xpub === 'string' && xpub.length > 4;
}

const parseKeyExpression = (keyExpression) => {
  let masterFingerprint = '';
  let path = '';
  let xpub = '';

  // Case 1: If the keyExpression is enclosed in square brackets
  const bracketMatch = keyExpression.match(/\[([^\]]+)\](.*)/);
  if (bracketMatch) {
    const insideBracket = bracketMatch[1];
    masterFingerprint = insideBracket.substring(0, 8).toUpperCase();
    path = `m${insideBracket
      .substring(8)
      .replace(/(\d+)h/g, "$1'")
      .replace(/'/g, "'")}`;
    xpub = bracketMatch[2].replace(/[^\w\s]+$/, '').split(/[^\w]+/)[0];
  } else {
    // Case 2: If the keyExpression is not enclosed in square brackets
    const parts = keyExpression.split("'");
    masterFingerprint = parts[0].substring(0, 8).toUpperCase();
    path = `m${keyExpression.substring(8, keyExpression.lastIndexOf("'") + 1).replace(/'/g, "'")}`;
    xpub = keyExpression
      .substring(keyExpression.lastIndexOf("'") + 1)
      .replace(/[^\w\s]+$/, '')
      .split(/[^\w]+/)[0];
  }
  if (
    !isValidMasterFingerprint(masterFingerprint) ||
    !isValidDerivationPath(path) ||
    !isValidXpub(xpub)
  ) {
    return null; // At least one of the fields is invalid
  }

  return { masterFingerprint, path, xpub };
};

export const parseTextforVaultConfig = (secret: string) => {
  let config;
  if (secret.includes('wpkh(')) {
    config = { descriptor: secret, label: 'Singlesig vault' };

    const descriptorIndex = config.descriptor.indexOf('wpkh(');
    const hasSquareBrackets = config.descriptor[descriptorIndex + 3] === '[';
    const start = descriptorIndex + (hasSquareBrackets ? 6 : 5);
    const keyExpressions = config.descriptor
      .substring(start)
      .split(',')
      .map((expression) => expression.trim());

    const signersDetailsList = keyExpressions.map((expression) => parseKeyExpression(expression));
    const parsedResponse: ParsedVauleText = {
      signersDetails: signersDetailsList,
      isMultisig: false,
      scheme: {
        m: 1,
        n: 1,
      },
    };
    return parsedResponse;
  }
  if (!config && secret.includes('sortedmulti(')) {
    config = { descriptor: secret, label: 'Multisig vault' };
  }
  if (secret.indexOf('sortedmulti(') !== -1 && config.descriptor) {
    if (config.descriptor.includes('sh(wsh(')) {
      throw Error('Unsuportted Script type');
    }

    const descriptorIndex = config.descriptor.indexOf('sortedmulti(');
    const hasSquareBrackets = config.descriptor[descriptorIndex + 10] === '[';
    const start = descriptorIndex + (hasSquareBrackets ? 13 : 12);
    const keyExpressions = config.descriptor
      .substring(start)
      .split(',')
      .map((expression) => expression.trim());

    const signersDetailsList = keyExpressions
      .map((expression) => parseKeyExpression(expression))
      .filter((details) => details !== null);

    const m = parseInt(keyExpressions.splice(0, 1)[0]);
    const n = signersDetailsList.length;
    if (!isAllowedScheme(m, n)) {
      throw Error('Unsupported schemes');
    }
    const scheme: VaultScheme = {
      m,
      n,
    };

    const parsedResponse: ParsedVauleText = {
      signersDetails: signersDetailsList,
      isMultisig: true,
      scheme,
    };
    return parsedResponse;
  }
  if (secret.includes('Derivation')) {
    const text = removeEmptyLines(secret);
    const lines = text.split('\n');
    const signersDetailsList = [];
    let scheme;
    let derivationPath;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('Policy')) {
        const [m, n] = line.split('Policy:')[1].split('of');
        scheme = { m: parseInt(m), n: parseInt(n) };
        if (!isAllowedScheme(scheme.m, scheme.n)) {
          throw Error('Unsupported scheme');
        }
      }
      if (line.startsWith('Derivation:')) {
        derivationPath = line.split(':')[1].trim();
      }
      if (!['Name', 'Policy', 'Format', 'Derivation', '#'].some((kw) => line.startsWith(kw))) {
        const [masterFingerprint, xpub] = line.split(':');
        signersDetailsList.push({
          xpub: xpub.trim(),
          masterFingerprint: masterFingerprint.toUpperCase().trim(),
          path: derivationPath,
        });
      }
    }

    const parsedResponse: ParsedVauleText = {
      signersDetails: signersDetailsList,
      isMultisig: scheme.n !== 1,
      scheme,
    };
    return parsedResponse;
  }
  if (secret.includes('after(')) {
    const { signers, inheritanceKeys, emergencyKeys, importedKeyUsageCounts, initialTimelock } =
      parseEnhancedVaultMiniscript(secret);
    const multiMatch = secret.match(/(thresh|multi)\((\d+),/);
    const m = multiMatch ? parseInt(multiMatch[2]) : 1;

    const miniscriptElements = generateEnhancedVaultElements(
      signers,
      inheritanceKeys,
      emergencyKeys,
      { m, n: signers.length },
      initialTimelock
    );

    const miniscriptScheme = generateMiniscriptScheme(
      miniscriptElements,
      inheritanceKeys.length || emergencyKeys.length || initialTimelock
        ? [
            ...(inheritanceKeys.length ? [MiniscriptTypes.INHERITANCE] : []),
            ...(emergencyKeys.length ? [MiniscriptTypes.EMERGENCY] : []),
            ...(initialTimelock ? [MiniscriptTypes.TIMELOCKED] : []),
          ]
        : [],
      null,
      importedKeyUsageCounts
    );

    // Verify the miniscript generated matches the input
    const { miniscript, keyInfoMap } = miniscriptScheme;
    let walletPolicyDescriptor = miniscript;
    for (const keyId in keyInfoMap) {
      walletPolicyDescriptor = walletPolicyDescriptor.replace(`(${keyId}`, `(${keyInfoMap[keyId]}`);
      walletPolicyDescriptor = walletPolicyDescriptor.replace(`,${keyId}`, `,${keyInfoMap[keyId]}`);
    }
    const desc = `wsh(${walletPolicyDescriptor})`;
    if (secret.includes('#')) {
      secret = secret.replace(/#.*$/, '');
    }
    if (desc !== secret) {
      throw Error('Unsupported Miniscript configuration detected!');
    }

    const parsedResponse: ParsedVauleText = {
      signersDetails: [
        ...signers,
        ...inheritanceKeys.map((ik) => ik.signer),
        ...emergencyKeys
          .filter(
            (ek) => !signers.map((s) => s.masterFingerprint).includes(ek.signer.masterFingerprint)
          )
          .map((ek) => ek.signer),
      ]
        .filter(Boolean)
        .map((key) => ({
          xpub: key.xpub,
          masterFingerprint: key.masterFingerprint,
          path: key.derivationPath,
          isMultisig: true,
        })),
      isMultisig: true,
      scheme: {
        m,
        n: signers.length,
        multisigScriptType: MultisigScriptType.MINISCRIPT_MULTISIG,
        miniscriptScheme,
      },
      miniscriptElements,
    };
    return parsedResponse;
  }
  throw Error('Data provided does not match supported formats');
};

function extractStagesWithAfter(script: string): { stage: string; afterValue: number }[] {
  const stagePattern = /and_v\((.*?),after\((\d+)\)\)/g;
  const matches = [...script.matchAll(stagePattern)];

  const stages = matches.map((match) => ({
    stage: match[1].trim(),
    afterValue: parseInt(match[2], 10),
  }));

  // Sort stages by afterValue in ascending order
  return stages.sort((a, b) => a.afterValue - b.afterValue);
}

function categorizeKeys(
  stages: { stage: string; afterValue: number }[],
  uniqueKeys: VaultSigner[],
  regularKeysFingerprints: string[],
  isOnlyInheritanceKeys: boolean
) {
  const keyRegex = /\[([A-F0-9]{8})[^\]]*\]/g;
  const emergencyPattern = /v:pkh\(\[([A-F0-9]{8})[^\]]*\]/g;

  let inheritanceKeys: { signer: VaultSigner; timelock: number }[] = [];
  let emergencyKeys: { signer: VaultSigner; timelock: number }[] = [];

  const processedInheritanceKeys = new Set<string>();

  stages.forEach(({ stage, afterValue }) => {
    const stageKeys = [...stage.matchAll(keyRegex)].map((match) => match[1]);
    const emergencyKeysInStage = [...stage.matchAll(emergencyPattern)].map((match) => match[1]);

    stageKeys.forEach((fingerprint) => {
      const isEmergency = emergencyKeysInStage.includes(fingerprint);
      const isRegular = regularKeysFingerprints.some((fp) => fp === fingerprint);
      const isAlreadyProcessed = processedInheritanceKeys.has(fingerprint);

      if (isEmergency) {
        const signer = uniqueKeys.find((key) => key.masterFingerprint === fingerprint);
        if (signer) {
          if (isOnlyInheritanceKeys) {
            inheritanceKeys.push({ signer, timelock: afterValue });
          } else {
            emergencyKeys.push({ signer, timelock: afterValue });
          }
        }
      } else if (!isRegular && !isAlreadyProcessed) {
        const signer = uniqueKeys.find((key) => key.masterFingerprint === fingerprint);
        if (signer) {
          inheritanceKeys.push({ signer, timelock: afterValue });
          processedInheritanceKeys.add(fingerprint);
        }
      }
    });
  });

  return { inheritanceKeys, emergencyKeys };
}

function parseEnhancedVaultMiniscript(miniscript: string): {
  signers: VaultSigner[];
  inheritanceKeys: { signer: VaultSigner; timelock: number }[];
  emergencyKeys: { signer: VaultSigner; timelock: number }[];
  importedKeyUsageCounts: Record<string, number>;
  initialTimelock: number;
} {
  // Remove wsh() wrapper and checksum
  const innerScript = miniscript.replace('wsh(', '').replace(/\)#.*$/, '');
  const { bitcoinNetworkType } = store.getState().settings;

  // Extract all key expressions with derivation path and path restrictions
  const keyRegex = /\[([A-F0-9]{8})(\/[0-9h'/]+)\]([a-zA-Z0-9]+)\/<(\d+);(\d+)>\//g;
  const matches = [...innerScript.matchAll(keyRegex)];

  // Track each occurrence to calculate importedKeyUsageCounts
  const keyOccurrences = matches.map((match) => ({
    masterFingerprint: match[1],
    derivationPath: 'm' + match[2],
    xpub: match[3],
    pathRestriction: `<${match[4]};${match[5]}>`,
    xfp: WalletUtilities.getFingerprintFromExtendedKey(
      match[3],
      WalletUtilities.getNetworkByType(bitcoinNetworkType)
    ),
  }));

  // Create unique signers list (without duplicates)
  const uniqueKeys: VaultSigner[] = Array.from(
    new Map(
      keyOccurrences.map((key) => [
        key.xpub,
        {
          masterFingerprint: key.masterFingerprint,
          derivationPath: key.derivationPath,
          xpub: key.xpub,
          xfp: key.xfp,
        },
      ])
    ).values()
  );

  const stages = extractStagesWithAfter(innerScript);
  // Extract all key expressions from the entire innerScript
  const allKeyMatches = [...innerScript.matchAll(keyRegex)];

  // Extract all key expressions from the stages
  const stageKeyMatches = stages.flatMap((stage) => [...stage.stage.matchAll(keyRegex)]);

  // Create a map to count occurrences of each key in the entire innerScript
  const allKeyCounts = new Map<string, number>();
  allKeyMatches.forEach((match) => {
    const key = match[0];
    allKeyCounts.set(key, (allKeyCounts.get(key) || 0) + 1);
  });

  // Create a map to count occurrences of each key in the stages
  const stageKeyCounts = new Map<string, number>();
  stageKeyMatches.forEach((match) => {
    const key = match[0];
    stageKeyCounts.set(key, (stageKeyCounts.get(key) || 0) + 1);
  });

  // Identify regular keys (keys that appear more in the entire innerScript than in the stages)
  let regularKeys = Array.from(allKeyCounts.entries())
    .filter(([key, count]) => count > (stageKeyCounts.get(key) || 0))
    .map(([key]) => key);

  let initialTimelock = 0;

  // If there is initialTimelock no regular keys will be found, treat the first stage as the regular
  if ((!regularKeys || regularKeys.length === 0) && stages.length > 0) {
    regularKeys = [...stages[0].stage.matchAll(keyRegex)].map((match) => match[0]);
    initialTimelock = stages[0].afterValue;
    stages.shift();
  }

  const fingerprintRegex = /\[([A-Fa-f0-9]{8})/; // Adjusted regex

  const regularFingerprints = regularKeys
    .map((key) => {
      const match = key.match(fingerprintRegex);
      return match ? match[1] : null;
    })
    .filter((fingerprint) => fingerprint !== null);

  const { inheritanceKeys, emergencyKeys } = categorizeKeys(
    stages,
    uniqueKeys,
    regularFingerprints,
    uniqueKeys.length === keyOccurrences.length
  );

  // Derive importedKeyUsageCounts from occurrences

  const importedKeyUsageCounts: Record<string, number> = {};
  keyOccurrences.forEach((occurrence) => {
    const match = occurrence.pathRestriction.match(/<(\d+);/);
    if (match) {
      const index = parseInt(match[1], 10);
      if (index > 0) {
        const count = index / 2;
        if (
          importedKeyUsageCounts[occurrence.masterFingerprint] === undefined ||
          count < importedKeyUsageCounts[occurrence.masterFingerprint]
        ) {
          importedKeyUsageCounts[occurrence.masterFingerprint] = count;
        }
      }
    }
  });

  // Second pass: if a fingerprint has a <0;1> occurrence, set its count to 0
  keyOccurrences.forEach((occurrence) => {
    const match = occurrence.pathRestriction.match(/<(\d+);/);
    if (match) {
      const index = parseInt(match[1], 10);
      if (index === 0) {
        delete importedKeyUsageCounts[occurrence.masterFingerprint];
      }
    }
  });

  return {
    signers: uniqueKeys
      .filter((key) => regularFingerprints.includes(key.masterFingerprint))
      .sort(
        (a, b) =>
          regularFingerprints.indexOf(a.masterFingerprint) -
          regularFingerprints.indexOf(b.masterFingerprint)
      ),
    inheritanceKeys,
    emergencyKeys,
    importedKeyUsageCounts,
    initialTimelock,
  };
}

export const urlParamsToObj = (url: string): any => {
  try {
    const regex = /[?&]([^=#]+)=([^&#]*)/g;
    const params = {};
    let match;
    while ((match = regex.exec(url))) {
      // eslint-disable-next-line prefer-destructuring
      params[match[1]] = match[2];
    }
    return params;
  } catch (err) {
    return {};
  }
};

export const createCipheriv = (data: string, password: string) => {
  const algorithm = 'aes-256-cbc';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, Buffer.from(password, 'hex'), iv);
  let encrypted = cipher.update(data);
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  return { iv: iv.toString('hex'), encryptedData: encrypted.toString('hex') };
};

export const createDecipheriv = (data: { iv: string; encryptedData: string }, password: string) => {
  const algorithm = 'aes-256-cbc';
  const encryptedText = Buffer.from(data.encryptedData, 'hex');
  // Creating Decipher
  const decipher = crypto.createDecipheriv(
    algorithm,
    Buffer.from(password, 'hex'),
    Buffer.from(data.iv, 'hex')
  );
  // Updating encrypted text
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  // Returning iv and encrypted data
  return JSON.parse(decrypted.toString());
};

export const createCipherGcm = (data: string, password: string) => {
  const algorithm = 'aes-256-gcm';
  const key = Buffer.from(password, 'hex');
  const iv = crypto.randomBytes(12); // 12 bytes for GCM
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    encryptedData: encrypted.toString('hex'),
    authTag: authTag.toString('hex'),
  };
};

interface DecryptData {
  iv: string;
  encryptedData: string;
  authTag: string;
}

export const createDecipherGcm = (data: DecryptData, password: string) => {
  const algorithm = 'aes-256-gcm';
  const key = Buffer.from(password, 'hex');
  const iv = Buffer.from(data.iv, 'hex');
  const encryptedText = Buffer.from(data.encryptedData, 'hex');
  const authTag = Buffer.from(data.authTag, 'hex');
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted: Buffer;

  try {
    decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
  } catch (err) {
    throw new Error(`Failed to decrypt data: ${err.message}`);
  }
  return JSON.parse(decrypted.toString('utf-8'));
};

export const getArchivedVaults = (allVaults: Vault[], vault: Vault) => {
  return vault.archived || !vault.archivedId
    ? []
    : allVaults.filter(
        (v) =>
          v.archived &&
          // include vaults that have the same parent archived id or the parent vault itself which is archived but does not have an archived id
          (v.archivedId === vault.archivedId || v.id === vault.archivedId)
      );
};

export function findVaultFromSenderAddress(allVaults: Vault[], senderAddresses) {
  let activeVault = null;
  allVaults.forEach(async (vault) => {
    let addressMatched = true;
    for (let i = 0; i < senderAddresses.length; i++) {
      const _ = senderAddresses[i].path.split('/');
      const [isChange, index] = _.splice(_.length - 2);
      // 0/even - Receive(External) | 1/odd - change(internal)
      let generatedAddress: string;
      generatedAddress = WalletOperations.getExternalInternalAddressAtIdx(
        vault,
        parseInt(index),
        isOdd(parseInt(isChange))
      );
      if (senderAddresses[i].address != generatedAddress) {
        addressMatched = false;
        break;
      }
    }
    if (addressMatched) {
      activeVault = vault;
    }
  });

  if (!activeVault) {
    return null;
  }
  return activeVault;
}

export function findChangeFromReceiverAddresses(
  activeVault: Vault,
  receiverAddresses,
  changeAddressIndex: number
) {
  if (changeAddressIndex == undefined) return receiverAddresses;
  if (changeAddressIndex > activeVault.specs.nextFreeChangeAddressIndex + config.GAP_LIMIT) {
    throw new Error('Change index is too high.');
  }

  const changeAddress = WalletOperations.getExternalInternalAddressAtIdx(
    activeVault,
    changeAddressIndex,
    true
  );
  const found = receiverAddresses.findIndex((address) => address.address === changeAddress);
  if (found !== -1) {
    receiverAddresses[found].isChange = true;
  }

  return receiverAddresses;
}

export const accountNoFromDerivationPath = (derivationPath) => {
  return derivationPath.split('/')[3].replace("'", '');
};
