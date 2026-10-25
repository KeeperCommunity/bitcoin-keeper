import { buffers, END, eventChannel } from 'redux-saga';
import { inspectBackup, RepairPhase } from 'src/services/backup/repair';
import {
  hasRecoveryRecords,
  prepareRecoveryImage,
  prepareRecoverySourceImage,
} from 'src/services/backup/restore';
import type {
  BackupRecoverySource, ProtectedBackupState, RecoveryProvenance,
} from 'src/services/backup/restore';
import { readProtectedBackup, sameProtectedBackupBase } from 'src/services/backup/protected';
import { BackupImage, pauseBackup, validateProtectedRecoveryMetadata } from 'src/services/backup/image';
import {
  backupRevision,
  captureBackupWriteIntent,
  currentBackupAccountSession,
  backupConsentEpoch,
  protectBackupConsentCompletion,
  protectBackupRecoveryConsentDisable,
  clearVerifiedRemoteRevision,
  notifyBackupReconciliation,
  markBackupMutation,
} from 'src/services/backup/transport';
import type { BackupWriteIntent } from 'src/services/backup/intent';
import { beginBackupLocalOperation, commitBackupLocalOperation, enqueueAutomaticBackupOperation, beginBackupDeleteOperation, isBackupVerificationCurrent, isAutomaticBackupResultCurrent } from 'src/services/backup/automatic';
import type { BackupLocalCommit } from 'src/services/backup/automatic';
import * as bip39 from 'bip39';
import { Wallet } from 'src/services/wallets/interfaces/wallet';
import { call, put, select, takeMaybe, takeEvery, takeLatest, cancelled } from 'redux-saga/effects';
import config from 'src/utils/service-utilities/config';
import { translations } from 'src/context/Localization/LocContext';
import { encrypt, generateEncryptionKey, hash256 } from 'src/utils/service-utilities/encryption';
import BIP85 from 'src/services/wallets/operations/BIP85';
import DeviceInfo from 'react-native-device-info';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import { RealmSchema } from 'src/storage/realm/enum';
import Relay from 'src/services/backend/Relay';
import {
  HealthCheckDetails,
  Signer,
  Vault,
  VaultSigner,
} from 'src/services/wallets/interfaces/vault';
import { captureError } from 'src/services/sentry';
import crypto from 'crypto';
import dbManager from 'src/storage/realm/dbManager';
import moment from 'moment';
import WalletUtilities from 'src/services/wallets/operations/utils';
import semver from 'semver';
import { NodeDetail } from 'src/services/wallets/interfaces';
import { AppSubscriptionLevel, SubscriptionTier } from 'src/models/enums/SubscriptionTier';
import { BackupAction, BackupType, CloudBackupAction } from 'src/models/enums/BHR';
import { getSignerNameFromType } from 'src/hardware';
import {
  DerivationPurpose,
  EntityKind,
  NetworkType,
  VaultType,
  WalletType,
} from 'src/services/wallets/enums';
import { uaiType } from 'src/models/interfaces/Uai';
import { Platform } from 'react-native';
import CloudBackupModule from 'src/nativemodules/CloudBackup';
import { generateOutputDescriptors } from 'src/utils/service-utilities/utils';
import { hcStatusType } from 'src/models/interfaces/HeathCheckTypes';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';
import { setupRecoveryKeySigningKey } from 'src/hardware/signerSetup';
import {
  getKeyUID,
  sanitizeSeedKeyForBackup,
  sanitizeVaultSignersForSeedKeyBackup,
} from 'src/utils/utilities';
import NetInfo from '@react-native-community/netinfo';
import { USDTWallet } from 'src/services/wallets/factories/USDTWalletFactory';
import { autoSyncWallets, updateSignerDetails } from '../sagaActions/wallets';
import { createWatcher } from '../utilities';
import {
  appImagerecoveryRetry,
  setAppImageError,
  setAutomaticCloudBackup,
  isAutomaticCloudBackupEnabled,
  setBackupAllFailure,
  setBackupAllLoading,
  setBackupAllSuccess,
  setBackupRepairState,
  commitBackupInspection,
  setBackupRepairRunning,
  invalidateBackupRepair,
  setBackupLoading,
  setBackupType,
  setDeleteBackupFailure,
  setDeleteBackupSuccess,
  setIsCloudBsmsBackupRequired,
  setPendingAllBackup,
  setSeedConfirmed,
  setRecoveryDiscovery,
  setProtectedBackupState,
} from '../reducers/bhr';
import {
  CHECK_BACKUP_FRESHNESS,
  REPAIR_BACKUP,
  BACKUP_ALL_SIGNERS_AND_VAULTS,
  BACKUP_BSMS_ON_CLOUD,
  BSMS_CLOUD_HEALTH_CHECK,
  DELETE_APP_IMAGE_ENTITY,
  DELETE_BACKUP,
  GET_APP_IMAGE,
  getAppImage,
  HEALTH_CHECK_STATUS_UPDATE,
  SEED_BACKEDUP,
  SEED_BACKEDUP_CONFIRMED,
  UPADTE_HEALTH_CHECK_SIGNER,
  UPDATE_APP_IMAGE,
  UPDATE_VAULT_IMAGE,
  VALIDATE_SERVER_BACKUP,
  healthCheckSigner,
} from '../sagaActions/bhr';
import { uaiActioned, uaiChecks } from '../sagaActions/uai';
import { setAppCreated, setAppId, setDefaultWalletCreated } from '../reducers/storage';
import { applyUpgradeSequence, KEY_MANAGEMENT_VERSION } from './upgrade';
import { RootState, store } from '../store';
import { addNewWalletsWorker, addSigningDeviceWorker, NewWalletInfo } from './wallets';
import { addToUaiStackWorker, uaiActionedWorker } from './uai';
import { addAccount, saveDefaultWalletState, setRecoveryKeyStatus } from '../reducers/account';
import { loadConciergeTickets, loadConciergeUser } from '../reducers/concierge';

function currentBackupAppId(): string | undefined {
  try {
    const id = (dbManager.getObjectByIndex(RealmSchema.KeeperApp) as unknown as KeeperApp)?.id;
    return id && store.getState().storage.appId === id ? id : undefined;
  } catch {
    return undefined;
  }
}

// Builders read committed Realm records. Action objects are used only to select
// IDs, never as the recovery payload sent to the server.
export function buildAutomaticAppMutation(
  payload: { wallets?: (Wallet | USDTWallet)[]; signers?: Signer[]; updateNodes?: boolean },
  appId: string
) {
  if (currentBackupAppId() !== appId) throw new Error('Backup account changed');
  const app = getJSONFromRealmObject(dbManager.getObjectByIndex(RealmSchema.KeeperApp)) as unknown as KeeperApp;
  const encryptionKey = generateEncryptionKey(app.primarySeed);
  const walletsObject: Record<string, string> = {};
  const signersObject: Record<string, string> = {};
  for (const selected of payload.wallets || []) {
    const schema = selected.entityKind === EntityKind.USDT_WALLET ? RealmSchema.USDTWallet : RealmSchema.Wallet;
    const stored = dbManager.getObjectById(schema, selected.id);
    if (!stored) throw new Error('Committed wallet is missing');
    walletsObject[selected.id] = encrypt(encryptionKey, JSON.stringify(getJSONFromRealmObject(stored)));
  }
  for (const selected of payload.signers || []) {
    const signerId = getKeyUID(selected);
    const stored = dbManager.getObjectByPrimaryId(RealmSchema.Signer, 'id', signerId);
    if (!stored) throw new Error('Committed signer is missing');
    signersObject[signerId] = encrypt(encryptionKey,
      JSON.stringify(sanitizeSeedKeyForBackup(getJSONFromRealmObject(stored) as unknown as Signer)));
  }
  const nodes = payload.updateNodes
    ? Array.from(dbManager.getCollection(RealmSchema.NodeConnect)).map((node: any) =>
      encrypt(encryptionKey, JSON.stringify({ ...(node.toJSON ? getJSONFromRealmObject(node) : node), isConnected: false })))
    : [];
  return { operation: 'updateAppImage' as const, body: {
    appId, publicId: app.publicId, walletsObject, signersObject,
    networkType: app.networkType, subscription: JSON.stringify(app.subscription),
    version: app.version, nodes, replaceNodes: !!payload.updateNodes,
  } };
}

