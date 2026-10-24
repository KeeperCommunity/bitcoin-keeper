import axios from 'axios';
import RestClient from '../../src/services/rest/RestClient';

jest.mock('axios');
jest.mock('react-native-device-info', () => ({
  getVersion: () => 'test',
  getBuildNumber: () => '1',
}));
jest.mock('src/utils/service-utilities/config', () => ({
  __esModule: true,
  default: { HEXA_ID: 'test-id' },
}));

describe('RestClient request options', () => {
  beforeEach(() => {
    (axios.get as jest.Mock).mockResolvedValue({ data: {} });
    (axios.post as jest.Mock).mockResolvedValue({ data: {} });
  });

  it('passes GET deadline to Axios instead of sending it as an HTTP header', async () => {
    await RestClient.get('https://example.test/status', { Authorization: 'test' }, { timeout: 20 });

    expect(axios.get).toHaveBeenCalledWith(
      'https://example.test/status',
      expect.objectContaining({
        timeout: 20,
        headers: expect.objectContaining({ Authorization: 'test' }),
      })
    );
    expect((axios.get as jest.Mock).mock.calls[0][1].headers.timeout).toBeUndefined();
  });

  it('forwards POST cancellation without losing existing headers', async () => {
    const controller = new AbortController();
    await RestClient.post(
      'https://example.test/request',
      {},
      { Authorization: 'test' },
      {
        signal: controller.signal,
      }
    );

    expect(axios.post).toHaveBeenCalledWith(
      'https://example.test/request',
      {},
      expect.objectContaining({
        signal: controller.signal,
        headers: expect.objectContaining({ Authorization: 'test', 'HEXA-ID': 'test-id' }),
      })
    );
  });
});
