import NativeConfig from 'react-native-config';
import DeviceInfo from 'react-native-device-info';
import { NetworkType } from 'src/services/wallets/enums';
import { setupKeeperAppWorker } from 'src/store/sagas/storage';
import { addNewWalletsWorker, addSigningDeviceWorker } from 'src/store/sagas/wallets';

jest.mock('react-native-config', () => ({
  KEEPER_EMPTY_WALLET_ONBOARDING: 'true',
  KEEPER_PREVIEW: 'true',
  KEEPER_PREVIEW_TESTNET_ONLY: 'true',
}));

jest.mock('react-native-device-info', () => ({
  getBundleId: jest.fn(() => 'io.hexawallet.keeper.recoverablepreview'),
  getVersion: jest.fn(() => '2.5.13'),
  getBuildNumber: jest.fn(() => '1'),
}));

jest.mock('src/hardware/signerSetup', () => ({
  setupRecoveryKeySigningKey: jest.fn(() => ({ id: 'recovery-key-signer' })),
}));

jest.mock('src/services/wallets/operations/utils', () => ({
  __esModule: true,
  default: { getDerivationPath: jest.fn(() => "m/84'/1'/0'") },
}));

jest.mock('src/store/sagas/wallets', () => ({
  addNewWalletsWorker: function* addNewWalletsWorker() {},
  addSigningDeviceWorker: function* addSigningDeviceWorker() {},
}));

jest.mock('src/services/backend/Relay', () => ({
  __esModule: true,
  default: { createNewApp: jest.fn() },
}));

jest.mock('src/services/backend/SigningServer', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('src/storage/realm/dbManager', () => ({
  __esModule: true,
  default: { getObjectByIndex: jest.fn(), createObject: jest.fn() },
}));

const recoveryKey =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const nextAfterAppStored = () => {
  const generator: Generator<any, any, any> = setupKeeperAppWorker({
    payload: { appName: 'Preview', fcmToken: '' },
  });
  generator.next(); // select network
  generator.next({ bitcoinNetworkType: NetworkType.TESTNET }); // load existing app
  generator.next({
    id: 'app-id',
    publicId: 'public-id',
    primaryMnemonic: recoveryKey,
    primarySeed: Buffer.alloc(64, 1),
    imageEncryptionKey: 'encryption-key',
  }); // create app with Relay
  generator.next({ created: true }); // store KeeperApp
  generator.next(); // add account
  return generator.next().value;
};

describe('Keeper app setup default wallet gate', () => {
  afterEach(() => {
    (NativeConfig as any).KEEPER_EMPTY_WALLET_ONBOARDING = 'true';
    (DeviceInfo.getBundleId as jest.Mock).mockReturnValue(
      'io.hexawallet.keeper.recoverablepreview'
    );
  });

  it('omits automatic wallet creation in the isolated preview', () => {
    const effect = nextAfterAppStored() as any;
    expect(effect.type).toBe('CALL');
    expect(effect.payload.fn).toBe(addSigningDeviceWorker);
  });

  it('retains the normal Keeper wallet creation effect when the gate is absent', () => {
    (NativeConfig as any).KEEPER_EMPTY_WALLET_ONBOARDING = undefined;
    const effect = nextAfterAppStored() as any;
    expect(effect.type).toBe('CALL');
    expect(effect.payload.fn).toBe(addNewWalletsWorker);
  });
});
