import { call, put, select } from 'redux-saga/effects';
import semver from 'semver';
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import Relay from 'src/services/backend/Relay';
import DeviceInfo from 'react-native-device-info';
import { getReleaseTopic } from 'src/utils/releaseTopic';
import messaging from '@react-native-firebase/messaging';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import { BIP329Label, UTXOInfo } from 'src/services/wallets/interfaces';
import { LabelRefType, SignerType, XpubTypes } from 'src/services/wallets/enums';
import { generateAbbreviatedOutputDescriptors } from 'src/utils/service-utilities/utils';
import { Wallet } from 'src/services/wallets/interfaces/wallet';
import {
  HealthCheckDetails,
  Signer,
  Vault,
  VaultSigner,
} from 'src/services/wallets/interfaces/vault';
import SigningServer from 'src/services/backend/SigningServer';
import { generateExtendedKeysForCosigner } from 'src/services/wallets/factories/WalletFactory';
import { captureError } from 'src/services/sentry';
import { encrypt, generateEncryptionKey, hash256 } from 'src/utils/service-utilities/encryption';
import { hcStatusType } from 'src/models/interfaces/HeathCheckTypes';
import { getKeyUID } from 'src/utils/utilities';
import WalletUtilities from 'src/services/wallets/operations/utils';
import {
  updateVersionHistory,
  UPDATE_VERSION_HISTORY,
  migrateLabelsToBip329,
  MIGRATE_LABELS_329,
} from '../sagaActions/upgrade';
import { updateAppImageWorker, updateVaultImageWorker } from './bhr';
import { createWatcher } from '../utilities';
import { setAppVersion } from '../reducers/storage';
import { setPendingAllBackup } from '../reducers/bhr';
import { RootState } from '../store';

export const LABELS_INTRODUCTION_VERSION = '1.0.4';
export const BIP329_INTRODUCTION_VERSION = '1.0.7';
export const KEY_MANAGEMENT_VERSION = '1.1.9';
export const APP_KEY_UPGRADE_VERSION = '1.1.12';
export const HEALTH_CHECK_TIMELINE_MIGRATION_VERSION = '1.2.6';
export const SIGNER_POLICY_MIGRATION_VERSION = '2.1.0';

export function* applyUpgradeSequence({
  previousVersion,
  newVersion,
}: {
  previousVersion: string;
  newVersion: string;
}) {
  console.log(`applying upgrade sequence - from: ${previousVersion} to ${newVersion}`);

  if (
    semver.gte(previousVersion, LABELS_INTRODUCTION_VERSION) &&
    semver.lt(previousVersion, BIP329_INTRODUCTION_VERSION)
  ) {
    yield put(migrateLabelsToBip329());
  }

  if (semver.lt(previousVersion, KEY_MANAGEMENT_VERSION)) {
    yield call(migrateStructureforSignersInAppImage);
    yield call(migrateStructureforVaultInAppImage);
  }
  if (semver.lt(previousVersion, APP_KEY_UPGRADE_VERSION)) yield call(updateAppKeysToEnableSigning);

  if (semver.lt(previousVersion, HEALTH_CHECK_TIMELINE_MIGRATION_VERSION)) {
    yield call(healthCheckTimelineMigration);
  }

  if (semver.lt(previousVersion, SIGNER_POLICY_MIGRATION_VERSION)) {
    yield call(migrateServerKeyPolicy);
    yield put(setPendingAllBackup(true));
  }

  yield put(setAppVersion(newVersion));
  yield put(updateVersionHistory(previousVersion, newVersion));
}

function* updateVersionHistoryWorker({
  payload,
}: {
  payload: { previousVersion: string; newVersion: string };
}) {
  const { previousVersion, newVersion } = payload;
  try {
    const app: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
    const response = yield call(Relay.updateAppImage, {
      appId: app.id,
      version: newVersion,
    });
    yield call(dbManager.createObject, RealmSchema.VersionHistory, {
      version: `${newVersion}(${DeviceInfo.getBuildNumber()})`,
      date: new Date().toString(),
      title: `Upgraded from ${previousVersion} to ${newVersion}`,
    });
    messaging().unsubscribeFromTopic(getReleaseTopic(previousVersion));
    messaging().subscribeToTopic(getReleaseTopic(newVersion));
  } catch (error) {
    console.log({ error });
  }
}

export const updateVersionHistoryWatcher = createWatcher(
  updateVersionHistoryWorker,
  UPDATE_VERSION_HISTORY
);

