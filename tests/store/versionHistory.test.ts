import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import vm from 'vm';
import semver from 'semver';
import { runSaga } from 'redux-saga';
import * as effects from 'redux-saga/effects';
import * as enums from 'src/services/wallets/enums';
import { RealmSchema } from 'src/storage/realm/enum';
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import * as bitcoinJS from 'bitcoinjs-lib';
import ecc from 'src/services/wallets/operations/taproot-utils/noble_ecc';

const { encryption, image, loadModule } = require('../recovery/helpers.cjs');
const { prepareRecoveryImage, prepareRecoverySourceImage, hasRecoveryRecords } =
  loadModule('src/services/backup/restore.ts', { './image': image });
const BIP85 = loadModule('src/services/wallets/operations/BIP85.ts', {
  'src/utils/service-utilities/config': {},
  '../enums': enums,
  './taproot-utils/noble_ecc': ecc,
}).default;
const bip32 = BIP32Factory(ecc);
const previousVersion = '2.5.15';
const newVersion = '2.5.16';
const writeIntent = Object.freeze({
  appId: 'test-app',
  accountSession: 1,
  baseRevision: 'a'.repeat(64),
  baselineEpoch: 1,
});
const clone = (value) => JSON.parse(JSON.stringify(value));

function sourceDeclarations(file: string, names?: string[]) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(process.cwd(), file), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  return source.statements
    .filter(
      (node) =>
        (ts.isFunctionDeclaration(node) && (!names || names.includes(node.name?.text))) ||
        (ts.isVariableStatement(node) &&
          node.declarationList.declarations.some((declaration) =>
            names
              ? names.includes(declaration.name.getText(source))
              : declaration.name.getText(source) === 'upgradeAccountIsActive' ||
                declaration.name.getText(source).endsWith('_VERSION')
          ))
    )
    .map((node) =>
      node
        .getText(source)
        .replace(/^export /, '')
        .replace(/^const /, 'var ')
    )
    .join('\n');
}

