import BIP32Factory from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { MultisigScriptType, NetworkType, SignerType } from '../enums';
import type { MiniscriptElements, VaultScheme } from '../interfaces/vault';
import { generateMiniscript } from '../operations/miniscript/miniscript';
import {
  generateMiniscriptPolicy,
  KeyInfo,
  Phase,
} from '../operations/miniscript/policy-generator';
import ecc from '../operations/taproot-utils/noble_ecc';

const bip32 = BIP32Factory(ecc);

/** The draft never contains private keys or authorizes creation of a funded wallet. */
export const RECOVERABLE_POLICY_DRAFT_VERSION = 1 as const;
const MOBILE_KEY_BIP85_START = 1_000_000;
const MOBILE_KEY_MAX_ORDINAL = 99_999;
const MOBILE_KEY_SIGNER_PATH = "m/48'/1'/0'/2'";
const MAX_LOCKTIME = 0xffffffff;

export type RecoverableHardware =
  | SignerType.TAPSIGNER
  | SignerType.SATOCHIP
  | SignerType.JADE
  | SignerType.COLDCARD;

export type HardwareTransport = 'nfc' | 'qr' | 'file' | 'desktop-usb';

export type RecoverableSignerRole = 'mobile' | 'hardware' | 'server' | 'inheritance';

export interface RecoverablePublicSignerBase {
  role: RecoverableSignerRole;
  signerType: SignerType;
  masterFingerprint: string;
  /** Account-level BIP48 testnet extended PUBLIC key. */
  xpub: string;
  /** Origin of xpub, e.g. m/48'/1'/0'/2'. Never the BIP85 child path. */
  derivationPath: string;
}

export type RecoverableMobileOrigin =
  | {
      kind: 'device-generated';
      version: 1;
      /** Public correlation only. This does not prove that native key generation or backup ran. */
      sourceId: string;
    }
  | {
      kind: 'keeper-recovery-key-bip85';
      version: 1;
      ordinal: number;
      bip85Index: number;
      bip85Path: string;
    };

export interface RecoverableMobileSigner extends RecoverablePublicSignerBase {
  role: 'mobile';
  signerType: SignerType.MOBILE_KEY;
  origin: RecoverableMobileOrigin;
}

export interface RecoverableHardwareSigner extends RecoverablePublicSignerBase {
  role: 'hardware';
  signerType: RecoverableHardware;
  origin: {
    kind: 'hardware-device';
    device: RecoverableHardware;
    transport: HardwareTransport;
    /** A public import reference, not a device secret. */
    sourceId: string;
  };
}

export interface RecoverableServerSigner extends RecoverablePublicSignerBase {
  role: 'server';
  signerType: SignerType.POLICY_SERVER;
  origin: {
    kind: 'keeper-server-key';
    /** Public correlation only; this draft does not register or request a key. */
    sourceId: string;
  };
}

export interface RecoverableInheritanceSigner extends RecoverablePublicSignerBase {
  role: 'inheritance';
  origin: {
    kind: 'externally-held-inheritance-key';
    /** Public correlation only; no contact identity or private material is stored here. */
    sourceId: string;
  };
}

export interface RecoverableInheritanceChoice {
  signer: RecoverableInheritanceSigner;
  activation: {
    kind: 'block-height' | 'median-time-past';
    /** Absolute Bitcoin locktime chosen before the whole-policy review. */
    value: number;
    /** Chain observation supplied by the caller; this module performs no network request. */
    observedHeight: number;
    observedMedianTimePast: number;
  };
}

export interface RecoverablePolicyDraftInput {
  version: typeof RECOVERABLE_POLICY_DRAFT_VERSION;
  network: NetworkType.TESTNET;
  mobile: RecoverableMobileSigner;
  hardware: RecoverableHardwareSigner;
  server: RecoverableServerSigner;
  inheritance?: RecoverableInheritanceChoice | null;
}

