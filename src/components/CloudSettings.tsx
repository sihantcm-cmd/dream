import React, { useEffect, useRef, useState } from 'react';
import { X, KeyRound, Check, LoaderCircle } from 'lucide-react';
import { getCloudSettings, saveCloudSettings, testCloudProvider, type CloudSettings as Settings } from '../services/api';

const inputClass = 'mt-2 w-full rounded-md border border-[#DCD6CA] bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#78716C] disabled:bg-[#F4EFEA]';

export function CloudSettings({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [deepseekKey, setDeepseekKey] = useState('');
  const [dashscopeKey, setDashscopeKey] = useState('');
  const [clearDeepseek, setClearDeepseek] = useState(false);
  const [clearDashscope, setClearDashscope] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('loading');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    close.current?.focus();
    void getCloudSettings().then((result) => { if (active) setSettings(result); })
      .catch((issue) => { if (active) setError(issue instanceof Error ? issue.message : '设置加载失败。'); })
      .finally(() => { if (active) setBusy(''); });
    return () => { active = false; document.body.style.overflow = overflow; previousFocus?.focus(); };
  }, []);

  const update = (patch: Partial<Settings>) => { setSettings((current) => current && { ...current, ...patch }); setDirty(true); setNotice(''); };

  async function reload() {
    setBusy('reload'); setError(''); setNotice('');
    try {
      setSettings(await getCloudSettings());
      setClearDeepseek(false); setClearDashscope(false);
      setDirty(Boolean(deepseekKey.trim() || dashscopeKey.trim()));
      setNotice('已读取最新设置。尚未保存的新密钥仍保留在输入框中，请确认后保存。');
    } catch (issue) { setError(issue instanceof Error ? issue.message : '重新读取失败，请重试。'); }
    finally { setBusy(''); }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setBusy('save'); setNotice(''); setError('');
    try {
      const result = await saveCloudSettings({
        deepseekModel: settings.deepseekModel.trim(), deepseekReasoningEffort: settings.deepseekReasoningEffort,
        dashscopeAsrModel: settings.dashscopeAsrModel.trim(), dashscopeImageModel: settings.dashscopeImageModel.trim(),
        dashscopeWorkspaceId: settings.dashscopeWorkspaceId.trim(),
        ...(deepseekKey.trim() ? { deepseekApiKey: deepseekKey.trim() } : {}),
        ...(dashscopeKey.trim() ? { dashscopeApiKey: dashscopeKey.trim() } : {}),
        clearDeepseekKey: clearDeepseek, clearDashscopeKey: clearDashscope,
        ...(settings.updatedAt !== undefined ? { updatedAt: settings.updatedAt } : {}),
      });
      setSettings(result); setDeepseekKey(''); setDashscopeKey(''); setClearDeepseek(false); setClearDashscope(false); setDirty(false);
      setNotice('设置已保存。可以分别测试连接，或返回档案使用 AI 功能。');
      onSaved();
    } catch (issue) { setError(issue instanceof Error ? issue.message : '保存失败，输入仍保留在当前窗口。'); }
    finally { setBusy(''); }
  }

  async function test(provider: 'deepseek' | 'dashscope') {
    setBusy(provider); setNotice(''); setError('');
    try {
      const result = await testCloudProvider(provider);
      setNotice(result.message || `${provider === 'deepseek' ? 'DeepSeek' : '百炼'}连接测试成功。`);
    } catch (issue) { setError(issue instanceof Error ? issue.message : '连接测试失败，请检查密钥和模型权限。'); }
    finally { setBusy(''); }
  }

  function keyboard(event: React.KeyboardEvent) {
    if (event.key === 'Escape' && !busy) onClose();
    if (event.key !== 'Tab') return;
    const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]');
    if (!controls?.length) return;
    const first = controls[0]; const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return <div className="fixed inset-0 z-50 bg-[#1C1917]/50 backdrop-blur-sm flex items-center justify-center px-4 py-6" onKeyDown={keyboard}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="cloud-settings-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-[#FAF8F5] border border-[#DCD6CA] shadow-xl">
      <div className="sticky top-0 bg-[#FAF8F5] z-10 flex justify-between items-center border-b border-[#E7E2DA] px-6 py-5">
        <div><div className="text-[10px] uppercase tracking-[0.2em] text-[#78716C] mb-1">Private Cloud · Personal Settings</div><h2 id="cloud-settings-title" className="font-editorial text-2xl">API 与模型设置</h2></div>
        <button ref={close} type="button" aria-label="关闭设置" disabled={!!busy && busy !== 'loading'} onClick={onClose} className="p-2 rounded-md hover:bg-[#EBE5DC] disabled:opacity-40"><X size={20} /></button>
      </div>
      <form onSubmit={save} className="p-6 space-y-7">
        <p className="text-xs leading-6 text-[#57534E] flex gap-2"><KeyRound className="shrink-0 mt-1" size={14} />密钥加密保存于服务端，保存后不再显示。留空会保留现有密钥。</p>
        {busy === 'loading' && <p role="status" className="text-sm text-[#78716C]">正在读取设置…</p>}
        {settings && <>
          <fieldset disabled={!!busy} className="space-y-4">
            <legend className="font-editorial text-lg font-semibold mb-3">DeepSeek <span className="text-xs font-normal text-[#78716C]">梦境解读 · 象征对话</span></legend>
            <label className="block text-xs">API Key <span className="text-[#78716C] ml-2">{settings.deepseekKeyConfigured ? '已配置' : '待配置'}</span><input type="password" autoComplete="new-password" spellCheck={false} value={deepseekKey} disabled={clearDeepseek} onChange={(event) => { setDeepseekKey(event.target.value); setDirty(true); }} placeholder={settings.deepseekKeyConfigured ? '留空保留；输入新密钥可替换' : '粘贴 DeepSeek API Key'} className={inputClass} /></label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block text-xs">文字模型<input required list="deepseek-models" value={settings.deepseekModel} onChange={(event) => update({ deepseekModel: event.target.value })} className={inputClass} /><datalist id="deepseek-models"><option value="deepseek-v4-pro" /><option value="deepseek-flash" /></datalist></label>
              <label className="block text-xs">思考强度<select value={settings.deepseekReasoningEffort} onChange={(event) => update({ deepseekReasoningEffort: event.target.value as Settings['deepseekReasoningEffort'] })} className={inputClass}><option value="max">MAX · 优先质量</option><option value="high">High</option><option value="low">Low</option><option value="none">关闭深度思考</option></select></label>
            </div>
            {settings.deepseekKeyConfigured && <label className="text-xs flex items-center gap-2 text-[#78716C]"><input type="checkbox" checked={clearDeepseek} onChange={(event) => { setClearDeepseek(event.target.checked); setDeepseekKey(''); setDirty(true); }} />保存时移除 DeepSeek 密钥</label>}
          </fieldset>
          <fieldset disabled={!!busy} className="space-y-4 border-t border-[#E7E2DA] pt-5">
            <legend className="font-editorial text-lg font-semibold pr-3">阿里云百炼 <span className="text-xs font-normal text-[#78716C]">语音转写 · 梦境绘图</span></legend>
            <label className="block text-xs">API Key <span className="text-[#78716C] ml-2">{settings.dashscopeKeyConfigured ? '已配置' : '待配置'}</span><input type="password" autoComplete="new-password" spellCheck={false} value={dashscopeKey} disabled={clearDashscope} onChange={(event) => { setDashscopeKey(event.target.value); setDirty(true); }} placeholder={settings.dashscopeKeyConfigured ? '留空保留；输入新密钥可替换' : '粘贴百炼 API Key'} className={inputClass} /></label>
            <label className="block text-xs">百炼业务空间 ID<input value={settings.dashscopeWorkspaceId} spellCheck={false} onChange={(event) => update({ dashscopeWorkspaceId: event.target.value })} placeholder="使用业务空间密钥时填写 ws-…" className={inputClass} /></label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block text-xs">转写模型<input required list="asr-models" value={settings.dashscopeAsrModel} onChange={(event) => update({ dashscopeAsrModel: event.target.value })} className={inputClass} /><datalist id="asr-models"><option value="qwen-audio-3.1-asr-flash" /><option value="qwen3-asr-flash" /></datalist></label>
              <label className="block text-xs">绘图模型<input required list="image-models" value={settings.dashscopeImageModel} onChange={(event) => update({ dashscopeImageModel: event.target.value })} className={inputClass} /><datalist id="image-models"><option value="qwen-image-3.0-pro" /><option value="qwen-image-max" /></datalist></label>
            </div>
            {settings.dashscopeKeyConfigured && <label className="text-xs flex items-center gap-2 text-[#78716C]"><input type="checkbox" checked={clearDashscope} onChange={(event) => { setClearDashscope(event.target.checked); setDashscopeKey(''); setDirty(true); }} />保存时移除百炼密钥</label>}
          </fieldset>
          <div className="rounded-md border border-[#DDD6C8] bg-[#F4EFEA] p-4 space-y-3">
            <p className="text-xs leading-6 text-[#57534E]">连接测试会发起一次小型真实请求，可能消耗额度。百炼测试验证转写；绘图模型权限请在实际生成时确认。{dirty && ' 请先保存当前修改。'}</p>
            <div className="flex flex-wrap gap-4 text-xs">
              <button type="button" disabled={!!busy || dirty || !settings.deepseekKeyConfigured} onClick={() => void test('deepseek')} className="underline disabled:opacity-40">{busy === 'deepseek' ? '正在测试…' : '测试 DeepSeek'}</button>
              <button type="button" disabled={!!busy || dirty || !settings.dashscopeKeyConfigured} onClick={() => void test('dashscope')} className="underline disabled:opacity-40">{busy === 'dashscope' ? '正在测试…' : '测试百炼'}</button>
            </div>
          </div>
        </>}
        {error && <div className="space-y-2"><p role="alert" className="text-sm text-red-800 leading-6">{error}</p><button type="button" disabled={!!busy} onClick={() => void reload()} className="text-xs underline text-[#78716C] disabled:opacity-40">重新读取设置（保留未保存的新密钥）</button></div>}
        {notice && <p role="status" className="text-sm text-[#466248] leading-6">{notice}</p>}
        <div className="flex justify-end gap-3 border-t border-[#E7E2DA] pt-5"><button type="button" disabled={!!busy && busy !== 'loading'} onClick={onClose} className="px-4 py-2 text-sm text-[#57534E] disabled:opacity-40">关闭</button><button type="submit" disabled={!!busy || !settings || !dirty} className="inline-flex items-center gap-2 px-5 py-2 rounded-md text-sm bg-[#1C1917] text-white disabled:opacity-40">{busy === 'save' ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}保存设置</button></div>
      </form>
    </div>
  </div>;
}
