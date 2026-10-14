import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../server/app.ts';
import { createAliyunRuntime } from '../server/aliyunRuntime.ts';
import { hashPassword } from '../server/password.ts';
import { draftDream, temporaryArchive } from './fixtures.ts';

async function appHarness(t: TestContext) {
  const directory = await temporaryArchive('aliyun');
  const password = 'synthetic-test-password-only';
  const environment = {
    OWNER_USERNAME: 'test-owner', OWNER_PASSWORD_HASH: await hashPassword(password),
    SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString('base64'), DATA_DIR: directory,
    APP_ORIGIN: 'https://oneiros.example', NODE_ENV: 'production',
  };
  const servers: ReturnType<ReturnType<typeof createApp>['listen']>[] = [];
  t.after(async () => { for (const server of servers) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } await rm(directory, { recursive: true, force: true }); });
  async function start(env: Readonly<Record<string, string | undefined>> = environment) {
    const app = createApp(createAliyunRuntime(env));
    const server = app.listen(0, '127.0.0.1'); servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    async function request(route: string, options: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string>; raw?: Buffer } = {}) {
      return fetch(base + route, {
        method: options.method || 'GET',
        headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.cookie ? { Cookie: options.cookie } : {}), ...options.headers },
        body: options.raw as any ?? (options.body ? JSON.stringify(options.body) : undefined),
      });
    }
    async function login() {
      const result = await request('/api/auth/login', { method: 'POST', body: { username: environment.OWNER_USERNAME, password } });
      assert.equal(result.status, 200);
      const header = result.headers.get('set-cookie')!;
      assert.match(header, /HttpOnly/); assert.match(header, /Secure/); assert.match(header, /SameSite=Lax/);
      return header.split(';')[0];
    }
    return { request, login };
  }
  return { start, directory, environment, password };
}

test('Aliyun gates all private routes, encrypts settings, enforces CAS and survives restarts', async (t) => {
  const harness = await appHarness(t); const first = await harness.start();
  for (const route of ['/api/health', '/api/dreams', '/api/settings', '/media/not-a-file.png']) assert.equal((await first.request(route)).status, 401);
  for (const route of ['/api/interpret', '/api/transcribe', '/api/generate-image', '/api/chat-symbol', '/api/media/upload']) assert.equal((await first.request(route, { method: 'POST', body: {} })).status, 401);
  const publicSession = await (await first.request('/api/session')).json();
  assert.equal(publicSession.authenticated, false); assert.equal(publicSession.provider, 'aliyun');
  const cookie = await first.login();
  assert.equal((await (await first.request('/api/health', { cookie })).json()).aiConfigured, false);
  const initial = await (await first.request('/api/settings', { cookie })).json();
  const changed = await first.request('/api/settings', { method: 'PUT', cookie, body: { updatedAt: initial.updatedAt, deepseekApiKey: 'synthetic-deepseek-credential', dashscopeApiKey: 'synthetic-dashscope-credential' } });
  assert.equal(changed.status, 200);
  const settings = await changed.json();
  assert.equal(settings.deepseekKeyConfigured, true); assert.equal(settings.dashscopeKeyConfigured, true);
  assert.equal(settings.deepseekApiKey, undefined);
  assert.equal((await first.request('/api/settings', { method: 'PUT', cookie, body: { updatedAt: initial.updatedAt, clearDeepseekKey: true } })).status, 409);
  assert.equal((await first.request('/api/settings', { method: 'PUT', cookie, headers: { Origin: 'https://attacker.example' }, body: { updatedAt: settings.updatedAt, clearDeepseekKey: true } })).status, 403);
  const privateFile = await readFile(path.join(harness.directory, '.private-state.json'), 'utf8');
  assert.ok(!privateFile.includes('synthetic-deepseek-credential'));
  assert.ok(!privateFile.includes(cookie.split('=')[1]));
  const second = await harness.start();
  assert.equal((await (await second.request('/api/session', { cookie })).json()).authenticated, true);
  assert.equal((await (await second.request('/api/health', { cookie })).json()).aiConfigured, true);
  assert.equal((await second.request('/api/auth/logout', { method: 'POST', cookie })).status, 200);
  assert.equal((await first.request('/api/health', { cookie })).status, 401);
});

