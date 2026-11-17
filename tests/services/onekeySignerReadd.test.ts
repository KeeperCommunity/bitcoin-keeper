import { call } from 'redux-saga/effects';
import { NetworkType, SignerType, XpubTypes } from 'src/services/wallets/enums';
import { Signer } from 'src/services/wallets/interfaces/vault';
import { RealmSchema } from 'src/storage/realm/enum';
import dbManager from 'src/storage/realm/dbManager';
import { addSigningDeviceWorker } from 'src/store/sagas/wallets';
import {
  getOneKeyDeviceBindings,
  mergeOneKeyDeviceBindings,
} from 'src/services/onekeyBle/deviceConstants';
import { updateAppImageWorker } from 'src/store/sagas/bhr';
import BIP32Factory from 'bip32';
import ecc from 'src/services/wallets/operations/taproot-utils/noble_ecc';
import WalletUtilities from 'src/services/wallets/operations/utils';
import { relaySignersUpdateFail } from 'src/store/reducers/bhr';

jest.mock('src/store/utilities', () => ({ createWatcher: jest.fn() }));
jest.mock('src/store/store', () => ({ store: { getState: jest.fn() } }));
jest.mock('src/storage/realm/dbManager', () => ({ getCollection: jest.fn() }));
jest.mock('src/store/sagas/bhr', () => ({ updateAppImageWorker: jest.fn() }));
jest.mock('src/utils/utilities', () => ({
  checkSignerAccountsMatch: () => true,
  getKeyUID: (signer) => signer.masterFingerprint,
}));
jest.mock('src/services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('src/services/backend/Relay', () => ({}));
jest.mock('src/services/backend/SigningServer', () => ({}));
jest.mock('src/services/wallets/operations', () => ({}));
jest.mock('src/services/wallets/operations/utils', () =>
  jest.requireActual('src/services/wallets/operations/utils')
);
jest.mock('src/services/wallets/factories/VaultFactory', () => ({}));
jest.mock('src/services/wallets/factories/WalletFactory', () => ({}));
jest.mock('src/storage/realm/utils', () => ({}));
jest.mock('src/utils/service-utilities/encryption', () => ({}));
jest.mock('src/services/electrum/client', () => ({}));
jest.mock('src/screens/SigningDevices/SetupCollaborativeWallet', () => ({}));
jest.mock('src/store/sagas/network', () => ({}));
jest.mock('src/store/sagas/utxos', () => ({}));
jest.mock('src/utils/service-utilities/utils', () => ({}));
jest.mock('src/services/wallets/operations/dustClassification', () => ({}));

test('re-adding OneKey persists the new BLE connection ID while preserving existing metadata', () => {
  const existingSigner = {
    type: SignerType.ONEKEY,
    masterFingerprint: '1234ABCD',
    networkType: NetworkType.MAINNET,
    signerName: 'OneKey Pro',
    signerDescription: 'Old BLE name',
    signerXpubs: { [XpubTypes.P2WPKH]: [{ xpub: 'same-account-xpub' }] },
    extraData: {
      bleConnectId: 'old-connect-id',
      instanceNumber: 7,
      oneKeyDevices: [{ serialNo: 'PRO2-SERIAL', bleConnectId: 'old-connect-id', name: 'Pro 2' }],
    },
  } as unknown as Signer;
  const readdedSigner = {
    ...existingSigner,
    signerDescription: 'New BLE name',
    extraData: {
      bleConnectId: 'new-connect-id',
      oneKeyDevices: [{ serialNo: 'PRO2-SERIAL', bleConnectId: 'new-connect-id', name: 'Pro 2' }],
    },
  } as unknown as Signer;
  const worker: Generator<any, void, any> = addSigningDeviceWorker({
    payload: { signers: [readdedSigner] },
  });
  worker.next(); // Merge matching keys.
  worker.next(); // Read network settings.
  expect(worker.next({ bitcoinNetworkType: NetworkType.MAINNET }).value).toEqual(
    call(dbManager.getCollection, RealmSchema.Signer)
  );
  worker.next([existingSigner]); // Set loading state.
  const persistence = worker.next().value as ReturnType<typeof call>;
  expect(persistence.payload.fn).toBe(updateAppImageWorker);
  const persistedSigners = persistence.payload.args[0].payload.signers;
  expect(persistedSigners).toHaveLength(1);
  expect(persistedSigners[0]).toMatchObject({
    signerDescription: 'New BLE name',
    extraData: { bleConnectId: 'new-connect-id', instanceNumber: 7 },
  });
  expect(existingSigner.extraData.bleConnectId).toBe('old-connect-id');
});

test('different serials sharing the same key remain separate device bindings', () => {
  const signer = {
    extraData: {
      bleConnectId: 'pro-address',
      oneKeyDevices: [{ serialNo: 'PRO', bleConnectId: 'pro-address', name: 'Pro' }],
    },
  };
  const devices = mergeOneKeyDeviceBindings(signer, [
    { serialNo: 'PRO2', bleConnectId: 'pro2-address', name: 'Pro 2' },
  ]);
  expect(devices.map((device) => device.serialNo)).toEqual(['PRO', 'PRO2']);
  expect(signer.extraData.oneKeyDevices).toHaveLength(1);
});

test('legacy device information is preserved until its serial can be verified', () => {
  const signer = { signerDescription: 'Pro', extraData: { bleConnectId: 'pro-address' } };
  const added = mergeOneKeyDeviceBindings(signer, [
    { serialNo: 'PRO2', bleConnectId: 'pro2-address', name: 'Pro 2' },
  ]);
  expect(added).toEqual([
    { bleConnectId: 'pro-address', name: 'Pro' },
    { serialNo: 'PRO2', bleConnectId: 'pro2-address', name: 'Pro 2' },
  ]);
  const upgraded = mergeOneKeyDeviceBindings({ extraData: { oneKeyDevices: added } }, [
    { serialNo: 'PRO', bleConnectId: 'pro-address', name: 'Pro' },
  ]);
  expect(upgraded).toHaveLength(2);
  expect(upgraded[0].serialNo).toBe('PRO');
  expect(getOneKeyDeviceBindings(signer)[0].serialNo).toBeUndefined();
});

test('importing a second physical device preserves the original device and preferred connection', () => {
  const existing = {
    type: SignerType.ONEKEY,
    masterFingerprint: '1234ABCD',
    networkType: NetworkType.MAINNET,
    signerName: 'My key',
    signerDescription: 'Pro',
    signerXpubs: { [XpubTypes.P2WPKH]: [{ xpub: 'same-account-xpub' }] },
    extraData: {
      bleConnectId: 'pro-address',
      oneKeyDevices: [{ serialNo: 'PRO', bleConnectId: 'pro-address', name: 'Pro' }],
    },
  } as unknown as Signer;
  const incoming = {
    ...existing,
    signerName: 'Pro 2',
    extraData: {
      bleConnectId: 'pro2-address',
      oneKeyDevices: [{ serialNo: 'PRO2', bleConnectId: 'pro2-address', name: 'Pro 2' }],
    },
  } as unknown as Signer;
  const worker: Generator<any, void, any> = addSigningDeviceWorker({
    payload: { signers: [incoming] },
  });
  worker.next();
  worker.next();
  worker.next({ bitcoinNetworkType: NetworkType.MAINNET });
  worker.next([existing]);
  const write = worker.next().value as ReturnType<typeof call>;
  const saved = write.payload.args[0].payload.signers[0];
  expect(saved.signerName).toBe('My key');
  expect(saved.signerDescription).toContain('Pro 2');
  expect(saved.extraData.bleConnectId).toBe('pro-address');
  expect(saved.extraData.oneKeyDevices.map((device) => device.serialNo)).toEqual(['PRO', 'PRO2']);
});

test.each([NetworkType.MAINNET, NetworkType.TESTNET])(
  're-adds an existing %s SLIP-132 key but rejects a different key',
  (networkType) => {
    const network = WalletUtilities.getNetworkByType(networkType);
    const coinType = networkType === NetworkType.TESTNET ? 1 : 0;
    const derivationPath = `m/84'/${coinType}'/0'`;
    const bip32 = BIP32Factory(ecc);
    const key = (seedByte: number, version = network.bip32.public) =>
      bip32
        .fromSeed(Buffer.alloc(32, seedByte), {
          ...network,
          bip32: { ...network.bip32, public: version },
        })
        .derivePath(derivationPath)
        .neutered()
        .toBase58();

    for (const seedByte of [1, 2]) {
      const existing = {
        type: SignerType.ONEKEY,
        masterFingerprint: '1234ABCD',
        networkType,
        signerXpubs: {
          [XpubTypes.P2WPKH]: [
            { derivationPath, xpub: key(1, coinType ? 0x045f1cf6 : 0x04b24746) },
          ],
        },
        extraData: { bleConnectId: 'old-id' },
      } as unknown as Signer;
      const incoming = {
        ...existing,
        signerXpubs: { [XpubTypes.P2WPKH]: [{ derivationPath, xpub: key(seedByte) }] },
        extraData: { bleConnectId: 'new-id' },
      } as unknown as Signer;
      const worker: Generator<any, void, any> = addSigningDeviceWorker({
        payload: { signers: [incoming] },
      });
      worker.next();
      worker.next();
      worker.next({ bitcoinNetworkType: networkType });
      const firstResult = worker.next([existing]).value;
      const result = seedByte === 1 ? worker.next().value : firstResult;
      if (seedByte === 1) {
        expect(result.payload.fn).toBe(updateAppImageWorker);
        expect(
          result.payload.args[0].payload.signers[0].signerXpubs[XpubTypes.P2WPKH][0].xpub
        ).toBe(key(1));
      } else {
        expect(result.payload.action).toEqual(
          relaySignersUpdateFail(
            'OneKey public keys do not match the existing key. The device was not added.'
          )
        );
      }
    }
  }
);
