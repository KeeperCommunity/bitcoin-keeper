import { NativeModules, Platform } from 'react-native';

const { BackupFile } = NativeModules;

export default class BackupFileModule {
  static setFileProtection = async (filePath: string): Promise<boolean> => {
    if (Platform.OS === 'ios' && BackupFile) {
      return await BackupFile.setFileProtection(filePath);
    }
    // Android doesn't need this, return true
    return true;
  };
}
