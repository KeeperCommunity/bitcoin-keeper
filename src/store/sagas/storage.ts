import * as bip39 from 'bip39';
import { call, put, select, fork } from 'redux-saga/effects';
import { generateEncryptionKey } from 'src/utils/service-utilities/encryption';
import BIP85 from 'src/services/wallets/operations/BIP85';
import DeviceInfo from 'react-native-device-info';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import { RealmSchema } from 'src/storage/realm/enum';
import { AppSubscriptionLevel, SubscriptionTier } from 'src/models/enums/SubscriptionTier';
import { DerivationPurpose, SignerType, WalletType } from 'src/services/wallets/enums';
import WalletUtilities from 'src/services/wallets/operations/utils';
import crypto from 'crypto';
import dbManager from 'src/storage/realm/dbManager';
import realm from 'src/storage/realm/realm';
import Relay from 'src/services/backend/Relay';
import config from 'src/utils/service-utilities/config';
import { setupRecoveryKeySigningKey } from 'src/hardware/signerSetup';
import { DelayedPolicyUpdate, DelayedTransaction } from 'src/models/interfaces/AssistedKeys';
import SigningServer from 'src/services/backend/SigningServer';
import { Signer } from 'src/services/wallets/interfaces/vault';
import { Wallet } from 'src/services/wallets/interfaces/wallet';
import { uaiType } from 'src/models/interfaces/Uai';
import { createWatcher } from '../utilities';
import {
  FETCH_DELAYED_POLICY_UPDATE,
  FETCH_SIGNED_DELAYED_TRANSACTION,
  SETUP_KEEPER_APP,
} from '../sagaActions/storage';
import { addNewWalletsWorker, NewWalletInfo, addSigningDeviceWorker } from './wallets';
import {
  deleteDelayedPolicyUpdate,
  setAppCreated,
  setAppId,
  updateDelayedTransaction,
} from '../reducers/storage';
import { setAppCreationError } from '../reducers/login';
import { resetRealyWalletState } from '../reducers/bhr';
import { addToUaiStack } from '../sagaActions/uai';
import { RootState, store } from '../store';
import {
  addAccount,
  setBiometricEnabledAppId,
  updateDefaultWalletCreatedByAppId,
} from '../reducers/account';
import { loadConciergeTickets, loadConciergeUser } from '../reducers/concierge';
import LoginMethod from 'src/models/enums/LoginMethod';
import { currentBackupAccountSession } from 'src/services/backup/transport';
import type { BackupWriteIntent } from 'src/services/backup/intent';

