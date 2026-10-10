/* eslint-disable no-continue */

/* eslint-disable no-case-declarations */
import {
  DerivationPurpose,
  EntityKind,
  MiniscriptTypes,
  MultisigScriptType,
  SignerType,
  VaultType,
  VisibilityType,
  WalletType,
  XpubTypes,
} from 'src/services/wallets/enums';
import { DelayedPolicyUpdate, SignerRestriction } from 'src/models/interfaces/AssistedKeys';
import {
  MiniscriptElements,
  Signer,
  Vault,
  VaultPresentationData,
  VaultScheme,
  VaultSigner,
} from 'src/services/wallets/interfaces/vault';
import {
  Wallet,
  WalletImportDetails,
  WalletPresentationData,
} from 'src/services/wallets/interfaces/wallet';
import { call, delay, fork, put, select } from 'redux-saga/effects';
import {
  setSyncing,
  setTestCoinsFailed,
  setTestCoinsReceived,
  setTestCoinsQuotaReached,
  setSignerPolicyError,
} from 'src/store/reducers/wallets';

import { Alert } from 'react-native';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import { RealmSchema } from 'src/storage/realm/enum';
import Relay from 'src/services/backend/Relay';
import SigningServer from 'src/services/backend/SigningServer';
import WalletOperations from 'src/services/wallets/operations';
import WalletUtilities from 'src/services/wallets/operations/utils';
import { createWatcher } from 'src/store/utilities';
import dbManager from 'src/storage/realm/dbManager';
import { generateVault } from 'src/services/wallets/factories/VaultFactory';
import { generateWallet, getCosignerDetails } from 'src/services/wallets/factories/WalletFactory';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';
import {
  decrypt,
  encrypt,
  generateEncryptionKey,
  hash512,
} from 'src/utils/service-utilities/encryption';
import { uaiType } from 'src/models/interfaces/Uai';
import { captureError } from 'src/services/sentry';
import ElectrumClient, {
  ELECTRUM_CLIENT,
  ELECTRUM_NOT_CONNECTED_ERR,
  ELECTRUM_NOT_CONNECTED_ERR_TOR,
} from 'src/services/electrum/client';
import idx from 'idx';
import _ from 'lodash';
import { SyncedWallet } from 'src/services/wallets/interfaces';
import { checkSignerAccountsMatch, getAccountFromSigner, getKeyUID } from 'src/utils/utilities';
import { COLLABORATIVE_SCHEME } from 'src/screens/SigningDevices/SetupCollaborativeWallet';
import { RootState } from '../store';

import {
  initiateVaultMigration,
  setCollaborativeSessionSigners,
  updateCollaborativeSessionLastSynched,
  vaultCreated,
  vaultMigrationCompleted,
} from '../reducers/vaults';
import {
  ADD_NEW_WALLETS,
  AUTO_SYNC_WALLETS,
  REFRESH_WALLETS,
  TEST_SATS_RECIEVE,
  UPDATE_SIGNER_POLICY,
  UPDATE_WALLET_DETAILS,
  refreshWallets,
  UPDATE_SIGNER_DETAILS,
  UPDATE_KEY_DETAILS,
  UPDATE_VAULT_DETAILS,
  GENERATE_NEW_ADDRESS,
  UPDATED_VAULT_SIGNERS_XPRIV,
} from '../sagaActions/wallets';
import {
  ADD_NEW_VAULT,
  ADD_SIGINING_DEVICE,
  DELETE_SIGINING_DEVICE,
  ARCHIVE_SIGINING_DEVICE,
  DELETE_VAULT,
  MERGER_SIMILAR_KEYS,
  MIGRATE_VAULT,
  REFILL_MOBILEKEY,
  REFRESH_CANARY_VAULT,
  REINSTATE_VAULT,
  UPDATE_COLLABORATIVE_CHANNEL,
  FETCH_COLLABORATIVE_CHANNEL,
  updateCollaborativeChannel,
} from '../sagaActions/vaults';
import { addToUaiStack, uaiChecks } from '../sagaActions/uai';
import {
  deleteAppImageEntityWorker,
  deleteVaultImageWorker,
  updateAppImageWorker,
  updateVaultImageWorker,
} from './bhr';
import {
  relaySignersUpdateFail,
  relaySignersUpdateSuccess,
  relayVaultUpdateFail,
  relayVaultUpdateSuccess,
  relayWalletUpdateFail,
  relayWalletUpdateSuccess,
  setIsCloudBsmsBackupRequired,
  setRelaySignersUpdateLoading,
  setRelayVaultUpdateLoading,
  setRelayWalletUpdateLoading,
  showDeletingKeyModal,
  hideDeletingKeyModal,
  showKeyDeletedSuccessModal,
} from '../reducers/bhr';
import { setElectrumNotConnectedErr } from '../reducers/login';
import { connectToNodeWorker } from './network';
import { backupBsmsOnCloud } from '../sagaActions/bhr';
import { bulkUpdateLabelsWorker } from './utxos';
import { updateDelayedPolicyUpdate } from '../reducers/storage';
import { accountNoFromDerivationPath } from 'src/utils/service-utilities/utils';
import { classifyDustByAddress } from 'src/services/wallets/operations/dustClassification';
import { setPendingDustToast } from '../reducers/utxos';

export interface NewVaultDetails {
  name?: string;
  description?: string;
}

export interface NewWalletDetails {
  name?: string;
  description?: string;
  derivationPath?: string;
  instanceNum?: number;
}

export interface NewWalletInfo {
  walletType: WalletType;
  walletDetails?: NewWalletDetails;
  importDetails?: WalletImportDetails;
}

function* addNewWallet(
  walletType: WalletType,
  walletDetails: NewWalletDetails,
  app: KeeperApp,
  importDetails?: WalletImportDetails
) {
  const { primaryMnemonic } = app;
  const {
    name: walletName,
    description: walletDescription,
    derivationPath,
    instanceNum,
  } = walletDetails;
  const wallets: Wallet[] = yield call(
    dbManager.getObjectByIndex,
    RealmSchema.Wallet,
    null,
    true
  ) || [];

  const { bitcoinNetworkType } = yield select((state: RootState) => state.settings);
  switch (walletType) {
    case WalletType.DEFAULT:
      const defaultWallet: Wallet = yield call(generateWallet, {
        type: WalletType.DEFAULT,
        instanceNum, // zero-indexed
        walletName: walletName || 'Mobile Wallet',
        walletDescription: walletDescription || '',
        derivationPath,
        primaryMnemonic,
        networkType: bitcoinNetworkType,
        wallets,
      });
      return defaultWallet;

    case WalletType.IMPORTED:
      const importedWallet: Wallet = yield call(generateWallet, {
        type: WalletType.IMPORTED,
        instanceNum: null, // bip-85 instance number is null for imported wallets
        walletName: walletName || 'Imported Wallet',
        walletDescription: walletDescription || '',
        importDetails,
        networkType: bitcoinNetworkType,
        wallets,
      });
      return importedWallet;
    default:
      throw new Error(`Unsupported wallet-type ${walletType}`);
  }
}

