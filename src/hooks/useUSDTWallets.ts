import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@realm/react';
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
import { NetworkType, VisibilityType } from '../services/wallets/enums';
import dbManager from '../storage/realm/dbManager';
import { RealmSchema } from '../storage/realm/enum';
import { captureError } from '../services/sentry';
import USDT, {
  DEFAULT_DEADLINE_SECONDS,
  USDTTransferOptions,
} from '../services/wallets/operations/dollars/USDT';
import { useDispatch } from 'react-redux';
import { useAppSelector } from 'src/store/hooks';
import { updateAppImage } from 'src/store/sagaActions/bhr';
import Relay from 'src/services/backend/Relay';
import { canonical, recoveryContent } from 'src/services/backup/image';
import { markBackupMutation } from 'src/services/backup/transport';
import { invalidateBackupRepair, setPendingAllBackup } from 'src/store/reducers/bhr';

export interface UseUSDTWalletsOptions {
  getAll?: boolean;
  includeHidden?: boolean;
}

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
  const { id: appId }: any = dbManager.getObjectByIndex(RealmSchema.KeeperApp);

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
      filteredWallets = filteredWallets.filter((wallet) => {
        return wallet.presentationData.visibility !== VisibilityType.HIDDEN;
      });
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
      try {
        setError(null);
        const walletNetworkType = USDTWalletSupportedNetwork;
        const allUSDTWallets: USDTWallet[] = (await dbManager.getObjectByIndex(
          // includes hidden and imported wallets as well
          RealmSchema.USDTWallet,
          null,
          true // get all wallets
        )) as any;

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

        // check if a USDT wallet already exists with the same mnemonic(especially for imported wallets)
        const existingWallet = allUSDTWallets.find((wallet) => wallet.id === newWallet.id);
        if (existingWallet) {
          throw new Error('USDT wallet already exists with the same ID');
        }

        await dbManager.createObject(RealmSchema.USDTWallet, newWallet);

        //  Create usdt wallet backup
        dispatch(updateAppImage({ wallets: [newWallet], signers: null, updateNodes: false }));

        return { newWallet };
      } catch (err) {
        setError(err.message || 'Failed to create wallet');
        captureError(err);
        return { error: err.message || 'Failed to create wallet' };
      }
    },
    []
  );

  /**
   * Delete a wallet
   */
  const deleteWallet = useCallback(async (walletId: string): Promise<boolean> => {
    try {
      const response = await Relay.deleteAppImageEntity({
        appId,
        signers: null,
        walletIds: [walletId],
      });
      if (!response.updated) throw new Error('Failed to delete wallet');

      await dbManager.deleteObjectById(RealmSchema.USDTWallet, walletId);
      return true;
    } catch (err) {
      setError(err.message || 'Failed to delete wallet');
      captureError(err);
      return false;
    }
  }, []);

  /**
   * Update a wallet in the database
   */
  const updateWallet = useCallback(
    async (wallet: USDTWallet): Promise<boolean> => {
      let recoveryChanged = false;
      try {
        const previous = dbManager.getObjectById(RealmSchema.USDTWallet, wallet.id);
        if (!previous) throw new Error('Wallet not found');
        const previousWallet = previous.toJSON ? previous.toJSON() : previous;
        recoveryChanged =
          canonical(recoveryContent('wallets', previousWallet)) !==
          canonical(recoveryContent('wallets', wallet));
        const { id, ...walletUpdateData } = wallet;
        const updated = await dbManager.updateObjectById(
          RealmSchema.USDTWallet,
          id,
          walletUpdateData
        ); // Realm updates must omit the primary key.
        if (!updated) throw new Error('Failed to update wallet');

        // Metadata and visibility must survive recovery. Balance/account refreshes
        // are rebuildable caches and must not cause an upload on every sync.
        if (recoveryChanged)
          dispatch(updateAppImage({ wallets: [wallet], signers: null, updateNodes: false }));

        return true;
      } catch (err) {
        // The database helper can fail after partially writing fields. Do not
        // upload the requested state or leave a previous verification trusted.
        if (recoveryChanged) {
          markBackupMutation(appId);
          dispatch(invalidateBackupRepair(appId));
          dispatch(setPendingAllBackup(true));
        }
        setError(err.message || 'Failed to update wallet');
        captureError(err);
        return false;
      }
    },
    [appId, dispatch]
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

      await updateWallet(syncedWallet);
      return syncedWallet;
    } catch (err) {
      captureError(err);
      throw new Error('Failed to sync account status');
    }
  }, []);

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

      await updateWallet(syncedWallet);
      return syncedWallet;
    } catch (err) {
      captureError(err);
      return wallet;
    }
  }, []);

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

      await updateWallet(syncedWallet);
      return syncedWallet;
    } catch (err) {
      captureError(err);
      return wallet;
    }
  }, []);

  /**
   * Get wallet by ID
   */
  const getWalletById = useCallback(
    (walletId: string): USDTWallet | null => {
      return usdtWallets.find((wallet) => wallet.id === walletId) || null;
    },
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
