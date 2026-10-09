import { call, put, select } from 'redux-saga/effects';
import { createWatcher } from '../utilities';
import { setBitcoinNetwork, setSubscription, setThemeMode } from '../reducers/settings';
import { CHANGE_BITCOIN_NETWORK, SET_SUBSCRIPTION } from '../sagaActions/settings';
import Node from 'src/services/electrum/node';
import { fetchFeeRates } from '../sagaActions/send_and_receive';
import { DerivationPurpose, NetworkType, WalletType } from 'src/services/wallets/enums';
import {
  predefinedMainnetNodes,
  predefinedTestnetNodes,
} from 'src/services/electrum/predefinedNodes';
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import { RootState } from '../store';
import ElectrumClient from 'src/services/electrum/client';
import WalletUtilities from 'src/services/wallets/operations/utils';
import { getCosignerDetails } from 'src/services/wallets/factories/WalletFactory';
import { setupKeeperSigner } from 'src/hardware/signerSetup';
import { addSigningDevice } from '../sagaActions/vaults';
import { addNewWalletsWorker, NewWalletInfo } from './wallets';
import { SubscriptionTier } from 'src/models/enums/SubscriptionTier';
import { AppIconWrapper } from 'src/utils/AppIconWrapper';
import ThemeMode from 'src/models/enums/ThemeMode';
import { updateDefaultWalletCreatedByAppId } from '../reducers/account';
import NativeConfig from 'react-native-config';
import DeviceInfo from 'react-native-device-info';
import { shouldAutomaticallyCreateMobileWallet } from 'src/services/wallets/operations/recoverable/emptyWalletOnboarding';

export function* changeBitcoinNetworkWorker({ payload }) {
  let activeNode;
  const { network, callback } = payload;
  try {
    try {
      activeNode = Node.getAllNodes().find((node) => node.isConnected);
    } catch (error) {}

    yield put(setBitcoinNetwork(network));
    yield put(fetchFeeRates());
    if (activeNode) {
      yield call(Node.disconnect, activeNode);
    }
    const bitcoinNetworkType = yield select(
      (state: RootState) => state.settings.bitcoinNetworkType
    );

    // Add default nodes if not exists and connect
    if (!Node.getAllNodes().filter((node) => node.networkType === bitcoinNetworkType).length)
      yield call(
        dbManager.createObjectBulk,
        RealmSchema.NodeConnect,
        network === NetworkType.TESTNET ? predefinedTestnetNodes : predefinedMainnetNodes
      );

    ElectrumClient.setActivePeer(
      Node.getAllNodes().filter((node) => node.networkType === bitcoinNetworkType)
    );
    yield call(ElectrumClient.connect);

    const { primaryMnemonic, id } = yield call(dbManager.getObjectByIndex, RealmSchema.KeeperApp);

    // Create default wallet and signer if not created already
    const { defaultWalletCreatedByAppId } = yield select((state: RootState) => state.account);
    const defaultWalletCreated = defaultWalletCreatedByAppId[id];
    if (
      shouldAutomaticallyCreateMobileWallet({
        emptyWalletFlag: NativeConfig.KEEPER_EMPTY_WALLET_ONBOARDING,
        previewFlag: NativeConfig.KEEPER_PREVIEW,
        testnetOnlyFlag: NativeConfig.KEEPER_PREVIEW_TESTNET_ONLY,
        bundleId: DeviceInfo.getBundleId(),
      }) &&
      !defaultWalletCreated[bitcoinNetworkType]
    ) {
      const cosigner = yield call(getCosignerDetails, primaryMnemonic, 0);
      const hw = setupKeeperSigner(cosigner);
      if (hw) {
        yield put(addSigningDevice([hw.signer]));
      }
      const defaultWallet: NewWalletInfo = {
        walletType: WalletType.DEFAULT,
        walletDetails: {
          name: 'Mobile Wallet',
          description: '',
          instanceNum: 0,
          derivationPath: WalletUtilities.getDerivationPath(
            false,
            bitcoinNetworkType,
            0,
            DerivationPurpose.BIP84
          ),
        },
      };
      yield call(addNewWalletsWorker, { payload: [defaultWallet] });
      yield put(updateDefaultWalletCreatedByAppId({ appId: id, networkType: bitcoinNetworkType }));
    }
    if (callback) callback(true);
  } catch (error) {
    console.log('🚀 ~changeBitcoinNetworkWorker ~ error:', error);
    if (callback) callback(false);
  }
}

function* setSubscriptionWorker({ payload }) {
  try {
    if (payload === SubscriptionTier.L4) {
      AppIconWrapper().changeToKeeperPrivateIcon();
    } else {
      AppIconWrapper().changeToDefaultIcon();
      yield put(setThemeMode(ThemeMode.LIGHT));
    }
    yield put(setSubscription(payload));
  } catch (error) {
    console.log('🚀 ~setSubscriptionWorker ~ error:', error);
  }
}

export const changeBitcoinNetworkWatcher = createWatcher(
  changeBitcoinNetworkWorker,
  CHANGE_BITCOIN_NETWORK
);

export const setSubscriptionWatcher = createWatcher(setSubscriptionWorker, SET_SUBSCRIPTION);
