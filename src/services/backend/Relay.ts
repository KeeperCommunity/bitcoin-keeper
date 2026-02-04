import { NetworkType } from 'src/services/wallets/enums';
import { SubScriptionPlan } from 'src/models/interfaces/Subscription';
import axios, { AxiosResponse } from 'axios';
import { AverageTxFeesByNetwork } from 'src/services/wallets/interfaces';
import config from 'src/utils/service-utilities/config';
import RestClient from '../rest/RestClient';
import { captureError } from '../sentry';
import { Platform } from 'react-native';

const { HEXA_ID, RELAY } = config;
const TOR_ENDPOINT = 'https://check.torproject.org/api/ip';

interface SignerChange {
  oldSignerId: string;
  newSignerId: string;
  newSignerDetails: string;
}

export default class Relay {
  public static updateFCMTokens = async (
    appId: string,
    FCMs: string[]
  ): Promise<{
    updated: boolean;
  }> => {
    try {
      let res;
      try {
        res = await RestClient.post(`${RELAY}updateFCMTokens`, {
          appID: appId,
          FCMs,
        });
      } catch (err) {
        if (err.response) throw new Error(err.response.data.err);
        if (err.code) throw new Error(err.code);
      }
      return res.data || res.json;
    } catch (err) {
      console.log('err', err);
      throw new Error('Failed to update FCM token');
    }
  };

  public static updateSubscription = async (
    id: string,
    appID: string,
    data: object
  ): Promise<{
    updated: boolean;
    level: number;
    error?: string;
    productId?: string;
  }> => {
    let res;
    try {
      res = await RestClient.post(`${RELAY}updateSubscription`, {
        appID,
        id,
        data,
        newPlans: true,
      });
    } catch (err) {
      return err.response.data;
    }
    return res.data || res.json;
  };

  public static verifyReceipt = async (id: string, appID: string): Promise<any> => {
    let res;
    try {
      res = await RestClient.post(`${RELAY}verifyReceipt`, {
        appID,
        id,
      });
    } catch (err) {
      console.log('err', err);
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }
    return res.data || res.json;
  };

  public static getSubscriptionDetails = async (
    id: string,
    appID: string
  ): Promise<{ plans: SubScriptionPlan[] }> => {
    let res;
    try {
      res = await RestClient.post(`${RELAY}getSubscriptionDetails`, {
        appID,
        id,
        newPlans: true,
      });
    } catch (err) {
      console.log('err', err);
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }
    return res.data || res.json;
  };

  public static updateAppImage = async (
    appImage
  ): Promise<{
    status: string;
    updated: boolean;
    err?: string;
    message?: string;
  }> => {
    try {
      const res = await RestClient.post(`${RELAY}updateAppImage`, appImage);
      const data = res.data || res.json;
      return data;
    } catch (err) {
      captureError(err);
      throw new Error('Failed to update app backup. Check your internet connection and try again.');
    }
  };

  public static migrateXfp = async (
    appId: string,
    signerChanges: SignerChange[]
  ): Promise<{
    updated: boolean;
    err?: string;
  }> => {
    try {
      const res = await RestClient.post(`${RELAY}migrateXfps`, { appId, signerChanges });
      const data = res.data || res.json;
      return data;
    } catch (err) {
      captureError(err);
      throw new Error('Failed to do migrate the xfp');
    }
  };

  public static deleteAppImageEntity = async (
    entityList
  ): Promise<{
    status: string;
    updated: boolean;
    err?: string;
    message?: string;
  }> => {
    try {
      const res = await RestClient.post(`${RELAY}deleteAppImageEntity`, entityList);
      const data = res.data || res.json;
      return data;
    } catch (err) {
      captureError(err);
      throw new Error('Failed to update App Image');
    }
  };

  public static deleteVaultImage = async (
    entityList
  ): Promise<{
    status: string;
    updated: boolean;
    err?: string;
    message?: string;
  }> => {
    try {
      const res = await RestClient.post(`${RELAY}deleteVaults`, entityList);
      const data = res.data || res.json;
      return data;
    } catch (err) {
      captureError(err);
      throw new Error('Failed to update Vault Image');
    }
  };

  public static updateVaultImage = async (
    vaultData
  ): Promise<{
    status?: number;
    data?: {
      updated: boolean;
    };
    err?: string;
    message?: string;
  }> => {
    try {
      const res = await RestClient.post(`${RELAY}updateVaultImage`, vaultData);
      const data = res.data || res.json;
      return data;
    } catch (err) {
      captureError(err);
      throw new Error('Failed to update app backup. Check your internet connection and try again.');
    }
  };

