import type express from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ArchiveRuntime } from './runtime';
import { createCloudDreamStore } from './cloudStore';
import { getAiConfig } from './aiConfig';
import { runWithAiEnvironment } from './aiEnvironment';
import { AiProviderError, testProviderConnection } from './domesticAi';
import { DEFAULT_SETTINGS, publicSettings, settingsEnvironment, updateSettings, type AiSettings } from './settings';
import { openSettings, sealSettings, validateEncryptionKey } from './secretBox';

type SettingsRecord = { settings: AiSettings; updatedAt: string | null };
interface RuntimeOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  clientFactory?: typeof createClient;
  testConnection?: typeof testProviderConnection;
}

function publicOrigin(value: string | undefined): string {
  if (!value) throw new Error('Missing URL.');
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.protocol !== 'https:') {
    throw new Error('An HTTPS origin is required.');
  }
  return url.origin;
}

function statusError(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}

function isPublicSupabaseKey(value: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(value)) return true;
  // Legacy anon keys are JWTs. Check the declared role before publishing one;
  // authentication/signature verification remains Supabase's responsibility.
  const parts = value.split('.');
  if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return false;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role === 'anon'; }
  catch { return false; }
}

function sendStorageError(res: express.Response, error: unknown) {
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 503;
  const safeStatus = [400, 409, 413].includes(status) ? status : 503;
  return res.status(safeStatus).json({ error: safeStatus === 503 ? '云端存储暂时不可用，请检查部署配置后重试。' : (error as Error).message });
}

