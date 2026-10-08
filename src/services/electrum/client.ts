import ElectrumCli from 'electrum-client';
import reverse from 'buffer-reverse';
import * as bitcoinJS from 'bitcoinjs-lib';
import { NodeDetail } from 'src/services/wallets/interfaces';
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

const createElectrumClientState = () => ({
  electrumClient: null,
  isClientConnected: false,
  currentPeerIndex: -1,
  connectionAttempt: 0,
  activePeer: null,
  peers: [],
});

let lastConnectionError: {
  type: ElectrumConnectionErrorType;
  message: string;
} | null = null;

// eslint-disable-next-line import/no-mutable-exports
export let ELECTRUM_CLIENT: {
  electrumClient: any;
  isClientConnected: boolean;
  currentPeerIndex: number;
  connectionAttempt: number;
  activePeer: NodeDetail;
  peers: NodeDetail[];
} = createElectrumClientState();

export const ELECTRUM_NOT_CONNECTED_ERR =
  'Network Error: The current electrum node is not reachable, please try again with a different node';

export const ELECTRUM_NOT_CONNECTED_ERR_TOR =
  'Network Error: Connection currently failing over Tor, please disable Tor or try again using a different node';

export default class ElectrumClient {
  public static connectOverTor = false;

  public static async connect() {
    let timeoutId = null;

    try {
      if (!ELECTRUM_CLIENT.activePeer) {
        console.log(
          'Unable to connect to any electrum server. Please switch network and try again!'
        );
        return {
          connected: ELECTRUM_CLIENT.isClientConnected,
          error: 'Unable to connect to any electrum server. Please switch network and try again!',
        };
      }

      ElectrumClient.connectOverTor =
        ELECTRUM_CLIENT.activePeer?.host?.endsWith('.onion') &&
        RestClient?.getTorStatus() === TorStatus.CONNECTED;

      const client = new ElectrumCli(
        ElectrumClient.connectOverTor ? torrific : global.net,
        global.tls,
        ELECTRUM_CLIENT.activePeer.port,
        ELECTRUM_CLIENT.activePeer.host,
        ELECTRUM_CLIENT.activePeer.useSSL ? 'tls' : 'tcp'
      ); // tcp or tls
      ELECTRUM_CLIENT.electrumClient = client;

      client.onError = (error) => {
        if (ELECTRUM_CLIENT.electrumClient === client && ELECTRUM_CLIENT.isClientConnected) {
          console.log('Electrum mainClient.onError():', error?.message || error);

          ELECTRUM_CLIENT.isClientConnected = false;
          ELECTRUM_CLIENT.activePeer.isConnected = false;
          if (client?.close) client.close();
          console.log('Error: Close the connection');

          // setTimeout(
          //   ElectrumClient.connect,
          //   ELECTRUM_CLIENT.activePeer?.host?.endsWith('.onion') ? 4000 : 500
          // );
          return ElectrumClient.reconnect();
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
      if (ver === 'timeout') throw new Error('Connection time-out');

      if (ver && ver[0]) {
        console.log('Connection to electrum server is established', {
          ver,
          node: ELECTRUM_CLIENT.activePeer.host,
        });

        lastConnectionError = null;
        ELECTRUM_CLIENT.isClientConnected = true;
        ELECTRUM_CLIENT.activePeer.isConnected = true;
        ELECTRUM_CLIENT.connectionAttempt = 0;
      }
    } catch (error) {
      ELECTRUM_CLIENT.isClientConnected = false;
      if (ELECTRUM_CLIENT.activePeer) ELECTRUM_CLIENT.activePeer.isConnected = false;

      const errorType = classifyElectrumConnectionError(error);
      const errorMessage = error?.message || String(error);
      lastConnectionError = {
        type: errorType,
        message: errorMessage,
      };
      console.log('Bad connection:', JSON.stringify(ELECTRUM_CLIENT.activePeer), {
        errorType,
        message: errorMessage,
      });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    if (ELECTRUM_CLIENT.isClientConnected) {
      return {
        connected: ELECTRUM_CLIENT.isClientConnected,
        connectedTo: ELECTRUM_CLIENT.activePeer.host,
      };
    }
    return ElectrumClient.reconnect();
  }

  public static async reconnect() {
    ELECTRUM_CLIENT.connectionAttempt += 1;

    // close the connection before attempting again
    if (ELECTRUM_CLIENT.electrumClient?.close) ELECTRUM_CLIENT.electrumClient.close();

    if (ELECTRUM_CLIENT.connectionAttempt >= ELECTRUM_CLIENT_CONFIG.maxConnectionAttempt) {
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

        return {
          connected: ELECTRUM_CLIENT.isClientConnected,
          error,
          errorType,
        };
      }

      ELECTRUM_CLIENT.activePeer = nextPeer;
      ELECTRUM_CLIENT.connectionAttempt = 0;
      console.log(`Attempting a connection with next peer: ${nextPeer?.host}`);
      return ElectrumClient.connect();
    }
    console.log(`Reconnection attempt #${ELECTRUM_CLIENT.connectionAttempt}`);
    await new Promise((resolve) => {
      setTimeout(resolve, ELECTRUM_CLIENT_CONFIG.reconnectDelay); // attempts reconnection after 1 second
    });
    return ElectrumClient.connect();
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
    ELECTRUM_CLIENT.isClientConnected = false;
    if (ELECTRUM_CLIENT.activePeer) ELECTRUM_CLIENT.activePeer.isConnected = false;
    if (ELECTRUM_CLIENT.electrumClient?.close) ELECTRUM_CLIENT.electrumClient.close();
  }

  public static async serverFeatures() {
    ElectrumClient.checkConnection();

    return ELECTRUM_CLIENT.electrumClient.server_features();
  }

  public static getBlockchainHeaders = async (): Promise<{ height: number; hex: string }> =>
    ELECTRUM_CLIENT.electrumClient.blockchainHeaders_subscribe();

  public static checkConnection() {
    if (!ELECTRUM_CLIENT.isClientConnected) {
      const connectionError = ElectrumClient.connectOverTor
        ? ELECTRUM_NOT_CONNECTED_ERR_TOR
        : ELECTRUM_NOT_CONNECTED_ERR;
      throw new Error(connectionError);
    }
  }

  public static async ping() {
    if (!ELECTRUM_CLIENT.electrumClient) throw new Error('Electrum client not available');

    try {
      await ELECTRUM_CLIENT.electrumClient.server_ping();
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
    ELECTRUM_CLIENT.isClientConnected = false;
    if (ELECTRUM_CLIENT.electrumClient?.close) {
      ELECTRUM_CLIENT.electrumClient.close();
    }

    // set defaults
    ELECTRUM_CLIENT = createElectrumClientState();
    lastConnectionError = null;

    // set active node
    const activeNode = currentPeerToUse || nodes.find((node) => node.isConnected);
    ELECTRUM_CLIENT.activePeer = activeNode;
    ELECTRUM_CLIENT.peers = getFailoverPeers(nodes, activeNode);
    ELECTRUM_CLIENT.currentPeerIndex = activeNode ? 0 : -1;
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
    const res = {};
    const chunks = ElectrumClient.splitIntoChunks(addresses, batchsize);
    for (let itr = 0; itr < chunks.length; itr += 1) {
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
      const results = await ELECTRUM_CLIENT.electrumClient.blockchainScripthash_listunspentBatch(
        scripthashes
      );

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

    const historyByAddress = {};
    const txids = [];
    const txidToAddress = {};

    const chunks = ElectrumClient.splitIntoChunks(addresses, batchsize);
    for (let itr = 0; itr < chunks.length; itr += 1) {
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
      const results = await ELECTRUM_CLIENT.electrumClient.blockchainScripthash_getHistoryBatch(
        scripthashes
      );

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

    const res = {};
    txids = [...new Set(txids)]; // remove duplicates, if any

    // lets try cache first
    const chunks = ElectrumClient.splitIntoChunks(txids, batchsize);
    for (const chunk of chunks) {
      let results = [];

      // eslint-disable-next-line no-await-in-loop
      results = await ELECTRUM_CLIENT.electrumClient.blockchainTransaction_getBatch(chunk, verbose);

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

    return res;
  }

  public static async estimateFee(numberOfBlocks: number = 1) {
    ElectrumClient.checkConnection();

    const feePerKB = await ELECTRUM_CLIENT.electrumClient.blockchainEstimatefee(numberOfBlocks); // in bitcoin
    if (feePerKB === -1) return 1;
    return Math.round((feePerKB / 1024) * 1e8); // feePerByte(sats)
  }

  public static async broadcast(txHex: string) {
    ElectrumClient.checkConnection();

    return ELECTRUM_CLIENT.electrumClient.blockchainTransaction_broadcast(txHex);
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
