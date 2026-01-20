import { call, delay, put, race, select } from 'redux-saga/effects';
import {
  decrypt,
  encrypt,
  generateEncryptionKey,
  hash512,
} from 'src/utils/service-utilities/encryption';
import DeviceInfo from 'react-native-device-info';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import LoginMethod from 'src/models/enums/LoginMethod';
import { RealmSchema } from 'src/storage/realm/enum';
import { getReleaseTopic } from 'src/utils/releaseTopic';
import messaging from '@react-native-firebase/messaging';
import Relay from 'src/services/backend/Relay';
import semver from 'semver';
import { uaiType } from 'src/models/interfaces/Uai';
import * as SecureStore from 'src/storage/secure-store';

import dbManager from 'src/storage/realm/dbManager';
import SubScription from 'src/models/interfaces/Subscription';
import { AppSubscriptionLevel, SubscriptionTier } from 'src/models/enums/SubscriptionTier';
import { generateAccountIdentifier, manipulateIosProdProductId } from 'src/utils/utilities';
import {
  CHANGE_AUTH_CRED,
  CHANGE_LOGIN_METHOD,
  CREDS_AUTH,
  STORE_CREDS,
} from '../sagaActions/login';
import {
  credsAuthenticated,
  credsChanged,
  pinChangedFailed,
  setCredStored,
  setKey,
  setupLoading,
  setRecepitVerificationError,
  setRecepitVerificationFailed,
  credsAuthenticatedError,
} from '../reducers/login';
import {
  setAppId,
  setAppVersion,
  setAutoUpdateEnabledBeforeDowngrade,
  setPinHash,
  setPlebDueToOffline,
} from '../reducers/storage';

import { RootState, store } from '../store';
import { createWatcher } from '../utilities';
import { fetchExchangeRates } from '../sagaActions/send_and_receive';
import { setLoginMethod } from '../reducers/settings';
import { setSubscription } from 'src/store/sagaActions/settings';
import { backupAllSignersAndVaults } from '../sagaActions/bhr';
import { uaiChecks } from '../sagaActions/uai';
import { applyUpgradeSequence } from './upgrade';
import { resetSyncing } from '../reducers/wallets';
import { connectToNode } from '../sagaActions/network';
import { fetchDelayedPolicyUpdate, fetchSignedDelayedTransaction } from '../sagaActions/storage';
import { setAutomaticCloudBackup, setBackupType } from '../reducers/bhr';
import { autoWalletsSyncWorker } from './wallets';
import {
  addAccount,
  saveDefaultWalletState,
  setBiometricEnabledAppId,
  setTempDetails,
  updateOneTimeBackupStatus,
  updatePasscodeHash,
} from '../reducers/account';
import { REALM_FILE } from 'src/storage/realm/realm';
import { loadConciergeUserOnLogin, saveBackupMethodByAppId } from '../sagaActions/account';
import { createBackup } from 'src/services/backupfile';

export const stringToArrayBuffer = (byteString: string): Uint8Array => {
  if (byteString) {
    const byteArray = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      byteArray[i] = byteString.codePointAt(i);
    }
    return byteArray;
  }
  return null;
};