export function buildAutomaticVaultMutation(vaultId: string, appId: string, isUpdate = true) {
  if (currentBackupAppId() !== appId) throw new Error('Backup account changed');
  const app = getJSONFromRealmObject(dbManager.getObjectByIndex(RealmSchema.KeeperApp)) as unknown as KeeperApp;
  const stored = dbManager.getObjectById(RealmSchema.Vault, vaultId);
  if (!stored) throw new Error('Committed vault is missing');
  const vault = getJSONFromRealmObject(stored) as unknown as Vault;
  return { operation: 'updateVaultImage' as const, body: {
    appId, appID: appId, vaultId, isUpdate,
    vault: encrypt(generateEncryptionKey(app.primarySeed),
      JSON.stringify(sanitizeVaultSignersForSeedKeyBackup(vault))),
    signersData: vault.signers.map((signer) => ({
      signerId: getKeyUID(signer), xfpHash: hash256(signer.masterFingerprint),
    })),
    scheme: vault.scheme,
    isArchived: !!vault.archived, subscription: JSON.stringify(app.subscription),
  } };
}

export function* queueCommittedBackupWorker(
  appId: string,
  committedOperation: BackupLocalCommit | undefined,
  mutations: Parameters<typeof enqueueAutomaticBackupOperation>[1],
  requestSession: number
) {
  if (currentBackupAppId() !== appId || requestSession !== currentBackupAccountSession())
    return { updated: false, backupPending: true, error: 'Backup account changed' };
  if (committedOperation?.committed === false)
    return { updated: false, backupPending: true, error: 'Local recovery operation failed' };
  const enabled = yield select((state: RootState) => isAutomaticCloudBackupEnabled(state.bhr, appId));
  if (!enabled) return { updated: committedOperation?.committed === true,
    backupConfirmed: false, backupPending: false, error: '' };
  yield put(setPendingAllBackup({ appId, pending: true }));
  if (!committedOperation)
    return { updated: false, localCommitted: false, backupConfirmed: false,
      backupPending: true, error: 'Committed local operation is missing' };
  try {
    const result = yield call(enqueueAutomaticBackupOperation, committedOperation, mutations);
    if (currentBackupAppId() !== appId || requestSession !== currentBackupAccountSession())
      return { updated: false, localCommitted: committedOperation.committed,
        backupConfirmed: false, backupPending: true, error: 'Backup account changed' };
    // Cloud confirmation is separate from the successful local commit. A
    // transport failure never rolls back or prevents the user's local change.
    return { ...result, updated: committedOperation.committed, error: '' };
  } catch {
    if (currentBackupAppId() !== appId || requestSession !== currentBackupAccountSession())
      return { updated: false, localCommitted: committedOperation.committed,
        backupConfirmed: false, backupPending: true, error: 'Backup account changed' };
    yield put(setPendingAllBackup({ appId, pending: true }));
    return { updated: committedOperation.committed, backupConfirmed: false, backupPending: true, error: '' };
  }
}

export function* updateAppImageWorker({ payload, originAppId, originBackupAccountSession, committedOperation }: {
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
  committedOperation?: BackupLocalCommit;
  payload: { wallets?: Wallet[] | USDTWallet[]; signers?: Signer[]; updateNodes?: boolean };
}) {
  const appId = originAppId || currentBackupAppId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  if (!appId || currentBackupAppId() !== appId || requestSession !== currentBackupAccountSession())
    return { updated: false, error: 'Backup account changed' };
  try {
    return yield call(queueCommittedBackupWorker, appId, committedOperation,
      [buildAutomaticAppMutation(payload, appId)], requestSession);
  } catch {
    yield put(setPendingAllBackup({ appId, pending: true }));
    return { updated: !!committedOperation?.committed, backupConfirmed: false, backupPending: true, error: 'Committed app image unavailable' };
  }
}

export function* updateVaultImageWorker({ payload, originAppId, originBackupAccountSession, committedOperation }: {
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
  committedOperation?: BackupLocalCommit;
  payload: { vault: Vault; archiveVaultId?: string; isUpdate?: boolean };
}) {
  const appId = originAppId || currentBackupAppId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  if (!appId || currentBackupAppId() !== appId || requestSession !== currentBackupAccountSession())
    return { updated: false, error: 'Backup account changed' };
  try {
    return yield call(queueCommittedBackupWorker, appId, committedOperation,
      [buildAutomaticVaultMutation(payload.vault.id, appId, payload.isUpdate)], requestSession);
  } catch {
    yield put(setPendingAllBackup({ appId, pending: true }));
    return { updated: !!committedOperation?.committed, backupConfirmed: false, backupPending: true, error: 'Committed vault image unavailable' };
  }
}

export function* deleteAppImageEntityWorker({ payload, originAppId, originBackupAccountSession, originBackupWriteIntent }: {
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
  payload: { signerIds?: string[]; walletIds?: string[]; walletSchema?: RealmSchema };
}) {
  const appId = originAppId || currentBackupAppId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  if (!appId || currentBackupAppId() !== appId || requestSession !== currentBackupAccountSession())
    return { updated: false, error: 'Backup account changed' };
  const operation = beginBackupLocalOperation(appId, originBackupWriteIntent, requestSession);
  const walletIds = [...new Set(payload.walletIds || [])];
  const signerIds = [...new Set(payload.signerIds || [])];
  const walletSchema = payload.walletSchema || RealmSchema.Wallet;
  const committedOperation = commitBackupLocalOperation(operation, (localRealm) => {
    for (const vault of localRealm.objects(RealmSchema.Vault)) {
      if (vault.signers.some((key) => signerIds.includes(getKeyUID(key))))
        throw new Error('A retained vault still requires this signer');
    }
    for (const walletId of walletIds) {
      const stored = localRealm.objectForPrimaryKey(walletSchema, walletId);
      if (!stored) throw new Error('Wallet deletion target is missing');
      localRealm.delete(stored);
    }
    for (const signerId of signerIds) {
      const stored = localRealm.objectForPrimaryKey(RealmSchema.Signer, signerId);
      if (!stored) throw new Error('Signer deletion target is missing');
      localRealm.delete(stored);
    }
  });
  if (!committedOperation.committed) return { updated: false, error: 'Local recovery deletion failed' };
  return yield call(queueCommittedBackupWorker, appId, committedOperation, [{
    operation: 'deleteAppImageEntity', body: { appId, walletIds, signers: signerIds },
  }], requestSession);
}

export function* deleteVaultImageWorker({ payload, originAppId, originBackupAccountSession, committedOperation }: {
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
  committedOperation?: BackupLocalCommit;
  payload: { vaultIds: string[] };
}) {
  const appId = originAppId || currentBackupAppId();
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  if (!appId) return { updated: false, error: 'Backup account changed' };
  return yield call(queueCommittedBackupWorker, appId, committedOperation, [{
    operation: 'deleteVaults', body: { appId, vaults: [...new Set(payload.vaultIds)] },
  }], requestSession);
}

