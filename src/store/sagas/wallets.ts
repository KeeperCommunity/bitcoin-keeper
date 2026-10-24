/* eslint-disable no-continue */

/* eslint-disable no-case-declarations */
import {
  DerivationPurpose,
  EntityKind,
  MiniscriptTypes,
  MultisigScriptType,
  NetworkType,
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
  VaultScheme,
  VaultSigner,
} from 'src/services/wallets/interfaces/vault';
import {
  Wallet,
  WalletImportDetails,
} from 'src/services/wallets/interfaces/wallet';
import { call, delay, put, select } from 'redux-saga/effects';
import {
  setSyncing,
  setTestCoinsFailed,
  setTestCoinsReceived,
  setTestCoinsQuotaReached,
  setTestCoinsPending,
  setSignerPolicyError,
  finishRefreshRequest,
} from 'src/store/reducers/wallets';

import { Alert } from 'react-native';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import { RealmSchema } from 'src/storage/realm/enum';
import Relay from 'src/services/backend/Relay';
import {
  currentBackupAccountSession,
  markBackupMutation,
} from 'src/services/backup/transport';
import type { BackupWriteIntent } from 'src/services/backup/intent';
import { beginBackupLocalOperation, commitBackupLocalOperation } from 'src/services/backup/automatic';
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
import {
  checkSignerAccountsMatch,
  getAccountFromSigner,
  getKeyUID,
  sanitizeSeedKeyForBackup,
} from 'src/utils/utilities';
import { COLLABORATIVE_SCHEME } from 'src/screens/SigningDevices/SetupCollaborativeWallet';
import { accountNoFromDerivationPath } from 'src/utils/service-utilities/utils';
import { classifyDustByAddress } from 'src/services/wallets/operations/dustClassification';
import { RootState, store } from '../store';
import { selectWalletsForSync } from './walletSyncSelection';
import { acquireWalletRefresh } from './walletRefreshCoordinator';
import { checkBackupFreshness , backupBsmsOnCloud } from '../sagaActions/bhr';

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
  UPDATE_SIGNER_DETAILS,
  UPDATE_KEY_DETAILS,
  UPDATE_VAULT_DETAILS,
  UPDATE_RECOVERY_VISIBILITY,
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
  buildAutomaticAppMutation,
  buildAutomaticVaultMutation,
  queueCommittedBackupWorker,
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
  isAutomaticCloudBackupEnabled,
  invalidateBackupRepair,
  setPendingAllBackup,
} from '../reducers/bhr';
import { setElectrumNotConnectedErr } from '../reducers/login';
import { connectToNodeWorker } from './network';
import { bulkUpdateLabelsWorker } from './utxos';
import { updateDelayedPolicyUpdate } from '../reducers/storage';
import { setPendingDustToast } from '../reducers/utxos';
import { isFaucetTxVisible } from './faucetVisibility';

const WALLET_SYNC_SCOPE_CHANGED = 'WALLET_SYNC_SCOPE_CHANGED';

const currentWalletAccountId = (): string | undefined => {
  try {
    return (dbManager.getObjectByIndex(RealmSchema.KeeperApp) as unknown as KeeperApp)?.id;
  } catch {
    return undefined;
  }
};
const assertWalletAccount = (appId: string, expectedSession?: number) => {
  if (
    !appId ||
    currentWalletAccountId() !== appId ||
    store.getState().storage.appId !== appId ||
    (expectedSession !== undefined && currentBackupAccountSession() !== expectedSession)
  ) throw new Error('Account changed');
};

// Fingerprint corrections preserve key material, compiled policy and derivation.
// Only origin references and the account-qualified signer primary key change.
function rewriteSignerFingerprintReferences(value: any, oldFingerprint: string, newFingerprint: string, field = ''): any {
  if (Array.isArray(value)) return value.map((entry) => rewriteSignerFingerprintReferences(entry, oldFingerprint, newFingerprint, field));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = rewriteSignerFingerprintReferences(entry, oldFingerprint, newFingerprint,
        field === 'signerFingerprints' ? 'masterFingerprint' : field === 'keyInfoMap' ? 'descriptor' : key);
    }
    return result;
  }
  if (typeof value !== 'string') return value;
  if (field === 'masterFingerprint' && value.toUpperCase() === oldFingerprint.toUpperCase()) return newFingerprint;
  // Descriptor origins use [fingerprint/path]; do not edit names or comments.
  if (/descriptor/i.test(field)) {
    const expression = new RegExp(`\\[${oldFingerprint}(?=/|\\])`, 'gi');
    return value.replace(expression, `[${newFingerprint}`);
  }
  return value;
}

function planSignerIdentityMerges(existingSigners: Signer[], incoming: Signer[]) {
  const changes: { oldSignerId: string; newSignerId: string; oldFingerprint: string; newFingerprint: string; signer: Signer }[] = [];
  for (const added of incoming) {
    for (let index = 0; index < existingSigners.length; index += 1) {
      const stored = existingSigners[index];
      const oldSingle = stored.signerXpubs[XpubTypes.P2WPKH]?.[0]?.xpub;
      const oldMulti = stored.signerXpubs[XpubTypes.P2WSH]?.[0]?.xpub;
      const newSingle = added.signerXpubs[XpubTypes.P2WPKH]?.[0]?.xpub;
      const newMulti = added.signerXpubs[XpubTypes.P2WSH]?.[0]?.xpub;
      if ((!oldSingle && !oldMulti) || oldSingle !== newSingle || oldMulti !== newMulti ||
        stored.masterFingerprint === added.masterFingerprint || stored.networkType !== added.networkType) continue;
      const corrected = { ...stored, masterFingerprint: added.masterFingerprint };
      corrected.id = getKeyUID(corrected);
      changes.push({ oldSignerId: getKeyUID(stored), newSignerId: corrected.id,
        oldFingerprint: stored.masterFingerprint, newFingerprint: added.masterFingerprint, signer: corrected });
      existingSigners[index] = corrected;
    }
  }
  return changes;
}

function applySignerIdentityMerges(localRealm: Parameters<Parameters<typeof commitBackupLocalOperation>[1]>[0], changes: ReturnType<typeof planSignerIdentityMerges>) {
  const affectedVaultIds = new Set<string>();
  for (const change of changes) {
    const old = localRealm.objectForPrimaryKey(RealmSchema.Signer, change.oldSignerId);
    if (!old) throw new Error('Signer identity changed before commit');
    if (change.newSignerId !== change.oldSignerId &&
      localRealm.objectForPrimaryKey(RealmSchema.Signer, change.newSignerId))
      throw new Error('Corrected signer identity already exists');
    const affectedVaults = (Array.from(localRealm.objects(RealmSchema.Vault)) as Vault[])
      .filter((vault) => vault.signers.some((key) => getKeyUID(key) === change.oldSignerId));
    localRealm.delete(old);
    localRealm.create(RealmSchema.Signer, change.signer, Realm.UpdateMode.Modified);
    for (const key of localRealm.objects(RealmSchema.VaultSigner)) {
      if (getKeyUID(key) === change.oldSignerId) key.masterFingerprint = change.newFingerprint;
    }
    for (const vault of affectedVaults) {
      affectedVaultIds.add(vault.id);
      vault.scheme = rewriteSignerFingerprintReferences((getJSONFromRealmObject(vault) as unknown as Vault).scheme,
        change.oldFingerprint, change.newFingerprint);
    }
  }
  return affectedVaultIds;
}

