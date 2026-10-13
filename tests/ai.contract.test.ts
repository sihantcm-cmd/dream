import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import type { Interpretation } from '../src/types.ts';
import { draftDream, temporaryArchive, tinyWav } from './fixtures.ts';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVhcAAAAASUVORK5CYII=';

async function unusedPort() {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
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

async function contractServer(t: TestContext) {
  const dataDirectory = await temporaryArchive('ai-contract');
  t.after(() => rm(dataDirectory, { recursive: true, force: true }));
  const port = await unusedPort();
  const requestsFile = path.join(dataDirectory, 'fake-gemini-requests.jsonl');
  const baseUrl = `http://127.0.0.1:${port}`;
  let output = '';
  const child = spawn(process.execPath, ['--import', 'tsx', '--import', './tests/fakeGemini.mjs', 'server.ts'], {
    cwd: appRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dataDirectory,
      AI_TEXT_PROVIDER: 'gemini', AI_MEDIA_PROVIDER: 'gemini', DEEPSEEK_API_KEY: '', DASHSCOPE_API_KEY: '',
      GEMINI_API_KEY: 'contract-test-only', ONEIROS_CONTRACT_TEST: '1', FAKE_GEMINI_REQUESTS: requestsFile,
      GEMINI_TEXT_MODEL: 'gemini-3.8-flash', GEMINI_IMAGE_MODEL: 'gemini-nano-banana-2.1', GEMINI_TRANSCRIPTION_MODEL: 'gemini-3.5-transcribe',
      GOOGLE_GENAI_USE_VERTEXAI: 'false', GOOGLE_GEMINI_BASE_URL: '', GOOGLE_VERTEX_BASE_URL: '',
    },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => stop(child));
  let spawnError: Error | undefined;
  child.once('error', (error) => { spawnError = error; });
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk) => { output = (output + chunk.toString()).slice(-12_000); });
  }
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Contract server exited before readiness:\n${output}`);
    try {
      const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
      if (health.ok) { ready = true; break; }
    } catch (error) {
      if ((error as { cause?: NodeJS.ErrnoException })?.cause?.code === 'EACCES') {
        throw new Error('Sandbox blocks loopback HTTP. These isolated tests need local network access; every upstream Gemini call is mocked.', { cause: error });
      }
    }
    await delay(100);
  }
  assert.ok(ready, `Contract server did not become ready:\n${output}`);
  return {
    dataDirectory,
    async request(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
      return fetch(`${baseUrl}${route}`, {
        method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000),
      });
    },
    async upstreamRequests(): Promise<Array<{ pathname: string; body: any }>> {
      const text = await readFile(requestsFile, 'utf8');
      return text.trim().split('\n').map((line) => JSON.parse(line));
    },
  };
}

async function jsonResponse(response: Response, status: number) {
  const text = await response.text();
  assert.equal(response.status, status, text);
  return JSON.parse(text);
}

test('AI routes exercise the real Gemini SDK with an offline upstream transport', { timeout: 60_000 }, async (t) => {
  const server = await contractServer(t);
  let interpretation: Interpretation;
  let imageUrl: string;

  await t.test('structured interpretation uses the configured model and validates returned fields', async () => {
    interpretation = await jsonResponse(await server.request('/api/interpret', { transcript: 'A blue doorway appeared in my garden.', emotionalNotes: 'Curious' }), 200);
    assert.equal(interpretation.title, 'The Blue Door');
    assert.equal(interpretation.symbols[0].symbol, 'Door');
    const [call] = await server.upstreamRequests();
    assert.match(call.pathname, /\/models\/gemini-3\.8-flash:generateContent$/);
    assert.equal(call.body.generationConfig.responseMimeType, 'application/json');
    assert.ok(call.body.generationConfig.responseSchema.required.includes('surrealistImagePrompt'));
    assert.match(JSON.stringify(call.body.contents), /A blue doorway appeared in my garden/);
  });

  await t.test('well-formed JSON missing interpretation fields fails with HTTP 502', async () => {
    const result = await jsonResponse(await server.request('/api/interpret', { transcript: 'contract-incomplete-interpretation' }), 502);
    assert.match(result.error, /incomplete interpretation/i);
  });

  await t.test('image interactions preserve requested size and ratio and persist actual bytes', async () => {
    const result = await jsonResponse(await server.request('/api/generate-image', {
      prompt: interpretation.surrealistImagePrompt, imageSize: '2K', aspectRatio: '16:9',
    }), 200);
    imageUrl = result.imageUrl;
    assert.match(imageUrl, /^\/media\/[a-f0-9-]+\.png$/);
    assert.equal(result.imageSize, '2K');
    assert.equal(result.aspectRatio, '16:9');
    const expected = Buffer.from(imageBase64, 'base64');
    assert.deepEqual(await readFile(path.join(server.dataDirectory, imageUrl.slice(1))), expected);
    const media = await server.request(imageUrl);
    assert.equal(media.status, 200);
    assert.match(media.headers.get('content-type') || '', /image\/png/);
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), expected);
    const call = (await server.upstreamRequests()).at(-1)!;
    assert.match(call.pathname, /\/interactions$/);
    assert.equal(call.body.model, 'gemini-nano-banana-2.1');
    assert.deepEqual(call.body.response_format, { type: 'image', aspect_ratio: '16:9', image_size: '2K' });
  });

  await t.test('transcription uses Interactions verbatim mode and consumes SDK output_text', async () => {
    const audioBase64 = tinyWav().toString('base64');
    const result = await jsonResponse(await server.request('/api/transcribe', { audioBase64, mimeType: 'audio/wav;codecs=1' }), 200);
    assert.equal(result.transcript, 'I walked through a quiet garden beside a blue door.');
    const call = (await server.upstreamRequests()).at(-1)!;
    assert.match(call.pathname, /\/interactions$/);
    assert.equal(call.body.model, 'gemini-3.5-transcribe');
    assert.deepEqual(call.body.input, [{ type: 'audio', mime_type: 'audio/wav', data: audioBase64 }]);
    assert.deepEqual(call.body.generation_config.transcription_config.mode, { type: 'verbatim' });
  });

  await t.test('successful generation can be saved through the real archive API', async () => {
    const dream = { ...draftDream('ai-generated'), status: 'complete', title: interpretation.title, interpretation, imageUrl, imagePrompt: interpretation.surrealistImagePrompt };
    const saved = await jsonResponse(await server.request('/api/dreams', dream), 201);
    assert.equal(saved.dream.status, 'complete');
    const list = await jsonResponse(await server.request('/api/dreams'), 200);
    assert.equal(list.dreams[0].imageUrl, imageUrl);
    assert.equal(list.dreams[0].interpretation.title, interpretation.title);
  });

  await t.test('chat sends conversation roles and context and returns the selected model', async () => {
    const result = await jsonResponse(await server.request('/api/chat-symbol', {
      messages: [{ role: 'user', content: 'Why the door?' }, { role: 'model', content: 'How did it feel?' }, { role: 'user', content: 'I was curious.' }],
      dreamContext: { title: 'The Blue Door', transcript: 'I was in the garden.' }, modelName: 'gemini-3.1-flash-lite',
    }), 200);
    assert.match(result.reply, /personal memory/);
    assert.equal(result.modelUsed, 'gemini-3.1-flash-lite');
    const call = (await server.upstreamRequests()).at(-1)!;
    assert.match(call.pathname, /\/models\/gemini-3\.1-flash-lite:generateContent$/);
    assert.deepEqual(call.body.contents.map((item: any) => item.role), ['user', 'model', 'user']);
    assert.match(JSON.stringify(call.body.systemInstruction), /The Blue Door/);
  });

  await t.test('empty model chat response fails with HTTP 502', async () => {
    const result = await jsonResponse(await server.request('/api/chat-symbol', { messages: [{ role: 'user', content: 'contract-empty-chat' }] }), 502);
    assert.equal(typeof result.error, 'string');
    assert.equal((await server.upstreamRequests()).length, 6);
  });
});