function* seedBackeupConfirmedWorked({
  payload,
}: {
  payload: {
    confirmed: boolean;
  };
}) {
  try {
    const { confirmed } = payload;
    yield call(dbManager.createObject, RealmSchema.BackupHistory, {
      title: confirmed
        ? BackupAction.SEED_BACKUP_CONFIRMED
        : BackupAction.SEED_BACKUP_CONFIRMATION_SKIPPED,
      date: moment().unix(),
      confirmed,
      subtitle: '',
    });
    confirmed
      ? yield put(uaiActioned({ uaiType: uaiType.RECOVERY_PHRASE_HEALTH_CHECK, action: true }))
      : null;
    yield put(setSeedConfirmed(confirmed));
  } catch (error) {
    //
  }
}

function* seedBackedUpWorker() {
  try {
    const { id }: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
    yield call(dbManager.createObject, RealmSchema.BackupHistory, {
      title: BackupAction.SEED_BACKUP_CREATED,
      date: moment().unix(),
      confirmed: true,
      subtitle: '',
    });
    yield call(dbManager.updateObjectById, RealmSchema.KeeperApp, id, {
      backup: {
        method: BackupType.SEED,
      },
    });
    yield put(setBackupType(BackupType.SEED));
    yield uaiActioned({ uaiType: uaiType.RECOVERY_PHRASE_HEALTH_CHECK, action: true });
  } catch (error) {
    console.log(error);
  }
}

let latestRecoveryReadRequest = 0;

function* getAppImageWorker({ payload }: ReturnType<typeof getAppImage>) {
  const request = ++latestRecoveryReadRequest;
  const requestSession = currentBackupAccountSession();
  const { primaryMnemonic, isForgot } = payload;
  const selection = payload.selection ?? { source: 'protected' };
  const source: BackupRecoverySource = selection.source === 'legacy-older'
    ? 'legacy-older' : 'protected';
  let keeperAppId: string;
  let namespaceId: string;
  let provenance: RecoveryProvenance;
  let protectedState: ProtectedBackupState;
  let recoverySession: number;
  const assertRequestIdentity = () => {
    if (request !== latestRecoveryReadRequest) throw new Error('Recovery request changed');
  };
  const requestIsCurrent = () => request === latestRecoveryReadRequest &&
    (recoverySession ?? requestSession) === currentBackupAccountSession();
  function* putCurrent(action: any) {
    if (requestIsCurrent()) yield put(action);
  }
  const assertRequestSession = () => {
    assertRequestIdentity();
    if (requestSession !== currentBackupAccountSession())
      throw new Error('Backup account changed');
  };
  try {
    yield* putCurrent(setAppImageError(''));
    yield* putCurrent(setRecoveryDiscovery({ status: 'checking', source }));
    if (selection.source !== 'protected' &&
      (selection.source !== 'legacy-older' || selection.olderCopyConfirmed !== true))
      throw new Error('Older recovery copy was not selected');
    if (!bip39.validateMnemonic(primaryMnemonic)) {
      throw Error('Invalid mnemonic');
    }
    const { bitcoinNetworkType } = yield select((state: RootState) => state.settings);
    const primarySeed = bip39.mnemonicToSeedSync(primaryMnemonic);
    const appID = crypto.createHash('sha256').update(primarySeed).digest('hex');
    keeperAppId = appID;
    if (isForgot) {
      // Allow only existing appId to be recovered using forgot passcode flow.
      const { allAccounts } = yield select((state: RootState) => state.account);
      const idx = allAccounts.findIndex((acc) => acc.appId == appID);
      if (idx == -1) throw Error('Not an existing app. Please recover an existing app.');
    }

    const encryptionKey = generateEncryptionKey(primarySeed.toString('hex'));
    assertRequestSession();
    let prepared;
    if (source === 'protected') {
      const result = yield call(readProtectedBackup, primaryMnemonic, undefined, appID);
      assertRequestSession();
      namespaceId = result.namespaceId;
      if (result.state === 'neverEnrolled' || result.state === 'deleted') {
        yield* putCurrent(setRecoveryDiscovery({
          status: result.state === 'deleted' ? 'protected-deleted' : 'protected-absent',
          source,
          keeperAppId: appID,
          namespaceId,
          legacyMayPredateDeletion: result.state === 'deleted',
        }));
        return;
      }
      prepared = prepareRecoverySourceImage(appID, {
        source: 'protected', namespaceId, response: result.snapshot,
      });
      protectedState = {
        status: 'present', namespaceId,
        generation: result.snapshot.generation, authEpoch: result.snapshot.authEpoch,
      };
      if (!hasRecoveryRecords(result.snapshot)) {
        yield* putCurrent(setRecoveryDiscovery({
          status: 'protected-empty', source, keeperAppId: appID, namespaceId,
          legacyMayPredateDeletion: result.snapshot.suppressLegacyFallback,
        }));
        return;
      }
    } else {
      // Older copies are read only after a separate, deliberate UI choice.
      // A protected absence, tombstone or request error never selects this path.
      const response = yield call(Relay.getAppImage, appID);
      assertRequestSession();
      prepared = prepareRecoverySourceImage(appID, {
        source: 'legacy-older', olderCopyConfirmed: true, response,
        legacyMayPredateDeletion: true,
      });
    }
    const { appImage, labels, allVaultImages } = prepared;
    provenance = prepared.provenance;
    yield* putCurrent(setRecoveryDiscovery({
      status: source === 'protected' ? 'protected-found' : 'legacy-selected',
      source, keeperAppId: appID, namespaceId, provenance,
    }));
    assertRequestSession();

    const previousVersion = appImage.version;

    // always set recovered app plan to pleb
    const plebSubscription = {
      productId: SubscriptionTier.L1,
      name: SubscriptionTier.L1,
      level: AppSubscriptionLevel.L1,
      icon: 'assets/ic_pleb.svg',
      receipt: '',
    };
    const dhSubscription = {
      productId: SubscriptionTier.L3,
      name: SubscriptionTier.L3,
      level: AppSubscriptionLevel.L3,
      icon: 'assets/ic_diamond_hands.svg',
      receipt: '',
    };
    recoverySession = yield call(
      recoverApp,
      primaryMnemonic,
      primarySeed,
      encryptionKey,
      appID,
      dhSubscription,
      appImage,
      allVaultImages,
      labels,
      previousVersion,
      requestSession,
      (ownedSession: number) => {
        if (request !== latestRecoveryReadRequest) throw new Error('Backup account changed');
        // Error feedback may follow only the session selected by this restore.
        // This callback supplies no remote baseline or upload authority.
        recoverySession = ownedSession;
      },
      source === 'protected',
      assertRequestIdentity
    );
    if (request !== latestRecoveryReadRequest ||
      recoverySession !== currentBackupAccountSession() || currentBackupAppId() !== appID)
      throw new Error('Backup account changed');

    if ((!appImage.wallets || !Object.entries(appImage.wallets).length) && !allVaultImages.length) {
      // recreate first wallet
      const defaultWallet: NewWalletInfo = {
        walletType: WalletType.DEFAULT,
        walletDetails: {
          name: 'Mobile Wallet',
          description: '',
          derivationPath: WalletUtilities.getDerivationPath(
            false,
            bitcoinNetworkType,
            0,
            DerivationPurpose.BIP84
          ),
          instanceNum: 0,
        },
      };
      assertRequestIdentity();
      const created = yield call(addNewWalletsWorker, {
        payload: [defaultWallet],
        originAppId: appID,
        originBackupAccountSession: recoverySession,
      });
      if (created !== true) throw new Error('Recovery data unavailable');
    }

    assertRequestIdentity();
    const recoveryKeySigner = setupRecoveryKeySigningKey(primaryMnemonic);
    yield call(addSigningDeviceWorker, {
      payload: { signers: [recoveryKeySigner] },
      originAppId: appID,
      originBackupAccountSession: recoverySession,
    });
    if (request !== latestRecoveryReadRequest ||
      recoverySession !== currentBackupAccountSession() || currentBackupAppId() !== appID)
      throw new Error('Backup account changed');
    const recoveredSigners: Signer[] = yield call(dbManager.getCollection, RealmSchema.Signer);
    const recoveredKey = recoveredSigners.find(
      (signer) => getKeyUID(signer) === getKeyUID(recoveryKeySigner)
    );
    // Key creation/merging can return without throwing after a rejected write.
    // Verify the required derived key material before exposing recovery success.
    if (
      !recoveredKey ||
      !Object.values(recoveryKeySigner.signerXpubs).some((entries) => entries.length > 0) ||
      !Object.entries(recoveryKeySigner.signerXpubs).every(([type, entries]) =>
        entries.every((expected) =>
          recoveredKey.signerXpubs[type]?.some(
            (actual) =>
              actual.xpub === expected.xpub &&
              actual.derivationPath === expected.derivationPath &&
              actual.xpriv === expected.xpriv
          )
        )
      )
    )
      throw new Error('Recovery data unavailable');

    // applying the restore upgrade sequence if required
    const newVersion = DeviceInfo.getVersion();
    if (previousVersion && semver.lt(previousVersion, newVersion)) {
      console.log(`applying restore upgarde sequence - from: ${previousVersion} to ${newVersion}`);
      assertRequestIdentity();
      yield call(applyUpgradeSequence, {
        previousVersion,
        newVersion,
        isRecovery: true,
        originBackupAccountSession: recoverySession,
      });
    }
    if (request !== latestRecoveryReadRequest ||
      recoverySession !== currentBackupAccountSession() || currentBackupAppId() !== appID)
      throw new Error('Backup account changed');
    yield* putCurrent(addAccount(appID));
    yield* putCurrent(autoSyncWallets(true, true, false, appID));
    yield* putCurrent(
      saveDefaultWalletState({
        appId: appID,
        data: { [NetworkType.MAINNET]: true, [NetworkType.TESTNET]: true },
      })
    );
    yield* putCurrent(uaiChecks([uaiType.SECURE_VAULT]));
    yield* putCurrent(loadConciergeUser(null));
    yield* putCurrent(loadConciergeTickets([]));
    yield* putCurrent(setRecoveryKeyStatus({ appId: appID, status: 'confirmed' }));
    if (protectedState) {
      const hint: ProtectedBackupState = yield select(
        (state: RootState) => state.bhr.protectedBackupStateByAppId?.[appID]
      );
      if (request !== latestRecoveryReadRequest ||
        recoverySession !== currentBackupAccountSession() || currentBackupAppId() !== appID)
        throw new Error('Backup account changed');
      // Retain a later authenticated tombstone/generation observed during this
      // restore. This persisted source hint is never verification or consent.
      const comparable = !hint?.namespaceId || hint.namespaceId === namespaceId;
      const older = hint && (
        hint.generation > protectedState.generation || hint.authEpoch > protectedState.authEpoch ||
        (hint.generation === protectedState.generation && hint.authEpoch === protectedState.authEpoch &&
          hint.status === 'deleted')
      );
      if (comparable && !older)
        yield* putCurrent(setProtectedBackupState({ appId: appID, state: protectedState }));
    }
    yield* putCurrent(setRecoveryDiscovery({
      status: 'restored', source, keeperAppId: appID, namespaceId, provenance,
    }));
    yield* putCurrent(setAppCreated(true));
  } catch (err) {
    // A late response for a previous account/request must not replace the
    // current recovery screen's provenance or present an error as absence.
    const activeSession = recoverySession ?? requestSession;
    if (request === latestRecoveryReadRequest && activeSession === currentBackupAccountSession()) {
      const error = err.message || 'Recovery data unavailable';
      yield* putCurrent(setRecoveryDiscovery({
        status: 'read-error', source, keeperAppId, namespaceId, error,
      }));
      yield* putCurrent(setAppImageError(error));
    }
  } finally {
    const wasCancelled = yield cancelled();
    if (!wasCancelled && request === latestRecoveryReadRequest &&
      (recoverySession ?? requestSession) === currentBackupAccountSession())
      yield* putCurrent(appImagerecoveryRetry());
  }
}

