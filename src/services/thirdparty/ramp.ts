import Relay from '../backend/Relay';
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
const app: any = dbManager.getObjectByIndex(RealmSchema.KeeperApp);

export const fetchRampReservation = async (userAddress: string) => {
  try {
    const res = await Relay.getRampUrl({
      userAddress,
      appId: app.id,
      publicKey: app.publicId,
      swapAsset: 'BTC',
      flow: 'ONRAMP',
    });
    return res.url;
  } catch (error) {
    console.log('error generating Ramp link ', error);
    return {
      error,
    };
  }
};

export const fetchSellBtcLink = async () => {
  try {
    const res = await Relay.getRampUrl({
      userAddress: '',
      appId: app.id,
      publicKey: app.publicId,
      swapAsset: 'BTC',
      flow: 'OFFRAMP',
    });
    return res.url;
  } catch (error) {
    console.log('error generating Ramp link ', error);
    return {
      error,
    };
  }
};

export const fetchBuyUsdtLink = async (userAddress: string) => {
  try {
    const res = await Relay.getRampUrl({
      userAddress,
      appId: app.id,
      publicKey: app.publicId,
      swapAsset: 'TRON_USDT',
      flow: 'ONRAMP',
    });
    return res.url;
  } catch (error) {
    console.log('error generating Ramp link ', error);
    return {
      error,
    };
  }
};

export const fetchSellUsdtLink = async () => {
  try {
    const res = await Relay.getRampUrl({
      userAddress: '',
      appId: app.id,
      publicKey: app.publicId,
      swapAsset: 'TRON_USDT',
      flow: 'OFFRAMP',
    });
    return res.url;
  } catch (error) {
    console.log('error generating Ramp link ', error);
    return {
      error,
    };
  }
};
