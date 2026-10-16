import { persistReducer, createMigrate, persistStore } from 'redux-persist';
import storage from 'redux-persist/lib/storage';
import { combineReducers } from 'redux';
import { configureStore } from '@reduxjs/toolkit';
import createSagaMiddleware from 'redux-saga';
import { reduxStorage } from 'src/storage';
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import {
  captureBackupWriteIntent,
  canAccessBackupAccount,
  backupConsentEpoch,
  observeBackupConsentAction,
  protectBackupConsentCompletion,
  takeBackupRecoveryConsentDisable,
  currentBackupAccountSession,
  markBackupMutation,
  observeBackupAccount,
  setBackupReconciliationHandler,
  setBackupUploadGuard,
} from 'src/services/backup/transport';
import {
  isBackupVerificationCurrent,
  noteCommittedBackupRecovery,
  setAutomaticBackupVerificationCommit,
} from 'src/services/backup/automatic';
import { setProtectedBackupStateObserver, setProtectedBackupStateProvider } from 'src/services/backup/protected';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import loginReducer from './reducers/login';
import notificationsReducer from './reducers/notifications';
import bhrReducer, {
  invalidateBackupRepair,
  isAutomaticCloudBackupEnabled,
  setPendingAllBackup,
  commitBackupInspection,
  setAutomaticCloudBackup,
  invalidateRehydratedBackupState,
  setProtectedBackupState,
} from './reducers/bhr';
import rootSaga from './sagas';
import sendAndReceiveReducer from './reducers/send_and_receive';
import settingsReducer from './reducers/settings';
import storageReducer from './reducers/storage';
import vaultReducer from './reducers/vaults';
import walletReducer from './reducers/wallets';
import networkReducer from './reducers/network';
import uaiReducer from './reducers/uai';
import utxoReducer from './reducers/utxos';
import conciergeReducer from './reducers/concierge';
import cachedTxnReducer from './reducers/cachedTxn';
import signerReducer from './reducers/signer';
import accountReducer from './reducers/account';
import swapReducer from './reducers/swap';
import helpAiReducer from './reducers/helpAi';

import { RESET_REDUX_STORE } from './sagaActions/upgrade';
import reduxPersistMigrations from './migrations';

const appReducer = combineReducers({
  settings: settingsReducer,
  login: loginReducer,
  storage: storageReducer,
  wallet: walletReducer,
  sendAndReceive: sendAndReceiveReducer,
  notifications: notificationsReducer,
  bhr: bhrReducer,
  vault: vaultReducer,
  network: networkReducer,
  uai: uaiReducer,
  utxos: utxoReducer,
  concierge: conciergeReducer,
  cachedTxn: cachedTxnReducer,
  signer: signerReducer,
  account: accountReducer,
  swap: swapReducer,
  helpAi: helpAiReducer,
});

const rootReducer = (state, action) => {
  if (action.type === RESET_REDUX_STORE) {
    storage.removeItem('persist:root');
    return appReducer(undefined, action);
  }

  return appReducer(state, action);
};

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

const persistConfig = {
  key: 'root',
  storage: reduxStorage,
  blacklist: ['login', 'bhr', 'sendAndReceive', 'utxos', 'concierge', 'settings'],
  version: 4, // redux persist migration version(initiate to the latest migration version once the migration state is written)
  migrate: createMigrate(reduxPersistMigrations, {
    debug: false,
  }),
};

