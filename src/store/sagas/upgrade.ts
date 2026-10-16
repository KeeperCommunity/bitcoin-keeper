import { call, put, select } from 'redux-saga/effects';
import Realm from 'realm';
import semver from 'semver';
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import DeviceInfo from 'react-native-device-info';
import { getReleaseTopic } from 'src/utils/releaseTopic';
import { getApp } from '@react-native-firebase/app';
import {
  getMessaging,
  subscribeToTopic,
  unsubscribeFromTopic,
} from '@react-native-firebase/messaging';
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
  currentBackupAccountSession,
  notifyBackupReconciliation,
} from 'src/services/backup/transport';
import {
  beginBackupLocalOperation,
  commitBackupLocalOperation,
  enqueueAutomaticBackupOperation,
} from 'src/services/backup/automatic';
import type { BackupWriteIntent } from 'src/services/backup/intent';
import { UPDATE_VERSION_HISTORY, MIGRATE_LABELS_329 } from '../sagaActions/upgrade';
import { buildAutomaticAppMutation, buildAutomaticVaultMutation } from './bhr';
import { createWatcher } from '../utilities';
import { setAppVersion } from '../reducers/storage';
import { RootState, store } from '../store';

export const LABELS_INTRODUCTION_VERSION = '1.0.4';
export const BIP329_INTRODUCTION_VERSION = '1.0.7';
export const KEY_MANAGEMENT_VERSION = '1.1.9';
export const APP_KEY_UPGRADE_VERSION = '1.1.12';
export const HEALTH_CHECK_TIMELINE_MIGRATION_VERSION = '1.2.6';
export const SIGNER_POLICY_MIGRATION_VERSION = '2.1.0';

const upgradeAccountIsActive = (appId?: string, accountSession?: number) =>
  !!appId &&
  (accountSession === undefined || accountSession === currentBackupAccountSession()) &&
  store.getState().storage.appId === appId &&
  (dbManager.getObjectByIndex(RealmSchema.KeeperApp) as unknown as KeeperApp)?.id === appId;

type UpgradeGroup = {
  appId: string;
  session: number;
  operation: ReturnType<typeof beginBackupLocalOperation>;
  writes: Array<(realm: Realm) => void>;
  appImage: boolean;
  vaultImages: boolean;
  labelIds: Set<string>;
};

function beginUpgradeGroup(
  appId: string,
  session: number,
  intent?: BackupWriteIntent
): UpgradeGroup {
  return {
    appId,
    session,
    operation: beginBackupLocalOperation(appId, intent, session),
    writes: [],
    appImage: false,
    vaultImages: false,
    labelIds: new Set(),
  };
}

// Preserve one originating base for the whole launch upgrade. Async work is
// staged first, and a failed local write rolls back every migration in the group.
async function completeUpgradeGroup(group: UpgradeGroup) {
  if (!upgradeAccountIsActive(group.appId, group.session)) return false;
  const receipt = commitBackupLocalOperation(group.operation, (realm) => {
    group.writes.forEach((write) => write(realm));
  });
  if (!receipt.committed || !upgradeAccountIsActive(group.appId, group.session)) return false;
  try {
    const mutations: Parameters<typeof enqueueAutomaticBackupOperation>[1] = [];
    if (group.appImage)
      mutations.push(
        buildAutomaticAppMutation(
          {
            wallets: dbManager.getCollection(RealmSchema.Wallet) as unknown as Wallet[],
            signers: dbManager.getCollection(RealmSchema.Signer) as unknown as Signer[],
          },
          group.appId
        )
      );
    if (group.vaultImages) {
      for (const vault of dbManager.getCollection(RealmSchema.Vault) as unknown as Vault[])
        mutations.push(buildAutomaticVaultMutation(vault.id, group.appId, true));
    }
    if (group.labelIds.size) {
      const app = dbManager.getObjectByIndex(RealmSchema.KeeperApp) as unknown as KeeperApp;
      if (app?.id !== group.appId) return false;
      const key = generateEncryptionKey(app.primarySeed);
      const addLabels = (dbManager.getCollection(RealmSchema.Tags) as unknown as BIP329Label[])
        .filter((tag) => group.labelIds.has(tag.id))
        .map((tag) => ({
          id: hash256(hash256(key + tag.id)),
          content: encrypt(key, JSON.stringify(tag)),
        }));
      if (addLabels.length !== group.labelIds.size) throw new Error('Migrated labels unavailable');
      mutations.push({
        operation: 'modifyLabels',
        body: { appId: group.appId, addLabels, deleteLabels: [] },
      });
    }
    if (mutations.length) await enqueueAutomaticBackupOperation(receipt, mutations);
  } catch {
    notifyBackupReconciliation(group.appId);
  }
  // Local success does not assert a cloud acknowledgement. The queue preserves
  // stale/no-baseline/offline local data and leaves its backup pending.
  return true;
}

