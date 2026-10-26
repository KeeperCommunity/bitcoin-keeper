// Development-only read observer. Ordinary product app registers its own UI.
import '../../index';
import { Platform } from 'react-native';
import cryptoJS from 'crypto-js';
import Node from '../../src/services/electrum/node';
import RealmDatabase from '../../src/storage/realm/realm';
import { ELECTRUM_CLIENT } from '../../src/services/electrum/client';
import fixture from './.generated/r52_trust_ui.json';
if (!__DEV__ || fixture.schema !== 1 || !/^[a-f0-9]{48}$/.test(fixture.nonce)) {
  throw new Error('R52_TRUST_OBSERVER_DEVELOPMENT_REQUIRED');
}
const boot = Math.random().toString(36).slice(2) + Date.now().toString(36);
let pending = false;
setInterval(async () => {
  if (pending) return;
  pending = true;
  try {
    if (!Node.currentAccountId()) return;
    const ports = [fixture.a.port, fixture.b.port, fixture.c.port];
    const rows = Node.getAllNodes().filter(n => n.host === '127.0.0.1' && ports.includes(Number(n.port)))
      .map(n => ({ id: n.id, port: Number(n.port), host: n.host, useSSL: n.useSSL,
        useKeeperNode: n.useKeeperNode, isConnected: n.isConnected, networkType: n.networkType,
        ca_sha256: n.tlsCa ? cryptoJS.SHA256(n.tlsCa).toString() : null }))
      .sort((a, b) => a.port - b.port);
    const peer = ELECTRUM_CLIENT.activePeer;
    // No setters, storage keys, wallet contents, app IDs or service replacement.
    await fetch('http://127.0.0.1:8768/observe', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        schema: 1, nonce: fixture.nonce, platform: Platform.OS.toUpperCase(), boot,
        realm_version: RealmDatabase.getDatabase().schemaVersion, rows,
        connected: ELECTRUM_CLIENT.isClientConnected === true,
        active_port: peer?.host === '127.0.0.1' && ports.includes(Number(peer.port)) ? Number(peer.port) : null,
      }) });
  } catch (_) { /* No observation grants no evidence. Never log private state. */ }
  finally { pending = false; }
}, 300);
