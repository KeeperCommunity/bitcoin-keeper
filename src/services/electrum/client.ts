import ElectrumCli from 'electrum-client';
import reverse from 'buffer-reverse';
import * as bitcoinJS from 'bitcoinjs-lib';
import { NodeDetail } from 'src/services/wallets/interfaces';
import { NetworkType } from 'src/services/wallets/enums';
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import { electrumClientConnectionExecuted } from 'src/store/reducers/login';
import { ElectrumTransaction, ElectrumUTXO } from './interface';
import torrific from './torrific';
import RestClient, { TorStatus } from '../rest/RestClient';
import ecc from '../wallets/operations/taproot-utils/noble_ecc';
import { store } from 'src/store/store';
import { getFailoverPeers } from './peerSelection';
import {
  classifyElectrumConnectionError,
  ElectrumConnectionErrorType,
} from './errorClassification';

bitcoinJS.initEccLib(ecc);

const ELECTRUM_CLIENT_CONFIG: {
  maxConnectionAttempt: number;
  reconnectDelay: number;
} = {
  maxConnectionAttempt: 2,
  reconnectDelay: 500, // retry after half a second
};

type ElectrumClientState = {
  electrumClient: any;
  isClientConnected: boolean;
  currentPeerIndex: number;
  connectionAttempt: number;
  activePeer: NodeDetail | null;
  peers: NodeDetail[];
  appId: string | null;
  runtimeReconnectOrigin: NodeDetail | null;
};

const createElectrumClientState = (): ElectrumClientState => ({
  electrumClient: null,
  isClientConnected: false,
  currentPeerIndex: -1,
  connectionAttempt: 0,
  activePeer: null,
  peers: [],
  appId: null,
  runtimeReconnectOrigin: null,
});

let connectionGeneration = 0;

export const ELECTRUM_CONNECTION_CHANGED_ERR = 'Electrum connection changed during request';

const staleConnectionResult = () => ({
  connected: false,
  error: ELECTRUM_CONNECTION_CHANGED_ERR,
  errorType: 'network' as ElectrumConnectionErrorType,
});

const selectionMatches = (state: ElectrumClientState): boolean => {
  const current = store.getState();
  const selectedNetwork = current.settings?.bitcoinNetworkType;
  return (
    state.appId === (current.storage?.appId ?? null) &&
    (!selectedNetwork || !state.activePeer || state.activePeer.networkType === selectedNetwork)
  );
};

const stateIsCurrent = (state: ElectrumClientState, generation: number): boolean =>
  ELECTRUM_CLIENT === state && connectionGeneration === generation && selectionMatches(state);

const networkTypeFor = (network: bitcoinJS.Network): NetworkType | null => {
  if (network?.bech32 === bitcoinJS.networks.bitcoin.bech32) return NetworkType.MAINNET;
  if (network?.bech32 === bitcoinJS.networks.testnet.bech32) return NetworkType.TESTNET;
  return null;
};

let lastConnectionError: {
  type: ElectrumConnectionErrorType;
  message: string;
} | null = null;

// eslint-disable-next-line import/no-mutable-exports
export let ELECTRUM_CLIENT: ElectrumClientState = createElectrumClientState();

export const ELECTRUM_NOT_CONNECTED_ERR =
  'Network Error: The current electrum node is not reachable, please try again with a different node';

export const ELECTRUM_NOT_CONNECTED_ERR_TOR =
  'Network Error: Connection currently failing over Tor, please disable Tor or try again using a different node';

export default class ElectrumClient {
  public static connectOverTor = false;

