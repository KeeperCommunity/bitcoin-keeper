import * as Keychain from 'react-native-keychain';
import NodeRSA from 'node-rsa';
import { currentBackupAccountSession } from 'src/services/backup/transport';
import { updatePasscodeHash } from 'src/store/reducers/account';
import type { Account } from 'src/store/reducers/account';
import config from '../utils/service-utilities/config';
import { store as reduxStore } from 'src/store/store';
import {
  reportStartupFailure,
  StartupFailureObserver,
  StartupFailurePhase,
} from './startup-failure-observer';

// One process-local tail covers only the two credential read/modify/write operations.
// It does not claim native durability or cross-process exclusion.
let credentialWrite = Promise.resolve();
const runCredentialWrite = <T>(work: () => Promise<T>): Promise<T> => {
  const result = credentialWrite.then(work);
  credentialWrite = result.then(() => undefined, () => undefined);
  return result;
};

export const store = async (hash: string, enc_key: string, identifier: string) => {
  const session = currentBackupAccountSession();
  return runCredentialWrite(async () => {
    try {
      if (typeof identifier !== 'string') return false;
      const initial = reduxStore.getState();
      const selectedAppId = initial.storage.appId;
      const allAccounts = initial.account.allAccounts;
      const owner = allAccounts.find((account) => account.accountIdentifier === identifier);
      if (owner && owner.appId !== selectedAppId) return false;
      const isCurrent = (expectedHash = owner?.hash) => {
        const state = reduxStore.getState();
        const current = state.account.allAccounts.find((account) => account.accountIdentifier === identifier);
        return session === currentBackupAccountSession() && state.storage.appId === selectedAppId &&
          (owner ? current?.appId === owner.appId && current?.realmId === owner.realmId &&
            current?.hash === expectedHash : !current);
      };
      // Keep the existing cross-account PIN uniqueness check.
      for (const account of allAccounts) {
        const credentials = await Keychain.getGenericPassword({
          service: account.accountIdentifier === '' ? undefined : account.accountIdentifier,
        });
        if (!isCurrent()) return false;
        if (credentials && hash === JSON.parse(credentials.password).hash) return 'Passcode already exists';
      }
      const service = identifier === '' ? undefined : identifier;
      const previous = await Keychain.getGenericPassword({ service });
      if (!isCurrent() || (previous && !owner)) return false;
      const username = previous ? previous.username : config.ENC_KEY_STORAGE_IDENTIFIER;
      const result = await Keychain.setGenericPassword(username, JSON.stringify({ hash, enc_key }), {
        service,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
        keeperPreserveExisting: true,
      });
      if (!result) return false;
      const readback = await Keychain.getGenericPassword({ service });
      if (!readback || readback.username !== username) return false;
      const saved = JSON.parse(readback.password);
      if (saved.hash !== hash || saved.enc_key !== enc_key) return false;
      if (owner) {
        // A confirmed write belongs to its captured owner even after switching to B.
        // Reconcile only unchanged A metadata; never select A or create an account.
        const current = reduxStore.getState().account.allAccounts.find((account) =>
          account.appId === owner.appId && account.accountIdentifier === identifier);
        if (!current || current.realmId !== owner.realmId || current.hash !== owner.hash) return false;
        reduxStore.dispatch(updatePasscodeHash({ newHash: hash, appId: owner.appId }));
      }
      return isCurrent(hash);
    } catch (error) {
      return false;
    }
  });
};

export const fetch = async (hash_current: string): Promise<{
  encryptedKey: string;
  account?: Account;
}> => {
  try {
    const allAccounts = reduxStore.getState().account.allAccounts;
    // Legacy installations have only the default service and no account catalog.
    const owners: (Account | undefined)[] = allAccounts.length ? allAccounts : [undefined];
    for (const account of owners) {
      if (account && typeof account.accountIdentifier !== 'string')
        throw new Error('Saved account service is unavailable');
      const identifier = account?.accountIdentifier || undefined;
      const credentials = await Keychain.getGenericPassword({
        service: identifier,
      });
      if (credentials) {
        const password = JSON.parse(credentials.password);
        if (hash_current === password.hash && typeof password.enc_key === 'string') {
          // A native PIN replacement can commit before its JS acknowledgement
          // or catalog update. Route by the service that supplied the key, not
          // by a possibly stale PIN hash in the account catalog.
          return { encryptedKey: password.enc_key, account: account ? { ...account } : undefined };
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
  const session = currentBackupAccountSession();
  return runCredentialWrite(async () => {
    try {
      const initial = reduxStore.getState();
      const selectedAppId = initial.storage.appId;
      // Unknown requested accounts must never fall through to the default service.
      // Before the first KeeperApp exists, bind only its explicit pending setup record.
      const account = appId
        ? initial.account.allAccounts.find((entry) => entry.appId === appId)
        : !selectedAppId && initial.account.allAccounts.length === 0 ? initial.account.tempDetails : undefined;
      if (!account || typeof account.accountIdentifier !== 'string' || !account.realmId ||
          (appId && selectedAppId !== appId)) return false;
      const identifier = account.accountIdentifier;
      const isCurrent = () => {
        const state = reduxStore.getState();
        const current = appId ? state.account.allAccounts.find((entry) => entry.appId === appId) :
          !state.storage.appId && state.account.allAccounts.length === 0 ? state.account.tempDetails : undefined;
        return session === currentBackupAccountSession() && state.storage.appId === selectedAppId &&
          current?.accountIdentifier === identifier && current?.realmId === account.realmId &&
          current?.hash === account.hash;
      };
      const service = identifier === '' ? undefined : identifier;
      const credentials = await Keychain.getGenericPassword({ service });
      if (!isCurrent() || !credentials) return false;
      const password = JSON.parse(credentials.password);
      if (!password || typeof password.hash !== 'string' || typeof password.enc_key !== 'string' ||
          password.hash !== account.hash) return false;
      const result = await Keychain.setGenericPassword(credentials.username, JSON.stringify({ ...password, pubKey }), {
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
        service,
        keeperPreserveExisting: true,
      });
      if (!result || !isCurrent()) return false;
      const readback = await Keychain.getGenericPassword({ service });
      if (!isCurrent() || !readback || readback.username !== credentials.username) return false;
      const saved = JSON.parse(readback.password);
      return saved.hash === password.hash && saved.enc_key === password.enc_key && saved.pubKey === pubKey;
    } catch (error) {
      return false;
    }
  });
};

export const verifyBiometricAuth = async (signature: string, payload: string) => {
  try {
    const allAccounts = reduxStore.getState().account.allAccounts;
    const account = allAccounts.find((entry) => entry.appId === payload);
    if (!account || typeof account.accountIdentifier !== 'string')
      throw new Error('Saved account service is unavailable');
    let identifier = account.accountIdentifier;
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
        account: { ...account },
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
