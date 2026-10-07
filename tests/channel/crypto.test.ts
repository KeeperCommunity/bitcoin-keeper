import { createCipherGcm, createDecipherGcm } from '../../src/services/channel/crypto';
import vectors from './desktop-crypto-vectors.json';
const crypto = require('crypto');

describe('Keeper Desktop AES-GCM wire contract', () => {
  afterEach(() => jest.restoreAllMocks());

  it('encrypts the signing request using the Desktop-compatible fixed vector', () => {
    jest
      .spyOn(crypto, 'randomBytes')
      .mockReturnValue(Buffer.from(vectors.request.ciphertext.iv, 'hex'));
    expect(createCipherGcm(JSON.stringify(vectors.request.plaintext), vectors.key)).toEqual(
      vectors.request.ciphertext
    );
  });

  it('decrypts the Desktop event/data/responseData response shape', () => {
    const response = createDecipherGcm(vectors.response.ciphertext, vectors.key);
    expect(response).toEqual(vectors.response.plaintext);
    expect(response.data.responseData.data.signedSerializedPSBT).toBe('fixture-only-signed-psbt');
  });

  it.each(['ADD_DEVICE', 'HEALTH_CHECK', 'REGISTER_MULTISIG', 'VERIFY_ADDRESS', 'SIGN_TX'])(
    'preserves the %s response action and nested data',
    (action) => {
      const response = {
        event: 'CHANNEL_MESSAGE',
        data: { responseData: { action, data: { address: 'disposable-testnet-address' } } },
      };
      expect(
        createDecipherGcm(createCipherGcm(JSON.stringify(response), vectors.key), vectors.key)
      ).toEqual(response);
    }
  );

  it.each(['iv', 'encryptedData', 'authTag'])(
    'rejects altered %s before returning signing data',
    (field) => {
      const encrypted = { ...vectors.response.ciphertext };
      encrypted[field] = (encrypted[field][0] === '0' ? '1' : '0') + encrypted[field].slice(1);
      expect(() => createDecipherGcm(encrypted, vectors.key)).toThrow();
    }
  );

  it.each(['invalid-qr', vectors.key + 'invalid', vectors.key.slice(1), '01'.repeat(16)])(
    'rejects malformed pairing codes before sending (%s)',
    (key) => {
      expect(() => createCipherGcm(JSON.stringify(vectors.request.plaintext), key)).toThrow(
        'Invalid Desktop pairing code'
      );
    }
  );

  it('rejects a response encrypted for a different QR session', () => {
    expect(() => createDecipherGcm(vectors.response.ciphertext, '01'.repeat(32))).toThrow();
  });
});
