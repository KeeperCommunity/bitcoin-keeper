import * as bip39 from 'bip39';
import { Wallet } from 'src/services/wallets/interfaces/wallet';
import { call, put, select } from 'redux-saga/effects';
import config from 'src/utils/service-utilities/config';
import {
  decrypt,
  encrypt,
  generateEncryptionKey,
  hash256,
} from 'src/utils/service-utilities/encryption';
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
  setBackupLoading,
  setBackupType,
  setDeleteBackupFailure,
  setDeleteBackupSuccess,
  setHomeToastMessage,
  setIsCloudBsmsBackupRequired,
  setPendingAllBackup,
  setSeedConfirmed,
} from '../reducers/bhr';
import {
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
  areSetsEqual,
  getKeyUID,
  sanitizeSeedKeyForBackup,
  sanitizeVaultSignersForSeedKeyBackup,
} from 'src/utils/utilities';
import NetInfo from '@react-native-community/netinfo';
import { addToUaiStackWorker, uaiActionedWorker } from './uai';
import { addAccount, saveDefaultWalletState } from '../reducers/account';
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
    } else if (signers) {
      for (const signer of signers) {
        const encrytedSigner = encrypt(
          encryptionKey,
          JSON.stringify(sanitizeSeedKeyForBackup(signer))
        );
        signersObject[getKeyUID(signer)] = encrytedSigner;
      }
    } else if (updateNodes) {
      const nodes: NodeDetail[] = yield call(dbManager.getCollection, RealmSchema.NodeConnect);
      if (nodes && nodes.length > 0) {
        for (const index in nodes) {
          const node = nodes[index];
          node.isConnected = false;
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
    });
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

  if (isUpdate) {
    const response = yield call(Relay.updateVaultImage, {
      isUpdate,
      vaultId: vault.id,
      vault: vaultEncrypted,
    });
    return response;
  }

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

  // TODO to be removed
  const subscriptionStrings = JSON.stringify(subscription);

  try {
    const response = yield call(Relay.updateVaultImage, {
      appID: id,
      vaultId: vault.id,
      signersData,
      vault: vaultEncrypted,
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
  const { primaryMnemonic } = payload;
  try {
    yield put(setAppImageError(''));
    if (!bip39.validateMnemonic(primaryMnemonic)) {
      throw Error('Invalid mnemonic');
    }
    const { bitcoinNetworkType } = yield select((state: RootState) => state.settings);
    const primarySeed = bip39.mnemonicToSeedSync(primaryMnemonic);
    const appID = crypto.createHash('sha256').update(primarySeed).digest('hex');
    const encryptionKey = generateEncryptionKey(primarySeed.toString('hex'));
    let appImage = { appId: appID, version: null, wallets: {}, signers: {}, nodes: [] };
    let subscription = null;
    let labels = [];
    let allVaultImages = [];

    try {
      const response = yield call(Relay.getAppImage, appID);
      if (response) {
        appImage = response.appImage || appImage;
        subscription = response.subscription || subscription;
        labels = response.labels || labels;
        allVaultImages = response.allVaultImages || allVaultImages;
      }
    } catch (err) {
      console.log('Error retrieving app image from relay:', err);
      // Continue with empty defaults
    }

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
      yield call(addNewWalletsWorker, { payload: [defaultWallet] });
    }

    const recoveryKeySigner = setupRecoveryKeySigningKey(primaryMnemonic);
    yield call(addSigningDeviceWorker, { payload: { signers: [recoveryKeySigner] } });

    // applying the restore upgrade sequence if required
    const newVersion = DeviceInfo.getVersion();
    if (previousVersion && semver.lt(previousVersion, newVersion)) {
      console.log(`applying restore upgarde sequence - from: ${previousVersion} to ${newVersion}`);
      yield call(applyUpgradeSequence, { previousVersion, newVersion });
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

  yield call(dbManager.createObject, RealmSchema.KeeperApp, app);

  // Wallet recreation
  if (appImage.wallets) {
    for (const [key, value] of Object.entries(appImage.wallets)) {
      try {
        const decryptedWallet: Wallet = JSON.parse(decrypt(encryptionKey, value));
        if (decryptedWallet.entityKind === EntityKind.USDT_WALLET)
          yield call(dbManager.createObject, RealmSchema.USDTWallet, decryptedWallet);
        else yield call(dbManager.createObject, RealmSchema.Wallet, decryptedWallet);
      } catch (err) {
        console.log('Error recovering a wallet: ', err);
        continue;
      }
    }
  }

  // Signers recreatin
  if (appImage.signers) {
    for (const [key, value] of Object.entries(appImage.signers)) {
      try {
        const decrytpedSigner: Signer = JSON.parse(decrypt(encryptionKey, value));
        if (!decrytpedSigner?.id) {
          decrytpedSigner.id = getKeyUID(decrytpedSigner);
        }
        if (!decrytpedSigner?.networkType) {
          // adds missing network type to signer as per the env type
          decrytpedSigner.networkType = config.isDevMode()
            ? NetworkType.TESTNET
            : NetworkType.MAINNET;
        }
        yield call(dbManager.createObject, RealmSchema.Signer, decrytpedSigner);
      } catch (err) {
        console.log('Error recovering a signer: ', err);
        continue;
      }
    }
  }

  // Vault recreation
  if (allVaultImages.length > 0) {
    for (const vaultImage of allVaultImages) {
      try {
        const vault = JSON.parse(decrypt(encryptionKey, vaultImage.vault));

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
              yield call(dbManager.createObject, RealmSchema.Signer, signerObject);
            }
          }

          yield call(dbManager.createObject, RealmSchema.Vault, vault);
        }
        yield call(dbManager.createObject, RealmSchema.Vault, vault);
      } catch (err) {
        console.log('Error recovering a vault: ', err);
        continue;
      }
    }
  }

  // Labels Restore
  if (labels) {
    const restoredLabels = [];
    for (const label of labels) {
      try {
        restoredLabels.push(JSON.parse(decrypt(encryptionKey, label.content)));
      } catch {
        console.log('Failed to restore label');
      }
    }
    yield call(dbManager.createObjectBulk, RealmSchema.Tags, restoredLabels);
  }

  if (appImage.nodes) {
    // Delete all default nodes to only use the nodes from the user's backup
    const existingNodes: NodeDetail[] = yield call(
      dbManager.getCollection,
      RealmSchema.NodeConnect
    );
    for (const node of existingNodes) {
      if (node && node.id) {
        yield call(dbManager.deleteObjectById, RealmSchema.NodeConnect, node.id.toString());
      }
    }
    for (const node of appImage.nodes) {
      try {
        const decryptedNode = JSON.parse(decrypt(encryptionKey, node));
        if (!decryptedNode?.networkType) {
          decryptedNode.networkType = config.isDevMode()
            ? NetworkType.TESTNET
            : NetworkType.MAINNET;
        }
        yield call(dbManager.createObject, RealmSchema.NodeConnect, decryptedNode);
      } catch (err) {
        console.log('Error recovering a node: ', err);
        continue;
      }
    }
  }

  // Connect to a node
  const savedNodes: NodeDetail[] = yield call(dbManager.getCollection, RealmSchema.NodeConnect);
  if (savedNodes.length > 0 && !savedNodes.find((node) => node.isConnected)) {
    const firstNode = savedNodes[0];
    firstNode.isConnected = true;

    yield call(
      dbManager.updateObjectById,
      RealmSchema.NodeConnect,
      firstNode.id.toString(),
      firstNode
    );
  }

  // seed confirm for recovery
  yield call(dbManager.createObject, RealmSchema.BackupHistory, {
    title: BackupAction.SEED_BACKUP_CONFIRMED,
    date: moment().unix(),
    confirmed: true,
    subtitle: 'Recovered using backup phrase',
  });

  yield put(setSeedConfirmed(true));
  yield put(setBackupType(BackupType.SEED));
  yield put(uaiActioned({ uaiType: uaiType.RECOVERY_PHRASE_HEALTH_CHECK, action: true }));

  // create/add restored object for version
  yield call(dbManager.createObject, RealmSchema.VersionHistory, {
    version: `${DeviceInfo.getVersion()}(${DeviceInfo.getBuildNumber()})`,
    date: new Date().toString(),
    title: 'Restored version',
  });

  yield put(setAppId(appID));
  yield put(setAppCreated(true));
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

function* backupAllSignersAndVaultsWorker() {
  yield put(setBackupAllSuccess(false));
  yield put(setBackupAllFailure(false));
  yield put(setBackupAllLoading(true));
  try {
    // clear backup failure notification
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

    const { primarySeed, id, publicId, subscription, networkType, version }: KeeperApp = yield call(
      dbManager.getObjectByIndex,
      RealmSchema.KeeperApp
    );
    const encryptionKey = generateEncryptionKey(primarySeed);
    const walletObject = {};
    const signersObject = {};
    const vaultObject = {};

    // update all wallets and signers
    const btcWallets: Wallet[] = yield call(dbManager.getCollection, RealmSchema.Wallet);
    const usdtWallets = yield call(dbManager.getObjectByIndex, RealmSchema.USDTWallet, null, true);
    const wallets = [...btcWallets, ...usdtWallets];

    for (const index in wallets) {
      const wallet = wallets[index];
      const encrytedWallet = encrypt(encryptionKey, JSON.stringify(wallet));
      walletObject[wallet.id] = encrytedWallet;
    }
    const signers: Signer[] = yield call(dbManager.getCollection, RealmSchema.Signer);
    for (const index in signers) {
      const signer = signers[index];
      const encrytedSigner = encrypt(
        encryptionKey,
        JSON.stringify(sanitizeSeedKeyForBackup(signer))
      );
      signersObject[getKeyUID(signer)] = encrytedSigner;
    }
    const vaults: Vault[] = yield call(dbManager.getCollection, RealmSchema.Vault);
    for (const index in vaults) {
      const vault = vaults[index];
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
          signerId: getKeyUID(signer),
          xfpHash: hash256(signer.masterFingerprint),
        });
      }
      vaultObject[vault.id] = {
        vaultId: vault.id,
        signersData,
        vault: vaultEncrypted,
      };
    }

    const nodes: NodeDetail[] = yield call(dbManager.getCollection, RealmSchema.NodeConnect);
    const nodesToUpdate = [];
    if (nodes && nodes.length > 0) {
      for (const index in nodes) {
        const node = nodes[index];
        node.isConnected = false;
        const encryptedNode = encrypt(encryptionKey, JSON.stringify(node));
        nodesToUpdate.push(encryptedNode);
      }
    }

    const labels = yield call(dbManager.getCollection, RealmSchema.Tags);
    const tagsToBackup = labels.map((tag) => ({
      id: hash256(hash256(encryptionKey + tag.id)),
      content: encrypt(encryptionKey, JSON.stringify(tag)),
    }));

    yield call(Relay.backupAllSignersAndVaults, {
      appId: id,
      publicId,
      walletObject,
      signersObject,
      vaultObject,
      networkType,
      subscription: JSON.stringify(subscription),
      version,
      nodes: nodesToUpdate,
      labels: tagsToBackup,
    });
    yield put(setBackupAllSuccess(true));
    yield put(setPendingAllBackup(false));
    return true;
  } catch (error) {
    yield put(setBackupAllFailure(true));
    yield call(setServerBackupFailed);
    console.log('🚀 ~ function*backupAllSignersAndVaultsWorker ~ error:', error);
    yield put(
      setHomeToastMessage({
        message: 'Assisted server backup failed. Please try again later.',
        isError: true,
      })
    );
    return false;
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

export function* checkBackupCondition() {
  const { pendingAllBackup, automaticCloudBackup } = yield select((state: RootState) => state.bhr);
  const { subscription }: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
  // if (automaticCloudBackup && subscription.level === AppSubscriptionLevel.L1 && !pendingAllBackup) {
  if (automaticCloudBackup && !pendingAllBackup) {
    yield put(setAutomaticCloudBackup(false));
    return true;
  }
  if (!automaticCloudBackup) return true;
  const netInfo = yield call(NetInfo.fetch);
  if (!netInfo.isConnected) {
    yield call(setServerBackupFailed);
    return true;
  }
  if (pendingAllBackup) {
    yield call(backupAllSignersAndVaultsWorker);
    return true;
  }
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
  try {
    const { primarySeed, id }: KeeperApp = yield call(
      dbManager.getObjectByIndex,
      RealmSchema.KeeperApp
    );
    const encryptionKey = generateEncryptionKey(primarySeed as string);
    let { allVaultImages, appImage, labels } = yield call(Relay.getAppImage, id);
    const { nodes, wallets, signers = {} } = appImage;

    // Check for vaults
    let localVaultIds = yield call(dbManager.getCollection, RealmSchema.Vault);
    localVaultIds = localVaultIds.map((item) => item.id);
    let decryptedVaultIds = [];
    for (const index in allVaultImages) {
      decryptedVaultIds.push(JSON.parse(decrypt(encryptionKey, allVaultImages[index].vault)).id);
    }
    if (!areSetsEqual(new Set(localVaultIds), new Set(decryptedVaultIds)))
      return callback({ status: false, message: 'Vaults do not match' });

    // Check for labels
    let localLabelIds: any = yield call(dbManager.getCollection, RealmSchema.Tags);
    localLabelIds = localLabelIds.map((item) => item.id);
    if (labels.length !== localLabelIds.length)
      return callback({ status: false, message: 'Labels do not match' });
    const decryptedLabelIds = [];
    for (const index in labels) {
      decryptedLabelIds.push(JSON.parse(decrypt(encryptionKey, labels[index].content)).id);
    }
    if (!areSetsEqual(new Set(localLabelIds), new Set(decryptedLabelIds)))
      return callback({ status: false, message: 'Labels do not match' });

    //  Check for Signers
    let localSignerIds: any = yield call(dbManager.getCollection, RealmSchema.Signer);
    localSignerIds = localSignerIds.map((item) => item.id);
    if (Object.keys(signers).length !== localSignerIds.length)
      return callback({ status: false, message: 'Signers do not match' });
    let decryptedSignerIds = [];
    for (const index in signers) {
      decryptedSignerIds.push(JSON.parse(decrypt(encryptionKey, signers[index])).id);
    }
    if (!areSetsEqual(new Set(localSignerIds), new Set(decryptedSignerIds)))
      return callback({ status: false, message: 'Signers do not match' });

    //  Check for Wallets
    let localWallets: any = yield call(dbManager.getCollection, RealmSchema.Wallet);
    const walletsBackupLength = Array.isArray(wallets)
      ? wallets.length
      : Object.keys(wallets).length;
    if (walletsBackupLength !== localWallets.length)
      return callback({ status: false, message: 'Wallets do not match' });
    const localWalletIds = localWallets.map((item) => item.id);
    let decryptedWalletIds = [];
    for (const index in wallets) {
      decryptedWalletIds.push(JSON.parse(decrypt(encryptionKey, wallets[index])).id);
    }
    if (!areSetsEqual(new Set(localWalletIds), new Set(decryptedWalletIds)))
      return callback({ status: false, message: 'Wallets do not match' });

    //  Check for nodes
    let localNodes: any = yield call(dbManager.getCollection, RealmSchema.NodeConnect);
    localNodes = localNodes.map((node) => {
      node.isConnected = false;
      return JSON.stringify(node);
    });
    if (localNodes.length !== nodes.length)
      return callback({ status: false, message: 'Nodes do not match' });
    const decryptedNodes = [];
    for (const index in nodes) {
      decryptedNodes.push(JSON.stringify(JSON.parse(decrypt(encryptionKey, nodes[index]))));
    }
    const missingNodes = decryptedNodes.filter((item) => !localNodes.includes(item));
    if (missingNodes.length > 0) return callback({ status: false, message: 'Nodes do not match' });

    return callback({ status: true, message: 'Backup verified successfully.' });
  } catch (error) {
    console.log('🚀 ~ function*validateServerBackupWorker ~ error:', error);
    return callback({ status: false, message: 'Backup verification failed.', error: true });
  }
}

export const validateSeverBackupWatcher = createWatcher(
  validateServerBackupWorker,
  VALIDATE_SERVER_BACKUP
);