export function* addNewWalletsWorker({ payload: newWalletInfo }: { payload: NewWalletInfo[] }) {
  try {
    const wallets: Wallet[] = [];
    const app: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);

    for (const { walletType, walletDetails, importDetails } of newWalletInfo) {
      const wallet: Wallet = yield call(
        addNewWallet,
        walletType,
        walletDetails,
        app,
        importDetails
      );
      wallets.push(wallet);
    }

    if (wallets.length > 0) {
      yield put(setRelayWalletUpdateLoading(true));
      const response = yield call(updateAppImageWorker, { payload: { wallets } });
      if (response.updated) {
        yield call(dbManager.createObjectBulk, RealmSchema.Wallet, wallets);
        yield put(relayWalletUpdateSuccess());
        return true;
      }
      const errorMsg = response.error?.message
        ? response.error.message.toString()
        : response.error.toString();
      yield put(relayWalletUpdateFail(errorMsg));
      return false;
    }
  } catch (err) {
    console.log(err);
    yield put(relayWalletUpdateFail(err.message ? err.message : err.toString()));
    return false;
  }
}

export const addNewWalletsWatcher = createWatcher(addNewWalletsWorker, ADD_NEW_WALLETS);

export interface NewVaultInfo {
  vaultType: VaultType;
  vaultScheme: VaultScheme;
  vaultSigners: VaultSigner[];
  miniscriptElements?: MiniscriptElements;
  vaultDetails?: NewVaultDetails;
  miniscriptTypes?: MiniscriptTypes[];
}

export function* addNewVaultWorker({
  payload,
}: {
  payload: {
    newVaultInfo?: NewVaultInfo;
    isMigrated?: boolean;
    oldVaultId?: string;
  };
}) {
  try {
    const { newVaultInfo, isMigrated, oldVaultId } = payload;
    const { bitcoinNetworkType: networkType } = yield select((state: RootState) => state.settings);

    const { vaultType = VaultType.DEFAULT, vaultScheme, vaultSigners, vaultDetails } = newVaultInfo;

    if (vaultScheme.multisigScriptType !== MultisigScriptType.MINISCRIPT_MULTISIG) {
      if (vaultScheme.n !== vaultSigners.length) {
        throw new Error('Vault schema(n) and signers mismatch');
      }
    }

    let vault = yield call(generateVault, {
      type: vaultType,
      vaultName: vaultDetails.name,
      vaultDescription: vaultDetails.description,
      scheme: vaultScheme,
      signers: vaultSigners,
      networkType,
    });

    if (isMigrated) {
      const oldVault = dbManager.getObjectById(RealmSchema.Vault, oldVaultId).toJSON() as Vault;
      vault = {
        ...vault,
        archivedId: oldVault.archivedId ? oldVault.archivedId : oldVault.id,
      };
    }

    yield put(setRelayVaultUpdateLoading(true));
    const newVaultResponse = yield call(updateVaultImageWorker, { payload: { vault } });
    if (newVaultResponse.updated) {
      yield call(dbManager.createObject, RealmSchema.Vault, vault);
      yield put(uaiChecks([uaiType.SECURE_VAULT]));

      if (isMigrated) {
        const oldVault = dbManager.getObjectById(RealmSchema.Vault, oldVaultId).toJSON() as Vault;
        const isWalletEmpty =
          oldVault.specs.balances.confirmed === 0 && oldVault.specs.balances.unconfirmed === 0;
        const updatedParams = {
          archived: isWalletEmpty,
          isMigrating: !isWalletEmpty,
          archivedId: oldVault.archivedId ? oldVault.archivedId : oldVault.id,
        };
        const archivedVaultresponse = yield call(updateVaultImageWorker, {
          payload: {
            vault: {
              ...oldVault,
              ...updatedParams,
            },
          },
        });
        if (archivedVaultresponse.updated) {
          yield call(dbManager.updateObjectById, RealmSchema.Vault, oldVaultId, updatedParams);
          yield put(initiateVaultMigration({ intrimVault: vault }));
        }
      }

      yield put(vaultCreated({ hasNewVaultGenerationSucceeded: true }));
      yield put(relayVaultUpdateSuccess());
      yield put(setIsCloudBsmsBackupRequired(true));
      yield put(backupBsmsOnCloud());
      return true;
    }
    throw new Error('Relay updation failed');
  } catch (err) {
    yield put(
      vaultCreated({
        hasNewVaultGenerationFailed: true,
        hasNewVaultGenerationSucceeded: false,
        error: err.toString(),
      })
    );
    captureError(err);
    yield put(
      relayVaultUpdateFail(
        'Failed to create the vault. Please check your internet connection and try again'
      )
    );
    return false;
  }
}

export const addNewVaultWatcher = createWatcher(addNewVaultWorker, ADD_NEW_VAULT);

