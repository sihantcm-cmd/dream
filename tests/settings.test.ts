import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, publicSettings, settingsEnvironment, updateSettings } from '../server/settings.ts';

test('API settings preserve omitted keys, only clear explicitly, and never return key values', () => {
  const original = { ...DEFAULT_SETTINGS, deepseekApiKey: 'synthetic-deepseek-secret', dashscopeApiKey: 'synthetic-dashscope-secret' };
  const updated = updateSettings(original, { deepseekApiKey: '', dashscopeImageModel: 'qwen-image-3.0' });
  assert.equal(updated.deepseekApiKey, original.deepseekApiKey);
  assert.equal(updated.dashscopeApiKey, original.dashscopeApiKey);
  assert.equal(updateSettings(updated, { clearDeepseekKey: true }).deepseekApiKey, '');
  assert.deepEqual(publicSettings(updated), { deepseekModel: 'deepseek-v4-pro', deepseekReasoningEffort: 'max', dashscopeAsrModel: 'qwen-audio-3.1-asr-flash', dashscopeImageModel: 'qwen-image-3.0', dashscopeWorkspaceId: '', deepseekKeyConfigured: true, dashscopeKeyConfigured: true });
  assert.throws(() => updateSettings(original, { deepseekApiKey: 'synthetic-new-secret', clearDeepseekKey: true }));
  assert.throws(() => updateSettings(original, { dashscopeWorkspaceId: 'https://attacker.invalid' }));
  assert.throws(() => updateSettings(original, { deepseekReasoningEffort: 'invalid' }));
  assert.equal(settingsEnvironment({ ...DEFAULT_SETTINGS }).DEEPSEEK_API_KEY, '');
  assert.equal(settingsEnvironment(original).ONEIROS_AI_TIMEOUT_MS, '240000');
});
