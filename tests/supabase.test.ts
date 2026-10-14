import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseRuntime } from '../server/supabaseRuntime';
import { createCloudDreamStore } from '../server/cloudStore';
import { getAiEnvironment, getAiTimeoutMs } from '../server/aiEnvironment';
import { openSettings } from '../server/secretBox';
import { AiProviderError } from '../server/domesticAi';
import { draftDream, tinyWav } from './fixtures';

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FILE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOKEN = 'owner-token-abcdefghijklmnop';
const ENV = {
  SUPABASE_URL: 'https://synthetic.supabase.co', APP_ORIGIN: 'https://dream.example.com',
  SUPABASE_ANON_KEY: 'sb_publishable_synthetic_public_key_123456789', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-server-secret',
  OWNER_EMAIL: 'owner@example.com', SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

function fakeSupabase() {
  const tables: Record<string, Record<string, any>[]> = { ai_settings: [], cloud_dreams: [] };
  const objects = new Map<string, Blob>();
  const operations: { table: string; operation: string; filters: [string, unknown][]; values?: any }[] = [];
  const uploads: string[] = [];
  const users = new Map<string, any>([
    [TOKEN, { id: OWNER, email: 'owner@example.com', email_confirmed_at: '2026-10-14T00:00:00Z' }],
    ['other-token-abcdefghijklmnop', { id: OTHER, email: 'other@example.com', email_confirmed_at: '2026-10-14T00:00:00Z' }],
    ['unverified-token-abcdefghijklmnop', { id: OWNER, email: 'owner@example.com', email_confirmed_at: null }],
  ]);
  let beforeUpdate: (() => void) | undefined;
  let otpCalls = 0;
  let storageCalls = 0;
  const client = {
    auth: {
      getUser: async (token: string) => ({ data: { user: users.get(token) ?? null }, error: null }),
      signInWithOtp: async ({ email, options }: any) => {
        assert.equal(email, 'owner@example.com');
        assert.deepEqual(options, { shouldCreateUser: true, emailRedirectTo: ENV.APP_ORIGIN });
        otpCalls += 1;
        return { data: {}, error: null };
      },
    },
    from(table: string) {
      let operation = 'select', values: any, single = false, head = false, range: number[] | undefined;
      const filters: [string, unknown][] = [];
      const query = {
        select(_fields?: string, options?: any) { head = options?.head ?? false; return query; },
        eq(field: string, value: unknown) { filters.push([field, value]); return query; },
        order() { return query; },
        range(start: number, end: number) { range = [start, end]; return query; },
        maybeSingle() { single = true; return query; },
        update(value: any) { operation = 'update'; values = value; return query; },
        insert(value: any) { operation = 'insert'; values = value; return query; },
        delete() { operation = 'delete'; return query; },
        then(resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) {
          try {
            operations.push({ table, operation, filters, values });
            if (operation === 'update' && beforeUpdate) { const hook = beforeUpdate; beforeUpdate = undefined; hook(); }
            let rows = tables[table].filter((row) => filters.every(([field, value]) => field === 'updated_at'
              ? Date.parse(row[field]) === Date.parse(String(value)) : row[field] === value));
            if (operation === 'insert') {
              if (tables[table].some((row) => row.owner_id === values.owner_id)) return Promise.resolve({ data: null, error: { code: '23505' } }).then(resolve, reject);
              const row = structuredClone(values); tables[table].push(row); rows = [row];
            } else if (operation === 'update') rows.forEach((row) => Object.assign(row, structuredClone(values)));
            else if (operation === 'delete') tables[table] = tables[table].filter((row) => !rows.includes(row));
            const count = rows.length;
            if (range) rows = rows.slice(range[0], range[1] + 1);
            return Promise.resolve({ data: head ? null : structuredClone(single ? rows[0] ?? null : rows), count, error: null }).then(resolve, reject);
          } catch (error) { return Promise.reject(error).then(resolve, reject); }
        },
      };
      return query;
    },
    async rpc(name: string, params: any) {
      assert.equal(name, 'cloud_save_dreams');
      operations.push({ table: 'cloud_dreams', operation: params.p_mode, filters: [['owner_id', params.p_owner]], values: params.p_dreams });
      let imported = 0;
      for (const dream of params.p_dreams) {
        const found = tables.cloud_dreams.some((row) => row.owner_id === params.p_owner && row.id === dream.id);
        if (found) {
          if (params.p_mode === 'create') return { error: { code: '23505' }, data: null };
          continue;
        }
        const { id, createdAt, chatHistory, ...data } = structuredClone(dream);
        tables.cloud_dreams.push({ owner_id: params.p_owner, id, data, chat_history: chatHistory, created_at: createdAt });
        imported += 1;
      }
      return { error: null, data: { imported, skipped: params.p_dreams.length - imported, initialized: true } };
    },
    storage: {
      from(bucket: string) {
        assert.equal(bucket, 'oneiros-media');
        return {
          async createSignedUploadUrl(path: string, options: unknown) {
            storageCalls += 1; uploads.push(path); assert.deepEqual(options, { upsert: false });
            return { data: { path, token: 'synthetic-upload-token', signedUrl: `https://synthetic.supabase.co/upload/${path}` }, error: null };
          },
          async createSignedUrls(paths: string[], ttl: number) {
            storageCalls += 1; assert.equal(ttl, 3600);
            return { data: paths.map((path) => ({ path, signedUrl: `https://synthetic.supabase.co/download/${path}?token=private-signature`, error: null })), error: null };
          },
          async createSignedUrl(path: string, ttl: number) {
            storageCalls += 1; assert.equal(ttl, 3600);
            return { data: { signedUrl: `https://synthetic.supabase.co/download/${path}?token=private-signature` }, error: null };
          },
          async upload(path: string, bytes: Buffer, options: any) {
            storageCalls += 1; assert.equal(options.upsert, false);
            objects.set(path, new Blob([new Uint8Array(bytes)], { type: options.contentType }));
            return { data: { path }, error: null };
          },
          async download(path: string) { storageCalls += 1; return { data: objects.get(path), error: null }; },
        };
      },
    },
  } as unknown as SupabaseClient;
  return {
    client, tables, operations, objects, uploads,
    get otpCalls() { return otpCalls; }, get storageCalls() { return storageCalls; },
    set beforeUpdate(hook: (() => void) | undefined) { beforeUpdate = hook; },
  };
}

async function serve(t: any, mock: ReturnType<typeof fakeSupabase>, environment: Record<string, string> = ENV, testConnection?: any) {
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  createSupabaseRuntime({ environment, clientFactory: (() => mock.client) as any, testConnection }).mount(app);
  app.get('/api/probe', async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    res.json({ config: res.locals.archive.aiConfig, timeout: getAiTimeoutMs(600_000), hasGeminiKey: Boolean(getAiEnvironment().GEMINI_API_KEY) });
  });
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ error: 'Request failed.' });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address() as { port: number };
  return async (path: string, options: { method?: string; body?: unknown; token?: string | null } = {}) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: options.method ?? 'GET',
      headers: { ...(options.token === null ? {} : { Authorization: `Bearer ${options.token ?? TOKEN}` }), ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    return { status: response.status, text, body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null };
  };
}