function* credentialsStorageWorker({ payload }) {
  try {
    yield put(setupLoading('storingCreds'));
    const hash = yield call(hash512, payload.passcode);
    const AES_KEY = yield call(generateEncryptionKey);
    yield put(setKey(AES_KEY));
    const encryptedKey = yield call(encrypt, hash, AES_KEY);
    const { allAccounts } = yield select((state: RootState) => state.account);
    const accountIdentifier = generateAccountIdentifier(allAccounts?.length);

    const pinStored = yield call(SecureStore.store, hash, encryptedKey, accountIdentifier);
    if (typeof pinStored !== 'boolean' || !pinStored) {
      payload.callback?.(pinStored);
      return;
    }

    const realmId = REALM_FILE + accountIdentifier;

    // initialize the database
    const uint8array = yield call(stringToArrayBuffer, AES_KEY);
    yield call(dbManager.initializeRealm, uint8array, realmId);

    // storing account details
    yield put(setTempDetails({ hash, realmId, accountIdentifier }));

    // setup the application
    yield put(setPinHash(hash));
    yield put(setCredStored());
    yield put(setAppVersion(DeviceInfo.getVersion()));

    yield call(dbManager.createObject, RealmSchema.VersionHistory, {
      version: `${DeviceInfo.getVersion()}(${DeviceInfo.getBuildNumber()})`,
      date: new Date().toString(),
      title: 'Initially installed',
    });

    yield put(fetchExchangeRates());
    yield put(
      uaiChecks([
        uaiType.SIGNING_DEVICES_HEALTH_CHECK,
        uaiType.SECURE_VAULT,
        uaiType.RECOVERY_PHRASE_HEALTH_CHECK,
        uaiType.ZENDESK_TICKET,
        uaiType.SERVER_BACKUP_FAILURE,
      ])
    );

    messaging().subscribeToTopic(getReleaseTopic(DeviceInfo.getVersion()));

    yield put(connectToNode());
  } catch (error) {
    console.log(error);
  }
}

export const credentialStorageWatcher = createWatcher(credentialsStorageWorker, STORE_CREDS);

