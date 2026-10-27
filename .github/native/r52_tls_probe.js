// Development-only entrypoint in the actual installed app. No mocked native bridge.
import 'react-native-get-random-values';
import React, { useEffect, useState } from 'react';
import { AppRegistry, SafeAreaView, Text, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { name as appName } from '../../app.json';
import fixture from './.generated/r52_tls_fixture.json';
const transport = require('../../src/services/electrum/tls');

function probe(row) {
  return new Promise(resolve => {
    let socket, complete = false, connected = false, reply = '';
    const finish = outcome => {
      if (complete) return;
      complete = true; clearTimeout(timer);
      if (socket) socket.destroy();
      resolve({ id: row.id, outcome, connected });
    };
    const timer = setTimeout(() => finish('TIMEOUT'), 8000);
    try {
      const selected = transport.forNode({ host: row.host, port: row.port,
        useSSL: true, useKeeperNode: false, tlsCa: row.ca });
      socket = selected.connect({ host: row.host, port: row.port }, () => {
        connected = true;
        socket.write(fixture.nonce + ':' + row.id + '\n');
      });
      socket.on('error', () => finish(connected ? 'POST_CONNECT_ERROR' : 'REJECT'));
      socket.on('data', bytes => {
        reply += bytes.toString();
        if (reply.length > 256) finish('BAD_REPLY');
        else if (reply.includes('\n')) finish(reply === fixture.nonce + ':' + row.id + ':verified\n' ? 'ACCEPT' : 'BAD_REPLY');
      });
      socket.on('close', () => { if (!complete) finish('CLOSED_WITHOUT_RESULT'); });
    } catch { finish('JS_EXCEPTION'); }
  });
}
let execution;
function NativeTlsProbe() {
  const [stage, setStage] = useState('running');
  useEffect(() => {
    let alive = true;
    if (!execution) execution = (async () => {
      if (!__DEV__ || fixture.schema !== 1 || Platform.OS.toUpperCase() !== fixture.platform)
        throw new Error('TLS_DEVELOPMENT_FIXTURE_REQUIRED');
      const rows = [];
      let phase = 'TLS', activeCase = null;
      let progressTail = Promise.resolve();
      // Android failure diagnostics only. This is never acceptance evidence.
      function checkpoint(state = 'RUNNING') {
        if (Platform.OS !== 'android') return;
        // Capture each finite checkpoint now; a stalled/failed diagnostic write
        // cannot delay TLS/RPC or the authoritative awaited final receipt.
        const raw = JSON.stringify({
          schema: 1, scope: 'ACTUAL_APP_RN_PRODUCTION_TLS_PROGRESS', nonce: fixture.nonce,
          platform: fixture.platform, state, phase, active_case: activeCase, cases: rows,
        });
        progressTail = progressTail.then(() => RNFS.writeFile(
          `${RNFS.DocumentDirectoryPath}/keeper-r52-tls-progress.json`, raw, 'utf8')).catch(() => {});
      }
      try {
        for (const row of fixture.cases) {
          activeCase = row.id;
          checkpoint();
          rows.push(await probe(row));
        }
        phase = 'RPC'; activeCase = null;
        checkpoint();
        const transportStatus = rows.every((row, i) => row.outcome === fixture.cases[i].expected) ? 'PASS' : 'FAIL';
        const rpc = transportStatus === 'PASS' ? await require('./r52_rpc_probe').runActualRpc(fixture) :
          { status: 'NOT RUN', reason: 'TLS_MATRIX_FAILED' };
        const status = transportStatus === 'PASS' && rpc.status === 'PASS' ? 'PASS' : 'FAIL';
        phase = 'WRITE';
        checkpoint();
        await RNFS.writeFile(`${RNFS.DocumentDirectoryPath}/keeper-r52-tls-evidence.json`, JSON.stringify({
          schema: 1, scope: 'ACTUAL_APP_RN_PRODUCTION_TLS_BRIDGE', nonce: fixture.nonce,
          platform: fixture.platform, status, transport_status: transportStatus, cases: rows, rpc,
        }), 'utf8');
        checkpoint('COMPLETE');
        return status === 'PASS' ? 'pass' : 'failed';
      } catch {
        checkpoint('EXCEPTION');
        return 'failed';
      }
    })().catch(() => 'failed');
    execution.then(value => { if (alive) setStage(value); });
    return () => { alive = false; };
  }, []);
  return <SafeAreaView><Text testID={`r52-tls-${stage}`}>Keeper native TLS {stage}</Text></SafeAreaView>;
}
AppRegistry.registerComponent(appName, () => NativeTlsProbe);