function* recoverApp(
  primaryMnemonic,
  primarySeed,
  encryptionKey,
  appID,
  subscription,
  appImage,
  allVaultImages,
  labels,
  previousVersion,
  originBackupAccountSession?: number,
  onRecoverySession?: (ownedSession: number) => void,
  protectedMetadata = false,
  assertRecoveryRequest: (() => void) | undefined = undefined
) {
  // Recovery selects appID after the first Realm write. Keep the session from
  // the initiating action across decryption and all earlier async work.
  const originSession = originBackupAccountSession ?? currentBackupAccountSession();
  const assertOrigin = () => {
    assertRecoveryRequest?.();
    if (currentBackupAccountSession() !== originSession)
      throw new Error('Backup account changed');
  };
  assertOrigin();
  const { bitcoinNetworkType } = yield select((state: RootState) => state.settings);
  const recovered: BackupImage = yield call(
    prepareRecoveryImage,
    encryptionKey,
    appID,
    appImage,
    allVaultImages,
    labels,
    protectedMetadata,
    assertOrigin
  );
  if (protectedMetadata)
    validateProtectedRecoveryMetadata({allVaultImages, labels}, recovered, getKeyUID, hash256, encryptionKey);
  // A restored copy does not inherit old opt-in state. Revoke only after full
  // validation, before any local write or producer, for BOTH recovery sources.
  assertOrigin();
  yield call(() => {
    assertOrigin();
    const consentEpoch = backupConsentEpoch(appID);
    store.dispatch(protectBackupRecoveryConsentDisable(
      setAutomaticCloudBackup({appId: appID, enabled: false}), appID, originSession
    ));
    assertOrigin();
    if (store.getState().bhr.automaticCloudBackupByAppId?.[appID] !== false ||
      backupConsentEpoch(appID) <= consentEpoch)
      throw new Error('Recovery backup consent could not be disabled');
    markBackupMutation(appID);
    clearVerifiedRemoteRevision(appID);
    notifyBackupReconciliation(appID);
  });
  const entropy = yield call(
    BIP85.bip39MnemonicToEntropy,
    config.BIP85_IMAGE_ENCRYPTIONKEY_DERIVATION_PATH,
    primaryMnemonic
  );
  assertOrigin();
  const imageEncryptionKey = generateEncryptionKey(entropy.toString('hex'));
  const publicId = WalletUtilities.getFingerprintFromSeed(primarySeed);
  const app: KeeperApp = {
    id: appID,
    publicId,
    primarySeed: primarySeed.toString('hex'),
    primaryMnemonic,
    imageEncryptionKey,
    subscription: {
      level: subscription.level,
      name: subscription.name,
      productId: subscription.productId,
      receipt: subscription.receipt,
      icon: subscription.icon,
    },
    backup: {
      method: BackupType.SEED,
    },
    version: DeviceInfo.getVersion(),
    networkType: bitcoinNetworkType,
  };

  yield call(writeRecoveredObject, RealmSchema.KeeperApp, app, assertOrigin);
  assertOrigin();
  yield put(setAppId(appID));
  const recoveryAccountSession = currentBackupAccountSession();
  const assertRecoveryAccount = () => {
    assertRecoveryRequest?.();
    if (currentBackupAccountSession() !== recoveryAccountSession || currentBackupAppId() !== appID)
      throw new Error('Backup account changed');
  };
  assertRecoveryAccount();
  onRecoverySession?.(recoveryAccountSession);
  function* writeRecord(schema: RealmSchema, record: any) {
    yield call(writeRecoveredObject, schema, record, assertRecoveryAccount);
  }

  // Wallet recreation
  if (appImage.wallets) {
    for (const decryptedWallet of Object.values(recovered.wallets) as Wallet[]) {
      try {
        if (decryptedWallet.entityKind === EntityKind.USDT_WALLET)
          yield call(writeRecord, RealmSchema.USDTWallet, decryptedWallet);
        else yield call(writeRecord, RealmSchema.Wallet, decryptedWallet);
      } catch (err) {
        throw new Error('Recovery data unavailable');
      }
    }
  }

  // Signers recreatin
  if (appImage.signers) {
    for (const decrytpedSigner of Object.values(recovered.signers) as Signer[]) {
      try {
        if (!decrytpedSigner?.id) {
          decrytpedSigner.id = getKeyUID(decrytpedSigner);
        }
        if (!decrytpedSigner?.networkType) {
          // adds missing network type to signer as per the env type
          decrytpedSigner.networkType = config.isDevMode()
            ? NetworkType.TESTNET
            : NetworkType.MAINNET;
        }
        yield call(writeRecord, RealmSchema.Signer, decrytpedSigner);
      } catch (err) {
        throw new Error('Recovery data unavailable');
      }
    }
  }

  // Vault recreation
  if (allVaultImages.length > 0) {
    // Legacy vaults carry the pre-key-management signer shape until migration.
    for (const vault of Object.values(recovered.vaults)) {
      try {
        if (semver.lt(previousVersion, KEY_MANAGEMENT_VERSION)) {
          if (vault?.signers?.length) {
            vault.signers.forEach((signer, index) => {
              signer.xfp = signer.signerId;
              signer.registeredVaults = [
                {
                  vaultId: vault.id,
                  registered: signer.registered,
                  registrationInfo: signer.deviceInfo ? JSON.stringify(signer.deviceInfo) : '',
                },
              ];
            });
          }

          if (vault.signers.length) {
            for (const signer of vault.signers) {
              const signerXpubs = {};
              Object.keys(signer.xpubDetails).forEach((type) => {
                if (signer.xpubDetails[type].xpub) {
                  if (signerXpubs[type]) {
                    signerXpubs[type].push({
                      xpub: signer.xpubDetails[type].xpub,
                      xpriv: signer.xpubDetails[type].xpriv,
                      derivationPath: signer.xpubDetails[type].derivationPath,
                    });
                  } else {
                    signerXpubs[type] = [
                      {
                        xpub: signer.xpubDetails[type].xpub,
                        xpriv: signer.xpubDetails[type].xpriv,
                        derivationPath: signer.xpubDetails[type].derivationPath,
                      },
                    ];
                  }
                }
              });
              const signerObject = {
                id: getKeyUID(signer),
                masterFingerprint: signer.masterFingerprint,
                type: signer.type,
                signerName: getSignerNameFromType(signer.type, signer.isMock, false),
                signerDescription: signer.signerDescription,
                lastHealthCheck: signer.lastHealthCheck,
                addedOn: signer.addedOn,
                isMock: signer.isMock,
                storageType: signer.storageType,
                signerPolicy: signer.signerPolicy,
                hidden: false,
                signerXpubs,
              };
              yield call(writeRecord, RealmSchema.Signer, signerObject);
            }
          }
        }
        yield call(writeRecord, RealmSchema.Vault, vault);
      } catch (err) {
        throw new Error('Recovery data unavailable');
      }
    }
  }

  // Labels Restore
  if (labels) {
    for (const label of Object.values(recovered.labels)) {
      yield call(writeRecord, RealmSchema.Tags, label);
    }
  }

  if (appImage.nodes) {
    // Delete all default nodes to only use the nodes from the user's backup
    const existingNodes: NodeDetail[] = yield call(
      dbManager.getCollection,
      RealmSchema.NodeConnect
    );
    for (const node of existingNodes) {
      if (node && node.id) {
        assertRecoveryAccount();
        const deleted = yield call(
          dbManager.deleteObjectById,
          RealmSchema.NodeConnect,
          node.id.toString()
        );
        assertRecoveryAccount();
        if (deleted !== true) throw new Error('Recovery data unavailable');
      }
    }
    for (const decryptedNode of Object.values(recovered.nodes) as NodeDetail[]) {
      try {
        if (!decryptedNode?.networkType) {
          decryptedNode.networkType = config.isDevMode()
            ? NetworkType.TESTNET
            : NetworkType.MAINNET;
        }
        yield call(writeRecord, RealmSchema.NodeConnect, decryptedNode);
      } catch (err) {
        throw new Error('Recovery data unavailable');
      }
    }
  }

  // Connect to a node
  const savedNodes: NodeDetail[] = yield call(dbManager.getCollection, RealmSchema.NodeConnect);
  if (savedNodes.length > 0 && !savedNodes.find((node) => node.isConnected)) {
    assertRecoveryAccount();
    const firstNode = savedNodes[0];
    firstNode.isConnected = true;

    const connected = yield call(
      dbManager.updateObjectById,
      RealmSchema.NodeConnect,
      firstNode.id.toString(),
      firstNode
    );
    assertRecoveryAccount();
    if (connected !== true) throw new Error('Recovery data unavailable');
  }

  // seed confirm for recovery
  yield call(writeRecord, RealmSchema.BackupHistory, {
    title: BackupAction.SEED_BACKUP_CONFIRMED,
    date: moment().unix(),
    confirmed: true,
    subtitle: 'Recovered using backup phrase',
  });

  // Recovery proves possession of the Recovery Key, but is not consent to
  // enable Assisted Server Backup. This transient flag triggers a new upload
  // when the health-check screen mounts; persistent key status is set by the
  // completed recovery worker instead.
  assertRecoveryAccount();
  yield put(setSeedConfirmed(false));
  assertRecoveryAccount();
  yield put(setBackupType(BackupType.SEED));
  assertRecoveryAccount();
  yield put(uaiActioned({ uaiType: uaiType.RECOVERY_PHRASE_HEALTH_CHECK, action: true }));

  // create/add restored object for version
  yield call(writeRecord, RealmSchema.VersionHistory, {
    version: `${DeviceInfo.getVersion()}(${DeviceInfo.getBuildNumber()})`,
    date: new Date().toString(),
    title: 'Recovered Wallet',
  });
  return recoveryAccountSession;
}