export interface RecoverablePolicyReview {
  kind: 'public-policy-review';
  version: typeof RECOVERABLE_POLICY_DRAFT_VERSION;
  network: NetworkType.TESTNET;
  /** Fixed Mobile + Hardware + Server quorum. */
  base: {
    required: 2;
    total: 3;
    signers: readonly [RecoverableMobileSigner, RecoverableHardwareSigner, RecoverableServerSigner];
  };
  inheritance: null | {
    required: 2;
    total: 4;
    signer: RecoverableInheritanceSigner;
    activation: RecoverableInheritanceChoice['activation'];
  };
  /** Matches Keeper's plain 2-of-3 Vault scheme only when inheritance is absent. */
  baseVaultScheme: VaultScheme | null;
  /** Compiled public script for review only; this is deliberately not a fundable VaultScheme. */
  candidateMiniscript: null | {
    policy: string;
    miniscript: string;
    phases: readonly { timelock: number; signerCount: number; required: 2 }[];
  };
  hardwarePolicyStatus: 'plain-multisig-not-device-tested' | 'inheritance-policy-not-device-tested';
  /** Every draft stays blocked from funding, registration and signing. */
  fundable: false;
}

export class RecoverablePolicyDraftError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'RecoverablePolicyDraftError';
  }
}

const hardwareTransports: Record<RecoverableHardware, readonly HardwareTransport[]> = {
  [SignerType.TAPSIGNER]: ['nfc'],
  [SignerType.SATOCHIP]: ['nfc'],
  [SignerType.JADE]: ['qr', 'desktop-usb'],
  [SignerType.COLDCARD]: ['qr', 'file', 'nfc', 'desktop-usb'],
};

function fail(code: string, message: string): never {
  throw new RecoverablePolicyDraftError(code, message);
}

function nonEmptyPublicId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) {
    fail('INVALID_ORIGIN', `${field} must be a non-empty public reference`);
  }
  return value.trim();
}

function assertOnlyKeys(value: object, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (['xpriv', 'mnemonic', 'seed', 'recoveryKey'].includes(key)) {
      fail('PRIVATE_MATERIAL', `${field} must not contain private key material`);
    }
    if (!allowed.includes(key)) fail('UNEXPECTED_FIELD', `${field} contains an unexpected field`);
  }
}

function normalizePublicSigner<T extends RecoverablePublicSignerBase>(
  signer: T,
  role: T['role']
): T {
  if (!signer || signer.role !== role) fail('INVALID_ROLE', `Expected ${role} signer`);
  assertOnlyKeys(
    signer,
    ['role', 'signerType', 'masterFingerprint', 'xpub', 'derivationPath', 'origin'],
    role
  );
  const fingerprint =
    typeof signer.masterFingerprint === 'string' ? signer.masterFingerprint.toUpperCase() : '';
  if (!/^[0-9A-F]{8}$/.test(fingerprint || '')) {
    fail('INVALID_FINGERPRINT', `Invalid ${role} master fingerprint`);
  }
  if (
    typeof signer.derivationPath !== 'string' ||
    !/^m\/48'\/1'\/(0|[1-9]\d*)'\/2'$/.test(signer.derivationPath)
  ) {
    fail('INVALID_DERIVATION', `${role} must use a testnet BIP48 native-segwit origin`);
  }
  const account = Number(signer.derivationPath.split('/')[3].replace("'", ''));
  if (!Number.isSafeInteger(account) || account > 0x7fffffff) {
    fail('INVALID_DERIVATION', `${role} account is out of range`);
  }
  try {
    const node = bip32.fromBase58(signer.xpub, bitcoin.networks.testnet);
    if (!node.isNeutered()) fail('PRIVATE_MATERIAL', 'Only public extended keys are allowed');
    // A tpub cannot prove its full ancestor path or claimed master fingerprint,
    // but its serialized depth and final hardened child index must match BIP48.
    if (node.depth !== 4 || node.index !== 0x80000002) {
      fail('INVALID_XPUB_ORIGIN', `${role} must be an account-level BIP48 native-segwit tpub`);
    }
  } catch (error) {
    if (error instanceof RecoverablePolicyDraftError) throw error;
    fail('INVALID_XPUB', `${role} must provide a valid testnet public extended key`);
  }
  return { ...signer, masterFingerprint: fingerprint };
}

