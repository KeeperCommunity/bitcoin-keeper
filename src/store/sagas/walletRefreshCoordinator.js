// The wallet watcher forks each request. Keep overlapping refreshes in order so
// an older snapshot cannot persist after a newer one for the same wallet.
const activeBatches = new Map();
const walletTails = new Map();

export const acquireWalletRefresh = (appId, networkType, wallets, options = {}, accountSession = null) => {
  const walletKeys = [...new Set(wallets.map((wallet) =>
    JSON.stringify([appId, networkType, wallet.entityKind, wallet.id])
  ))].sort();
  // A -> B -> A starts a new account session. Do not join its refresh to an
  // older A batch, but keep the wallet tail so writes remain in order.
  const batchKey = JSON.stringify([
    walletKeys,
    !!options.hardRefresh,
    !!options.addNotifications,
    !!options.dustScan,
    accountSession,
  ]);
  const existing = activeBatches.get(batchKey);
  if (existing) return { owner: false, done: existing.done };

  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const predecessors = walletKeys.map((key) => walletTails.get(key)).filter(Boolean);
  const ready = Promise.all(predecessors);
  let completed = false;
  const lease = {
    owner: true,
    ready,
    done,
    complete: (succeeded) => {
      if (completed) return;
      completed = true;
      if (activeBatches.get(batchKey) === lease) activeBatches.delete(batchKey);
      for (const key of walletKeys) {
        if (walletTails.get(key) === done) walletTails.delete(key);
      }
      resolveDone(succeeded);
    },
  };
  activeBatches.set(batchKey, lease);
  for (const key of walletKeys) walletTails.set(key, done);
  return lease;
};