function* credentialsAuthWorker({ payload }) {
  let key;
  const appId = yield select((state: RootState) => state.storage.appId);
  yield put(credsAuthenticatedError(''));
  try {
    yield put(setRecepitVerificationError(false));
    yield put(setRecepitVerificationFailed(false));
    const { method } = payload;
    yield put(setupLoading('authenticating'));
    let hash;
    let encryptedKey;
    if (method === LoginMethod.PIN) {
      hash = yield call(hash512, payload.passcode);
      if (payload.reLogin) encryptedKey = yield call(SecureStore.fetchSpecific, hash, appId);
      else encryptedKey = yield call(SecureStore.fetch, hash);
    } else if (method === LoginMethod.BIOMETRIC) {
      let res;
      if (payload.reLogin)
        res = yield call(SecureStore.verifyBiometricAuth, payload.passcode, appId);
      else res = yield call(SecureStore.verifyBiometricAuth, payload.passcode, payload.appId);
      if (!res.success) throw new Error('Biometric Auth Failed');
      hash = res.hash;
      encryptedKey = res.encryptedKey;
    }
    key = yield call(decrypt, hash, encryptedKey);
    yield put(setKey(key));
    yield put(setPinHash(hash));

    if (!key) throw new Error('Encryption key is missing');
    // case: login
    if (!payload.reLogin) {
      const { allAccounts, biometricEnabledAppId, backupMethodByAppId } = yield select(
        (state: RootState) => state.account
      );
      const currentAccount = allAccounts.find((account) => account.hash === hash);
      const uint8array = yield call(stringToArrayBuffer, key);
      const { success, error } = yield call(
        dbManager.initializeRealm,
        uint8array,
        currentAccount?.realmId
      );

      if (!success) {
        throw Error(`Failed to load the database: ${error}`);
      }

      yield call(createBackup, appId, hash, encryptedKey);
      const previousVersion = yield select((state) => state.storage.appVersion);
      const { plebDueToOffline, wasAutoUpdateEnabledBeforeDowngrade, defaultWalletCreated } =
        yield select((state) => state.storage);

      // setting correct app id from realm at login
      const keeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
      if (keeperApp?.id) yield put(setAppId(keeperApp.id));

      // Store temporary account details
      if (!allAccounts.length) {
        yield put(setTempDetails({ hash, realmId: REALM_FILE, accountIdentifier: '' }));
      }

      const newVersion = DeviceInfo.getVersion();
      const versionCollection = yield call(dbManager.getCollection, RealmSchema.VersionHistory);
      const lastElement = versionCollection[versionCollection.length - 1];
      const lastVersionCode = lastElement.version.split(/[()]/);
      const currentVersionCode = DeviceInfo.getBuildNumber();
      if (semver.lt(previousVersion, newVersion)) {
        yield call(applyUpgradeSequence, { previousVersion, newVersion });
      } else if (currentVersionCode !== lastVersionCode[1]) {
        yield call(dbManager.createObject, RealmSchema.VersionHistory, {
          version: `${newVersion}(${currentVersionCode})`,
          date: new Date().toString(),
          title: `Upgraded from ${lastVersionCode[1]} to ${currentVersionCode}`,
        });
      }
      if (appId) {
        try {
          const { id, publicId, subscription }: KeeperApp = yield call(
            dbManager.getObjectByIndex,
            RealmSchema.KeeperApp
          );
          yield put(connectToNode());
          // const response = yield call(Relay.verifyReceipt, id, publicId);
          yield put(credsAuthenticatedError(''));

          yield put(fetchExchangeRates());
          yield put(fetchSignedDelayedTransaction());
          yield put(fetchDelayedPolicyUpdate());
          yield race({
            sync: call(autoWalletsSyncWorker, {
              payload: {
                syncAll: false,
                hardRefresh: false,
                addNotifications: true,
              },
            }),
            timeout: delay(15000),
          });

          yield put(
            uaiChecks([
              uaiType.SIGNING_DEVICES_HEALTH_CHECK,
              uaiType.SECURE_VAULT,
              uaiType.RECOVERY_PHRASE_HEALTH_CHECK,
              uaiType.ZENDESK_TICKET,
              uaiType.SIGNING_DELAY,
              uaiType.POLICY_DELAY,
            ])
          );

          yield put(resetSyncing());

          const { pendingAllBackup, automaticCloudBackup } = yield select(
            (state: RootState) => state.bhr
          );
          if (pendingAllBackup && automaticCloudBackup) yield put(backupAllSignersAndVaults());
          if (!allAccounts.length) {
            // upgraded app
            yield put(addAccount(appId));
            const { loginMethod: existingLoginMethod, oneTimeBackupStatus } = yield select(
              (state) => state.settings
            );
            if (existingLoginMethod == LoginMethod.BIOMETRIC)
              yield put(setBiometricEnabledAppId(keeperApp?.id));
            yield put(saveBackupMethodByAppId());
            yield put(
              updateOneTimeBackupStatus({
                appId: keeperApp.id,
                status: oneTimeBackupStatus.signingServer,
              })
            );
            yield put(saveDefaultWalletState({ appId, data: defaultWalletCreated }));
          }
          yield put(loadConciergeUserOnLogin({ appId: keeperApp.id }));
          yield put(
            setLoginMethod(
              keeperApp.id === biometricEnabledAppId ? LoginMethod.BIOMETRIC : LoginMethod.PIN
            )
          );
          if (backupMethodByAppId[keeperApp.id])
            yield put(setBackupType(backupMethodByAppId[keeperApp.id]));
        } catch (error) {
          yield put(setRecepitVerificationError(true));
          yield put(credsAuthenticatedError(error));
          console.log(error);
        }
        yield put(credsAuthenticated(true));
      } else yield put(credsAuthenticated(true)); // TODO: Should remove and throw an error if not needed in any scenario
    } else yield put(credsAuthenticated(true));
  } catch (err) {
    yield put(credsAuthenticatedError(err));
    yield put(credsAuthenticated(false));
  }
}

async function downgradeToPleb() {
  const app: KeeperApp = await dbManager.getObjectByIndex(RealmSchema.KeeperApp);
  const updatedSubscription: SubScription = {
    receipt: '',
    productId: SubscriptionTier.L1,
    name: SubscriptionTier.L1,
    level: AppSubscriptionLevel.L1,
    icon: 'assets/ic_pleb.svg',
  };
  dbManager.updateObjectById(RealmSchema.KeeperApp, app.id, {
    subscription: updatedSubscription,
  });
  store.dispatch(setSubscription(updatedSubscription.name));
  store.dispatch(setAutomaticCloudBackup(false));
  await Relay.updateSubscription(app.id, app.publicId, {
    productId: SubscriptionTier.L1.toLowerCase(),
  });
}

