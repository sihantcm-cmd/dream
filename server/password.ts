import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(nodeScrypt);
export function validPasswordHash(value: string): boolean {
  return /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(value);
}
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 14 || password.length > 256) throw new Error('Use a password between 14 and 256 characters.');
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!validPasswordHash(stored) || password.length > 256) return false;
  const [, salt, expected] = stored.split('$');
  const derived = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqual(derived, Buffer.from(expected, 'hex'));
}