// Tests orchestration with an explicit unit transaction adapter. Native Realm,
// branded CAS and readback are tested by automaticUpgradeProducer.integration.
// Encryption, BIP39/BIP32 and BIP85 use real production/pure crypto primitives.
function fixture(appId = 'test-app') {
  const state = {
    appId,
    session: 1,
    events: [],
    queue: [],
    actions: [],
    errors: [],
    rollbackHistory: false,
    migrations: [],
    topics: [],
  };
  const app: any = { id: appId, version: previousVersion, primarySeed: 'ab'.repeat(32) };
  const records: Record<string, any[]> = {
    Wallet: [{ id: 'legacy-wallet' }],
    USDTWallet: [],
    Signer: [],
    Vault: [],
    VaultSigner: [],
    Tags: [],
    VersionHistory: [],
    BackupHistory: [],
    NodeConnect: [],
    UTXOInfo: [
      { walletId: 'legacy-wallet', txId: 'legacy-tx', vout: 0, labels: [{ name: 'old note' }] },
    ],
  };
  const create = (schema, value) => {
    if (state.rollbackHistory && schema === RealmSchema.VersionHistory)
      throw new Error('history rollback fixture');
    if (schema === RealmSchema.KeeperApp) Object.assign(app, clone(value));
    else {
      const rows = (records[schema] ||= []);
      const primary = schema === RealmSchema.VersionHistory ? 'version' : 'id';
      const index = rows.findIndex((row) => row[primary] === value[primary]);
      if (index < 0) rows.push(clone(value));
      else rows[index] = clone(value);
    }
    return true;
  };
  const raw = {
    objectForPrimaryKey: (schema, id) =>
      schema === RealmSchema.KeeperApp
        ? app.id === id
          ? app
          : undefined
        : records[schema].find((row) => row.id === id),
    objects: (schema) => records[schema],
    create,
  };
  const backupState = { automaticCloudBackupByAppId: { [appId]: false } };
  const consentEpochs = new Map<string, number>();
  const recoveryDisables = new WeakMap<object, { appId: string; session: number }>();
  const scope: any = {
    ...effects,
    ...encryption,
    ...enums,
    RealmSchema,
    semver,
    Date,
    Buffer,
    Promise,
    console: { log() {}, error() {} },
    Realm: { UpdateMode: { Modified: 'modified' } },
    store: { getState: () => ({ storage: { appId: state.appId }, bhr: backupState }) },
    backupConsentEpoch: (id) => consentEpochs.get(id) || 0,
    protectBackupRecoveryConsentDisable: (action, id, session) => {
      recoveryDisables.set(action, { appId: id, session });
      return action;
    },
    markBackupMutation: () => {},
    clearVerifiedRemoteRevision: () => {},
    dbManager: {
      getObjectByIndex: () => app,
      getObjectById: raw.objectForPrimaryKey,
      getObjectByPrimaryId: (schema, key, id) => records[schema].find((row) => row[key] === id),
      getCollection: (schema) => clone(records[schema] || []),
      createObject: create,
      createObjectBulk: (schema, values) => {
        values.forEach((value) => create(schema, value));
        return true;
      },
      deleteObjectById: (schema, id) => {
        records[schema] = records[schema].filter((row) => row.id !== id);
        return true;
      },
    },
    currentBackupAccountSession: () => state.session,
    currentBackupAppId: () => (app.id === state.appId ? app.id : undefined),
    beginBackupLocalOperation: (id, intent, session) => ({ id, intent, session }),
    commitBackupLocalOperation: (operation, write) => {
      if (operation.id !== state.appId || operation.session !== state.session)
        return { committed: false };
      const beforeApp = clone(app),
        beforeRecords = clone(records);
      try {
        write(raw);
      } catch {
        Object.assign(app, beforeApp);
        Object.keys(records).forEach((name) => {
          records[name] = beforeRecords[name];
        });
        state.events.push('rollback');
        return { committed: false };
      }
      state.events.push('local commit');
      return Object.freeze({ committed: true, intent: operation.intent });
    },
    enqueueAutomaticBackupOperation: async (receipt, mutations) => {
      state.events.push('queue');
      state.queue.push({ receipt, mutations: clone(mutations), persistedVersion: app.version });
      return { updated: true, backupConfirmed: false, backupPending: true };
    },
    notifyBackupReconciliation: () => state.events.push('pending'),
    buildAutomaticAppMutation: (_payload, id) => ({
      operation: 'updateAppImage',
      body: { appId: id, version: app.version },
    }),
    buildAutomaticVaultMutation: (id, owner) => ({
      operation: 'updateVaultImage',
      body: { appId: owner, vaultId: id },
    }),
    DeviceInfo: { getVersion: () => newVersion, getBuildNumber: () => '624' },
    getApp: () => ({}),
    getMessaging: () => ({}),
    getReleaseTopic: (version) => version,
    subscribeToTopic: (_messaging, topic) => state.topics.push(['subscribe', topic]),
    unsubscribeFromTopic: (_messaging, topic) => state.topics.push(['unsubscribe', topic]),
    generateAbbreviatedOutputDescriptors: () => 'public-unit-label-origin',
    getKeyUID: (signer) => signer.id,
    hcStatusType: { HEALTH_CHECK_SUCCESSFULL: 'HEALTH_CHECK_SUCCESSFULL' },
    captureError: (error) => state.errors.push(error.message),
  };
  const dispatch = (action) => {
    if (action.type === 'setAutomaticCloudBackup') {
      const owned = recoveryDisables.get(action);
      recoveryDisables.delete(action);
      if (!owned || owned.appId !== action.payload.appId || owned.session !== state.session ||
        action.payload.enabled !== false) throw new Error('Unowned recovery consent action');
      consentEpochs.set(owned.appId, scope.backupConsentEpoch(owned.appId) + 1);
      backupState.automaticCloudBackupByAppId[owned.appId] = false;
    }
    state.actions.push(action);
    if (action.type === 'setAppId') state.appId = action.payload;
    if (action.type === 'setAppImageError' && action.payload) state.errors.push(action.payload);
  };
  scope.store.dispatch = dispatch;
  for (const name of [
    'setAppVersion',
    'setAppImageError',
    'setRecoveryDiscovery',
    'setProtectedBackupState',
    'setAutomaticCloudBackup',
    'setSeedConfirmed',
    'setBackupType',
    'uaiActioned',
    'setAppId',
    'setAppCreated',
    'addAccount',
    'autoSyncWallets',
    'saveDefaultWalletState',
    'uaiChecks',
    'loadConciergeUser',
    'loadConciergeTickets',
    'setRecoveryKeyStatus',
    'appImagerecoveryRetry',
  ])
    scope[name] = (payload) => ({ type: name, payload });
  vm.runInNewContext(
    ts.transpileModule(sourceDeclarations('src/store/sagas/upgrade.ts'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText,
    scope
  );
  const run = (name, ...args) =>
    runSaga(
      {
        getState: () => ({
          storage: { appId: state.appId },
          settings: { bitcoinNetworkType: enums.NetworkType.TESTNET },
          bhr: {},
        }),
        dispatch,
      },
      scope[name],
      ...args
    ).toPromise();
  return { state, scope, app, records, run };
}

describe('Version History retains recovery provenance with local-first upgrades', () => {
  test.each([true, false])(
    'upgrade persists version first and recovery=%s controls duplicate history',
    async (isRecovery) => {
      const f = fixture();
      expect(
        await f.run('applyUpgradeSequence', {
          previousVersion,
          newVersion,
          isRecovery,
          originBackupAccountSession: 1,
          originBackupWriteIntent: writeIntent,
        })
      ).toBe(true);
      expect(f.app.version).toBe(newVersion);
      expect(f.state.events).toEqual(['local commit', 'queue']);
      expect(f.state.queue[0].persistedVersion).toBe(newVersion);
      expect(f.state.queue[0].receipt.intent).toBe(writeIntent);
      expect(f.records.VersionHistory).toEqual(
        isRecovery
          ? []
          : [
              expect.objectContaining({
                version: '2.5.16(624)',
                title: 'Upgraded from 2.5.15 to 2.5.16',
              }),
            ]
      );
      expect(f.state.actions).toContainEqual({ type: 'setAppVersion', payload: newVersion });
    }
  );

  test('unbound history events cannot write another account', async () => {
    const f = fixture();
    expect(
      await f.run('updateVersionHistoryWorker', { payload: { previousVersion, newVersion } })
    ).toBe(false);
    expect(f.state.events).toEqual([]);
    expect(f.app.version).toBe(previousVersion);
  });

  test('failed local history transaction does not upload or advance the app version', async () => {
    const f = fixture();
    f.state.rollbackHistory = true;
    expect(
      await f.run('applyUpgradeSequence', {
        previousVersion,
        newVersion,
        originBackupWriteIntent: writeIntent,
      })
    ).toBe(false);
    expect(f.app.version).toBe(previousVersion);
    expect(f.records.VersionHistory).toEqual([]);
    expect(f.state.queue).toEqual([]);
    expect(f.state.actions).not.toContainEqual({ type: 'setAppVersion', payload: newVersion });
  });

  test.each([true, false])(
    'recovery=%s retains legacy label migration in the same local group',
    async (isRecovery) => {
      const f = fixture();
      f.records.Vault.push(
        { id: 'legacy-active-vault', archived: false, signers: [] },
        { id: 'legacy-archived-vault', archived: true, signers: [] }
      );
      f.records.Signer.push({
        id: 'public-legacy-key',
        masterFingerprint: 'AABB0011',
        type: enums.SignerType.COLDCARD,
        lastHealthCheck: '2026-09-01T00:00:00.000Z',
        signerXpubs: {},
      });
      expect(
        await f.run('applyUpgradeSequence', {
          previousVersion: '1.0.4',
          newVersion,
          isRecovery,
          originBackupWriteIntent: writeIntent,
        })
      ).toBe(true);
      expect(f.records.Tags).toEqual([
        expect.objectContaining({ ref: 'legacy-tx:0', label: 'old note' }),
      ]);
      expect(f.state.events).toEqual(['local commit', 'queue']);
      expect(f.state.queue[0].mutations.map((mutation) => mutation.operation)).toEqual([
        'updateAppImage',
        'updateVaultImage',
        'updateVaultImage',
        'modifyLabels',
      ]);
      expect(f.state.queue[0].mutations[2].body.vaultId).toBe('legacy-archived-vault');
      expect(f.records.Signer[0].healthCheckDetails).toEqual([
        { type: 'HEALTH_CHECK_SUCCESSFULL', actionDate: '2026-09-01T00:00:00.000Z' },
      ]);
      expect(f.records.VersionHistory).toHaveLength(isRecovery ? 0 : 1);
    }
  );
});

async function recoveryFixture(backupVersion: string) {
  const mnemonic = bip39.entropyToMnemonic('00000000000000000000000000000000');
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const id = require('crypto').createHash('sha256').update(seed).digest('hex');
  const f = fixture(id);
  const key = encryption.generateEncryptionKey(seed.toString('hex'));
  const root = bip32.fromSeed(seed, bitcoinJS.networks.testnet);
  const derived = root.derivePath("m/48'/1'/0'/2'");
  const recoverySigner = {
    id: 'recovery',
    signerXpubs: {
      fixture: [
        {
          xpub: derived.neutered().toBase58(),
          xpriv: derived.toBase58(),
          derivationPath: "m/48'/1'/0'/2'",
        },
      ],
    },
  };
  const requestedUpgrades = [];
  Object.assign(f.scope, {
    bip39,
    crypto: require('crypto'),
    BIP85,
    prepareRecoveryImage,
    prepareRecoverySourceImage,
    hasRecoveryRecords,
    validateProtectedRecoveryMetadata: image.validateProtectedRecoveryMetadata,
    readProtectedBackup: async () => { throw new Error('This unit fixture selects only the older copy'); },
    config: { BIP85_IMAGE_ENCRYPTIONKEY_DERIVATION_PATH: "m/83696968'/128169'/64'/0'" },
    WalletUtilities: {
      getFingerprintFromSeed: (value) =>
        bip32.fromSeed(value).fingerprint.toString('hex').toUpperCase(),
    },
    SubscriptionTier: { L1: 'L1', L3: 'L3' },
    AppSubscriptionLevel: { L1: 1, L3: 3 },
    BackupType: { SEED: 'SEED' },
    BackupAction: { SEED_BACKUP_CONFIRMED: 'confirmed' },
    pauseBackup: image.pauseBackup,
    uaiType: {},
    moment: () => ({ unix: () => 1 }),
    KEY_MANAGEMENT_VERSION: '1.1.9',
    setupRecoveryKeySigningKey: () => recoverySigner,
    addSigningDeviceWorker: ({ payload }) => {
      payload.signers.forEach((record) =>
        f.scope.dbManager.createObject(RealmSchema.Signer, record)
      );
      return true;
    },
    Relay: {
      getAppImage: async () => ({
        appImage: {
          appId: id,
          version: backupVersion,
          wallets: {
            test: encryption.encrypt(
              key,
              JSON.stringify({ id: 'test-wallet', entityKind: enums.EntityKind.WALLET })
            ),
          },
          signers: {},
          nodes: [],
        },
        allVaultImages: [],
        labels: [],
      }),
    },
  });
  const actualUpgrade = f.scope.applyUpgradeSequence;
  f.scope.applyUpgradeSequence = function* (action) {
    requestedUpgrades.push(clone(action));
    return yield* actualUpgrade(action);
  };
  vm.runInNewContext(
    ts.transpileModule(
      sourceDeclarations('src/store/sagas/bhr.ts', [
        'getAppImageWorker',
        'latestRecoveryReadRequest',
        'recoverApp',
        'writeRecoveredObject',
      ]),
      {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
      }
    ).outputText,
    f.scope
  );
  await f.run('getAppImageWorker', { payload: { primaryMnemonic: mnemonic,
    selection: { source: 'legacy-older', olderCopyConfirmed: true } } });
  return { writes: f.records.VersionHistory, requestedUpgrades, errors: f.state.errors };
}

test.each(['2.5.15', '2.5.16'])(
  'recovery of encrypted backup %s finishes with one recovered history entry',
  async (backupVersion) => {
    const { writes, requestedUpgrades, errors } = await recoveryFixture(backupVersion);
    expect(errors).toEqual([]);
    expect(writes).toEqual([
      expect.objectContaining({ version: '2.5.16(624)', title: 'Recovered Wallet' }),
    ]);
    expect(requestedUpgrades).toEqual(
      backupVersion === '2.5.15'
        ? [
            {
              previousVersion: backupVersion,
              newVersion,
              isRecovery: true,
              originBackupAccountSession: 1,
            },
          ]
        : []
    );
  }
);
