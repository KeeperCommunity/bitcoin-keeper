import { getDerivationPath } from 'src/utils/service-utilities/utils';
import { MiniscriptElements, Vault, VaultScheme, VaultSigner } from '../../../interfaces/vault';
import { KeyInfo, Phase } from '../policy-generator';
import { getKeyUID } from 'src/utils/utilities';

export const ENHANCED_VAULT_TIMELOCKS_BLOCK_HEIGHT_TESTNET = {
  MONTHS_3: 3,
  MONTHS_6: 6,
  MONTHS_9: 9,
  MONTHS_12: 12,
  MONTHS_18: 18,
  MONTHS_24: 24,
  MONTHS_30: 30,
  MONTHS_36: 36,
  MONTHS_42: 42,
  MONTHS_48: 48,
  MONTHS_54: 54,
  MONTHS_60: 60,
};

export const ENHANCED_VAULT_TIMELOCKS_BLOCK_HEIGHT_MAINNET = {
  MONTHS_3: 13140,
  MONTHS_6: 26280,
  MONTHS_9: 39420,
  MONTHS_12: 52560,
  MONTHS_18: 78840,
  MONTHS_24: 105120,
  MONTHS_30: 131400,
  MONTHS_36: 157680,
  MONTHS_42: 183960,
  MONTHS_48: 210240,
  MONTHS_54: 236520,
  MONTHS_60: 262800,
};

export const ENHANCED_VAULT_TIMELOCKS_TIMESTAMP_TESTNET = {
  MONTHS_3: 3 * 10 * 60,
  MONTHS_6: 6 * 10 * 60,
  MONTHS_9: 9 * 10 * 60,
  MONTHS_12: 12 * 10 * 60,
  MONTHS_18: 18 * 10 * 60,
  MONTHS_24: 24 * 10 * 60,
  MONTHS_30: 30 * 10 * 60,
  MONTHS_36: 36 * 10 * 60,
  MONTHS_42: 42 * 10 * 60,
  MONTHS_48: 48 * 10 * 60,
  MONTHS_54: 54 * 10 * 60,
  MONTHS_60: 60 * 10 * 60,
};

export const ENHANCED_VAULT_TIMELOCKS_TIMESTAMP_MAINNET = {
  MONTHS_3: 3 * 30 * 24 * 60 * 60,
  MONTHS_6: 6 * 30 * 24 * 60 * 60,
  MONTHS_9: 9 * 30 * 24 * 60 * 60,
  MONTHS_12: 12 * 30 * 24 * 60 * 60,
  MONTHS_18: 18 * 30 * 24 * 60 * 60,
  MONTHS_24: 24 * 30 * 24 * 60 * 60,
  MONTHS_30: 30 * 30 * 24 * 60 * 60,
  MONTHS_36: 36 * 30 * 24 * 60 * 60,
  MONTHS_42: 42 * 30 * 24 * 60 * 60,
  MONTHS_48: 48 * 30 * 24 * 60 * 60,
  MONTHS_54: 54 * 30 * 24 * 60 * 60,
  MONTHS_60: 60 * 30 * 24 * 60 * 60,
};

export const INHERITANCE_KEY_IDENTIFIER = 'IK';
export const EMERGENCY_KEY_IDENTIFIER = 'EK';

/**
 * Generates the miniscript elements for Enhanced Vaults
 *
 * Miniscript Analysis(produced by the policy-lang generator based on the miniscript elements from the function below)
 *
 * or_d
 * * multi(m of n)
 * and_v
 * * v: pkh(EK)
 * * after(3493966)
 *
 * Resulting script structure(sample: 2 of 3 multisig w/ Emergency Key)
 *
 * 2 <K1<0;1>> <K2<0;1>> <K3<0;1>> 3 OP_CHECKMULTISIG OP_IFDUP OP_NOTIF
 *   OP_DUP OP_HASH160 <HASH160(<EK1<0;1>>)> OP_EQUALVERIFY OP_CHECKSIGVERIFY <4e5035>
 *   OP_CHECKLOCKTIMEVERIFY
 * OP_ENDIF
 */
