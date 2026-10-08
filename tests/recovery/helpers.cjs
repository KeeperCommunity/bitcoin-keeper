const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function loadModule(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, setTimeout, clearTimeout,
    AbortController, Date, Buffer, console,
    require: (name) => name in mocks ? mocks[name] : require(name), ...globals });
  return module.exports;
}
const encryption = loadModule('src/utils/service-utilities/encryption.ts', { 'react-native-rsa-native': { RSA: {} } });
const image = loadModule('src/services/backup/image.ts', { 'src/utils/service-utilities/encryption': encryption });
const makeImage = () => ({ wallets: {}, signers: {}, vaults: {}, nodes: {}, labels: {} });
function harness(options = {}) {
  const app = { id: 'disposable', publicId: 'fixture', primarySeed: 'ab'.repeat(32), subscription: { level: 1 }, version: '2.5.16' };
  const local = { Wallet: [], USDTWallet: [], Signer: [], Vault: [], NodeConnect: [], Tags: [] };
  const remote = { appId: app.id, wallets: {}, signers: {}, nodes: [], vaults: [], labels: [] };
  let vaults = [], labels = [];
  const revision = () => require('node:crypto').createHash('sha256').update(JSON.stringify({remote,vaults,labels})).digest('hex');
  const calls = [], phases = [], diagnostics = [];
  const db = { getObjectByIndex: (schema) => schema === 'KeeperApp' ? app : local[schema] };
  const rest = { post: async (path, payload, _headers, config) => {
    calls.push(path.replace('fixture/', ''));
    if (options.post) await options.post({ path, payload, config, remote, app, local });
    if (options.adapter) return options.adapter(path.replace('fixture/', ''), payload, config);
    if (path.endsWith('getBackupSnapshot')) {
      if (options.readError) throw Error('offline');
      return { data: options.response || { appImage: remote, allVaultImages: vaults, labels, revision: revision() } };
    }
    if (path.endsWith('updateAppImage')) return { data: { updated: true } };
    if (payload.expectedRevision !== revision()) throw Error('Backup changed');
    if (options.reject) return { data: { updated: false } };
    remote.wallets = { ...payload.walletObject }; remote.signers = { ...payload.signersObject }; remote.nodes = payload.nodes;
    vaults = Object.values(payload.vaultObject); labels = payload.labels;
    remote.vaults = vaults.map(v => v.vaultId); remote.labels = labels.map(v => v.id);
    if (options.corruptWrite) remote.wallets = {};
    if (options.lostResponse) throw Error('response lost after commit');
    return { data: { updated: true } };
  } };
  const clock = options.now ? { Date: { now: options.now } } : {};
  const transport = loadModule('src/services/backup/transport.ts', { '../rest/RestClient': rest }, clock);
  const repair = loadModule('src/services/backup/repair.ts', {
    'src/storage/realm/dbManager': db,
    'src/storage/realm/enum': { RealmSchema: new Proxy({}, { get: (_, name) => name }) },
    'src/utils/service-utilities/config': { RELAY: 'fixture/' },
    'src/utils/service-utilities/encryption': encryption,
    'src/utils/utilities': { getKeyUID: s => s.id || s.masterFingerprint, sanitizeSeedKeyForBackup: s => s, sanitizeVaultSignersForSeedKeyBackup: s => s },
    './transport': transport, './image': image,
  }, { ...clock, console: { warn: (...args) => diagnostics.push(args) } });
  return { app, local, remote, calls, phases, diagnostics, transport, repair,
    run: (write = false) => repair.inspectBackup(app.id, write, phase => phases.push(phase)) };
}
const wallet = (id = 'wallet', networkType = 'MAINNET') => ({ id, networkType, type: 'DEFAULT',
  derivationDetails: { instanceNum: 0 }, presentationData: { name: 'Disposable wallet' },
  specs: { xpub: 'disposable-test-key', nextFreeAddressIndex: 1, balances: { confirmed: 0 }, transactions: [] } });
module.exports = { loadModule, encryption, image, makeImage, harness, wallet };
