import * as Keychain from 'react-native-keychain';
import NodeRSA from 'node-rsa';
import config from '../utils/service-utilities/config';
import { store as reduxStore } from 'src/store/store';
import {
  reportStartupFailure,
  StartupFailureObserver,
  StartupFailurePhase,
} from './startup-failure-observer';

export const store = async (hash: string, enc_key: string, identifier: string) => {
  try {
    // unique pin check
    const allAccounts = reduxStore.getState().account.allAccounts;
    for (const index in allAccounts) {
      const identifier = allAccounts[index].accountIdentifier;
      let credentials;
      credentials = await Keychain.getGenericPassword({
        service: identifier == '' ? undefined : identifier,
      });
      if (credentials) {
        const password = JSON.parse(credentials.password);
        if (hash === password.hash) {
          return 'Passcode already exists';
        }
      }
    }
    await Keychain.setGenericPassword(
      config.ENC_KEY_STORAGE_IDENTIFIER,
      JSON.stringify({
        hash,
        enc_key,
      }),
      {
        service: identifier == '' ? undefined : identifier,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
      }
    );
    return true;
  } catch (error) {
    return false;
  }
};

export const fetch = async (hash_current: string) => {
  try {
    let allAccounts = reduxStore.getState().account.allAccounts;
    if (!allAccounts.length) {
      allAccounts = [{ accountIdentifier: undefined }];
    }
    for (const index in allAccounts) {
      const identifier =
        allAccounts[index].accountIdentifier == ''
          ? undefined
          : allAccounts[index].accountIdentifier;
      const credentials = await Keychain.getGenericPassword({
        service: identifier,
      });
      if (credentials) {
        const password = JSON.parse(credentials.password);
        if (hash_current === password.hash) {
          return password.enc_key;
        }
      }
    }
    throw new Error('Incorrect Passcode');
  } catch (err) {
    console.log(err);
    throw err;
  }
};

// Startup must distinguish an unreadable Keychain from a successfully empty
// one. Preserve legacy behavior unless the caller explicitly requests errors.
export const hasPin = async (
  { throwOnError = false }: { throwOnError?: boolean } = {},
  onFailure: StartupFailureObserver | undefined = undefined
) => {
  let phase: StartupFailurePhase = 'ACCOUNT_STATE';
  let reported = false;
  try {
    let allAccounts = reduxStore.getState().account.allAccounts;
    // if allAccounts is empty | upgraded app with old passcode configuration
    if (!allAccounts.length) {
      allAccounts = [{ accountIdentifier: undefined }];
    }
    for (const index in allAccounts) {
      phase = 'ACCOUNT_STATE';
      const identifier =
        allAccounts[index].accountIdentifier == ''
          ? undefined
          : allAccounts[index].accountIdentifier;
      phase = 'NATIVE_CREDENTIAL_READ';
      let pending;
      try {
        pending = Keychain.getGenericPassword({ service: identifier });
      } catch (err) {
        reported = true;
        reportStartupFailure(onFailure, phase, 'THREW', err);
        throw err;
      }
      let credentials;
      try {
        credentials = await pending;
      } catch (err) {
        reported = true;
        reportStartupFailure(onFailure, phase, 'REJECTED', err);
        throw err;
      }
      phase = 'CREDENTIAL_JSON';
      if (credentials) {
        const password = JSON.parse(credentials.password);
        if (password) {
          return true;
        }
      }
    }
    return false;
  } catch (err) {
    if (!reported) reportStartupFailure(onFailure, phase, 'THREW', err);
    if (throwOnError) throw err;
    return false;
  }
};

export const remove = async (key) => {
  try {
    //
  } catch (err) {
    console.log(err);
    return false;
  }
  return true;
};

export const storeBiometricPubKey = async (pubKey: string, appId) => {
  try {
    const allAccounts = reduxStore.getState().account.allAccounts;
    const identifier =
      allAccounts.find((account) => account.appId === appId)?.accountIdentifier || undefined;
    const credentials = await Keychain.getGenericPassword({ service: identifier });
    const password = JSON.parse(credentials.password);
    const reset = await Keychain.resetGenericPassword({ service: identifier });
    if (reset) {
      const pass = {
        ...password,
        pubKey,
      };
      await Keychain.setGenericPassword(config.ENC_KEY_STORAGE_IDENTIFIER, JSON.stringify(pass), {
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
        service: identifier,
      });
      return true;
    }
    return false;
  } catch (error) {
    console.log(error);
    return false;
  }
};

export const verifyBiometricAuth = async (signature: string, payload: string) => {
  try {
    const allAccounts = reduxStore.getState().account.allAccounts;
    let identifier = allAccounts.find((account) => account.appId === payload)?.accountIdentifier;
    if (identifier == '') identifier = undefined;
    const keychain = await Keychain.getGenericPassword({ service: identifier });
    if (!keychain) {
      throw Error('Failed to get keychain');
    }
    const credentials = JSON.parse(keychain.password);
    const publicKeyBuffer = Buffer.from(credentials.pubKey, 'base64');
    const key = new NodeRSA();
    const signer = key.importKey(publicKeyBuffer, 'public-der');
    const isVerified = signer.verify(Buffer.from(payload), signature, 'utf8', 'base64');
    if (isVerified) {
      return {
        success: true,
        encryptedKey: credentials.enc_key,
        hash: credentials.hash,
      };
    }
    return {
      success: false,
    };
  } catch (error) {
    return {
      success: false,
    };
  }
};

export const fetchSpecific = async (hash_current: string, appId: string) => {
  try {
    const allAccounts = reduxStore.getState().account.allAccounts;
    const identifier = allAccounts.find((account) => account.appId === appId).accountIdentifier;
    const credentials = await Keychain.getGenericPassword({
      service: identifier == '' ? undefined : identifier,
    });
    if (credentials) {
      const password = JSON.parse(credentials.password);
      if (hash_current === password.hash) {
        return password.enc_key;
      }
    }
    throw new Error('Incorrect Passcode');
  } catch (err) {
    console.log(err);
    throw err;
  }
};