export function generateEnhancedVaultElements(
  signers: VaultSigner[],
  inheritanceSigners: { signer: VaultSigner; timelock: number }[],
  emergencySigners: { signer: VaultSigner; timelock: number }[],
  scheme: VaultScheme,
  initialTimelock: number
): MiniscriptElements {
  if (scheme.m > signers.length) {
    throw new Error('Threshold (m) cannot be greater than the number of signers (n)');
  }

  const keysInfo: KeyInfo[] = signers.map((signer, index) => ({
    identifier: `K${index + 1}`,
    descriptor: `[${signer.masterFingerprint}/${getDerivationPath(signer.derivationPath)}]${
      signer.xpub
    }`,
  }));

  const inheritanceKeysInfo: KeyInfo[] = inheritanceSigners.map((signerInfo, index) => ({
    identifier: `${INHERITANCE_KEY_IDENTIFIER}${index + 1}`,
    descriptor: `[${signerInfo.signer.masterFingerprint}/${getDerivationPath(
      signerInfo.signer.derivationPath
    )}]${signerInfo.signer.xpub}`,
  }));

  const emergencyKeysInfo: KeyInfo[] = emergencySigners.map((signerInfo, index) => ({
    identifier: `${EMERGENCY_KEY_IDENTIFIER}${index + 1}`,
    descriptor: `[${signerInfo.signer.masterFingerprint}/${getDerivationPath(
      signerInfo.signer.derivationPath
    )}]${signerInfo.signer.xpub}`,
  }));

  if (scheme.m === 1 && emergencyKeysInfo.length > 0) {
    throw new Error(
      scheme.n === 1
        ? 'Single-key wallet cannot use Emergency Key, only Inheritance Key.'
        : 'Multi-key wallets with a threshold of 1 cannot use Emergency Key, only Inheritance Key.'
    );
  }

  if (keysInfo.length !== scheme.n) throw new Error('Invalid inputs; scheme mismatch');

  const signerFingerprints = Object.fromEntries(
    [...keysInfo, ...inheritanceKeysInfo, ...emergencyKeysInfo].map((signer) => [
      signer.identifier,
      signer.descriptor.substring(1, 9),
    ])
  );

  // Ensure keys are not used twice with different accounts
  const fingerprintKeyUIDs = new Map<string, string>();

  [
    ...signers,
    ...inheritanceSigners.map((s) => s.signer),
    ...emergencySigners.map((s) => s.signer),
  ].forEach((signer) => {
    const existingKeyUID = fingerprintKeyUIDs.get(signer.masterFingerprint);
    if (existingKeyUID && existingKeyUID !== getKeyUID(signer)) {
      throw new Error('Cannot setup vault with multiple accounts from the same signer.');
    }
    fingerprintKeyUIDs.set(signer.masterFingerprint, getKeyUID(signer));
  });

  const timelocks = [...inheritanceSigners, ...emergencySigners]
    .map((s) => s.timelock)
    .filter((value, index, self) => self.indexOf(value) === index)
    .sort((a, b) => a - b);

  if (initialTimelock) {
    timelocks.unshift(initialTimelock);
  }

  // Combine inheritance and emergency signers and sort by timelock
  const timelockSigners = [
    ...inheritanceSigners.map((signer, idx) => ({
      timelock: signer.timelock,
      keyInfo: inheritanceKeysInfo[idx],
    })),
    ...emergencySigners.map((signer, idx) => ({
      timelock: signer.timelock,
      keyInfo: emergencyKeysInfo[idx],
    })),
  ].sort((a, b) => a.timelock - b.timelock);

  // Group signers by timelock
  const signersByTimelock = timelockSigners.reduce((acc, signer) => {
    const timelock = signer.timelock;
    if (!acc[timelock]) {
      acc[timelock] = [];
    }
    acc[timelock].push(signer);
    return acc;
  }, {} as Record<number, typeof timelockSigners>);

  const currentQuorum = [...keysInfo];
  const currentThreshold = scheme.m;
  const activatedEmergencyKeys = [];

  const probabilities =
    timelocks.length === 0
      ? [1]
      : [
          Number('9'.repeat(timelocks.length)),
          ...Array(timelocks.length)
            .fill(0)
            .map((_, i) => Number('9'.repeat(timelocks.length - 1 - i))),
          1,
        ];

  // Create phases for each unique timelock
  const timelockPhases: Phase[] = Object.entries(signersByTimelock)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([timelock, signers], phaseIndex) => {
      // Separate inheritance and emergency signers
      const inheritanceSigners = signers.filter((s) =>
        s.keyInfo.identifier.startsWith(INHERITANCE_KEY_IDENTIFIER)
      );
      const emergencySigners = signers.filter((s) =>
        s.keyInfo.identifier.startsWith(EMERGENCY_KEY_IDENTIFIER)
      );

      if (inheritanceSigners.length) {
        currentQuorum.push(...inheritanceSigners.map((s) => s.keyInfo));
      }

      if (emergencySigners.length) {
        activatedEmergencyKeys.push(...emergencySigners);
      }

      if (
        inheritanceSigners.some((inheritanceSigner) =>
          activatedEmergencyKeys.some(
            (emergencySigner) =>
              inheritanceSigner.keyInfo.descriptor.substring(1, 9) ===
              emergencySigner.keyInfo.descriptor.substring(1, 9)
          )
        )
      ) {
        throw new Error('Emergency Key cannot become an Inheritance Key.');
      }

      const paths = [
        // Only add inheritance path if there are inheritance signers
        ...(inheritanceSigners.length > 0
          ? [
              {
                id: 1,
                threshold: currentThreshold,
                keys:
                  currentThreshold === 1
                    ? inheritanceSigners.map((s) => s.keyInfo)
                    : [...currentQuorum],
              },
            ]
          : []),

        ...emergencySigners.map((signer, idx) => ({
          id: inheritanceSigners.length ? idx + 2 : idx + 1,
          threshold: 1,
          keys: [signer.keyInfo],
        })),
      ].filter(Boolean);

      return {
        id: phaseIndex + 2,
        timelock: parseInt(timelock),
        paths,
        requiredPaths: 1,
        probability: probabilities[phaseIndex + 1],
      };
    });

  const phases: Phase[] = [
    {
      id: 1,
      timelock: initialTimelock,
      paths: [{ id: 1, threshold: scheme.m, keys: keysInfo }],
      requiredPaths: 1,
      probability: probabilities[0],
    },
    ...timelockPhases,
  ];

  const miniscriptElements = {
    keysInfo: [...keysInfo, ...inheritanceKeysInfo, ...emergencyKeysInfo],
    timelocks,
    phases,
    signerFingerprints,
  };

  return miniscriptElements;
}

