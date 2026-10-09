import { persistReducer, createMigrate, persistStore } from 'redux-persist';
import storage from 'redux-persist/lib/storage';
import { combineReducers } from 'redux';
import { configureStore } from '@reduxjs/toolkit';
import createSagaMiddleware from 'redux-saga';
import { reduxStorage } from 'src/storage';
import loginReducer from './reducers/login';
import notificationsReducer from './reducers/notifications';
import bhrReducer from './reducers/bhr';
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
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import { setBackupUploadGuard } from 'src/services/backup/transport';
import { isAutomaticCloudBackupEnabled } from './reducers/bhr';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';

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
  'AUTO_SYNC_WALLETS',
  'REFRESH_CANARY_VAULT',
  'UPDATE_WALLET_DETAILS',
  'UPDATE_VAULT_DETAILS',
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
]);
const accountOwnedUtxoUiActions = new Set([
  'utxos/setSyncingUTXOs',
  'utxos/setSyncingUTXOError',
  'utxos/resetState',
]);
const bindActionOrigin = (api) => (next) => (action) => {
  const originAppId = api.getState()?.storage?.appId;
  const enablesBackup = action?.type === 'bhr/setAutomaticCloudBackup' &&
    action.payload?.enabled === true;
  const reportsBackupSuccess = action?.type === 'bhr/setBackupAllSuccess' &&
    action.payload?.status === true;
  if (enablesBackup || reportsBackupSuccess) {
    const appId = action.payload.appId;
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
        (dbManager.getObjectByIndex(RealmSchema.KeeperApp) as unknown as KeeperApp)?.id !== originAppId
      ) return action;
    } catch {
      return action;
    }
  }
  if (
    originAppId &&
    action &&
    accountOwnedActions.has(action.type) &&
    !('originAppId' in action)
  )
    return next({ ...action, originAppId });
  return next(action);
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

setBackupUploadGuard((appId, explicitChoice) => {
  const state = store.getState();
  if (
    state.storage.appId !== appId ||
    (!explicitChoice && !isAutomaticCloudBackupEnabled(state.bhr, appId))
  )
    return false;
  try {
    return (dbManager.getObjectByIndex(RealmSchema.KeeperApp) as unknown as KeeperApp)?.id === appId;
  } catch {
    return false;
  }
});

sagaMiddleware.run(rootSaga);
export const persistor = persistStore(store);