function stageVersionUpdate(
  group: UpgradeGroup,
  previousVersion: string,
  newVersion: string,
  isRecovery: boolean
) {
  const history = {
    version: `${newVersion}(${DeviceInfo.getBuildNumber()})`,
    date: new Date().toString(),
    title: `Upgraded from ${previousVersion} to ${newVersion}`,
  };
  group.writes.push((realm) => {
    const app = realm.objectForPrimaryKey<KeeperApp>(RealmSchema.KeeperApp, group.appId);
    if (!app) throw new Error('Upgrade account unavailable');
    app.version = newVersion;
    // Recovery records its own single Recovered Wallet entry.
    if (!isRecovery) realm.create(RealmSchema.VersionHistory, history, Realm.UpdateMode.Modified);
  });
  group.appImage = true;
}

function updateReleaseTopics(previousVersion: string, newVersion: string) {
  const messaging = getMessaging(getApp());
  unsubscribeFromTopic(messaging, getReleaseTopic(previousVersion));
  subscribeToTopic(messaging, getReleaseTopic(newVersion));
}

export function* applyUpgradeSequence({
  previousVersion,
  newVersion,
  isRecovery = false,
  originBackupAccountSession,
  originBackupWriteIntent,
}: {
  previousVersion: string;
  newVersion: string;
  isRecovery?: boolean;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
}) {
  const session = originBackupAccountSession ?? currentBackupAccountSession();
  if (session !== currentBackupAccountSession()) return false;
  const appId = originBackupWriteIntent?.appId || store.getState().storage.appId;
  if (!upgradeAccountIsActive(appId, session)) return false;
  try {
    const group = beginUpgradeGroup(appId, session, originBackupWriteIntent);
    if (
      semver.gte(previousVersion, LABELS_INTRODUCTION_VERSION) &&
      semver.lt(previousVersion, BIP329_INTRODUCTION_VERSION)
    )
      yield call(migrateLablesWorker, {
        originAppId: appId,
        originBackupAccountSession: session,
        originBackupWriteIntent,
        upgradeGroup: group,
      });
    if (semver.lt(previousVersion, KEY_MANAGEMENT_VERSION)) {
      yield call(
        migrateStructureforSignersInAppImage,
        appId,
        session,
        originBackupWriteIntent,
        group
      );
      yield call(
        migrateStructureforVaultInAppImage,
        appId,
        session,
        originBackupWriteIntent,
        group
      );
    }
    if (semver.lt(previousVersion, APP_KEY_UPGRADE_VERSION))
      yield call(updateAppKeysToEnableSigning, appId, session, originBackupWriteIntent, group);
    if (semver.lt(previousVersion, HEALTH_CHECK_TIMELINE_MIGRATION_VERSION))
      yield call(healthCheckTimelineMigration, appId, session, originBackupWriteIntent, group);
    if (semver.lt(previousVersion, SIGNER_POLICY_MIGRATION_VERSION))
      yield call(migrateServerKeyPolicy, appId, session, originBackupWriteIntent, group);
    if (!upgradeAccountIsActive(appId, session)) return false;
    stageVersionUpdate(group, previousVersion, newVersion, isRecovery);
    const committed = yield call(completeUpgradeGroup, group);
    if (!committed || !upgradeAccountIsActive(appId, session)) return false;
    yield put(setAppVersion(newVersion));
    if (!upgradeAccountIsActive(appId, session)) return false;
    updateReleaseTopics(previousVersion, newVersion);
    return true;
  } catch (error) {
    captureError(error);
    return false;
  }
}

export function* updateVersionHistoryWorker({
  payload,
  originAppId,
  originBackupAccountSession,
  originBackupWriteIntent,
}: {
  payload: { previousVersion: string; newVersion: string; isRecovery?: boolean };
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
}) {
  const { previousVersion, newVersion, isRecovery = false } = payload;
  const session = originBackupAccountSession ?? currentBackupAccountSession();
  try {
    if (!upgradeAccountIsActive(originAppId, session)) return false;
    const group = beginUpgradeGroup(originAppId, session, originBackupWriteIntent);
    stageVersionUpdate(group, previousVersion, newVersion, isRecovery);
    const committed = yield call(completeUpgradeGroup, group);
    if (!committed || !upgradeAccountIsActive(originAppId, session)) return false;
    updateReleaseTopics(previousVersion, newVersion);
    return true;
  } catch (error) {
    captureError(error);
    return false;
  }
}

