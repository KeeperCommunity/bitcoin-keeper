import NativeConfig from 'react-native-config';
import DeviceInfo from 'react-native-device-info';
import { NetworkType } from 'src/services/wallets/enums';
import { changeBitcoinNetworkWorker } from 'src/store/sagas/settings';
import { getCosignerDetails } from 'src/services/wallets/factories/WalletFactory';

jest.mock('react-native-config', () => ({
  KEEPER_EMPTY_WALLET_ONBOARDING: 'true',
  KEEPER_PREVIEW: 'true',
  KEEPER_PREVIEW_TESTNET_ONLY: 'true',
}));

jest.mock('react-native-device-info', () => ({
  getBundleId: jest.fn(() => 'io.hexawallet.keeper.recoverablepreview'),
}));

jest.mock('src/services/electrum/node', () => ({
  __esModule: true,
  default: { getAllNodes: jest.fn(() => []) },
}));

jest.mock('src/services/electrum/client', () => ({
  __esModule: true,
  default: { setActivePeer: jest.fn(), connect: jest.fn() },
}));

jest.mock('src/storage/realm/dbManager', () => ({
  __esModule: true,
  default: { createObjectBulk: jest.fn(), getObjectByIndex: jest.fn() },
}));

jest.mock('src/services/wallets/operations/utils', () => ({
  __esModule: true,
  default: { getDerivationPath: jest.fn(() => "m/84'/1'/0'") },
}));

jest.mock('src/services/wallets/factories/WalletFactory', () => ({
  getCosignerDetails: jest.fn(),
}));

jest.mock('src/hardware/signerSetup', () => ({ setupKeeperSigner: jest.fn() }));
jest.mock('src/store/sagas/wallets', () => ({ addNewWalletsWorker: function* () {} }));
jest.mock('src/utils/AppIconWrapper', () => ({ AppIconWrapper: jest.fn() }));

const reachWalletDecision = (defaultWalletCreatedByAppId) => {
  const callback = jest.fn();
  const generator: Generator<any, any, any> = changeBitcoinNetworkWorker({
    payload: { network: NetworkType.TESTNET, callback },
  });
  generator.next(); // set network
  generator.next(); // fetch fees
  generator.next(); // select active network
  generator.next({ bitcoinNetworkType: NetworkType.TESTNET }); // add node
  generator.next(); // connect Electrum
  generator.next(); // load KeeperApp
  generator.next({ id: 'app-id', primaryMnemonic: 'recovery-key' }); // select wallet state
  return { generator, callback, effect: generator.next({ defaultWalletCreatedByAppId }) };
};

describe('network switch default wallet gate', () => {
  afterEach(() => {
    (NativeConfig as any).KEEPER_EMPTY_WALLET_ONBOARDING = 'true';
    (DeviceInfo.getBundleId as jest.Mock).mockReturnValue(
      'io.hexawallet.keeper.recoverablepreview'
    );
  });

  it('does not create a Mobile Wallet when switching an intentionally empty preview', () => {
    const { callback, effect } = reachWalletDecision({});
    expect(effect.done).toBe(true);
    expect(callback).toHaveBeenCalledWith(true);
  });

  it('preserves the normal switch behavior when the gate is absent', () => {
    (NativeConfig as any).KEEPER_EMPTY_WALLET_ONBOARDING = undefined;
    const { effect } = reachWalletDecision({
      'app-id': { [NetworkType.TESTNET]: false, [NetworkType.MAINNET]: false },
    });
    expect(effect.done).toBe(false);
    expect((effect.value as any).type).toBe('CALL');
    expect((effect.value as any).payload.fn).toBe(getCosignerDetails);
  });
});
