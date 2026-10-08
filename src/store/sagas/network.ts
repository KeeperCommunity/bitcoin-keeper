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
import { RootState } from '../store';
import {
  electrumClientConnectionExecuted,
  electrumClientConnectionInitiated,
} from '../reducers/login';
import { createWatcher } from '../utilities';
import { fetchFeeRates } from '../sagaActions/send_and_receive';
import { CONNECT_TO_NODE } from '../sagaActions/network';

export function* connectToNodeWorker() {
  try {
    const { bitcoinNetworkType } = yield select((state: RootState) => state.settings);
    console.log('Connecting to node...');
    yield put(electrumClientConnectionInitiated());

    const areInitialNodesSaved = yield select(
      (state: RootState) => state.network.initialNodesSaved
    );

    if (!areInitialNodesSaved) {
      const currentNodes = yield call(dbManager.getCollection, RealmSchema.NodeConnect);
      const defaultNodes = yield call(dbManager.getCollection, RealmSchema.DefaultNodeConnect);
      let addInitialNode = defaultNodes && defaultNodes.length != 0;
      if (!addInitialNode && currentNodes.length == 0) {
        addInitialNode = true;
      }

      if (addInitialNode) {
        const hardcodedInitialNodes =
          bitcoinNetworkType === NetworkType.TESTNET
            ? predefinedTestnetNodes
            : predefinedMainnetNodes;
        const created = yield call(
          dbManager.createObjectBulk,
          RealmSchema.NodeConnect,
          hardcodedInitialNodes
        );
        if (!created) throw new Error('Unable to save initial Electrum servers');
      }

      yield put(setInitialNodesSaved(true));
    }

    // Existing Testnet installations only saved the first public server. Add the
    // second once when that original server is still saved; an explicit deletion
    // after this migration must not be undone at every reconnect.
    const fallbackNodeAdded = yield select(
      (state: RootState) => state.network.testnetFallbackNodeAdded
    );
    if (bitcoinNetworkType === NetworkType.TESTNET && !fallbackNodeAdded) {
      const savedNodes = yield call(dbManager.getCollection, RealmSchema.NodeConnect);
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
        const created = yield call(dbManager.createObject, RealmSchema.NodeConnect, fallbackNode);
        if (!created) throw new Error('Unable to save Testnet fallback server');
      }
      yield put(setTestnetFallbackNodeAdded());
    }

    const nodes = (yield call(dbManager.getCollection, RealmSchema.NodeConnect)).filter(
      (node) => node.networkType === bitcoinNetworkType
    );
    const selectedNode = nodes.find((node) => node.isConnected);

    ElectrumClient.setActivePeer(nodes);
    const { connected, connectedTo, error } = yield call(ElectrumClient.connect);
    if (connected) {
      const connectedNode = ElectrumClient.getActivePeer();
      if (selectedNode && connectedNode?.id !== selectedNode.id) {
        yield call(
          dbManager.updateObjectById,
          RealmSchema.NodeConnect,
          selectedNode.id.toString(),
          {
            isConnected: false,
          }
        );
        yield call(
          dbManager.updateObjectById,
          RealmSchema.NodeConnect,
          connectedNode.id.toString(),
          {
            isConnected: true,
          }
        );
      }
      yield put(electrumClientConnectionExecuted({ successful: connected, connectedTo }));
    } else {
      yield put(electrumClientConnectionExecuted({ successful: connected, error }));
    }
    yield put(fetchFeeRates());
  } catch (err) {
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