export const updateVersionHistoryWatcher = createWatcher(
  updateVersionHistoryWorker,
  UPDATE_VERSION_HISTORY
);

function* migrateLablesWorker({
  originAppId,
  originBackupAccountSession,
  originBackupWriteIntent,
  upgradeGroup,
}: {
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
  upgradeGroup?: UpgradeGroup;
}) {
  const session = originBackupAccountSession ?? currentBackupAccountSession();
  if (!upgradeAccountIsActive(originAppId, session)) return false;
  const group = upgradeGroup || beginUpgradeGroup(originAppId, session, originBackupWriteIntent);
  const utxos: UTXOInfo[] = yield call(dbManager.getCollection, RealmSchema.UTXOInfo);
  const wallets: Wallet[] = yield call(dbManager.getCollection, RealmSchema.Wallet);
  if (!upgradeAccountIsActive(originAppId, session)) return false;
  const tags: BIP329Label[] = [];
  for (const utxo of utxos.filter((value) => value.labels.length)) {
    const wallet = wallets.find((value) => value.id === utxo.walletId);
    if (!wallet) throw new Error('Label migration wallet unavailable');
    const origin = generateAbbreviatedOutputDescriptors(wallet);
    for (const label of utxo.labels) {
      const ref = `${utxo.txId}:${utxo.vout}`;
      tags.push({
        id: `${ref}${label.name}`,
        type: LabelRefType.OUTPUT,
        isSystem: false,
        label: label.name,
        ref,
        origin,
      });
    }
  }
  if (tags.length) {
    group.writes.push((realm) => {
      tags.forEach((tag) => realm.create(RealmSchema.Tags, tag, Realm.UpdateMode.Modified));
    });
    tags.forEach((tag) => group.labelIds.add(tag.id));
  }
  return upgradeGroup ? true : yield call(completeUpgradeGroup, group);
}

export const migrateLablesWatcher = createWatcher(migrateLablesWorker, MIGRATE_LABELS_329);

function* migrateStructureforSignersInAppImage(
  appId: string,
  session: number,
  intent?: BackupWriteIntent,
  parent?: UpgradeGroup
) {
  if (!upgradeAccountIsActive(appId, session)) return false;
  const group = parent || beginUpgradeGroup(appId, session, intent);
  group.appImage = true;
  return parent ? true : yield call(completeUpgradeGroup, group);
}

function* migrateStructureforVaultInAppImage(
  appId: string,
  session: number,
  intent?: BackupWriteIntent,
  parent?: UpgradeGroup
) {
  if (!upgradeAccountIsActive(appId, session)) return false;
  const group = parent || beginUpgradeGroup(appId, session, intent);
  group.vaultImages = true;
  return parent ? true : yield call(completeUpgradeGroup, group);
}

function* updateAppKeysToEnableSigning(
  appId: string,
  session: number,
  intent?: BackupWriteIntent,
  parent?: UpgradeGroup
) {
  if (!upgradeAccountIsActive(appId, session)) return false;
  const group = parent || beginUpgradeGroup(appId, session, intent);
  const wallets = yield call(dbManager.getCollection, RealmSchema.Wallet);
  const signers = yield call(dbManager.getCollection, RealmSchema.Signer);
  if (!upgradeAccountIsActive(appId, session)) return false;
  const keeperSigners = signers.filter((signer) =>
    [SignerType.KEEPER, SignerType.MOBILE_KEY, SignerType.MY_KEEPER].includes(signer.type)
  );
  const { appKeyWalletMap, myAppKeySigners } = mapAppKeysToWallets(wallets, keeperSigners);
  const keys = generateExtendedKeysForSigners(myAppKeySigners, appKeyWalletMap);
  group.writes.push((realm) => {
    updateVaultSigners(realm, keys, signers);
    updateSignerDetails(realm, myAppKeySigners, keys);
  });
  group.appImage = true;
  group.vaultImages = true;
  return parent ? true : yield call(completeUpgradeGroup, group);
}

function mapAppKeysToWallets(wallets, keeperSigners) {
  const walletMap = {};
  const myAppKeySigners = keeperSigners.filter((signer) => {
    const wallet = wallets.find((value) => value.id === signer.masterFingerprint);
    if (!wallet) return false;
    walletMap[signer.masterFingerprint] = wallet;
    return true;
  });
  return { appKeyWalletMap: walletMap, myAppKeySigners };
}

