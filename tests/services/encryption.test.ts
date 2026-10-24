import {
  hash256,
  hash512,
  generateEncryptionKey,
  encrypt,
  decrypt,
  generateAESKey,
} from '../../src/utils/service-utilities/encryption';

describe('Testing cryptographic primitives', () => {
  test('hashing::sha256', () => {
    const hashed = hash256('sample-message');
    expect(hashed).toEqual('94cda233d1fc9c6d0dd3f375c8518e284ddbce939e7f59b6a681864011b13bd4');
  });

  test('hashing::sha512', () => {
    const hashed = hash512('sample-message');
    expect(hashed).toEqual(
      'd5ba4810e227fb65c4fbcd6f8428b1ad6714e6f78481f1680ef275beb4bb7a11382e84c88c3c6421c26db721095979323f364d8a4303f8099937fd9d768b1681'
    );
  });

  test('hashing::empty input', () => {
    const hashed256 = hash256('');
    const hashed512 = hash512('');
    expect(hashed256).toBeDefined();
    expect(hashed512).toBeDefined();
  });

  let key = '';
  beforeAll(() => {
    const seed = 'sample-seed';
    key = generateEncryptionKey(seed);
  });

  test('key generation', () => {
    expect(key.length).toBe(64);
    expect(key).toBe('895a086afeff7aa154295bc31965fc133e727682dd886de01138d153d2b27aae');
  });

  test('generateAESKey::Valid length', () => {
    const key128 = generateAESKey(16);
    const key192 = generateAESKey(24);
    const key256 = generateAESKey(32);
    expect(key128.length).toBe(32); // 128 bits in hex
    expect(key192.length).toBe(48); // 192 bits in hex
    expect(key256.length).toBe(64); // 256 bits in hex
  });

  test('generateAESKey::Invalid length', () => {
    expect(() => generateAESKey(10)).toThrow(
      'Invalid key length. AES supports 128, 192, or 256-bit keys.'
    );
  });

  let encrypted;
  const message = 'sample-message';
  test('Encryption::AES', () => {
    encrypted = encrypt(key, message);
    expect(encrypted).not.toBeUndefined();
    expect(typeof encrypted).toBe('string');
    expect(encrypted.length).toBeGreaterThan(0);
  });

  test('Decryption::AES', () => {
    const decrypted = decrypt(key, encrypted);
    expect(decrypted).toBe(message);
  });

  test('Encryption::Empty message', () => {
    const emptyEncrypted = encrypt(key, '');
    expect(emptyEncrypted).not.toBeUndefined();
    expect(typeof emptyEncrypted).toBe('string');
    expect(emptyEncrypted.length).toBeGreaterThan(0);
  });

  test('Decryption::Empty message', () => {
    const emptyEncrypted = encrypt(key, '');
    const decrypted = decrypt(key, emptyEncrypted);
    expect(decrypted).toBe('');
  });

  test('Decryption::Incorrect key', () => {
    const incorrectKey = 'a'.repeat(64);
    let decrypted: string;
    try {
      decrypted = decrypt(incorrectKey, encrypt(key, message));
    } catch (error) {
      expect(error).toEqual(new Error('Malformed UTF-8 data'));
      return;
    }
    expect(decrypted).not.toBe(message);
  });
});