export function getKeyTimelock(
  keyIdentifier: string,
  miniscriptElements: MiniscriptElements
): number {
  // Check all phases in order
  for (const phase of miniscriptElements.phases) {
    // Check all paths in the phase
    for (const path of phase.paths) {
      // Check if the key is used in this path
      if (path.keys.some((key) => key.identifier === keyIdentifier)) {
        return phase.timelock;
      }
    }
  }

  // If key is not found in any phase, return -1 or throw error
  return -1;
}

export function getVaultEnhancedSigners(vault: Vault) {
  const inheritanceSigners = vault?.signers?.filter((signer) =>
    Object.entries(vault?.scheme?.miniscriptScheme?.miniscriptElements?.signerFingerprints)
      .filter(([identifier]) => identifier.startsWith(INHERITANCE_KEY_IDENTIFIER))
      .map(([_, fp]) => fp)
      .includes(signer.masterFingerprint)
  );
  const emergencySigners = vault?.signers?.filter((signer) =>
    Object.entries(vault?.scheme?.miniscriptScheme?.miniscriptElements?.signerFingerprints)
      .filter(([identifier]) => identifier.startsWith(EMERGENCY_KEY_IDENTIFIER))
      .map(([_, fp]) => fp)
      .includes(signer.masterFingerprint)
  );
  // Normal signers
  const otherSigners = vault?.signers?.filter((signer) =>
    Object.entries(vault?.scheme?.miniscriptScheme?.miniscriptElements?.signerFingerprints)
      .filter(([identifier]) => identifier.startsWith('K'))
      .map(([_, fp]) => fp)
      .includes(signer.masterFingerprint)
  );
  return { emergencySigners, inheritanceSigners, otherSigners };
}