function* migrateLablesWorker() {
  try {
    const UTXOLabels: UTXOInfo[] = yield call(dbManager.getCollection, RealmSchema.UTXOInfo);
    const tags = [];
    const wallets: Wallet[] = yield call(dbManager.getCollection, RealmSchema.Wallet);

    UTXOLabels.forEach((utxo) => {
      if (utxo.labels.length) {
        const wallet = wallets.find((w) => w.id === utxo.walletId);
        const origin = generateAbbreviatedOutputDescriptors(wallet);
        utxo.labels.forEach((label) => {
          const ref = `${utxo.txId}:${utxo.vout}`;
          const labelName = label.name;
          const tag: BIP329Label = {
            id: `${ref}${labelName}`,
            type: LabelRefType.OUTPUT,
            isSystem: false,
            label: labelName,
            ref,
            origin,
          };
          tags.push(tag);
        });
      }
    });

    if (tags.length) {
      yield call(dbManager.createObjectBulk, RealmSchema.Tags, tags);

      const { id, primarySeed }: KeeperApp = yield call(
        dbManager.getObjectByIndex,
        RealmSchema.KeeperApp
      );
      const encryptionKey = generateEncryptionKey(primarySeed);
      const tagsToBackup = tags.map((tag) => ({
        id: hash256(hash256(encryptionKey + tag.id)),
        content: encrypt(encryptionKey, JSON.stringify(tag)),
      }));
      yield call(Relay.modifyLabels, id, tagsToBackup.length ? tagsToBackup : [], []);
    }
  } catch (error) {
    console.log({ error });
  }
}

export const migrateLablesWatcher = createWatcher(migrateLablesWorker, MIGRATE_LABELS_329);

function* migrateStructureforSignersInAppImage() {
  try {
    const wallets = yield call(dbManager.getCollection, RealmSchema.Wallet);
    const signers = yield call(dbManager.getCollection, RealmSchema.Signer);
    const response = yield call(updateAppImageWorker, { payload: { wallets, signers } });
    if (response.updated) {
      console.log('Updated the Signers in app image');
    } else {
      console.log('Failed to update the update the app image with the updated the structure');
    }
  } catch (err) {}
}

function* migrateStructureforVaultInAppImage() {
  try {
    const vaults: Vault[] = yield call(dbManager.getCollection, RealmSchema.Vault);
    const activeVault: Vault = vaults.filter((vault) => !vault.archived)[0] || null;

    yield call(updateVaultImageWorker, {
      payload: { isUpdate: true, vault: activeVault },
    });
  } catch (err) {
    console.log('Something went wrong in updating the vault image', err);
  }
}

// This function updates app keys/mobile keys to enable signing by generating and associating extended keys.
function* updateAppKeysToEnableSigning() {
  try {
    const wallets = yield call(dbManager.getCollection, RealmSchema.Wallet);
    const signers = yield call(dbManager.getCollection, RealmSchema.Signer);
    const keeperSigners = signers.filter(
      (signer) =>
        signer.type === SignerType.KEEPER ||
        signer.type === SignerType.MOBILE_KEY ||
        signer.type === SignerType.MY_KEEPER
    );
    const { appKeyWalletMap, myAppKeySigners } = mapAppKeysToWallets(wallets, keeperSigners);
    const extendedKeyMap = generateExtendedKeysForSigners(myAppKeySigners, appKeyWalletMap);
    updateVaultSigners(extendedKeyMap, signers);
    updateSignerDetails(myAppKeySigners, extendedKeyMap);
    const response = yield call(updateAppImageWorker, { payload: { signers } });
    if (response.updated) {
      console.log('Updated the Signers in app image');
    } else {
      console.log('Failed to update the update the app image with the updated the structure');
    }
  } catch (err) {
    console.log('Error updating mobile keys', err);
    captureError(err);
  }
}

function mapAppKeysToWallets(wallets, keeperSigners) {
  const appKeyWalletMap = {};
  const myAppKeySigners = keeperSigners.filter((signer) => {
    const walletMatch = wallets.find((wallet) => wallet.id === signer.masterFingerprint);
    if (walletMatch) {
      appKeyWalletMap[signer.masterFingerprint] = walletMatch;
      return true;
    }
    return false;
  });

  return { appKeyWalletMap, myAppKeySigners };
}

