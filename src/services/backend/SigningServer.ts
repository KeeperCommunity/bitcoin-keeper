import { AxiosResponse } from 'axios';
import config from 'src/utils/service-utilities/config';
import { asymmetricDecrypt, generateRSAKeypair } from 'src/utils/service-utilities/encryption';
import { store } from 'src/store/store';
import {
  DelayedPolicyUpdate,
  DelayedTransaction,
  SignerPolicy,
  SignerRestriction,
  SingerVerification,
  VerificationOption,
} from '../../models/interfaces/AssistedKeys';
import RestClient from '../rest/RestClient';
import { NetworkType } from '../wallets/enums';

const { HEXA_ID_TESTNET, HEXA_ID_MAINNET, SIGNING_SERVER_MAINNET, SIGNING_SERVER_TESTNET } = config;

export default class SigningServer {
  /**
   * @param  {SignerPolicy} policy
   * @returns Promise
   */
  static register = async (
    policy: SignerPolicy
  ): Promise<{
    setupData: {
      id: string;
      isBIP85: boolean;
      bhXpub: any;
      masterFingerprint: any;
      derivationPath: string;
      verification: SingerVerification;
    };
  }> => {
    let res: AxiosResponse;
    try {
      res = await RestClient.post(`${getSigningServerURL()}v3/setupSigner`, {
        HEXA_ID: getHexaId(),
        policy,
      });
    } catch (err) {
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }

    const { setupSuccessful, setupData } = res.data;
    if (!setupSuccessful) throw new Error('Signer setup failed');
    return {
      setupData,
    };
  };

  static validate = async (
    id: string,
    verificationToken: number
  ): Promise<{
    valid: boolean;
  }> => {
    let res: AxiosResponse;
    try {
      res = await RestClient.post(`${getSigningServerURL()}v3/validateSingerSetup`, {
        HEXA_ID: getHexaId(),
        id,
        verificationToken,
      });
    } catch (err) {
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }

    const { valid } = res.data;
    if (!valid) throw new Error('Signer validation failed');

    return {
      valid,
    };
  };

  static addSecondaryVerificationOption = async (
    id: string,
    verificationToken: number,
    newOption: Omit<VerificationOption, 'verifier'>
  ): Promise<{
    success: boolean;
    secondaryVerificationOption: VerificationOption;
  }> => {
    let res: AxiosResponse;
    try {
      res = await RestClient.post(`${getSigningServerURL()}v3/addSecondaryVerificationOption`, {
        HEXA_ID: getHexaId(),
        id,
        verificationToken,
        newOption,
      });
    } catch (err) {
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }

    const { success, secondaryVerificationOption } = res.data;
    if (!success) throw new Error('Failed to add secondary verification option');

    return {
      success,
      secondaryVerificationOption,
    };
  };

  static removeSecondaryVerificationOption = async (
    id: string,
    verificationToken: number,
    optionId: string
  ): Promise<{
    success: boolean;
  }> => {
    let res: AxiosResponse;
    try {
      res = await RestClient.post(`${getSigningServerURL()}v3/removeSecondaryVerificationOption`, {
        HEXA_ID: getHexaId(),
        id,
        verificationToken,
        optionId,
      });
    } catch (err) {
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }

    const { success } = res.data;
    if (!success) throw new Error('Failed to remove secondary verification option');

    return {
      success,
    };
  };

  static fetchSignerSetup = async (
    id: string,
    verificationToken: number
  ): Promise<{
    valid: boolean;
    id?: string;
    isBIP85?: boolean;
    xpub?: string;
    masterFingerprint?: string;
    derivationPath?: string;
    policy?: SignerPolicy;
    linkedViaSecondary?: boolean;
  }> => {
    let res: AxiosResponse;
    try {
      res = await RestClient.post(`${getSigningServerURL()}v3/fetchSignerSetup`, {
        HEXA_ID: getHexaId(),
        id,
        verificationToken,
      });
    } catch (err) {
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }

    const { valid } = res.data;
    if (!valid) throw new Error('Signer validation failed');

    const { isBIP85, xpub, masterFingerprint, derivationPath, policy, linkedViaSecondary } =
      res.data;

    return {
      valid,
      id,
      isBIP85,
      xpub,
      masterFingerprint,
      derivationPath,
      policy,
      linkedViaSecondary,
    };
  };

  static findServerKey = async (ids: string[]) => {
    let res: AxiosResponse;
    try {
      res = await RestClient.post(`${getSigningServerURL()}v3/findServerKey`, {
        HEXA_ID: getHexaId(),
        ids,
      });
    } catch (err) {
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }
    const { id } = res.data;
    return id;
  };

  static updateBackupSetting = async (
    id: string,
    verifierDigest: string,
    disable: boolean
  ): Promise<{
    updated: boolean;
  }> => {
    let res: AxiosResponse;
    try {
      res = await RestClient.post(`${getSigningServerURL()}v3/updateBackupSetting`, {
        HEXA_ID: getHexaId(),
        id,
        verifierDigest,
        disable,
      });
    } catch (err) {
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }

    const { updated } = res.data;
    return { updated };
  };