const persistedReducer = persistReducer(persistConfig, rootReducer);
const sagaMiddleware = createSagaMiddleware();
// Keep the account present at dispatch time even if a saga runs after a switch.
const accountOwnedActions = new Set([
  'UPDATE_APP_IMAGE',
  'UPDATE_VAULT_IMAGE',
  'DELETE_APP_IMAGE_ENTITY',
  'ADD_NEW_WALLETS',
  'ADD_NEW_VAULT',
  'ADD_SIGINING_DEVICE',
  'DELETE_SIGINING_DEVICE',
  'ARCHIVE_SIGINING_DEVICE',
  'MIGRATE_VAULT',
  'DELETE_VAULT',
  'REINSTATE_VAULT',
  'REFILL_MOBILEKEY',
  'MERGER_SIMILAR_KEYS',
  'REFRESH_WALLETS',
  'TEST_SATS_RECIEVE',
  'AUTO_SYNC_WALLETS',
  'CONNECT_TO_NODE',
  'REFRESH_CANARY_VAULT',
  'UPDATE_WALLET_DETAILS',
  'UPDATE_VAULT_DETAILS',
  'UPDATE_RECOVERY_VISIBILITY',
  'UPDATE_SIGNER_DETAILS',
  'UPDATE_KEY_DETAILS',
  'UPDATED_VAULT_SIGNERS_XPRIV',
  'ADD_LABELS',
  'BULK_UPDATE_LABELS',
  'IMPORT_LABELS',
  'MARK_UTXO_SPENDABILITY',
  'SEND_PHASE_TWO',
  'SEND_PHASE_THREE',
  'DISCARD_BROADCASTED_TNX',
  'GENERATE_NEW_ADDRESS',
  'UPDATE_SIGNER_POLICY',
  'CHECK_BACKUP_FRESHNESS',
  'REPAIR_BACKUP',
  'VALIDATE_SERVER_BACKUP',
  'UPDATE_VERSION_HISTORY',
  'MIGRATE_LABELS_329',
  'CHANGE_BITCOIN_NETWORK',
  'SETUP_KEEPER_APP',
]);
const accountOwnedUtxoUiActions = new Set([
  'utxos/setSyncingUTXOs',
  'utxos/setSyncingUTXOError',
  'utxos/resetState',
]);
const bindActionOrigin = (api) => {
  let canonicalBhrHydration: 'unresolved' | 'present' | 'absent' | 'failed' = 'unresolved';
  let deferredLegacyBhr: Parameters<typeof invalidateRehydratedBackupState>[0];
  return (next) => (action) => {
    if (action?.type === 'persist/REHYDRATE') {
      if (action.key === 'bhr') {
        const present =
          !!action.payload && typeof action.payload === 'object' && !Array.isArray(action.payload);
        canonicalBhrHydration =
          action.err || (!present && action.payload != null)
            ? 'failed'
            : present
            ? 'present'
            : 'absent';
        const restored =
          canonicalBhrHydration === 'present'
            ? action.payload
            : canonicalBhrHydration === 'absent'
            ? deferredLegacyBhr
            : undefined;
        deferredLegacyBhr = undefined;
        action = { ...action, payload: invalidateRehydratedBackupState(restored) };
      } else if (action.key === 'root' && action.payload?.bhr) {
        // Older root snapshots can still contain bhr despite its current blacklist.
        const payload = { ...action.payload };
        delete payload.bhr;
        if (!action.err && canonicalBhrHydration === 'unresolved') {
          deferredLegacyBhr = action.payload.bhr;
        } else if (!action.err && canonicalBhrHydration === 'absent') {
          const currentBhr = api.getState()?.bhr;
          payload.bhr = {
            ...currentBhr,
            ...invalidateRehydratedBackupState(action.payload.bhr),
            _persist: currentBhr?._persist,
          };
        }
        action = { ...action, payload };
      }
    }
    if (
      action?.type === 'bhr/commitBackupInspection' &&
      action.payload?.phase === 'verified' &&
      !isBackupVerificationCurrent(action.payload.appId)
    )
      action = { ...action, payload: { ...action.payload, phase: 'unverified', pending: true } };
    const originAppId = api.getState()?.storage?.appId;
    if (
      ['bhr/setAutomaticCloudBackup', 'DELETE_BACKUP', 'BACKUP_ALL_SIGNERS_AND_VAULTS'].includes(
        action?.type
      )
    ) {
      const choiceAppId = action.payload?.appId || action.appId || action.originAppId || originAppId;
      const disablesConsent =
        action.type === 'bhr/setAutomaticCloudBackup' && action.payload?.enabled === false;
      const recoveryDisable = disablesConsent && takeBackupRecoveryConsentDisable(action, choiceAppId);
      if (
        !choiceAppId ||
        (choiceAppId !== originAppId && !recoveryDisable) ||
        (!disablesConsent && !canAccessBackupAccount(choiceAppId, true)) ||
        !observeBackupConsentAction(action, choiceAppId)
      )
        return action;
    }
    const enablesBackup =
      action?.type === 'bhr/setAutomaticCloudBackup' && action.payload?.enabled === true;
    const reportsBackupSuccess =
      action?.type === 'bhr/setBackupAllSuccess' && action.payload?.status === true;
    if (enablesBackup || reportsBackupSuccess) {
      const { appId } = action.payload;
      if (!appId || originAppId !== appId) return action;
      try {
        if ((dbManager.getObjectByIndex(RealmSchema.KeeperApp) as unknown as KeeperApp)?.id !== appId)
          return action;
      } catch {
        return action;
      }
    }
    if (action?.originAppId && accountOwnedUtxoUiActions.has(action.type)) {
      try {
        if (
          action.originAppId !== originAppId ||
          (dbManager.getObjectByIndex(RealmSchema.KeeperApp) as unknown as KeeperApp)?.id !==
            originAppId
        )
          return action;
      } catch {
        return action;
      }
    }
    if (originAppId && action && accountOwnedActions.has(action.type) && !('originAppId' in action))
      action = { ...action, originAppId };
    if (
      action &&
      (accountOwnedActions.has(action.type) ||
        action.type === 'DELETE_BACKUP' ||
        action.type === 'BACKUP_ALL_SIGNERS_AND_VAULTS') &&
      !('originBackupAccountSession' in action)
    )
      action = { ...action, originBackupAccountSession: currentBackupAccountSession() };
    // Stamp the verified remote base at dispatch, before any saga can wait or
    // mutate Realm. A caller that captured an earlier intent must never be
    // silently rebased to the account's current remote state here.
    if (
      action &&
      (accountOwnedActions.has(action.type) ||
        action.type === 'DELETE_BACKUP' ||
        action.type === 'BACKUP_ALL_SIGNERS_AND_VAULTS') &&
      !('originBackupWriteIntent' in action)
    ) {
      const appId = action.originAppId || action.appId || originAppId;
      action = {
        ...action,
        originBackupWriteIntent: appId ? captureBackupWriteIntent(appId) : undefined,
      };
    }
    return next(action);
  };
};
const middlewars = [bindActionOrigin, sagaMiddleware];

