import React, { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { LockKeyhole, Mail, ArrowRight, RefreshCw } from 'lucide-react';
import { clearCloudDrafts, getCloudClient, getSessionConfig, loginWithPassword, logoutPasswordSession, requestLoginCode, type CloudSessionConfig } from '../services/cloud';

export interface CloudAccess { cloud: boolean; provider?: 'aliyun' | 'supabase'; email?: string; signOut: () => Promise<void> }

export function CloudGate({ children }: { children: (access: CloudAccess) => React.ReactNode }) {
  const [config, setConfig] = useState<CloudSessionConfig | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sentEmail, setSentEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const previousUser = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    setLoading(true);
    setConfig(null);
    setSession(null);
    setError('');
    void getSessionConfig(revision > 0).then(async (next) => {
      if (!active) return;
      setConfig(next);
      if (next.mode === 'cloud' && next.configured && next.provider !== 'aliyun') {
        const auth = getCloudClient().auth;
        const { data, error: authError } = await auth.getSession();
        if (authError) throw new Error('无法读取登录状态，请重新登录。');
        if (!active) return;
        if (previousUser.current && data.session?.user.id && previousUser.current !== data.session.user.id) clearCloudDrafts();
        previousUser.current = data.session?.user.id ?? null;
        setSession(data.session);
        const subscription = auth.onAuthStateChange((event, current) => {
          if (!active) return;
          if (event === 'SIGNED_OUT' || (previousUser.current && current?.user.id && previousUser.current !== current.user.id)) clearCloudDrafts();
          previousUser.current = current?.user.id ?? null;
          setSession(current);
        });
        unsubscribe = () => subscription.data.subscription.unsubscribe();
      }
    }).catch((issue) => { if (active) setError(issue instanceof Error ? issue.message : '无法连接服务器。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; unsubscribe?.(); };
  }, [revision]);

  useEffect(() => {
    const expired = () => {
      setSession(null);
      setConfig((current) => current ? { ...current, authenticated: false } : null);
      setError('登录已过期，请重新登录。草稿仍保留在本次浏览器会话中。');
    };
    window.addEventListener('oneiros:session-expired', expired);
    return () => window.removeEventListener('oneiros:session-expired', expired);
  }, []);

  useEffect(() => {
    if (!cooldown) return;
    const timeout = window.setTimeout(() => setCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearTimeout(timeout);
  }, [cooldown]);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const address = email.trim().toLowerCase();
      await requestLoginCode(address);
      setSentEmail(address); setCode(''); setCooldown(60);
    } catch (issue) { setError(issue instanceof Error ? issue.message : '发送失败，请重试。'); }
    finally { setBusy(false); }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const { error: verificationError } = await getCloudClient().auth.verifyOtp({ email: sentEmail, token: code.trim(), type: 'email' });
      if (verificationError) throw new Error('验证码无效或已过期，请检查邮件或重新发送。');
      setCode(''); setSentEmail('');
    } catch (issue) { setError(issue instanceof Error ? issue.message : '登录失败，请重试。'); }
    finally { setBusy(false); }
  }

  async function passwordLogin(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await loginWithPassword(email.trim(), password);
      setPassword('');
      setRevision((current) => current + 1);
    } catch (issue) { setError(issue instanceof Error ? issue.message : '登录失败，请重试。'); }
    finally { setBusy(false); }
  }

  const signOut = async () => {
    if (config?.provider === 'aliyun') {
      await logoutPasswordSession();
      clearCloudDrafts();
      setConfig((current) => current ? { ...current, authenticated: false } : null);
      setRevision((current) => current + 1);
      return;
    }
    const { error: logoutError } = await getCloudClient().auth.signOut({ scope: 'local' });
    if (logoutError) throw new Error('退出登录失败，请重试。');
    clearCloudDrafts();
    setSession(null);
  };

  if (!loading && config?.mode === 'local') return <>{children({ cloud: false, signOut })}</>;
  if (!loading && config?.configured && config.provider === 'aliyun' && config.authenticated) return <React.Fragment key="aliyun-owner">{children({ cloud: true, provider: 'aliyun', email: config.email, signOut })}</React.Fragment>;
  if (!loading && config?.configured && config.provider !== 'aliyun' && session) return <React.Fragment key={session.user.id}>{children({ cloud: true, provider: 'supabase', email: session.user.email, signOut })}</React.Fragment>;

  return <div className="min-h-screen bg-[#FAF8F5] text-[#1C1917] flex items-center justify-center px-6 py-14">
    <main className="w-full max-w-md">
      <div className="mb-10 flex items-center gap-3"><span className="w-9 h-9 rounded-full bg-[#1C1917] text-[#FAF8F5] flex items-center justify-center font-cinzel">Ω</span><span className="font-editorial text-3xl font-semibold">Oneiros</span></div>
      <div className="border-t border-[#DCD6CA] pt-8">
        <div className="mb-5 flex items-center gap-2 text-[11px] tracking-[0.2em] uppercase text-[#78716C]"><LockKeyhole size={14} /> Private Dream Archive</div>
        <h1 className="font-editorial text-3xl mb-3">{loading ? '正在打开你的档案' : !config?.configured ? '云端配置尚未完成' : '回到你的梦境'}</h1>
        {loading ? <p role="status" className="text-sm text-[#78716C]">正在连接私人云端服务…</p> : !config?.configured ? <>
          <p className="text-sm text-[#57534E] leading-7">{config?.error || '网站已部署，需要完成私人账号、存储与站点环境变量配置后才能登录。'}</p>
          <p className="mt-4 text-xs text-[#78716C] leading-6">请按项目 README 中对应云端版本的部署步骤完成配置并重启服务。</p>
          <button onClick={() => setRevision((value) => value + 1)} className="mt-6 inline-flex items-center gap-2 text-sm underline"><RefreshCw size={14} /> 重新检查</button>
        </> : <>
          <p className="text-sm text-[#57534E] leading-7 mb-7">使用你的私人{config.provider === 'aliyun' ? '账号' : '邮箱'}登录。梦境、录音与画作仅对你开放。</p>
          {config.provider === 'aliyun' ? <form onSubmit={passwordLogin} className="space-y-4">
            <label className="block text-xs text-[#57534E]">登录账号<input autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-md border border-[#DCD6CA] bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#78716C]" placeholder="你的私人账号" /></label>
            <label className="block text-xs text-[#57534E]">密码<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-md border border-[#DCD6CA] bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#78716C]" /></label>
            <button disabled={busy} className="w-full flex items-center justify-center gap-2 bg-[#1C1917] text-white rounded-md px-4 py-3 text-sm disabled:opacity-40">{busy ? '登录中…' : '进入私人档案'}<ArrowRight size={15} /></button>
          </form> : !sentEmail ? <form onSubmit={sendCode} className="space-y-4">
            <label className="block text-xs text-[#57534E]">登录邮箱<input autoComplete="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-md border border-[#DCD6CA] bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#78716C]" placeholder="you@example.com" /></label>
            <button disabled={busy || cooldown > 0} className="w-full flex items-center justify-center gap-2 bg-[#1C1917] text-white rounded-md px-4 py-3 text-sm disabled:opacity-40"><Mail size={15} />{busy ? '发送中…' : cooldown ? `${cooldown} 秒后可重发` : '发送登录验证码'}</button>
          </form> : <form onSubmit={verifyCode} className="space-y-4">
            <p role="status" className="text-xs text-[#57534E] leading-6">验证码已发送至 {sentEmail}，请检查收件箱与垃圾邮件。</p>
            <label className="block text-xs text-[#57534E]">邮件验证码<input autoFocus autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} className="mt-2 w-full rounded-md border border-[#DCD6CA] bg-white px-4 py-3 text-lg tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-[#78716C]" /></label>
            <button disabled={busy} className="w-full flex items-center justify-center gap-2 bg-[#1C1917] text-white rounded-md px-4 py-3 text-sm disabled:opacity-40">{busy ? '验证中…' : '进入私人档案'}<ArrowRight size={15} /></button>
            <button type="button" disabled={busy} onClick={() => { setSentEmail(''); setCode(''); setError(''); }} className="text-xs underline text-[#78716C]">更换邮箱或重新发送</button>
          </form>}
        </>}
        {error && <p role="alert" className="mt-5 text-sm text-red-800 leading-6">{error}</p>}
      </div>
      <p className="mt-12 text-xs text-[#A8A29E] font-body-serif italic">Dreams, symbols & imagination.</p>
    </main>
  </div>;
}
