import fs from 'fs';
import path from 'path';
import { call, put, select } from 'redux-saga/effects';
import ts from 'typescript';
import vm from 'vm';
import semver from 'semver';
import { applyUpgradeSequence, updateVersionHistoryWorker } from 'src/store/sagas/upgrade';
import { updateVersionHistory } from 'src/store/sagaActions/upgrade';
import { RealmSchema } from 'src/storage/realm/enum';
import dbManager from 'src/storage/realm/dbManager';
import Relay from 'src/services/backend/Relay';
import { setAppVersion } from 'src/store/reducers/storage';

jest.mock('src/storage/realm/dbManager', () => ({
  getObjectByIndex: jest.fn(),
  createObject: jest.fn(),
}));
jest.mock('src/services/backend/Relay', () => ({ updateAppImage: jest.fn() }));
jest.mock('src/services/backend/SigningServer', () => ({}));
jest.mock('src/utils/service-utilities/utils', () => ({}));
jest.mock('src/services/wallets/factories/WalletFactory', () => ({}));
jest.mock('src/utils/service-utilities/encryption', () => ({}));
jest.mock('src/utils/utilities', () => ({}));
jest.mock('src/services/wallets/operations/utils', () => ({}));
jest.mock('src/store/sagas/bhr', () => ({}));
jest.mock('@react-native-firebase/app', () => ({ getApp: jest.fn() }));
jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(),
  subscribeToTopic: jest.fn(),
  unsubscribeFromTopic: jest.fn(),
}));
jest.mock('react-native-device-info', () => ({ getBuildNumber: () => '624' }));

const previousVersion = '2.5.15';
const newVersion = '2.5.16';

function writeHistory(action) {
  const worker = updateVersionHistoryWorker(action);
  expect(worker.next().value).toEqual(call(dbManager.getObjectByIndex, RealmSchema.KeeperApp));
  expect(worker.next({ id: 'test-app' } as any).value).toEqual(
    call(Relay.updateAppImage, { appId: 'test-app', version: newVersion })
  );
  const write = worker.next({} as any).value as any;
  expect(write.payload.fn).toBe(dbManager.createObject);
  expect(write.payload.args[0]).toBe(RealmSchema.VersionHistory);
  expect(worker.next().done).toBe(true);
  return write.payload.args[1];
}

function recoverWithoutDuplicateHistory(action) {
  const worker = updateVersionHistoryWorker(action);
  expect(worker.next().value).toEqual(call(dbManager.getObjectByIndex, RealmSchema.KeeperApp));
  expect(worker.next({ id: 'test-app' } as any).value).toEqual(
    call(Relay.updateAppImage, { appId: 'test-app', version: newVersion })
  );
  expect(worker.next({} as any).done).toBe(true);
}

describe('Version History retains recovery provenance through required upgrades', () => {
  test.each([true, false])('upgrade handles recovery=%s without duplicate history', (isRecovery) => {
    const upgrade = applyUpgradeSequence({ previousVersion, newVersion, isRecovery });
    expect(upgrade.next().value).toEqual(put(setAppVersion(newVersion)));
    const history = upgrade.next().value as any;
    expect(history).toEqual(put(updateVersionHistory(previousVersion, newVersion, isRecovery)));
    if (isRecovery) {
      recoverWithoutDuplicateHistory(history.payload.action);
    } else {
      const record = writeHistory(history.payload.action);
      expect(record.version).toBe('2.5.16(624)');
      expect(record.title).toBe('Upgraded from 2.5.15 to 2.5.16');
    }
    expect(upgrade.next().done).toBe(true);
  });

  test('older callers still record ordinary upgrades by default', () => {
    expect(writeHistory({ payload: { previousVersion, newVersion } }).title).toBe(
      'Upgraded from 2.5.15 to 2.5.16'
    );
  });

  test('recovery does not skip any of the legacy migrations', () => {
    const ordinary = [...applyUpgradeSequence({ previousVersion: '1.0.4', newVersion })];
    const recovered = [
      ...applyUpgradeSequence({ previousVersion: '1.0.4', newVersion, isRecovery: true }),
    ];
    expect(recovered.slice(0, -1)).toEqual(ordinary.slice(0, -1));
    expect(recovered.length).toBeGreaterThan(3);
  });
});

