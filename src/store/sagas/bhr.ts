import { buffers, END, eventChannel } from 'redux-saga';
import { inspectBackup, RepairPhase } from 'src/services/backup/repair';
import { prepareRecoveryImage } from 'src/services/backup/restore';
import { BackupImage, pauseBackup } from 'src/services/backup/image';
import { markBackupMutation } from 'src/services/backup/transport';
import * as bip39 from 'bip39';
import { Wallet } from 'src/services/wallets/interfaces/wallet';
import { call, put, select, takeMaybe, takeEvery } from 'redux-saga/effects';
import config from 'src/utils/service-utilities/config';
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
import { autoSyncWallets, updateSignerDetails } from '../sagaActions/wallets';
import { createWatcher } from '../utilities';
import {
  appImagerecoveryRetry,
  setAppImageError,
  setAutomaticCloudBackup,
  setBackupAllFailure,
  setBackupAllLoading,
  setBackupAllSuccess,
  setBackupRepairState,
  setBackupRepairRunning,
  invalidateBackupRepair,
  setBackupLoading,
  setBackupType,
  setDeleteBackupFailure,
  setDeleteBackupSuccess,
  setIsCloudBsmsBackupRequired,
  setPendingAllBackup,
  setSeedConfirmed,
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
import { RootState } from '../store';
import { setupRecoveryKeySigningKey } from 'src/hardware/signerSetup';
import { addNewWalletsWorker, addSigningDeviceWorker, NewWalletInfo } from './wallets';
import {
  getKeyUID,
  sanitizeSeedKeyForBackup,
  sanitizeVaultSignersForSeedKeyBackup,
} from 'src/utils/utilities';
import NetInfo from '@react-native-community/netinfo';
import { addToUaiStackWorker, uaiActionedWorker } from './uai';
import { addAccount, saveDefaultWalletState, setRecoveryKeyStatus } from '../reducers/account';
import { loadConciergeTickets, loadConciergeUser } from '../reducers/concierge';
import { USDTWallet } from 'src/services/wallets/factories/USDTWalletFactory';

export function* updateAppImageWorker({
  payload,
}: {
  payload: {
    wallets?: Wallet[] | USDTWallet[];
    signers?: Signer[];
    updateNodes?: boolean;
  };
}) {
  try {
    const backupResponse = yield call(checkBackupCondition);
    if (backupResponse) return { updated: true, error: '' };

    const { wallets, signers, updateNodes } = payload;
    const { primarySeed, id, publicId, subscription, networkType, version }: KeeperApp = yield call(
      dbManager.getObjectByIndex,
      RealmSchema.KeeperApp
    );
    const walletsObject = {};
    const signersObject = {};
    const nodesList = [];
    const encryptionKey = generateEncryptionKey(primarySeed);
    if (wallets) {
      for (const wallet of wallets) {
        const encrytedWallet = encrypt(encryptionKey, JSON.stringify(wallet));
        walletsObject[wallet.id] = encrytedWallet;
      }
    }
    if (signers) {
      for (const signer of signers) {
        const encrytedSigner = encrypt(
          encryptionKey,
          JSON.stringify(sanitizeSeedKeyForBackup(signer))
        );
        signersObject[getKeyUID(signer)] = encrytedSigner;
      }
    }
    if (updateNodes) {
      const nodes: NodeDetail[] = yield call(dbManager.getCollection, RealmSchema.NodeConnect);
      if (nodes && nodes.length > 0) {
        for (const index in nodes) {
          const node = { ...nodes[index], isConnected: false };
          const encrytedNode = encrypt(encryptionKey, JSON.stringify(node));
          nodesList.push(encrytedNode);
        }
      }
    }

    const response = yield call(Relay.updateAppImage, {
      appId: id,
      publicId,
      walletsObject,
      signersObject,
      networkType,
      subscription: JSON.stringify(subscription),
      version,
      nodes: nodesList,
      replaceNodes: !!updateNodes,
    });
    if (!response?.updated) yield call(setServerBackupFailed);
    return response;
  } catch (err) {
    console.log({ err });
    console.error('App image update failed', err);
    yield call(setServerBackupFailed);
    return { updated: true, error: '' };
  }
}

export function* updateVaultImageWorker({
  payload,
}: {
  payload: {
    vault: Vault;
    archiveVaultId?: string;
    isUpdate?: boolean;
  };
}) {
  const backupResponse = yield call(checkBackupCondition);
  if (backupResponse) return { updated: true, error: '' };

  const { vault, archiveVaultId, isUpdate } = payload;
  const { primarySeed, id, subscription }: KeeperApp = yield call(
    dbManager.getObjectByIndex,
    RealmSchema.KeeperApp
  );
  const encryptionKey = generateEncryptionKey(primarySeed);
  const vaultEncrypted = encrypt(
    encryptionKey,
    JSON.stringify(sanitizeVaultSignersForSeedKeyBackup(vault))
  );

  const signersData: Array<{
    signerId: string;
    xfpHash: string;
  }> = [];
  for (const signer of vault.signers) {
    signersData.push({
      // TODO: Upate relay to use KeyUID
      signerId: getKeyUID(signer),
      xfpHash: hash256(signer.masterFingerprint),
    });
  }

  if (isUpdate) {
    const response = yield call(Relay.updateVaultImage, {
      isUpdate,
      signersData,
      appId: id,
      vaultId: vault.id,
      vault: vaultEncrypted,
      isArchived: !!vault.archived,
    });
    return response;
  }

  // TODO to be removed
  const subscriptionStrings = JSON.stringify(subscription);

  try {
    const response = yield call(Relay.updateVaultImage, {
      appID: id,
      vaultId: vault.id,
      signersData,
      vault: vaultEncrypted,
      isArchived: !!vault.archived,
      subscription: subscriptionStrings,
      ...(archiveVaultId && { archiveVaultId }),
    });
    return response;
  } catch (err) {
    captureError(err);
    yield call(setServerBackupFailed);
    return { updated: true, error: '' };
  }
}

// TODO: Other functions here only handle Relay backup, but this also updates local DB, should move that part out
export function* deleteAppImageEntityWorker({
  payload,
}: {
  payload: {
    signerIds?: string[];
    walletIds?: string[];
  };
}) {
  try {
    const { signerIds, walletIds } = payload;
    const { id }: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
    let response;

    const backupResponse = yield call(checkBackupCondition);
    if (backupResponse) response = { updated: true, error: '' };
    else {
      response = yield call(Relay.deleteAppImageEntity, {
        appId: id,
        signers: signerIds,
        walletIds,
      });
    }

    if (walletIds?.length > 0) {
      for (const walletId of walletIds) {
        yield call(dbManager.deleteObjectById, RealmSchema.Wallet, walletId);
      }
    }
    if (signerIds?.length > 0) {
      for (const signerId of signerIds) {
        yield call(dbManager.deleteObjectByPrimaryKey, RealmSchema.Signer, 'id', signerId);
      }
    }
    return response;
  } catch (err) {
    captureError(err);
    return { updated: false, error: err };
  }
}

export function* deleteVaultImageWorker({
  payload,
}: {
  payload: {
    vaultIds: string[];
  };
}) {
  try {
    const backupResponse = yield call(checkBackupCondition);
    if (backupResponse) return { updated: true, error: '' };
    const { vaultIds } = payload;
    const { id }: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
    const response = yield call(Relay.deleteVaultImage, {
      appId: id,
      vaults: vaultIds,
    });
    return response;
  } catch (err) {
    captureError(err);
    return { updated: false, error: err };
  }
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

function* getAppImageWorker({ payload }) {
  const { primaryMnemonic, isForgot } = payload;
  try {
    yield put(setAppImageError(''));
    if (!bip39.validateMnemonic(primaryMnemonic)) {
      throw Error('Invalid mnemonic');
    }
    const { bitcoinNetworkType } = yield select((state: RootState) => state.settings);
    const primarySeed = bip39.mnemonicToSeedSync(primaryMnemonic);
    const appID = crypto.createHash('sha256').update(primarySeed).digest('hex');
    if (isForgot) {
      // Allow only existing appId to be recovered using forgot passcode flow.
      const { allAccounts } = yield select((state: RootState) => state.account);
      const idx = allAccounts.findIndex((acc) => acc.appId == appID);
      if (idx == -1) throw Error('Not an existing app. Please recover an existing app.');
    }

    const encryptionKey = generateEncryptionKey(primarySeed.toString('hex'));
    const response = yield call(Relay.getAppImage, appID);
    if (!response?.appImage) throw new Error('Recovery data unavailable');
    const { appImage } = response;
    const labels = response.labels === undefined ? [] : response.labels;
    const allVaultImages = response.allVaultImages === undefined ? [] : response.allVaultImages;

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
    yield call(
      recoverApp,
      primaryMnemonic,
      primarySeed,
      encryptionKey,
      appID,
      dhSubscription,
      appImage,
      allVaultImages,
      labels,
      previousVersion
    );

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
      const created = yield call(addNewWalletsWorker, { payload: [defaultWallet] });
      if (created !== true) throw new Error('Recovery data unavailable');
    }

    const recoveryKeySigner = setupRecoveryKeySigningKey(primaryMnemonic);
    yield call(addSigningDeviceWorker, { payload: { signers: [recoveryKeySigner] } });
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
      yield call(applyUpgradeSequence, { previousVersion, newVersion, isRecovery: true });
      try {
        yield call(Relay.updateAppImage, {
          appId: appImage.appId,
          version: newVersion,
        });
      } catch (err) {
        console.log(err);
      }
    }
    yield put(addAccount(appID));
    yield put(autoSyncWallets(true, true, false));
    yield put(
      saveDefaultWalletState({
        appId: appID,
        data: { [NetworkType.MAINNET]: true, [NetworkType.TESTNET]: true },
      })
    );
    yield put(uaiChecks([uaiType.SECURE_VAULT]));
    yield put(loadConciergeUser(null));
    yield put(loadConciergeTickets([]));
    yield put(setRecoveryKeyStatus({ appId: appID, status: 'confirmed' }));
    yield put(setAppCreated(true));
  } catch (err) {
    yield put(setAppImageError(err.message));
  } finally {
    yield put(appImagerecoveryRetry());
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
  previousVersion
) {
  const { bitcoinNetworkType } = yield select((state: RootState) => state.settings);
  const recovered: BackupImage = yield call(
    prepareRecoveryImage,
    encryptionKey,
    appID,
    appImage,
    allVaultImages,
    labels
  );
  const entropy = yield call(
    BIP85.bip39MnemonicToEntropy,
    config.BIP85_IMAGE_ENCRYPTIONKEY_DERIVATION_PATH,
    primaryMnemonic
  );
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

  yield call(writeRecoveredObject, RealmSchema.KeeperApp, app);

  // Wallet recreation
  if (appImage.wallets) {
    for (const decryptedWallet of Object.values(recovered.wallets) as Wallet[]) {
      try {
        if (decryptedWallet.entityKind === EntityKind.USDT_WALLET)
          yield call(writeRecoveredObject, RealmSchema.USDTWallet, decryptedWallet);
        else yield call(writeRecoveredObject, RealmSchema.Wallet, decryptedWallet);
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
        yield call(writeRecoveredObject, RealmSchema.Signer, decrytpedSigner);
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
              yield call(writeRecoveredObject, RealmSchema.Signer, signerObject);
            }
          }
        }
        yield call(writeRecoveredObject, RealmSchema.Vault, vault);
      } catch (err) {
        throw new Error('Recovery data unavailable');
      }
    }
  }

  // Labels Restore
  if (labels) {
    for (const label of Object.values(recovered.labels)) {
      yield call(writeRecoveredObject, RealmSchema.Tags, label);
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
        const deleted = yield call(
          dbManager.deleteObjectById,
          RealmSchema.NodeConnect,
          node.id.toString()
        );
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
        yield call(writeRecoveredObject, RealmSchema.NodeConnect, decryptedNode);
      } catch (err) {
        throw new Error('Recovery data unavailable');
      }
    }
  }

  // Connect to a node
  const savedNodes: NodeDetail[] = yield call(dbManager.getCollection, RealmSchema.NodeConnect);
  if (savedNodes.length > 0 && !savedNodes.find((node) => node.isConnected)) {
    const firstNode = savedNodes[0];
    firstNode.isConnected = true;

    const connected = yield call(
      dbManager.updateObjectById,
      RealmSchema.NodeConnect,
      firstNode.id.toString(),
      firstNode
    );
    if (connected !== true) throw new Error('Recovery data unavailable');
  }

  // seed confirm for recovery
  yield call(writeRecoveredObject, RealmSchema.BackupHistory, {
    title: BackupAction.SEED_BACKUP_CONFIRMED,
    date: moment().unix(),
    confirmed: true,
    subtitle: 'Recovered using backup phrase',
  });

  // Recovery proves possession of the Recovery Key, but is not consent to
  // enable Assisted Server Backup. This transient flag triggers a new upload
  // when the health-check screen mounts; persistent key status is set by the
  // completed recovery worker instead.
  yield put(setSeedConfirmed(false));
  yield put(setBackupType(BackupType.SEED));
  yield put(uaiActioned({ uaiType: uaiType.RECOVERY_PHRASE_HEALTH_CHECK, action: true }));

  // create/add restored object for version
  yield call(writeRecoveredObject, RealmSchema.VersionHistory, {
    version: `${DeviceInfo.getVersion()}(${DeviceInfo.getBuildNumber()})`,
    date: new Date().toString(),
    title: 'Recovered Wallet',
  });

  yield put(setAppId(appID));
}