function applySignerXprivUpdates(localRealm: Parameters<Parameters<typeof commitBackupLocalOperation>[1]>[0], signers: Signer[]) {
  const affectedVaultIds = new Set<string>();
  for (const signer of signers) {
    if (signer.type !== SignerType.SEED_WORDS) continue;
    for (const key of localRealm.objects(RealmSchema.VaultSigner)) {
      if (getKeyUID(key) !== getKeyUID(signer)) continue;
      const purpose = Number(WalletUtilities.getSignerPurposeFromPath(key.derivationPath));
      const type = purpose === DerivationPurpose.BIP84 ? XpubTypes.P2WPKH
        : purpose === DerivationPurpose.BIP48 ? XpubTypes.P2WSH
        : purpose === DerivationPurpose.BIP86 ? XpubTypes.P2TR : undefined;
      const xpriv = type && signer.signerXpubs[type]?.[0]?.xpriv;
      if (!xpriv) continue;
      key.xpriv = xpriv;
      for (const vault of localRealm.objects(RealmSchema.Vault)) {
        if (vault.signers.some((stored) => stored.xpub === key.xpub)) affectedVaultIds.add(vault.id);
      }
    }
  }
  return affectedVaultIds;
}

function buildSignerMigrationMutation(appId: string, changes: ReturnType<typeof planSignerIdentityMerges>) {
  const app = dbManager.getObjectByIndex(RealmSchema.KeeperApp) as unknown as KeeperApp;
  const encryptionKey = generateEncryptionKey(app.primarySeed);
  return { operation: 'migrateXfps' as const, body: { appId, signerChanges: changes.map((change) => {
    const stored = dbManager.getObjectByPrimaryId(RealmSchema.Signer, 'id', change.newSignerId);
    if (!stored) throw new Error('Corrected signer is missing');
    return { oldSignerId: change.oldSignerId, newSignerId: change.newSignerId,
      newSignerDetails: encrypt(encryptionKey, JSON.stringify(sanitizeSeedKeyForBackup(getJSONFromRealmObject(stored) as unknown as Signer))) };
  }) } };
}

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