export function* addSigningDeviceWorker({
  payload: { signers },
  callback,
}: {
  payload: { signers: Signer[] };
  callback?: () => void;
}) {
  if (!signers.length) return;
  for (let i = 0; i < signers.length; i++) {
    const signer = signers[i];
    yield call(mergeSimilarKeysWorker, { payload: { signer } });
  }
  try {
    const { bitcoinNetworkType } = yield select((state: RootState) => state.settings);

    const existingSigners: Signer[] = yield call(dbManager.getCollection, RealmSchema.Signer);
    const filteredSigners = existingSigners.filter(
      (s) => !s.archived && s.networkType === bitcoinNetworkType
    );
    const signerMap = Object.fromEntries(
      filteredSigners.map((signer) => [getKeyUID(signer), signer])
    );
    let signersToUpdate = [];

    try {
      // update signers with signer count
      signers = signers.map((signer) => {
        if (signer.type === SignerType.MY_KEEPER) {
          if (!signer.extraData?.instanceNumber) {
            const myAppKeys = filteredSigners.filter((s) => s.type === SignerType.MY_KEEPER);
            const currentInstanceNumber = WalletUtilities.getInstanceNumberForSigners(myAppKeys);
            signer.extraData = { instanceNumber: currentInstanceNumber + 1 };
          }
        }
        return signer;
      });
    } catch (e) {
      captureError(e);
      return;
    }

    const keysMatch = (type, newSigner, existingSigner) =>
      !!newSigner.signerXpubs[type]?.[0] &&
      !!existingSigner.signerXpubs[type]?.[0] &&
      newSigner.signerXpubs[type]?.[0]?.xpub === existingSigner.signerXpubs[type]?.[0]?.xpub;

    const keysDifferent = (type, newSigner, existingSigner) =>
      !!newSigner.signerXpubs[type]?.[0] &&
      !!existingSigner.signerXpubs[type]?.[0] &&
      newSigner.signerXpubs[type][0].xpub !== existingSigner.signerXpubs[type][0].xpub;

    for (const newSigner of signers) {
      if (!checkSignerAccountsMatch(newSigner)) {
        yield put(
          relaySignersUpdateFail(
            'Cannot add multiple accounts in the same signer, please import each account separately'
          )
        );
        continue;
      }
      const existingSigner = signerMap[getKeyUID(newSigner)];
      if (!existingSigner) {
        const signerAccount = getAccountFromSigner(newSigner);
        if (signerAccount !== 0 && !newSigner.signerDescription) {
          newSigner.signerDescription = `Account #${signerAccount}`;
        }
        signersToUpdate.push(newSigner);
        continue;
      }
      const newSsKey = idx(newSigner, (_) => _.signerXpubs[XpubTypes.P2WPKH][0].xpub);
      const existingSsKey = idx(existingSigner, (_) => _.signerXpubs[XpubTypes.P2WPKH][0].xpub);
      const newMsKey = idx(newSigner, (_) => _.signerXpubs[XpubTypes.P2WSH][0].xpub);
      const existingMsKey = idx(existingSigner, (_) => _.signerXpubs[XpubTypes.P2WSH][0].xpub);
      const newTrKey = idx(newSigner, (_) => _.signerXpubs[XpubTypes.P2TR][0].xpub);
      const existingTrKey = idx(existingSigner, (_) => _.signerXpubs[XpubTypes.P2TR][0].xpub);
      const missingMsKey = (existingSsKey || existingTrKey) && !existingMsKey;
      const missingSsKey = (existingMsKey || existingTrKey) && !existingSsKey;
      const missingTrKey = (existingSsKey || existingMsKey) && !existingTrKey;

      const singleSigMatch = keysMatch(XpubTypes.P2WPKH, newSigner, existingSigner);
      const multiSigMatch = keysMatch(XpubTypes.P2WSH, newSigner, existingSigner);
      const taprootMatch = keysMatch(XpubTypes.P2TR, newSigner, existingSigner);
      const signerMergeCondition = // if the new signer has one of the keys missing or has the same xpubs as the existing signer, then update the type and xpubs
        (missingMsKey && newMsKey) ||
        (missingSsKey && newSsKey) ||
        (missingTrKey && newTrKey) ||
        singleSigMatch ||
        multiSigMatch ||
        taprootMatch;

        if (signerMergeCondition) {
          const { type, signerName } = [SignerType.UNKOWN_SIGNER, SignerType.OTHER_SD].includes(
            existingSigner.type
          )
            ? newSigner
            : existingSigner;
          signersToUpdate.push({
            ...existingSigner,
            type,
            signerXpubs: _.merge(existingSigner.signerXpubs, newSigner.signerXpubs),
            signerName,
            ...(existingSigner.type === SignerType.ONEKEY &&
            newSigner.type === SignerType.ONEKEY &&
            newSigner.extraData?.bleConnectId
              ? {
                  signerName: newSigner.signerName,
                  signerDescription: newSigner.signerDescription,
                }
              : {}),
          });
          continue;
        }

      const singleSigDifferent = keysDifferent(XpubTypes.P2WPKH, newSigner, existingSigner);
      const multiSigDifferent = keysDifferent(XpubTypes.P2WSH, newSigner, existingSigner);
      const taprootDifferent = keysDifferent(XpubTypes.P2TR, newSigner, existingSigner);

      // if the new signer has multiple accounts of the same type, then let the user know and skip the update
      if (singleSigDifferent || multiSigDifferent || taprootDifferent) {
        yield put(
          relaySignersUpdateFail(
            `Signer with the same account and fingerprint (${newSigner.masterFingerprint}) already exists with different xpubs. Please check your device and verify the keys are correct.`
          )
        );
        continue;
      }
    }
    if (signersToUpdate.length) {
      const signerMap = Object.fromEntries(
        existingSigners.map((signer) => [getKeyUID(signer), signer])
      );
      signersToUpdate = signersToUpdate.map((s) => {
        const isSignerArchived = signerMap[getKeyUID(s)]?.archived || false;
        return isSignerArchived ? { ...s, archived: false, hidden: false } : s;
      });
      signersToUpdate = signersToUpdate.map((signer) => ({
        ...signer,
        id: getKeyUID(signer),
      }));
      yield put(setRelaySignersUpdateLoading(true));
      const response = yield call(updateAppImageWorker, { payload: { signers: signersToUpdate } });
      if (response.updated) {
        yield call(
          dbManager.createObjectBulk,
          RealmSchema.Signer,
          signersToUpdate,
          Realm.UpdateMode.Modified
        );

        yield put(
          relaySignersUpdateSuccess(
            signersToUpdate.length !== 1 ||
              (signersToUpdate[0]?.extraData?.instanceNumber !== 1 && !signersToUpdate[0]?.hidden)
          )
        );
        yield call(updateVaultSignerXprivWorker, { signers });
      } else {
        const errorMsg = response.error?.message
          ? response.error.message.toString()
          : response.error.toString();
        yield put(relaySignersUpdateFail(errorMsg));
      }
    } else if (signers.length === 1) {
      yield put(relaySignersUpdateFail('The signer already exists.'));
    }
    if (callback) callback();
  } catch (error) {
    captureError(error);
    yield put(relaySignersUpdateFail('An error occurred while updating signers.'));
  }
}

export const addSigningDeviceWatcher = createWatcher(addSigningDeviceWorker, ADD_SIGINING_DEVICE);

function* deleteSigningDeviceWorker({ payload: { signers } }: { payload: { signers: Signer[] } }) {
  try {
    if (signers.length) {
      yield put(showDeletingKeyModal());
      const signersToDeleteIds = [];
      for (const signer of signers) {
        signersToDeleteIds.push(getKeyUID(signer));
      }
      for (let i = 0; i < signers.length; i++) {
        yield call(deleteAppImageEntityWorker, {
          payload: {
            signerIds: signersToDeleteIds,
          },
        });
      }
      yield put(uaiChecks([uaiType.SIGNING_DEVICES_HEALTH_CHECK]));
      yield put(hideDeletingKeyModal());
      yield put(showKeyDeletedSuccessModal());
    }
  } catch (error) {
    captureError(error);
    yield put(hideDeletingKeyModal());
    yield put(relaySignersUpdateFail('An error occurred while deleting signers.'));
  }
}

export const deleteSigningDeviceWatcher = createWatcher(
  deleteSigningDeviceWorker,
  DELETE_SIGINING_DEVICE
);