test('Aliyun uploads files larger than Vercel payloads, protects playback, and persists media/dream/chat', async (t) => {
  const harness = await appHarness(t); const api = await harness.start(); const cookie = await api.login();
  const upload = await (await api.request('/api/media/upload', { method: 'POST', cookie, body: { mimeType: 'audio/wav', kind: 'audio' } })).json();
  const bytes = Buffer.alloc(5 * 1024 * 1024); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  assert.equal((await api.request(upload.uploadUrl, { method: 'PUT', cookie, raw: bytes, headers: { 'Content-Type': 'audio/wav' } })).status, 201);
  assert.equal((await api.request(upload.uploadUrl, { method: 'PUT', cookie, raw: bytes, headers: { 'Content-Type': 'audio/wav' } })).status, 403);
  assert.equal((await api.request(upload.mediaPath)).status, 401);
  const media = await api.request(upload.mediaPath, { cookie }); assert.equal(media.status, 200);
  assert.match(media.headers.get('cache-control')!, /no-store/);
  assert.deepEqual(createHash('sha256').update(Buffer.from(await media.arrayBuffer())).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
  const dream = { ...draftDream('cloud-fixture'), audioUrl: upload.mediaPath, audioPath: upload.mediaPath };
  const create = await api.request('/api/dreams', { method: 'POST', cookie, body: dream }); assert.equal(create.status, 201);
  const history = [{ role: 'user', content: 'Synthetic question', timestamp: new Date().toISOString() }];
  assert.equal((await api.request('/api/dreams/cloud-fixture/chat', { method: 'PATCH', cookie, body: { chatHistory: history } })).status, 200);
  assert.equal((await api.request('/api/dreams/cloud-fixture', { method: 'PUT', cookie, body: { ...dream, title: 'Updated' } })).status, 200);
  const restarted = await harness.start();
  const archived = await (await restarted.request('/api/dreams?offset=0&limit=20', { cookie })).json();
  assert.equal(archived.dreams[0].title, 'Updated'); assert.deepEqual(archived.dreams[0].chatHistory, history);
  assert.equal((await restarted.request(upload.mediaPath, { cookie })).status, 200);
  assert.equal((await restarted.request('/api/dreams', { method: 'POST', cookie, body: { ...draftDream('unsafe'), imageUrl: 'https://attacker.example/a.png' } })).status, 400);
  assert.equal((await restarted.request('/api/dreams/cloud-fixture', { method: 'DELETE', cookie })).status, 200);
});

test('Aliyun fails closed, ignores untrusted forwarded IPs and persists login throttling', async (t) => {
  const harness = await appHarness(t);
  const missing = await harness.start({ ...harness.environment, SETTINGS_ENCRYPTION_KEY: '' });
  assert.equal((await (await missing.request('/api/session')).json()).configured, false);
  assert.equal((await missing.request('/api/dreams')).status, 503);
  const api = await harness.start();
  for (let i = 0; i < 8; i++) assert.equal((await api.request('/api/auth/login', {
    method: 'POST', body: { username: 'test-owner', password: 'wrong-password' },
    headers: { 'X-Forwarded-For': `203.0.113.${i + 1}` },
  })).status, 401);
  const restarted = await harness.start();
  assert.equal((await restarted.request('/api/auth/login', {
    method: 'POST', body: { username: 'test-owner', password: harness.password },
    headers: { 'X-Forwarded-For': '203.0.113.99' },
  })).status, 429);
});

test('Aliyun private-proxy mode separates client rate limits and retains the global limit', async (t) => {
  const harness = await appHarness(t);
  const api = await harness.start({ ...harness.environment, TRUST_PROXY: 'private' });
  const login = (ip: string, password = 'wrong-password') => api.request('/api/auth/login', {
    method: 'POST', headers: { 'X-Forwarded-For': ip }, body: { username: 'test-owner', password },
  });
  for (let i = 0; i < 8; i++) assert.equal((await login('203.0.113.1')).status, 401);
  assert.equal((await login('203.0.113.1')).status, 429);
  assert.equal((await login('203.0.113.2', harness.password)).status, 200, 'another client must not share the proxy socket IP bucket');
  for (let i = 0; i < 31; i++) assert.equal((await login(`203.0.113.${i + 20}`)).status, 401);
  assert.equal((await login('203.0.113.200', harness.password)).status, 429, 'rotating client IPs must not bypass the global 40-attempt limit');
});