function validateMobile(signer: RecoverableMobileSigner): RecoverableMobileSigner {
  const normalized = normalizePublicSigner(signer, 'mobile');
  if (
    normalized.signerType !== SignerType.MOBILE_KEY ||
    normalized.derivationPath !== MOBILE_KEY_SIGNER_PATH ||
    !normalized.origin ||
    typeof normalized.origin !== 'object' ||
    normalized.origin.version !== 1
  ) {
    fail('INVALID_MOBILE_ORIGIN', 'Mobile Key requires a supported version 1 public origin');
  }

  let origin: RecoverableMobileOrigin;
  if (normalized.origin.kind === 'device-generated') {
    assertOnlyKeys(normalized.origin, ['kind', 'version', 'sourceId'], 'Mobile origin');
    origin = {
      kind: 'device-generated',
      version: 1,
      sourceId: nonEmptyPublicId(normalized.origin.sourceId, 'Mobile source'),
    };
  } else if (normalized.origin.kind === 'keeper-recovery-key-bip85') {
    assertOnlyKeys(
      normalized.origin,
      ['kind', 'version', 'ordinal', 'bip85Index', 'bip85Path'],
      'Mobile origin'
    );
    const { ordinal, bip85Index, bip85Path } = normalized.origin;
    if (
      !Number.isSafeInteger(ordinal) ||
      ordinal < 0 ||
      ordinal > MOBILE_KEY_MAX_ORDINAL ||
      bip85Index !== MOBILE_KEY_BIP85_START + ordinal ||
      bip85Path !== `m/83696968'/39'/0'/12'/${bip85Index}'`
    ) {
      fail('INVALID_MOBILE_ORIGIN', 'Mobile Key BIP85 metadata does not match its ordinal');
    }
    origin = { kind: 'keeper-recovery-key-bip85', version: 1, ordinal, bip85Index, bip85Path };
  } else {
    fail('INVALID_MOBILE_ORIGIN', 'Unsupported Mobile Key public origin');
  }
  return {
    role: 'mobile',
    signerType: SignerType.MOBILE_KEY,
    masterFingerprint: normalized.masterFingerprint,
    xpub: normalized.xpub,
    derivationPath: normalized.derivationPath,
    origin,
  };
}

/** Validate public hardware metadata only; this does not establish device possession or policy support. */
export function validateRecoverableHardwareSigner(
  signer: RecoverableHardwareSigner
): RecoverableHardwareSigner {
  const normalized = normalizePublicSigner(signer, 'hardware');
  if (normalized.origin && typeof normalized.origin === 'object') {
    assertOnlyKeys(
      normalized.origin,
      ['kind', 'device', 'transport', 'sourceId'],
      'Hardware origin'
    );
  }
  const transports = hardwareTransports[normalized.signerType];
  if (
    !transports ||
    normalized.origin?.kind !== 'hardware-device' ||
    normalized.origin.device !== normalized.signerType ||
    !transports.includes(normalized.origin.transport)
  ) {
    fail('UNSUPPORTED_HARDWARE', 'Hardware type or import transport is unsupported');
  }
  return {
    role: 'hardware',
    signerType: normalized.signerType,
    masterFingerprint: normalized.masterFingerprint,
    xpub: normalized.xpub,
    derivationPath: normalized.derivationPath,
    origin: {
      kind: 'hardware-device',
      device: normalized.signerType,
      transport: normalized.origin.transport,
      sourceId: nonEmptyPublicId(normalized.origin.sourceId, 'Hardware source'),
    },
  };
}

