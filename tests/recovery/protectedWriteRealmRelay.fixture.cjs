// Separate protected-v3 fixture. The separately obtained backend remains out of
// app history. Every successful request reaches its actual reviewed router and
// bounded transactional service; only explicit fault cases alter a reply.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const { checkedBackend } = require('../../scripts/run-protected-backup-genuine.cjs');

async function actualCryptoModules() {
  const app = path.resolve(__dirname, '../..');
  const declared = JSON.parse(fs.readFileSync(path.join(app, 'package.json'))).dependencies;
  const modules = {};
  for (const name of ['@scure/bip32', '@scure/bip39', '@scure/bip39/wordlists/english.js',
    '@noble/hashes/hkdf.js', '@noble/hashes/sha2.js', '@noble/hashes/utils.js',
    '@noble/curves/secp256k1.js', '@noble/curves/utils.js', '@exodus/bytes/encoding-lite.js']) {
    const packageName = name.split('/').slice(0, 2).join('/');
    assert.match(declared[packageName], /^\d+\.\d+\.\d+$/, 'New authority dependencies must be exactly pinned');
    const filename = require.resolve(name);
    let directory = path.dirname(filename), metadata;
    while (directory !== path.dirname(directory)) {
      const candidate = path.join(directory, 'package.json');
      if (fs.existsSync(candidate)) {
        const value = JSON.parse(fs.readFileSync(candidate));
        if (value.name === packageName) { metadata = value; break; }
      }
      directory = path.dirname(directory);
    }
    assert.equal(metadata?.version, declared[packageName], 'Import the actual pinned production dependency');
    modules[name] = await import(pathToFileURL(filename).href);
    assert.equal(Object.prototype.toString.call(modules[name]), '[object Module]');
  }
  return modules;
}

async function createProtectedRealmClient(url, options = {}) {
  const moduleBindings = await actualCryptoModules();
  const { createRealmClient } = require('./automaticWriteRealmRelay.fixture.cjs');
  const client = await createRealmClient(url, { ...options, moduleBindings });
  client.protected = client.load('src/services/backup/protected');
  client.authority = client.load('src/services/backup/authority');
  return client;
}

function actualLegacyReadHandlers(checkout, backend) {
  // Evaluate only the exact two production handler declarations. The private
  // service loader uses inert provider constructors with hard operation traps;
  // the complete server/provider bootstrap and auth middleware are NOT loaded.
  const requireBackend = createRequire(path.join(checkout, 'package.json'));
  const ts = requireBackend('typescript'), express = requireBackend('express');
  const filename = path.join(checkout, 'src/routes/routes.ts');
  const tree = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const wanted = new Set(['/getAppImage', '/getBackupSnapshot']), handlers = new Map();
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(tree) === 'router' && node.expression.name.text === 'post' &&
      ts.isStringLiteral(node.arguments[0]) && wanted.has(node.arguments[0].text)) {
      assert.equal(node.arguments.length, 2);
      handlers.set(node.arguments[0].text, node.arguments[1].getText(tree));
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); assert.equal(handlers.size, wanted.size, 'The exact legacy read handlers must be present');
  const bhr = backend.loader.load('src/services/bhr.ts');
  const { getBackupSnapshot } = backend.loader.load('src/services/backupSnapshot.ts');
  const app = express(); app.use(express.json({ limit: '50mb' }));
  for (const [route, declaration] of handlers) {
    const js = ts.transpileModule(`module.exports = (${declaration});`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const module = { exports: {} };
    vm.runInThisContext(`(function(module,bhr,getBackupSnapshot){${js}\n})`, { filename })
      (module, bhr, getBackupSnapshot);
    app.post(route, module.exports);
  }
  return app;
}

