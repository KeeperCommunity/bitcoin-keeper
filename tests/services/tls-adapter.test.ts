jest.mock('react-native-tcp-socket', () => ({
  connectTLS: jest.fn(),
}));

const TcpSocket = require('react-native-tcp-socket');
const tlsAdapter = require('../../src/services/electrum/tls');

describe('electrum tls adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses strict TLS defaults and host as servername', () => {
    const callback = jest.fn();
    const socket = { id: 'strict-socket' };
    TcpSocket.connectTLS.mockReturnValue(socket);

    const result = tlsAdapter.connect(
      {
        host: 'electrum.example.com',
        port: 50002,
      },
      callback
    );

    expect(TcpSocket.connectTLS).toHaveBeenCalledWith(
      {
        host: 'electrum.example.com',
        port: 50002,
        rejectUnauthorized: true,
        tlsCheckValidity: true,
        servername: 'electrum.example.com',
      },
      callback
    );
    expect(result).toBe(socket);
  });

  it('cannot disable verification or replace the selected hostname', () => {
    const callback = jest.fn();

    tlsAdapter.connect(
      {
        host: '127.0.0.1',
        port: 50002,
        rejectUnauthorized: false,
        servername: 'node.example.com',
      },
      callback
    );

    expect(TcpSocket.connectTLS).toHaveBeenCalledWith(
      {
        host: '127.0.0.1',
        port: 50002,
        rejectUnauthorized: true,
        tlsCheckValidity: true,
        servername: '127.0.0.1',
      },
      callback
    );
  });
  it('binds an operator-supplied PEM to its private TLS peer only', () => {
    const ca = '-----BEGIN CERTIFICATE-----\nY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----';
    const adapter = tlsAdapter.forNode({
      host: 'self-hosted.example', port: '50002', useSSL: true, useKeeperNode: false,
      tlsCa: ca,
    });
    adapter.connect({ host: 'self-hosted.example', port: 50002, rejectUnauthorized: false }, null);
    expect(TcpSocket.connectTLS).toHaveBeenLastCalledWith(expect.objectContaining({
      ca, rejectUnauthorized: true, servername: 'self-hosted.example',
    }), null);
    expect(() => adapter.connect({ host: 'other.example', port: 50002 }, null)).toThrow(/selected node/);
    expect(() => adapter.connect({ host: 'self-hosted.example', port: 50001 }, null)).toThrow(/selected node/);
    tlsAdapter.connect({ host: 'other.example', port: 50002, ca }, null);
    expect(TcpSocket.connectTLS.mock.calls.at(-1)[0]).not.toHaveProperty('ca');
  });

  it('rejects malformed or nonprivate trust without opening a socket', () => {
    const node = { host: 'custom.example', port: '50002', useSSL: true, useKeeperNode: false };
    for (const tlsCa of ['not a certificate', '-----BEGIN PRIVATE KEY-----\nYWJj\n-----END PRIVATE KEY-----']) {
      expect(() => tlsAdapter.forNode({ ...node, tlsCa })).toThrow(/PEM/);
    }
    const tlsCa = '-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----';
    expect(() => tlsAdapter.forNode({ ...node, useSSL: false, tlsCa })).toThrow(/private TLS/);
    expect(() => tlsAdapter.forNode({ ...node, useKeeperNode: true, tlsCa })).toThrow(/private TLS/);
    expect(TcpSocket.connectTLS).not.toHaveBeenCalled();
  });

});
