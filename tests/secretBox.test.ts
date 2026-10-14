import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { openSettings, sealSettings } from '../server/secretBox.ts';

test('settings encryption rejects another owner, changed ciphertext, and changed master key', () => {
  const key = randomBytes(32).toString('base64');
  const value = { deepseekApiKey: 'synthetic-test-credential', deepseekModel: 'model-test' };
  const encrypted = sealSettings(value, 'owner-a', key);
  assert.deepEqual(openSettings(encrypted, 'owner-a', key), value);
  assert.ok(!encrypted.includes(value.deepseekApiKey));
  assert.notEqual(sealSettings(value, 'owner-a', key), encrypted);
  assert.throws(() => openSettings(encrypted, 'owner-b', key));
  assert.throws(() => openSettings(encrypted, 'owner-a', randomBytes(32).toString('base64')));
  const parts = encrypted.split('.');
  const ciphertext = Buffer.from(parts[3], 'base64url'); ciphertext[0] ^= 1;
  parts[3] = ciphertext.toString('base64url');
  assert.throws(() => openSettings(parts.join('.'), 'owner-a', key));
  assert.throws(() => sealSettings(value, 'owner-a', 'short-key'));
});
