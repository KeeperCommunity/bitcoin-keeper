import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { Vault } from 'src/services/wallets/interfaces/vault';
import { Wallet } from 'src/services/wallets/interfaces/wallet';
import { useAppSelector } from 'src/store/hooks';
import {
  clearRefreshRequest,
  startRefreshRequest,
} from 'src/store/reducers/wallets';
import { autoSyncWallets, refreshWallets } from 'src/store/sagaActions/wallets';

let nextRefreshRequest = 0;

export const useWalletRefresh = () => {
  const dispatch = useDispatch();
  const [requestId, setRequestId] = useState<string | null>(null);
  const inFlight = useRef<string | null>(null);
  const status = useAppSelector((state) =>
    requestId ? state.wallet.refreshRequests[requestId] : undefined
  );

  useEffect(() => {
    if (requestId && status !== 'pending') {
      inFlight.current = null;
      setRequestId(null);
      dispatch(clearRefreshRequest(requestId));
    }
  }, [dispatch, requestId, status]);

  useEffect(() => () => {
    if (inFlight.current) dispatch(clearRefreshRequest(inFlight.current));
  }, [dispatch]);

  const start = useCallback(
    (actionForRequest: (id: string) => { type: string; payload: any }) => {
      if (inFlight.current) return;
      const id = `wallet-refresh-${Date.now()}-${++nextRefreshRequest}`;
      inFlight.current = id;
      dispatch(startRefreshRequest(id));
      setRequestId(id);
      dispatch(actionForRequest(id));
    },
    [dispatch]
  );

  const refresh = useCallback(
    (wallets: (Wallet | Vault)[], options: { hardRefresh?: boolean; dustScan?: boolean }) => {
      if (!wallets?.length || wallets.some((wallet) => !wallet)) return;
      start((id) => refreshWallets(wallets, options, id));
    },
    [start]
  );

  const autoRefresh = useCallback(() => {
    start((id) => autoSyncWallets(false, false, true, undefined, false, id));
  }, [start]);

  return { refreshing: !!requestId && status !== 'success' && status !== 'failure', refresh, autoRefresh };
};
