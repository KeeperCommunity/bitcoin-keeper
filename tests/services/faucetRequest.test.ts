import Relay from '../../src/services/backend/Relay';
import RestClient from '../../src/services/rest/RestClient';
import { NetworkType } from '../../src/services/wallets/enums';

jest.mock('src/services/rest/RestClient', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));
jest.mock('src/utils/service-utilities/config', () => ({
  __esModule: true,
  default: { RELAY: 'https://relay.example/' },
}));
jest.mock('src/services/sentry', () => ({ captureError: jest.fn() }));

const post = RestClient.post as jest.Mock;
const txid = 'a'.repeat(64);

describe('Testnet faucet request', () => {
  beforeEach(() => post.mockReset());

  it('refuses a non-Testnet wallet before contacting the relay', async () => {
    await expect(Relay.getTestcoins('address', NetworkType.MAINNET, 'app')).rejects.toThrow(
      'Invalid network'
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('sends a bounded, single request and returns a valid funded txid', async () => {
    post.mockResolvedValue({ data: { txid, funded: true } });

    await expect(Relay.getTestcoins('address', NetworkType.TESTNET, 'app')).resolves.toEqual({
      txid,
      funded: true,
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      'https://relay.example/testnetFaucet',
      { recipientAddress: 'address', appId: 'app' },
      undefined,
      { timeout: 20000 }
    );
  });

  it('marks a timed-out response as uncertain without retrying', async () => {
    post.mockRejectedValue({ code: 'ECONNABORTED' });

    await expect(Relay.getTestcoins('address', NetworkType.TESTNET, 'app')).rejects.toThrow(
      'FAUCET_OUTCOME_UNKNOWN'
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('keeps the daily quota separate from an uncertain outcome', async () => {
    post.mockRejectedValue({ response: { status: 429 } });

    await expect(Relay.getTestcoins('address', NetworkType.TESTNET, 'app')).rejects.toThrow(
      'FAUCET_DAILY_LIMIT_REACHED'
    );
  });
});
