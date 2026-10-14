import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Maximize2,
  MessageSquare,
  Sparkles,
  Volume2,
  ArrowRight,
  BookOpen,
  CornerDownLeft,
} from 'lucide-react';
import { DreamEntry, DreamSymbol } from '../types';
import { interpretDream, generateSurrealistImage, getHealth } from '../services/api';
import type { BackendHealth } from '../services/api';
import { resolutionLabel } from '../services/imageOptions';

const pendingKey = (id: string) => `oneiros_pending_generation_${id}`;
function recoverGeneration(dream: DreamEntry): DreamEntry | null {
  try {
    const entry = JSON.parse(sessionStorage.getItem(pendingKey(dream.id)) || 'null');
    return entry?.id === dream.id && entry?.createdAt === dream.createdAt && entry?.transcript === dream.transcript && entry?.interpretation
      ? entry : null;
  } catch { return null; }
}

interface DreamDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  dream: DreamEntry;
  onOpenChat: (dream: DreamEntry, symbolQuery?: string) => void;
  onUpdate: (dream: DreamEntry) => Promise<DreamEntry>;
  onDelete: (id: string) => Promise<void>;
}

export const DreamDetailModal: React.FC<DreamDetailModalProps> = ({
  isOpen,
  onClose,
  dream,
  onOpenChat,
  onUpdate,
  onDelete,
}) => {
  const [isClosing, setIsClosing] = useState(false);
  const [isImageZoomed, setIsImageZoomed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(dream.title);
  const [notes, setNotes] = useState(dream.emotionalNotes || '');
  const [pendingDream, setPendingDream] = useState<DreamEntry | null>(() => recoverGeneration(dream));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const mounted = useRef(true);
  const generationAbort = useRef<AbortController | null>(null);
  const canSynthesize = !!pendingDream ||
    (dream.status === 'draft' ? health?.capabilities.interpret : health?.capabilities.image);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generationAbort.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    getHealth().then((status) => { if (active) setHealth(status); }).catch(() => {});
    return () => { active = false; };
  }, [isOpen]);

  useEffect(() => {
    if (!editing) { setTitle(dream.title); setNotes(dream.emotionalNotes || ''); }
  }, [dream.title, dream.emotionalNotes, editing]);

  const rememberGeneration = (entry: DreamEntry | null) => {
    if (!mounted.current) return;
    setPendingDream(entry);
    try {
      if (entry) sessionStorage.setItem(pendingKey(dream.id), JSON.stringify(entry));
      else sessionStorage.removeItem(pendingKey(dream.id));
    } catch { /* Retain the in-memory result if browser storage is full. */ }
  };

  const saveEdits = async () => {
    if (!title.trim()) return;
    setBusy(true); setNotice('');
    try {
      const saved = await onUpdate({ ...dream, title: title.trim(), emotionalNotes: notes.trim() });
      if (pendingDream) rememberGeneration({ ...pendingDream, title: saved.title, emotionalNotes: saved.emotionalNotes, chatHistory: saved.chatHistory });
      setEditing(false);
    }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save changes.'); }
    finally { setBusy(false); }
  };

  const synthesize = async () => {
    if (busy || !canSynthesize) return;
    const controller = new AbortController();
    generationAbort.current = controller;
    setBusy(true); setNotice('正在解读梦境…');
    try {
      let entry = pendingDream ? { ...pendingDream, chatHistory: dream.chatHistory } : dream;
      if (entry.status === 'draft') {
        const interpretation = await interpretDream(entry.transcript, entry.emotionalNotes, controller.signal);
        if (!mounted.current) return;
        entry = { ...entry, status: 'complete', title: interpretation.title, interpretation, imagePrompt: interpretation.surrealistImagePrompt };
        rememberGeneration(entry);
      }
      if (!entry.imageUrl) {
        // Persist the interpretation even when resuming a previous failed save.
        entry = await onUpdate(entry);
        if (!mounted.current) return;
        rememberGeneration(entry);
        if (!health?.capabilities.image) {
          rememberGeneration(null);
          setNotice('梦境解读已保存。绘图服务尚未配置，可稍后补充画作。');
          return;
        }
        entry = {
          ...entry,
          resolution: health.imageOptions.resolutions.includes(entry.resolution) ? entry.resolution : health.imageOptions.resolutions[0],
          aspectRatio: health.imageOptions.aspectRatios.includes(entry.aspectRatio) ? entry.aspectRatio : health.imageOptions.aspectRatios[0],
        };
        setNotice('正在生成画作；梦境原文与解读已保留…');
        const result = await generateSurrealistImage(entry.imagePrompt, entry.resolution, entry.aspectRatio, controller.signal);
        if (!mounted.current) return;
        entry = { ...entry, imageUrl: result.imageUrl, imagePath: result.imagePath };
        rememberGeneration(entry);
      }
      if (!mounted.current) return;
      await onUpdate(entry);
      rememberGeneration(null); setNotice('已保存解读与画作。');
    } catch (error) { if (mounted.current) setNotice(error instanceof Error ? error.message : 'Generation interrupted. Please retry.'); }
    finally { generationAbort.current = null; if (mounted.current) setBusy(false); }
  };

  // Keyboard shortcut: ESC to trigger animated dissolution
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isImageZoomed) {
          setIsImageZoomed(false);
        } else {
          handleAnimateClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isImageZoomed, busy]);

  const handleAnimateClose = () => {
    if (isClosing || busy) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 380);
  };

  const handleTransitionToChat = (symbolQuery?: string) => {
    if (isClosing || busy) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
      onOpenChat(dream, symbolQuery);
    }, 380);
  };

  if (!isOpen) return null;

  const formattedDate = new Date(dream.createdAt).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleAnimateClose();
        }
      }}
      className={`fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-6 bg-black/65 backdrop-blur-md overflow-y-auto transition-all ${
        isClosing ? 'animate-backdrop-out' : 'animate-backdrop-in'
      }`}
    >
      <div
        className={`relative w-full max-w-5xl my-6 bg-[#FAF8F5] border border-[#DCD6CA] rounded-xl shadow-2xl overflow-hidden text-[#1C1917] ${
          isClosing ? 'animate-dream-out' : 'animate-dream-in'
        }`}
      >
        {/* Curatorial Header */}
        <div className="px-6 sm:px-8 pt-7 pb-5 border-b border-[#E7E2DA] flex items-start justify-between gap-4 bg-[#F6F2EC]">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-widest text-[#78716C] font-cinzel mb-1">
              <span>Accession № {dream.id.slice(-6).toUpperCase()}</span>
              <span aria-hidden="true">·</span>
              <span>{formattedDate}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[11px] text-[#B45309] font-bold">{dream.imageUrl ? resolutionLabel(dream.resolution) : 'WRITTEN DREAM'}</span>
            </div>
            <h2 className="font-editorial text-2xl sm:text-4xl font-semibold text-[#1C1917] leading-tight truncate sm:whitespace-normal">
              {dream.title}
            </h2>
            {dream.emotionalNotes && (
              <p className="text-xs text-[#78716C] italic font-body-serif mt-1">
                Waking Emotion: "{dream.emotionalNotes}"
              </p>
            )}
          </div>

          {/* Action Header Buttons: Clearly visible Close button */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={() => handleTransitionToChat()}
              disabled={isClosing}
              className="hidden sm:flex items-center gap-2 px-3.5 py-2 text-xs font-semibold uppercase tracking-wider text-[#FAF8F5] bg-[#1C1917] hover:bg-[#2F2B28] rounded-lg transition-all shadow-xs cursor-pointer active:scale-95 disabled:opacity-50"
            >
              <MessageSquare className="w-3.5 h-3.5 text-[#D6CEBE]" />
              <span>Ask Analyst</span>
            </button>

            {/* Prominent High-Visibility Close Button with Dream Dissolution Effect */}
            <button
              onClick={handleAnimateClose}
              disabled={isClosing}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold uppercase tracking-wider text-[#1C1917] bg-[#FAF8F5] hover:bg-[#1C1917] hover:text-[#FAF8F5] border-2 border-[#1C1917] rounded-lg transition-all duration-200 shadow-sm cursor-pointer group active:scale-95"
              title="Close exhibition and awaken (Press ESC)"
              aria-label="Close dream modal"
            >
              <X className="w-4 h-4 transition-transform group-hover:rotate-90 group-hover:scale-110" />
              <span className="font-semibold">Close</span>
              <kbd className="hidden sm:inline-block text-[10px] bg-black/10 group-hover:bg-white/20 px-1.5 py-0.5 rounded font-mono font-medium">
                ESC
              </kbd>
            </button>
          </div>
        </div>

        {/* Scrollable Exhibition Body */}
        <div className="p-6 sm:p-8 space-y-10 max-h-[76vh] overflow-y-auto">
          <div className="rounded-lg border border-[#DDD6C8] bg-[#F4EFEA] p-4 space-y-3 text-xs">
            <div className="flex flex-wrap gap-4 items-center">
              <span className="mr-auto">{dream.status === 'draft' ? '草稿已保存 · 尚未进行 AI 解读' : '已保存到私人档案'}</span>
              {(dream.status === 'draft' || !dream.imageUrl || pendingDream) && <button disabled={busy || !canSynthesize} onClick={synthesize} className="underline disabled:opacity-40">{busy ? '处理中…' : dream.status === 'draft' && !health?.capabilities.image ? 'Interpret · 解读梦境' : 'Generate / Retry · 生成或重试'}</button>}
              <button disabled={busy} onClick={() => setEditing(!editing)} className="underline">Edit · 编辑</button>
              <button disabled={busy} onClick={() => setConfirmDelete(!confirmDelete)} className="text-red-800 underline">Delete · 删除</button>
            </div>
            {confirmDelete && <div className="flex flex-wrap gap-4 items-center text-red-800"><span>删除这条梦境？可先导出备份。</span><button disabled={busy} onClick={async () => { setBusy(true); try { await onDelete(dream.id); } catch (error) { setNotice(error instanceof Error ? error.message : 'Delete failed.'); } finally { setBusy(false); } }} className="font-semibold underline">确认删除</button><button onClick={() => setConfirmDelete(false)}>取消</button></div>}
            {editing && <div className="space-y-3">
              <label className="block">Title · 标题<input className="mt-1 block w-full rounded border p-2 bg-white" value={title} maxLength={300} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
              <label className="block">Waking notes · 醒后感受<input className="mt-1 block w-full rounded border p-2 bg-white" value={notes} maxLength={4000} disabled={busy} onChange={(event) => setNotes(event.target.value)} /></label>
              <button disabled={busy || !title.trim()} onClick={saveEdits} className="rounded bg-[#1C1917] text-white px-4 py-2 disabled:opacity-40">Save changes · 保存修改</button>
            </div>}
            {notice && <p role="status" className="text-[#92400E]">{notice}</p>}
          </div>
          {/* SECTION 1: SURREALIST ARTWORK GALLERY SHOWCASE */}
          <section className="space-y-4">
            <div className="relative group bg-[#161514] rounded-xl overflow-hidden border border-[#D5CEC2] shadow-md flex items-center justify-center min-h-[360px] max-h-[640px]">
              {dream.imageUrl ? <img
                src={dream.imageUrl}
                alt={dream.title}
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain max-h-[640px] transition-transform duration-300 group-hover:scale-[1.01]"
              /> : <div className="text-[#D6CEBE] text-center space-y-4"><div className="text-5xl">☾</div><p className="font-body-serif">梦境已记录，尚未生成画作。</p></div>}

              {/* Artwork Hover Toolbar */}
              {dream.imageUrl && <div className="absolute bottom-4 right-4 flex items-center gap-2 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => setIsImageZoomed(true)}
                  className="p-2.5 bg-[#FAF8F5]/90 hover:bg-[#FAF8F5] text-[#1C1917] rounded-lg shadow-md text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer backdrop-blur-xs"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Inspect Detail</span>
                </button>
              </div>}

              {/* Resolution Tag Indicator */}
              <div className="absolute top-4 left-4 bg-black/65 text-[#FAF8F5] px-3 py-1 rounded text-xs font-mono backdrop-blur-xs border border-white/10">
                {dream.imageUrl ? `${resolutionLabel(dream.resolution)} · ${dream.aspectRatio} · Dalí & Magritte Aesthetic` : 'Written Dream · 文字档案'}
              </div>
            </div>

            {/* Artwork Curatorial Caption */}
            <div className="px-2 text-xs font-body-serif text-[#78716C] italic leading-relaxed flex flex-col sm:flex-row items-start justify-between gap-3">
              <div className="flex-1">
                {dream.imageUrl ? `Fig. 1 — ${dream.imagePrompt}` : '原文已保留，可随时生成解读与画作。'}
              </div>
              {dream.audioUrl && (
                <div className="flex items-center gap-2 shrink-0 not-italic">
                  <Volume2 className="w-3.5 h-3.5 text-[#B45309]" />
                  <audio src={dream.audioUrl} controls className="h-7 w-48" />
                </div>
              )}
            </div>
          </section>

          {/* SECTION 2: TRANSCRIPTION NARRATIVE WITH DROP-CAP */}
          <section className="space-y-3 border-y border-[#E7E2DA] py-8">
            <div className="text-xs font-cinzel uppercase tracking-widest text-[#78716C]">
              Morning Verbatim Narrative
            </div>
            <div className="prose prose-stone max-w-prose text-base leading-relaxed text-[#292524] font-body-serif">
              <p className="first-letter:text-5xl first-letter:font-editorial first-letter:font-bold first-letter:float-left first-letter:mr-3 first-letter:mt-1 first-letter:text-[#1C1917]">
                {dream.transcript}
              </p>
            </div>
          </section>

          {/* SECTION 3: STRUCTURED JUNGIAN PSYCHOLOGICAL INTERPRETATION */}
          {dream.status !== 'draft' && <section className="space-y-8">
            <div className="border-b border-[#E7E2DA] pb-3 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-widest text-[#78716C] font-cinzel mb-1">
                  Depth Psychological Synthesis
                </div>
                <h3 className="font-editorial text-2xl font-semibold text-[#1C1917]">
                  Jungian Archetype & Symbol Analysis
                </h3>
              </div>
              <div className="text-xs text-[#78716C]">
                Dominant Mood: <strong className="text-[#1C1917]">{dream.interpretation?.dominantMood}</strong>
              </div>
            </div>

            {/* Core Theme & Unconscious Tension Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 bg-[#F4EFEA] border border-[#DFD8CC] rounded-xl space-y-2">
                <div className="text-xs uppercase tracking-wider font-semibold text-[#B45309]">
                  Core Unconscious Theme
                </div>
                <h4 className="font-editorial text-lg font-medium text-[#1C1917]">
                  {dream.interpretation?.coreTheme}
                </h4>
              </div>

              <div className="p-6 bg-[#F4EFEA] border border-[#DFD8CC] rounded-xl space-y-2">
                <div className="text-xs uppercase tracking-wider font-semibold text-[#1E3A8A]">
                  Ego-Unconscious Tension
                </div>
                <p className="text-sm font-body-serif text-[#44403C] leading-relaxed">
                  {dream.interpretation?.unconsciousTension}
                </p>
              </div>
            </div>

            {/* Archetypes Breakdown */}
            <div className="space-y-4">
              <h4 className="font-editorial text-xl font-medium text-[#1C1917]">
                Detected Jungian Archetypes
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {dream.interpretation?.archetypes?.map((arch, idx) => (
                  <div
                    key={idx}
                    className="p-5 bg-white border border-[#E0D9CD] rounded-xl space-y-3 flex flex-col justify-between hover:border-[#1C1917] transition-colors shadow-xs"
                  >
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wider font-cinzel font-semibold text-[#1C1917]">
                        {arch.name}
                      </div>
                      <p className="text-xs text-[#57534E] font-body-serif leading-relaxed">
                        {arch.description}
                      </p>
                    </div>
                    <div className="pt-2 border-t border-[#F0EBE3] text-xs text-[#78716C] italic font-body-serif">
                      <span className="font-medium not-italic text-[#1C1917]">In Dream: </span>
                      {arch.appearanceInDream}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Symbol Catalog with Direct Chat Anchors */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-editorial text-xl font-medium text-[#1C1917]">
                  Identified Symbol Matrix & Personal Inquiries
                </h4>
                <span className="text-xs text-[#78716C]">Click any symbol to launch dialogue</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {dream.interpretation?.symbols?.map((sym: DreamSymbol, idx: number) => (
                  <div
                    key={idx}
                    className="p-5 bg-white border border-[#E0D9CD] rounded-xl space-y-3 hover:shadow-xs transition-all flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-editorial text-base font-semibold text-[#1C1917]">
                          {sym.symbol}
                        </span>
                        <button
                          onClick={() => handleTransitionToChat(sym.symbol)}
                          disabled={isClosing}
                          className="px-2.5 py-1 text-[11px] font-semibold text-[#1C1917] bg-[#F3EFEA] hover:bg-[#EAE4D9] border border-[#D5CEC2] rounded flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <MessageSquare className="w-3 h-3 text-[#B45309]" />
                          <span>Inquire</span>
                        </button>
                      </div>
                      <p className="text-xs text-[#44403C] font-body-serif leading-relaxed">
                        {sym.archetypalMeaning}
                      </p>
                    </div>

                    <div className="p-3 bg-[#FAF8F5] border border-[#EDE8E0] rounded-lg text-xs text-[#78716C] font-body-serif italic">
                      <span className="font-semibold text-[#1C1917] not-italic">Contemplative Question: </span>
                      {sym.personalReflectionPrompt}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Individuation Guidance / Active Imagination Action */}
            <div className="p-6 bg-[#F4EFEA] border-2 border-[#DFD8CC] rounded-xl space-y-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-[#14532D]">
                <BookOpen className="w-4 h-4 text-[#14532D]" />
                <span>Individuation Work & Active Imagination Practice</span>
              </div>
              <p className="text-sm font-body-serif text-[#292524] leading-relaxed">
                {dream.interpretation?.individuationGuidance}
              </p>
              <div className="pt-2">
                <button
                  onClick={() => handleTransitionToChat('How do I perform Active Imagination for this dream?')}
                  disabled={isClosing}
                  className="inline-flex items-center gap-2 text-xs font-semibold text-[#1C1917] hover:text-[#B45309] transition-colors disabled:opacity-50"
                >
                  <span>Begin guided active imagination dialogue with the analyst</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </section>}
        </div>

        {/* Footer Ribbon with Explicit Close Return Button */}
        <div className="px-6 sm:px-8 py-4 border-t border-[#E7E2DA] bg-[#F6F2EC] flex flex-wrap items-center justify-between gap-4 text-xs text-[#78716C]">
          <div className="flex items-center gap-3">
            <span>Oneiros Psychoanalytic Archives</span>
            <span aria-hidden="true">·</span>
            <span className="hidden sm:inline">Press ESC or click backdrop to awaken</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleAnimateClose}
              disabled={isClosing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#1C1917] hover:bg-[#EAE4D9] rounded-md transition-colors border border-[#D5CEC2] cursor-pointer"
            >
              <CornerDownLeft className="w-3.5 h-3.5" />
              <span>Return to Archive</span>
            </button>

            <button
              onClick={() => handleTransitionToChat()}
              disabled={isClosing}
              className="flex items-center gap-2 font-semibold text-[#1C1917] hover:underline disabled:opacity-50"
            >
              <span>Open Symbol Dialogue</span>
              <MessageSquare className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Full-Screen Zoom Modal */}
      {isImageZoomed && (
        <div
          className="fixed inset-0 z-60 bg-black/95 flex items-center justify-center p-4 cursor-zoom-out animate-dream-in"
          onClick={() => setIsImageZoomed(false)}
        >
          {/* Prominent Zoom Close Button */}
          <button
            onClick={() => setIsImageZoomed(false)}
            className="absolute top-6 right-6 flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/40 text-white rounded-lg transition-all text-xs font-semibold uppercase tracking-wider backdrop-blur-md border border-white/20 shadow-lg cursor-pointer"
            aria-label="Close zoom"
          >
            <X className="w-4 h-4" />
            <span>Close View</span>
            <kbd className="text-[10px] bg-black/40 px-1.5 py-0.5 rounded font-mono">ESC</kbd>
          </button>
          <img
            src={dream.imageUrl}
            alt={dream.title}
            className="max-w-[95vw] max-h-[92vh] object-contain rounded-md shadow-2xl"
          />
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/90 text-xs font-mono bg-black/70 px-4 py-2 rounded-full backdrop-blur-md border border-white/10">
            {dream.title} · {resolutionLabel(dream.resolution)} Surrealist Artwork
          </div>
        </div>
      )}
    </div>
  );
};