  public static getAppImage = async (appId): Promise<any> => {
    try {
      const res = await RestClient.post(`${RELAY}getAppImage`, {
        appId,
      });
      const data = res.data || res.json;
      return data;
    } catch (err) {
      captureError(err);
      if (err?.code == 'ERR_NETWORK') throw new Error('Network Error');
      throw new Error('Failed get App Image');
    }
  };

  public static getTestcoins = async (
    recipientAddress: string,
    network: any
  ): Promise<{
    txid: any;
    funded: any;
  }> => {
    if (network === NetworkType.MAINNET) {
      throw new Error('Invalid network: failed to fund via testnet');
    }

    try {
      const res = await RestClient.post(`${config.RELAY}testnetFaucet`, {
        recipientAddress,
      });
      const { txid, funded } = res.data;
      return {
        txid,
        funded,
      };
    } catch (err) {
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }
  };

  public static createNewApp = async (
    publicId: string,
    appID: string,
    fcmToken: string
  ): Promise<{
    created: boolean;
  }> => {
    let res;
    try {
      res = await RestClient.post(`${RELAY}createNewApp`, {
        appID,
        publicId,
        fcmToken,
      });
    } catch (err) {
      console.log('err', err);
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }
    const { created } = res.data || res.json;
    return {
      created,
    };
  };

  public static modifyLabels = async (
    appId: string,
    addLabels: any[],
    deleteLabels: any[]
  ): Promise<{
    updated: boolean;
  }> => {
    try {
      const res = (await RestClient.post(`${RELAY}modifyLabels`, {
        appId,
        addLabels,
        deleteLabels,
      })) as AxiosResponse;
      const { updated } = res.data || res.json;
      return {
        updated,
      };
    } catch (err) {
      console.log('err', err);
      if (err.code) throw new Error(err.code);
    }
  };

  public static checkTorStatus = async () => {
    try {
      const response = await RestClient.get(TOR_ENDPOINT, { timeout: 20000 });
      const data = (response as AxiosResponse).data || (response as any).json;
      return data.IsTor;
    } catch (error) {
      captureError(error);
      throw error;
    }
  };

  public static fetchOneWeekHistoricalFee = async (): Promise<any> => {
    try {
      const response = await RestClient.get(`${RELAY}oneweekGraphData`);
      const data = (response as AxiosResponse).data || (response as any).json;
      if (data && data.graph_data.data) {
        return data.graph_data.data;
      } else {
        return [];
      }
    } catch (error) {
      captureError(error);
      throw error;
    }
  };

  public static fetchFeeInsightData = async (): Promise<any> => {
    try {
      const response = await RestClient.get(`${RELAY}feeInsighData`);
      const data = (response as AxiosResponse).data || (response as any).json;
      if (data && data.insightData) {
        return data.insightData;
      } else {
        return {};
      }
    } catch (error) {
      captureError(error);
      throw error;
    }
  };