/** Supabase edition: only the configured owner can use the server-side archive. */
export function createSupabaseRuntime(options: RuntimeOptions = {}): ArchiveRuntime {
  const environment = options.environment ?? process.env;
  const makeClient = options.clientFactory ?? createClient;
  const testConnection = options.testConnection ?? testProviderConnection;
  let supabaseUrl = '', appOrigin = '', publishableKey = '', ownerEmail = '', encryptionKey = '';
  let service: SupabaseClient | undefined;
  let authClient: SupabaseClient | undefined;
  try {
    supabaseUrl = publicOrigin(environment.SUPABASE_URL);
    appOrigin = publicOrigin(environment.APP_ORIGIN);
    publishableKey = environment.SUPABASE_PUBLISHABLE_KEY || environment.SUPABASE_ANON_KEY || '';
    ownerEmail = environment.OWNER_EMAIL?.trim().toLowerCase() ?? '';
    encryptionKey = environment.SETTINGS_ENCRYPTION_KEY ?? '';
    const serviceKey = environment.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!isPublicSupabaseKey(publishableKey) || !serviceKey || publishableKey === serviceKey || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error('Incomplete cloud configuration.');
    validateEncryptionKey(encryptionKey);
    const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    service = makeClient(supabaseUrl, serviceKey, clientOptions);
    authClient = makeClient(supabaseUrl, publishableKey, clientOptions);
  } catch {
    // Public session remains available so the setup screen can explain missing configuration.
    // No partial configuration is allowed to activate an unauthenticated/local fallback.
    service = undefined;
    authClient = undefined;
  }

  async function readSettings(userId: string): Promise<SettingsRecord> {
    const result = await service!.from('ai_settings').select('ciphertext,updated_at').eq('owner_id', userId).maybeSingle();
    if (result.error) statusError('Settings unavailable.', 503);
    if (!result.data) return { settings: { ...DEFAULT_SETTINGS }, updatedAt: null };
    const settings = updateSettings({ ...DEFAULT_SETTINGS }, openSettings(result.data.ciphertext, userId, encryptionKey));
    // PostgREST serializes timestamptz as +00:00 while our writes use Z. Keep the
    // version token canonical so saving twice from one settings dialog works.
    return { settings, updatedAt: new Date(result.data.updated_at).toISOString() };
  }

  return {
    mount(app) {
      app.get('/api/session', (_req, res) => {
        const configured = Boolean(service && authClient);
        res.json({
          mode: 'cloud', provider: 'supabase', authType: 'email-otp', configured,
          ...(configured ? { supabaseUrl, publishableKey } : {}),
        });
      });

      app.post('/api/auth/login', async (req, res) => {
        if (!authClient) return res.status(503).json({ error: '请先完成 Supabase 和站点环境变量配置。' });
        if (typeof req.body?.email !== 'string' || req.body.email.trim().toLowerCase() !== ownerEmail) {
          return res.status(403).json({ error: '仅站点所有者可以登录。' });
        }
        try {
          const result = await authClient.auth.signInWithOtp({ email: ownerEmail, options: { shouldCreateUser: true, emailRedirectTo: appOrigin } });
          if (result.error) return res.status(429).json({ error: '登录邮件暂时无法发送，请稍后重试并检查 Supabase 邮件服务配置。' });
          return res.json({ ok: true });
        } catch { return res.status(503).json({ error: '登录服务暂时不可用，请稍后重试。' }); }
      });

      // Public endpoints above are the only exceptions. Dreams, health, settings,
      // upload tokens and all AI routes below require a freshly verified owner JWT.
      app.use('/api', async (req, res, next) => {
        if (!service) return res.status(503).json({ error: '个人云端服务尚未完成配置。', code: 'CLOUD_NOT_CONFIGURED' });
        const authorization = req.get('Authorization') ?? '';
        const match = authorization.match(/^Bearer ([A-Za-z0-9._-]{20,10000})$/);
        if (!match) return res.status(401).json({ error: '请先登录。', code: 'AUTH_REQUIRED' });
        try {
          const result = await service.auth.getUser(match[1]);
          const user = result.data?.user;
          if (result.error || !user) return res.status(401).json({ error: '登录已过期，请重新登录。', code: 'AUTH_REQUIRED' });
          if (!user.email_confirmed_at || user.email?.toLowerCase() !== ownerEmail) {
            return res.status(403).json({ error: '仅已验证邮箱的站点所有者可以访问。' });
          }
          const record = await readSettings(user.id);
          const dreamStore = createCloudDreamStore(service, user.id);
          res.locals.cloudOwnerId = user.id;
          res.locals.cloudSettings = record;
          runWithAiEnvironment(settingsEnvironment(record.settings), () => {
            res.locals.archive = { dreamStore, aiConfig: getAiConfig() };
            next();
          });
        } catch { return res.status(503).json({ error: '云端身份或配置服务暂时不可用，请稍后重试。' }); }
      });

      app.get('/api/settings', (_req, res) => {
        const record = res.locals.cloudSettings as SettingsRecord;
        res.json({ ...publicSettings(record.settings), updatedAt: record.updatedAt });
      });

      app.put('/api/settings', async (req, res) => {
        const ownerId = res.locals.cloudOwnerId as string;
        const current = res.locals.cloudSettings as SettingsRecord;
        if (req.body?.updatedAt !== current.updatedAt) {
          return res.status(409).json({ error: '设置已在其他页面更新，请关闭后重新打开设置再保存。' });
        }
        let settings: AiSettings;
        try { settings = updateSettings(current.settings, req.body); }
        catch (error) { return res.status(400).json({ error: (error as Error).message }); }
        try {
          const updatedAt = new Date(Math.max(Date.now(), current.updatedAt ? Date.parse(current.updatedAt) + 1 : 0)).toISOString();
          const values = { ciphertext: sealSettings(settings, ownerId, encryptionKey), updated_at: updatedAt };
          if (current.updatedAt === null) {
            const result = await service!.from('ai_settings').insert({ owner_id: ownerId, ...values });
            if (result.error?.code === '23505') statusError('设置已在其他页面更新，请重新打开设置。', 409);
            if (result.error) statusError('Settings unavailable.', 503);
          } else {
            const result = await service!.from('ai_settings').update(values).eq('owner_id', ownerId)
              .eq('updated_at', current.updatedAt).select('owner_id');
            if (result.error) statusError('Settings unavailable.', 503);
            if (result.data?.length !== 1) statusError('设置已在其他页面更新，请重新打开设置。', 409);
          }
          return res.json({ ...publicSettings(settings), updatedAt });
        } catch (error) { return sendStorageError(res, error); }
      });

      app.post('/api/settings/test', async (req, res) => {
        const provider = req.body?.provider;
        if (provider !== 'deepseek' && provider !== 'dashscope') return res.status(400).json({ error: '请选择有效的服务商。' });
        try { return res.json(await testConnection(provider)); }
        catch (error) {
          const code = error instanceof AiProviderError ? error.code : 'PROVIDER_ERROR';
          return res.status(code === 'AI_NOT_CONFIGURED' ? 503 : 502).json({
            error: '连接测试未通过，请检查已保存的密钥、模型权限、业务空间与服务商余额。', provider, code,
          });
        }
      });

      app.post('/api/media/upload', async (req, res) => {
        const { mimeType, kind } = req.body ?? {};
        if (typeof mimeType !== 'string' || (kind !== 'image' && kind !== 'audio')) return res.status(400).json({ error: '请提供有效的文件类型。' });
        try {
          const dreamStore = res.locals.archive.dreamStore as ReturnType<typeof createCloudDreamStore>;
          return res.json(await dreamStore.createUpload(mimeType, kind));
        } catch (error) { return sendStorageError(res, error); }
      });
    },
  };
}
