import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { draftDream, temporaryArchive, tinyWav } from './fixtures.ts';

const appRoot = fileURLToPath(new URL('../', import.meta.url));

async function unusedPort(): Promise<number> {
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

async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill();
  await exited;
}

async function isolatedServer(t: TestContext) {
  const dataDirectory = await temporaryArchive('api');
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  let output = '';

  t.after(async () => {
    await stop(child);
    await rm(dataDirectory, { recursive: true, force: true });
  });

  async function start() {
    output = '';
    child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
      cwd: appRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        HOST: '127.0.0.1',
        DATA_DIR: dataDirectory,
        AI_TEXT_PROVIDER: 'deepseek',
        AI_MEDIA_PROVIDER: 'dashscope',
        DEEPSEEK_API_KEY: '',
        DASHSCOPE_API_KEY: '',
        GEMINI_API_KEY: '',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let spawnError: Error | undefined;
    child.once('error', (error) => { spawnError = error; });
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('data', (chunk) => { output = (output + chunk.toString()).slice(-12_000); });
    }
    for (let attempts = 0; attempts < 200; attempts++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`Server exited before readiness:\n${output}`);
      try {
        const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) return;
      } catch (error) {
        if ((error as { cause?: NodeJS.ErrnoException })?.cause?.code === 'EACCES') {
          throw new Error('The execution sandbox blocks loopback HTTP. Run these integration tests with local network access.', { cause: error });
        }
        // The subprocess may still be loading its TypeScript modules.
      }
      await delay(100);
    }
    throw new Error(`Server did not become ready:\n${output}`);
  }

  async function request(route: string, method = 'GET', body?: unknown) {
    return fetch(`${baseUrl}${route}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  }

  await start();
  return {
    baseUrl,
    dataDirectory,
    request,
    async restart() {
      await stop(child);
      await start();
    },
  };
}

async function jsonResponse(response: Response, status: number) {
  const text = await response.text();
  assert.equal(response.status, status, text);
  assert.match(response.headers.get('content-type') || '', /application\/json/i);
  return JSON.parse(text);
}

test('manual drafts, edits, chat, and deletion survive server restarts', { timeout: 60_000 }, async (t) => {
  const server = await isolatedServer(t);
  const draft = draftDream('manual-draft');
  const created = await jsonResponse(await server.request('/api/dreams', 'POST', draft), 201);
  assert.equal(created.dream.status, 'draft');
  assert.equal(created.dream.imageUrl, '');
  assert.equal(created.dream.transcript, draft.transcript);

  const duplicate = await jsonResponse(await server.request('/api/dreams', 'POST', draft), 409);
  assert.equal(typeof duplicate.error, 'string');
  const initialList = await jsonResponse(await server.request('/api/dreams'), 200);
  assert.equal(initialList.dreams.length, 1);
  assert.equal(initialList.dreams[0].id, draft.id);
  const fetched = await jsonResponse(await server.request(`/api/dreams/${draft.id}`), 200);
  assert.equal(fetched.dream.title, draft.title);

  const edit = { ...created.dream, title: 'An edited dream', transcript: `${draft.transcript} The door opened.` };
  const updated = await jsonResponse(await server.request(`/api/dreams/${draft.id}`, 'PUT', edit), 200);
  assert.equal(updated.dream.title, edit.title);
  assert.equal(updated.dream.transcript, edit.transcript);
  const chatHistory = [
    { role: 'user', content: 'What did the door mean to me?', timestamp: '2026-10-13T12:01:00.000Z' },
    { role: 'model', content: 'What personal memories come to mind?', timestamp: '2026-10-13T12:01:01.000Z' },
  ];
  const chatted = await jsonResponse(await server.request(`/api/dreams/${draft.id}/chat`, 'PATCH', { chatHistory }), 200);
  assert.deepEqual(chatted.dream.chatHistory, chatHistory);

  await server.restart();
  const persisted = await jsonResponse(await server.request(`/api/dreams/${draft.id}`), 200);
  assert.equal(persisted.dream.title, edit.title);
  assert.equal(persisted.dream.transcript, edit.transcript);
  assert.deepEqual(persisted.dream.chatHistory, chatHistory);
  const deleted = await server.request(`/api/dreams/${draft.id}`, 'DELETE');
  assert.ok([200, 204].includes(deleted.status), await deleted.text());
  await jsonResponse(await server.request(`/api/dreams/${draft.id}`), 404);
  await server.restart();
  assert.deepEqual((await jsonResponse(await server.request('/api/dreams'), 200)).dreams, []);
});

test('bootstrap happens once; explicit import merges and keeps existing IDs', { timeout: 60_000 }, async (t) => {
  const server = await isolatedServer(t);
  const seed = draftDream('seed');
  const first = await jsonResponse(await server.request('/api/dreams/bootstrap', 'POST', { dreams: [seed] }), 201);
  assert.equal(first.imported, true);
  assert.deepEqual(first.dreams.map((dream: { id: string }) => dream.id), ['seed']);
  const repeated = await jsonResponse(await server.request('/api/dreams/bootstrap', 'POST', { dreams: [draftDream('other-seed')] }), 200);
  assert.equal(repeated.imported, false);
  assert.deepEqual(repeated.dreams.map((dream: { id: string }) => dream.id), ['seed']);

  const deletion = await server.request('/api/dreams/seed', 'DELETE');
  assert.ok([200, 204].includes(deletion.status), await deletion.text());
  await server.restart();
  const afterClear = await jsonResponse(await server.request('/api/dreams/bootstrap', 'POST', { dreams: [seed] }), 200);
  assert.equal(afterClear.imported, false);
  assert.deepEqual(afterClear.dreams, []);

  const existing = draftDream('existing');
  await jsonResponse(await server.request('/api/dreams', 'POST', existing), 201);
  const importedResponse = await server.request('/api/dreams/import', 'POST', {
    dreams: [{ ...existing, title: 'Should never overwrite the server copy' }, draftDream('imported')],
  });
  assert.ok([200, 201].includes(importedResponse.status), await importedResponse.text());
  await server.restart();
  const archive = (await jsonResponse(await server.request('/api/dreams'), 200)).dreams;
  assert.equal(archive.length, 2);
  assert.equal(archive.find((dream: { id: string }) => dream.id === 'existing').title, existing.title);
  assert.ok(archive.some((dream: { id: string }) => dream.id === 'imported'));
});

test('media survives restarts and a portable export/import into an empty archive', { timeout: 60_000 }, async (t) => {
  const server = await isolatedServer(t);
  const bytes = tinyWav();
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4X8AAAAASUVORK5CYII=', 'base64');
  const draft = {
    ...draftDream('with-audio'),
    audioUrl: `data:audio/wav;base64,${bytes.toString('base64')}`,
    audioDurationSeconds: 1,
    imageUrl: `data:image/png;base64,${imageBytes.toString('base64')}`,
  };
  const created = await jsonResponse(await server.request('/api/dreams', 'POST', draft), 201);
  assert.match(created.dream.audioUrl, /^\/media\/[\w.-]+$/);
  const filePath = path.join(server.dataDirectory, created.dream.audioUrl.replace(/^\//, ''));
  assert.deepEqual(await readFile(filePath), bytes);
  await server.restart();
  const stored = await jsonResponse(await server.request('/api/dreams/with-audio'), 200);
  assert.equal(stored.dream.audioUrl, created.dream.audioUrl);
  const media = await server.request(stored.dream.audioUrl);
  assert.equal(media.status, 200);
  assert.match(media.headers.get('content-type') || '', /^audio\//);
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), bytes);

  const exportedResponse = await server.request('/api/archive/export');
  assert.match(exportedResponse.headers.get('content-disposition') || '', /attachment/);
  const exported = await jsonResponse(exportedResponse, 200);
  assert.equal(exported.version, 1);
  assert.equal(exported.dreams.length, 1);
  assert.equal(exported.dreams[0].audioUrl, draft.audioUrl);
  assert.equal(exported.dreams[0].imageUrl, draft.imageUrl);

  const restoredServer = await isolatedServer(t);
  const imported = await restoredServer.request('/api/dreams/import', 'POST', exported);
  assert.ok([200, 201].includes(imported.status), await imported.text());
  const restored = (await jsonResponse(await restoredServer.request('/api/dreams/with-audio'), 200)).dream;
  assert.match(restored.audioUrl, /^\/media\/[\w.-]+$/);
  assert.match(restored.imageUrl, /^\/media\/[\w.-]+$/);
  for (const [url, expected] of [[restored.audioUrl, bytes], [restored.imageUrl, imageBytes]] as const) {
    const restoredMedia = await restoredServer.request(url);
    assert.equal(restoredMedia.status, 200);
    assert.deepEqual(Buffer.from(await restoredMedia.arrayBuffer()), expected);
  }
});

test('HTTP validation is JSON, unknown API routes are 404, and missing AI key is explicit', { timeout: 60_000 }, async (t) => {
  const server = await isolatedServer(t);
  const health = await jsonResponse(await server.request('/api/health'), 200);
  assert.equal(health.status, 'ok');
  assert.equal(health.aiConfigured, false);
  const document = await server.request('/');
  assert.equal(document.status, 200);
  assert.match(document.headers.get('content-type') || '', /text\/html/);
  assert.match(await document.text(), /id=["']root["']/);

  const invalidJson = await fetch(`${server.baseUrl}/api/dreams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid json',
  });
  assert.equal(typeof (await jsonResponse(invalidJson, 400)).error, 'string');
  await jsonResponse(await server.request('/api/dreams', 'POST', { id: 'incomplete' }), 400);
  await jsonResponse(await server.request('/api/dreams/missing/chat', 'PATCH', { chatHistory: [{ role: 'admin', content: 'invalid', timestamp: '' }] }), 400);
  await jsonResponse(await server.request('/api/dreams/missing/chat', 'PATCH', { chatHistory: [] }), 404);
  await jsonResponse(await server.request('/api/does-not-exist'), 404);
  await jsonResponse(await server.request('/api/dreams/import', 'POST', { dreams: [{}] }), 400);

  const operations: Array<[string, unknown]> = [
    ['/api/interpret', { transcript: 'I dreamed about a garden.' }],
    ['/api/generate-image', { prompt: 'A dream garden' }],
    ['/api/transcribe', { audioBase64: tinyWav().toString('base64'), mimeType: 'audio/wav' }],
    ['/api/chat-symbol', { messages: [{ role: 'user', content: 'What does the door suggest?' }] }],
  ];
  for (const [route, body] of operations) {
    const error = await jsonResponse(await server.request(route, 'POST', body), 503);
    assert.match(error.error, /API_KEY|api key|密钥/i, `${route} must explain the missing configuration`);
  }
});