  public static getOffer = async (productId: string, promoCode: string): Promise<any> => {
    try {
      const response = await RestClient.post(`${RELAY}offer`, { productId, promoCode });
      const data = (response as AxiosResponse).data || (response as any).json;
      if (data) {
        return data;
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
  };

  public static createRemoteKey = async (data: string, hash: string) => {
    try {
      const response = await RestClient.post(`${RELAY}createRemoteKey`, { data, hash });
      const res = (response as AxiosResponse).data || (response as any).json;
      if (res) {
        return res;
      } else {
        return null;
      }
    } catch (error) {
      console.log('🚀 ~ Relay ~ createRemoteKey= ~ error:', error);
    }
  };

  public static getRemoteKey = async (hash: string) => {
    try {
      const response = await RestClient.get(`${RELAY}getRemoteKey?hash=${hash}`);
      const res = (response as AxiosResponse).data || (response as any).json;
      if (res) {
        return res;
      } else {
        return null;
      }
    } catch (error) {
      console.log('🚀 ~ Relay ~ getRemoteKey= ~ error:', error);
    }
  };

  public static sendSingleNotification = async (data) => {
    try {
      const response = await RestClient.post(`${RELAY}sendSingleNotification`, data);
      const res = (response as AxiosResponse).data || (response as any).json;
      if (res) {
        return res;
      } else {
        return null;
      }
    } catch (error) {
      console.log('🚀 ~ Relay ~ sendSingleNotification= ~ error:', { error });
    }
  };

  public static updateZendeskExternalId = async (data) => {
    try {
      const response = await RestClient.post(`${RELAY}updateZendeskExternalId`, data);
      const res = (response as AxiosResponse).data || (response as any).json;
      if (res) {
        return res;
      } else {
        return null;
      }
    } catch (error) {
      throw error;
    }
  };

  public static updateCollaborativeChannel = async (channelId: string, encryptedData: string) => {
    try {
      const res = await RestClient.post(`${RELAY}updateCollaborativeChannel`, {
        channelId,
        encryptedData,
      });
      return res.data;
    } catch (err) {
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }
  };

  public static fetchCollaborativeChannel = async (channelId: string) => {
    try {
      const res = await RestClient.post(`${RELAY}fetchCollaborativeChannel`, {
        channelId,
      });
      return res.data;
    } catch (err) {
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }
  };

  public static backupAllSignersAndVaults = async (
    allData
  ): Promise<{
    status?: number;
    data?: {
      updated: boolean;
    };
    err?: string;
    message?: string;
  }> => {
    try {
      const res = await RestClient.post(`${RELAY}backupAllSignersAndVaults`, allData);
      const data = res.data || res.json;
      return data;
    } catch (err) {
      captureError(err);
      throw new Error('Failed to update app backup. Check your internet connection and try again.');
    }
  };

  public static checkEligibilityForBtcPay = async (body): Promise<any> => {
    try {
      const res = await RestClient.post(`${RELAY}eligibleForBtcPay`, body);
      const data = res?.data;
      return data;
    } catch (err) {
      captureError(err);
      if (err?.code == 'ERR_NETWORK') throw new Error('Network Error');
      throw new Error('Error while create BTCPay Order');
    }
  };

  public static restoreBtcPurchase = async (appId): Promise<any> => {
    try {
      const res = await RestClient.get(`${RELAY}restoreBtcPurchase?appId=${appId}`);
      const data = res?.data;
      return data;
    } catch (err) {
      console.log('🚀 ~ Relay ~ restoreBtcPurchase= ~ err:', err);
      captureError(err);
      if (err?.code == 'ERR_NETWORK') throw new Error('Network Error');
      throw new Error(err.message);
    }
  };

  public static deleteBackup = async (
    body
  ): Promise<{
    status?: number;
    data?: {
      updated: boolean;
    };
    err?: string;
    message?: string;
  }> => {
    try {
      const res = await RestClient.post(`${RELAY}deleteBackup`, body);
      const data = res.data || res.json;
      return data;
    } catch (err) {
      captureError(err);
      throw new Error(
        'Failed to delete assisted server backup. Check your internet connection and try again.'
      );
    }
  };

  public static redeemKeeperPrivate = async (body): Promise<any> => {
    try {
      const res = await RestClient.post(`${RELAY}redeemKeeperPrivate`, body);
      const data = res?.data;
      return data;
    } catch (err) {
      console.log('🚀 redeemKeeperPrivate err:', err);
      captureError(err);
      if (err?.code == 'ERR_NETWORK') throw new Error('Network Error');
      throw new Error(err.message);
    }
  };

  public static getAccountManagerDetails = async (appId): Promise<any> => {
    try {
      const res = await RestClient.get(`${RELAY}getAccountManagerDetails?appId=${appId}`);
      const data = res?.data;
      return data;
    } catch (err) {
      console.log('🚀 ~ Relay ~ getAccountManagerDetails ~ err:', err);
      captureError(err);
      if (err?.code == 'ERR_NETWORK') throw new Error('Network Error');
      throw new Error(err.message);
    }
  };

  public static getBtcPrice = async (currencyCode): Promise<any> => {
    let res;
    try {
      res = await axios.get(
        `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=${currencyCode}&days=6`
      );
    } catch (err) {
      console.log('err', err);
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }
    return res ? res.data || res.json : null;
  };
  public static getUsdtPrice = async (currencyCode): Promise<any> => {
    let res;
    try {
      res = await axios.get(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${currencyCode}&ids=tether`
      );
    } catch (err) {
      console.log('err', err);
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }
    return res ? res.data || res.json : null;
  };

  public static getSwapCoins = async (): Promise<any> => {
    try {
      const res = await RestClient.get(`${RELAY}getSwapCoins`);
      return res.data;
    } catch (error) {
      console.log('🚀 ~ Swap ~ getCoins ~ error:', error);
      throw new Error(error.message ?? 'Something went wrong');
    }
  };

  public static getSwapQuote = async (body): Promise<any> => {
    try {
      const res = await RestClient.post(`${RELAY}getSwapQuote`, body);
      return res.data;
    } catch (error) {
      console.log('🚀 ~ Relay ~ getSwapQuote ~ error:', error);
      throw new Error(error.message ?? 'Something went wrong');
    }
  };

  public static createSwapTnx = async (body): Promise<any> => {
    try {
      const res = await RestClient.post(`${RELAY}createSwapTnx`, body);
      return res.data;
    } catch (error) {
      console.log('🚀 ~ Relay ~ createSwapTnx ~ error:', error);
      throw new Error(error?.response?.data ?? 'Something went wrong');
    }
  };

  public static getSwapTnxDetails = async (tnxId): Promise<any> => {
    try {
      const res = await RestClient.get(`${RELAY}getSwapTnxDetails?tnxId=${tnxId}`);
      return res.data;
    } catch (error) {
      console.log('🚀 ~ Relay ~ getSwapTnxDetails ~ error:', error);
      throw new Error(error.message ?? 'Something went wrong');
    }
  };

  public static uploadZendeskImages = async (imageObject): Promise<any> => {
    let res;
    try {
      const formData = new FormData();
      imageObject.forEach(async (image) => {
        formData.append('files', {
          uri: image.uri,
          name: image.fileName,
          type: image.type,
        });
      });
      res = await RestClient.post(`${RELAY}uploadZendeskImages`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
    } catch (err) {
      console.log('🚀 ~ Relay ~ uploadZendeskImages ~ err:', err);
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }
    return res ? res.data || res.json : null;
  };

  public static getZendeskTickets = async (conciergeUserId): Promise<any> => {
    let res;
    try {
      res = await RestClient.get(`${RELAY}getZendeskTickets?conciergeUserId=${conciergeUserId}`);
    } catch (err) {
      console.log('🚀 ~ Relay ~ getZendeskTickets ~ err:', err);
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }
    return res ? res.data || res.json : null;
  };

  public static getZendeskTicketComments = async (ticketId): Promise<any> => {
    let res;
    try {
      res = await RestClient.get(`${RELAY}getZendeskTicketComments?ticketId=${ticketId}`);
    } catch (err) {
      console.log('🚀 ~ Relay ~ getZendeskTicketComments ~ err:', err);
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }
    return res ? res.data || res.json : null;
  };

  public static getZendeskUser = async (userExternalId): Promise<any> => {
    let res;
    try {
      res = await RestClient.get(`${RELAY}getZendeskUser?userExternalId=${userExternalId}`);
    } catch (err) {
      console.log('🚀 ~ Relay ~ getZendeskUser ~ err:', err);
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }
    return res ? res.data || res.json : null;
  };

  public static createZendeskUser = async (userExternalId): Promise<any> => {
    let res;
    try {
      res = await RestClient.post(`${RELAY}createZendeskUser`, {
        userExternalId,
        os: Platform.OS,
      });
    } catch (err) {
      console.log('🚀 ~ Relay ~ getZendeskUser ~ err:', err);
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }
    return res ? res.data || res.json : null;
  };

  public static addZendeskComment = async (ticketId, conciergeUserId, desc): Promise<any> => {
    let res;
    try {
      res = await RestClient.post(`${RELAY}addZendeskComment`, {
        ticketId,
        conciergeUserId,
        desc,
      });
    } catch (err) {
      console.log('🚀 ~ Relay ~ addZendeskComment ~ err:', err);
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }
    return res ? res.data || res.json : null;
  };

  public static createZendeskTicket = async (data): Promise<any> => {
    let res;
    try {
      res = await RestClient.post(`${RELAY}createZendeskTicket`, data);
    } catch (err) {
      console.log('🚀 ~ Relay ~ createZendeskTicket ~ err:', err);
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }
    return res ? res.data || res.json : null;
  };

  public static getRampUrl = async ({
    userAddress,
    appId,
    swapAsset,
    flow,
  }): Promise<{
    url: string;
    signature: string;
    timestamp: number;
    queryString: string;
  }> => {
    let res;
    try {
      res = await RestClient.get(
        `${RELAY}getRampUrl?appId=${appId}&userAddress=${userAddress}&swapAsset=${swapAsset}&flow=${flow}`
      );
    } catch (err) {
      if (err?.message) throw new Error(err.message);
      if (err?.code) throw new Error(err.code);
    }
    return res ? res.data || res.json : null;
  };
}