function* writeRecoveredObject(schema: RealmSchema, record: any, assertActive?: () => void) {
  // Realm's adapter returns false/undefined on a rejected write instead of
  // throwing. Never count that record as recovered or report partial success.
  assertActive?.();
  const written = yield call(dbManager.createObject, schema, record);
  if (written !== true) throw new Error('Recovery data unavailable');
  // Realm writes complete synchronously. Break the saga's synchronous effect
  // chain between records so a large restore cannot exhaust the JS stack.
  yield call(pauseBackup);
  assertActive?.();
}

function* healthCheckSatutsUpdateWorker({
  payload,
}: {
  payload: {
    signerUpdates: { signerId: string; status: hcStatusType }[];
  };
}) {
  try {
    const HcSuccessTypes = [
      hcStatusType.HEALTH_CHECK_MANAUAL,
      hcStatusType.HEALTH_CHECK_SD_ADDITION,
      hcStatusType.HEALTH_CHECK_SUCCESSFULL,
      hcStatusType.HEALTH_CHECK_SIGNING,
    ];
    const { signerUpdates } = payload;
    for (const signerUpdate of signerUpdates) {
      const signersRealm: Signer[] = dbManager.getObjectByField(
        RealmSchema.Signer,
        signerUpdate.signerId,
        'masterFingerprint'
      );
      for (const signerRealm of signersRealm) {
        const signer: Signer = getJSONFromRealmObject(signerRealm);
        if (signer) {
          const date = new Date();
          const newHealthCheckDetails: HealthCheckDetails = {
            type: signerUpdate.status,
            actionDate: date,
          };

          const oldDetialsArray = [...signer.healthCheckDetails];
          const oldDetails = oldDetialsArray.map((details) => ({ ...details, date: new Date(details.actionDate) }));

          const updatedDetailsArray: HealthCheckDetails[] = [...oldDetails, newHealthCheckDetails];

          yield put(updateSignerDetails(signer, 'healthCheckDetails', updatedDetailsArray));
          if (HcSuccessTypes.includes(signerUpdate.status)) yield put(healthCheckSigner([signer]));
        }
      }
    }
  } catch (err) {
    console.log(err);
  }
}