export function* setupKeeperAppWorker({ payload, originBackupWriteIntent }: {
  payload: { appName: string; fcmToken: string };
  originBackupWriteIntent?: BackupWriteIntent;
}) {
  let isCurrentSetupScope = () => true;
  try {
    const { bitcoinNetworkType, selectedAppId } = yield select((state: RootState) => ({
      bitcoinNetworkType: state.settings.bitcoinNetworkType,
      selectedAppId: state.storage.appId,
    }));
    const sourceRealm = realm.getDatabase();
    let expectedAppId = selectedAppId;
    const { appName, fcmToken }: { appName: string; fcmToken: string } = payload;
    let primaryMnemonic;
    let primarySeed;
    let appID;
    let publicId;
    let imageEncryptionKey;
    const app: KeeperApp = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);
    let expectedRealmAppId = app?.id;
    isCurrentSetupScope = () => {
      try {
        const state = store.getState();
        const currentApp = dbManager.getObjectByIndex(RealmSchema.KeeperApp) as unknown as KeeperApp;
        return (
          realm.getDatabase() === sourceRealm &&
          state.storage.appId === expectedAppId &&
          state.settings.bitcoinNetworkType === bitcoinNetworkType &&
          currentApp?.id === expectedRealmAppId
        );
      } catch {
        return false;
      }
    };
    const assertCurrentSetupScope = () => {
      if (!isCurrentSetupScope()) throw new Error('Account changed during app setup');
    };
    const dispatchForSetup = (action) => {
      assertCurrentSetupScope();
      store.dispatch(action);
    };
    if (app) {
      primaryMnemonic = app.primaryMnemonic;
      primarySeed = app.primarySeed;
      appID = app.id;
      publicId = app.publicId;
      imageEncryptionKey = app.imageEncryptionKey;
    } else {
      primaryMnemonic = bip39.generateMnemonic();
      primarySeed = bip39.mnemonicToSeedSync(primaryMnemonic);
      appID = crypto.createHash('sha256').update(primarySeed).digest('hex');
      publicId = WalletUtilities.getFingerprintFromSeed(primarySeed);
      const entropy = yield call(
        BIP85.bip39MnemonicToEntropy,
        config.BIP85_IMAGE_ENCRYPTIONKEY_DERIVATION_PATH,
        primaryMnemonic
      );
      imageEncryptionKey = generateEncryptionKey(entropy.toString('hex'));
    }
    assertCurrentSetupScope();
    const response = yield call(Relay.createNewApp, publicId, appID, fcmToken);
    assertCurrentSetupScope();

    if (response && response.created) {
      const newAPP: KeeperApp = {
        id: appID,
        publicId,
        appName,
        primaryMnemonic,
        primarySeed: primarySeed.toString('hex'),
        imageEncryptionKey,
        subscription: {
          productId: SubscriptionTier.L3,
          name: SubscriptionTier.L3,
          level: AppSubscriptionLevel.L3,
          icon: 'assets/ic_diamond_hands.svg',
        },
        backup: {},
        version: DeviceInfo.getVersion(),
        networkType: bitcoinNetworkType,
        enableAnalytics: false,
      };
      const appPersisted = yield call(() => {
        assertCurrentSetupScope();
        return dbManager.createObject(RealmSchema.KeeperApp, newAPP);
      });
      if (!appPersisted) throw new Error('Failed to persist new app');
      expectedRealmAppId = appID;
      // Scoped wallet/key creation requires Redux and the new Realm to name the
      // same account before setup can be marked ready.
      yield call(() => {
        // Check the original selection again at the publication boundary.
        assertCurrentSetupScope();
        expectedAppId = appID;
        store.dispatch(setAppId(appID));
      });
      assertCurrentSetupScope();

      const defaultWallet: NewWalletInfo = {
        walletType: WalletType.DEFAULT,
        walletDetails: {
          name: 'Mobile Wallet',
          description: '',
          instanceNum: 0,
          derivationPath: WalletUtilities.getDerivationPath(
            false,
            bitcoinNetworkType,
            0,
            DerivationPurpose.BIP84
          ),
        },
      };

      const recoveryKeySigner = setupRecoveryKeySigningKey(primaryMnemonic);
      const existingWallets: Wallet[] = yield call(dbManager.getCollection, RealmSchema.Wallet);
      assertCurrentSetupScope();
      // A retry after key setup failed must retain the already-created wallet.
      const isDefaultWallet = (wallet: Wallet) =>
        wallet.type === WalletType.DEFAULT &&
        wallet.networkType === bitcoinNetworkType &&
        wallet.derivationDetails.instanceNum === 0;
      const hasDefaultWallet = existingWallets.some(isDefaultWallet);
      const walletCreated = hasDefaultWallet || (yield call(addNewWalletsWorker, {
        originAppId: appID,
        originBackupAccountSession: currentBackupAccountSession(),
        originBackupWriteIntent,
        payload: [defaultWallet],
      }));
      assertCurrentSetupScope();
      const createdWallets: Wallet[] = yield call(dbManager.getCollection, RealmSchema.Wallet);
      assertCurrentSetupScope();
      if (!walletCreated || !createdWallets.some(isDefaultWallet))
        throw new Error('Failed to create default wallet');
      yield call(addSigningDeviceWorker, {
        originAppId: appID,
        originBackupAccountSession: currentBackupAccountSession(),
        originBackupWriteIntent,
        payload: { signers: [recoveryKeySigner] },
      });
      assertCurrentSetupScope();
      const recoveryKeys: Signer[] = yield call(dbManager.getCollection, RealmSchema.Signer);
      assertCurrentSetupScope();
      if (!recoveryKeys.some((signer) =>
        signer.masterFingerprint === recoveryKeySigner.masterFingerprint &&
        signer.networkType === recoveryKeySigner.networkType
      )) throw new Error('Failed to create Recovery Key');
      yield call(dispatchForSetup, addAccount(appID));
      yield call(dispatchForSetup,
        updateDefaultWalletCreatedByAppId({ appId: appID, networkType: bitcoinNetworkType })
      );
      yield call(dispatchForSetup, setAppCreated(true));
      yield call(dispatchForSetup, resetRealyWalletState());
      yield call(dispatchForSetup, loadConciergeUser(null));
      yield call(dispatchForSetup, loadConciergeTickets([]));
      const { loginMethod } = yield select((state: RootState) => state.settings);
      if (loginMethod === LoginMethod.BIOMETRIC) {
        const { allAccounts } = yield select((state: RootState) => state.account);
        if (allAccounts.length == 1)
          yield call(dispatchForSetup, setBiometricEnabledAppId(appID));
      }
    } else {
      yield call(dispatchForSetup, setAppCreationError(true));
    }
  } catch (error) {
    console.log({ error });
    yield call(() => {
      if (isCurrentSetupScope()) store.dispatch(setAppCreationError(true));
    });
  }
}