  static fetchBackup = async (
    id: string,
    verificationToken: number
  ): Promise<{
    mnemonic: string;
    derivationPath: string;
  }> => {
    let res: AxiosResponse;
    const { privateKey, publicKey } = await generateRSAKeypair();

    try {
      res = await RestClient.post(`${getSigningServerURL()}v3/fetchBackup`, {
        HEXA_ID: getHexaId(),
        id,
        verificationToken,
        publicKey,
      });
    } catch (err) {
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }

    const { encryptedBackup } = res.data;
    const decryptedData = asymmetricDecrypt(encryptedBackup, privateKey);
    const { mnemonic, derivationPath } = JSON.parse(decryptedData);

    return { mnemonic, derivationPath };
  };

  static updatePolicy = async (
    id: string,
    verificationToken: number,
    updates: {
      restrictions: SignerRestriction;
      signingDelay: number;
    },
    FCM?: string
  ): Promise<{
    updated: boolean;
    delayedPolicyUpdate: DelayedPolicyUpdate;
  }> => {
    let res: AxiosResponse;
    try {
      res = await RestClient.post(`${getSigningServerURL()}v3/updateSignerPolicy`, {
        HEXA_ID: getHexaId(),
        id,
        verificationToken,
        updates,
        FCM,
      });
    } catch (err) {
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }

    const { updated, delayedPolicyUpdate } = res.data;

    return {
      updated,
      delayedPolicyUpdate,
    };
  };

  static signPSBT = async (
    id: string,
    serializedPSBT: string,
    verificationToken: number,
    change: { address: string; index: number },
    descriptor: string,
    FCM?: string
  ): Promise<{
    signedPSBT: string;
    delayed: boolean;
    delayedTransaction: DelayedTransaction;
  }> => {
    let res: AxiosResponse;
    try {
      res = await RestClient.post(`${getSigningServerURL()}v3/signTransaction`, {
        HEXA_ID: getHexaId(),
        id,
        serializedPSBT,
        verificationToken,
        change,
        descriptor,
        FCM,
      });
    } catch (err) {
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }

    const { signedPSBT, delayed, delayedTransaction } = res.data;
    return {
      signedPSBT,
      delayed,
      delayedTransaction,
    };
  };

  static fetchSignedDelayedTransaction = async (
    txid: string,
    verificationToken: string
  ): Promise<{
    delayedTransaction: DelayedTransaction;
  }> => {
    let res: AxiosResponse;
    try {
      res = await RestClient.post(`${getSigningServerURL()}v3/fetchSignedDelayedTransaction`, {
        HEXA_ID: getHexaId(),
        txid,
        verificationToken,
      });
    } catch (err) {
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }

    const { delayedTransaction } = res.data;

    return {
      delayedTransaction,
    };
  };

  static cancelDelayedTransaction = async (
    signerId: string,
    txid: string,
    verificationToken: string
  ): Promise<{
    canceled: boolean;
  }> => {
    let res: AxiosResponse;
    try {
      res = await RestClient.post(`${getSigningServerURL()}v3/cancelDelayedTransaction`, {
        HEXA_ID: getHexaId(),
        signerId,
        txid,
        verificationToken,
      });
    } catch (err) {
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }

    const { canceled } = res.data;

    return {
      canceled,
    };
  };

  static fetchDelayedPolicyUpdate = async (
    policyId: string,
    verificationToken: string
  ): Promise<{
    delayedPolicy: DelayedPolicyUpdate;
  }> => {
    let res: AxiosResponse;
    try {
      res = await RestClient.post(`${getSigningServerURL()}v3/fetchDelayedPolicyUpdate`, {
        HEXA_ID: getHexaId(),
        policyId,
        verificationToken,
      });
    } catch (err) {
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }

    const { delayedPolicy } = res.data;

    return {
      delayedPolicy,
    };
  };

  static checkSignerHealth = async (
    id: string,
    verificationToken: number
  ): Promise<{
    isSignerAvailable: boolean;
  }> => {
    let res: AxiosResponse;
    try {
      res = await RestClient.post(`${getSigningServerURL()}v3/checkSignerHealth`, {
        HEXA_ID: getHexaId(),
        id,
        verificationToken,
      });
    } catch (err) {
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }

    const { isSignerAvailable } = res.data;
    return {
      isSignerAvailable,
    };
  };

  static migrateSignerPolicy = async (
    id: string,
    oldPolicy: SignerPolicy
  ): Promise<{
    newPolicy: SignerPolicy;
  }> => {
    let res: AxiosResponse;
    try {
      res = await RestClient.post(`${getSigningServerURL()}v3/migrateSignerPolicy`, {
        HEXA_ID: getHexaId(),
        id,
        oldPolicy,
      });
    } catch (err) {
      if (err.response) throw new Error(err.response.data.err);
      if (err.code) throw new Error(err.code);
    }

    const { newPolicy } = res.data;
    return { newPolicy };
  };
}

const getSigningServerURL = () => {
  const { bitcoinNetworkType } = store.getState().settings;
  return bitcoinNetworkType === NetworkType.TESTNET
    ? SIGNING_SERVER_TESTNET
    : SIGNING_SERVER_MAINNET;
};

const getHexaId = () => {
  const { bitcoinNetworkType } = store.getState().settings;
  return bitcoinNetworkType === NetworkType.TESTNET ? HEXA_ID_TESTNET : HEXA_ID_MAINNET;
};
