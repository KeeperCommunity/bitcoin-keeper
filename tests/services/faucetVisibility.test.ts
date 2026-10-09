import { isFaucetTxVisible } from '../../src/store/sagas/faucetVisibility';

const txid = 'a'.repeat(64);

describe('faucet transaction visibility', () => {
  it('requires the funded UTXO in persisted specs', () => {
    const wallet = {
      specs: {
        balances: { confirmed: 0, unconfirmed: 1000 },
        confirmedUTXOs: [],
        unconfirmedUTXOs: [{ txId: txid }],
      },
    };
    expect(isFaucetTxVisible(wallet, txid)).toBe(true);
    expect(isFaucetTxVisible(wallet, 'b'.repeat(64))).toBe(false);
  });

  it('does not report receipt from a txid alone or before balance persistence', () => {
    expect(isFaucetTxVisible({}, txid)).toBe(false);
    expect(isFaucetTxVisible({ specs: { unconfirmedUTXOs: [{ txId: txid }] } }, txid)).toBe(false);
  });
});
