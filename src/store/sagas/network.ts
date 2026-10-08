import { call, put, select } from 'redux-saga/effects';
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import { NetworkType } from 'src/services/wallets/enums';
import {
  predefinedMainnetNodes,
  predefinedTestnetNodes,
} from 'src/services/electrum/predefinedNodes';
import ElectrumClient from 'src/services/electrum/client';
import { captureError } from 'src/services/sentry';
import { setInitialNodesSaved, setTestnetFallbackNodeAdded } from '../reducers/network';
import { RootState, store } from '../store';
import {
  electrumClientConnectionExecuted,
  electrumClientConnectionInitiated,
} from '../reducers/login';
import { createWatcher } from '../utilities';
import { fetchFeeRates } from '../sagaActions/send_and_receive';
import { CONNECT_TO_NODE } from '../sagaActions/network';

let latestConnectWorker = 0;

export function* connectToNodeWorker() {
  const workerId = ++latestConnectWorker;
  let appId: string;
  let bitcoinNetworkType: NetworkType;
  let responseGeneration: number;
  const contextIsCurrent = () => {
    const current = store.getState();
    let realmAppId: string;
    try {
      const keeper = dbManager.getObjectByIndex(RealmSchema.KeeperApp) as unknown as {
        id?: string;
      };
      realmAppId = keeper?.id;
    } catch (_) {
      return false;
    }
    return (
      workerId === latestConnectWorker &&
      !!appId &&
      realmAppId === appId &&
      current.storage.appId === appId &&
      current.settings.bitcoinNetworkType === bitcoinNetworkType
    );
  };
  try {
    bitcoinNetworkType = yield select((state: RootState) => state.settings.bitcoinNetworkType);
    appId = yield select((state: RootState) => state.storage.appId);
    if (!contextIsCurrent()) return;
    console.log('Connecting to node...');
    yield put(electrumClientConnectionInitiated());

    const areInitialNodesSaved = yield select(
      (state: RootState) => state.network.initialNodesSaved
    );

    if (!areInitialNodesSaved) {
      if (!contextIsCurrent()) return;
      const currentNodes = yield call(dbManager.getCollection, RealmSchema.NodeConnect);
      if (!contextIsCurrent()) return;
      const defaultNodes = yield call(dbManager.getCollection, RealmSchema.DefaultNodeConnect);
      if (!contextIsCurrent()) return;
      let addInitialNode = defaultNodes && defaultNodes.length != 0;
      if (!addInitialNode && currentNodes.length == 0) {
        addInitialNode = true;
      }

      if (addInitialNode) {
        const hardcodedInitialNodes =
          bitcoinNetworkType === NetworkType.TESTNET
            ? predefinedTestnetNodes
            : predefinedMainnetNodes;
        if (!contextIsCurrent()) return;
        const created = yield call(
          dbManager.createObjectBulk,
          RealmSchema.NodeConnect,
          hardcodedInitialNodes
        );
        if (!contextIsCurrent()) return;
        if (!created) throw new Error('Unable to save initial Electrum servers');
      }

      if (!contextIsCurrent()) return;
      yield put(setInitialNodesSaved(true));
    }

    // Existing Testnet installations only saved the first public server. Add the
    // second once when that original server is still saved; an explicit deletion
    // after this migration must not be undone at every reconnect.
    const fallbackNodeAdded = yield select(
      (state: RootState) => state.network.testnetFallbackNodeAddedByAppId?.[appId]
    );
    if (bitcoinNetworkType === NetworkType.TESTNET && appId && !fallbackNodeAdded) {
      if (!contextIsCurrent()) return;
      const savedNodes = yield call(dbManager.getCollection, RealmSchema.NodeConnect);
      if (!contextIsCurrent()) return;
      const originalNode = predefinedTestnetNodes[0];
      const fallbackNode = predefinedTestnetNodes[1];
      if (
        savedNodes.some(
          (node) =>
            node.id === originalNode.id &&
            node.host === originalNode.host &&
            node.port === originalNode.port
        ) &&
        !savedNodes.some((node) => node.id === fallbackNode.id)
      ) {
        if (!contextIsCurrent()) return;
        const created = yield call(dbManager.createObject, RealmSchema.NodeConnect, fallbackNode);
        if (!contextIsCurrent()) return;
        if (!created) throw new Error('Unable to save Testnet fallback server');
      }
      if (!contextIsCurrent()) return;
      yield put(setTestnetFallbackNodeAdded(appId));
    }

    if (!contextIsCurrent()) return;
    const nodes = (yield call(dbManager.getCollection, RealmSchema.NodeConnect)).filter(
      (node) => node.networkType === bitcoinNetworkType
    );
    if (!contextIsCurrent()) return;
    const selectedNode = nodes.find((node) => node.isConnected);

    ElectrumClient.setActivePeer(nodes);
    const { connected, connectedTo, error, generation } = yield call(ElectrumClient.connect);
    responseGeneration = generation;
    const connectionIsCurrent = () => {
      return contextIsCurrent() && generation === ElectrumClient.getConnectionGeneration();
    };
    // Another login/network request may replace this connection while the worker
    // is waiting. Its result must not overwrite the newer connection's status.
    if (!connectionIsCurrent()) return;
    if (connected) {
      const connectedNode = ElectrumClient.getActivePeer();
      if (selectedNode && connectedNode?.id !== selectedNode.id) {
        if (!connectionIsCurrent()) return;
        yield call(
          dbManager.updateObjectById,
          RealmSchema.NodeConnect,
          selectedNode.id.toString(),
          {
            isConnected: false,
          }
        );
        if (!connectionIsCurrent()) return;
        yield call(
          dbManager.updateObjectById,
          RealmSchema.NodeConnect,
          connectedNode.id.toString(),
          {
            isConnected: true,
          }
        );
      }
      if (!connectionIsCurrent()) return;
      yield put(electrumClientConnectionExecuted({ successful: connected, connectedTo }));
    } else {
      if (!connectionIsCurrent()) return;
      yield put(electrumClientConnectionExecuted({ successful: connected, error }));
    }
    if (!connectionIsCurrent()) return;
    yield put(fetchFeeRates());
  } catch (err) {
    if (
      !contextIsCurrent() ||
      (responseGeneration !== undefined &&
        responseGeneration !== ElectrumClient.getConnectionGeneration())
    )
      return;
    captureError(err);
    yield put(
      electrumClientConnectionExecuted({
        successful: false,
        error: err?.message || 'Unable to connect to Electrum server',
      })
    );
  }
}

export const connectToNodeWatcher = createWatcher(connectToNodeWorker, CONNECT_TO_NODE);