export const healthCheckSatutsUpdateWatcher = createWatcher(
  healthCheckSatutsUpdateWorker,
  HEALTH_CHECK_STATUS_UPDATE
);

function* healthCheckSignerWorker({
  payload,
}: {
  payload: {
    signers: VaultSigner[];
  };
}) {
  try {
    const { signers } = payload;
    for (const signer of signers) {
      const date = new Date();
      yield put(updateSignerDetails(signer, 'lastHealthCheck', date));
      yield put(uaiActioned({ entityId: signer.id, action: true }));
    }
  } catch (err) {
    console.log(err);
  }
}

function* backupBsmsOnCloudWorker() {
  const { id: appId }: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
  const password = yield select(
    (state: RootState) => state.account.personalBackupPasswordByAppId?.[appId]
  );
  const excludeVaultTypesForBackup = [VaultType.CANARY];
  try {
    if (!password) throw Error('Personal cloud backup failed, no password provided');
    const bsmsToBackup = [];
    const vaultsCollection = yield call(dbManager.getCollection, RealmSchema.Vault);
    const vaults = vaultsCollection.filter((vault) => vault.archived === false);
    if (vaults.length === 0) {
      yield call(dbManager.createObject, RealmSchema.CloudBackupHistory, {
        title: CloudBackupAction.CLOUD_BACKUP_FAILED,
        confirmed: false,
        subtitle: 'No vaults found.',
        date: Date.now(),
      });
      return;
    }
    vaults.forEach((vault) => {
      if (!excludeVaultTypesForBackup.includes(vault.type)) {
        const bsms = generateOutputDescriptors(vault);
        bsmsToBackup.push({
          bsms,
          name: vault.presentationData.name,
        });
      }
    });

    if (Platform.OS === 'android') {
      yield put(setBackupLoading(true));
      const setup = yield call(CloudBackupModule.setup);
      if (setup) {
        const login = yield call(CloudBackupModule.login);
        if (login.status) {
          const response = yield call(
            CloudBackupModule.backupBsms,
            JSON.stringify(bsmsToBackup),
            password
          );
          if (response.status) {
            yield call(dbManager.createObject, RealmSchema.CloudBackupHistory, {
              title: CloudBackupAction.CLOUD_BACKUP_CREATED,
              confirmed: true,
              subtitle: response.data,
              date: Date.now(),
            });
            yield put(setIsCloudBsmsBackupRequired(false));
          } else {
            yield call(dbManager.createObject, RealmSchema.CloudBackupHistory, {
              title: CloudBackupAction.CLOUD_BACKUP_FAILED,
              confirmed: false,
              subtitle: response.error,
              date: Date.now(),
            });
          }
        } else {
          yield call(dbManager.createObject, RealmSchema.CloudBackupHistory, {
            title: CloudBackupAction.CLOUD_BACKUP_FAILED,
            confirmed: false,
            subtitle: login.error,
            date: Date.now(),
          });
        }
      } else {
        yield call(dbManager.createObject, RealmSchema.CloudBackupHistory, {
          title: CloudBackupAction.CLOUD_BACKUP_FAILED,
          confirmed: false,
          subtitle: 'Unable to initialize Google Drive',
          date: Date.now(),
        });
      }
    } else {
      yield put(setBackupLoading(true));
      const response = yield call(
        CloudBackupModule.backupBsms,
        JSON.stringify(bsmsToBackup),
        password
      );
      if (response.status) {
        yield call(dbManager.createObject, RealmSchema.CloudBackupHistory, {
          title: CloudBackupAction.CLOUD_BACKUP_CREATED,
          confirmed: true,
          subtitle: response.data,
          date: Date.now(),
        });
        yield put(setIsCloudBsmsBackupRequired(false));
      } else {
        yield call(dbManager.createObject, RealmSchema.CloudBackupHistory, {
          title: CloudBackupAction.CLOUD_BACKUP_FAILED,
          confirmed: false,
          subtitle: response.error,
          date: Date.now(),
        });
      }
    }
  } catch (error) {
    console.log(error);
    yield call(dbManager.createObject, RealmSchema.CloudBackupHistory, {
      title: CloudBackupAction.CLOUD_BACKUP_FAILED,
      confirmed: false,
      subtitle: `${error}`,
      date: Date.now(),
    });
  }
}

function* bsmsCloudHealthCheckWorker() {
  yield put(setBackupLoading(true));
  try {
    if (Platform.OS === 'android') {
      const setup = yield call(CloudBackupModule.setup);
      if (!setup) {
        yield call(dbManager.createObject, RealmSchema.CloudBackupHistory, {
          title: CloudBackupAction.CLOUD_BACKUP_HEALTH_FAILED,
          confirmed: false,
          subtitle: 'Unable to initialize Google Drive',
          date: Date.now(),
        });
        return;
      }

      const login = yield call(CloudBackupModule.login);
      if (!login.status) {
        yield call(dbManager.createObject, RealmSchema.CloudBackupHistory, {
          title: CloudBackupAction.CLOUD_BACKUP_HEALTH_FAILED,
          confirmed: false,
          subtitle: login.error,
          date: Date.now(),
        });
        return;
      }
    }

    const response = yield call(CloudBackupModule.bsmsHealthCheck);
    const parsedResponse = typeof response === 'string' ? JSON.parse(response) : response;

    if (parsedResponse.status) {
      yield call(dbManager.createObject, RealmSchema.CloudBackupHistory, {
        title: CloudBackupAction.CLOUD_BACKUP_HEALTH,
        confirmed: true,
        subtitle: parsedResponse.data || '',
        date: Date.now(),
      });
      yield put(setIsCloudBsmsBackupRequired(false));
    } else {
      yield call(dbManager.createObject, RealmSchema.CloudBackupHistory, {
        title: CloudBackupAction.CLOUD_BACKUP_HEALTH_FAILED,
        confirmed: false,
        subtitle: parsedResponse.error || 'Health check failed',
        date: Date.now(),
      });
    }
  } catch (error) {
    yield call(dbManager.createObject, RealmSchema.CloudBackupHistory, {
      title: CloudBackupAction.CLOUD_BACKUP_HEALTH_FAILED,
      confirmed: false,
      subtitle: error.message || 'Unknown error occurred',
      date: Date.now(),
    });
  }
}

export const backupBsmsOnCloudWatcher = createWatcher(
  backupBsmsOnCloudWorker,
  BACKUP_BSMS_ON_CLOUD
);
export const bsmsCloudHealthCheckWatcher = createWatcher(
  bsmsCloudHealthCheckWorker,
  BSMS_CLOUD_HEALTH_CHECK
);

export const updateAppImageWatcher = createWatcher(updateAppImageWorker, UPDATE_APP_IMAGE);
export const updateVaultImageWatcher = createWatcher(updateVaultImageWorker, UPDATE_VAULT_IMAGE);

