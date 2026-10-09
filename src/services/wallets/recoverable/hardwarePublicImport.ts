import { SignerType } from '../enums';
import {
  HardwareTransport,
  RecoverableHardwareSigner,
  RecoverablePolicyDraftError,
  validateRecoverableHardwareSigner,
} from './policyDraft';

/** Parsed public exports only. This module never opens a device or creates a wallet. */
export interface RecoverableHardwarePublicImportInput {
  device: SignerType.COLDCARD | SignerType.JADE;
  transport: HardwareTransport;
  payload: unknown;
  /** Caller-assigned public reference to this import, never a secret. */
  sourceId: string;
}

export interface RecoverableHardwarePublicImport {
  kind: 'public-hardware-import';
  signer: RecoverableHardwareSigner;
  /** Parsing an export cannot prove possession, connectivity, or policy support. */
  deviceVerification: 'not-verified';
  policyVerification: 'not-verified';
  fundable: false;
}

type PublicRecord = Record<string, unknown>;

const PRIVATE_FIELD_NAMES = new Set([
  'xpriv',
  'xprv',
  'tprv',
  'yprv',
  'zprv',
  'uprv',
  'vprv',
  'seed',
  'seedhex',
  'mnemonic',
  'recoverykey',
  'privatekey',
  'masterprivatekey',
  'wif',
]);
const MAX_EXPORT_NODES = 2048;
const MAX_EXPORT_DEPTH = 16;
const MAX_JSON_LENGTH = 128 * 1024;

function fail(code: string, message: string): never {
  throw new RecoverablePolicyDraftError(code, message);
}

function asRecord(value: unknown): PublicRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_HARDWARE_EXPORT', 'Expected a public hardware export object');
  }
  return value as PublicRecord;
}

function parsePayload(payload: unknown): PublicRecord {
  if (typeof payload !== 'string') return asRecord(payload);
  if (!payload.trim() || payload.length > MAX_JSON_LENGTH) {
    fail('INVALID_HARDWARE_EXPORT', 'Hardware export JSON is empty or too large');
  }
  try {
    return asRecord(JSON.parse(payload));
  } catch (error) {
    if (error instanceof RecoverablePolicyDraftError) throw error;
    fail('INVALID_HARDWARE_EXPORT', 'Hardware export must be valid JSON');
  }
}

function assertPublicPayload(payload: PublicRecord): void {
  const seen = new Set<object>();
  const pending: { value: unknown; depth: number }[] = [{ value: payload, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++nodes > MAX_EXPORT_NODES || depth > MAX_EXPORT_DEPTH) {
      fail('INVALID_HARDWARE_EXPORT', 'Hardware export is too large or deeply nested');
    }
    if (!value || typeof value !== 'object') continue;
    if (seen.has(value)) fail('INVALID_HARDWARE_EXPORT', 'Hardware export must be acyclic');
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      const field = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (PRIVATE_FIELD_NAMES.has(field)) {
        fail('PRIVATE_MATERIAL', 'Hardware export must contain public data only');
      }
      pending.push({ value: child, depth: depth + 1 });
    }
  }
}

function assertTestnetDeclaration(record: PublicRecord): void {
  for (const field of ['chain', 'network']) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
    const value = record[field];
    if (
      typeof value !== 'string' ||
      !['XTN', 'TESTNET', 'TESTNET3', 'TESTNET4'].includes(value.toUpperCase())
    ) {
      fail('TESTNET_ONLY', 'Hardware export declares a non-testnet network');
    }
  }
}

function publicFields(
  input: RecoverableHardwarePublicImportInput,
  payload: PublicRecord
): Pick<RecoverableHardwareSigner, 'xpub' | 'derivationPath' | 'masterFingerprint'> {
  if (input.device === SignerType.COLDCARD) {
    const bip48 = asRecord(payload.bip48_2);
    assertTestnetDeclaration(bip48);
    return {
      xpub: bip48.xpub as string,
      derivationPath: bip48.deriv as string,
      masterFingerprint: payload.xfp as string,
    };
  }
  if (input.device === SignerType.JADE) {
    const hasBip48Map = Object.prototype.hasOwnProperty.call(payload, '48');
    if (
      hasBip48Map &&
      ['xPub', 'derivationPath', 'mfp'].some((field) =>
        Object.prototype.hasOwnProperty.call(payload, field)
      )
    ) {
      fail('INVALID_HARDWARE_EXPORT', 'Jade export has ambiguous BIP48 public data');
    }
    const bip48 = hasBip48Map ? asRecord(payload['48']) : payload;
    assertTestnetDeclaration(bip48);
    return {
      xpub: bip48.xPub as string,
      derivationPath: bip48.derivationPath as string,
      masterFingerprint: bip48.mfp as string,
    };
  }
  fail('UNSUPPORTED_HARDWARE', 'Only Coldcard and Jade public imports are supported');
}

/** Normalize the known Coldcard/Jade BIP48 export shapes for testnet policy review. */
export function importRecoverableHardwarePublicData(
  input: RecoverableHardwarePublicImportInput
): RecoverableHardwarePublicImport {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('INVALID_HARDWARE_EXPORT', 'Hardware import requires explicit device and source');
  }
  for (const field of Object.keys(input)) {
    if (!['device', 'transport', 'payload', 'sourceId'].includes(field)) {
      fail('UNEXPECTED_FIELD', 'Hardware import has an unexpected field');
    }
  }
  const payload = parsePayload(input.payload);
  assertPublicPayload(payload);
  assertTestnetDeclaration(payload);
  const fields = publicFields(input, payload);
  const signer = validateRecoverableHardwareSigner({
    role: 'hardware',
    signerType: input.device,
    ...fields,
    origin: {
      kind: 'hardware-device',
      device: input.device,
      transport: input.transport,
      sourceId: input.sourceId,
    },
  });
  return {
    kind: 'public-hardware-import',
    signer,
    deviceVerification: 'not-verified',
    policyVerification: 'not-verified',
    fundable: false,
  };
}