export function* addNewWalletsWorker({
  payload: newWalletInfo,
  originAppId,
  originBackupAccountSession,
  originBackupWriteIntent,
}: {
  payload: NewWalletInfo[];
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
}) {
  let sourceAppId = originAppId;
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  try {
    const wallets: Wallet[] = [];
    const app: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
    sourceAppId = originAppId || app?.id;
    assertWalletAccount(sourceAppId, requestSession);
    const operation = beginBackupLocalOperation(sourceAppId, originBackupWriteIntent, requestSession);

    for (const { walletType, walletDetails, importDetails } of newWalletInfo) {
      const wallet: Wallet = yield call(
        addNewWallet,
        walletType,
        walletDetails,
        app,
        importDetails
      );
      assertWalletAccount(sourceAppId, requestSession);
      wallets.push(wallet);
    }

    if (wallets.length > 0) {
      yield put(setRelayWalletUpdateLoading(true));
      const committedOperation = commitBackupLocalOperation(operation, (localRealm) => {
        for (const wallet of wallets) localRealm.create(RealmSchema.Wallet, wallet);
      });
      if (!committedOperation.committed) throw new Error('Local wallet creation failed');
      yield call(updateAppImageWorker, {
        payload: { wallets },
        originAppId: sourceAppId,
        originBackupAccountSession: requestSession,
        originBackupWriteIntent,
        committedOperation,
      });
      assertWalletAccount(sourceAppId, requestSession);
      yield put(relayWalletUpdateSuccess());
      return true;
    }
    return false;
  } catch (err) {
    console.log(err);
    if (currentWalletAccountId() === sourceAppId &&
        store.getState().storage.appId === sourceAppId &&
        currentBackupAccountSession() === requestSession)
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

export function* addNewVaultWorker({ payload, originAppId, originBackupAccountSession, originBackupWriteIntent }: {
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
  payload: { newVaultInfo?: NewVaultInfo; isMigrated?: boolean; oldVaultId?: string };
}) {
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  try {
    assertWalletAccount(sourceAppId, requestSession);
    const operation = beginBackupLocalOperation(sourceAppId, originBackupWriteIntent, requestSession);
    const { newVaultInfo, isMigrated, oldVaultId } = payload;
    const { bitcoinNetworkType: networkType } = yield select((state: RootState) => state.settings);
    const { vaultType = VaultType.DEFAULT, vaultScheme, vaultSigners, vaultDetails } = newVaultInfo;
    if (vaultScheme.multisigScriptType !== MultisigScriptType.MINISCRIPT_MULTISIG &&
        vaultScheme.n !== vaultSigners.length) throw new Error('Vault schema(n) and signers mismatch');
    const vault: Vault = yield call(generateVault, {
      type: vaultType, vaultName: vaultDetails.name, vaultDescription: vaultDetails.description,
      scheme: vaultScheme, signers: vaultSigners, networkType,
    });
    assertWalletAccount(sourceAppId, requestSession);
    yield put(setRelayVaultUpdateLoading(true));
    const committedOperation = commitBackupLocalOperation(operation, (localRealm) => {
      if (localRealm.objectForPrimaryKey(RealmSchema.Vault, vault.id))
        throw new Error('This vault already exists');
      let oldVault;
      if (isMigrated) {
        oldVault = localRealm.objectForPrimaryKey(RealmSchema.Vault, oldVaultId);
        if (!oldVault) throw new Error('Original vault is missing');
        vault.archivedId = oldVault.archivedId || oldVault.id;
      }
      // VaultSigner is shared by xpub across retained and new vaults. Keep its
      // registrations and remembered private material when linking a new vault.
      vault.signers = vault.signers.map((key) => {
        const storedKey = localRealm.objectForPrimaryKey(RealmSchema.VaultSigner, key.xpub);
        if (!storedKey) return key;
        return { ...key, registeredVaults: (getJSONFromRealmObject(storedKey) as unknown as VaultSigner).registeredVaults,
          xpriv: key.xpriv ?? storedKey.xpriv };
      });
      localRealm.create(RealmSchema.Vault, vault, Realm.UpdateMode.Modified);
      if (oldVault) {
        const empty = oldVault.specs.balances.confirmed === 0 && oldVault.specs.balances.unconfirmed === 0;
        oldVault.archived = empty;
        oldVault.isMigrating = !empty;
        oldVault.archivedId = oldVault.archivedId || oldVault.id;
      }
    });
    if (!committedOperation.committed) throw new Error('Local vault creation failed');
    const mutations = isMigrated ? [buildAutomaticVaultMutation(oldVaultId, sourceAppId)] : [];
    mutations.push(buildAutomaticVaultMutation(vault.id, sourceAppId, false));
    yield call(queueCommittedBackupWorker, sourceAppId, committedOperation, mutations, requestSession);
    assertWalletAccount(sourceAppId, requestSession);
    yield put(uaiChecks([uaiType.SECURE_VAULT]));
    if (isMigrated) yield put(initiateVaultMigration({ intrimVault: vault }));
    yield put(vaultCreated({ hasNewVaultGenerationSucceeded: true }));
    yield put(relayVaultUpdateSuccess());
    yield put(setIsCloudBsmsBackupRequired(true));
    yield put(backupBsmsOnCloud());
    return true;
  } catch (err) {
    captureError(err);
    if (currentWalletAccountId() === sourceAppId && currentBackupAccountSession() === requestSession) {
      yield put(vaultCreated({ hasNewVaultGenerationFailed: true, hasNewVaultGenerationSucceeded: false, error: err.toString() }));
      yield put(relayVaultUpdateFail('Failed to save the vault. Please try again'));
    }
    return false;
  }
}

export const addNewVaultWatcher = createWatcher(addNewVaultWorker, ADD_NEW_VAULT);

export function* addSigningDeviceWorker({
  payload: { signers },
  callback,
  originAppId,
  originBackupAccountSession,
  originBackupWriteIntent,
}: {
  payload: { signers: Signer[] };
  callback?: () => void;
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
}) {
  if (!signers.length) return false;
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  assertWalletAccount(sourceAppId, requestSession);
  const operation = beginBackupLocalOperation(sourceAppId, originBackupWriteIntent, requestSession);
  try {
    const { bitcoinNetworkType } = yield select((state: RootState) => state.settings);

    const storedSigners: Signer[] = yield call(dbManager.getCollection, RealmSchema.Signer);
    const existingSigners = storedSigners.map((signer: any) => signer.toJSON ? getJSONFromRealmObject(signer) as unknown as Signer : _.cloneDeep(signer));
    signers = signers.map((signer) => ({ ...signer, signerXpubs: _.cloneDeep(signer.signerXpubs) }));
    const identityChanges = planSignerIdentityMerges(existingSigners, signers);
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
      return false;
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
      const affectedVaultIds = new Set<string>();
      const committedOperation = commitBackupLocalOperation(operation, (localRealm) => {
        for (const vaultId of applySignerIdentityMerges(localRealm, identityChanges)) affectedVaultIds.add(vaultId);
        for (const signer of signersToUpdate) localRealm.create(RealmSchema.Signer, signer, Realm.UpdateMode.Modified);
        for (const vaultId of applySignerXprivUpdates(localRealm, signersToUpdate)) affectedVaultIds.add(vaultId);
      });
      if (!committedOperation.committed) throw new Error('Local signer creation failed');
      const mutations: Parameters<typeof queueCommittedBackupWorker>[2] = [
        buildAutomaticAppMutation({ signers: signersToUpdate }, sourceAppId),
        ...Array.from(affectedVaultIds).map((vaultId) => buildAutomaticVaultMutation(vaultId, sourceAppId)),
      ];
      // Add the corrected key and update all Vault references before removing
      // the old remote key. Every partial prefix remains recoverable.
      if (identityChanges.length) mutations.push(buildSignerMigrationMutation(sourceAppId, identityChanges));
      yield call(queueCommittedBackupWorker, sourceAppId, committedOperation, mutations, requestSession);
      assertWalletAccount(sourceAppId, requestSession);
      yield put(relaySignersUpdateSuccess(
        signersToUpdate.length !== 1 ||
          (signersToUpdate[0]?.extraData?.instanceNumber !== 1 && !signersToUpdate[0]?.hidden)
      ));
    } else if (signers.length === 1) {
      yield put(relaySignersUpdateFail('The signer already exists.'));
    }
    assertWalletAccount(sourceAppId, requestSession);
    if (callback) callback();
    return true;
  } catch (error) {
    captureError(error);
    if (currentWalletAccountId() === sourceAppId && currentBackupAccountSession() === requestSession)
      yield put(relaySignersUpdateFail('An error occurred while updating signers.'));
    return false;
  }
}

export const addSigningDeviceWatcher = createWatcher(addSigningDeviceWorker, ADD_SIGINING_DEVICE);

function* deleteSigningDeviceWorker({
  payload: { signers },
  originAppId,
  originBackupAccountSession,
  originBackupWriteIntent,
}: {
  payload: { signers: Signer[] };
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
}) {
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  try {
    assertWalletAccount(sourceAppId, requestSession);
    if (signers.length) {
      yield put(showDeletingKeyModal());
      const signersToDeleteIds = [];
      for (const signer of signers) {
        signersToDeleteIds.push(getKeyUID(signer));
      }
      const response = yield call(deleteAppImageEntityWorker, {
        originAppId: sourceAppId,
        originBackupAccountSession: requestSession,
        originBackupWriteIntent,
        payload: { signerIds: signersToDeleteIds },
      });
      if (!response?.updated) {
        assertWalletAccount(sourceAppId, requestSession);
        yield put(hideDeletingKeyModal());
        yield put(relaySignersUpdateFail('An error occurred while deleting signers.'));
        return false;
      }
      assertWalletAccount(sourceAppId, requestSession);
      yield put(uaiChecks([uaiType.SIGNING_DEVICES_HEALTH_CHECK]));
      yield put(hideDeletingKeyModal());
      yield put(showKeyDeletedSuccessModal());
      return true;
    }
    return false;
  } catch (error) {
    captureError(error);
    if (currentWalletAccountId() === sourceAppId && store.getState().storage.appId === sourceAppId &&
      currentBackupAccountSession() === requestSession) {
      yield put(hideDeletingKeyModal());
      yield put(relaySignersUpdateFail('An error occurred while deleting signers.'));
    }
    return false;
  }
}

export const deleteSigningDeviceWatcher = createWatcher(
  deleteSigningDeviceWorker,
  DELETE_SIGINING_DEVICE
);

function* archiveSigningDeviceWorker({ payload: { signers }, originAppId, originBackupAccountSession, originBackupWriteIntent }: {
  payload: { signers: Signer[] };
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
}) {
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  try {
    assertWalletAccount(sourceAppId, requestSession);
    const operation = beginBackupLocalOperation(sourceAppId, originBackupWriteIntent, requestSession);
    const committedOperation = commitBackupLocalOperation(operation, (localRealm) => {
      for (const signer of signers) {
        const stored = localRealm.objectForPrimaryKey(RealmSchema.Signer, getKeyUID(signer));
        if (!stored) throw new Error('Signer is missing');
        stored.archived = true;
      }
    });
    if (!committedOperation.committed) throw new Error('Local signer archive failed');
    yield call(updateAppImageWorker, { payload: { signers }, originAppId: sourceAppId,
      originBackupAccountSession: requestSession, committedOperation });
    assertWalletAccount(sourceAppId, requestSession);
    yield put(uaiChecks([uaiType.SIGNING_DEVICES_HEALTH_CHECK]));
    return true;
  } catch {
    if (currentWalletAccountId() === sourceAppId && currentBackupAccountSession() === requestSession)
      yield put(relaySignersUpdateFail('Key changes could not be saved'));
    return false;
  }
}

export const archiveSigningDeviceWatcher = createWatcher(
  archiveSigningDeviceWorker,
  ARCHIVE_SIGINING_DEVICE
);

function* migrateVaultWorker({
  payload,
  originAppId,
  originBackupAccountSession,
  originBackupWriteIntent,
}: {
  payload: { newVaultInfo: NewVaultInfo; oldVaultId: string };
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
}) {
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  try {
    assertWalletAccount(sourceAppId, requestSession);
    const { newVaultInfo, oldVaultId } = payload;
    const migrated = yield call(addNewVaultWorker, {
      originAppId: sourceAppId,
      originBackupAccountSession: requestSession,
      originBackupWriteIntent,
      payload: { newVaultInfo, isMigrated: true, oldVaultId },
    });
    assertWalletAccount(sourceAppId, requestSession);
    if (!migrated) throw new Error('Vault migration could not be saved');
    const migratedVault = yield select((state: RootState) => state.vault.intrimVault);
    assertWalletAccount(sourceAppId, requestSession);
    if (migrated && migratedVault) {
      yield put(
        vaultMigrationCompleted({
          hasMigrationSucceeded: true,
          hasMigrationFailed: false,
          error: null,
        })
      );
    }
    return migrated;
  } catch (error) {
    if (currentWalletAccountId() === sourceAppId && store.getState().storage.appId === sourceAppId &&
      currentBackupAccountSession() === requestSession)
      yield put(
        vaultMigrationCompleted({
          hasMigrationSucceeded: false,
          hasMigrationFailed: true,
          error: error.toString(),
        })
      );
    return false;
  }
}

export const migrateVaultWatcher = createWatcher(migrateVaultWorker, MIGRATE_VAULT);

function* refreshWalletsWorker({
  payload,
  originAppId,
  originBackupAccountSession,
  originBackupWriteIntent,
}: {
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
  payload: {
    wallets: (Wallet | Vault)[];
    options: { hardRefresh?: boolean; addNotifications?: boolean; dustScan?: boolean };
    requestId?: string;
  };
}) {
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  let { wallets, options, requestId } = payload;
  let succeeded = false;
  let lease;
  const isSourceAccountCurrent = () =>
    !!sourceAppId &&
    currentWalletAccountId() === sourceAppId &&
    store.getState().storage.appId === sourceAppId &&
    currentBackupAccountSession() === requestSession;

  // Filter out pre-mix, post-mix, and bad bank wallets as they are no longer displayed or used.
  wallets = (wallets || []).filter((wallet) => {
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
    if (
      !sourceAppId ||
      currentWalletAccountId() !== sourceAppId ||
      store.getState().storage.appId !== sourceAppId ||
      currentBackupAccountSession() !== requestSession
    )
      throw new Error(WALLET_SYNC_SCOPE_CHANGED);
    const refreshScope = yield select((state: RootState) => ({
      appId: state.storage.appId,
      networkType: state.settings.bitcoinNetworkType,
    }));
    if (refreshScope.appId !== sourceAppId) throw new Error(WALLET_SYNC_SCOPE_CHANGED);
    const assertAccountRealmScope = () => {
      const currentState = store.getState();
      let keeperApp: KeeperApp;
      try {
        keeperApp = dbManager.getObjectByIndex(RealmSchema.KeeperApp) as unknown as KeeperApp;
      } catch {
        throw new Error(WALLET_SYNC_SCOPE_CHANGED);
      }
      if (
        currentState.storage.appId !== refreshScope.appId ||
        currentState.settings.bitcoinNetworkType !== refreshScope.networkType ||
        keeperApp?.id !== refreshScope.appId ||
        currentBackupAccountSession() !== requestSession
      )
        throw new Error(WALLET_SYNC_SCOPE_CHANGED);
    };
    wallets = wallets.filter((wallet) => wallet.networkType === refreshScope.networkType);
    if (wallets.length === 0) {
      succeeded = true;
      return true;
    }

    lease = acquireWalletRefresh(
      refreshScope.appId,
      refreshScope.networkType,
      wallets,
      options,
      requestSession
    );
    if (!lease.owner) {
      succeeded = yield call(() => lease.done);
      return succeeded;
    }
    yield call(() => lease.ready);
    const readyScope = yield select((state: RootState) => ({
      appId: state.storage.appId,
      networkType: state.settings.bitcoinNetworkType,
    }));
    if (
      readyScope.appId !== refreshScope.appId ||
      readyScope.networkType !== refreshScope.networkType ||
      currentBackupAccountSession() !== requestSession
    )
      return false;

    // A queued refresh must start from the latest persisted specs, and a
    // stale route must never supply a snapshot from another profile.
    const currentWallets: (Wallet | Vault)[] = [];
    for (const wallet of wallets) {
      const schema =
        wallet.entityKind === EntityKind.VAULT ? RealmSchema.Vault : RealmSchema.Wallet;
      const currentWallet = yield call(() => {
        assertAccountRealmScope();
        return dbManager.getObjectById(schema, wallet.id);
      });
      if (!currentWallet || currentWallet.networkType !== refreshScope.networkType) return false;
      currentWallets.push(getJSONFromRealmObject(currentWallet) as unknown as Wallet | Vault);
    }
    wallets = currentWallets;
    const recoverableCountersBeforeSync = new Map(wallets.map((wallet) => [wallet.id, {
      nextFreeAddressIndex: wallet.specs.nextFreeAddressIndex,
      nextFreeChangeAddressIndex: wallet.specs.nextFreeChangeAddressIndex,
      totalExternalAddresses: wallet.specs.totalExternalAddresses,
    }]));

    let connectionMatchesScope = false;
    try {
      ElectrumClient.assertConnectionGeneration(
        ElectrumClient.getConnectionGeneration(),
        refreshScope.networkType
      );
      connectionMatchesScope = true;
    } catch {
      // Reconnect using the current account's saved nodes below.
    }
    if (!ELECTRUM_CLIENT.isClientConnected || !connectionMatchesScope) {
      ElectrumClient.resetCurrentPeerIndex();
      yield call(connectToNodeWorker, {
        originAppId: sourceAppId,
        originBackupAccountSession: requestSession,
        originBackupWriteIntent,
      });
    }

    assertAccountRealmScope();
    if (!ELECTRUM_CLIENT.isClientConnected) throw new Error(ELECTRUM_NOT_CONNECTED_ERR);

    const connectionGeneration = ElectrumClient.getConnectionGeneration();
    const assertCurrentScope = () => {
      assertAccountRealmScope();
      try {
        ElectrumClient.assertConnectionGeneration(connectionGeneration, refreshScope.networkType);
      } catch {
        throw new Error(ELECTRUM_NOT_CONNECTED_ERR);
      }
    };
    assertCurrentScope();

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
      const {specs} = (wallet as any);
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
      options.hardRefresh,
      assertCurrentScope
    );
    assertCurrentScope();

    let labels: { ref: string; label: string; isSystem: boolean }[];

    if (synchedWallets && synchedWallets.some((wallet) => wallet.newUTXOs.length > 0)) {
      labels = yield call(dbManager.getCollection, RealmSchema.Tags);
    }
    for (const synchedWalletWithUTXOs of synchedWallets) {
      const currentScope = yield select((state: RootState) => ({
        appId: state.storage.appId,
        networkType: state.settings.bitcoinNetworkType,
      }));
      if (
        currentScope.appId !== refreshScope.appId ||
        currentScope.networkType !== refreshScope.networkType
      )
        return false;
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

        if (labelChanges.added.length || labelChanges.deleted.length) {
          assertCurrentScope();
          yield call(bulkUpdateLabelsWorker, {
            originAppId: sourceAppId,
            originBackupAccountSession: requestSession,
            originBackupWriteIntent,
            payload: {
              labelChanges,
              UTXO: utxo,
              wallet: synchedWallet as any,
              scope: refreshScope,
            },
          });
          assertCurrentScope();
        }

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

      if (
        synchedWallet.entityKind === EntityKind.VAULT &&
        synchedWallet.type === VaultType.CANARY
      ) {
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
            assertCurrentScope();
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

      const { taintedAddresses, initialTaintAddresses, dustSpendTxids } = classifyDustByAddress(
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
      const writeScope = yield select((state: RootState) => ({
        appId: state.storage.appId,
        networkType: state.settings.bitcoinNetworkType,
      }));
      if (
        writeScope.appId !== refreshScope.appId ||
        writeScope.networkType !== refreshScope.networkType
      )
        return false;
      const persisted = yield call(() => {
        assertCurrentScope();
        return dbManager.updateObjectById(
          synchedWallet.entityKind === EntityKind.VAULT ? RealmSchema.Vault : RealmSchema.Wallet,
          synchedWallet.id,
          { specs: synchedWallet.specs }
        );
      });
      if (!persisted) throw new Error('Failed to persist refreshed wallet');
      const priorCounters = recoverableCountersBeforeSync.get(synchedWallet.id);
      const counterChanged = priorCounters && (
        priorCounters.nextFreeAddressIndex !== synchedWallet.specs.nextFreeAddressIndex ||
        priorCounters.nextFreeChangeAddressIndex !== synchedWallet.specs.nextFreeChangeAddressIndex ||
        priorCounters.totalExternalAddresses !== synchedWallet.specs.totalExternalAddresses
      );
      if (counterChanged) {
        const backupEnabled = yield select((state: RootState) =>
          isAutomaticCloudBackupEnabled(state.bhr, sourceAppId)
        );
        if (backupEnabled) {
          markBackupMutation(sourceAppId);
          yield put(invalidateBackupRepair(sourceAppId));
          yield put(setPendingAllBackup({ appId: sourceAppId, pending: true }));
        }
      }

      if (options.addNotifications && newDustUTXOs.length > 0) {
        yield put(setPendingDustToast(synchedWallet.id));
      }
    } // end for (synchedWalletWithUTXOs)
    succeeded = true;
    return true;
  } catch (err) {
    if (!isSourceAccountCurrent() || err?.message === WALLET_SYNC_SCOPE_CHANGED) return false;
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
    return false;
  } finally {
    if (lease?.owner) {
      if (isSourceAccountCurrent()) yield put(setSyncing({ wallets, isSyncing: false }));
      lease.complete(succeeded);
    }
    if (requestId && isSourceAccountCurrent())
      yield put(finishRefreshRequest({ requestId, succeeded }));
  }
}

export const refreshWalletsWatcher = createWatcher(refreshWalletsWorker, REFRESH_WALLETS);

export function* autoWalletsSyncWorker({
  payload,
  originAppId,
  originBackupAccountSession,
  originBackupWriteIntent,
}: {
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
  payload: {
    syncAll?: boolean;
    hardRefresh?: boolean;
    addNotifications?: boolean;
    backupCheckAppId?: string;
    archivedOnly?: boolean;
    requestId?: string;
  };
}) {
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  const { syncAll, hardRefresh, addNotifications, backupCheckAppId, archivedOnly, requestId } =
    payload;
  let activeSucceeded = true;
  let archivedSucceeded = true;
  const isSourceAccountCurrent = () =>
    !!sourceAppId &&
    currentWalletAccountId() === sourceAppId &&
    store.getState().storage.appId === sourceAppId &&
    currentBackupAccountSession() === requestSession;
  try {
    if (!isSourceAccountCurrent()) {
      activeSucceeded = false;
      archivedSucceeded = false;
      return;
    }
    const syncScope = yield select((state: RootState) => ({
      appId: state.storage.appId,
      networkType: state.settings.bitcoinNetworkType,
    }));
    if (syncScope.appId !== sourceAppId || !isSourceAccountCurrent()) {
      activeSucceeded = false;
      archivedSucceeded = false;
      return;
    }
    const wallets: Wallet[] = yield call(
      dbManager.getObjectByIndex,
      RealmSchema.Wallet,
      null,
      true
    );
    if (!isSourceAccountCurrent()) {
      activeSucceeded = false;
      archivedSucceeded = false;
      return;
    }
    const vaults: Vault[] = yield call(dbManager.getObjectByIndex, RealmSchema.Vault, null, true);
    const currentAppId = yield select((state: RootState) => state.storage.appId);
    const currentNetworkType = yield select(
      (state: RootState) => state.settings.bitcoinNetworkType
    );
    if (
      currentAppId !== sourceAppId ||
      currentNetworkType !== syncScope.networkType ||
      !isSourceAccountCurrent()
    ) {
      activeSucceeded = false;
      archivedSucceeded = false;
      return;
    }
    const { active, archived } = selectWalletsForSync(
      wallets || [],
      vaults || [],
      syncScope.networkType,
      { syncAll, archivedOnly }
    );

    if (active.length) {
      activeSucceeded = yield call(refreshWalletsWorker, {
        originAppId: sourceAppId,
        originBackupAccountSession: requestSession,
        originBackupWriteIntent,
        payload: {
          wallets: active.map((wallet) => getJSONFromRealmObject(wallet) as unknown as Wallet | Vault),
          options: { hardRefresh, addNotifications },
        },
      });
    }
    const beforeArchive = yield select((state: RootState) => ({
      appId: state.storage.appId,
      networkType: state.settings.bitcoinNetworkType,
    }));
    if (
      beforeArchive.appId !== sourceAppId ||
      beforeArchive.networkType !== syncScope.networkType ||
      !isSourceAccountCurrent()
    ) {
      activeSucceeded = false;
      archivedSucceeded = false;
      return;
    }
    // Retained archived vaults are checked even when empty or hidden. Their
    // transactions are persisted, while notification and transfer UX belongs to R09.
    if (archived.length) {
      archivedSucceeded = yield call(refreshWalletsWorker, {
        originAppId: sourceAppId,
        originBackupAccountSession: requestSession,
        originBackupWriteIntent,
        payload: {
          wallets: archived.map(
            (wallet) => getJSONFromRealmObject(wallet) as unknown as Wallet | Vault
          ),
          options: { hardRefresh, addNotifications: false },
        },
      });
    }

    // Inspect the originating account only after every refreshed spec is persisted.
    if (
      backupCheckAppId === sourceAppId &&
      activeSucceeded &&
      archivedSucceeded &&
      isSourceAccountCurrent() &&
      store.getState().settings.bitcoinNetworkType === syncScope.networkType
    ) {
      const {
        automaticCloudBackupByAppId,
        pendingAllBackupByAppId,
        backupRepairCompletedByAppId = {},
      } = yield select((state: RootState) => state.bhr);
      if (
        isSourceAccountCurrent() &&
        store.getState().settings.bitcoinNetworkType === syncScope.networkType &&
        isAutomaticCloudBackupEnabled({ automaticCloudBackupByAppId }, sourceAppId) &&
        (pendingAllBackupByAppId?.[sourceAppId] || !backupRepairCompletedByAppId[sourceAppId])
      ) {
        yield put({
          ...checkBackupFreshness(sourceAppId),
          originBackupAccountSession: requestSession,
          originBackupWriteIntent,
        });
      }
    }
  } catch (err) {
    activeSucceeded = false;
    archivedSucceeded = false;
    captureError(err);
  } finally {
    if (requestId && isSourceAccountCurrent()) {
      yield put(
        finishRefreshRequest({
          requestId,
          succeeded: activeSucceeded && archivedSucceeded,
        })
      );
    }
  }
}

export const autoWalletsSyncWatcher = createWatcher(autoWalletsSyncWorker, AUTO_SYNC_WALLETS);

export function* updateSignerPolicyWorker({
  payload,
  originAppId,
  originBackupAccountSession,
  originBackupWriteIntent,
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
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
}) {
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  const { signer, signingKey, updates, verificationToken } = payload;
  try {
    assertWalletAccount(sourceAppId, requestSession);
    const operation = beginBackupLocalOperation(sourceAppId, originBackupWriteIntent, requestSession);
    const fcmToken = yield select((state: RootState) => state.notifications.fcmToken);
    const { bitcoinNetwork } = yield select((state: RootState) => state.settings);
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
    assertWalletAccount(sourceAppId, requestSession);

    if (delayedPolicyUpdate) {
      yield put(updateDelayedPolicyUpdate(delayedPolicyUpdate));
    } else {
      if (!updated) {
        Alert.alert('Failed to update signer policy, try again.');
        throw new Error('Failed to update the policy');
      }

      const committedOperation = commitBackupLocalOperation(operation, (localRealm) => {
        const stored = localRealm.objectForPrimaryKey(RealmSchema.Signer, getKeyUID(signer));
        if (!stored) throw new Error('Signer is missing');
        stored.signerPolicy = { ...(getJSONFromRealmObject(stored) as unknown as Signer).signerPolicy, ...updates };
      });
      if (!committedOperation.committed) throw new Error('Signer policy could not be saved');
      yield call(updateAppImageWorker, { payload: { signers: [signer] },
        originAppId: sourceAppId, originBackupAccountSession: requestSession, committedOperation });
    }
    assertWalletAccount(sourceAppId, requestSession);
    yield put(setSignerPolicyError('success'));
  } catch (err) {
    if (currentWalletAccountId() === sourceAppId &&
        store.getState().storage.appId === sourceAppId &&
        currentBackupAccountSession() === requestSession)
      yield put(setSignerPolicyError('failure'));
  }
}

export const updateSignerPolicyWatcher = createWatcher(
  updateSignerPolicyWorker,
  UPDATE_SIGNER_POLICY
);

export function* testcoinsWorker({ payload, originAppId, originBackupAccountSession, originBackupWriteIntent }) {
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  let { wallet } = payload;
  const faucetScope = yield select((state: RootState) => ({
    appId: state.storage.appId,
    networkType: state.settings.bitcoinNetworkType,
  }));
  const isCurrentFaucetScope = () => {
    const state = store.getState();
    try {
      const keeperApp = dbManager.getObjectByIndex(RealmSchema.KeeperApp) as unknown as KeeperApp;
      return (
        (!originAppId || originAppId === faucetScope.appId) &&
        state.storage.appId === faucetScope.appId &&
        state.settings.bitcoinNetworkType === faucetScope.networkType &&
        faucetScope.networkType === wallet.networkType &&
        keeperApp?.id === faucetScope.appId &&
        currentBackupAccountSession() === requestSession
      );
    } catch {
      return false;
    }
  };

  if (!isCurrentFaucetScope()) return;
  const currentWallet = yield call(() => {
    if (!isCurrentFaucetScope()) return null;
    const schema = wallet.entityKind === EntityKind.VAULT ? RealmSchema.Vault : RealmSchema.Wallet;
    const stored = dbManager.getObjectById(schema, wallet.id);
    if (
      !stored ||
      stored.networkType !== wallet.networkType ||
      stored.entityKind !== wallet.entityKind
    )
      return null;
    return getJSONFromRealmObject(stored);
  });
  if (!currentWallet || !isCurrentFaucetScope()) return;
  wallet = currentWallet;
  yield put(setTestCoinsReceived(false));
  yield put(setTestCoinsFailed(false));
  yield put(setTestCoinsPending(null));

  if (wallet.networkType !== NetworkType.TESTNET) {
    yield put(setTestCoinsFailed(true));
    return;
  }

  let receivingAddress: string;
  let network: ReturnType<typeof WalletUtilities.getNetworkByType>;
  let txid: string;
  try {
    receivingAddress = WalletOperations.getNextFreeAddress(wallet);
    network = WalletUtilities.getNetworkByType(wallet.networkType);
    const response = yield call(() => {
      if (!isCurrentFaucetScope()) return null;
      return Relay.getTestcoins(receivingAddress, wallet.networkType, faucetScope.appId);
    });
    if (!response) return;
    txid = response.txid;
  } catch (err) {
    if (!isCurrentFaucetScope()) return;
    if (err.message === 'FAUCET_DAILY_LIMIT_REACHED') {
      yield put(setTestCoinsQuotaReached(true));
    } else if (err.message === 'FAUCET_OUTCOME_UNKNOWN') {
      yield put(setTestCoinsPending('unknown'));
    } else {
      yield put(setTestCoinsFailed(true));
    }
    return;
  }

  if (!isCurrentFaucetScope()) return;

  let lastAttemptSynced = false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let attemptSynced = false;
    try {
      if (!isCurrentFaucetScope()) return;
      let connectionMatchesScope = false;
      try {
        ElectrumClient.assertConnectionGeneration(
          ElectrumClient.getConnectionGeneration(),
          wallet.networkType
        );
        connectionMatchesScope = true;
      } catch {
        // The old profile or network's connection must not be reused.
      }
      if (!ELECTRUM_CLIENT.isClientConnected || !connectionMatchesScope) {
        yield call(connectToNodeWorker, {
          originAppId: faucetScope.appId,
          originBackupAccountSession: requestSession,
          originBackupWriteIntent,
        });
      }
      if (!isCurrentFaucetScope()) return;
      const connectionGeneration = ElectrumClient.getConnectionGeneration();
      ElectrumClient.assertConnectionGeneration(connectionGeneration, wallet.networkType);
      const { txids } = yield call(
        [ElectrumClient, ElectrumClient.syncHistoryByAddress],
        [receivingAddress],
        network
      );
      ElectrumClient.assertConnectionGeneration(connectionGeneration, wallet.networkType);
      if (!isCurrentFaucetScope()) return;
      attemptSynced = true;
      if (txids.some((seenTxid: string) => seenTxid.toLowerCase() === txid.toLowerCase())) {
        const refreshed = yield call(refreshWalletsWorker, {
          originAppId: faucetScope.appId,
          originBackupAccountSession: requestSession,
          originBackupWriteIntent,
          payload: { wallets: [wallet], options: { hardRefresh: true } },
        });
        if (refreshed) {
          const schema =
            wallet.entityKind === EntityKind.VAULT ? RealmSchema.Vault : RealmSchema.Wallet;
          const storedWallet = yield call(dbManager.getObjectById, schema, wallet.id);
          const storedData = storedWallet?.toJSON?.() || storedWallet;
          if (isFaucetTxVisible(storedData, txid)) {
            if (!isCurrentFaucetScope()) return;
            yield put(setTestCoinsReceived(true));
            return;
          }
        } else attemptSynced = false;
      }
    } catch (err) {
      attemptSynced = false;
    }
    lastAttemptSynced = attemptSynced;
    if (attempt < 7) yield delay(4000);
  }
  if (!isCurrentFaucetScope()) return;
  yield put(setTestCoinsPending(lastAttemptSynced ? 'propagation' : 'sync'));
}

export const testcoinsWatcher = createWatcher(testcoinsWorker, TEST_SATS_RECIEVE);

function* updateWalletDetailsWorker({ payload, originAppId, originBackupAccountSession, originBackupWriteIntent }) {
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  try {
    assertWalletAccount(sourceAppId, requestSession);
    const operation = beginBackupLocalOperation(sourceAppId, originBackupWriteIntent, requestSession);
    const committedOperation = commitBackupLocalOperation(operation, (localRealm) => {
      const stored = localRealm.objectForPrimaryKey(RealmSchema.Wallet, payload.wallet.id);
      if (!stored) throw new Error('Wallet is missing');
      stored.presentationData = { ...(getJSONFromRealmObject(stored) as unknown as Wallet).presentationData,
        name: payload.details.name, description: payload.details.description };
    });
    if (!committedOperation.committed) throw new Error('Local wallet update failed');
    yield call(updateAppImageWorker, { payload: { wallets: [payload.wallet] },
      originAppId: sourceAppId, originBackupAccountSession: requestSession, committedOperation });
    assertWalletAccount(sourceAppId, requestSession);
    yield put(relayWalletUpdateSuccess());
    return true;
  } catch {
    if (currentWalletAccountId() === sourceAppId && currentBackupAccountSession() === requestSession)
      yield put(relayWalletUpdateFail('Wallet changes could not be saved'));
    return false;
  }
}

export const updateWalletDetailWatcher = createWatcher(updateWalletDetailsWorker, UPDATE_WALLET_DETAILS);

function* updateVaultDetailsWorker({ payload, originAppId, originBackupAccountSession, originBackupWriteIntent }) {
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  try {
    assertWalletAccount(sourceAppId, requestSession);
    const operation = beginBackupLocalOperation(sourceAppId, originBackupWriteIntent, requestSession);
    const committedOperation = commitBackupLocalOperation(operation, (localRealm) => {
      const stored = localRealm.objectForPrimaryKey(RealmSchema.Vault, payload.vault.id);
      if (!stored) throw new Error('Vault is missing');
      stored.presentationData = { ...(getJSONFromRealmObject(stored) as unknown as Wallet).presentationData,
        name: payload.details.name, description: payload.details.description };
    });
    if (!committedOperation.committed) throw new Error('Local vault update failed');
    yield call(updateVaultImageWorker, { payload: { vault: payload.vault, isUpdate: true },
      originAppId: sourceAppId, originBackupAccountSession: requestSession, committedOperation });
    assertWalletAccount(sourceAppId, requestSession);
    yield put(relayVaultUpdateSuccess());
    return true;
  } catch {
    if (currentWalletAccountId() === sourceAppId && currentBackupAccountSession() === requestSession)
      yield put(relayVaultUpdateFail('Vault changes could not be saved'));
    return false;
  }
}

export const updateVaultDetailsWatcher = createWatcher(updateVaultDetailsWorker, UPDATE_VAULT_DETAILS);

// Hiding an entity changes its encrypted recovery record. The local change and
// revisioned upload must share one producer before a later Delete can proceed.
export function* updateRecoveryVisibilityWorker({
  payload, originAppId, originBackupAccountSession, originBackupWriteIntent, onLocalComplete,
}: {
  payload: {
    entityId: string;
    entityKind: EntityKind.WALLET | EntityKind.VAULT;
    visibility: VisibilityType;
  };
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
  onLocalComplete?: (updated: boolean) => void;
}) {
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  let localCommitted = false;
  const reportLocalCommit = (updated: boolean) => {
    try {
      onLocalComplete?.(updated);
    } catch (error) {
      captureError(error);
    }
  };
  try {
    assertWalletAccount(sourceAppId, requestSession);
    const schema = payload.entityKind === EntityKind.VAULT
      ? RealmSchema.Vault : payload.entityKind === EntityKind.WALLET
      ? RealmSchema.Wallet : undefined;
    if (!schema || ![VisibilityType.DEFAULT, VisibilityType.HIDDEN].includes(payload.visibility))
      throw new Error('Invalid recovery visibility change');
    const operation = beginBackupLocalOperation(sourceAppId, originBackupWriteIntent, requestSession);
    const committedOperation = commitBackupLocalOperation(operation, (localRealm) => {
      const stored = localRealm.objectForPrimaryKey(schema, payload.entityId);
      if (!stored) throw new Error('Recovery visibility target is missing');
      stored.presentationData = {
        ...(getJSONFromRealmObject(stored) as unknown as Wallet | Vault).presentationData,
        visibility: payload.visibility,
      };
    });
    if (!committedOperation.committed) throw new Error('Local recovery visibility update failed');
    localCommitted = true;
    assertWalletAccount(sourceAppId, requestSession);
    reportLocalCommit(true);
    const stored = dbManager.getObjectById(schema, payload.entityId);
    if (!stored) throw new Error('Committed recovery visibility target is missing');
    if (schema === RealmSchema.Vault)
      yield call(updateVaultImageWorker, {
        payload: { vault: getJSONFromRealmObject(stored) as unknown as Vault, isUpdate: true },
        originAppId: sourceAppId, originBackupAccountSession: requestSession, committedOperation,
      });
    else
      yield call(updateAppImageWorker, {
        payload: { wallets: [getJSONFromRealmObject(stored) as unknown as Wallet] },
        originAppId: sourceAppId, originBackupAccountSession: requestSession, committedOperation,
      });
    assertWalletAccount(sourceAppId, requestSession);
    return true;
  } catch {
    if (!localCommitted) reportLocalCommit(false);
    return localCommitted;
  }
}

export const updateRecoveryVisibilityWatcher = createWatcher(
  updateRecoveryVisibilityWorker, UPDATE_RECOVERY_VISIBILITY
);

export function* updateSignerDetailsWorker({ payload, originAppId, originBackupAccountSession, originBackupWriteIntent }) {
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  try {
    assertWalletAccount(sourceAppId, requestSession);
    const operation = beginBackupLocalOperation(sourceAppId, originBackupWriteIntent, requestSession);
    const committedOperation = commitBackupLocalOperation(operation, (localRealm) => {
      const stored = localRealm.objectForPrimaryKey(RealmSchema.Signer, getKeyUID(payload.signer));
      if (!stored) throw new Error('Signer is missing');
      stored[payload.key] = payload.value;
    });
    if (!committedOperation.committed) throw new Error('Local signer update failed');
    yield call(updateAppImageWorker, { payload: { signers: [payload.signer] },
      originAppId: sourceAppId, originBackupAccountSession: requestSession, committedOperation });
    assertWalletAccount(sourceAppId, requestSession);
    yield put(relaySignersUpdateSuccess(false));
    return true;
  } catch {
    if (currentWalletAccountId() === sourceAppId && currentBackupAccountSession() === requestSession)
      yield put(relaySignersUpdateFail('Key changes could not be saved'));
    return false;
  }
}

export const updateSignerDetails = createWatcher(updateSignerDetailsWorker, UPDATE_SIGNER_DETAILS);

function* updateKeyDetailsWorker({ payload, originAppId, originBackupAccountSession, originBackupWriteIntent }) {
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  try {
    assertWalletAccount(sourceAppId, requestSession);
    const operation = beginBackupLocalOperation(sourceAppId, originBackupWriteIntent, requestSession);
    const affectedVaultIds = new Set<string>();
    const committedOperation = commitBackupLocalOperation(operation, (localRealm) => {
      const stored = localRealm.objectForPrimaryKey(RealmSchema.VaultSigner, payload.signer.xpub);
      if (!stored) throw new Error('Vault key is missing');
      if (payload.key === 'registered') {
        const registrations = Array.from(stored.registeredVaults || []).map((entry: any) => ({
          vaultId: entry.vaultId, registered: entry.registered,
          registrationInfo: entry.registrationInfo, hmac: entry.hmac,
        }));
        const previous = registrations.findIndex((entry) => entry.vaultId === payload.value.vaultId);
        if (previous < 0) registrations.push(payload.value);
        else registrations[previous] = { ...registrations[previous], ...payload.value };
        stored.registeredVaults = registrations;
      } else stored[payload.key] = payload.value;
      for (const vault of localRealm.objects(RealmSchema.Vault)) {
        if (vault.signers.some((key) => key.xpub === stored.xpub)) affectedVaultIds.add(vault.id);
      }
    });
    if (!committedOperation.committed) throw new Error('Local key update failed');
    const mutations = Array.from(affectedVaultIds).map((vaultId) => buildAutomaticVaultMutation(vaultId, sourceAppId));
    if (payload.key === 'registered' && mutations.length)
      yield call(queueCommittedBackupWorker, sourceAppId, committedOperation, mutations, requestSession);
    assertWalletAccount(sourceAppId, requestSession);
    return true;
  } catch {
    if (currentWalletAccountId() === sourceAppId && currentBackupAccountSession() === requestSession)
      yield put(relaySignersUpdateFail('Key changes could not be saved'));
    return false;
  }
}

export const updateKeyDetails = createWatcher(updateKeyDetailsWorker, UPDATE_KEY_DETAILS);

function* deleteVaultWorker({ payload, originAppId, originBackupAccountSession, originBackupWriteIntent, onComplete }) {
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  const reportsThroughCallback = typeof onComplete === 'function';
  try {
    assertWalletAccount(sourceAppId, requestSession);
    if (!reportsThroughCallback) yield put(setRelayVaultUpdateLoading(true));
    const operation = beginBackupLocalOperation(sourceAppId, originBackupWriteIntent, requestSession);
    const committedOperation = commitBackupLocalOperation(operation, (localRealm) => {
      const stored = localRealm.objectForPrimaryKey(RealmSchema.Vault, payload.vaultId);
      if (!stored) throw new Error('Vault deletion target is missing');
      localRealm.delete(stored);
    });
    if (!committedOperation.committed) throw new Error('Local vault deletion failed');
    yield call(deleteVaultImageWorker, { payload: { vaultIds: [payload.vaultId] },
      originAppId: sourceAppId, originBackupAccountSession: requestSession, committedOperation });
    assertWalletAccount(sourceAppId, requestSession);
    if (!reportsThroughCallback) yield put(relayVaultUpdateSuccess());
    return true;
  } catch {
    if (!reportsThroughCallback && currentWalletAccountId() === sourceAppId &&
      currentBackupAccountSession() === requestSession)
      yield put(relayVaultUpdateFail('Vault deletion could not be saved'));
    return false;
  } finally {
    if (!reportsThroughCallback && currentWalletAccountId() === sourceAppId &&
      currentBackupAccountSession() === requestSession)
      yield put(setRelayVaultUpdateLoading(false));
  }
}

function* deleteVaultRequestWorker(
  action: Parameters<typeof deleteVaultWorker>[0] & { onComplete?: (deleted: boolean) => void }
) {
  let deleted = false;
  try {
    deleted = (yield call(deleteVaultWorker, action)) === true;
  } catch (error) {
    captureError(error);
  } finally {
    if (action.onComplete) {
      try {
        action.onComplete(deleted);
      } catch (error) {
        captureError(error);
      }
    }
  }
  return deleted;
}

export const deleteVaultyWatcher = createWatcher(deleteVaultRequestWorker, DELETE_VAULT);

function* reinstateVaultWorker({ payload, originAppId, originBackupAccountSession, originBackupWriteIntent }) {
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  try {
    assertWalletAccount(sourceAppId, requestSession);
    const operation = beginBackupLocalOperation(sourceAppId, originBackupWriteIntent, requestSession);
    const changedSigners: Signer[] = [];
    const committedOperation = commitBackupLocalOperation(operation, (localRealm) => {
      const vault = localRealm.objectForPrimaryKey(RealmSchema.Vault, payload.vaultId);
      if (!vault) throw new Error('Vault is missing');
      vault.archived = false;
      vault.isMigrating = false;
      vault.archivedId = null;
      vault.presentationData = { ...(getJSONFromRealmObject(vault) as unknown as Vault).presentationData, visibility: VisibilityType.DEFAULT };
      for (const key of vault.signers) {
        const stored = localRealm.objectForPrimaryKey(RealmSchema.Signer, getKeyUID(key));
        if (!stored) throw new Error('A vault signer is missing');
        stored.archived = false;
        changedSigners.push(getJSONFromRealmObject(stored) as unknown as Signer);
      }
    });
    if (!committedOperation.committed) throw new Error('Local vault reinstatement failed');
    yield call(queueCommittedBackupWorker, sourceAppId, committedOperation, [
      buildAutomaticAppMutation({ signers: changedSigners }, sourceAppId),
      buildAutomaticVaultMutation(payload.vaultId, sourceAppId),
    ], requestSession);
    assertWalletAccount(sourceAppId, requestSession);
    yield put(relayVaultUpdateSuccess());
    return true;
  } catch {
    if (currentWalletAccountId() === sourceAppId && currentBackupAccountSession() === requestSession)
      yield put(relayVaultUpdateFail('Vault changes could not be saved'));
    return false;
  }
}

export const reinstateVaultWatcher = createWatcher(reinstateVaultWorker, REINSTATE_VAULT);

function* refillMobileKeyWorker({ payload, originAppId, originBackupAccountSession, originBackupWriteIntent }) {
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  const { vaultKey } = payload;
  try {
    assertWalletAccount(sourceAppId, requestSession);
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
          originAppId: sourceAppId,
          originBackupAccountSession: requestSession,
          originBackupWriteIntent,
          payload: { signer: signer.signerXpubs[XpubTypes.P2WSH][0], key: 'xpriv', value: xpriv },
        });
      }
    }
  } catch (err) {
    captureError(err);
  }
}