function generateExtendedKeysForSigners(signers, walletMap) {
  const keys = {};
  for (const signer of signers) {
    const { mnemonic } = walletMap[signer.masterFingerprint].derivationDetails;
    const { extendedKeys } = generateExtendedKeysForCosigner(mnemonic);
    if (extendedKeys.xpub !== signer.signerXpubs[XpubTypes.P2WSH][0]?.xpub)
      throw new Error('Migrated mobile key does not match the saved public key');
    keys[signer.masterFingerprint] = extendedKeys;
  }
  return keys;
}

function updateVaultSigners(realm: Realm, keys, signers) {
  const signerMap = Object.fromEntries(signers.map((signer) => [getKeyUID(signer), signer]));
  for (const vaultKey of realm.objects<VaultSigner>(RealmSchema.VaultSigner)) {
    const signer = signerMap[getKeyUID(vaultKey)];
    const key = keys[vaultKey.masterFingerprint];
    if (signer?.type === SignerType.KEEPER && key) {
      if (key.xpub !== vaultKey.xpub)
        throw new Error('Migrated vault key does not match its public key');
      vaultKey.xpriv = key.xpriv;
    }
  }
}

function updateSignerDetails(realm: Realm, signers: Signer[], keys) {
  signers.forEach((signer, index) => {
    const stored = realm.objectForPrimaryKey<Signer>(
      RealmSchema.Signer,
      signer.id || getKeyUID(signer)
    );
    const key = keys[signer.masterFingerprint];
    if (!stored || stored.signerXpubs[XpubTypes.P2WSH][0]?.xpub !== key.xpub)
      throw new Error('Mobile key changed before upgrade commit');
    stored.type = SignerType.MY_KEEPER;
    stored.signerXpubs = updateSignerXpubs(signer, key.xpriv);
    if (!stored.extraData?.instanceNumber)
      stored.extraData = { ...stored.extraData, instanceNumber: index + 1 };
  });
}

function updateSignerXpubs(signer, xpriv) {
  return {
    ...signer.signerXpubs,
    [XpubTypes.P2WSH]: [{ ...signer.signerXpubs[XpubTypes.P2WSH][0], xpriv }],
  };
}

function* healthCheckTimelineMigration(
  appId: string,
  session: number,
  intent?: BackupWriteIntent,
  parent?: UpgradeGroup
) {
  if (!upgradeAccountIsActive(appId, session)) return false;
  const group = parent || beginUpgradeGroup(appId, session, intent);
  const signers = dbManager.getCollection(RealmSchema.Signer) as unknown as Signer[];
  group.writes.push((realm) => {
    for (const signer of signers) {
      const stored = realm.objectForPrimaryKey<Signer>(
        RealmSchema.Signer,
        signer.id || getKeyUID(signer)
      );
      if (!stored) throw new Error('Health-check signer unavailable');
      const detail: HealthCheckDetails = {
        type: hcStatusType.HEALTH_CHECK_SUCCESSFULL,
        actionDate: signer.lastHealthCheck,
      };
      stored.healthCheckDetails = [detail];
    }
  });
  group.appImage = true;
  return parent ? true : yield call(completeUpgradeGroup, group);
}

function* migrateServerKeyPolicy(
  appId: string,
  session: number,
  intent?: BackupWriteIntent,
  parent?: UpgradeGroup
) {
  if (!upgradeAccountIsActive(appId, session)) return false;
  const group = parent || beginUpgradeGroup(appId, session, intent);
  const { bitcoinNetwork } = yield select((state: RootState) => state.settings);
  const signers: Signer[] = yield call(dbManager.getCollection, RealmSchema.Signer);
  if (!upgradeAccountIsActive(appId, session)) return false;
  const signer = signers.find(
    (value) => value.type === SignerType.POLICY_SERVER && value.signerPolicy
  );
  if (signer) {
    const id = WalletUtilities.getFingerprintFromExtendedKey(
      signer.signerXpubs[XpubTypes.P2WSH][0].xpub,
      bitcoinNetwork
    );
    const { newPolicy } = yield call(SigningServer.migrateSignerPolicy, id, signer.signerPolicy);
    if (!upgradeAccountIsActive(appId, session)) return false;
    if (!newPolicy) throw new Error('Server policy migration not confirmed');
    group.writes.push((realm) => {
      const stored = realm.objectForPrimaryKey<Signer>(
        RealmSchema.Signer,
        signer.id || getKeyUID(signer)
      );
      if (!stored) throw new Error('Server policy signer unavailable');
      stored.signerPolicy = newPolicy;
    });
    group.appImage = true;
  }
  return parent ? true : yield call(completeUpgradeGroup, group);
}
