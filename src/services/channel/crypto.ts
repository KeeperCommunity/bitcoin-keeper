// Shared with Keeper Desktop: AES-256-GCM, 12-byte IV and 16-byte authentication tag.
const crypto = require('crypto');

export class InvalidChannelQRCodeError extends Error {
  constructor() {
    super('Invalid Desktop pairing code');
  }
}

const pairingKey = (password: string) => {
  if (!/^[a-f0-9]{64}$/i.test(password)) throw new InvalidChannelQRCodeError();
  return Buffer.from(password, 'hex');
};

export const createCipherGcm = (data: string, password: string) => {
  const algorithm = 'aes-256-gcm';
  const key = pairingKey(password);
  const iv = crypto.randomBytes(12); // 12 bytes for GCM
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    encryptedData: encrypted.toString('hex'),
    authTag: authTag.toString('hex'),
  };
};

interface DecryptData {
  iv: string;
  encryptedData: string;
  authTag: string;
}

export const createDecipherGcm = (data: DecryptData, password: string) => {
  const algorithm = 'aes-256-gcm';
  const key = pairingKey(password);
  const iv = Buffer.from(data.iv, 'hex');
  const encryptedText = Buffer.from(data.encryptedData, 'hex');
  const authTag = Buffer.from(data.authTag, 'hex');
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted: Buffer;

  try {
    decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
  } catch (err) {
    throw new Error(`Failed to decrypt data: ${err.message}`);
  }
  return JSON.parse(decrypted.toString('utf-8'));
};
