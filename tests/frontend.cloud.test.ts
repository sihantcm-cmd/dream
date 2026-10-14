import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createDream, generateSurrealistImage, getCloudSettings, getHealth, importDreams, listDreams, saveCloudSettings, transcribeAudio, updateDream } from '../src/services/api.ts';
import { authenticatedHeaders, clearCloudDrafts, getCloudClient, getSessionConfig, loginWithPassword, logoutPasswordSession, type CloudSessionConfig } from '../src/services/cloud.ts';
import { draftDream, tinyWav } from './fixtures.ts';

const aliyun: CloudSessionConfig = { mode: 'cloud', provider: 'aliyun', authType: 'password', configured: true, authenticated: true };
const mediaPath = '/media/5a28e78b-8dac-4101-aecf-746e1fb5b6c8.wav';
const uploadUrl = '/api/media/content/5a28e78b-8dac-4101-aecf-746e1fb5b6c8?token=synthetic';
const json = (body: unknown, status = 200) => Response.json(body, { status });

async function browser(t: TestContext, config: CloudSessionConfig, handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const events = new EventTarget();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout, clearTimeout, location: { origin: 'https://dream.test' },
    dispatchEvent: events.dispatchEvent.bind(events),
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    if (url === '/api/session') return json(config);
    return handler(url, init);
  });
  await getSessionConfig(true);
  return events;
}

test('Aliyun password login and archive use same-origin cookies without a browser bearer token', async (t) => {
  const calls: string[] = [];
  await browser(t, aliyun, (url, init) => {
    calls.push(url);
    assert.equal(init.credentials, 'same-origin');
    assert.equal(new Headers(init.headers).get('Authorization'), null);
    if (url === '/api/auth/login') {
      assert.deepEqual(JSON.parse(String(init.body)), { username: 'owner', password: 'synthetic-password' });
      return json({ authenticated: true });
    }
    if (url === '/api/auth/logout') return new Response(null, { status: 204 });
    if (url.includes('offset=0')) return json({ dreams: [draftDream('first')], hasMore: true, nextOffset: 20 });
    if (url.includes('offset=20')) return json({ dreams: [draftDream('last')], hasMore: false });
    throw new Error(`Unexpected test request: ${url}`);
  });
  await loginWithPassword('owner', 'synthetic-password');
  assert.deepEqual((await listDreams()).map((dream) => dream.id), ['first', 'last']);
  await logoutPasswordSession();
  assert.deepEqual(calls, ['/api/auth/login', '/api/dreams?offset=0&limit=20', '/api/dreams?offset=20&limit=20', '/api/auth/logout']);
});

test('a recording larger than Vercel JSON limits travels as raw media and only its path is saved', async (t) => {
  const recording = Buffer.alloc(5 * 1024 * 1024, 7);
  let uploaded = false;
  await browser(t, aliyun, async (url, init) => {
    if (url === '/api/media/upload') {
      assert.deepEqual(JSON.parse(String(init.body)), { mimeType: 'audio/wav', kind: 'audio' });
      return json({ uploadUrl, mediaPath, method: 'PUT' });
    }
    if (url === uploadUrl) {
      assert.equal(init.method, 'PUT');
      assert.equal(init.credentials, 'same-origin');
      assert.ok(init.body instanceof Blob);
      assert.equal(init.body.size, recording.length);
      uploaded = true;
      return new Response(null, { status: 204 });
    }
    if (url === '/api/dreams') {
      assert.ok(uploaded);
      assert.ok(String(init.body).length < 10_000);
      const saved = JSON.parse(String(init.body));
      assert.equal(saved.audioUrl, mediaPath);
      assert.equal(saved.audioPath, mediaPath);
      assert.ok(!String(init.body).includes('base64'));
      return json({ dream: saved });
    }
    throw new Error(`Unexpected test request: ${url}`);
  });
  const saved = await createDream({ ...draftDream('large-recording'), audioUrl: `data:audio/wav;base64,${recording.toString('base64')}` });
  assert.equal(saved.audioUrl, mediaPath);
});

test('cloud transcription uploads WAV first while the local edition still sends its existing inline payload', async (t) => {
  const wav = tinyWav().toString('base64');
  await browser(t, aliyun, (url, init) => {
    if (url === '/api/media/upload') return json({ uploadUrl, mediaPath, method: 'PUT' });
    if (url === uploadUrl) return new Response(null, { status: 204 });
    assert.equal(url, '/api/transcribe');
    assert.deepEqual(JSON.parse(String(init.body)), { audioPath: mediaPath, mimeType: 'audio/wav' });
    return json({ transcript: 'Cloud transcription fixture' });
  });
  assert.equal(await transcribeAudio(wav, 'audio/wav'), 'Cloud transcription fixture');
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    if (url === '/api/session') return json({ mode: 'local', configured: true });
    assert.equal(url, '/api/transcribe');
    assert.deepEqual(JSON.parse(String(init.body)), { audioBase64: wav, mimeType: 'audio/wav' });
    return json({ transcript: 'Local transcription fixture' });
  });
  await getSessionConfig(true);
  assert.equal(await transcribeAudio(wav, 'audio/wav'), 'Local transcription fixture');
});

test('the upload flow rejects an off-site upload URL without sending the recording', async (t) => {
  const requested: string[] = [];
  await browser(t, aliyun, (url) => {
    requested.push(url);
    assert.equal(url, '/api/media/upload');
    return json({ uploadUrl: 'https://external.invalid/upload', mediaPath, method: 'PUT' });
  });
  await assert.rejects(transcribeAudio(tinyWav().toString('base64'), 'audio/wav'), /上传地址无效/);
  assert.deepEqual(requested, ['/api/media/upload']);
});