test('Supabase runtime fails closed before configuration and gates every private API by verified owner', async (t) => {
  const missing = fakeSupabase();
  const unconfigured = await serve(t, missing, {});
  assert.deepEqual((await unconfigured('/api/session')).body, { mode: 'cloud', provider: 'supabase', authType: 'email-otp', configured: false });
  assert.equal((await unconfigured('/api/probe')).status, 503);
  assert.equal(missing.operations.length, 0);

  const mock = fakeSupabase(), request = await serve(t, mock);
  for (const [path, method] of [['/api/health', 'GET'], ['/api/dreams', 'GET'], ['/api/settings', 'GET'], ['/api/media/upload', 'POST'], ['/api/ai/image', 'POST']]) {
    assert.equal((await request(path, { method, token: null })).status, 401);
  }
  assert.equal((await request('/api/probe', { token: 'other-token-abcdefghijklmnop' })).status, 403);
  assert.equal((await request('/api/probe', { token: 'unverified-token-abcdefghijklmnop' })).status, 403);
  assert.equal(mock.operations.length, 0, 'unauthorized requests must never read data or encrypted keys');
  const session = await request('/api/session', { token: null });
  assert.equal(session.body.configured, true);
  assert.equal(session.body.publishableKey, ENV.SUPABASE_ANON_KEY);
  assert.ok(!session.text.includes(ENV.SUPABASE_SERVICE_ROLE_KEY));
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: 'other@example.com' }, token: null })).status, 403);
  assert.equal(mock.otpCalls, 0);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: 'OWNER@example.com' }, token: null })).status, 200);
  assert.equal(mock.otpCalls, 1);
});

