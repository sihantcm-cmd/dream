import React, { useRef, useState } from 'react';
import type { DreamEntry } from '../types';
import { importDreams } from '../services/api';

export function ArchiveTools({ disabled, onImported }: { disabled: boolean; onImported: (dreams: DreamEntry[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function restore(file?: File) {
    if (!file) return;
    setBusy(true);
    setNotice('');
    try {
      if (file.size > 49 * 1024 * 1024) throw new Error('备份文件超过 49 MB，请使用 data 文件夹备份恢复。');
      const data = JSON.parse(await file.text());
      const entries = Array.isArray(data) ? data : data.dreams;
      if (!Array.isArray(entries)) throw new Error('请选择 Oneiros JSON 档案备份。');
      const result = await importDreams(entries);
      onImported(result.dreams);
      setNotice(`已导入 ${result.imported} 条，保留 ${result.skipped} 条已有记录。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Import failed.'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }

  async function download() {
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch('/api/archive/export', { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error((await response.json()).error || 'Export failed.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `oneiros-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('已导出档案与本机媒体。请妥善保存备份。');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Export failed.'); }
    finally { setBusy(false); }
  }

  return <div className="mb-5 flex flex-wrap items-center justify-end gap-4 text-xs text-[#78716C]">
    {notice && <span role="status" className="mr-auto">{notice}</span>}
    <button className="hover:text-[#1C1917] underline disabled:opacity-40" disabled={disabled || busy} onClick={download}>Export backup · 导出备份</button>
    <button className="hover:text-[#1C1917] underline disabled:opacity-40" disabled={disabled || busy} onClick={() => input.current?.click()}>Import · 导入</button>
    <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void restore(event.target.files?.[0])} />
  </div>;
}