function* archiveSigningDeviceWorker({ payload: { signers } }: { payload: { signers: Signer[] } }) {
  try {
    const signersToArchiveIds = [];
    for (const signer of signers) {
      signersToArchiveIds.push(getKeyUID(signer));
    }
    if (signers.length) {
      for (let i = 0; i < signers.length; i++) {
        yield call(updateSignerDetailsWorker, {
          payload: {
            signer: signers[i],
            key: 'archived',
            value: true,
          },
        });
      }
      yield put(uaiChecks([uaiType.SIGNING_DEVICES_HEALTH_CHECK]));
    }
  } catch (error) {
    captureError(error);
    yield put(relaySignersUpdateFail('An error occurred while archiving signers.'));
  }
}

export const archiveSigningDeviceWatcher = createWatcher(
  archiveSigningDeviceWorker,
  ARCHIVE_SIGINING_DEVICE
);

function* migrateVaultWorker({
  payload,
}: {
  payload: { newVaultInfo: NewVaultInfo; oldVaultId: string };
}) {
  try {
    const { newVaultInfo, oldVaultId } = payload;
    const migrated = yield call(addNewVaultWorker, {
      payload: { newVaultInfo, isMigrated: true, oldVaultId },
    });
    const migratedVault = yield select((state: RootState) => state.vault.intrimVault);
    if (migrated && migratedVault) {
      yield put(
        vaultMigrationCompleted({
          hasMigrationSucceeded: true,
          hasMigrationFailed: false,
          error: null,
        })
      );
    }
  } catch (error) {
    yield put(
      vaultMigrationCompleted({
        hasMigrationSucceeded: false,
        hasMigrationFailed: true,
        error: error.toString(),
      })
    );
  }
}

export const migrateVaultWatcher = createWatcher(migrateVaultWorker, MIGRATE_VAULT);