// Execute the real recovery orchestration with disposable in-memory dependencies.
// This verifies call-site provenance; it does not claim native Realm or wallet recovery QA.
function recoveryFixture(backupVersion: string) {
  const source = ts.createSourceFile(
    'bhr.ts',
    fs.readFileSync(path.join(process.cwd(), 'src/store/sagas/bhr.ts'), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const functions = source.statements.filter(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      ['getAppImageWorker', 'recoverApp', 'writeRecoveredObject'].includes(node.name?.text)
  );
  const writes = [];
  const recoveryUpgrades = [];
  const errors = [];
  const scope: any = {
    call,
    put,
    select,
    semver,
    console,
    RealmSchema,
    applyUpgradeSequence,
    DeviceInfo: { getVersion: () => newVersion, getBuildNumber: () => '624' },
    bip39: { validateMnemonic: () => true, mnemonicToSeedSync: () => Buffer.from('fixture') },
    crypto: require('crypto'),
    BIP85: { bip39MnemonicToEntropy: () => Buffer.from('fixture') },
    config: { BIP85_IMAGE_ENCRYPTIONKEY_DERIVATION_PATH: 'fixture' },
    generateEncryptionKey: () => 'fixture',
    decrypt: (_key, content) => content,
    prepareRecoveryImage: (_key, _appId, image) => ({
      wallets: Object.fromEntries(
        Object.entries(image.wallets).map(([id, content]) => [id, JSON.parse(content as string)])
      ),
      signers: {},
      vaults: {},
      nodes: {},
      labels: {},
    }),
    WalletUtilities: { getFingerprintFromSeed: () => 'AAAAAAAA' },
    SubscriptionTier: { L1: 'L1', L3: 'L3' },
    AppSubscriptionLevel: { L1: 1, L3: 3 },
    BackupType: { SEED: 'SEED' },
    EntityKind: { USDT_WALLET: 'USDT_WALLET' },
    BackupAction: { SEED_BACKUP_CONFIRMED: 'confirmed' },
    pauseBackup: () => {},
    NetworkType: { MAINNET: 'MAINNET', TESTNET: 'TESTNET' },
    uaiType: {},
    moment: () => ({ unix: () => 1 }),
    setupRecoveryKeySigningKey: () => ({
      id: 'recovery',
      signerXpubs: {
        fixture: [
          {
            xpub: 'fixture-public',
            xpriv: 'fixture-private',
            derivationPath: 'fixture-path',
          },
        ],
      },
    }),
    getKeyUID: (signer) => signer.id,
    addSigningDeviceWorker: () => {},
    dbManager: {
      createObject: (schema, record) => {
        if (schema === RealmSchema.VersionHistory) writes.push(record);
        return true;
      },
      createObjectBulk: () => {},
      getCollection: (schema) =>
        schema === RealmSchema.Signer
          ? [
              {
                id: 'recovery',
                signerXpubs: {
                  fixture: [
                    {
                      xpub: 'fixture-public',
                      xpriv: 'fixture-private',
                      derivationPath: 'fixture-path',
                    },
                  ],
                },
              },
            ]
          : [],
    },
    Relay: {
      getAppImage: () => ({
        appImage: {
          appId: 'disposable',
          version: backupVersion,
          wallets: { test: JSON.stringify({ id: 'test-wallet' }) },
          signers: {},
          nodes: [],
        },
      }),
      updateAppImage: () => ({}),
    },
  };
  for (const name of [
    'setAppImageError',
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
    'setRecoveryKeyBackedUp',
    'setRecoveryKeyStatus',
    'appImagerecoveryRetry',
  ]) {
    scope[name] = (payload) => ({ type: name, payload });
  }
  vm.runInNewContext(
    ts.transpileModule(functions.map((node) => node.getText(source)).join('\n'), {
      compilerOptions: { target: ts.ScriptTarget.ES2019 },
    }).outputText,
    scope
  );
  function drive(generator) {
    let result = generator.next();
    while (!result.done) {
      const effect = result.value;
      let response;
      if (effect.type === 'SELECT') response = { bitcoinNetworkType: 'TESTNET' };
      if (effect.type === 'CALL') {
        const { fn, args } = effect.payload;
        if (fn === applyUpgradeSequence) recoveryUpgrades.push(args[0]);
        response = fn(...args);
        if (response?.next) response = drive(response);
      }
      if (effect.type === 'PUT') {
        const action = effect.payload.action;
        if (action.type === 'setAppImageError' && action.payload) errors.push(action.payload);
        if (action.type === 'UPDATE_VERSION_HISTORY') {
          if (action.payload.isRecovery) recoverWithoutDuplicateHistory(action);
          else writes.push(writeHistory(action));
        }
      }
      result = generator.next(response);
    }
    return result.value;
  }
  drive(scope.getAppImageWorker({ payload: { primaryMnemonic: 'disposable mocked fixture' } }));
  return { writes, recoveryUpgrades, errors };
}

test.each(['2.5.15', '2.5.16'])(
  'recovery of backup %s finishes with one recovered entry',
  (backupVersion) => {
    const { writes, recoveryUpgrades, errors } = recoveryFixture(backupVersion);
    expect(errors).toEqual([]);
    expect(writes).toEqual([
      expect.objectContaining({
        version: '2.5.16(624)',
        title: 'Recovered Wallet',
      }),
    ]);
    expect(recoveryUpgrades).toEqual(
      backupVersion === '2.5.15'
        ? [{ previousVersion: backupVersion, newVersion, isRecovery: true }]
        : []
    );
  }
);