export function* getAppImageWatcher() {
  // Recovery owns one intent. Cancellation also stops called wallet/signer/
  // upgrade generators; explicit request checks still guard async crypto.
  yield takeLatest(GET_APP_IMAGE, getAppImageWorker);
}
export const seedBackedUpWatcher = createWatcher(seedBackedUpWorker, SEED_BACKEDUP);

export const seedBackeupConfirmedWatcher = createWatcher(
  seedBackeupConfirmedWorked,
  SEED_BACKEDUP_CONFIRMED
);

export const healthCheckSignerWatcher = createWatcher(
  healthCheckSignerWorker,
  UPADTE_HEALTH_CHECK_SIGNER
);

export const deleteAppImageEntityWatcher = createWatcher(
  deleteAppImageEntityRequestWorker,
  DELETE_APP_IMAGE_ENTITY
);

function* deleteAppImageEntityRequestWorker(
  action: Parameters<typeof deleteAppImageEntityWorker>[0] & {
    onComplete?: (deleted: boolean) => void;
  }
) {
  let deleted = false;
  try {
    const result = yield call(deleteAppImageEntityWorker, action);
    deleted = result?.updated === true;
  } catch (error) {
    captureError(error);
  }
  if (action.onComplete) {
    try {
      action.onComplete(deleted);
    } catch (error) {
      captureError(error);
    }
  }
  return deleted;
}

const backupInspectionOwners = new Map<string, number>();

function* runBackupInspection(
  repair: boolean,
  expectedAppId?: string,
  explicitChoice = false,
  expectedSession?: number
) {
  const requestSession = expectedSession ?? currentBackupAccountSession();
  if (requestSession !== currentBackupAccountSession()) return false;
  const { id }: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
  if ((expectedAppId && id !== expectedAppId) || requestSession !== currentBackupAccountSession())
    return false;
  backupInspectionOwners.set(id, (backupInspectionOwners.get(id) ?? 0) + 1);
  let finalPhase: RepairPhase = 'unverified';
  let verifiedEvidence: { revision: number; intent: BackupWriteIntent } | undefined;
  let inspection: Promise<RepairPhase> | undefined;
  let updates: ReturnType<typeof eventChannel<RepairPhase>> | undefined;
  const evidenceStillCurrent = () => {
    const currentIntent = captureBackupWriteIntent(id);
    return !!verifiedEvidence && !!currentIntent &&
      backupRevision(id) === verifiedEvidence.revision &&
      currentIntent.appId === verifiedEvidence.intent.appId &&
      currentIntent.accountSession === verifiedEvidence.intent.accountSession &&
      currentIntent.baseRevision === verifiedEvidence.intent.baseRevision &&
      sameProtectedBackupBase(currentIntent.protectedBase, verifiedEvidence.intent.protectedBase) &&
      currentIntent.baselineEpoch === verifiedEvidence.intent.baselineEpoch;
  };
  try {
    yield put(setBackupRepairRunning({ appId: id, running: true }));
    updates = eventChannel<RepairPhase>((emit) => {
      // The repair service accepts the origin session as its fifth argument.
      const inspectWithSession = inspectBackup as (
        appId: string,
        shouldRepair: boolean,
        onPhase: (phase: RepairPhase) => void,
        explicitlyChosen: boolean,
        session: number
      ) => Promise<RepairPhase>;
      inspection = inspectWithSession(id, repair, (phase) => {
        if (phase === 'verified') {
          const intent = captureBackupWriteIntent(id);
          verifiedEvidence = intent ? { revision: backupRevision(id), intent } : undefined;
        }
        emit(phase);
      }, explicitChoice, requestSession);
      inspection.then(
        () => emit(END),
        () => emit(END)
      );
      return () => {};
    }, buffers.expanding());
    while (true) {
      const phase = yield takeMaybe(updates);
      if (phase === END) break;
      if (requestSession !== currentBackupAccountSession()) return false;
      finalPhase = phase;
      // Verification is tentative until the final, synchronous Redux commit.
      // A Realm write can invalidate it while this channel is draining.
      if (phase !== 'verified') yield put(setBackupRepairState({ appId: id, phase }));
    }
    // No yield may separate the current-state check from this one Redux action:
    // it commits the visible phase and pending flag together.
    const outcome: { active: boolean; verified: boolean } = yield call(() => {
      if (currentBackupAppId() !== id || requestSession !== currentBackupAccountSession())
        return { active: false, verified: false };
      const verified = finalPhase === 'verified' && evidenceStillCurrent();
      store.dispatch(commitBackupInspection({
        appId: id,
        phase: finalPhase === 'verified' && !verified ? 'unverified' : finalPhase,
        pending: !verified,
      }));
      return { active: true, verified };
    });
    if (outcome.active) {
      if (outcome.verified) {
        const notifications = dbManager.getObjectByField(
          RealmSchema.UAI,
          uaiType.SERVER_BACKUP_FAILURE,
          'uaiType'
        ) as unknown as Array<{ id: string }>;
        for (const uai of notifications) {
          const stillActive = yield select((state: RootState) => state.storage.appId === id);
          if (!stillActive || currentBackupAppId() !== id ||
              requestSession !== currentBackupAccountSession() || !evidenceStillCurrent()) break;
          yield call(uaiActionedWorker, { payload: { uaiId: uai.id, action: true } });
        }
      } else if (
        !dbManager.getObjectByField(RealmSchema.UAI, uaiType.SERVER_BACKUP_FAILURE, 'uaiType')
          ?.length
      ) {
        const stillActive = yield select((state: RootState) => state.storage.appId === id);
        if (!stillActive || currentBackupAppId() !== id ||
            requestSession !== currentBackupAccountSession()) return false;
        yield call(addToUaiStackWorker, {
          payload: {
            uaiType: uaiType.SERVER_BACKUP_FAILURE,
            uaiDetails: {
              heading: translations.recoveryBackup.notificationTitle,
              body: translations.recoveryBackup.notificationBody,
            },
          },
        });
      }
    }
    return outcome.verified && requestSession === currentBackupAccountSession() &&
      evidenceStillCurrent();
  } finally {
    updates?.close();
    // Cancellation closes this listener, but does not stop its shared operation.
    // Keep ownership until that operation settles, including a queued repair.
    if (inspection) yield call(() => inspection.catch(() => undefined));
    const remaining = (backupInspectionOwners.get(id) ?? 1) - 1;
    if (remaining) backupInspectionOwners.set(id, remaining);
    else backupInspectionOwners.delete(id);
    yield put(setBackupRepairRunning({ appId: id, running: remaining > 0 }));
  }
}

function* backupFreshnessWorker({ type, appId, originBackupAccountSession }) {
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  if (requestSession !== currentBackupAccountSession()) return;
  const { id }: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
  if (!appId || id !== appId || requestSession !== currentBackupAccountSession()) return;
  const enabled = yield select((state: RootState) =>
    state.storage.appId === appId && isAutomaticCloudBackupEnabled(state.bhr, appId)
  );
  const repair = type === REPAIR_BACKUP;
  if ((repair && !enabled) || requestSession !== currentBackupAccountSession()) return;
  // Consent-off status checking is read-only; it must not enroll or repair.
  yield call(runBackupInspection, repair, appId, !repair, requestSession);
}

export function* backupFreshnessWatcher() {
  yield takeEvery([CHECK_BACKUP_FRESHNESS, REPAIR_BACKUP], backupFreshnessWorker);
}

