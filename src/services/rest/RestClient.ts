import axios, { AxiosResponse } from 'axios';

import DeviceInfo from 'react-native-device-info';
import { Platform } from 'react-native';
import config from 'src/utils/service-utilities/config';

const { HEXA_ID } = config;

enum TorStatus {
  OFF = 'OFF',
  CONNECTING = 'CONNECTING',
  CHECKING = 'CHECKING',
  ERROR = 'ERROR',
  CONNECTED = 'CONNECTED',
  CHECK_STATUS = 'CHECK_STATUS',
}

class RestClient {
  public static useTor: boolean;

  public static headers: object;

  public static torStatus: TorStatus = TorStatus.OFF;

  public static torPort: number | null = null;

  subscribers = [];

  subToTorStatus(observer) {
    this.subscribers.push(observer);
  }

  unsubscribe(observer) {
    this.subscribers = this.subscribers.filter((ob) => ob !== observer);
  }

  notify(status: TorStatus, message) {
    this.subscribers.forEach((observer) => observer(status, message));
  }

  constructor() {
    RestClient.headers = {
      'HEXA-ID': HEXA_ID,
      HEXA_ID,
      appVersion: DeviceInfo.getVersion(),
      buildNumber: DeviceInfo.getBuildNumber(),
      os: Platform.OS,
    };
  }

  async setUseTor(useTor: boolean) {
    this.updateTorStatus(TorStatus.ERROR);
  }

  private updateTorStatus(status: TorStatus, message = '') {
    RestClient.torStatus = status;
    this.notify(status, message);
  }

  getTorStatus(): TorStatus {
    return RestClient.torStatus;
  }

  async post(path: string, body: object, headers?: object): Promise<AxiosResponse> {
    return axios.post(path, body, {
      headers: {
        ...RestClient.headers,
        ...headers,
      },
    });
  }

  async get(path: string, headers?: object): Promise<AxiosResponse> {
    return axios.get(path, {
      headers: {
        ...RestClient.headers,
        ...headers,
      },
    });
  }
}

export default new RestClient();
export { TorStatus };