function* refreshWalletsWorker({
  payload,
}: {
  payload: {
    wallets: (Wallet | Vault)[];
    options: { hardRefresh?: boolean; addNotifications?: boolean; dustScan?: boolean };
  };
}) {
  let { wallets, options } = payload;

  // Filter out pre-mix, post-mix, and bad bank wallets as they are no longer displayed or used.
  wallets = wallets.filter((wallet) => {
    if (
      wallet.type === WalletType.PRE_MIX ||
      wallet.type === WalletType.POST_MIX ||
      wallet.type === WalletType.BAD_BANK
    ) {
      return false;
    }
    return true;
  });

  try {
    if (!wallets || wallets.length === 0) return;

    if (!ELECTRUM_CLIENT.isClientConnected) {
      ElectrumClient.resetCurrentPeerIndex();
      yield call(connectToNodeWorker);
    }

    yield put(setSyncing({ wallets, isSyncing: true }));

    const network = WalletUtilities.getNetworkByType(wallets[0].networkType);

    // Build pre-sync spendability snapshot per wallet
    const preSyncSnapshots = new Map<
      string,
      Map<string, { spendability?: string; isManualOverride?: boolean; dustReason?: string }>
    >();
    for (const wallet of wallets) {
      const snapshot = new Map<
        string,
        { spendability?: string; isManualOverride?: boolean; dustReason?: string }
      >();
      const specs = (wallet as any).specs;
      if (specs) {
        const allUTXOs = [...(specs.confirmedUTXOs || []), ...(specs.unconfirmedUTXOs || [])];
        for (const utxo of allUTXOs) {
          if (
            utxo.spendability !== undefined ||
            utxo.isManualOverride !== undefined ||
            utxo.dustReason !== undefined
          ) {
            snapshot.set(`${utxo.txId}:${utxo.vout}`, {
              spendability: utxo.spendability,
              isManualOverride: utxo.isManualOverride,
              dustReason: utxo.dustReason,
            });
          }
        }
      }
      preSyncSnapshots.set(wallet.id, snapshot);
    }

    const { synchedWallets }: { synchedWallets: SyncedWallet[] } = yield call(
      WalletOperations.syncWalletsViaElectrumClient,
      wallets,
      network,
      options.hardRefresh
    );

    let labels: { ref: string; label: string; isSystem: boolean }[];

    if (synchedWallets && synchedWallets.some((wallet) => wallet.newUTXOs.length > 0)) {
      labels = yield call(dbManager.getCollection, RealmSchema.Tags);
    }
    for (const synchedWalletWithUTXOs of synchedWallets) {
      const { synchedWallet } = synchedWalletWithUTXOs;
      if (!synchedWallet.specs.hasNewUpdates && !options.hardRefresh) continue; // no new updates found

      for (const utxo of synchedWalletWithUTXOs.newUTXOs) {
        const labelChanges = {
          added: [],
          deleted: [],
        };

        const utxoLabels = labels ? labels.filter((label) => label.ref === utxo.address) : [];
        if (utxoLabels.length > 0) {
          labelChanges.added.push(
            ...utxoLabels.map((label) => ({
              name: label.label,
              isSystem: label.isSystem,
            }))
          );
        }

        yield fork(bulkUpdateLabelsWorker, {
          payload: { labelChanges, UTXO: utxo, wallet: synchedWallet as any },
        });

        if (options.addNotifications) {
          if (synchedWallet.type !== VaultType.CANARY) {
            if (!Object.values(synchedWallet.specs.addresses.internal).includes(utxo.address)) {
              const { bitcoinNetworkType } = yield select((state: RootState) => state.settings);

              yield put(
                addToUaiStack({
                  uaiType: uaiType.INCOMING_TRANSACTION,
                  entityId: `${synchedWallet.entityKind}_${synchedWallet.id}_${utxo.txId}`,
                  uaiDetails: {
                    heading: 'New Transaction Received',
                    body: 'Click to view the transaction details',
                    networkType: bitcoinNetworkType,
                  },
                })
              );
            }
          }
        }
      }

      if (synchedWallet.entityKind === EntityKind.VAULT && synchedWallet.type === VaultType.CANARY) {
        yield put(uaiChecks([uaiType.CANARAY_WALLET]));
      }

      // Restore spendability from snapshot; classify new UTXOs; toast on new dust
      const walletSnapshot = preSyncSnapshots.get(synchedWallet.id) || new Map();
      const newDustUTXOs: any[] = [];

      // Build {address: index} maps from wallet's cached address objects
      const rawExternal: Record<string, string> =
        (synchedWallet as any).specs.addresses?.external || {};
      const rawInternal: Record<string, string> =
        (synchedWallet as any).specs.addresses?.internal || {};
      const externalAddresses: Record<string, number> = {};
      for (const [idx, addr] of Object.entries(rawExternal)) {
        externalAddresses[addr] = parseInt(idx, 10);
      }
      const internalAddresses: Record<string, number> = {};
      for (const [idx, addr] of Object.entries(rawInternal)) {
        internalAddresses[addr] = parseInt(idx, 10);
      }

      // Dust scan backfill — populate walletOutputs for any transaction missing it.
      // Only runs during an explicit dust scan; skipped on normal/hard refresh.
      if (options.dustScan) {
        const txsMissingOutputs = ((synchedWallet as any).specs.transactions || []).filter(
          (tx: any) => tx.walletOutputs.length === 0
        );

        if (txsMissingOutputs.length > 0) {
          const txidsToFetch = txsMissingOutputs.map((tx: any) => tx.txid);
          try {
            const rawTxs: Record<string, any> = yield call(
              [ElectrumClient, ElectrumClient.getTransactionsById],
              txidsToFetch
            );
            for (const tx of txsMissingOutputs) {
              const rawTx = rawTxs[tx.txid];
              if (!rawTx) continue;
              const walletOuts: Array<{ address: string; valueSats: number }> = [];
              for (const vout of rawTx.vout || []) {
                const addr = vout?.scriptPubKey?.addresses?.[0];
                if (!addr) continue;
                if (
                  externalAddresses[addr] !== undefined ||
                  internalAddresses[addr] !== undefined
                ) {
                  walletOuts.push({
                    address: addr,
                    valueSats: Math.round(vout.value * 1e8),
                  });
                }
              }
              tx.walletOutputs = walletOuts;
            }
          } catch (backfillErr) {
            // Non-fatal: classification will skip txs without walletOutputs
            console.warn('walletOutputs backfill failed:', backfillErr);
          }
        }
      }
      // Build manual-override address set; call address-taint classifier
      const manualOverrideAddresses = new Set<string>();
      const allSynchedUTXOs = [
        ...((synchedWallet as any).specs.confirmedUTXOs || []),
        ...((synchedWallet as any).specs.unconfirmedUTXOs || []),
      ];
      for (const utxo of allSynchedUTXOs) {
        const key = `${utxo.txId}:${utxo.vout}`;
        const snap = walletSnapshot.get(key);
        if (snap?.isManualOverride) {
          manualOverrideAddresses.add(utxo.address);
        }
      }

      const { taintedAddresses, initialTaintAddresses, dustSpendTxids } =
        classifyDustByAddress(
          synchedWallet as any,
          externalAddresses,
          internalAddresses,
          manualOverrideAddresses,
          options.dustScan ? 'full' : 'current'
        );

      // Mark UTXOs — only restore snapshot for soft/hard refresh or when user made a manual override;
      // always re-run classification otherwise so reclassification is not blocked.
      for (const utxo of allSynchedUTXOs) {
        const key = `${utxo.txId}:${utxo.vout}`;
        const existing = walletSnapshot.get(key);
        if (existing?.isManualOverride) {
          // User explicitly changed this UTXO — honour their choice
          utxo.spendability = existing.spendability;
          utxo.isManualOverride = true;
          utxo.dustReason = existing.dustReason;
        } else if (taintedAddresses.has(utxo.address)) {
          const wasAlreadyDust = existing?.spendability === 'doNotSpend';
          utxo.spendability = 'doNotSpend';
          utxo.isManualOverride = false;
          if (!initialTaintAddresses.has(utxo.address)) {
            utxo.dustReason = 'descendant';
          } else if ((utxo.value as number) < 5000) {
            utxo.dustReason = 'initial';
          } else {
            utxo.dustReason = 'adjacent';
          }
          if (!wasAlreadyDust) {
            newDustUTXOs.push(utxo);
          }
        } else {
          // In 'current' mode (soft/hard refresh), preserve any existing doNotSpend
          // classification that was set by a prior dust scan. Only a full dust scan has
          // authority to clear those markings, because only it has the full BFS picture.
          if (!options.dustScan && existing?.spendability === 'doNotSpend') {
            utxo.spendability = existing.spendability;
            utxo.isManualOverride = false;
            utxo.dustReason = existing.dustReason;
          } else {
            utxo.spendability = 'spendable';
            utxo.isManualOverride = false;
            utxo.dustReason = undefined;
          }
        }
      }

      // Label transactions that spent from a tainted address
      for (const tx of (synchedWallet as any).specs.transactions || []) {
        if (dustSpendTxids.has(tx.txid)) {
          if (!Array.isArray(tx.tags)) tx.tags = [];
          if (!tx.tags.includes('potential-dust-spend')) {
            tx.tags.push('potential-dust-spend');
          }
        }
      }

      // Write updated specs (with spendability) back to Realm
      if (synchedWallet.entityKind === EntityKind.VAULT) {
        yield call(dbManager.updateObjectById, RealmSchema.Vault, synchedWallet.id, {
          specs: synchedWallet.specs,
        });
      } else {
        yield call(dbManager.updateObjectById, RealmSchema.Wallet, synchedWallet.id, {
          specs: synchedWallet.specs,
        });
      }

      if (options.addNotifications && newDustUTXOs.length > 0) {
        yield put(setPendingDustToast(synchedWallet.id));
      }
    } // end for (synchedWalletWithUTXOs)
  } catch (err) {
    if ([ELECTRUM_NOT_CONNECTED_ERR, ELECTRUM_NOT_CONNECTED_ERR_TOR].includes(err?.message)) {
      yield put(
        setElectrumNotConnectedErr(
          'Network error: please check your network/ node connection and try again'
        )
      );
    } else {
      yield put(
        setElectrumNotConnectedErr(
          `Wallet sync failed: ${err.message ? err.message : err.toString()}`
        )
      );
      captureError(err);
    }
  } finally {
    yield put(setSyncing({ wallets, isSyncing: false }));
  }
}

export const refreshWalletsWatcher = createWatcher(refreshWalletsWorker, REFRESH_WALLETS);

export function* autoWalletsSyncWorker({
  payload,
}: {
  payload: { syncAll?: boolean; hardRefresh?: boolean; addNotifications?: boolean };
}) {
  const { syncAll, hardRefresh, addNotifications } = payload;
  const wallets: Wallet[] = yield call(dbManager.getObjectByIndex, RealmSchema.Wallet, null, true);
  const vaults: Vault[] = yield call(dbManager.getObjectByIndex, RealmSchema.Vault, null, true);
  const { bitcoinNetworkType } = yield select((state: RootState) => state.settings);

  let walletsToSync: (Wallet | Vault)[] = [];
  for (const wallet of [...wallets, ...vaults]) {
    if (syncAll || wallet.presentationData.visibility === VisibilityType.DEFAULT) {
      if (wallet.entityKind === EntityKind.VAULT && (wallet as Vault).archived) continue;
      walletsToSync.push(getJSONFromRealmObject(wallet));
    }
  }
  walletsToSync = walletsToSync.filter((wallet) => wallet.networkType === bitcoinNetworkType);

  if (walletsToSync.length) {
    yield call(refreshWalletsWorker, {
      payload: {
        wallets: walletsToSync,
        options: {
          hardRefresh,
          addNotifications,
        },
      },
    });
  }
}

