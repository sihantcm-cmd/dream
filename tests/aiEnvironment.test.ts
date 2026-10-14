import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { getAiEnvironment, getAiTimeoutMs, runWithAiEnvironment } from '../server/aiEnvironment.ts';
import { getAiConfig } from '../server/aiConfig.ts';
import { AiProviderError, deepseekText, testProviderConnection } from '../server/domesticAi.ts';

test('concurrent AI requests retain independent immutable keys, models, reasoning and timeout caps', async (t) => {
  const calls: Array<{ url: string; key: string; body: any; contextKey: string | undefined; timeout: number }> = [];
  const timeouts: Array<{ key: string | undefined; milliseconds: number }> = [];
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    timeouts.push({ key: getAiEnvironment().DEEPSEEK_API_KEY, milliseconds });
    return originalTimeout(milliseconds);
  });
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options: RequestInit) => {
    const key = new Headers(options.headers).get('Authorization')!;
    // Resume in the opposite order, after both asynchronous scopes overlap.
    await delay(key.includes('request-a') ? 20 : 1);
    calls.push({ url: String(url), key, body: JSON.parse(String(options.body)),
      contextKey: getAiEnvironment().DEEPSEEK_API_KEY, timeout: getAiTimeoutMs(600_000) });
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: `Answer for ${key}` } }] }), { status: 200 });
  });
  const a = { DEEPSEEK_API_KEY: 'request-a', DEEPSEEK_MODEL: 'model-a', DEEPSEEK_REASONING_EFFORT: 'max', ONEIROS_AI_TIMEOUT_MS: '240000' };
  const b = { DEEPSEEK_API_KEY: 'request-b', DEEPSEEK_MODEL: 'model-b', DEEPSEEK_REASONING_EFFORT: 'none', ONEIROS_AI_TIMEOUT_MS: '35000' };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const invoke = (environment: typeof a) => runWithAiEnvironment(environment, async () => {
    await gate;
    assert.ok(Object.isFrozen(getAiEnvironment()));
    const config = getAiConfig();
    const text = await deepseekText({ model: config.textModel, messages: [{ role: 'user', content: 'Synthetic request.' }] });
    return { config, text, key: getAiEnvironment().DEEPSEEK_API_KEY };
  });
  const pendingA = invoke(a);
  const pendingB = invoke(b);
  a.DEEPSEEK_API_KEY = 'mutated-after-request-start';
  a.ONEIROS_AI_TIMEOUT_MS = '1';
  release();
  const [resultA, resultB] = await Promise.all([pendingA, pendingB]);
  assert.equal(resultA.text, 'Answer for Bearer request-a');
  assert.equal(resultB.text, 'Answer for Bearer request-b');
  assert.equal(resultA.config.textModel, 'model-a');
  assert.equal(resultB.config.textModel, 'model-b');
  assert.equal(resultA.config.textReasoningEffort, 'max');
  assert.equal(resultB.config.textReasoningEffort, 'none');
  assert.equal(resultA.config.aiRequestTimeoutMs, 300_000);
  assert.equal(resultB.config.aiRequestTimeoutMs, 95_000);
  assert.equal(resultA.key, 'request-a');
  assert.equal(resultB.key, 'request-b');
  const callA = calls.find((call) => call.key === 'Bearer request-a')!;
  const callB = calls.find((call) => call.key === 'Bearer request-b')!;
  assert.equal(callA.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(callA.body.reasoning_effort, 'max');
  assert.deepEqual(callA.body.thinking, { type: 'enabled' });
  assert.equal(callA.contextKey, 'request-a');
  assert.equal(callA.timeout, 240_000);
  assert.deepEqual(callB.body.thinking, { type: 'disabled' });
  assert.equal(callB.body.reasoning_effort, undefined);
  assert.equal(callB.contextKey, 'request-b');
  assert.equal(callB.timeout, 35_000);
  assert.deepEqual(timeouts, [{ key: 'request-a', milliseconds: 240_000 }, { key: 'request-b', milliseconds: 35_000 }]);
});