export const refillMobileKeyWatcher = createWatcher(refillMobileKeyWorker, REFILL_MOBILEKEY);

function* refreshCanaryWalletsWorker({
  originAppId,
  originBackupAccountSession,
  originBackupWriteIntent,
}: {
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
} = {}) {
  try {
    const sourceAppId = originAppId || currentWalletAccountId();
    const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
    assertWalletAccount(sourceAppId, requestSession);
    const vaults: Vault[] = yield call(dbManager.getCollection, RealmSchema.Vault);
    const canaryWallets = vaults.filter((vault) => vault.type === VaultType.CANARY);
    if (canaryWallets.length) {
      yield call(refreshWalletsWorker, {
        originAppId: sourceAppId,
        originBackupAccountSession: requestSession,
        originBackupWriteIntent,
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

function* mergeSimilarKeysWorker({ payload, originAppId, originBackupAccountSession, originBackupWriteIntent }: {
  payload: { signer: Signer };
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
}) {
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  try {
    assertWalletAccount(sourceAppId, requestSession);
    const operation = beginBackupLocalOperation(sourceAppId, originBackupWriteIntent, requestSession);
    const existing: Signer[] = Array.from(dbManager.getCollection(RealmSchema.Signer))
      .map((signer: any) => signer.toJSON ? getJSONFromRealmObject(signer) as unknown as Signer : _.cloneDeep(signer));
    const changes = planSignerIdentityMerges(existing, [payload.signer]);
    if (!changes.length) return false;
    let affectedVaultIds = new Set<string>();
    const committedOperation = commitBackupLocalOperation(operation, (localRealm) => {
      affectedVaultIds = applySignerIdentityMerges(localRealm, changes);
    });
    if (!committedOperation.committed) return false;
    yield call(queueCommittedBackupWorker, sourceAppId, committedOperation, [
      buildAutomaticAppMutation({ signers: changes.map((change) => change.signer) }, sourceAppId),
      ...Array.from(affectedVaultIds).map((vaultId) => buildAutomaticVaultMutation(vaultId, sourceAppId)),
      buildSignerMigrationMutation(sourceAppId, changes),
    ], requestSession);
    assertWalletAccount(sourceAppId, requestSession);
    return true;
  } catch (error) {
    captureError(error);
    return false;
  }
}

export const mergeSimilarKeysWatcher = createWatcher(mergeSimilarKeysWorker, MERGER_SIMILAR_KEYS);

function* generateNewExternalAddressWorker({ payload, originAppId, originBackupAccountSession, originBackupWriteIntent }: {
  payload: { wallet: Wallet | Vault };
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
}) {
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  try {
    assertWalletAccount(sourceAppId, requestSession);
    const operation = beginBackupLocalOperation(sourceAppId, originBackupWriteIntent, requestSession);
    const schema = payload.wallet.entityKind === EntityKind.VAULT ? RealmSchema.Vault : RealmSchema.Wallet;
    const committedOperation = commitBackupLocalOperation(operation, (localRealm) => {
      const stored = localRealm.objectForPrimaryKey(schema, payload.wallet.id);
      if (!stored) throw new Error('Wallet is missing');
      stored.specs.totalExternalAddresses += 1;
    });
    if (!committedOperation.committed) return false;
    const mutations = schema === RealmSchema.Vault
      ? [buildAutomaticVaultMutation(payload.wallet.id, sourceAppId)]
      : [buildAutomaticAppMutation({ wallets: [payload.wallet as Wallet] }, sourceAppId)];
    yield call(queueCommittedBackupWorker, sourceAppId, committedOperation, mutations, requestSession);
    return true;
  } catch {
    return false;
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

function* updateVaultSignerXprivWorker({ signers, originAppId, originBackupAccountSession, originBackupWriteIntent }) {
  const sourceAppId = originAppId || currentWalletAccountId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  try {
    assertWalletAccount(sourceAppId, requestSession);
    const operation = beginBackupLocalOperation(sourceAppId, originBackupWriteIntent, requestSession);
    let affectedVaultIds = new Set<string>();
    const committedOperation = commitBackupLocalOperation(operation, (localRealm) => {
      affectedVaultIds = applySignerXprivUpdates(localRealm, signers);
    });
    if (!committedOperation.committed) return false;
    if (affectedVaultIds.size)
      yield call(queueCommittedBackupWorker, sourceAppId, committedOperation,
        Array.from(affectedVaultIds).map((vaultId) => buildAutomaticVaultMutation(vaultId, sourceAppId)), requestSession);
    return true;
  } catch {
    return false;
  }
}

export const updatedVaultSignerXprivWatcher = createWatcher(
  updateVaultSignerXprivWorker,
  UPDATED_VAULT_SIGNERS_XPRIV
);