async function updateSubscriptionFromRelayData(data, wasAutoUpdateEnabledBeforeDowngrade) {
  const app: KeeperApp = await dbManager.getObjectByIndex(RealmSchema.KeeperApp);
  const isBtcPayment = data?.paymentType == 'btc_payment';
  let updatedSubscription: SubScription;
  if (isBtcPayment) {
    updatedSubscription = {
      receipt: data.transactionReceipt,
      productId: manipulateIosProdProductId(data.productId),
      name: data.plan,
      level: data.level,
      icon: data.icon,
      isDesktopPurchase: true,
    };
  } else {
    if (data.subscription?.paymentType) delete data.subscription?.paymentType;
    updatedSubscription = {
      ...data.subscription,
      isDesktopPurchase: false,
    };
  }
  dbManager.updateObjectById(RealmSchema.KeeperApp, app.id, {
    subscription: updatedSubscription,
  });
  store.dispatch(setSubscription(updatedSubscription.name));
  store.dispatch(setAutomaticCloudBackup(wasAutoUpdateEnabledBeforeDowngrade));
  store.dispatch(setPlebDueToOffline(false));
  store.dispatch(setAutoUpdateEnabledBeforeDowngrade(false));
}

export const credentialsAuthWatcher = createWatcher(credentialsAuthWorker, CREDS_AUTH);

function* changeAuthCredWorker({ payload }) {
  const { oldPasscode, newPasscode } = payload;
  try {
    const hash = yield call(hash512, oldPasscode);
    const encryptedKey = yield call(SecureStore.fetch, hash);
    const decryptedKey = yield call(decrypt, hash, encryptedKey);
    const newHash = yield call(hash512, newPasscode);
    const newEncryptedKey = yield call(encrypt, newHash, decryptedKey);
    // pass current accounts identifier
    const appId = yield select((state: RootState) => state.storage.appId);
    const { allAccounts } = yield select((state: RootState) => state.account);
    const currentAccount = allAccounts.find((account) => account.appId === appId);
    if (
      !(yield call(SecureStore.store, newHash, newEncryptedKey, currentAccount.accountIdentifier))
    ) {
      return;
    }
    yield call(SecureStore.store, newHash, newEncryptedKey, currentAccount.accountIdentifier);
    yield put(updatePasscodeHash({ newHash, appId }));
    yield put(credsChanged('changed'));
  } catch (err) {
    console.log({
      err,
    });
    yield put(pinChangedFailed(true));
    yield put(credsChanged('not-changed'));
  }
}
export const changeAuthCredWatcher = createWatcher(changeAuthCredWorker, CHANGE_AUTH_CRED);

function* changeLoginMethodWorker({
  payload,
}: {
  payload: { method: LoginMethod; pubKey: string };
}) {
  try {
    const { method, pubKey } = payload;
    const keeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
    if (method === LoginMethod.BIOMETRIC) {
      const savePubKey = yield call(SecureStore.storeBiometricPubKey, pubKey, keeperApp?.id);
      if (savePubKey) {
        yield put(setLoginMethod(method));
        if (keeperApp?.id) yield put(setBiometricEnabledAppId(keeperApp?.id));
      }
    } else {
      yield put(setLoginMethod(method));
      yield put(setBiometricEnabledAppId(null));
    }
  } catch (err) {
    console.log('🚀 ~ changeLoginMethodWorker:', err);
  }
}

export const changeLoginMethodWatcher = createWatcher(changeLoginMethodWorker, CHANGE_LOGIN_METHOD);
