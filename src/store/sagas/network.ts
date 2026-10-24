import { call, spawn, put, select } from 'redux-saga/effects';
import dbManager from 'src/storage/realm/dbManager';
import realmDatabase from 'src/storage/realm/realm';
import { RealmSchema } from 'src/storage/realm/enum';
import { NetworkType } from 'src/services/wallets/enums';
import type { NodeDetail } from 'src/services/wallets/interfaces';
import type { BackupWriteIntent } from 'src/services/backup/intent';
import {
  beginBackupLocalOperation,
  commitBackupLocalOperation,
} from 'src/services/backup/automatic';
import {
  captureBackupWriteIntent,
  currentBackupAccountSession,
} from 'src/services/backup/transport';
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
import { updateAppImageWorker } from './bhr';

let latestConnectWorker = 0;

export function* connectToNodeWorker(
  action: {
    originAppId?: string;
    originBackupAccountSession?: number;
    originBackupWriteIntent?: BackupWriteIntent;
  } = {}
) {
  let workerId = latestConnectWorker;
  let appId: string;
  let bitcoinNetworkType: NetworkType;
  let requestSession: number;
  let sourceRealm: ReturnType<typeof realmDatabase.getDatabase>;
  let responseGeneration: number;
  const contextIsCurrent = () => {
    const current = store.getState();
    let realmAppId: string;
    try {
      const keeper = dbManager.getObjectByIndex(RealmSchema.KeeperApp) as unknown as {
        id?: string;
      };
      realmAppId = keeper?.id;
      if (realmDatabase.getDatabase() !== sourceRealm) return false;
    } catch {
      return false;
    }
    return (
      workerId === latestConnectWorker &&
      !!appId &&
      realmAppId === appId &&
      current.storage.appId === appId &&
      current.settings.bitcoinNetworkType === bitcoinNetworkType &&
      currentBackupAccountSession() === requestSession
    );
  };
  try {
    // Capture before yielding: a delayed caller must retain its original
    // session, native Realm and backup authority across A -> B -> A.
    const entryState = store.getState();
    bitcoinNetworkType = entryState.settings.bitcoinNetworkType;
    appId = action.originAppId || entryState.storage.appId;
    requestSession = action.originBackupAccountSession ?? currentBackupAccountSession();
    sourceRealm = realmDatabase.getDatabase();
    const originBackupWriteIntent = Object.prototype.hasOwnProperty.call(
      action,
      'originBackupWriteIntent'
    )
      ? action.originBackupWriteIntent
      : captureBackupWriteIntent(appId);
    if (!contextIsCurrent()) return;
    workerId = ++latestConnectWorker;
    console.log('Connecting to node...');
    yield put(electrumClientConnectionInitiated());

    const areInitialNodesSaved = yield select(
      (state: RootState) => state.network.initialNodesSaved
    );

    const fallbackNodeAdded = yield select(
      (state: RootState) => state.network.testnetFallbackNodeAddedByAppId?.[appId]
    );
    if (!contextIsCurrent()) return;
    const currentNodes: NodeDetail[] = yield call(dbManager.getCollection, RealmSchema.NodeConnect);
    if (!contextIsCurrent()) return;
    const additions: NodeDetail[] = [];
    if (!areInitialNodesSaved) {
      const defaultNodes = yield call(dbManager.getCollection, RealmSchema.DefaultNodeConnect);
      if (!contextIsCurrent()) return;
      if (defaultNodes.length || currentNodes.length === 0) {
        const defaults =
          bitcoinNetworkType === NetworkType.TESTNET
            ? predefinedTestnetNodes
            : predefinedMainnetNodes;
        additions.push(
          ...defaults.filter(
            (node) =>
              !currentNodes.some((saved) => saved.id === node.id) &&
              !(
                bitcoinNetworkType === NetworkType.TESTNET &&
                fallbackNodeAdded &&
                node.id === predefinedTestnetNodes[1].id
              )
          )
        );
      }
    }

    // Plan initial and fallback additions together. NodeConnect has no primary
    // key: append only absent IDs and preserve existing/custom node records.
    // An already-completed fallback migration must not undo a later deletion.
    if (bitcoinNetworkType === NetworkType.TESTNET && appId && !fallbackNodeAdded) {
      const savedNodes = [...currentNodes, ...additions];
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
        additions.push(fallbackNode);
      }
    }

    if (additions.length) {
      if (!contextIsCurrent()) return;
      const operation = beginBackupLocalOperation(appId, originBackupWriteIntent, requestSession);
      const committedOperation = commitBackupLocalOperation(operation, (localRealm) => {
        if (!contextIsCurrent()) throw new Error('Electrum bootstrap account changed');
        for (const node of additions) localRealm.create(RealmSchema.NodeConnect, node);
      });
      if (!committedOperation.committed) throw new Error('Unable to save Electrum servers');
      if (!contextIsCurrent()) return;
      // This committed recovery task owns the exact receipt and entire saved
      // node set. Its helper contains backup failures. Detaching it keeps a
      // Relay wait from delaying Electrum, refresh, faucet or send callers;
      // session/consent/generation guards still govern its actual upload.
      yield spawn(updateAppImageWorker, {
        payload: { updateNodes: true },
        originAppId: appId,
        originBackupAccountSession: requestSession,
        committedOperation,
      });
    }
    if (!areInitialNodesSaved) {
      if (!contextIsCurrent()) return;
      yield put(setInitialNodesSaved(true));
    }
    if (bitcoinNetworkType === NetworkType.TESTNET && appId && !fallbackNodeAdded) {
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
    const connectionIsCurrent = () =>
      contextIsCurrent() && generation === ElectrumClient.getConnectionGeneration();
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