async function createProtectedServer() {
  const checkout = checkedBackend(process.env.KEEPER_PROTECTED_RELAY_CHECKOUT);
  const { createProtectedHttpFixture } = require(path.join(checkout, 'tests/support/protectedBackupFixture.cjs'));
  const backend = await createProtectedHttpFixture();
  const target = new URL(backend.url);
  assert.equal(target.protocol, 'http:');
  assert.equal(target.hostname, '127.0.0.1');
  const trace = [], faults = [];
  let server;
  try {
    const legacyReads = actualLegacyReadHandlers(checkout, backend);
    server = http.createServer((request, response) => {
      if (['/getAppImage', '/getBackupSnapshot'].includes(request.url)) {
        const event = { path: request.url, method: request.method, status: null, legacyRead: true, committed: false };
        trace.push(event); response.once('finish', () => { event.status = response.statusCode; });
        legacyReads(request, response); return;
      }
      const chunks = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        const raw = Buffer.concat(chunks);
        let upstreamUrl;
        // Route only fixed fixture endpoints. Never construct an outgoing URL
        // from an incoming target, including query, authority or escape forms.
        switch (request.url) {
          case '/backup/v3/enroll': upstreamUrl = new URL('/backup/v3/enroll', target); break;
          case '/backup/v3/snapshot': upstreamUrl = new URL('/backup/v3/snapshot', target); break;
          case '/backup/v3/mutate': upstreamUrl = new URL('/backup/v3/mutate', target); break;
          default: response.writeHead(400); response.end(); return;
        }
        let body;
        try { body = JSON.parse(raw.toString('utf8')); } catch { /* malformed fault cases stay inert */ }
        const event = { path: request.url, method: request.method, operation: body?.operation,
          namespaceId: body?.namespaceId, expectedRevision: body?.expectedRevision,
          expectedGeneration: body?.expectedGeneration, authEpoch: body?.authEpoch,
          ...(body?.operation === 'updateAppImage' && Array.isArray(body.data?.nodes)
            ? { replaceNodes: body.data.replaceNodes, nodeCount: body.data.nodes.length } : {}),
          status: null, committed: false };
        trace.push(event);
        const faultIndex = faults.findIndex(fault => fault.path === request.url &&
          (!fault.operation || fault.operation === body?.operation));
        let fault;
        if (faultIndex >= 0) {
          if (faults[faultIndex].after) faults[faultIndex].after--;
          else [fault] = faults.splice(faultIndex, 1);
        }
        const upstream = http.request(upstreamUrl, {
          method: request.method, headers: request.headers, timeout: 25000,
        }, incoming => {
          const replies = [];
          incoming.on('data', chunk => replies.push(chunk));
          incoming.on('end', async () => {
            let bytes = Buffer.concat(replies), decoded;
            try { decoded = JSON.parse(bytes.toString('utf8')); } catch { /* preserve the real raw reply */ }
            event.status = incoming.statusCode;
            event.committed = incoming.statusCode === 200 && decoded?.updated === true;
            if (event.committed) Object.assign(event, { serverRevision: decoded.newRevision,
              serverGeneration: decoded.newGeneration, serverAuthEpoch: decoded.authEpoch });
            try {
              // Fault callbacks can hold or mutate a *real* completed read/ACK.
              // They never supply a successful fabricated acknowledgement.
              if (fault?.beforeReply) await fault.beforeReply({ body: decoded, event });
              if (fault?.mode === 'lost-reply') { response.destroy(); return; }
              if (fault?.mode === 'malformed-json') bytes = Buffer.from('{malformed');
              else if (fault?.mutateReply) bytes = Buffer.from(JSON.stringify(fault.mutateReply(decoded)));
              response.writeHead(incoming.statusCode, { 'content-type': 'application/json', 'content-length': bytes.length });
              response.end(bytes);
            } catch {
              response.destroy();
            }
          });
          incoming.on('error', () => response.destroy());
        });
        upstream.on('timeout', () => upstream.destroy());
        upstream.on('error', () => response.destroy());
        request.on('aborted', () => upstream.destroy());
        upstream.end(raw);
      });
      request.on('error', () => response.destroy());
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { backend, trace, audience: 'https://keeper-fixture.invalid',
      url: `http://127.0.0.1:${server.address().port}/`,
      armFault(fault) {
        assert.ok(['/backup/v3/enroll', '/backup/v3/snapshot', '/backup/v3/mutate'].includes(fault.path));
        assert.ok(!fault.mode || ['lost-reply', 'malformed-json'].includes(fault.mode));
        faults.push({ ...fault });
      },
      clearTrace() { trace.length = 0; backend.clearTrace(); },
      async reset() {
        faults.length = 0; trace.length = 0; await backend.reset();
        for (const name of ['appimages', 'appVaultImages', 'vault images', 'vault maps', 'labels', 'apps'])
          await backend.mongoose.connection.db.collection(name).deleteMany({});
        backend.clearCommands();
      },
      async seedLegacy(payload) {
        const database = backend.mongoose.connection.db;
        const appId = payload.appId;
        await database.collection('appimages').replaceOne({ appId }, { appId,
          publicId: payload.publicId, version: payload.version, subscription: payload.subscription,
          wallets: payload.walletObject, signers: payload.signersObject, nodes: payload.nodes,
          vaults: Object.keys(payload.vaultObject), labels: payload.labels.map(label => label.id),
          backupRevisionRequired: true, incrementalRevisionRequired: false, backupGeneration: 0,
        }, { upsert: true });
        for (const value of Object.values(payload.vaultObject)) {
          await database.collection('appVaultImages').replaceOne({ appId, vaultId: value.vaultId },
            { appId, vaultId: value.vaultId, vault: value.vault, isArchived: !!value.isArchived,
              signerIds: value.signersData.map(signer => signer.signerId) }, { upsert: true });
        }
        for (const label of payload.labels) await database.collection('labels').replaceOne({ id: label.id }, label, { upsert: true });
        await database.collection('apps').replaceOne({ appId }, { _id: appId, appId,
          subscription: { level: 1, isCancelled: false, productId: 'disposable-product',
            transactionReceipt: 'disposable-stored-receipt' } }, { upsert: true });
      },
      async close() {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await backend.close();
      },
    };
  } catch (error) {
    if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await backend.close();
    throw error;
  }
}

module.exports = { createProtectedServer, createProtectedRealmClient, actualCryptoModules };