test('empty request configuration never borrows host credentials and nested scopes restore their parent', async (t) => {
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'host-key-not-for-cloud-requests';
  t.after(() => {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  });
  const upstream = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected upstream request.'); });
  assert.equal(getAiEnvironment(), process.env);
  await runWithAiEnvironment({}, async () => {
    assert.equal(getAiEnvironment().DEEPSEEK_API_KEY, undefined);
    assert.equal(getAiConfig().capabilities.interpret, false);
    await assert.rejects(deepseekText({ model: 'deepseek-v4-pro', messages: [] }),
      (error: unknown) => error instanceof AiProviderError && error.code === 'AI_NOT_CONFIGURED');
    await runWithAiEnvironment({ DEEPSEEK_API_KEY: 'nested-only' }, async () => {
      await delay(1);
      assert.equal(getAiEnvironment().DEEPSEEK_API_KEY, 'nested-only');
    });
    assert.equal(getAiEnvironment().DEEPSEEK_API_KEY, undefined);
  });
  assert.equal(upstream.mock.callCount(), 0);
  assert.equal(getAiEnvironment().DEEPSEEK_API_KEY, 'host-key-not-for-cloud-requests');
  for (const value of ['0', '-1', 'NaN', 'Infinity', '']) {
    assert.equal(runWithAiEnvironment({ ONEIROS_AI_TIMEOUT_MS: value }, () => getAiTimeoutMs(15_000)), 15_000);
  }
  assert.equal(runWithAiEnvironment({ ONEIROS_AI_TIMEOUT_MS: '300000' }, () => getAiTimeoutMs(15_000)), 15_000);
});

test('connection checks use fixed endpoints and one second of silence, without claiming image access', async (t) => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options: RequestInit) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify(options.method === 'GET' ? { data: [{ id: 'deepseek-v4-pro' }] } : { output: { text: '' } }), { status: 200 });
  });
  const results = await runWithAiEnvironment({ DEEPSEEK_API_KEY: 'deepseek-check', DASHSCOPE_API_KEY: 'dashscope-check', DASHSCOPE_WORKSPACE_ID: 'ws-test' }, async () => {
    return Promise.all([testProviderConnection('deepseek'), testProviderConnection('dashscope')]);
  });
  assert.deepEqual(results[0], { provider: 'deepseek', ok: true, tested: ['authentication', 'models'], imageTested: false });
  assert.deepEqual(results[1], { provider: 'dashscope', ok: true, tested: ['authentication', 'transcription'], model: 'qwen-audio-3.1-asr-flash', imageTested: false });
  assert.equal(calls[0].url, 'https://api.deepseek.com/models');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.body, undefined);
  assert.equal(new Headers(calls[0].options.headers).get('Authorization'), 'Bearer deepseek-check');
  assert.equal(calls[1].url, 'https://ws-test.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  assert.equal(new Headers(calls[1].options.headers).get('Authorization'), 'Bearer dashscope-check');
  assert.equal(new Headers(calls[1].options.headers).get('X-DashScope-SSE'), 'disable');
  const body = JSON.parse(String(calls[1].options.body));
  assert.equal(body.model, 'qwen-audio-3.1-asr-flash');
  const encoded = body.input.messages[0].content[0].input_audio.data;
  assert.ok(encoded.startsWith('data:audio/wav;base64,'));
  const wav = Buffer.from(encoded.split(',')[1], 'base64');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 16), 'WAVEfmt ');
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt32LE(40) / wav.readUInt32LE(28), 1);
  assert.ok(wav.subarray(44).every((byte) => byte === 0));
  assert.equal(calls.length, 2);
});

test('connection errors conceal provider payloads and reject unsafe workspace routing before fetch', async (t) => {
  const upstream = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { message: 'Invalid API key secret-echo-from-provider' } }), { status: 401 }));
  await runWithAiEnvironment({ DEEPSEEK_API_KEY: 'synthetic-secret' }, async () => {
    await assert.rejects(testProviderConnection('deepseek'), (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, 'AI_KEY_INVALID');
      assert.ok(!String(error).includes('secret'));
      return true;
    });
  });
  await runWithAiEnvironment({ DASHSCOPE_API_KEY: 'synthetic-secret', DASHSCOPE_WORKSPACE_ID: 'evil.example/path' }, async () => {
    await assert.rejects(testProviderConnection('dashscope'), (error: unknown) => error instanceof AiProviderError && error.code === 'AI_CONFIGURATION_INVALID');
  });
  assert.equal(upstream.mock.callCount(), 1);
});
