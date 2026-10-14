import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function encryptionKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey) {
    throw new Error('SETTINGS_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
}

export function validateEncryptionKey(key: string): void { encryptionKey(key); }

/** Each settings record is encrypted with its owner's ID as authenticated context. */
export function sealSettings(value: unknown, ownerId: string, encodedKey: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(encodedKey), nonce);
  cipher.setAAD(Buffer.from(ownerId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function openSettings(value: string, ownerId: string, encodedKey: string): unknown {
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Encrypted settings format is invalid.');
  const nonce = Buffer.from(parts[1], 'base64url'), tag = Buffer.from(parts[2], 'base64url');
  if (nonce.length !== 12 || tag.length !== 16) throw new Error('Encrypted settings format is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(encodedKey), nonce);
  decipher.setAAD(Buffer.from(ownerId));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}