if (__DEV__) {
  // const createDebugger = require('redux-flipper').default;
  // middlewars.push(createDebugger());
}

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }).concat(middlewars),
});

observeBackupAccount(store.getState().storage.appId);
store.subscribe(() => observeBackupAccount(store.getState().storage.appId));
setProtectedBackupStateProvider(appId => store.getState().bhr.protectedBackupStateByAppId?.[appId]);
setProtectedBackupStateObserver((appId, session, state) => {
  if (store.getState().storage.appId !== appId || session !== currentBackupAccountSession()) return;
  try {
    if ((dbManager.getObjectByIndex(RealmSchema.KeeperApp) as unknown as KeeperApp)?.id !== appId) return;
    store.dispatch(setProtectedBackupState({appId, state}));
  } catch { /* A closed or switched Realm cannot project remote status. */ }
});


setBackupUploadGuard((appId, explicitChoice) => {
  const state = store.getState();
  if (
    state.storage.appId !== appId ||
    (!explicitChoice && !isAutomaticCloudBackupEnabled(state.bhr, appId))
  )
    return false;
  try {
    return (
      (dbManager.getObjectByIndex(RealmSchema.KeeperApp) as unknown as KeeperApp)?.id === appId
    );
  } catch {
    return false;
  }
});

setBackupReconciliationHandler((appId) => {
  // A stale or unacknowledged encrypted write cannot be resent safely. Require
  // a new comparison with the server snapshot before any repair is offered.
  store.dispatch(invalidateBackupRepair(appId));
  store.dispatch(setPendingAllBackup({ appId, pending: true }));
  // The caller may still need to commit its local Realm change after this
  // rejection. Starting an inspection here could match the old local image
  // and clear pending before that commit. Keep pending until the caller has
  // settled and a later inspection captures the resulting local state.
});

dbManager.setRecoveryCommitObserver(noteCommittedBackupRecovery);
setAutomaticBackupVerificationCommit((appId, deleted, consentEpoch) => {
  if (
    store.getState().storage.appId !== appId ||
    !isBackupVerificationCurrent(appId) ||
    !canAccessBackupAccount(appId, deleted) ||
    backupConsentEpoch(appId) !== consentEpoch
  )
    return false;
  store.dispatch(
    commitBackupInspection({ appId, phase: deleted ? 'unverified' : 'verified', pending: false })
  );
  // Middleware also checks the proof immediately before reducers accept it.
  if (
    !isBackupVerificationCurrent(appId) ||
    !canAccessBackupAccount(appId, deleted) ||
    backupConsentEpoch(appId) !== consentEpoch ||
    (!deleted && !store.getState().bhr.backupRepairCompletedByAppId?.[appId])
  )
    return false;
  if (deleted)
    store.dispatch(
      protectBackupConsentCompletion(
        setAutomaticCloudBackup({ appId, enabled: false }),
        appId,
        consentEpoch
      )
    );
  return (
    isBackupVerificationCurrent(appId) &&
    canAccessBackupAccount(appId, deleted) &&
    backupConsentEpoch(appId) === consentEpoch
  );
});

dbManager.setRecoveryMutationObserver(() => {
  let appId: string | undefined;
  try {
    appId = (dbManager.getObjectByIndex(RealmSchema.KeeperApp) as unknown as KeeperApp)?.id;
  } catch {
    return;
  }
  if (!appId) return;
  // Realm can change while an inspection is between its final local capture
  // and completion. Invalidate the revision before any recovery write commits.
  markBackupMutation(appId);
  store.dispatch(invalidateBackupRepair(appId));
  store.dispatch(setPendingAllBackup({ appId, pending: true }));
});

sagaMiddleware.run(rootSaga);
export const persistor = persistStore(store);
