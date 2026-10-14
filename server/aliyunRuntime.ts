import express from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDreamStore } from './dreamStore.js';
import { createPrivateState } from './privateState.js';
import { validPasswordHash, verifyPassword } from './password.js';
import { openSettings, sealSettings, validateEncryptionKey } from './secretBox.js';
import { DEFAULT_SETTINGS, publicSettings, settingsEnvironment, updateSettings, type AiSettings } from './settings.js';
import { getAiConfig } from './aiConfig.js';
import { runWithAiEnvironment } from './aiEnvironment.js';
import { AiProviderError, testProviderConnection } from './domesticAi.js';
import type { ArchiveRuntime } from './runtime.js';
import type { DreamEntry } from '../src/types.js';

const OWNER_ID = 'oneiros-personal-owner';
const COOKIE = '__Host-oneiros';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'audio/wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3' };
const MEDIA = /^\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp|wav|webm|ogg|m4a|mp3))$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const problem = (message: string, status = 400) => Object.assign(new Error(message), { status });
type PrivateState = {
  sessions: Record<string, { expires: number; fingerprint: string }>;
  attempts: Record<string, { until: number; count: number }>;
  settings: { ciphertext: string; updatedAt: string } | null;
};

export function createAliyunRuntime(env: Readonly<Record<string, string | undefined>> = process.env): ArchiveRuntime {
  const username = env.OWNER_USERNAME || '';
  const passwordHash = env.OWNER_PASSWORD_HASH || '';
  const encryptionKey = env.SETTINGS_ENCRYPTION_KEY || '';
  const directory = path.resolve(env.DATA_DIR || './data');
  const trustPrivateProxy = env.TRUST_PROXY === 'private';
  let origin = '';
  let secure = true;
  let configured = false;
  try {
    const url = new URL(env.APP_ORIGIN || '');
    secure = url.protocol === 'https:';
    const localTest = env.NODE_ENV === 'test' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:';
    if ((!secure && !localTest) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('origin');
    origin = url.origin;
    validateEncryptionKey(encryptionKey);
    configured = /^[a-zA-Z0-9_.@-]{3,80}$/.test(username) && validPasswordHash(passwordHash);
  } catch { /* Fail closed until the operator has completed deployment setup. */ }
  const cookieName = secure ? COOKIE : 'oneiros-local-test';
  const fingerprint = hash(passwordHash);
  const state = createPrivateState<PrivateState>(path.join(directory, '.private-state.json'), () => ({ sessions: {}, attempts: {}, settings: null }));
  const store = createDreamStore(directory);
  const tickets = new Map<string, { filename: string; mime: string; expires: number; session: string }>();
  let writeQueue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>) => {
    const result = writeQueue.then(operation); writeQueue = result.catch(() => undefined); return result;
  };
  const cookieToken = (req: express.Request) => req.headers.cookie?.split(';').map((value) => value.trim()).find((value) => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
  async function session(req: express.Request) {
    const token = cookieToken(req);
    if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) return null;
    const id = hash(token), saved = (await state.read()).sessions[id];
    return saved && saved.expires > Date.now() && saved.fingerprint === fingerprint ? id : null;
  }
  const cookieOptions = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };
  function readSettings(saved: PrivateState): AiSettings {
    return saved.settings ? updateSettings({ ...DEFAULT_SETTINGS }, openSettings(saved.settings.ciphertext, OWNER_ID, encryptionKey)) : { ...DEFAULT_SETTINGS };
  }
  function validateCloudDream(dream: DreamEntry): DreamEntry {
    const normalized = { ...dream, imageUrl: dream.imagePath ?? dream.imageUrl, audioUrl: dream.audioPath ?? dream.audioUrl };
    for (const [kind, reference] of [['image', normalized.imageUrl], ['audio', normalized.audioUrl]] as const) {
      if (!reference) continue;
      const match = reference.match(MEDIA);
      const extension = match?.[1].split('.').pop();
      if (!match || !(kind === 'image' ? ['png', 'jpg', 'webp'] : ['wav', 'webm', 'ogg', 'm4a', 'mp3']).includes(extension!)) throw problem('请先将媒体上传到当前私人档案。');
    }
    if (Buffer.byteLength(JSON.stringify(normalized)) > 1_000_000) throw problem('单条梦境与对话超过 1 MB，请缩短后重试。', 413);
    return normalized;
  }
  async function ensureCapacity(dreams: DreamEntry[]) {
    const current = await store.list();
    if (new Set([...current, ...dreams].map((dream) => dream.id)).size > 500) throw problem('私人档案最多保存 500 条，请先导出并整理旧记录。', 413);
  }
  const cloudStore = {
    ...store,
    count: async () => (await store.list()).length,
    get: async (id: string) => (await store.list()).find((dream) => dream.id === id) ?? null,
    async listPage({ offset, limit }: { offset: number; limit: number }) {
      const all = await store.list();
      const dreams: DreamEntry[] = []; let size = 0;
      for (const dream of all.slice(offset, offset + limit)) {
        const bytes = Buffer.byteLength(JSON.stringify(dream));
        if (dreams.length && size + bytes > 3_000_000) break;
        dreams.push(dream); size += bytes;
      }
      return { dreams, nextOffset: offset + dreams.length, hasMore: offset + dreams.length < all.length };
    },
    create: (dream: DreamEntry) => serialize(async () => { const value = validateCloudDream(dream); await ensureCapacity([value]); return store.create(value); }),
    update: (id: string, dream: DreamEntry) => serialize(async () => {
      const existing = (await store.list()).find((value) => value.id === id);
      return existing ? store.update(id, validateCloudDream({ ...dream, chatHistory: existing.chatHistory })) : null;
    }),
    updateChatHistory: (id: string, history: DreamEntry['chatHistory']) => serialize(async () => {
      const existing = (await store.list()).find((value) => value.id === id);
      if (!existing) return null;
      validateCloudDream({ ...existing, chatHistory: history });
      return store.updateChatHistory(id, history);
    }),
    importBatch: (dreams: DreamEntry[]) => serialize(async () => {
      const values = dreams.map(validateCloudDream); await ensureCapacity(values);
      const result = await store.importDreams(values);
      return { imported: result.imported, skipped: result.skipped, initialized: true };
    }),
    bootstrapBatch: async (_dreams: DreamEntry[]) => ({ imported: 0, skipped: 0, initialized: true }),
    async readOwnedAudio(reference: string) {
      const match = typeof reference === 'string' && reference.match(MEDIA);
      if (!match || !match[1].endsWith('.wav')) throw problem('请选择当前档案的 WAV 录音。');
      const bytes = await readFile(path.join(store.mediaDirectory, match[1]));
      if (bytes.length > 7.5 * 1024 * 1024) throw problem('转写录音超过 7.5 MB。', 413);
      return { bytes, mimeType: 'audio/wav' };
    },
  };
  return {
    mount(app) {
      // Only opt in behind the bundled private-network proxy, which overwrites
      // X-Forwarded-For. Direct installations keep using the socket address.
      if (trustPrivateProxy) app.set('trust proxy', 'loopback,linklocal,uniquelocal');
      app.get('/api/session', async (req, res) => {
        try {
          const authenticated = configured && Boolean(await session(req));
          res.json({ mode: 'cloud', provider: 'aliyun', authType: 'password', configured, authenticated,
            ...(authenticated ? { email: username } : {}),
            ...(!configured ? { error: '服务器尚未设置私人账号、加密密钥和 HTTPS 地址，请完成部署初始化。' } : {}) });
        } catch { res.status(503).json({ error: '私人档案配置暂时不可用。' }); }
      });
      app.use(['/api', '/media'], (req, res, next) => {
        if (!configured) return res.status(503).json({ error: '私人云端配置尚未完成。' });
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('Origin') && req.get('Origin') !== origin) return res.status(403).json({ error: '请求来源与站点地址不匹配。' });
        next();
      });
      app.post('/api/auth/login', async (req, res) => {
        try {
          const input = req.body || {};
          if (typeof input.username !== 'string' || typeof input.password !== 'string' || input.password.length > 256 || input.username.length > 80) return res.status(400).json({ error: '请输入有效的账号和密码。' });
          // Per-client and global limits are both persisted across restarts.
          const ipKey = hash((trustPrivateProxy ? req.ip : req.socket.remoteAddress) || 'unknown');
          const allowed = await state.change((saved) => {
            const now = Date.now();
            saved.attempts = Object.fromEntries(Object.entries(saved.attempts).filter(([, value]) => value.until > now));
            for (const [key, maximum] of [[ipKey, 8], ['global', 40]] as const) {
              const attempt = saved.attempts[key] ?? { until: now + 5 * 60_000, count: 0 };
              if (attempt.count >= maximum) return false;
            }
            for (const key of [ipKey, 'global']) { saved.attempts[key] ??= { until: now + 5 * 60_000, count: 0 }; saved.attempts[key].count++; }
            return true;
          });
          if (!allowed) { res.setHeader('Retry-After', '300'); return res.status(429).json({ error: '登录尝试过多，请 5 分钟后再试。' }); }
          const valid = await verifyPassword(input.password, passwordHash);
          if (input.username !== username || !valid) return res.status(401).json({ error: '账号或密码不正确。' });
          const token = randomBytes(32).toString('base64url');
          await state.change((saved) => {
            const now = Date.now();
            saved.sessions = Object.fromEntries(Object.entries(saved.sessions).filter(([, value]) => value.expires > now && value.fingerprint === fingerprint).slice(-19));
            saved.sessions[hash(token)] = { expires: now + SESSION_MS, fingerprint };
            delete saved.attempts[ipKey];
          });
          res.cookie(cookieName, token, { ...cookieOptions, maxAge: SESSION_MS });
          res.json({ authenticated: true, email: username });
        } catch { res.status(503).json({ error: '登录暂时不可用，请检查持久存储。' }); }
      });
      app.use(['/api', '/media'], async (req, res, next) => {
        try {
          const id = await session(req);
          if (!id) return res.status(401).json({ error: '请先登录私人档案。' });
          res.locals.sessionId = id;
          next();
        } catch { res.status(503).json({ error: '登录状态暂时不可用。' }); }
      });
      app.post('/api/auth/logout', async (_req, res) => {
        try {
          await state.change((saved) => { delete saved.sessions[res.locals.sessionId]; });
          res.clearCookie(cookieName, cookieOptions); res.json({ authenticated: false });
        } catch { res.status(503).json({ error: '退出登录失败，请重试。' }); }
      });
      app.get('/api/settings', async (_req, res) => {
        try { const saved = await state.read(); res.json({ ...publicSettings(readSettings(saved)), updatedAt: saved.settings?.updatedAt || '0' }); }
        catch { res.status(503).json({ error: 'API 设置无法解密，请确认加密密钥未变更。' }); }
      });
      app.put('/api/settings', async (req, res) => {
        try {
          const result = await state.change((saved) => {
            if (req.body?.updatedAt !== (saved.settings?.updatedAt || '0')) throw problem('设置已在其他窗口更新，请重新打开设置后再保存。', 409);
            const settings = updateSettings(readSettings(saved), req.body);
            const updatedAt = randomUUID();
            saved.settings = { ciphertext: sealSettings(settings, OWNER_ID, encryptionKey), updatedAt };
            return { ...publicSettings(settings), updatedAt };
          });
          res.json(result);
        } catch (error) { res.status((error as any)?.status === 409 ? 409 : 400).json({ error: (error as any)?.status === 409 ? (error as Error).message : '设置无法保存，请检查输入内容和服务端配置。' }); }
      });
      app.post('/api/media/upload', async (req, res) => {
        const { mimeType, kind } = req.body || {};
        const extension = typeof mimeType === 'string' && TYPES[mimeType];
        if (!extension || !['image', 'audio'].includes(kind) || !mimeType.startsWith(`${kind}/`)) return res.status(400).json({ error: '媒体类型无效。' });
        for (const [id, ticket] of tickets) if (ticket.expires < Date.now()) tickets.delete(id);
        if (tickets.size >= 100) return res.status(429).json({ error: '待上传任务过多，请稍后再试。' });
        const filename = `${randomUUID()}.${extension}`, token = randomBytes(32).toString('base64url');
        tickets.set(hash(token), { filename, mime: mimeType, expires: Date.now() + 10 * 60_000, session: res.locals.sessionId });
        res.json({ uploadUrl: `/api/media/content/${filename}?token=${token}`, mediaPath: `/media/${filename}`, method: 'PUT' });
      });
      app.put('/api/media/content/:filename', express.raw({ type: () => true, limit: '40mb' }), async (req, res) => {
        const token = typeof req.query.token === 'string' ? req.query.token : '';
        const ticket = tickets.get(hash(token));
        if (!ticket || ticket.filename !== req.params.filename || ticket.expires < Date.now() || ticket.session !== res.locals.sessionId) return res.status(403).json({ error: '上传凭证已过期，请重新上传。' });
        tickets.delete(hash(token));
        const limit = ticket.mime.startsWith('audio/') ? 20 * 1024 * 1024 : 40 * 1024 * 1024;
        if (!Buffer.isBuffer(req.body) || !req.body.length || req.body.length > limit || req.get('Content-Type')?.split(';')[0] !== ticket.mime) return res.status(400).json({ error: '文件格式或大小不正确。' });
        try {
          await mkdir(store.mediaDirectory, { recursive: true, mode: 0o700 });
          await writeFile(path.join(store.mediaDirectory, ticket.filename), req.body, { flag: 'wx', mode: 0o600 });
          res.status(201).json({ mediaPath: `/media/${ticket.filename}` });
        } catch { res.status(503).json({ error: '媒体保存失败，请检查磁盘空间。' }); }
      });
      app.use('/media', (_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); }, express.static(store.mediaDirectory, { fallthrough: false, dotfiles: 'deny' }));
      app.use('/api', async (_req, res, next) => {
        try {
          const settings = readSettings(await state.read());
          // A dedicated server can wait for the high-quality models' longer generations.
          runWithAiEnvironment({ ...settingsEnvironment(settings), ONEIROS_AI_TIMEOUT_MS: '600000' }, () => {
            res.locals.archive = { dreamStore: cloudStore, aiConfig: getAiConfig() };
            next();
          });
        } catch { res.status(503).json({ error: 'API 设置不可用，请先完成密钥配置。' }); }
      });
      app.post('/api/settings/test', async (req, res) => {
        if (!['deepseek', 'dashscope'].includes(req.body?.provider)) return res.status(400).json({ error: '请选择要测试的服务商。' });
        try { res.json(await testProviderConnection(req.body.provider)); }
        catch (error) { res.status(502).json({ error: error instanceof AiProviderError ? `连接测试失败：${error.code}。请检查密钥、权限或余额。` : '连接测试失败，请稍后重试。' }); }
      });
    },
  };
}