export const setupKeeperAppWatcher = createWatcher(setupKeeperAppWorker, SETUP_KEEPER_APP);

function* fetchSignedDelayedTransactionWorker() {
  const delayedTransactions: { [txid: string]: DelayedTransaction } = yield select(
    (state) => state.storage.delayedTransactions
  );

  for (const txid in delayedTransactions) {
    try {
      const { delayUntil, verificationToken, signedPSBT } = delayedTransactions[txid];
      if (!signedPSBT) {
        const now = Date.now();

        const shouldBeSigned = delayUntil - now <= 0; // delayed expired, transaction must be signed by the Server Key
        if (shouldBeSigned) {
          const { delayedTransaction }: { delayedTransaction: DelayedTransaction } = yield call(
            SigningServer.fetchSignedDelayedTransaction,
            txid,
            verificationToken.toString()
          );

          if (delayedTransaction.signedPSBT) {
            yield put(
              addToUaiStack({
                uaiType: uaiType.SIGNING_DELAY,
                entityId: delayedTransaction.txid,
              })
            );
            yield put(updateDelayedTransaction(delayedTransaction));
          }
        }
      }
    } catch (err) {
      console.log({ err });
    }
  }
}

export const fetchSignedDelayedTransactionWatcher = createWatcher(
  fetchSignedDelayedTransactionWorker,
  FETCH_SIGNED_DELAYED_TRANSACTION
);

function* fetchDelayedPolicyUpdateWorker() {
  const signers: Signer[] = yield call(dbManager.getCollection, RealmSchema.Signer);
  let serverKeySigner: Signer;
  for (const signer of signers) {
    if (signer.type === SignerType.POLICY_SERVER) {
      serverKeySigner = signer;
      break;
    }
  }
  if (!serverKeySigner) return;

  const delayedPolicyUpdate: { [policyId: string]: DelayedPolicyUpdate } = yield select(
    (state) => state.storage.delayedPolicyUpdate
  );

  for (const policyId in delayedPolicyUpdate) {
    try {
      const { delayUntil, verificationToken, isApplied } = delayedPolicyUpdate[policyId];
      if (!isApplied) {
        const now = Date.now();

        const shouldBeApplied = delayUntil - now <= 0; // delayed expired, policy must be updated
        if (shouldBeApplied) {
          const { delayedPolicy }: { delayedPolicy: DelayedPolicyUpdate } = yield call(
            SigningServer.fetchDelayedPolicyUpdate,
            policyId,
            verificationToken.toString()
          );

          if (delayedPolicy.isApplied) {
            const updatedSignerPolicy = {
              ...serverKeySigner.signerPolicy,
              ...delayedPolicy.policyUpdates,
            };
            yield call(
              dbManager.updateObjectByPrimaryId,
              RealmSchema.Signer,
              'masterFingerprint',
              serverKeySigner.masterFingerprint,
              {
                signerPolicy: updatedSignerPolicy,
              }
            );

            yield put(
              addToUaiStack({
                uaiType: uaiType.POLICY_DELAY,
                entityId: delayedPolicy.policyId,
              })
            );

            yield put(deleteDelayedPolicyUpdate(delayedPolicy.policyId));
          }
        }
      }
    } catch (err) {
      console.log({ err });
    }
  }
}

export const fetchDelayedPolicyUpdateWatcher = createWatcher(
  fetchDelayedPolicyUpdateWorker,
  FETCH_DELAYED_POLICY_UPDATE
);
