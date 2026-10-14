import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface CloudSessionConfig {
  mode: 'cloud' | 'local';
  configured: boolean;
  provider?: 'aliyun' | 'supabase';
  authType?: 'password' | 'email-otp';
  authenticated?: boolean;
  email?: string;
  supabaseUrl?: string;
  publishableKey?: string;
  error?: string;
}

let configuration: CloudSessionConfig | null = null;
let configurationRequest: Promise<CloudSessionConfig> | null = null;
let client: SupabaseClient | null = null;

export function getSessionConfig(retry = false): Promise<CloudSessionConfig> {
  if (retry) configurationRequest = null;
  configurationRequest ||= fetch('/api/session', { signal: AbortSignal.timeout(15_000) }).then(async (response) => {
    if (!response.ok) throw new Error('无法连接云端服务，请稍后重试。');
    const next: CloudSessionConfig = await response.json();
    if (!['local', 'cloud'].includes(next.mode)) throw new Error('服务器配置响应无效。');
    configuration = next;
    if (next.mode === 'cloud' && next.provider !== 'aliyun' && next.configured && next.supabaseUrl && next.publishableKey && !client) {
      client = createClient(next.supabaseUrl, next.publishableKey);
    }
    return next;
  }).catch((error) => { configurationRequest = null; throw error; });
  return configurationRequest;
}

export function isCloudMode(): boolean { return configuration?.mode === 'cloud'; }
export function isAliyunMode(): boolean { return isCloudMode() && configuration?.provider === 'aliyun'; }

export function getCloudClient(): SupabaseClient {
  if (!client) throw new Error('云端登录尚未配置完成。');
  return client;
}

export async function authenticatedHeaders(headers?: HeadersInit): Promise<Headers> {
  const result = new Headers(headers);
  if (isCloudMode() && !isAliyunMode()) {
    const { data, error } = await getCloudClient().auth.getSession();
    if (error || !data.session) {
      notifySessionExpired();
      throw new Error('登录已失效，请重新登录。');
    }
    result.set('Authorization', `Bearer ${data.session.access_token}`);
  }
  return result;
}

export async function loginWithPassword(username: string, password: string): Promise<void> {
  const response = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
    body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || '登录失败，请检查账号与密码。');
  }
}

export async function logoutPasswordSession(): Promise<void> {
  const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('退出登录失败，请重试。');
}

export function notifySessionExpired(): void {
  if (isCloudMode()) window.dispatchEvent(new Event('oneiros:session-expired'));
}

export async function requestLoginCode(email: string): Promise<void> {
  const response = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || '验证码发送失败，请稍后重试。');
  }
}

// Drafts from the local edition must never appear in another cloud session.
export function clearCloudDrafts(): void {
  for (const storageName of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = window[storageName];
      for (const key of Object.keys(storage)) {
        if (key.startsWith('oneiros_pending_generation_') || key.startsWith('oneiros_pending_chat_') || key === 'oneiros_pending_draft_v1') storage.removeItem(key);
      }
    } catch { /* Private browsing can disable storage. */ }
  }
}
