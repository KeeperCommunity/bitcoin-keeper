import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import BackupFileModule from 'src/nativemodules/BackupFile';
import { decrypt, encrypt } from 'src/utils/service-utilities/encryption';
import * as SecureStore from 'src/storage/secure-store';
import config from 'src/utils/service-utilities/config';
import { store as reduxStore } from 'src/store/store';
import { setLoginMethod } from 'src/store/reducers/settings';
import LoginMethod from 'src/models/enums/LoginMethod';
import { setBiometricEnabledAppId } from 'src/store/reducers/account';

const FILE_NAME = 'backup.txt';

const getBackupFilePath = (fileName: string): string => {
  return `${RNFS.DocumentDirectoryPath}/${fileName}`;
};

export const createBackup = async (appId: string, hash: string, encryptedKey): Promise<boolean> => {
  if (Platform.OS != 'ios') return null;
  try {
    if (
      !hash ||
      typeof hash !== 'string' ||
      !encryptedKey ||
      typeof hash != 'string' ||
      !appId ||
      typeof appId != 'string'
    ) {
      return null;
    }

    const filePath = `${RNFS.DocumentDirectoryPath}/${FILE_NAME}`;

    let data = {};

    const exists = await RNFS.exists(filePath);
    if (exists) {
      console.log('Backup file does exists');
      const file = await RNFS.readFile(filePath, 'utf8');
      const fileData = decrypt(config.HEXA_ID, file);
      data = JSON.parse(fileData);
    }
    data[appId] = { hash, encryptedKey };
    const encryptedData = encrypt(config.HEXA_ID, JSON.stringify(data));
    await RNFS.writeFile(filePath, encryptedData, 'utf8');
    try {
      await BackupFileModule.setFileProtection(filePath);
    } catch (error) {
      console.warn('Failed to set file protection:', error);
    }

    return true;
  } catch (error) {
    return false;
  }
};

export const readBackupFile = async (): Promise<string | null> => {
  try {
    const filePath = getBackupFilePath(FILE_NAME);
    const exists = await RNFS.exists(filePath);
    if (!exists) {
      return null;
    }
    const encryptedData = await RNFS.readFile(filePath, 'utf8');
    return encryptedData;
  } catch (error) {
    throw error;
  }
};

export const deleteBackupFile = async (fileName: string): Promise<boolean> => {
  try {
    if (!fileName) {
      throw new Error('Backup file name is required');
    }
    const filePath = getBackupFilePath(fileName);
    const exists = await RNFS.exists(filePath);
    if (!exists)return false;
    await RNFS.unlink(filePath);
    return true;
  } catch (error) {
    throw error;
  }
};

export const restoreBackupKey = async (del=true): Promise<boolean> => {
  try {
    let data = await readBackupFile();
    if (!data) return false;
    data = decrypt(config.HEXA_ID, data);
    data = JSON.parse(data);
    const allAccounts = reduxStore.getState().account.allAccounts;
    for (const [appId, _] of Object.entries(data)) {
      const accountIdentifier = allAccounts.find(acc=> acc.appId == appId).accountIdentifier;
      const service = accountIdentifier == '' ? undefined : accountIdentifier;
      if(del){
        await SecureStore.store(data[appId].hash, data[appId].encryptedKey, service);
      }
    }

    if(del){
      await deleteBackupFile(FILE_NAME);
    }
    reduxStore.dispatch(setLoginMethod(LoginMethod.PIN));
    reduxStore.dispatch(setBiometricEnabledAppId(null));
    return true;
  } catch (error) {
    console.log({ error });
    return false;
  }
};