test('a 401 returns the app to its login gate and settings preserve their concurrency version', async (t) => {
  let expired = false;
  const publicSettings = { deepseekKeyConfigured: false, dashscopeKeyConfigured: false, updatedAt: 'revision-one' };
  const events = await browser(t, aliyun, (url, init) => {
    if (url === '/api/health') return json({ error: '登录已过期' }, 401);
    if (url === '/api/settings' && !init.method) return json(publicSettings);
    if (url === '/api/settings' && init.method === 'PUT') {
      assert.equal(JSON.parse(String(init.body)).updatedAt, 'revision-one');
      return json({ ...publicSettings, updatedAt: 'revision-two' });
    }
    throw new Error(`Unexpected test request: ${url}`);
  });
  events.addEventListener('oneiros:session-expired', () => { expired = true; });
  await assert.rejects(getHealth(), /登录已过期/);
  assert.ok(expired);
  const settings = await getCloudSettings();
  assert.equal((await saveCloudSettings({ updatedAt: settings.updatedAt, deepseekModel: 'deepseek-v4-pro' })).updatedAt, 'revision-two');
  assert.equal((await authenticatedHeaders()).get('Authorization'), null);
});

test('cloud backup import refuses temporary media URLs instead of persisting broken links', async (t) => {
  await browser(t, aliyun, (url) => { throw new Error(`Unexpected test request: ${url}`); });
  await assert.rejects(importDreams([{ ...draftDream('expired-media'), imageUrl: 'https://private-storage.test/expired?token=old' }]), /媒体不是完整文件/);
});

test('Supabase generated artwork keeps its stable path through save, signed URL refresh, and later editing', async (t) => {
  const canonical = '/cloud-media/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.png';
  const signed = 'https://oneiros-test.supabase.co/storage/v1/object/sign/oneiros-media/art.png?token=';
  const configuration: CloudSessionConfig = { mode: 'cloud', provider: 'supabase', configured: true,
    supabaseUrl: 'https://oneiros-test.supabase.co', publishableKey: 'synthetic-public-test-key' };
  let writes = 0;
  await browser(t, configuration, (url, init) => {
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer synthetic-owner-session');
    if (url === '/api/generate-image') return json({ imageUrl: `${signed}initial`, imagePath: canonical, imageSize: 'native', aspectRatio: '1:1' });
    if (url.startsWith('/api/dreams?')) return json({ dreams: [{ ...draftDream('cloud-image'), imageUrl: `${signed}refreshed`, imagePath: canonical }], hasMore: false });
    if (url === '/api/dreams' || url === '/api/dreams/cloud-image') {
      const body = JSON.parse(String(init.body));
      assert.equal(body.imagePath, canonical);
      assert.equal(body.imageUrl, canonical, 'A temporary signed URL must not replace the permanent media reference.');
      writes += 1;
      return json({ dream: { ...body, imageUrl: `${signed}saved-${writes}` } });
    }
    throw new Error(`Unexpected test request: ${url}`);
  });
  t.mock.method(getCloudClient().auth, 'getSession', async () => ({ data: { session: { access_token: 'synthetic-owner-session' } }, error: null }));
  const generated = await generateSurrealistImage('Synthetic artwork fixture', 'native');
  assert.equal(generated.imageUrl, `${signed}initial`, 'Generation must retain its actual display URL.');
  const saved = await createDream({ ...draftDream('cloud-image'), imageUrl: generated.imageUrl, imagePath: generated.imagePath });
  assert.equal(saved.imageUrl, `${signed}saved-1`);
  const [refreshed] = await listDreams();
  assert.equal(refreshed.imageUrl, `${signed}refreshed`);
  const edited = await updateDream({ ...refreshed, title: 'Edited title' });
  assert.equal(edited.imagePath, canonical);
  assert.equal(edited.title, 'Edited title');
  assert.equal(writes, 2);
});

test('missing Supabase SDK session opens the login gate before any protected request is sent', async (t) => {
  const configuration: CloudSessionConfig = { mode: 'cloud', provider: 'supabase', configured: true,
    supabaseUrl: 'https://oneiros-test.supabase.co', publishableKey: 'synthetic-public-test-key' };
  const events = await browser(t, configuration, (url) => { throw new Error(`Unexpected protected request: ${url}`); });
  let expired = false;
  events.addEventListener('oneiros:session-expired', () => { expired = true; });
  t.mock.method(getCloudClient().auth, 'getSession', async () => ({ data: { session: null }, error: null }));
  await assert.rejects(getHealth(), /登录已失效/);
  assert.ok(expired);
});

test('logout clears unsaved dream, generation, and chat drafts without deleting the existing archive or auth session', async (t) => {
  await browser(t, aliyun, (url) => { throw new Error(`Unexpected test request: ${url}`); });
  const storage: Record<string, unknown> = {
    oneiros_pending_draft_v1: 'private draft', oneiros_pending_generation_dream: 'private image',
    oneiros_pending_chat_dream: 'private chat', oneiros_dreams_v1: 'existing local archive',
    'sb-project-auth-token': 'session managed by authentication library',
  };
  Object.defineProperty(storage, 'removeItem', { value: (key: string) => { delete storage[key]; } });
  Object.assign(window, { localStorage: storage, sessionStorage: storage });
  clearCloudDrafts();
  assert.deepEqual(Object.keys(storage).sort(), ['oneiros_dreams_v1', 'sb-project-auth-token']);
});
