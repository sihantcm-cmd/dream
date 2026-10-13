import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import type { Interpretation } from '../src/types.ts';
import { draftDream, temporaryArchive, tinyWav } from './fixtures.ts';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVhcAAAAASUVORK5CYII=';
type UpstreamRequest = { host: string; pathname: string; method: string; body: any };

async function unusedPort() {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const address = socket.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill();
  await exited;
}

async function contractServer(t: TestContext, environment: Record<string, string> = {}) {
  const dataDirectory = await temporaryArchive('domestic-contract');
  const port = await unusedPort();
  const requestsFile = path.join(dataDirectory, 'requests.jsonl');
  const scenarioFile = path.join(dataDirectory, 'scenario.json');
  await writeFile(scenarioFile, '{}', 'utf8');
  await writeFile(requestsFile, '', 'utf8');
  const baseUrl = `http://127.0.0.1:${port}`;
  let output = '';
  const child = spawn(process.execPath, ['--import', 'tsx', '--import', './tests/fakeDomestic.mjs', 'server.ts'], {
    cwd: appRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dataDirectory,
      AI_TEXT_PROVIDER: 'deepseek', AI_MEDIA_PROVIDER: 'dashscope', GEMINI_API_KEY: '',
      DEEPSEEK_API_KEY: 'deepseek-contract-only', DASHSCOPE_API_KEY: 'dashscope-contract-only',
      DEEPSEEK_MODEL: 'deepseek-flash', DASHSCOPE_ASR_MODEL: 'qwen3-asr-flash', DASHSCOPE_IMAGE_MODEL: 'qwen-image-2.0',
      DEEPSEEK_REASONING_EFFORT: 'none',
      DASHSCOPE_WORKSPACE_ID: '', ONEIROS_CONTRACT_TEST: '1', FAKE_DOMESTIC_REQUESTS: requestsFile, FAKE_DOMESTIC_SCENARIO: scenarioFile,
      ...environment,
    },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => { await stop(child); await rm(dataDirectory, { recursive: true, force: true }); });
  let spawnError: Error | undefined;
  child.once('error', (error) => { spawnError = error; });
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk) => { output = (output + chunk.toString()).slice(-12_000); });
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Domestic contract server exited before readiness:\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) { ready = true; break; }
    } catch (error) {
      if ((error as { cause?: NodeJS.ErrnoException })?.cause?.code === 'EACCES') {
        throw new Error('Sandbox blocks loopback HTTP. Every upstream AI call is mocked; these tests require local network access.', { cause: error });
      }
    }
    await delay(100);
  }
  assert.ok(ready, `Domestic contract server did not become ready:\n${output}`);
  return {
    dataDirectory,
    async request(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
      return fetch(`${baseUrl}${route}`, {
        method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000),
      });
    },
    async scenario(mode = '') { await writeFile(scenarioFile, JSON.stringify({ mode }), 'utf8'); },
    async upstreamRequests(): Promise<UpstreamRequest[]> {
      const contents = (await readFile(requestsFile, 'utf8')).trim();
      return contents ? contents.split('\n').map((line) => JSON.parse(line)) : [];
    },
    output: () => output,
  };
}

async function jsonResponse(response: Response, status: number) {
  const text = await response.text();
  assert.equal(response.status, status, text);
  return JSON.parse(text);
}

