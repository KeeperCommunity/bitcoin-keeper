import {
  RECOVERABLE_MOBILE_KEY_MAX_ORDINAL,
  RECOVERABLE_MOBILE_KEY_VERSION,
} from './mobileKeyConstants';

export type MobileKeyReservationState = 'reserved' | 'active' | 'archived' | 'tombstone';

export interface MobileKeyOrdinalReservation {
  /** Stable creation ID assigned before signer derivation; not the xpub-derived Vault ID. */
  walletId: string;
  ordinal: number;
  version: typeof RECOVERABLE_MOBILE_KEY_VERSION;
  state: MobileKeyReservationState;
}

/** Must include every historical reservation, including deleted wallets. */
export interface MobileKeyOrdinalLedger {
  complete: boolean;
  /** Persisted high-water mark; -1 means no Mobile Key has ever been reserved. */
  highWaterOrdinal: number;
  records: readonly MobileKeyOrdinalReservation[];
  /** Optional durable reservations whose wallet record is not available. */
  usedOrdinals?: readonly number[];
}

export type MobileKeyOrdinalRequest =
  | { kind: 'create'; walletId: string }
  | { kind: 'restore'; walletId: string };

export type MobileKeyOrdinalAllocation =
  | {
      kind: 'create';
      ordinal: number;
      version: typeof RECOVERABLE_MOBILE_KEY_VERSION;
      reservationToPersist: MobileKeyOrdinalReservation;
    }
  | { kind: 'restore'; ordinal: number; version: typeof RECOVERABLE_MOBILE_KEY_VERSION };

const isValidOrdinal = (ordinal: number): boolean =>
  Number.isSafeInteger(ordinal) && ordinal >= 0 && ordinal <= RECOVERABLE_MOBILE_KEY_MAX_ORDINAL;

/**
 * Propose a fresh ordinal from a complete, persisted reservation ledger.
 * The caller must atomically persist reservationToPersist before deriving a
 * new Mobile Key; this pure function does not reserve storage by itself.
 */
export const allocateRecoverableMobileKeyOrdinal = (
  ledger: MobileKeyOrdinalLedger,
  request: MobileKeyOrdinalRequest
): MobileKeyOrdinalAllocation => {
  if (
    !ledger ||
    ledger.complete !== true ||
    !Number.isSafeInteger(ledger.highWaterOrdinal) ||
    ledger.highWaterOrdinal < -1 ||
    ledger.highWaterOrdinal > RECOVERABLE_MOBILE_KEY_MAX_ORDINAL ||
    !Array.isArray(ledger.records) ||
    (ledger.usedOrdinals !== undefined && !Array.isArray(ledger.usedOrdinals))
  ) {
    throw new Error('Complete Mobile Key reservation history is required');
  }
  if (
    !request ||
    (request.kind !== 'create' && request.kind !== 'restore') ||
    typeof request.walletId !== 'string' ||
    request.walletId.trim() !== request.walletId ||
    !request.walletId
  ) {
    throw new Error('Stable wallet ID and allocation mode are required');
  }

  const byWalletId = new Map<string, MobileKeyOrdinalReservation>();
  const byOrdinal = new Map<number, string>();
  const usedOrdinals = new Set<number>();

  for (const record of ledger.records) {
    if (
      !record ||
      typeof record.walletId !== 'string' ||
      !record.walletId ||
      record.walletId.trim() !== record.walletId ||
      record.version !== RECOVERABLE_MOBILE_KEY_VERSION ||
      !['reserved', 'active', 'archived', 'tombstone'].includes(record.state) ||
      !isValidOrdinal(record.ordinal) ||
      record.ordinal > ledger.highWaterOrdinal ||
      byWalletId.has(record.walletId) ||
      byOrdinal.has(record.ordinal)
    ) {
      throw new Error('Ambiguous Mobile Key reservation history');
    }
    byWalletId.set(record.walletId, record);
    byOrdinal.set(record.ordinal, record.walletId);
    usedOrdinals.add(record.ordinal);
  }

  const explicitOrdinals = new Set<number>();
  for (const ordinal of ledger.usedOrdinals || []) {
    if (
      !isValidOrdinal(ordinal) ||
      ordinal > ledger.highWaterOrdinal ||
      explicitOrdinals.has(ordinal)
    ) {
      throw new Error('Ambiguous Mobile Key reservation history');
    }
    explicitOrdinals.add(ordinal);
    usedOrdinals.add(ordinal);
  }

  for (let ordinal = 0; ordinal <= ledger.highWaterOrdinal; ordinal += 1) {
    if (!usedOrdinals.has(ordinal)) {
      throw new Error('Incomplete Mobile Key reservation history');
    }
  }

  const prior = byWalletId.get(request.walletId);
  if (request.kind === 'restore') {
    if (!prior) throw new Error('Wallet Mobile Key reservation not found');
    return { kind: 'restore', ordinal: prior.ordinal, version: prior.version };
  }
  if (prior) throw new Error('Wallet ID already has a Mobile Key reservation');
  if (ledger.highWaterOrdinal === RECOVERABLE_MOBILE_KEY_MAX_ORDINAL) {
    throw new Error('Recoverable Mobile Key ordinal range exhausted');
  }

  const ordinal = ledger.highWaterOrdinal + 1;
  return {
    kind: 'create',
    ordinal,
    version: RECOVERABLE_MOBILE_KEY_VERSION,
    reservationToPersist: {
      walletId: request.walletId,
      ordinal,
      version: RECOVERABLE_MOBILE_KEY_VERSION,
      state: 'reserved',
    },
  };
};
