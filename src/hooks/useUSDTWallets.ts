import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@realm/react';
import { useDispatch, useStore } from 'react-redux';
import { useAppSelector } from 'src/store/hooks';
import { updateAppImage } from 'src/store/sagaActions/bhr';
import { beginBackupLocalOperation, commitBackupLocalOperation, enqueueAutomaticBackupOperation } from 'src/services/backup/automatic';
import { canonical, recoveryContent } from 'src/services/backup/image';
import { captureBackupWriteIntent, currentBackupAccountSession, markBackupMutation } from 'src/services/backup/transport';
import {
  invalidateBackupRepair,
  isAutomaticCloudBackupEnabled,
  setPendingAllBackup,
} from 'src/store/reducers/bhr';
import USDT, {
  DEFAULT_DEADLINE_SECONDS,
  USDTTransferOptions,
} from '../services/wallets/operations/dollars/USDT';
import { captureError } from '../services/sentry';
import { RealmSchema } from '../storage/realm/enum';
import dbManager from '../storage/realm/dbManager';
import { NetworkType, VisibilityType } from '../services/wallets/enums';
import {
  generateUSDTWallet,
  syncUSDTWalletBalance,
  updateUSDTWalletAccountStatus,
  updateUSDTWalletBalanceTxs,
  USDTWallet,
  USDTWalletType,
  getAvailableBalanceUSDTWallet,
  USDTWalletImportDetails,
  USDTWalletSupportedNetwork,
} from '../services/wallets/factories/USDTWalletFactory';

export interface UseUSDTWalletsOptions {
  getAll?: boolean;
  includeHidden?: boolean;
}

// Existing USDT wallets remain readable, but new wallet creation and import are paused.
export const USDT_WALLET_CREATION_PAUSED = true;

export interface UseUSDTWalletsReturn {
  usdtWallets: USDTWallet[];
  error: string | null;
  createWallet: (params: {
    type: USDTWalletType;
    name: string;
    description: string;
    primaryMnemonic?: string;
    importDetails?: USDTWalletImportDetails;
  }) => Promise<{ newWallet?: USDTWallet; error?: string }>;
  deleteWallet: (walletId: string) => Promise<boolean>;
  updateWallet: (wallet: USDTWallet) => Promise<boolean>;
  syncAccountStatus: (wallet: USDTWallet) => Promise<USDTWallet>;
  syncWalletBalance: (wallet: USDTWallet) => Promise<USDTWallet>;
  syncWallet: (wallet: USDTWallet) => Promise<USDTWallet>;
  getWalletById: (walletId: string) => USDTWallet | null;
  processPermitTransaction: (params: {
    sender: USDTWallet;
    recipientAddress: string;
    amount: number;
    fees: { activateFee: number; transferFee: number; totalFee: number };
  }) => Promise<{ success: boolean; transaction?: any; error?: string }>;
}