function* backupAllSignersAndVaultsWorker({
  appId,
  originBackupAccountSession,
}: {
  appId: string;
  originBackupAccountSession?: number;
}) {
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  const requestConsentEpoch = backupConsentEpoch(appId);
  const isCurrentChoice = () => currentBackupAppId() === appId &&
    requestSession === currentBackupAccountSession() && backupConsentEpoch(appId) === requestConsentEpoch;
  if (requestSession !== currentBackupAccountSession()) return false;
  const { id }: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
  if (!appId || appId !== id) return false;
  const selected = yield select((state: RootState) => state.storage.appId === appId);
  if (!selected) return false;
  yield put(setBackupAllSuccess({ appId, status: false }));
  yield put(setBackupAllFailure({ appId, status: false }));
  yield put(setBackupAllLoading({ appId, status: true }));
  try {
    const verified = yield call(runBackupInspection, true, appId, true, requestSession);
    return yield call(() => {
      if (!isCurrentChoice()) return false;
      const state = store.getState();
      const stillVerified = verified && state.bhr.backupRepairStateByAppId?.[appId] === 'verified' &&
        state.bhr.pendingAllBackupByAppId?.[appId] === false && isBackupVerificationCurrent(appId);
      if (stillVerified) store.dispatch(protectBackupConsentCompletion(
        setAutomaticCloudBackup({ appId, enabled: true }), appId, requestConsentEpoch
      ));
      if (!isCurrentChoice() || (stillVerified && !isBackupVerificationCurrent(appId))) return false;
      store.dispatch(stillVerified ? setBackupAllSuccess({ appId, status: true })
        : setBackupAllFailure({ appId, status: true }));
      return stillVerified;
    });
  } finally {
    if (isCurrentChoice()) yield put(setBackupAllLoading({ appId, status: false }));
  }
}

export const backupAllSignersAndVaultsWatcher = createWatcher(
  backupAllSignersAndVaultsWorker,
  BACKUP_ALL_SIGNERS_AND_VAULTS
);

function* deleteBackupWorker({ appId, originBackupAccountSession }: {
  appId: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
}) {
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  const requestConsentEpoch = backupConsentEpoch(appId);
  const isCurrent = () => currentBackupAppId() === appId && currentBackupAccountSession() === requestSession &&
    backupConsentEpoch(appId) === requestConsentEpoch;
  if (!appId || !isCurrent()) return false;
  yield put(setDeleteBackupSuccess({ appId, status: false }));
  yield put(setDeleteBackupFailure({ appId, status: false }));
  yield put(setBackupAllLoading({ appId, status: true }));
  try {
    // Delete only the protected copy. Its authenticated fresh tuple is bound
    // to this original session; retained older copies and all local data stay.
    const intent = yield call(beginBackupDeleteOperation, appId, requestSession);
    if (!isCurrent()) return false;
    if (!intent?.committed || !intent.intent) throw new Error('Backup deletion preflight failed');
    const result = yield call(enqueueAutomaticBackupOperation, intent, [{
      operation: 'deleteBackup', body: { appId },
    }]);
    if (!result?.updated || !result?.backupConfirmed) throw new Error('Backup deletion not confirmed');
    const completed = yield call(() => {
      if (!isCurrent() || !isAutomaticBackupResultCurrent(result, appId)) return false;
      store.dispatch(setDeleteBackupSuccess({ appId, status: true }));
      if (!isCurrent() || !isAutomaticBackupResultCurrent(result, appId)) return false;
      store.dispatch(setPendingAllBackup({ appId, pending: false }));
      return true;
    });
    if (!completed && isCurrent()) yield put(setDeleteBackupFailure({ appId, status: true }));
    return completed;
  } catch {
    if (isCurrent()) {
      yield put(setPendingAllBackup({ appId, pending: true }));
      yield put(setDeleteBackupFailure({ appId, status: true }));
    }
    return false;
  } finally {
    if (isCurrent()) yield put(setBackupAllLoading({ appId, status: false }));
  }
}

export const deleteBackupWatcher = createWatcher(deleteBackupWorker, DELETE_BACKUP);

export function* checkBackupCondition(expectedAppId?: string) {
  const { id }: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
  if (expectedAppId && expectedAppId !== id) return true;
  const enabled = yield select((state: RootState) =>
    state.storage.appId === id && isAutomaticCloudBackupEnabled(state.bhr, id)
  );
  if (!enabled) return true;
  markBackupMutation(id);
  yield put(invalidateBackupRepair(id));
  const netInfo = yield call(NetInfo.fetch);
  const current: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
  const stillEnabled = yield select((state: RootState) =>
    state.storage.appId === id && isAutomaticCloudBackupEnabled(state.bhr, id)
  );
  if (current?.id !== id || (expectedAppId && current.id !== expectedAppId) || !stillEnabled)
    return true;
  if (!netInfo.isConnected) {
    yield call(setServerBackupFailed, id);
    return true;
  }
  // Never suppress this incremental write or replace it with a snapshot: wallet
  // creation invokes us before persisting the new wallet to Realm. An old
  // mismatch is repaired only after Back Up Now, separately from this mutation.
  return false;
}

export function* setServerBackupFailed(expectedAppId?: string) {
  const { id: appId }: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
  if (expectedAppId && expectedAppId !== appId) return;
  const ownerIsActive = yield select((state: RootState) => state.storage.appId === appId);
  if (!ownerIsActive || currentBackupAppId() !== appId) return;
  const uaiCollection = dbManager.getObjectByField(
    RealmSchema.UAI,
    uaiType.SERVER_BACKUP_FAILURE,
    'uaiType'
  ) as unknown as Array<{ id: string; uaiType: uaiType }>;
  for (const uai of uaiCollection) {
    if (uai.uaiType === uaiType.SERVER_BACKUP_FAILURE) {
      const stillActive = yield select((state: RootState) => state.storage.appId === appId);
      if (!stillActive || currentBackupAppId() !== appId) return;
      yield call(uaiActionedWorker, {
        payload: { uaiId: uai.id, action: false },
      });
    }
  }
  const stillActive = yield select((state: RootState) => state.storage.appId === appId);
  if (!stillActive || currentBackupAppId() !== appId) return;
  yield call(addToUaiStackWorker, {
    payload: {
      uaiType: uaiType.SERVER_BACKUP_FAILURE,
      uaiDetails: {
        heading: translations.recoveryBackup.retryNotificationTitle,
        body: translations.recoveryBackup.retryNotificationBody,
      },
    },
  });
  const activeAfterNotice = yield select((state: RootState) => state.storage.appId === appId);
  if (!activeAfterNotice || currentBackupAppId() !== appId) return;
  yield put(setPendingAllBackup({ appId, pending: true }));
}

function* validateServerBackupWorker({ callback, originAppId, originBackupAccountSession }) {
  const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
  if (requestSession !== currentBackupAccountSession()) {
    callback({ status: false, error: true, message: 'Backup account changed.' });
    return;
  }
  const { id }: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
  if (!originAppId || originAppId !== id || requestSession !== currentBackupAccountSession()) {
    callback({ status: false, error: true, message: 'Backup account changed.' });
    return;
  }
  const matched = yield call(runBackupInspection, false, originAppId, false, requestSession);
  const stillActive = yield select((state: RootState) => state.storage.appId === originAppId);
  if (!stillActive || currentBackupAppId() !== originAppId ||
      requestSession !== currentBackupAccountSession()) {
    callback({ status: false, error: true, message: 'Backup account changed.' });
    return;
  }
  const { backupRepairStateByAppId = {} } = yield select((state: RootState) => state.bhr);
  callback({
    status: matched,
    error: backupRepairStateByAppId[originAppId] === 'unverified',
    message: matched ? 'Backup verified successfully.' : 'Backup could not be verified.',
  });
}

export const validateSeverBackupWatcher = createWatcher(
  validateServerBackupWorker,
  VALIDATE_SERVER_BACKUP
);