export const autoWalletsSyncWatcher = createWatcher(autoWalletsSyncWorker, AUTO_SYNC_WALLETS);

export function* updateSignerPolicyWorker({
  payload,
}: {
  payload: {
    signer: Signer;
    signingKey: VaultSigner;
    updates: {
      restrictions: SignerRestriction;
      signingDelay: number;
    };
    verificationToken: number;
  };
}) {
  const fcmToken = yield select((state: RootState) => state.notifications.fcmToken);
  const { bitcoinNetwork } = yield select((state: RootState) => state.settings);

  const { signer, signingKey, updates, verificationToken } = payload;
  try {
    const signerId =
      signingKey?.xfp ||
      WalletUtilities.getFingerprintFromExtendedKey(
        signer.signerXpubs[XpubTypes.P2WSH][0].xpub,
        bitcoinNetwork
      );

    const {
      updated,
      delayedPolicyUpdate,
    }: { updated: boolean; delayedPolicyUpdate: DelayedPolicyUpdate } = yield call(
      SigningServer.updatePolicy,
      signerId,
      verificationToken,
      updates,
      fcmToken
    );

    if (delayedPolicyUpdate) {
      yield put(updateDelayedPolicyUpdate(delayedPolicyUpdate));
    } else {
      if (!updated) {
        Alert.alert('Failed to update signer policy, try again.');
        throw new Error('Failed to update the policy');
      }

      const updatedSignerPolicy = {
        ...signer.signerPolicy,
        ...updates,
      };
      dbManager.updateObjectByPrimaryId(
        RealmSchema.Signer,
        'masterFingerprint',
        signer.masterFingerprint,
        {
          signerPolicy: updatedSignerPolicy,
        }
      );
    }
    yield put(setSignerPolicyError('success'));
  } catch (err) {
    yield put(setSignerPolicyError('failure'));
  }
}

export const updateSignerPolicyWatcher = createWatcher(
  updateSignerPolicyWorker,
  UPDATE_SIGNER_POLICY
);

function* testcoinsWorker({ payload }) {
  const { wallet } = payload;
  const receivingAddress = WalletOperations.getNextFreeAddress(wallet);
  const network = WalletUtilities.getNetworkByType(wallet.networkType);
  const appId: string = yield select((state: RootState) => state.storage.appId);

  try {
    const { txid } = yield call(Relay.getTestcoins, receivingAddress, network, appId);
    if (!txid) {
      yield put(setTestCoinsFailed(true));
    } else {
      yield put(setTestCoinsReceived(true));
      yield put(refreshWallets([wallet], { hardRefresh: true }));
    }
  } catch (err) {
    if (err.message === 'FAUCET_DAILY_LIMIT_REACHED') {
      yield put(setTestCoinsQuotaReached(true));
    } else {
      yield put(setTestCoinsFailed(true));
    }
  }
}

export const testcoinsWatcher = createWatcher(testcoinsWorker, TEST_SATS_RECIEVE);

function* updateWalletDetailsWorker({ payload }) {
  const {
    wallet,
    details,
  }: {
    wallet: Wallet;
    details: {
      name: string;
      description: string;
    };
  } = payload;
  try {
    const presentationData: WalletPresentationData = {
      name: details.name,
      description: details.description,
      visibility: wallet.presentationData.visibility,
    };
    wallet.presentationData = presentationData;

    yield put(setRelayWalletUpdateLoading(true));
    const response = yield call(updateAppImageWorker, { payload: { wallets: [wallet] } });
    if (response.updated) {
      yield call(dbManager.updateObjectById, RealmSchema.Wallet, wallet.id, {
        presentationData,
      });
      yield put(relayWalletUpdateSuccess());
    } else {
      const errorMsg = response.error?.message
        ? response.error.message.toString()
        : response.error.toString();
      yield put(relayWalletUpdateFail(errorMsg));
    }
  } catch (err) {
    yield put(relayWalletUpdateFail('Something went wrong!'));
  }
}

export const updateWalletDetailWatcher = createWatcher(
  updateWalletDetailsWorker,
  UPDATE_WALLET_DETAILS
);

function* updateVaultDetailsWorker({ payload }) {
  const {
    vault,
    details,
  }: {
    vault: Vault;
    details: {
      name: string;
      description: string;
    };
  } = payload;
  try {
    const presentationData: VaultPresentationData = {
      name: details.name,
      description: details.description,
      visibility: vault.presentationData.visibility,
    };
    yield put(setRelayVaultUpdateLoading(true));
    // API-TODO: based on response call the DB
    vault.presentationData = presentationData;

    const response = yield call(updateVaultImageWorker, {
      payload: { vault },
    });
    if (response.updated) {
      yield call(dbManager.updateObjectById, RealmSchema.Vault, vault.id, {
        presentationData,
      });
      yield put(relayVaultUpdateSuccess());
    } else {
      const errorMsg = response.error?.message
        ? response.error.message.toString()
        : response.error.toString();
      yield put(relayVaultUpdateFail(errorMsg));
    }
  } catch (err) {
    console.log('err', err);
    yield put(relayVaultUpdateFail('Something went wrong!'));
  }
}

export const updateVaultDetailsWatcher = createWatcher(
  updateVaultDetailsWorker,
  UPDATE_VAULT_DETAILS
);

export function* updateSignerDetailsWorker({ payload }) {
  const {
    signer,
    key,
    value,
  }: {
    signer: Signer;
    key: string;
    value: any;
  } = payload;
  yield put(setRelaySignersUpdateLoading(true));
  try {
    signer[key] = value;
    const response = yield call(updateAppImageWorker, { payload: { signers: [signer] } });
    if (response.updated) {
      const signerKeyUID = getKeyUID(signer);
      yield call(
        dbManager.updateObjectByQuery,
        RealmSchema.Signer,
        (realmSigner) => getKeyUID(realmSigner) === signerKeyUID,
        {
          [key]: value,
        }
      );
      yield put(relaySignersUpdateSuccess(false));
    } else {
      const errorMsg = response.error?.message
        ? response.error.message.toString()
        : response.error.toString();
      yield put(relaySignersUpdateFail(errorMsg));
    }
  } catch (err) {
    console.error(err);
    yield put(relaySignersUpdateFail('Something went wrong'));
  }
}

export const updateSignerDetails = createWatcher(updateSignerDetailsWorker, UPDATE_SIGNER_DETAILS);