function* writeRecoveredObject(schema: RealmSchema, record: any) {
  // Realm's adapter returns false/undefined on a rejected write instead of
  // throwing. Never count that record as recovered or report partial success.
  const written = yield call(dbManager.createObject, schema, record);
  if (written !== true) throw new Error('Recovery data unavailable');
  // Realm writes complete synchronously. Break the saga's synchronous effect
  // chain between records so a large restore cannot exhaust the JS stack.
  yield call(pauseBackup);
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
          const oldDetails = oldDetialsArray.map((details) => {
            return { ...details, date: new Date(details.actionDate) };
          });

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

export const getAppImageWatcher = createWatcher(getAppImageWorker, GET_APP_IMAGE);
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
  deleteAppImageEntityWorker,
  DELETE_APP_IMAGE_ENTITY
);

const backupInspectionOwners = new Map<string, number>();

function* runBackupInspection(repair: boolean) {
  const { id }: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
  backupInspectionOwners.set(id, (backupInspectionOwners.get(id) ?? 0) + 1);
  let finalPhase: RepairPhase = 'unverified';
  let inspection: Promise<RepairPhase> | undefined;
  let updates: ReturnType<typeof eventChannel<RepairPhase>> | undefined;
  try {
    yield put(setBackupRepairRunning({ appId: id, running: true }));
    updates = eventChannel<RepairPhase>((emit) => {
      inspection = inspectBackup(id, repair, (phase) => emit(phase));
      inspection.then(
        () => emit(END),
        () => emit(END)
      );
      return () => {};
    }, buffers.expanding());
    while (true) {
      const phase = yield takeMaybe(updates);
      if (phase === END) break;
      finalPhase = phase;
      yield put(setBackupRepairState({ appId: id, phase }));
    }
    const current: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
    if (current?.id === id) {
      yield put(setPendingAllBackup(finalPhase !== 'verified'));
      if (finalPhase === 'verified') {
        const notifications = dbManager.getObjectByField(
          RealmSchema.UAI,
          uaiType.SERVER_BACKUP_FAILURE,
          'uaiType'
        );
        for (const uai of notifications)
          yield call(uaiActionedWorker, { payload: { uaiId: uai.id, action: true } });
      } else if (
        !dbManager.getObjectByField(RealmSchema.UAI, uaiType.SERVER_BACKUP_FAILURE, 'uaiType')
          ?.length
      ) {
        yield call(addToUaiStackWorker, {
          payload: {
            uaiType: uaiType.SERVER_BACKUP_FAILURE,
            uaiDetails: {
              heading: 'Check Your Backup',
              body: 'Your Assisted Server Backup may differ from this device. View details to check it.',
            },
          },
        });
      }
    }
    return finalPhase === 'verified';
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

function* backupFreshnessWorker({ type }) {
  const { automaticCloudBackup } = yield select((state: RootState) => state.bhr);
  if (!automaticCloudBackup) return;
  yield call(runBackupInspection, type === REPAIR_BACKUP);
}

export function* backupFreshnessWatcher() {
  yield takeEvery([CHECK_BACKUP_FRESHNESS, REPAIR_BACKUP], backupFreshnessWorker);
}

function* backupAllSignersAndVaultsWorker() {
  const { id }: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
  yield put(setBackupAllSuccess(false));
  yield put(setBackupAllFailure(false));
  yield put(setBackupAllLoading(true));
  try {
    const verified = yield call(runBackupInspection, true);
    const current: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
    if (current?.id === id)
      yield put(verified ? setBackupAllSuccess(true) : setBackupAllFailure(true));
    return verified;
  } finally {
    yield put(setBackupAllLoading(false));
  }
}

export const backupAllSignersAndVaultsWatcher = createWatcher(
  backupAllSignersAndVaultsWorker,
  BACKUP_ALL_SIGNERS_AND_VAULTS
);

function* deleteBackupWorker() {
  yield put(setBackupAllLoading(true));
  try {
    const { id }: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);

    yield call(Relay.deleteBackup, {
      appId: id,
    });
    yield put(setDeleteBackupSuccess(true));
    yield put(setPendingAllBackup(false));
    return true;
  } catch (error) {
    yield put(setDeleteBackupFailure(true));
    console.log('🚀 ~ deleteBackupWorker ~ error:', error);
    return false;
  } finally {
    yield put(setBackupAllLoading(false));
  }
}

export const deleteBackupWatcher = createWatcher(deleteBackupWorker, DELETE_BACKUP);

export function* checkBackupCondition(expectedAppId?: string) {
  const { automaticCloudBackup } = yield select((state: RootState) => state.bhr);
  if (!automaticCloudBackup) return true;
  const { id }: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
  if (expectedAppId && id !== expectedAppId) return true;
  markBackupMutation(id);
  yield put(invalidateBackupRepair(id));
  const netInfo = yield call(NetInfo.fetch);
  if (!netInfo.isConnected) {
    yield call(setServerBackupFailed);
    return true;
  }
  // Never suppress this incremental write or replace it with a snapshot: wallet
  // creation invokes us before persisting the new wallet to Realm. An old
  // mismatch is repaired only after Back Up Now, separately from this mutation.
  return false;
}

export function* setServerBackupFailed() {
  const uaiCollection = dbManager.getObjectByField(
    RealmSchema.UAI,
    uaiType.SERVER_BACKUP_FAILURE,
    'uaiType'
  );
  for (const uai of uaiCollection) {
    if (uai.uaiType === uaiType.SERVER_BACKUP_FAILURE) {
      yield call(uaiActionedWorker, {
        payload: { uaiId: uai.id, action: false },
      });
    }
  }
  yield call(addToUaiStackWorker, {
    payload: {
      uaiType: uaiType.SERVER_BACKUP_FAILURE,
      uaiDetails: {
        heading: 'Assisted Server Backup Has Failed',
        body: "Retry backup to Keeper's servers",
      },
    },
  });
  yield put(setPendingAllBackup(true));
}

function* validateServerBackupWorker({ callback }) {
  const matched = yield call(runBackupInspection, false);
  const { id }: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
  const { backupRepairStateByAppId = {} } = yield select((state: RootState) => state.bhr);
  callback({
    status: matched,
    error: backupRepairStateByAppId[id] === 'unverified',
    message: matched ? 'Backup verified successfully.' : 'Backup could not be verified.',
  });
}

export const validateSeverBackupWatcher = createWatcher(
  validateServerBackupWorker,
  VALIDATE_SERVER_BACKUP
);
