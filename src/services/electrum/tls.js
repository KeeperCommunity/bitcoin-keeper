/** Electrum TLS always verifies both the chain and the selected peer identity. */

const MAX_CA_LENGTH = 16384;
const CERTIFICATE_PEM = /^-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+\s+-----END CERTIFICATE-----$/;

function validatedCa(node) {
  const ca = node.tlsCa?.trim();
  if (!ca) return undefined;
  if (node.useKeeperNode || !node.useSSL) {
    throw new Error('Custom certificate trust requires a private TLS node');
  }
  if (ca.length > MAX_CA_LENGTH || !CERTIFICATE_PEM.test(ca)) {
    throw new Error('Provide one PEM CA or server certificate, obtained from your node operator');
  }
  return ca;
}

function connect(config, callback, ca) {
  // Load the native bridge only when a TLS socket is requested.
  const socketModule = require('react-native-tcp-socket');
  const TcpSocket = socketModule.__esModule ? socketModule.default : socketModule;
  return TcpSocket.connectTLS(
    {
      port: config.port,
      host: config.host,
      rejectUnauthorized: true,
      tlsCheckValidity: true,
      // Identity is always the selected host, including IP-address SANs.
      servername: config.host,
      ...(ca ? { ca } : {}),
    },
    callback
  );
}

// Bind explicit trust to one selected node. A reconnect/failover gets a new adapter;
// custom trust must never leak to another peer or be supplied by a remote message.
function forNode(node) {
  const ca = validatedCa(node);
  const { host, port } = node;
  return {
    connect(config, callback) {
      if (config.host !== host || Number(config.port) !== Number(port)) {
        throw new Error('TLS connection does not match selected node');
      }
      return connect(config, callback, ca);
    },
  };
}

module.exports.connect = (config, callback) => connect(config, callback);
module.exports.forNode = forNode;
