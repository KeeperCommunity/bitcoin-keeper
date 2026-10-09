type VisibleWallet = {
  specs?: {
    confirmedUTXOs?: { txId: string }[];
    unconfirmedUTXOs?: { txId: string }[];
    balances?: { confirmed: number; unconfirmed: number };
  };
};

/** A faucet transfer is visible only after its UTXO and balance were persisted. */
export const isFaucetTxVisible = (wallet: VisibleWallet, txid: string): boolean => {
  const specs = wallet?.specs;
  if (!specs?.balances) return false;
  // Home displays this sum. Do not announce receipt while it still shows zero.
  if (!(specs.balances.confirmed + specs.balances.unconfirmed > 0)) return false;

  return [...(specs.confirmedUTXOs || []), ...(specs.unconfirmedUTXOs || [])].some(
    (utxo) => utxo.txId?.toLowerCase() === txid.toLowerCase()
  );
};