function validateServer(signer: RecoverableServerSigner): RecoverableServerSigner {
  const normalized = normalizePublicSigner(signer, 'server');
  if (normalized.origin && typeof normalized.origin === 'object') {
    assertOnlyKeys(normalized.origin, ['kind', 'sourceId'], 'Server origin');
  }
  if (
    normalized.signerType !== SignerType.POLICY_SERVER ||
    normalized.origin?.kind !== 'keeper-server-key'
  ) {
    fail('INVALID_SERVER_ORIGIN', 'Server Key requires distinct server-issued public material');
  }
  return {
    role: 'server',
    signerType: SignerType.POLICY_SERVER,
    masterFingerprint: normalized.masterFingerprint,
    xpub: normalized.xpub,
    derivationPath: normalized.derivationPath,
    origin: {
      kind: 'keeper-server-key',
      sourceId: nonEmptyPublicId(normalized.origin.sourceId, 'Server source'),
    },
  };
}

function validateInheritance(choice: RecoverableInheritanceChoice): RecoverableInheritanceChoice {
  if (choice && typeof choice === 'object') {
    assertOnlyKeys(choice, ['signer', 'activation'], 'Inheritance choice');
  }
  const signer = normalizePublicSigner(choice?.signer, 'inheritance');
  if (signer.origin && typeof signer.origin === 'object') {
    assertOnlyKeys(signer.origin, ['kind', 'sourceId'], 'Inheritance origin');
  }
  if (
    signer.origin?.kind !== 'externally-held-inheritance-key' ||
    signer.signerType === SignerType.POLICY_SERVER ||
    signer.signerType === SignerType.MOBILE_KEY
  ) {
    fail('INVALID_INHERITANCE_ORIGIN', 'Inheritance Key must be independently held');
  }
  const activation = choice?.activation;
  if (activation && typeof activation === 'object') {
    assertOnlyKeys(
      activation,
      ['kind', 'value', 'observedHeight', 'observedMedianTimePast'],
      'Inheritance activation'
    );
  }
  if (
    !activation ||
    !Number.isSafeInteger(activation.value) ||
    !Number.isSafeInteger(activation.observedHeight) ||
    !Number.isSafeInteger(activation.observedMedianTimePast) ||
    activation.observedHeight < 0 ||
    activation.observedMedianTimePast < 500000000
  ) {
    fail(
      'INVALID_ACTIVATION',
      'Inheritance requires a valid chain observation and absolute locktime'
    );
  }
  if (activation.kind === 'block-height') {
    if (activation.value <= activation.observedHeight || activation.value >= 500000000) {
      fail('INVALID_ACTIVATION', 'Inheritance block height must be in the future');
    }
  } else if (activation.kind === 'median-time-past') {
    if (activation.value <= activation.observedMedianTimePast || activation.value > MAX_LOCKTIME) {
      fail('INVALID_ACTIVATION', 'Inheritance median time past must be in the future');
    }
  } else {
    fail('INVALID_ACTIVATION', 'Unsupported inheritance locktime kind');
  }
  return {
    signer: {
      role: 'inheritance',
      signerType: signer.signerType,
      masterFingerprint: signer.masterFingerprint,
      xpub: signer.xpub,
      derivationPath: signer.derivationPath,
      origin: {
        kind: 'externally-held-inheritance-key',
        sourceId: nonEmptyPublicId(signer.origin.sourceId, 'Inheritance source'),
      },
    },
    activation: {
      kind: activation.kind,
      value: activation.value,
      observedHeight: activation.observedHeight,
      observedMedianTimePast: activation.observedMedianTimePast,
    },
  };
}

function assertDistinctSigners(signers: RecoverablePublicSignerBase[]) {
  const fingerprints = new Set<string>();
  const xpubs = new Set<string>();
  for (const signer of signers) {
    if (fingerprints.has(signer.masterFingerprint) || xpubs.has(signer.xpub)) {
      fail('DUPLICATE_KEY', 'Each policy role must have independent key material');
    }
    fingerprints.add(signer.masterFingerprint);
    xpubs.add(signer.xpub);
  }
}

