import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function key(): Buffer {
  const material =
    process.env.CAMERA_ENCRYPTION_KEY ??
    process.env.SESSION_SECRET ??
    (process.env.NODE_ENV === 'production' ? '' : 'elise-camera-development-key');
  if (!material) throw new Error('CAMERA_ENCRYPTION_KEY is required');
  return createHash('sha256').update(material).digest();
}

export function encryptCameraSecret(value: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), nonce);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [nonce, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString('base64url'))
    .join('.');
}

export function decryptCameraSecret(value: string): string {
  const [nonceValue, tagValue, encryptedValue] = value.split('.');
  if (!nonceValue || !tagValue || !encryptedValue)
    throw new Error('Invalid encrypted camera secret');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(nonceValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