export const useUSDTWallets = (options: UseUSDTWalletsOptions = {}): UseUSDTWalletsReturn => {
  const { includeHidden = false } = options;
  const { bitcoinNetworkType }: { bitcoinNetworkType: NetworkType } = useAppSelector(
    (state) => state.settings
  );
  const allWallets = useQuery(RealmSchema.USDTWallet);
  const [error, setError] = useState<string | null>(null);
  const dispatch = useDispatch();
  const reduxStore = useStore();
  const { id: appId }: any = dbManager.getObjectByIndex(RealmSchema.KeeperApp);
  const renderAccountSession = currentBackupAccountSession();
  const isOriginCurrent = useCallback(
    () =>
      (dbManager.getObjectByIndex(RealmSchema.KeeperApp) as any)?.id === appId &&
      reduxStore.getState().storage.appId === appId,
    [appId, reduxStore]
  );

  const filterByNetwork = (wallets: USDTWallet[]) => {
    if (bitcoinNetworkType)
      return wallets.filter((wallet) => wallet.networkType === bitcoinNetworkType);
    else return wallets;
  };

  const usdtWallets = useMemo(() => {
    const wallets: USDTWallet[] = allWallets.map((w) => (w.toJSON ? w.toJSON() : w)) as any;

    let filteredWallets = wallets;

    // Filter by network type
    filteredWallets = filterByNetwork(filteredWallets);

    // Filter hidden wallets if not included
    if (!includeHidden) {
      filteredWallets = filteredWallets.filter((wallet) => wallet.presentationData.visibility !== VisibilityType.HIDDEN);
    }

    return filteredWallets;
  }, [allWallets, includeHidden, bitcoinNetworkType]);

  /**
   * Create a new USDT wallet
   */
  const createWallet = useCallback(
    async (params: {
      type: USDTWalletType;
      name: string;
      description: string;
      primaryMnemonic?: string;
      importDetails?: USDTWalletImportDetails;
    }): Promise<{ newWallet?: USDTWallet; error?: string }> => {
      const originSession = currentBackupAccountSession();
      const originBackupWriteIntent = captureBackupWriteIntent(appId);
      const isCurrentCreate = () =>
        isOriginCurrent() &&
        renderAccountSession === originSession &&
        originSession === currentBackupAccountSession();
      let beganLocalWrite = false;
      let localOperation;
      if (USDT_WALLET_CREATION_PAUSED) {
        return { error: 'USDT wallet setup is paused' };
      }

      try {
        if (!isCurrentCreate()) throw new Error('Account changed');
        localOperation = beginBackupLocalOperation(appId, originBackupWriteIntent, originSession);
        setError(null);
        const walletNetworkType = USDTWalletSupportedNetwork;
        const allUSDTWallets: USDTWallet[] = (await dbManager.getObjectByIndex(
          // includes hidden and imported wallets as well
          RealmSchema.USDTWallet,
          null,
          true // get all wallets
        )) as any;
        if (!isCurrentCreate()) throw new Error('Account changed');

        let lastInstanceNum = -1;
        allUSDTWallets.forEach((wallet) => {
          if (wallet.type === USDTWalletType.DEFAULT) {
            lastInstanceNum = Math.max(lastInstanceNum, wallet.derivationDetails.instanceNum); // improves the instance number generation logic(accounts for deleted wallets as well)
          }
        });

        // Generate the wallet
        const newWallet = await generateUSDTWallet({
          usdtWalletType: params.type,
          walletName: params.name,
          walletDescription: params.description,
          networkType: walletNetworkType,
          primaryMnemonic: params.primaryMnemonic,
          instanceNum: params.type === USDTWalletType.DEFAULT ? lastInstanceNum + 1 : null,
          importDetails: params.importDetails,
        });
        if (!isCurrentCreate()) throw new Error('Account changed');

        // check if a USDT wallet already exists with the same mnemonic(especially for imported wallets)
        const existingWallet = allUSDTWallets.find((wallet) => wallet.id === newWallet.id);
        if (existingWallet) {
          throw new Error('USDT wallet already exists with the same ID');
        }

        beganLocalWrite = true;
        const committedOperation = commitBackupLocalOperation(localOperation, (localRealm) => {
          localRealm.create(RealmSchema.USDTWallet, newWallet);
        });
        if (!committedOperation.committed) throw new Error('Failed to create wallet');
        if (!isCurrentCreate()) throw new Error('Account changed');

        //  Create usdt wallet backup
        dispatch({
          ...updateAppImage({ wallets: [newWallet], signers: null, updateNodes: false }, appId),
          originBackupAccountSession: originSession,
          originBackupWriteIntent,
          committedOperation,
        });

        return { newWallet };
      } catch (err) {
        if (beganLocalWrite && isAutomaticCloudBackupEnabled(reduxStore.getState().bhr, appId)) {
          markBackupMutation(appId);
          dispatch(invalidateBackupRepair(appId));
          dispatch(setPendingAllBackup({ appId, pending: true }));
        }
        setError(err.message || 'Failed to create wallet');
        captureError(err);
        return { error: err.message || 'Failed to create wallet' };
      }
    },
    [appId, dispatch, isOriginCurrent, reduxStore, renderAccountSession]
  );

  /**
   * Delete a wallet
   */
  const deleteWallet = useCallback(async (walletId: string): Promise<boolean> => {
    const originAppId = appId;
    const originSession = currentBackupAccountSession();
    const originBackupWriteIntent = captureBackupWriteIntent(originAppId);
    const isCurrentDelete = () =>
      isOriginCurrent() &&
      renderAccountSession === originSession &&
      originSession === currentBackupAccountSession();
    try {
      if (!isCurrentDelete()) return false;
      const operation = beginBackupLocalOperation(originAppId, originBackupWriteIntent, originSession);
      const committedOperation = commitBackupLocalOperation(operation, (localRealm) => {
        const stored = localRealm.objectForPrimaryKey(RealmSchema.USDTWallet, walletId);
        if (!stored) throw new Error('Wallet deletion target is missing');
        localRealm.delete(stored);
      });
      if (!committedOperation.committed) throw new Error('Failed to delete wallet');
      if (isAutomaticCloudBackupEnabled(reduxStore.getState().bhr, originAppId)) {
        try {
          const result = await enqueueAutomaticBackupOperation(committedOperation, [{
            operation: 'deleteAppImageEntity', body: { appId: originAppId, signers: [], walletIds: [walletId] },
          }]);
          if (!result.backupConfirmed && isCurrentDelete())
            dispatch(setPendingAllBackup({ appId: originAppId, pending: true }));
        } catch {
          if (isCurrentDelete()) dispatch(setPendingAllBackup({ appId: originAppId, pending: true }));
        }
      }
      return true;
    } catch (err) {
      if (isCurrentDelete()) setError(err.message || 'Failed to delete wallet');
      captureError(err);
      return false;
    }
  }, [appId, dispatch, isOriginCurrent, reduxStore, renderAccountSession]);

  /**
   * Update a wallet in the database
   */
  const updateWallet = useCallback(
    async (wallet: USDTWallet): Promise<boolean> => {
      const originAppId = appId;
      const operationSession = currentBackupAccountSession();
      const originBackupWriteIntent = captureBackupWriteIntent(originAppId);
      const isCurrentUpdate = () =>
        isOriginCurrent() &&
        renderAccountSession === operationSession &&
        operationSession === currentBackupAccountSession();
      let recoveryChanged = false;
      try {
        if (!isCurrentUpdate()) return false;
        const operation = beginBackupLocalOperation(originAppId, originBackupWriteIntent, operationSession);
        const previous = dbManager.getObjectById(RealmSchema.USDTWallet, wallet.id);
        if (!previous) throw new Error('Wallet not found');
        const previousWallet = previous.toJSON ? previous.toJSON() : previous;
        recoveryChanged =
          canonical(recoveryContent('wallets', previousWallet)) !==
          canonical(recoveryContent('wallets', wallet));
        const { id, ...walletUpdateData } = wallet;
        if (!isCurrentUpdate()) throw new Error('Account changed');
        const committedOperation = recoveryChanged
          ? commitBackupLocalOperation(operation, (localRealm) => {
            const stored = localRealm.objectForPrimaryKey(RealmSchema.USDTWallet, id);
            if (!stored) throw new Error('Wallet not found');
            Object.assign(stored, walletUpdateData);
          })
          : undefined;
        const updated = recoveryChanged ? committedOperation.committed
          : await dbManager.updateObjectById(RealmSchema.USDTWallet, id, walletUpdateData);
        if (!updated) throw new Error('Failed to update wallet');
        if (!isCurrentUpdate()) throw new Error('Account changed');

        // Metadata and visibility must survive recovery. Balance/account refreshes
        // are rebuildable caches and must not cause an upload on every sync.
        if (recoveryChanged)
          dispatch({
            ...updateAppImage({ wallets: [wallet], signers: null, updateNodes: false }, originAppId),
            originBackupAccountSession: operationSession,
            originBackupWriteIntent,
            committedOperation,
          });

        return true;
      } catch (err) {
        // The database helper can fail after partially writing fields. Do not
        // upload the requested state or leave a previous verification trusted.
        if (recoveryChanged && isCurrentUpdate()) {
          markBackupMutation(originAppId);
          dispatch(invalidateBackupRepair(originAppId));
          dispatch(setPendingAllBackup({ appId: originAppId, pending: true }));
        }
        if (isCurrentUpdate()) setError(err.message || 'Failed to update wallet');
        captureError(err);
        return false;
      }
    },
    [appId, dispatch, isOriginCurrent, renderAccountSession]
  );

  /**
   * Syncs a single wallet account status with latest data
   */
  const syncAccountStatus = useCallback(async (wallet: USDTWallet): Promise<USDTWallet> => {
    try {
      const updatedAccountStatus = await updateUSDTWalletAccountStatus(wallet);
      const syncedWallet = {
        ...wallet,
        accountStatus: updatedAccountStatus,
      };

      if (!(await updateWallet(syncedWallet))) throw new Error('Failed to persist synced wallet');
      return syncedWallet;
    } catch (err) {
      captureError(err);
      throw new Error('Failed to sync account status');
    }
  }, [updateWallet]);

  /**
   * Syncs wallet balance
   */
  const syncWalletBalance = useCallback(async (wallet: USDTWallet): Promise<USDTWallet> => {
    try {
      const balance = await syncUSDTWalletBalance(wallet);
      const syncedWallet = {
        ...wallet,
        specs: {
          ...wallet.specs,
          balance,
        },
      };

      if (!(await updateWallet(syncedWallet))) throw new Error('Failed to persist synced wallet');
      return syncedWallet;
    } catch (err) {
      captureError(err);
      return wallet;
    }
  }, [updateWallet]);

  /**
   * Syncs a single wallet with latest data
   */
  const syncWallet = useCallback(async (wallet: USDTWallet): Promise<USDTWallet> => {
    try {
      const updatedSpecs = await updateUSDTWalletBalanceTxs(wallet);
      const syncedWallet = {
        ...wallet,
        specs: updatedSpecs,
      };

      if (!(await updateWallet(syncedWallet))) throw new Error('Failed to persist synced wallet');
      return syncedWallet;
    } catch (err) {
      captureError(err);
      return wallet;
    }
  }, [updateWallet]);

  /**
   * Get wallet by ID
   */
  const getWalletById = useCallback(
    (walletId: string): USDTWallet | null => usdtWallets.find((wallet) => wallet.id === walletId) || null,
    [usdtWallets]
  );

  /**
   * Process permit transaction for USDT transfer
   */
  const processPermitTransaction = useCallback(
    async (params: {
      sender: USDTWallet;
      recipientAddress: string;
      amount: number;
      fees: { activateFee: number; transferFee: number; totalFee: number };
    }): Promise<{ success: boolean; transaction?: any; error?: string }> => {
      try {
        const { sender, recipientAddress, amount, fees } = params;

        const transferOptions: USDTTransferOptions = {
          source: sender,
          toAddress: recipientAddress,
          amount,
          networkType: sender.networkType,
          deadlineInSeconds: DEFAULT_DEADLINE_SECONDS,
        };

        // Step 1: Prepare the transfer
        const preparation = await USDT.prepareTransfer(transferOptions);

        if (!preparation?.isValid) {
          return {
            success: false,
            error: preparation?.error || 'Transfer preparation failed',
          };
        }

        // Step 2: Submit the transfer
        const transferResult = await USDT.submitTransfer(
          transferOptions.source,
          preparation.signaturePayload
        );

        if (transferResult?.success) {
          // Update wallet with new balance and transaction
          const updatedWallet: USDTWallet = {
            ...sender,
            specs: {
              ...sender.specs,
              balance: Number(
                (getAvailableBalanceUSDTWallet(sender) - (amount + fees.totalFee)).toFixed(3)
              ),
              transactions: [
                transferResult.transaction, // transfer w/ the trace id(missing txid); to be processed and confirmed
                ...sender.specs.transactions,
              ],
            },
          };

          await updateWallet(updatedWallet);

          return {
            success: true,
            transaction: transferResult.transaction,
          };
        } else {
          return {
            success: false,
            error: transferResult?.error || 'Transfer failed',
          };
        }
      } catch (err) {
        captureError(err);
        return {
          success: false,
          error: err instanceof Error ? err.message : 'An unexpected error occurred',
        };
      }
    },
    [updateWallet]
  );

  return {
    usdtWallets,
    error,
    createWallet,
    deleteWallet,
    updateWallet,
    syncAccountStatus,
    syncWalletBalance,
    syncWallet,
    getWalletById,
    processPermitTransaction,
  };
};
