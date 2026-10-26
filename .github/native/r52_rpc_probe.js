// CI-only actual app service caller. No dependency mocks, public-peer remapping,
// normal product UI claim, account creation, Realm mutation, or real transaction.
export async function runActualRpc(fixture) {
  const result = { schema: 1, scope: 'ACTUAL_APP_ELECTRUM_CALLER_AND_NATIVE_TLS_SYNTHETIC_RPC',
    nonce: fixture.nonce, platform: fixture.platform, status: 'FAIL', cases: [],
    account_scope: 'EMPTY_OWNED_APP_NO_ACCOUNT_OR_REALM_MUTATION',
    peer_scope: 'SELECTED_PRIVATE_RETRY_AND_INDEPENDENT_OTHER_ENDPOINT_NOT_PUBLIC_ROTATION' };
  let ElectrumClient, connectionState, disconnected = false;
  const check = (condition, code) => { if (!condition) throw new Error(code); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function bounded(promise) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('RPC_APP_TIMEOUT')), 25000);
    })]); } finally { clearTimeout(timer); }
  }
  const passed = (id, extra = {}) => result.cases.push({ id, status: 'PASS', ...extra });
  try {
    const config = fixture.rpc;
    check(__DEV__ && config?.schema === 1 && /^[a-f0-9]{48}$/.test(fixture.nonce), 'RPC_DEV_CONFIG');
    check([config.selected, config.other].every(row => row.host === '127.0.0.1' &&
      Number.isInteger(row.port) && row.port > 1024 && row.port < 65536), 'RPC_LOOPBACK_ONLY');
    check(config.selected.port !== config.other.port && Number.isInteger(config.control_port) &&
      config.control_port > 1024 && config.control_port < 65536 &&
      config.expected.fake_transaction === 'keeper-r52-invalid-nontransaction:' + fixture.nonce,
      'RPC_DISPOSABLE_INPUT');
    // Load the production shims and unmodified app modules in the actual RN app.
    // The owned installation must be empty after real ordinary-startup acceptance.
    require('../../shim');
    const clientModule = require('../../src/services/electrum/client');
    ElectrumClient = clientModule.default;
    connectionState = () => clientModule.ELECTRUM_CLIENT;
    const { store, persistor } = require('../../src/store/store');
    const bitcoin = require('bitcoinjs-lib');
    const CryptoJS = require('crypto-js');
    for (let i = 0; !persistor.getState().bootstrapped && i < 100; i++) await sleep(100);
    check(persistor.getState().bootstrapped, 'RPC_REHYDRATION_REQUIRED');
    function emptyAccount() {
      const state = store.getState();
      check(!state.storage.appId && [null, undefined, 'TESTNET'].includes(state.settings.bitcoinNetworkType),
        'RPC_EMPTY_DISPOSABLE_APP_REQUIRED');
    }
    emptyAccount();
    const detail = (row, id, ca) => ({ id, host: row.host, port: String(row.port), useSSL: true,
      useKeeperNode: false, isConnected: false, networkType: 'TESTNET', tlsCa: ca });
    const selected = detail(config.selected, 910001, config.selected.ca);
    const other = detail(config.other, 910002, null);
    function selectedOnly() {
      emptyAccount();
      const state = connectionState();
      check(state.isClientConnected === true && state.activePeer?.host === '127.0.0.1' &&
        Number(state.activePeer.port) === config.selected.port &&
        state.activePeer.tlsCa === selected.tlsCa && state.peers.length === 1 &&
        Number(state.peers[0].port) === config.selected.port, 'RPC_SELECTED_PRIVATE_POLICY');
    }
    async function control(stage) {
      emptyAccount();
      const response = await bounded(fetch('http://127.0.0.1:' + config.control_port + '/control', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: fixture.nonce, stage }),
      }));
      check(response.status === 200, 'RPC_SERVER_WITNESS_REJECTED');
      const body = await bounded(response.json());
      check(body.stage === stage && body.status === 'PASS', 'RPC_SERVER_WITNESS_REPLY');
    }
    // This executes the actual private-peer admission policy; B must not become
    // an automatic fallback merely because it appears in this candidate list.
    ElectrumClient.setActivePeer([selected, other], selected);
    check((await bounded(ElectrumClient.connect())).connected === true, 'RPC_INITIAL_CONNECTION');
    selectedOnly();
    const expected = config.expected;
    const address = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 7), network: bitcoin.networks.testnet }).address;
    const header = await bounded(ElectrumClient.getBlockchainHeaders());
    check(header.height === expected.height && header.hex === expected.header_hex, 'RPC_HEADERS');
    passed('synthetic_headers'); selectedOnly();
    const utxos = await bounded(ElectrumClient.syncUTXOByAddress([address], bitcoin.networks.testnet));
    const utxo = utxos[address]?.[0];
    check(Object.keys(utxos).length === 1 && utxos[address].length === 1 && utxo.txId === expected.txid &&
      utxo.vout === 0 && utxo.value === expected.value && utxo.height === expected.height &&
      utxo.address === address && !Object.hasOwn(utxo, 'tx_hash') && !Object.hasOwn(utxo, 'tx_pos'), 'RPC_UTXO');
    passed('synthetic_utxo'); selectedOnly();
    const history = await bounded(ElectrumClient.syncHistoryByAddress([address], bitcoin.networks.testnet));
    check(Object.keys(history.historyByAddress).length === 1 && history.historyByAddress[address]?.length === 1 &&
      history.historyByAddress[address][0].tx_hash === expected.txid &&
      history.historyByAddress[address][0].height === expected.height &&
      history.txids.length === 1 && history.txids[0] === expected.txid &&
      history.txidToAddress[expected.txid] === address, 'RPC_HISTORY');
    passed('synthetic_history'); selectedOnly();
    check(await bounded(ElectrumClient.estimateFee(2)) === expected.fee_sat_per_byte, 'RPC_FEE');
    passed('synthetic_fee'); selectedOnly();
    check(await bounded(ElectrumClient.broadcast(expected.fake_transaction)) === expected.txid, 'RPC_FAKE_BROADCAST');
    passed('synthetic_fake_broadcast'); selectedOnly();
    const generation = ElectrumClient.getConnectionGeneration(), originalClient = connectionState().electrumClient;
    await control('drop_after_rpc');
    for (let i = 0; i < 150; i++) {
      if (connectionState().isClientConnected && connectionState().electrumClient !== originalClient &&
          ElectrumClient.getConnectionGeneration() > generation) break;
      await sleep(100);
    }
    selectedOnly();
    const after = ElectrumClient.getConnectionGeneration();
    check(after > generation && connectionState().electrumClient !== originalClient, 'RPC_PRODUCTION_RETRY_REQUIRED');
    await control('selected_retry');
    passed('forced_selected_socket_retry', { generation_before: generation, generation_after: after,
      client_replaced: true, selected_port: config.selected.port,
      ca_sha256: CryptoJS.SHA256(selected.tlsCa.trim()).toString(), eligible_peer_count: connectionState().peers.length });
    const rejected = await bounded(ElectrumClient.testConnection(other));
    check(rejected.connected === false, 'RPC_OTHER_INHERITED_TRUST'); selectedOnly();
    await control('other_untrusted'); passed('other_endpoint_no_inherited_ca');
    const accepted = await bounded(ElectrumClient.testConnection({ ...other, tlsCa: config.selected.ca }));
    check(accepted.connected === true, 'RPC_OTHER_EXPLICIT_TRUST'); selectedOnly();
    await control('other_explicit'); passed('other_endpoint_explicit_same_ca');
    ElectrumClient.forceDisconnect(); disconnected = true;
    await sleep(1500);
    emptyAccount(); check(connectionState().isClientConnected === false, 'RPC_EXPLICIT_DISCONNECT');
    await control('disconnected'); passed('explicit_disconnect_no_retry');
    result.status = 'PASS';
  } catch (error) {
    result.failure = /^RPC_[A-Z_]+$/.test(error?.message) ? error.message : 'RPC_NATIVE_OR_APP_EXCEPTION';
  } finally {
    if (!disconnected && connectionState?.().electrumClient) {
      try { ElectrumClient.forceDisconnect(); } catch (_) { result.status = 'FAIL'; result.failure = 'RPC_APP_CLEANUP_FAILED'; }
    }
  }
  return result;
}