function* updateKeyDetailsWorker({ payload }) {
  const {
    signer,
    key,
    value,
  }: {
    signer: VaultSigner;
    key: string;
    value: any;
  } = payload;

  const vaultSigner = dbManager.getObjectByPrimaryId(RealmSchema.VaultSigner, 'xpub', signer.xpub);
  const vaultSignerJSON: VaultSigner = vaultSigner.toJSON();
  if (key === 'registered') {
    let updatedFlag = false;
    const updatedRegsteredVaults = vaultSignerJSON.registeredVaults.map((info) => {
      if (info.vaultId === value.vaultId) {
        updatedFlag = true;
        return { ...info, ...value };
      } else {
        return info;
      }
    });
    if (!updatedFlag) {
      updatedRegsteredVaults.push(value);
    }
    yield call(dbManager.updateObjectByPrimaryId, RealmSchema.VaultSigner, 'xpub', signer.xpub, {
      registeredVaults: updatedRegsteredVaults,
    });
    return;
  }

  yield call(dbManager.updateObjectByPrimaryId, RealmSchema.VaultSigner, 'xpub', signer.xpub, {
    [key]: value,
  });
}

export const updateKeyDetails = createWatcher(updateKeyDetailsWorker, UPDATE_KEY_DETAILS);

function* deleteVaultWorker({ payload }) {
  const { vaultId } = payload;
  try {
    yield put(setRelayVaultUpdateLoading(true));
    const response = yield call(deleteVaultImageWorker, { payload: { vaultIds: [vaultId] } });
    if (response.updated) {
      yield call(dbManager.deleteObjectById, RealmSchema.Vault, vaultId);
      yield put(relayVaultUpdateSuccess());
    } else {
      const errorMsg = response.error?.message
        ? response.error.message.toString()
        : response.error.toString();
      yield put(relayVaultUpdateFail(errorMsg));
    }
  } catch (err) {
    yield put(relayVaultUpdateFail('Something went wrong while deleting the vault!'));
  }
}

export const deleteVaultyWatcher = createWatcher(deleteVaultWorker, DELETE_VAULT);

function* reinstateVaultWorker({ payload }) {
  const { vaultId } = payload;
  try {
    yield put(setRelayVaultUpdateLoading(true));
    const vault: Vault = dbManager.getObjectById(RealmSchema.Vault, vaultId).toJSON();
    const updatedParams = {
      archived: false,
      isMigrating: false,
      archivedId: null,
      presentationData: {
        ...vault.presentationData,
        visibility: VisibilityType.DEFAULT,
      },
    };
    const response = yield call(updateVaultImageWorker, {
      payload: {
        vault: {
          ...vault,
          ...updatedParams,
        },
        isUpdate: true,
      },
    });
    const signerMap = {};
    const signingDevices: Signer[] = yield call(dbManager.getCollection, RealmSchema.Signer);
    signingDevices.forEach((signer) => (signerMap[getKeyUID(signer)] = signer));

    if (response.updated) {
      yield call(dbManager.updateObjectById, RealmSchema.Vault, vaultId, updatedParams);
      for (let i = 0; i < vault.signers.length; i++) {
        yield call(updateSignerDetailsWorker, {
          payload: {
            signer: signerMap[getKeyUID(vault.signers[i])],
            key: 'archived',
            value: false,
          },
        });
      }
      yield put(relayVaultUpdateSuccess());
    } else {
      const errorMsg = response.error?.message
        ? response.error.message.toString()
        : response.error.toString();
      yield put(relayVaultUpdateFail(errorMsg));
    }
  } catch (err) {
    yield put(relayVaultUpdateFail('Something went wrong while deleting the vault!'));
  }
}

export const reinstateVaultWatcher = createWatcher(reinstateVaultWorker, REINSTATE_VAULT);

function* refillMobileKeyWorker({ payload }) {
  const { vaultKey } = payload;
  try {
    const { xpriv } = vaultKey;
    if (!xpriv) {
      const signer: Signer = dbManager
        .getObjectById(RealmSchema.Signer, getKeyUID(vaultKey))
        .toJSON();
      const keeper: KeeperApp = dbManager.getCollection(RealmSchema.KeeperApp)[0];
      const { primaryMnemonic } = keeper;
      const details = yield call(
        getCosignerDetails,
        primaryMnemonic,
        signer.extraData.instanceNumber - 1
      );
      const xpub = idx(details, (_) => _.xpubDetails[XpubTypes.P2WSH].xpub);
      const signerXpub = idx(signer, (_) => _.signerXpubs[XpubTypes.P2WSH][0].xpub);
      if (xpub === signerXpub) {
        const { xpriv } = details.xpubDetails[XpubTypes.P2WSH];
        yield call(updateKeyDetailsWorker, {
          payload: { signer: signer.signerXpubs[XpubTypes.P2WSH][0], key: 'xpriv', value: xpriv },
        });
      }
    }
  } catch (err) {
    captureError(err);
  }
}

export const refillMobileKeyWatcher = createWatcher(refillMobileKeyWorker, REFILL_MOBILEKEY);

function* refreshCanaryWalletsWorker() {
  try {
    const vaults: Vault[] = yield call(dbManager.getCollection, RealmSchema.Vault);
    const canaryWallets = vaults.filter((vault) => vault.type === VaultType.CANARY);
    if (canaryWallets.length) {
      yield call(refreshWalletsWorker, {
        payload: {
          wallets: canaryWallets,
          options: {
            hardRefresh: true,
          },
        },
      });
    }
  } catch (err) {
    yield put(relayVaultUpdateFail('Something went wrong while deleting the vault!'));
  }
}

export const refreshCanaryWalletsWatcher = createWatcher(
  refreshCanaryWalletsWorker,
  REFRESH_CANARY_VAULT
);

function* mergeSimilarKeysWorker({ payload }: { payload: { signer: Signer } }) {
  try {
    const { signer } = payload;
    const signers: Signer[] = yield call(dbManager.getCollection, RealmSchema.Signer);
    for (let i = 0; i < signers.length; i++) {
      const s = signers[i];
      const p2wpkh = idx(s, (_) => _.signerXpubs[XpubTypes.P2WPKH][0].xpub);
      const p2wsh = idx(s, (_) => _.signerXpubs[XpubTypes.P2WSH][0].xpub);
      const signerp2wpkh = idx(signer, (_) => _.signerXpubs[XpubTypes.P2WPKH][0].xpub);
      const signerp2wsh = idx(signer, (_) => _.signerXpubs[XpubTypes.P2WSH][0].xpub);
      if (
        p2wpkh === signerp2wpkh &&
        p2wsh === signerp2wsh &&
        s.masterFingerprint !== signer.masterFingerprint
      ) {
        const signerKeyUID = getKeyUID(s);
        yield call(
          dbManager.updateObjectByQuery,
          RealmSchema.Signer,
          (realmSigner) => getKeyUID(realmSigner) === signerKeyUID,
          {
            masterFingerprint: signer.masterFingerprint,
          }
        );
        // get all keys that have the same masterFingerprint
        const keys = yield call(
          dbManager.getObjectByQuery,
          RealmSchema.VaultSigner,
          (obj) => getKeyUID(obj) === getKeyUID(s),
          true // get all matching objects
        );
        for (let i = 0; i < keys.length; i++) {
          yield call(
            dbManager.updateObjectByPrimaryId,
            RealmSchema.VaultSigner,
            'xpub',
            keys[i].xpub,
            {
              masterFingerprint: signer.masterFingerprint,
            }
          );
        }
        const { primarySeed, id }: KeeperApp = yield call(
          dbManager.getObjectByIndex,
          RealmSchema.KeeperApp
        );
        const encryptionKey = generateEncryptionKey(primarySeed);
        const encrytedSigner = encrypt(encryptionKey, JSON.stringify(signer));
        const updated = yield call(Relay.migrateXfp, id, [
          {
            oldSignerId: s.masterFingerprint,
            newSignerId: signer.masterFingerprint,
            newSignerDetails: encrytedSigner,
          },
        ]);
        if (updated) {
          console.log(
            `Signer ${s.masterFingerprint} has been merged with ${signer.masterFingerprint}`
          );
        }
        return true;
      }
    }
    return false;
  } catch (err) {
    captureError(err);
  }
}