test('DeepSeek and Qwen routes exercise real adapters with offline upstream transport', { timeout: 60_000 }, async (t) => {
  const server = await contractServer(t);
  let interpretation: Interpretation;
  let imageUrl: string;

  await t.test('health advertises domestic capabilities and truthful native image options', async () => {
    const health = await jsonResponse(await server.request('/api/health'), 200);
    assert.equal(health.aiConfigured, true);
    assert.equal(health.textProvider, 'deepseek');
    assert.equal(health.mediaProvider, 'dashscope');
    assert.deepEqual(health.capabilities, { interpret: true, chat: true, transcribe: true, image: true });
    assert.deepEqual(health.imageOptions.resolutions, ['native']);
    assert.ok(health.imageOptions.aspectRatios.includes('1:1'));
    assert.equal((await server.upstreamRequests()).length, 0, 'Health must not make a paid upstream request.');
  });

  await t.test('DeepSeek interpretation requests JSON mode and validates its structure', async () => {
    interpretation = await jsonResponse(await server.request('/api/interpret', { transcript: 'A blue doorway appeared in my garden.', emotionalNotes: 'Curious' }), 200);
    assert.equal(interpretation.title, 'The Blue Door');
    const [call] = await server.upstreamRequests();
    assert.equal(call.host, 'api.deepseek.com');
    assert.equal(call.pathname, '/chat/completions');
    assert.equal(call.body.model, 'deepseek-flash');
    assert.equal(call.body.stream, false);
    assert.deepEqual(call.body.thinking, { type: 'disabled' });
    assert.deepEqual(call.body.response_format, { type: 'json_object' });
    assert.ok(call.body.max_tokens >= 4096);
    assert.match(JSON.stringify(call.body.messages), /json/i);
    assert.match(JSON.stringify(call.body.messages), /A blue doorway appeared in my garden/);
  });

  await t.test('Qwen transcription embeds WAV bytes and preserves verbatim output', async () => {
    const audioBase64 = tinyWav().toString('base64');
    const result = await jsonResponse(await server.request('/api/transcribe', { audioBase64, mimeType: 'audio/wav;codecs=1' }), 200);
    assert.equal(result.transcript, 'I walked through a quiet garden beside a blue door.');
    const call = (await server.upstreamRequests()).at(-1)!;
    assert.equal(call.host, 'dashscope.aliyuncs.com');
    assert.equal(call.pathname, '/compatible-mode/v1/chat/completions');
    assert.equal(call.body.model, 'qwen3-asr-flash');
    assert.deepEqual(call.body.messages, [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${audioBase64}` } }] }]);
    assert.deepEqual(call.body.asr_options, { enable_itn: false });
  });

  await t.test('Qwen image output is downloaded without credentials and persisted locally', async () => {
    const result = await jsonResponse(await server.request('/api/generate-image', { prompt: interpretation.surrealistImagePrompt, imageSize: 'native', aspectRatio: '16:9' }), 200);
    imageUrl = result.imageUrl;
    assert.equal(result.imageSize, 'native');
    assert.equal(result.aspectRatio, '16:9');
    assert.match(imageUrl, /^\/media\/[a-f0-9-]+\.png$/);
    const expected = Buffer.from(imageBase64, 'base64');
    assert.deepEqual(await readFile(path.join(server.dataDirectory, imageUrl.slice(1))), expected);
    const fetched = await server.request(imageUrl);
    assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), expected);
    const calls = await server.upstreamRequests();
    const call = calls.at(-2)!;
    assert.equal(call.pathname, '/api/v1/services/aigc/multimodal-generation/generation');
    assert.equal(call.body.model, 'qwen-image-2.0');
    assert.deepEqual(call.body.parameters, { size: '1664*928', n: 1, prompt_extend: false, watermark: false });
    assert.match(JSON.stringify(call.body.input.messages), /quiet blue doorway/);
    assert.equal(calls.at(-1)!.method, 'GET');
  });

  await t.test('generated interpretation, media, and chat survive archive round trips', async () => {
    const saved = await jsonResponse(await server.request('/api/dreams', {
      ...draftDream('domestic-generated'), status: 'complete', resolution: 'native', title: interpretation.title,
      interpretation, imageUrl, imagePrompt: interpretation.surrealistImagePrompt,
    }), 201);
    assert.equal(saved.dream.resolution, 'native');
    const chat = await jsonResponse(await server.request('/api/chat-symbol', {
      messages: [{ role: 'user', content: 'Why the door?' }, { role: 'model', content: 'How did it feel?' }, { role: 'user', content: 'I was curious.' }],
      dreamContext: { title: interpretation.title, transcript: 'I was in the garden.' }, modelName: 'deepseek-v4-pro',
    }), 200);
    assert.match(chat.reply, /personal memory/);
    assert.equal(chat.modelUsed, 'deepseek-v4-pro');
    const call = (await server.upstreamRequests()).at(-1)!;
    assert.deepEqual(call.body.messages.map((message: any) => message.role), ['system', 'user', 'assistant', 'user']);
    assert.match(call.body.messages[0].content, /The Blue Door/);
    assert.equal(call.body.response_format, undefined);
    const chatHistory = [{ role: 'model', content: chat.reply, timestamp: '2026-10-14T00:00:00.000Z' }];
    await jsonResponse(await server.request('/api/dreams/domestic-generated/chat', { chatHistory }, 'PATCH'), 200);
    const confirmed = (await jsonResponse(await server.request('/api/dreams/domestic-generated'), 200)).dream;
    assert.deepEqual(confirmed.interpretation, interpretation);
    assert.deepEqual(confirmed.chatHistory, chatHistory);
    assert.equal(confirmed.imageUrl, imageUrl);
  });

  await t.test('unsupported image settings and audio formats fail before an upstream request', async () => {
    const before = (await server.upstreamRequests()).length;
    await jsonResponse(await server.request('/api/generate-image', { prompt: 'A garden', imageSize: '4K' }), 400);
    await jsonResponse(await server.request('/api/generate-image', { prompt: 'A garden', imageSize: 'native', aspectRatio: '9:16' }), 400);
    await jsonResponse(await server.request('/api/transcribe', { audioBase64: tinyWav().toString('base64'), mimeType: 'audio/webm' }), 400);
    assert.equal((await server.upstreamRequests()).length, before);
  });

  await t.test('long saved assistant replies remain usable in the next chat turn', async () => {
    const previousReply = '梦'.repeat(9_000);
    for (const role of ['model', 'assistant']) {
      const result = await jsonResponse(await server.request('/api/chat-symbol', {
        messages: [{ role: 'user', content: 'Tell me about the door.' }, { role, content: previousReply }, { role: 'user', content: 'What should I reflect on next?' }],
      }), 200);
      assert.match(result.reply, /personal memory/);
      const call = (await server.upstreamRequests()).at(-1)!;
      assert.equal(call.body.messages[2].role, 'assistant');
      assert.equal(call.body.messages[2].content, previousReply);
    }
    const before = (await server.upstreamRequests()).length;
    await jsonResponse(await server.request('/api/chat-symbol', {
      messages: [{ role: 'user', content: '梦'.repeat(8_001) }],
    }), 400);
    assert.equal((await server.upstreamRequests()).length, before, 'User input must keep its 8,000-character limit.');
  });

  await t.test('upstream auth, quota, and network failures are safe and never auto-retried', async () => {
    for (const [mode, route, body, expectedCode] of [
      ['auth', '/api/interpret', { transcript: 'A garden' }, 'AI_KEY_INVALID'],
      ['quota', '/api/generate-image', { prompt: 'A garden', imageSize: 'native' }, 'AI_QUOTA_EXCEEDED'],
      ['network', '/api/chat-symbol', { messages: [{ role: 'user', content: 'Hello' }] }, 'AI_CONNECTION_FAILED'],
    ] as const) {
      await server.scenario(mode);
      const before = (await server.upstreamRequests()).length;
      const error = await jsonResponse(await server.request(route, body), 502);
      assert.equal(error.code, expectedCode);
      assert.doesNotMatch(JSON.stringify(error), /sk-secret|contract-only/);
      assert.equal((await server.upstreamRequests()).length, before + 1);
    }
    await server.scenario();
    assert.doesNotMatch(server.output(), /sk-secret-must-not-leak/);
  });

  await t.test('malformed, truncated, incomplete and empty replies cannot become successful dreams', async () => {
    for (const mode of ['malformed', 'truncated', 'incomplete', 'invalid-json']) {
      await server.scenario(mode);
      const error = await jsonResponse(await server.request('/api/interpret', { transcript: 'A garden' }), 502);
      assert.equal(typeof error.error, 'string');
    }
    await server.scenario('empty');
    const error = await jsonResponse(await server.request('/api/transcribe', { audioBase64: tinyWav().toString('base64'), mimeType: 'audio/wav' }), 502);
    assert.equal(error.code, 'AI_INVALID_RESPONSE');
    await server.scenario();
  });

  await t.test('untrusted image URLs, unsafe redirects and fake image bytes are rejected', async () => {
    for (const mode of ['unsafe-image-url', 'redirect-unsafe', 'non-image']) {
      await server.scenario(mode);
      const before = (await server.upstreamRequests()).length;
      const error = await jsonResponse(await server.request('/api/generate-image', { prompt: 'A garden', imageSize: 'native' }), 502);
      assert.equal(typeof error.error, 'string');
      const calls = (await server.upstreamRequests()).slice(before);
      assert.ok(calls.every((call) => call.host !== '127.0.0.1'));
      assert.equal(calls.length, mode === 'unsafe-image-url' ? 1 : 2);
    }
    await server.scenario();
  });

  await t.test('generated analysis rejects blank fields while empty associations and saved drafts remain valid', async () => {
    for (const field of [
      'title', 'coreTheme', 'unconsciousTension', 'dominantMood', 'individuationGuidance', 'surrealistImagePrompt',
      'archetypes.name', 'archetypes.description', 'archetypes.appearanceInDream',
      'symbols.symbol', 'symbols.archetypalMeaning', 'symbols.personalReflectionPrompt',
    ]) {
      await server.scenario(`blank-${field}`);
      const error = await jsonResponse(await server.request('/api/interpret', { transcript: 'A garden' }), 502);
      assert.match(error.error, /incomplete interpretation/, `Blank ${field} must not be accepted as an analysis.`);
    }
    await server.scenario('no-associations');
    const result = await jsonResponse(await server.request('/api/interpret', { transcript: 'A garden' }), 200);
    assert.deepEqual(result.archetypes, []);
    assert.deepEqual(result.symbols, []);
    const draft = draftDream('draft-with-empty-analysis');
    Object.assign(draft.interpretation, { coreTheme: '', unconsciousTension: '', dominantMood: '', individuationGuidance: '' });
    const saved = await jsonResponse(await server.request('/api/dreams', draft), 201);
    assert.deepEqual(saved.dream.interpretation, draft.interpretation);
    await server.scenario();
  });
});

test('provider readiness is independent and workspace endpoints are respected', { timeout: 60_000 }, async (t) => {
  const textOnly = await contractServer(t, { DASHSCOPE_API_KEY: '' });
  const health = await jsonResponse(await textOnly.request('/api/health'), 200);
  assert.equal(health.aiConfigured, false);
  assert.deepEqual(health.capabilities, { interpret: true, chat: true, transcribe: false, image: false });
  await jsonResponse(await textOnly.request('/api/interpret', { transcript: 'A garden' }), 200);
  for (const [route, body] of [
    ['/api/generate-image', { prompt: 'A garden', imageSize: 'native' }],
    ['/api/transcribe', { audioBase64: tinyWav().toString('base64'), mimeType: 'audio/wav' }],
  ] as const) {
    const error = await jsonResponse(await textOnly.request(route, body), 503);
    assert.equal(error.code, 'AI_NOT_CONFIGURED');
  }
  assert.equal((await textOnly.upstreamRequests()).length, 1);

  const mediaOnly = await contractServer(t, { DEEPSEEK_API_KEY: '', DASHSCOPE_WORKSPACE_ID: 'contractspace' });
  const mediaHealth = await jsonResponse(await mediaOnly.request('/api/health'), 200);
  assert.deepEqual(mediaHealth.capabilities, { interpret: false, chat: false, transcribe: true, image: true });
  const missingText = await jsonResponse(await mediaOnly.request('/api/chat-symbol', { messages: [{ role: 'user', content: 'Hello' }] }), 503);
  assert.equal(missingText.code, 'AI_NOT_CONFIGURED');
  await jsonResponse(await mediaOnly.request('/api/transcribe', { audioBase64: tinyWav().toString('base64'), mimeType: 'audio/wav' }), 200);
  const [workspaceCall] = await mediaOnly.upstreamRequests();
  assert.equal(workspaceCall.host, 'contractspace.cn-beijing.maas.aliyuncs.com');
});

test('quality models use full reasoning, current transcription protocol, and native 2K image dimensions', { timeout: 60_000 }, async (t) => {
  const server = await contractServer(t, {
    DEEPSEEK_MODEL: 'deepseek-v4-pro', DEEPSEEK_REASONING_EFFORT: 'max',
    DASHSCOPE_ASR_MODEL: 'qwen-audio-3.1-asr-flash', DASHSCOPE_IMAGE_MODEL: 'qwen-image-3.0-pro',
  });

  await t.test('health exposes the selected quality options without any upstream call', async () => {
    const health = await jsonResponse(await server.request('/api/health'), 200);
    assert.equal(health.textModel, 'deepseek-v4-pro');
    assert.equal(health.textReasoningEffort, 'max');
    assert.equal(health.transcriptionModel, 'qwen-audio-3.1-asr-flash');
    assert.equal(health.imageModel, 'qwen-image-3.0-pro');
    assert.ok(health.aiRequestTimeoutMs >= 660_000);
    assert.deepEqual(health.imageOptions.dimensions, { '1:1': [2048, 2048], '4:3': [2304, 1728], '16:9': [2688, 1512] });
    assert.equal((await server.upstreamRequests()).length, 0);
  });

  await t.test('both interpretation and chat enable maximum reasoning and sufficient output budget', async () => {
    await jsonResponse(await server.request('/api/interpret', { transcript: 'A blue door opened onto the ocean.' }), 200);
    const reply = await jsonResponse(await server.request('/api/chat-symbol', { messages: [{ role: 'user', content: 'What does the door remind me of?' }] }), 200);
    assert.equal(reply.modelUsed, 'deepseek-v4-pro');
    const calls = await server.upstreamRequests();
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.body.model, 'deepseek-v4-pro');
      assert.deepEqual(call.body.thinking, { type: 'enabled' });
      assert.equal(call.body.reasoning_effort, 'max');
      assert.equal(call.body.max_tokens, 65_536);
    }
    assert.deepEqual(calls[0].body.response_format, { type: 'json_object' });
    assert.equal(calls[1].body.response_format, undefined);
  });

  await t.test('ASR 3.1 sends self-describing WAV through the multimodal endpoint and reads output.text', async () => {
    const audioBase64 = tinyWav().toString('base64');
    const result = await jsonResponse(await server.request('/api/transcribe', { audioBase64, mimeType: 'audio/wav' }), 200);
    assert.equal(result.transcript, 'I walked through a quiet garden beside a blue door.');
    const call = (await server.upstreamRequests()).at(-1)!;
    assert.equal(call.pathname, '/api/v1/services/aigc/multimodal-generation/generation');
    assert.equal(call.body.model, 'qwen-audio-3.1-asr-flash');
    assert.deepEqual(call.body.input.messages, [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${audioBase64}` } }] }]);
    assert.deepEqual(call.body.parameters, { format: 'wav' });
    for (const mode of ['empty', 'asr-missing-text', 'asr-nontext']) {
      await server.scenario(mode);
      const error = await jsonResponse(await server.request('/api/transcribe', { audioBase64, mimeType: 'audio/wav' }), 502);
      assert.equal(error.code, 'AI_INVALID_RESPONSE');
    }
    await server.scenario();
  });

  await t.test('Image 3.0 Pro enables prompt and scene reasoning at each supported native size', async () => {
    for (const [aspectRatio, size] of [['1:1', '2048*2048'], ['4:3', '2304*1728'], ['16:9', '2688*1512']]) {
      const result = await jsonResponse(await server.request('/api/generate-image', { prompt: 'A quiet garden with a blue doorway', imageSize: 'native', aspectRatio }), 200);
      assert.equal(result.imageSize, 'native');
      assert.equal(result.aspectRatio, aspectRatio);
      const call = (await server.upstreamRequests()).at(-2)!;
      assert.equal(call.pathname, '/api/v1/services/aigc/multimodal-generation/generation');
      assert.equal(call.body.model, 'qwen-image-3.0-pro');
      assert.deepEqual(call.body.parameters, { size, n: 1, prompt_extend: true, prompt_extend_mode: 'agent', enable_thinking: true, watermark: false });
    }
  });
});
