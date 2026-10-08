import {
  allocateRecoverableMobileKeyOrdinal,
  MobileKeyOrdinalLedger,
} from 'src/services/wallets/operations/recoverable/mobileKeyOrdinal';
import { RECOVERABLE_MOBILE_KEY_MAX_ORDINAL } from 'src/services/wallets/operations/recoverable/mobileKey';

const ledger: MobileKeyOrdinalLedger = {
  complete: true,
  highWaterOrdinal: 2,
  records: [
    { walletId: 'first', ordinal: 0, version: 1, state: 'active' },
    { walletId: 'second', ordinal: 1, version: 1, state: 'tombstone' },
  ],
  usedOrdinals: [2],
};

describe('Recoverable Mobile Key ordinal allocation', () => {
  it('allocates after the durable high-water mark, including deleted wallets', () => {
    expect(
      allocateRecoverableMobileKeyOrdinal(ledger, { kind: 'create', walletId: 'third' })
    ).toEqual({
      kind: 'create',
      ordinal: 3,
      version: 1,
      reservationToPersist: { walletId: 'third', ordinal: 3, version: 1, state: 'reserved' },
    });
  });

  it('returns the recorded ordinal on restore, including a tombstoned wallet', () => {
    expect(
      allocateRecoverableMobileKeyOrdinal(ledger, { kind: 'restore', walletId: 'second' })
    ).toEqual({ kind: 'restore', ordinal: 1, version: 1 });
  });

  it('starts at zero only with a complete empty history', () => {
    expect(
      allocateRecoverableMobileKeyOrdinal(
        { complete: true, highWaterOrdinal: -1, records: [] },
        { kind: 'create', walletId: 'first' }
      )
    ).toMatchObject({ ordinal: 0 });
  });

  it('fails closed for missing history, gaps, ambiguous records or unknown restore', () => {
    expect(() =>
      allocateRecoverableMobileKeyOrdinal(
        { ...ledger, complete: false },
        { kind: 'create', walletId: 'x' }
      )
    ).toThrow('Complete Mobile Key reservation history is required');
    expect(() =>
      allocateRecoverableMobileKeyOrdinal(
        { ...ledger, usedOrdinals: [] },
        { kind: 'create', walletId: 'x' }
      )
    ).toThrow('Incomplete Mobile Key reservation history');
    expect(() =>
      allocateRecoverableMobileKeyOrdinal(
        {
          ...ledger,
          records: [
            ...ledger.records,
            { walletId: 'other', ordinal: 0, version: 1, state: 'active' },
          ],
        },
        { kind: 'create', walletId: 'x' }
      )
    ).toThrow('Ambiguous Mobile Key reservation history');
    expect(() =>
      allocateRecoverableMobileKeyOrdinal(ledger, { kind: 'restore', walletId: 'unknown' })
    ).toThrow('Wallet Mobile Key reservation not found');
    expect(() =>
      allocateRecoverableMobileKeyOrdinal(ledger, { kind: 'create', walletId: 'first' })
    ).toThrow('Wallet ID already has a Mobile Key reservation');
  });

  it('enforces the reserved ordinal range', () => {
    expect(() =>
      allocateRecoverableMobileKeyOrdinal(
        { complete: true, highWaterOrdinal: RECOVERABLE_MOBILE_KEY_MAX_ORDINAL + 1, records: [] },
        { kind: 'create', walletId: 'x' }
      )
    ).toThrow('Complete Mobile Key reservation history is required');
  });
});
