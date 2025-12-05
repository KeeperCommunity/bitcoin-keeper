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
import advisorReducer from './reducers/advisor';

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
  advisor: advisorReducer,
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
  blacklist: ['login', 'bhr', 'sendAndReceive', 'utxos', 'concierge'],
  version: 3, // redux persist migration version(initiate to the latest migration version once the migration state is written)
  migrate: createMigrate(reduxPersistMigrations, {
    debug: false,
  }),
};

const persistedReducer = persistReducer(persistConfig, rootReducer);
const sagaMiddleware = createSagaMiddleware();
const middlewars = [sagaMiddleware];

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

sagaMiddleware.run(rootSaga);
export const persistor = persistStore(store);