  public static async connect(expectedGeneration = connectionGeneration) {
    if (expectedGeneration !== connectionGeneration) return staleConnectionResult();
    const state = ELECTRUM_CLIENT;
    const peer = state.activePeer;
    if (!selectionMatches(state)) return staleConnectionResult();

    if (!peer) {
      return {
        connected: false,
        error: 'Unable to connect to any electrum server. Please switch network and try again!',
        generation: connectionGeneration,
      };
    }

    const generation = ++connectionGeneration;
    let timeoutId = null;
    let client: ElectrumCli | null = null;

    try {
      state.isClientConnected = false;
      if (state.electrumClient?.close) state.electrumClient.close();

      ElectrumClient.connectOverTor =
        peer.host?.endsWith('.onion') && RestClient?.getTorStatus() === TorStatus.CONNECTED;

      client = new ElectrumCli(
        ElectrumClient.connectOverTor ? torrific : global.net,
        global.tls,
        peer.port,
        peer.host,
        peer.useSSL ? 'tls' : 'tcp'
      ); // tcp or tls
      state.electrumClient = client;

      client.onError = (error) => {
        if (
          stateIsCurrent(state, generation) &&
          state.electrumClient === client &&
          state.isClientConnected
        ) {
          console.log('Electrum mainClient.onError():', error?.message || error);

          state.runtimeReconnectOrigin = state.runtimeReconnectOrigin || peer;
          state.isClientConnected = false;
          peer.isConnected = false;
          if (client?.close) client.close();
          console.log('Error: Close the connection');
          return ElectrumClient.reconnect(generation);
        }
      };

      console.log('Initiate electrum server...');

      const ver = await Promise.race([
        new Promise((resolve) => {
          timeoutId = setTimeout(() => resolve('timeout'), 20000);
        }),
        client.initElectrum({
          client: 'btc-k',
          version: '1.4',
        }), // should resolve within 4 seconds(prior to timeout)
      ]);
      if (!stateIsCurrent(state, generation) || state.electrumClient !== client) {
        if (client?.close) client.close();
        return staleConnectionResult();
      }
      if (ver === 'timeout') throw new Error('Connection time-out');

      if (ver && ver[0]) {
        console.log('Connection to electrum server is established', {
          ver,
          node: peer.host,
        });

        lastConnectionError = null;
        state.isClientConnected = true;
        peer.isConnected = true;
        state.connectionAttempt = 0;
        if (state.runtimeReconnectOrigin) {
          ElectrumClient.recordRuntimeRotation(
            state,
            state.runtimeReconnectOrigin,
            peer,
            generation
          );
          state.runtimeReconnectOrigin = null;
        }
      }
    } catch (error) {
      if (!stateIsCurrent(state, generation) || (client && state.electrumClient !== client)) {
        if (client?.close) client.close();
        return staleConnectionResult();
      }
      state.isClientConnected = false;
      peer.isConnected = false;

      const errorType = classifyElectrumConnectionError(error);
      const errorMessage = error?.message || String(error);
      lastConnectionError = {
        type: errorType,
        message: errorMessage,
      };
      console.log('Bad connection:', JSON.stringify(peer), {
        errorType,
        message: errorMessage,
      });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    if (!stateIsCurrent(state, generation) || state.electrumClient !== client) {
      return staleConnectionResult();
    }
    if (state.isClientConnected) {
      return {
        connected: true,
        connectedTo: peer.host,
        generation,
      };
    }
    return ElectrumClient.reconnect(generation);
  }

  public static async reconnect(expectedGeneration = connectionGeneration) {
    if (expectedGeneration !== connectionGeneration) return staleConnectionResult();
    const state = ELECTRUM_CLIENT;
    if (!selectionMatches(state)) return staleConnectionResult();
    const generation = ++connectionGeneration;
    state.connectionAttempt += 1;
    state.isClientConnected = false;

    // close the connection before attempting again
    if (state.electrumClient?.close) state.electrumClient.close();

    if (state.connectionAttempt >= ELECTRUM_CLIENT_CONFIG.maxConnectionAttempt) {
      const nextPeer = ElectrumClient.getNextPeer();
      if (!nextPeer) {
        const fallbackError =
          'Unable to connect to any electrum server. Please switch network and try again!';
        const error = lastConnectionError?.message || fallbackError;
        const errorType = lastConnectionError?.type || 'network';

        console.log('Unable to connect to any electrum server', {
          errorType,
          error,
        });

        if (state.runtimeReconnectOrigin && stateIsCurrent(state, generation)) {
          store.dispatch(electrumClientConnectionExecuted({ successful: false, error }));
          state.runtimeReconnectOrigin = null;
        }
        return { connected: false, error, errorType, generation };
      }

      state.activePeer = nextPeer;
      state.connectionAttempt = 0;
      console.log(`Attempting a connection with next peer: ${nextPeer?.host}`);
      return ElectrumClient.connect(generation);
    }
    console.log(`Reconnection attempt #${state.connectionAttempt}`);
    await new Promise((resolve) => {
      setTimeout(resolve, ELECTRUM_CLIENT_CONFIG.reconnectDelay); // attempts reconnection after 1 second
    });
    if (!stateIsCurrent(state, generation)) return staleConnectionResult();
    return ElectrumClient.connect(generation);
  }

  private static recordRuntimeRotation(
    state: ElectrumClientState,
    previousPeer: NodeDetail,
    connectedPeer: NodeDetail,
    generation: number
  ) {
    if (!stateIsCurrent(state, generation)) return;
    if (previousPeer.id !== connectedPeer.id) {
      try {
        const previousSaved = dbManager.updateObjectById(
          RealmSchema.NodeConnect,
          previousPeer.id.toString(),
          {
            isConnected: false,
          }
        );
        const connectedSaved = dbManager.updateObjectById(
          RealmSchema.NodeConnect,
          connectedPeer.id.toString(),
          {
            isConnected: true,
          }
        );
        if (!previousSaved || !connectedSaved) {
          console.warn('Unable to save active Electrum server after failover');
        }
      } catch (error) {
        console.warn('Unable to save active Electrum server after failover', error);
      }
    }
    store.dispatch(
      electrumClientConnectionExecuted({ successful: true, connectedTo: connectedPeer.host })
    );
  }

  public static getConnectionGeneration(): number {
    return connectionGeneration;
  }

  public static assertConnectionGeneration(
    expected: number,
    expectedNetworkType?: NetworkType
  ): void {
    const state = ELECTRUM_CLIENT;
    const selectedNetwork = store.getState().settings?.bitcoinNetworkType;
    if (
      !stateIsCurrent(state, expected) ||
      !state.isClientConnected ||
      !state.electrumClient ||
      (expectedNetworkType &&
        (state.activePeer?.networkType !== expectedNetworkType ||
          (selectedNetwork && selectedNetwork !== expectedNetworkType)))
    ) {
      throw new Error(ELECTRUM_CONNECTION_CHANGED_ERR);
    }
  }

  public static getNextPeer() {
    ELECTRUM_CLIENT.currentPeerIndex += 1;

    if (
      !ELECTRUM_CLIENT.peers ||
      ELECTRUM_CLIENT.currentPeerIndex > ELECTRUM_CLIENT.peers.length - 1
    )
      return null; // exhuasted all available peers
    return ELECTRUM_CLIENT.peers[ELECTRUM_CLIENT.currentPeerIndex];
  }

  public static forceDisconnect() {
    if (!ELECTRUM_CLIENT.electrumClient) throw new Error('Electrum client not available');
    connectionGeneration += 1;
    ELECTRUM_CLIENT.isClientConnected = false;
    if (ELECTRUM_CLIENT.activePeer) ELECTRUM_CLIENT.activePeer.isConnected = false;
    ELECTRUM_CLIENT.runtimeReconnectOrigin = null;
    if (ELECTRUM_CLIENT.electrumClient?.close) ELECTRUM_CLIENT.electrumClient.close();
  }

  public static async serverFeatures() {
    ElectrumClient.checkConnection();
    const generation = connectionGeneration;
    const client = ELECTRUM_CLIENT.electrumClient;
    const features = await client.server_features();
    ElectrumClient.assertConnectionGeneration(generation);
    return features;
  }

  public static getBlockchainHeaders = async (): Promise<{ height: number; hex: string }> => {
    ElectrumClient.checkConnection();
    const generation = connectionGeneration;
    const client = ELECTRUM_CLIENT.electrumClient;
    const headers = await client.blockchainHeaders_subscribe();
    ElectrumClient.assertConnectionGeneration(generation);
    return headers;
  };

  public static checkConnection() {
    if (!ELECTRUM_CLIENT.isClientConnected || !selectionMatches(ELECTRUM_CLIENT)) {
      const connectionError = ElectrumClient.connectOverTor
        ? ELECTRUM_NOT_CONNECTED_ERR_TOR
        : ELECTRUM_NOT_CONNECTED_ERR;
      throw new Error(connectionError);
    }
  }

  public static async ping() {
    if (!ELECTRUM_CLIENT.electrumClient) throw new Error('Electrum client not available');
    const generation = connectionGeneration;
    const client = ELECTRUM_CLIENT.electrumClient;
    try {
      ElectrumClient.assertConnectionGeneration(generation);
      await client.server_ping();
      ElectrumClient.assertConnectionGeneration(generation);
    } catch (_) {
      return false;
    }
    return true;
  }

  public static getActivePeer() {
    return ELECTRUM_CLIENT.activePeer;
  }

  public static resetCurrentPeerIndex() {
    ELECTRUM_CLIENT.currentPeerIndex = -1;
  }

  // if current peer to use is not provided, it will try to get the active peer from the saved list of nodes
  // if current peer to use is provided, it will use that peer
  public static setActivePeer(nodes: NodeDetail[], currentPeerToUse?: NodeDetail) {
    // close previous connection
    connectionGeneration += 1;
    ELECTRUM_CLIENT.isClientConnected = false;
    if (ELECTRUM_CLIENT.electrumClient?.close) {
      ELECTRUM_CLIENT.electrumClient.close();
    }

    // set defaults
    ELECTRUM_CLIENT = createElectrumClientState();
    ELECTRUM_CLIENT.appId = store.getState().storage?.appId ?? null;
    lastConnectionError = null;

    // set active node
    const activeNode = currentPeerToUse || nodes.find((node) => node.isConnected);
    ELECTRUM_CLIENT.activePeer = activeNode;
    ELECTRUM_CLIENT.peers = getFailoverPeers(nodes, activeNode);
    ELECTRUM_CLIENT.currentPeerIndex = activeNode ? 0 : -1;
  }

  /** Extend a successful manual connection with eligible saved peers for later reconnects. */
  public static setFailoverPeers(nodes: NodeDetail[], expectedGeneration?: number) {
    if (
      !ELECTRUM_CLIENT.isClientConnected ||
      !selectionMatches(ELECTRUM_CLIENT) ||
      (expectedGeneration !== undefined && expectedGeneration !== connectionGeneration)
    )
      return;
    const activePeer = ELECTRUM_CLIENT.activePeer;
    ELECTRUM_CLIENT.peers = getFailoverPeers(nodes, activePeer);
    ELECTRUM_CLIENT.currentPeerIndex = activePeer ? 0 : -1;
  }

  public static splitIntoChunks(arr, chunkSize) {
    const groups = [];
    for (let itr = 0; itr < arr.length; itr += chunkSize) {
      groups.push(arr.slice(itr, itr + chunkSize));
    }
    return groups;
  }

  public static async syncUTXOByAddress(
    addresses: string[],
    network: bitcoinJS.Network,
    batchsize: number = 150
  ): Promise<{ [address: string]: ElectrumUTXO[] }> {
    ElectrumClient.checkConnection();
    if (!network) network = store.getState().settings.bitcoinNetwork;
    const generation = connectionGeneration;
    const client = ELECTRUM_CLIENT.electrumClient;
    const expectedNetworkType = networkTypeFor(network);
    if (!expectedNetworkType) throw new Error('Unsupported Bitcoin network');
    ElectrumClient.assertConnectionGeneration(generation, expectedNetworkType);
    const res = {};
    const chunks = ElectrumClient.splitIntoChunks(addresses, batchsize);
    for (let itr = 0; itr < chunks.length; itr += 1) {
      ElectrumClient.assertConnectionGeneration(generation, expectedNetworkType);
      const chunk = chunks[itr];
      const scripthashes = [];
      const scripthash2addr = {};

      for (let index = 0; index < chunk.length; index += 1) {
        const addr = chunk[index];
        const script = bitcoinJS.address.toOutputScript(addr, network);
        const hash = bitcoinJS.crypto.sha256(script);
        const reversedHash = Buffer.from(reverse(hash));
        const reversedHashHex = reversedHash.toString('hex');
        scripthashes.push(reversedHashHex);
        scripthash2addr[reversedHashHex] = addr;
      }

      // eslint-disable-next-line no-await-in-loop
      const results = await client.blockchainScripthash_listunspentBatch(scripthashes);
      ElectrumClient.assertConnectionGeneration(generation, expectedNetworkType);

      for (let index = 0; index < results.length; index += 1) {
        const utxos = results[index];
        const address = scripthash2addr[utxos.param];
        res[address] = utxos.result;

        for (let utIdx = 0; utIdx < res[address].length; utIdx += 1) {
          const utxo = res[address][utIdx];
          utxo.address = address;
          utxo.txId = utxo.tx_hash;
          utxo.vout = utxo.tx_pos;
          delete utxo.tx_pos;
          delete utxo.tx_hash;
        }
      }
    }

    ElectrumClient.assertConnectionGeneration(generation, expectedNetworkType);
    return res;
  }

  public static async syncHistoryByAddress(
    addresses: string[],
    network: bitcoinJS.Network,
    batchsize: number = 150
  ): Promise<{
    historyByAddress: {};
    txids: any[];
    txidToAddress: { [tx_hash: string]: string };
  }> {
    if (addresses.length === 0) {
      return { historyByAddress: {}, txids: [], txidToAddress: {} };
    }
    if (!network) network = store.getState().settings.bitcoinNetwork;
    ElectrumClient.checkConnection();
    const generation = connectionGeneration;
    const client = ELECTRUM_CLIENT.electrumClient;
    const expectedNetworkType = networkTypeFor(network);
    if (!expectedNetworkType) throw new Error('Unsupported Bitcoin network');
    ElectrumClient.assertConnectionGeneration(generation, expectedNetworkType);

    const historyByAddress = {};
    const txids = [];
    const txidToAddress = {};

    const chunks = ElectrumClient.splitIntoChunks(addresses, batchsize);
    for (let itr = 0; itr < chunks.length; itr += 1) {
      ElectrumClient.assertConnectionGeneration(generation, expectedNetworkType);
      const chunk = chunks[itr];
      const scripthashes = [];
      const scripthash2addr = {};

      for (let index = 0; index < chunk.length; index += 1) {
        const addr = chunk[index];
        const script = bitcoinJS.address.toOutputScript(addr, network);
        const hash = bitcoinJS.crypto.sha256(script);
        const reversedHash = Buffer.from(reverse(hash));
        const reversedHashHex = reversedHash.toString('hex');
        scripthashes.push(reversedHashHex);
        scripthash2addr[reversedHashHex] = addr;
      }

      // eslint-disable-next-line no-await-in-loop
      const results = await client.blockchainScripthash_getHistoryBatch(scripthashes);
      ElectrumClient.assertConnectionGeneration(generation, expectedNetworkType);

      for (let index = 0; index < results.length; index += 1) {
        const history = results[index];
        if (history.error) console.log('syncHistoryByAddresses:', history.error);

        const address = scripthash2addr[history.param];
        historyByAddress[address] = history.result || [];
        if (historyByAddress[address].length) {
          for (const { tx_hash } of historyByAddress[address]) {
            txids.push(tx_hash);
            txidToAddress[tx_hash] = address;
          }
        }
      }
    }

    ElectrumClient.assertConnectionGeneration(generation, expectedNetworkType);
    return { historyByAddress, txids, txidToAddress };
  }

  public static async getTransactionsById(
    txids: string[],
    verbose: boolean = true,
    batchsize: number = 40,
    includeHex: boolean = false
  ): Promise<{ [txid: string]: ElectrumTransaction }> {
    if (txids.length === 0) {
      return {};
    }
    ElectrumClient.checkConnection();
    const generation = connectionGeneration;
    const client = ELECTRUM_CLIENT.electrumClient;
    ElectrumClient.assertConnectionGeneration(generation);

    const res = {};
    txids = [...new Set(txids)]; // remove duplicates, if any

    // lets try cache first
    const chunks = ElectrumClient.splitIntoChunks(txids, batchsize);
    for (const chunk of chunks) {
      ElectrumClient.assertConnectionGeneration(generation);
      let results = [];

      // eslint-disable-next-line no-await-in-loop
      results = await client.blockchainTransaction_getBatch(chunk, verbose);
      ElectrumClient.assertConnectionGeneration(generation);

      for (const txdata of results) {
        if (txdata.error && txdata.error.code === -32600) {
          // large response error, would need to handle it over a single call
        }

        // Only include transactions which returned with data in the result, note that this means the result object may not contain entries for all txids passed
        if (txdata.result) {
          res[txdata.param] = txdata.result;
          if (res[txdata.param] && !includeHex) delete res[txdata.param].hex;

          // bitcoin core 22.0.0+ .addresses in vout has been replaced by `.address`
          for (const vout of res[txdata.param]?.vout || []) {
            if (vout?.scriptPubKey?.address) {
              vout.scriptPubKey.addresses = [vout.scriptPubKey.address];
            }
          }
        }
      }
    }

    ElectrumClient.assertConnectionGeneration(generation);
    return res;
  }

  public static async estimateFee(numberOfBlocks: number = 1) {
    ElectrumClient.checkConnection();
    const generation = connectionGeneration;
    const client = ELECTRUM_CLIENT.electrumClient;
    const feePerKB = await client.blockchainEstimatefee(numberOfBlocks); // in bitcoin
    ElectrumClient.assertConnectionGeneration(generation);
    if (feePerKB === -1) return 1;
    return Math.round((feePerKB / 1024) * 1e8); // feePerByte(sats)
  }

  public static async broadcast(txHex: string) {
    ElectrumClient.checkConnection();
    const generation = connectionGeneration;
    const client = ELECTRUM_CLIENT.electrumClient;
    const txid = await client.blockchainTransaction_broadcast(txHex);
    ElectrumClient.assertConnectionGeneration(generation);
    return txid;
  }

  public static async testConnection(node: NodeDetail) {
    const connectOverTor =
      node.host?.endsWith('.onion') && RestClient?.getTorStatus() === TorStatus.CONNECTED;
    const client = new ElectrumCli(
      connectOverTor ? torrific : global.net,
      global.tls,
      node.port,
      node.host,
      node.useSSL ? 'tls' : 'tcp'
    );

    client.onError = (ex) => {
      console.log(ex);
    }; // mute
    let timeoutId = null;

    let conncetionError = null;
    let connectionErrorType: ElectrumConnectionErrorType | null = null;
    try {
      const ver = await Promise.race([
        new Promise((resolve) => {
          timeoutId = setTimeout(() => resolve('timeout'), 20000);
        }),
        client.initElectrum({
          client: 'btc-k',
          version: '1.4',
        }), // should resolve within 4 seconds(prior to timeout)
      ]);
      if (ver === 'timeout') throw new Error('Connection time-out');

      if (ver && ver[0]) return { connected: true, error: conncetionError, errorType: null };
      else throw new Error('failed to connect');
    } catch (err) {
      connectionErrorType = classifyElectrumConnectionError(err);
      console.log({
        err,
        errorType: connectionErrorType,
      });
      conncetionError = err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      client.close();
    }

    return { connected: false, error: conncetionError, errorType: connectionErrorType };
  }
}