export const mergeSimilarKeysWatcher = createWatcher(mergeSimilarKeysWorker, MERGER_SIMILAR_KEYS);

function* generateNewExternalAddressWorker({
  payload,
}: {
  payload: {
    wallet: Wallet | Vault;
  };
}) {
  const { wallet } = payload;
  wallet.specs.totalExternalAddresses += 1;

  if (wallet.entityKind === EntityKind.VAULT) {
    yield call(dbManager.updateObjectById, RealmSchema.Vault, wallet.id, {
      specs: wallet.specs,
    });
  } else {
    yield call(dbManager.updateObjectById, RealmSchema.Wallet, wallet.id, {
      specs: wallet.specs,
    });
  }
}

export const generateNewExternalAddressWatcher = createWatcher(
  generateNewExternalAddressWorker,
  GENERATE_NEW_ADDRESS
);

function* updateCollaborativeChannelWorker({ payload }: { payload: { self: Signer } }) {
  try {
    const collaborativeSession = yield select(
      (state: RootState) => state.vault.collaborativeSession
    );

    for (const fingerprint in collaborativeSession.signers) {
      const { keyAES } = collaborativeSession.signers[fingerprint];
      if (payload.self.masterFingerprint === fingerprint) continue;

      const channelId = hash512(keyAES);
      const encryptedCollaborativeSession = encrypt(keyAES, JSON.stringify(collaborativeSession));
      const res = yield call(
        Relay.updateCollaborativeChannel,
        channelId,
        encryptedCollaborativeSession
      );
      if (!(res && res.updated)) {
        Alert.alert(`Failed to update collaborative channel for ${fingerprint}`);
      }
    }
  } catch (err) {
    console.log({ err });
  }
}

export const updateCollaborativeChannelWatcher = createWatcher(
  updateCollaborativeChannelWorker,
  UPDATE_COLLABORATIVE_CHANNEL
);

function* fetchCollaborativeChannelWorker({ payload }: { payload: { self: Signer } }) {
  try {
    const collaborativeSession = yield select(
      (state: RootState) => state.vault.collaborativeSession
    );

    const { keyAES } = collaborativeSession.signers[payload.self.masterFingerprint];
    const channelId = hash512(keyAES);
    const res = yield call(Relay.fetchCollaborativeChannel, channelId);
    yield put(updateCollaborativeSessionLastSynched());

    if (res && res.encryptedData) {
      const synchedCollaborativeSession = JSON.parse(decrypt(keyAES, res.encryptedData));
      yield put(setCollaborativeSessionSigners(synchedCollaborativeSession.signers));

      // check if this fetch completes the quorum(by combining incomplete remote and local state) and upload the complete collaborative state
      if (!synchedCollaborativeSession.isComplete && !collaborativeSession.isComplete) {
        const uniqueSigners = {};
        for (const fingerprint in synchedCollaborativeSession.signers) {
          uniqueSigners[fingerprint] = true;
        }
        for (const fingerprint in collaborativeSession.signers) {
          uniqueSigners[fingerprint] = true;
        }

        if (Object.keys(uniqueSigners).length === COLLABORATIVE_SCHEME.n) {
          yield delay(1000); // ensures that the reducer state is updated via setCollaborativeSessionSigners before we upload the final state
          yield put(updateCollaborativeChannel(payload.self));
        }
      }
    }
  } catch (err) {
    console.log('Failed to fetch collaborative channel: ', err);
  }
}

export const fetchCollaborativeChannelWatcher = createWatcher(
  fetchCollaborativeChannelWorker,
  FETCH_COLLABORATIVE_CHANNEL
);

function* updateVaultSignerXprivWorker({ signers }) {
  const { bitcoinNetworkType } = yield select((state: RootState) => state.settings);
  for (let i = 0; i < signers.length; i++) {
    const signer = signers[i];
    if (signer.type == SignerType.SEED_WORDS) {
      const sXpriv = idx(signer, (_) => _.signerXpubs[XpubTypes.P2WPKH][0].xpriv);
      const mXpriv = idx(signer, (_) => _.signerXpubs[XpubTypes.P2WSH][0].xpriv);
      const tXpriv = idx(signer, (_) => _.signerXpubs[XpubTypes.P2WSH][0].xpriv);
      if (sXpriv && mXpriv && tXpriv) {
        const vaults: Vault[] = yield call(
          dbManager.getObjectByIndex,
          RealmSchema.Vault,
          null,
          true
        );
        const filteredVaults = vaults.filter((vault) => vault.networkType == bitcoinNetworkType);
        for (let i = 0; i < filteredVaults.length; i++) {
          const vault = filteredVaults[i];
          for (let j = 0; j < vault.signers.length; j++) {
            const vaultSigner = vault.signers[j];
            if (signer.id === getKeyUID(vaultSigner)) {
              const purpose = parseInt(
                WalletUtilities.getSignerPurposeFromPath(vaultSigner.derivationPath)
              );
              const uptXpriv =
                purpose == DerivationPurpose.BIP84
                  ? sXpriv
                  : purpose == DerivationPurpose.BIP48
                  ? mXpriv
                  : purpose == DerivationPurpose.BIP86
                  ? tXpriv
                  : null;
              yield call(
                dbManager.updateObjectByPrimaryId,
                RealmSchema.VaultSigner,
                'xpub',
                vaultSigner.xpub,
                {
                  xpriv: uptXpriv,
                }
              );
            }
          }
        }
      }
    }
  }
}

export const updatedVaultSignerXprivWatcher = createWatcher(
  updateVaultSignerXprivWorker,
  UPDATED_VAULT_SIGNERS_XPRIV
);