function generateExtendedKeysForSigners(signers, appKeyWalletMap) {
  const extendedKeyMap = {};
  signers.forEach((signer) => {
    const { mnemonic } = appKeyWalletMap[signer.masterFingerprint].derivationDetails;
    const { extendedKeys } = generateExtendedKeysForCosigner(mnemonic);
    extendedKeyMap[signer.masterFingerprint] = extendedKeys;
  });

  return extendedKeyMap;
}

function updateVaultSigners(extendedKeyMap, signers) {
  const signerMap = {};
  signers.forEach((signer) => (signerMap[getKeyUID(signer)] = signer));
  const vaultKeys: VaultSigner[] = dbManager.getCollection(RealmSchema.VaultSigner);
  for (const vaultKey of vaultKeys) {
    const signer = signerMap[getKeyUID(vaultKey)];
    if (signer && signer.type === SignerType.KEEPER && extendedKeyMap[vaultKey.masterFingerprint]) {
      dbManager.updateObjectByPrimaryId(RealmSchema.VaultSigner, 'xpub', vaultKey.xpub, {
        xpriv: extendedKeyMap[vaultKey.masterFingerprint].xpriv,
      });
    }
  }
}

function updateSignerDetails(signers: Signer[], extendedKeyMap) {
  for (let i = 0; i < signers.length; i++) {
    const signer = signers[i];
    // Update the signer type to MY_KEEPER and the extended keys
    dbManager.updateObjectByPrimaryId(
      RealmSchema.Signer,
      'masterFingerprint',
      signer.masterFingerprint,
      {
        type: SignerType.MY_KEEPER,
      }
    );
    dbManager.updateObjectByPrimaryId(
      RealmSchema.Signer,
      'masterFingerprint',
      signer.masterFingerprint,
      {
        signerXpubs: updateSignerXpubs(signer, extendedKeyMap[signer.masterFingerprint].xpriv),
      }
    );
    if (!signer.extraData?.instanceNumber) {
      try {
        // Update the signer instance number for MY_KEEPER
        dbManager.updateObjectByPrimaryId(
          RealmSchema.Signer,
          'masterFingerprint',
          signer.masterFingerprint,
          {
            extraData: { instanceNumber: i + 1 },
          }
        );
      } catch (err) {
        captureError(err);
        // ignore since instance number is not mandatory
      }
    }
  }
}

function updateSignerXpubs(signer, xpriv) {
  // This function would update the signerXpubs structure with the new xpriv, example provided
  return {
    ...signer.signerXpubs,
    [XpubTypes.P2WSH]: [
      {
        ...signer.signerXpubs[XpubTypes.P2WSH][0],
        xpriv,
      },
    ],
  };
}

function* healthCheckTimelineMigration() {
  try {
    const signers: Signer[] = dbManager.getCollection(RealmSchema.Signer);
    for (const signer of signers) {
      const healthCheckDetails: HealthCheckDetails = {
        type: hcStatusType.HEALTH_CHECK_SUCCESSFULL,
        actionDate: signer.lastHealthCheck,
      };
      dbManager.updateObjectByPrimaryId(
        RealmSchema.Signer,
        'masterFingerprint',
        signer.masterFingerprint,
        {
          healthCheckDetails: [healthCheckDetails],
        }
      );
    }
  } catch (err) {
    console.log('Error in health check timeline migration:', err);
  }
}

function* migrateServerKeyPolicy() {
  // migrates old server key policy to new time-based spending limit policy
  try {
    const { bitcoinNetwork } = yield select((state: RootState) => state.settings);
    const signers: Signer[] = yield call(dbManager.getCollection, RealmSchema.Signer);

    for (const signer of signers) {
      if (signer.type === SignerType.POLICY_SERVER && signer.signerPolicy) {
        const oldPolicy = signer.signerPolicy;
        if (!oldPolicy) {
          throw new Error('Migration aborted: policy missing for Server Key instance');
        }

        const id = WalletUtilities.getFingerprintFromExtendedKey(
          signer.signerXpubs[XpubTypes.P2WSH][0].xpub,
          bitcoinNetwork
        );

        const { newPolicy } = yield call(SigningServer.migrateSignerPolicy, id, oldPolicy);
        if (!newPolicy) {
          throw new Error('Migration failed: policy not updated on the server');
        }

        dbManager.updateObjectByPrimaryId(
          RealmSchema.Signer,
          'masterFingerprint',
          signer.masterFingerprint,
          {
            signerPolicy: newPolicy,
          }
        );
        break;
      }
    }
  } catch (err) {
    console.log('Migrate Server Key policy err:', err);
  }
}
