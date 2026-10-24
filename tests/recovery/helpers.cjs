const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function loadModule(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    setTimeout,
    clearTimeout,
    AbortController,
    Date,
    Buffer,
    console,
    require: (name) => (name in mocks ? mocks[name] : require(name)),
    ...globals,
  });
  return module.exports;
}
const encryption = loadModule('src/utils/service-utilities/encryption.ts', {
  'react-native-rsa-native': { RSA: {} },
});
const image = loadModule('src/services/backup/image.ts', {
  'src/utils/service-utilities/encryption': encryption,
});
const makeImage = () => ({ wallets: {}, signers: {}, vaults: {}, nodes: {}, labels: {} });
// UNIT-ONLY authenticated-transport boundary for historical kernel schedules.
// The old fake POST fixture supplies ciphertext/revisions; this facade models
// namespace/generation/epoch and ACK binding, NOT signing, enrollment or Mongo.
// Production readiness constants and the separate genuine v3 lane stay real.
function unitProtectedFacade(transport, app) {
  let generation = 0, authEpoch = 0, previousRevision;
  const namespace = () => `unit-protected-${app.id}`;
  const validRevision = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const fail = () => { throw new transport.BackupRequestError('protocol'); };
  const adopt = revision => {
    if (!validRevision(revision)) fail();
    if (previousRevision && previousRevision !== revision) generation++;
    previousRevision = revision;
  };
  const protectedBackupBase = snapshot => {
    if (!validRevision(snapshot?.revision) || typeof snapshot.namespaceId !== 'string' ||
      !Number.isSafeInteger(snapshot.generation) || !Number.isSafeInteger(snapshot.authEpoch)) fail();
    return Object.freeze({ namespaceId: snapshot.namespaceId, revision: snapshot.revision,
      generation: snapshot.generation, authEpoch: snapshot.authEpoch });
  };
  const readProtectedBackup = async (_mnemonic, deadline, _appId, checkpoint = () => {}) => {
    checkpoint();
    const response = await transport.boundedBackupPost('fixture/getBackupSnapshot', { appId: app.id }, deadline);
    checkpoint();
    const raw = JSON.parse(JSON.stringify(response.data));
    if (raw?.revisionedMutations !== true) fail();
    adopt(raw.revision);
    const namespaceId = namespace();
    // Normalize only the expected fixture identity; foreign IDs remain invalid.
    if (raw.appImage?.appId === app.id) raw.appImage.appId = namespaceId;
    if (Array.isArray(raw.allVaultImages)) raw.allVaultImages.forEach(vault => {
      if (vault.appId === undefined || vault.appId === app.id) vault.appId = namespaceId;
      // Complete only omitted projection fields in normal old unit records.
      // Explicit mismatches remain untouched for the production validator.
      try {
        const decoded = JSON.parse(encryption.decrypt(encryption.generateEncryptionKey(app.primarySeed), vault.vault));
        if (Array.isArray(decoded.signers)) {
          const references = decoded.signers.map(signer => ({ signerId: signer.id || signer.masterFingerprint,
            xfpHash: encryption.hash256(signer.masterFingerprint) }));
          if (vault.signersData === undefined) vault.signersData = references;
          if (vault.signerIds === undefined) vault.signerIds = references.map(signer => signer.signerId);
          if (vault.scheme === undefined) vault.scheme = decoded.scheme;
          if (vault.isArchived === undefined) vault.isArchived = !!decoded.archived;
        }
      } catch { /* Invalid ciphertext remains subject to production decode. */ }
    });
    return { state: 'present', namespaceId, snapshot: {
      ...raw, namespaceId, generation, authEpoch, scope: 'protected-backup', exists: true,
      deleted: false, suppressLegacyFallback: false,
      backupRevisionRequired: true, incrementalRevisionRequired: true,
    } };
  };
  return {
    protectedBackupBase,
    sameProtectedBackupBase: (a, b) => !!a && !!b && a.namespaceId === b.namespaceId &&
      a.revision === b.revision && a.generation === b.generation && a.authEpoch === b.authEpoch,
    readProtectedBackup,
    enrollProtectedBackup: async () => { throw new Error('Enrollment requires the genuine protected fixture'); },
    assertProtectedBackupWriteReady: () => {}, // Explicit mocked unit boundary only.
    protectedBackupMutation: async (_mnemonic, base, operation, body, deadline, checkpoint = () => {}) => {
      checkpoint();
      if (base.namespaceId !== namespace() || base.revision !== previousRevision ||
        base.generation !== generation || base.authEpoch !== authEpoch) fail();
      const response = await transport.boundedBackupPost('fixture/revisionedBackupMutation',
        { ...body, operation, expectedRevision: base.revision }, deadline);
      checkpoint();
      const reply = response.data;
      if (reply?.updated !== true || reply.preconditionApplied !== true ||
        !validRevision(reply.newRevision) || reply.newRevision === base.revision) fail();
      adopt(reply.newRevision);
      if (operation === 'deleteBackup') authEpoch++;
      return { ...reply, base: protectedBackupBase({ namespaceId: namespace(),
        revision: reply.newRevision, generation, authEpoch }) };
    },
  };
}
function harness(options = {}) {
  const app = {
    id: 'disposable',
    publicId: 'fixture',
    primarySeed: 'ab'.repeat(32),
    subscription: { level: 1 },
    version: '2.5.16',
  };
  const local = {
    Wallet: [],
    USDTWallet: [],
    Signer: [],
    Vault: [],
    VaultSigner: [],
    NodeConnect: [],
    Tags: [],
  };
  const remote = {
    appId: app.id,
    publicId: app.publicId,
    version: app.version,
    networkType: app.networkType,
    subscription: JSON.stringify(app.subscription),
    wallets: {},
    signers: {},
    nodes: [],
    vaults: [],
    labels: [],
  };
  let vaults = [],
    labels = [];
  const revision = () =>
    require('node:crypto')
      .createHash('sha256')
      .update(JSON.stringify({ remote, vaults, labels }))
      .digest('hex');
  const calls = [],
    phases = [],
    diagnostics = [];
  const db = { getObjectByIndex: (schema) => (schema === 'KeeperApp' ? app : local[schema]) };
  const rest = {
    post: async (path, payload, _headers, config) => {
      const revisionBeforeHook = revision();
      calls.push(path.replace('fixture/', ''));
      if (options.post) await options.post({ path, payload, config, remote, app, local });
      if (options.adapter) return options.adapter(path.replace('fixture/', ''), payload, config);
      if (path.endsWith('getBackupSnapshot')) {
        if (options.readError) throw Error('offline');
        return {
          data: options.response || {
            appImage: remote,
            allVaultImages: vaults,
            labels,
            revision: revision(),
            revisionedMutations: true,
          },
        };
      }
      if (path.endsWith('revisionedBackupMutation') && payload.operation !== 'repairAppBackup') {
        if (payload.expectedRevision !== revisionBeforeHook) throw { response: { status: 409 } };
        return { data: { updated: true, preconditionApplied: true } };
      }
      if (path.endsWith('updateAppImage')) return { data: { updated: true } };
      if (payload.expectedRevision !== revision()) throw Error('Backup changed');
      if (options.reject) return { data: { updated: false } };
      remote.wallets = { ...payload.walletObject };
      remote.signers = { ...payload.signersObject };
      remote.nodes = payload.nodes;
      for (const field of ['publicId', 'version', 'networkType', 'subscription'])
        remote[field] = payload[field];
      vaults = Object.values(payload.vaultObject);
      labels = payload.labels;
      remote.vaults = vaults.map((v) => v.vaultId);
      remote.labels = labels.map((v) => v.id);
      if (options.corruptWrite) remote.wallets = {};
      if (options.lostResponse) throw Error('response lost after commit');
      return {
        data: {
          updated: true,
          ...(path.endsWith('revisionedBackupMutation') ? { preconditionApplied: true } : {}),
          newRevision: revision(),
        },
      };
    },
  };
  const clock = options.now ? { Date: { now: options.now } } : {};
  const transport = loadModule(
    'src/services/backup/transport.ts',
    { '../rest/RestClient': rest },
    clock
  );
  transport.setBackupUploadGuard((id) => app.id === id);
  const realmAdapter = { objects: (schema) => (schema === 'KeeperApp' ? [app] : local[schema]) };
  const schemaEnum = { RealmSchema: new Proxy({}, { get: (_, name) => name }) };
  const utilities = {
    getKeyUID: (s) => s.id || s.masterFingerprint,
    sanitizeSeedKeyForBackup: (s) => s,
    sanitizeVaultSignersForSeedKeyBackup: (s) => s,
  };
  const localSnapshot = loadModule('src/services/backup/localSnapshot.ts', {
    'src/storage/realm/enum': schemaEnum,
    'src/utils/service-utilities/encryption': encryption,
    'src/utils/utilities': utilities,
    './image': image,
  });
  const repair = loadModule(
    'src/services/backup/repair.ts',
    {
      'src/storage/realm/dbManager': db,
      'src/storage/realm/realm': { getDatabase: () => realmAdapter },
      'src/storage/realm/enum': schemaEnum,
      'src/utils/service-utilities/config': { RELAY: 'fixture/' },
      'src/utils/service-utilities/encryption': encryption,
      'src/utils/utilities': utilities,
      './transport': transport,
      './protected': unitProtectedFacade(transport, app),
      './image': image,
      './localSnapshot': localSnapshot,
    },
    { ...clock, console: { warn: (...args) => diagnostics.push(args) } }
  );
  return {
    app,
    local,
    remote,
    calls,
    phases,
    diagnostics,
    transport,
    repair,
    run: (write = false) => repair.inspectBackup(app.id, write, (phase) => phases.push(phase)),
  };
}
const wallet = (id = 'wallet', networkType = 'MAINNET') => ({
  id,
  networkType,
  type: 'DEFAULT',
  derivationDetails: { instanceNum: 0 },
  presentationData: { name: 'Disposable wallet' },
  specs: {
    xpub: 'disposable-test-key',
    nextFreeAddressIndex: 1,
    balances: { confirmed: 0 },
    transactions: [],
  },
});
module.exports = { loadModule, encryption, image, makeImage, harness, wallet, unitProtectedFacade };