function asKeyInfo(signer: RecoverablePublicSignerBase, identifier: string): KeyInfo {
  const origin = signer.derivationPath.substring(2).replace(/'/g, 'h');
  return {
    identifier,
    descriptor: `[${signer.masterFingerprint}/${origin}]${signer.xpub}`,
  };
}

function compileInheritanceCandidate(
  signers: readonly [RecoverableMobileSigner, RecoverableHardwareSigner, RecoverableServerSigner],
  inheritance: RecoverableInheritanceChoice
): NonNullable<RecoverablePolicyReview['candidateMiniscript']> {
  const baseKeys = signers.map((signer, index) => asKeyInfo(signer, `K${index + 1}`));
  const inheritanceKey = asKeyInfo(inheritance.signer, 'IK1');
  const phases: Phase[] = [
    {
      id: 1,
      timelock: 0,
      requiredPaths: 1,
      probability: 9,
      paths: [{ id: 1, threshold: 2, keys: baseKeys }],
    },
    {
      id: 2,
      timelock: inheritance.activation.value,
      requiredPaths: 1,
      probability: 1,
      paths: [{ id: 1, threshold: 2, keys: [...baseKeys, inheritanceKey] }],
    },
  ];
  const elements: MiniscriptElements = {
    keysInfo: [...baseKeys, inheritanceKey],
    timelocks: [inheritance.activation.value],
    phases,
    signerFingerprints: Object.fromEntries(
      [...baseKeys, inheritanceKey].map((key) => [key.identifier, key.descriptor.substring(1, 9)])
    ),
  };
  const { miniscriptPhases, policy } = generateMiniscriptPolicy(elements);
  const { miniscript } = generateMiniscript(policy);
  // The compiler output is intentionally reduced to review data. The key map and
  // MiniscriptScheme required for a real Vault must be assembled after hardware proof.
  return {
    policy,
    miniscript,
    phases: miniscriptPhases.map((phase) => ({
      timelock: phase.timelock,
      signerCount: phase.paths[0].keys.length,
      required: 2 as const,
    })),
  };
}

/** Validate the entire proposed policy once, before any wallet creation or server registration. */
export function buildRecoverablePolicyReview(
  input: RecoverablePolicyDraftInput
): RecoverablePolicyReview {
  if (input && typeof input === 'object') {
    assertOnlyKeys(
      input,
      ['version', 'network', 'mobile', 'hardware', 'server', 'inheritance'],
      'Policy draft'
    );
  }
  if (
    input?.version !== RECOVERABLE_POLICY_DRAFT_VERSION ||
    input.network !== NetworkType.TESTNET
  ) {
    fail('TESTNET_ONLY', 'Recoverable Wallet policy drafts are testnet-only');
  }
  const mobile = validateMobile(input.mobile);
  const hardware = validateRecoverableHardwareSigner(input.hardware);
  const server = validateServer(input.server);
  const inheritance = input.inheritance ? validateInheritance(input.inheritance) : null;
  assertDistinctSigners([mobile, hardware, server, ...(inheritance ? [inheritance.signer] : [])]);

  // These NFC cards can sign, but cannot verify the complete delayed policy on-device.
  if (
    inheritance &&
    [SignerType.TAPSIGNER, SignerType.SATOCHIP, SignerType.JADE].includes(hardware.signerType)
  ) {
    fail('UNSUPPORTED_HARDWARE_POLICY', 'This hardware cannot verify the Inheritance Key policy');
  }

  const candidateMiniscript = inheritance
    ? compileInheritanceCandidate([mobile, hardware, server], inheritance)
    : null;

  return {
    kind: 'public-policy-review',
    version: RECOVERABLE_POLICY_DRAFT_VERSION,
    network: NetworkType.TESTNET,
    base: { required: 2, total: 3, signers: [mobile, hardware, server] },
    inheritance: inheritance
      ? { required: 2, total: 4, signer: inheritance.signer, activation: inheritance.activation }
      : null,
    baseVaultScheme: inheritance
      ? null
      : { m: 2, n: 3, multisigScriptType: MultisigScriptType.DEFAULT_MULTISIG },
    candidateMiniscript,
    hardwarePolicyStatus: inheritance
      ? 'inheritance-policy-not-device-tested'
      : 'plain-multisig-not-device-tested',
    fundable: false,
  };
}