test('a service-role key accidentally placed in public configuration is never exposed', async (t) => {
  const jwt = (role: string) => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.synthetic-signature`;
  for (const key of ['sb_secret_test', jwt('service_role'), ENV.SUPABASE_SERVICE_ROLE_KEY]) {
    const request = await serve(t, fakeSupabase(), { ...ENV, SUPABASE_ANON_KEY: key });
    const session = await request('/api/session', { token: null });
    assert.equal(session.body.configured, false);
    assert.ok(!session.text.includes(key));
    assert.equal((await request('/api/probe')).status, 503);
  }
  const legacyAnon = await serve(t, fakeSupabase(), { ...ENV, SUPABASE_ANON_KEY: jwt('anon') });
  assert.equal((await legacyAnon('/api/session')).body.configured, true);
});

test('cloud AI context ignores host keys; saved settings are encrypted, flags-only and CAS protected', async (t) => {
  const previous = { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  process.env.DEEPSEEK_API_KEY = 'host-key-must-not-be-used'; process.env.GEMINI_API_KEY = 'host-gemini-must-not-be-used';
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const mock = fakeSupabase();
  const request = await serve(t, mock, ENV, async (provider: 'deepseek') => {
    assert.equal(getAiEnvironment().DEEPSEEK_API_KEY, 'sk-synthetic-deepseek-secret');
    assert.equal(getAiTimeoutMs(600_000), 240_000);
    throw new AiProviderError(provider, 'AI_KEY_INVALID', 401);
  });
  const probe = await request('/api/probe');
  assert.equal(probe.status, 200); assert.equal(probe.body.timeout, 240_000);
  assert.equal(probe.body.config.aiConfigured, false); assert.equal(probe.body.hasGeminiKey, false);
  const initial = await request('/api/settings'); assert.equal(initial.body.updatedAt, null);
  const saved = await request('/api/settings', { method: 'PUT', body: { updatedAt: null, deepseekApiKey: 'sk-synthetic-deepseek-secret', dashscopeApiKey: 'sk-synthetic-dashscope-secret' } });
  assert.equal(saved.status, 200); assert.equal(saved.body.deepseekKeyConfigured, true);
  assert.ok(!saved.text.includes('sk-synthetic'));
  const row = mock.tables.ai_settings[0];
  assert.ok(!row.ciphertext.includes('synthetic-deepseek'));
  assert.equal((openSettings(row.ciphertext, OWNER, ENV.SETTINGS_ENCRYPTION_KEY) as any).deepseekApiKey, 'sk-synthetic-deepseek-secret');
  assert.equal((await request('/api/settings', { method: 'PUT', body: { updatedAt: null, deepseekModel: 'stale-model' } })).status, 409);
  row.updated_at = saved.body.updatedAt.replace('Z', '+00:00');
  const savedAgain = await request('/api/settings', { method: 'PUT', body: { updatedAt: saved.body.updatedAt, deepseekModel: 'deepseek-v4-pro' } });
  assert.equal(savedAgain.status, 200, 'PostgREST timestamp formatting must not cause a false conflict');
  mock.beforeUpdate = () => { row.updated_at = '2099-01-01T00:00:00.000Z'; };
  const raced = await request('/api/settings', { method: 'PUT', body: { updatedAt: savedAgain.body.updatedAt, deepseekModel: 'raced-model' } });
  assert.equal(raced.status, 409, 'a concurrent writer after the read must not be overwritten');
  const tested = await request('/api/settings/test', { method: 'POST', body: { provider: 'deepseek' } });
  assert.equal(tested.status, 502); assert.equal(tested.body.code, 'AI_KEY_INVALID'); assert.ok(!tested.text.includes('sk-synthetic'));
  for (const operation of mock.operations) {
    if (operation.operation === 'insert') assert.equal(operation.values.owner_id, OWNER);
    else assert.ok(operation.filters.some(([field, value]) => field === 'owner_id' && value === OWNER));
  }
});

test('direct upload issues owned private tokens; request body remains bounded', async (t) => {
  const mock = fakeSupabase(), request = await serve(t, mock);
  const uploaded = await request('/api/media/upload', { method: 'POST', body: { kind: 'audio', mimeType: 'audio/wav' } });
  assert.equal(uploaded.status, 200);
  assert.match(uploaded.body.path, new RegExp(`^${OWNER}/[a-f0-9-]+\\.wav$`));
  assert.equal(uploaded.body.mediaPath, `/cloud-media/${uploaded.body.path}`);
  assert.equal(uploaded.body.token, 'synthetic-upload-token');
  assert.equal((await request('/api/media/upload', { method: 'POST', body: { kind: 'image', mimeType: 'text/html' } })).status, 400);
  assert.equal((await request('/api/media/upload', { method: 'POST', body: { kind: 'image', mimeType: 'toString' } })).status, 400);
  const callsBefore = mock.storageCalls;
  assert.equal((await request('/api/media/upload', { method: 'POST', body: { kind: 'audio', mimeType: 'audio/wav', data: 'A'.repeat(4.6 * 1024 * 1024) } })).status, 413);
  assert.equal(mock.storageCalls, callsBefore, 'large payloads must be uploaded directly to storage');
});

test('cloud archive never persists signed URLs or crosses owners; editing metadata preserves latest chat', async () => {
  const mock = fakeSupabase(), store = createCloudDreamStore(mock.client, OWNER);
  const foreign = createCloudDreamStore(mock.client, OTHER);
  await foreign.create(draftDream('same-id'));
  const path = `/cloud-media/${OWNER}/${FILE}.png`;
  const created = await store.create({ ...draftDream('same-id'), imageUrl: path });
  assert.ok(created);
  assert.equal(created.imagePath, path); assert.match(created.imageUrl, /private-signature/);
  const chat = [{ role: 'user' as const, content: 'A newer question', timestamp: '2026-10-14T01:00:00Z' }];
  await store.updateChatHistory('same-id', chat);
  const updated = await store.update('same-id', { ...created, title: 'Edited title', createdAt: '2099-01-01T00:00:00Z', chatHistory: [] });
  assert.ok(updated);
  assert.deepEqual(updated.chatHistory, chat); assert.equal(updated.createdAt, created.createdAt);
  const stored = mock.tables.cloud_dreams.find((row) => row.owner_id === OWNER)!;
  stored.created_at = created.createdAt.replace('Z', '+00:00');
  assert.equal((await store.get('same-id'))?.createdAt, created.createdAt, 'PostgREST timestamps preserve create-response recovery comparisons');
  assert.equal(stored.data.imageUrl, path); assert.ok(!JSON.stringify(stored).includes('private-signature'));
  assert.equal((await foreign.get('same-id'))?.title, 'Dream same-id');
  const before = mock.operations.length;
  await assert.rejects(() => store.create({ ...draftDream('bad'), imageUrl: `/cloud-media/${OTHER}/${FILE}.png` }), { status: 400 });
  await assert.rejects(() => store.create({ ...draftDream('bad'), imageUrl: 'https://example.com/image.png' }), { status: 400 });
  await assert.rejects(() => store.create({ ...draftDream('bad'), audioUrl: `data:audio/wav;base64,${tinyWav().toString('base64')}` }), { status: 400 });
  assert.equal(mock.operations.length, before, 'invalid media must be rejected before database calls');
  assert.equal(await store.remove('same-id'), true); assert.notEqual(await foreign.get('same-id'), null);
});

test('bounded archive pages preserve all records, and WAV reads never fetch arbitrary URLs', async () => {
  const mock = fakeSupabase(), store = createCloudDreamStore(mock.client, OWNER);
  for (let index = 0; index < 7; index += 1) {
    const dream = draftDream(`large-${index}`);
    dream.interpretation.archetypes = Array.from({ length: 6 }, () => ({ name: 'symbol', description: 'a'.repeat(99_000), appearanceInDream: '' })) as never[];
    await store.create(dream);
  }
  const first = await store.listPage({ offset: 0, limit: 20 });
  assert.equal(first.hasMore, true); assert.ok(first.dreams.length > 0 && first.dreams.length < 7);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 3_000_000);
  const second = await store.listPage({ offset: first.nextOffset, limit: 20 });
  assert.equal(second.hasMore, false); assert.equal(first.dreams.length + second.dreams.length, 7);
  assert.equal(await store.count(), 7);
  const huge = draftDream('too-large');
  huge.interpretation.archetypes = Array.from({ length: 11 }, () => ({ name: 'symbol', description: 'a'.repeat(99_000), appearanceInDream: '' })) as never[];
  await assert.rejects(() => store.create(huge), { status: 413 });
  const media = await store.uploadMedia(tinyWav().toString('base64'), 'audio/wav', 'audio');
  const recording = await store.readOwnedAudio(media);
  assert.deepEqual(recording.bytes, tinyWav()); assert.equal(recording.mimeType, 'audio/wav');
  const callsBefore = mock.storageCalls;
  await assert.rejects(() => store.readOwnedAudio('https://example.com/secret.wav'), { status: 400 });
  await assert.rejects(() => store.readOwnedAudio(`/cloud-media/${OTHER}/${FILE}.wav`), { status: 400 });
  assert.equal(mock.storageCalls, callsBefore);
  mock.objects.set(`${OWNER}/${FILE}.wav`, new Blob(['not a wave']));
  await assert.rejects(() => store.readOwnedAudio(`/cloud-media/${OWNER}/${FILE}.wav`), { status: 400 });
});
