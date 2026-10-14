import React, { useState, useEffect, useRef } from 'react';
import {
  Moon,
  Sparkles,
  Search,
  Filter,
  Plus,
  Compass,
  ArrowRight,
  Sliders,
  Volume2,
  Settings,
  LogOut,
} from 'lucide-react';
import { DreamEntry, ChatMessage } from './types';
import { SEED_DREAMS } from './data/seedDreams';
import { Header, NavTab } from './components/Header';
import { JournalCover } from './components/JournalCover';
import { DreamCard } from './components/DreamCard';
import { DreamDetailModal } from './components/DreamDetailModal';
import { SymbolChatModal } from './components/SymbolChatModal';
import { WakeRecorderModal } from './components/WakeRecorderModal';
import { ArchetypeCodex } from './components/ArchetypeCodex';
import { ActiveImaginationGuide } from './components/ActiveImaginationGuide';
import { MethodologyView } from './components/MethodologyView';
import { bootstrapDreams, createDream, listDreams, updateDreamChatHistory, importDreams, updateDream, deleteDream, getHealth } from './services/api';
import type { BackendHealth } from './services/api';
import { ArchiveTools } from './components/ArchiveTools';
import { CloudGate, type CloudAccess } from './components/CloudGate';
import { CloudSettings } from './components/CloudSettings';

const STORAGE_KEY = 'oneiros_dreams_v1';

export default function App() {
  return <CloudGate>{(access) => <DreamApp {...access} />}</CloudGate>;
}

function DreamApp({ cloud, provider, email, signOut }: CloudAccess) {
  const [dreams, setDreams] = useState<DreamEntry[]>([]);
  const [isLoadingArchive, setIsLoadingArchive] = useState(true);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [archiveRevision, setArchiveRevision] = useState(0);
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const archiveMutation = useRef(0);

  // Navigation tab: defaults to 'cover' for museum entrance monograph
  const [activeTab, setActiveTab] = useState<NavTab>('cover');

  // Search and filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArchetype, setSelectedArchetype] = useState<string>('all');

  // Modal states
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [selectedDreamForDetail, setSelectedDreamForDetail] = useState<DreamEntry | null>(null);
  const [selectedDreamForChat, setSelectedDreamForChat] = useState<DreamEntry | null>(null);
  const [initialSymbolForChat, setInitialSymbolForChat] = useState<string | undefined>(undefined);
  const openRecorder = () => { if (!isLoadingArchive) setIsRecordModalOpen(true); };

  // Load the persistent archive and migrate any archive created by the earlier browser-only version.
  useEffect(() => {
    let isActive = true;

    const loadArchive = async () => {
      const mutationAtStart = archiveMutation.current;
      setIsLoadingArchive(true);
      try {
        let archive = await listDreams();
        if (!isActive) return;
        let legacy: string | null = null;
        try { if (!cloud) legacy = localStorage.getItem(STORAGE_KEY); } catch { /* Storage can be disabled. */ }
        if (legacy) {
          const parsed: unknown = JSON.parse(legacy);
          if (!Array.isArray(parsed)) throw new Error('The previous browser archive is invalid. It has been preserved for recovery.');
          const result = await importDreams(parsed as DreamEntry[]);
          archive = result.dreams;
          // Retain an original recovery copy, including any entries skipped by ID.
          try {
            localStorage.setItem(`${STORAGE_KEY}_backup`, legacy);
            localStorage.removeItem(STORAGE_KEY);
          } catch { /* Do not delete the source if its recovery copy could not be saved. */ }
        }
        if (!cloud && archive.length === 0) archive = await bootstrapDreams(SEED_DREAMS);

        if (isActive && mutationAtStart === archiveMutation.current) {
          setDreams(archive);
          setSelectedDreamForDetail((current) => current ? archive.find((entry) => entry.id === current.id) || null : null);
          setSelectedDreamForChat((current) => current ? archive.find((entry) => entry.id === current.id) || null : null);
          setBackendError(null);
        } else if (isActive) {
          // A save completed while this snapshot was in flight. Fetch its fresh
          // media URLs without replacing the newer local result with old data.
          setArchiveRevision((value) => value + 1);
          return;
        }
        const health = await getHealth();
        if (isActive) setHealth(health);
      } catch (error) {
        if (isActive) {
          setBackendError(error instanceof Error ? error.message : 'The dream archive could not be loaded.');
        }
      } finally {
        if (isActive) setIsLoadingArchive(false);
      }
    };

    void loadArchive();
    return () => { isActive = false; };
  }, [archiveRevision, cloud]);

  useEffect(() => {
    if (!cloud) return;
    // Private display URLs expire; refresh the archive when returning to this tab.
    const refresh = () => { if (document.visibilityState === 'visible') setArchiveRevision((value) => value + 1); };
    document.addEventListener('visibilitychange', refresh);
    const interval = window.setInterval(refresh, 50 * 60_000);
    return () => { document.removeEventListener('visibilitychange', refresh); window.clearInterval(interval); };
  }, [cloud]);

  const handleDreamUpdated = async (dream: DreamEntry) => {
    const saved = await updateDream(dream);
    archiveMutation.current += 1;
    setDreams((prev) => prev.map((entry) => entry.id === saved.id ? saved : entry));
    setSelectedDreamForDetail(saved);
    return saved;
  };

  const handleDreamDeleted = async (id: string) => {
    await deleteDream(id);
    archiveMutation.current += 1;
    setDreams((prev) => prev.filter((entry) => entry.id !== id));
    setSelectedDreamForDetail(null);
  };

  // Handle new dream creation
  const handleDreamCreated = async (newDream: DreamEntry) => {
    try {
      const savedDream = await createDream(newDream);
      archiveMutation.current += 1;
      setDreams((prev) => [savedDream, ...prev.filter((dream) => dream.id !== savedDream.id)]);
      setBackendError(null);
      // Allow WakeRecorderModal to evaporate cleanly before DreamDetailModal emerges
      setTimeout(() => {
        setSelectedDreamForDetail(savedDream);
      }, 390);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : 'Dream could not be saved.');
      throw error;
    }
  };

  // Handle updating chat history for a dream
  const handleUpdateChatHistory = async (dreamId: string, newHistory: ChatMessage[]) => {
    try {
      const savedDream = await updateDreamChatHistory(dreamId, newHistory);
      archiveMutation.current += 1;
      setDreams((prev) => prev.map((dream) => dream.id === dreamId ? savedDream : dream));
      if (selectedDreamForDetail?.id === dreamId) setSelectedDreamForDetail(savedDream);
      if (selectedDreamForChat?.id === dreamId) setSelectedDreamForChat(savedDream);
      setBackendError(null);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : 'Chat history could not be saved.');
      throw error;
    }
  };

  // Launch chat directly from card or symbol
  const handleOpenChat = (dream: DreamEntry, symbolQuery?: string) => {
    setSelectedDreamForChat(dream);
    setInitialSymbolForChat(symbolQuery);
  };

  // Filtered dreams
  const filteredDreams = dreams.filter((dream) => {
    const matchesSearch =
      dream.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dream.transcript.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dream.interpretation?.coreTheme?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dream.interpretation?.symbols?.some((s) =>
        s.symbol.toLowerCase().includes(searchQuery.toLowerCase())
      );

    if (selectedArchetype === 'all') return matchesSearch;

    const matchesArchetype = dream.interpretation?.archetypes?.some((a) =>
      a.name.toLowerCase().includes(selectedArchetype.toLowerCase())
    );

    return matchesSearch && matchesArchetype;
  });

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1C1917] flex flex-col font-sans-clean selection:bg-[#EBE5DC]">
      {/* 3-Zone Header Contract */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenRecordModal={openRecorder}
        dreamCount={dreams.length}
      />

      {cloud && <div className="max-w-7xl w-full mx-auto px-6 pt-4 flex flex-wrap items-center justify-end gap-4 text-xs text-[#78716C]">
        <span className="mr-auto truncate max-w-[60vw]">私人云端档案 · {email}</span>
        <button onClick={() => setSettingsOpen(true)} className="inline-flex items-center gap-1.5 hover:text-[#1C1917]"><Settings size={14} />API 设置</button>
        <button disabled={loggingOut} onClick={async () => { setLoggingOut(true); try { await signOut(); } catch (error) { setBackendError(error instanceof Error ? error.message : '退出失败，请重试。'); setLoggingOut(false); } }} className="inline-flex items-center gap-1.5 hover:text-[#1C1917] disabled:opacity-40"><LogOut size={14} />{loggingOut ? '正在退出…' : '退出'}</button>
      </div>}

      {(backendError || isLoadingArchive) && (
        <div className={`mx-auto mt-4 w-full max-w-7xl px-6 text-xs ${backendError ? 'text-red-800' : 'text-[#78716C]'}`} role={backendError ? 'alert' : 'status'}>
          {backendError || 'Opening the saved dream archive…'}
          {backendError && <button className="ml-3 underline" onClick={() => setArchiveRevision((value) => value + 1)}>Retry / 重试</button>}
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        {health && !health.aiConfigured && <div role="status" className="mb-5 rounded-lg border border-[#DDD6C8] bg-[#F4EFEA] px-4 py-3 text-xs text-[#57534E]">{cloud ? '私人云端' : '本机'}档案已连接。解读与对话{health.capabilities.interpret ? '已配置' : '待配置'}，转写与绘图{health.capabilities.transcribe && health.capabilities.image ? '已配置' : '待配置'}。文字与录音均可直接保存。{cloud && <button onClick={() => setSettingsOpen(true)} className="ml-3 underline">配置 API 密钥</button>}</div>}
        <ArchiveTools disabled={isLoadingArchive} onImported={(archive) => { archiveMutation.current += 1; setDreams(archive); setBackendError(null); }} />
        {/* TAB 0: MONOGRAPH COVER & ENTRANCE */}
        {activeTab === 'cover' && (
          <JournalCover
            onEnterArchive={() => setActiveTab('catalog')}
            onOpenRecord={openRecorder}
            featuredDream={dreams[0]}
            onSelectFeatured={(d) => setSelectedDreamForDetail(d)}
            totalDreams={dreams.length}
          />
        )}

        {/* TAB 1: CATALOG VIEW */}
        {activeTab === 'catalog' && (
          <div className="space-y-10">
            {/* Curatorial Hero Marquee */}
            <section className="border-b border-[#E7E2DA] pb-10 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-widest text-[#78716C] font-cinzel">
                  Hypnopompic Journal & Psychoanalytic Gallery
                </div>
                <button
                  onClick={() => setActiveTab('cover')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#78716C] hover:text-[#1C1917] transition-colors cursor-pointer self-start sm:self-auto"
                >
                  <span>← Cover Monograph · 封面入口</span>
                </button>
              </div>

              <div className="max-w-3xl space-y-3">
                <h1 className="font-editorial text-4xl sm:text-6xl font-semibold text-[#1C1917] tracking-tight leading-[1.15]">
                  The Unconscious, Commissioned in Oil & Archetype.
                </h1>
                <p className="font-body-serif text-base text-[#57534E] leading-relaxed max-w-2xl">
                  Capture fleeting morning dreams before waking lucidity dissolves them.
                  Oneiros transcribes your voice, creates surrealist artwork in the lineage of Salvador Dalí and René Magritte, and explores your dream motifs through Carl Jung’s depth archetypes.
                </p>
              </div>

              {/* Operational Morning Action Strip */}
              <div className="p-5 bg-[#F4EFEA] border border-[#DDD6C8] rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#1C1917] text-[#FAF8F5] flex items-center justify-center shrink-0">
                    <Moon className="w-5 h-5 text-[#D6CEBE]" />
                  </div>
                  <div>
                    <div className="font-editorial text-base font-semibold text-[#1C1917]">
                      Bedside Wake Station
                    </div>
                    <div className="text-xs text-[#78716C]">
                      Speak immediately upon waking · Voice transcription
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                  <button
                    onClick={openRecorder}
                    className="w-full sm:w-auto px-5 py-2.5 bg-[#1C1917] hover:bg-[#2F2B28] text-[#FAF8F5] text-xs font-semibold uppercase tracking-wider rounded-md transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
                  >
                    <Plus className="w-4 h-4 text-[#D6CEBE]" />
                    <span>Record Morning Dream</span>
                  </button>
                </div>
              </div>

              {/* Search & Archetype Filter Controls */}
              <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between pt-2">
                {/* Search Bar */}
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-[#78716C] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by title, transcript, clock, mirror, shadow..."
                    className="w-full pl-10 pr-4 py-2 bg-white border border-[#DCD6CA] rounded-lg text-xs text-[#1C1917] placeholder:text-[#A8A29E] focus:outline-none focus:ring-2 focus:ring-[#1C1917] transition-all"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#78716C] hover:text-[#1C1917]"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Interactive Archetype Filter Tabs (Segmented controls) */}
                <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 text-xs font-medium">
                  <span className="text-[#78716C] text-xs mr-2 whitespace-nowrap">Filter Archetype:</span>
                  {[
                    { id: 'all', label: 'All Catalog' },
                    { id: 'shadow', label: 'The Shadow' },
                    { id: 'anima', label: 'Anima / Animus' },
                    { id: 'persona', label: 'The Persona' },
                    { id: 'self', label: 'The Self' },
                  ].map((filter) => (
                    <button
                      key={filter.id}
                      onClick={() => setSelectedArchetype(filter.id)}
                      className={`whitespace-nowrap px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                        selectedArchetype === filter.id
                          ? 'bg-[#1C1917] text-[#FAF8F5] shadow-xs'
                          : 'bg-white text-[#57534E] border border-[#E0D9CD] hover:border-[#1C1917]'
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Catalog Grid */}
            <section className="space-y-4">
              <div className="flex items-center justify-between text-xs text-[#78716C] font-mono">
                <span>
                  Showing {filteredDreams.length} {filteredDreams.length === 1 ? 'Exhibition' : 'Exhibitions'}
                </span>
                <span>Square · Classical · Horizon compositions</span>
              </div>

              {filteredDreams.length === 0 ? (
                <div className="p-16 border border-dashed border-[#DCD6CA] rounded-xl text-center space-y-4 bg-white/60">
                  <div className="w-12 h-12 mx-auto rounded-full bg-[#F3EFEA] flex items-center justify-center text-[#78716C]">
                    <Search className="w-6 h-6" />
                  </div>
                  <h3 className="font-editorial text-xl font-medium text-[#1C1917]">
                    No dreams match your inquiry
                  </h3>
                  <p className="text-xs text-[#57534E] max-w-sm mx-auto font-body-serif">
                    Try adjusting your search query or clear the archetype filter to inspect the full psychoanalytic collection.
                  </p>
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedArchetype('all');
                    }}
                    className="px-4 py-2 bg-[#1C1917] text-[#FAF8F5] rounded-md text-xs font-semibold"
                  >
                    Reset Filter
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {filteredDreams.map((dream) => (
                    <DreamCard
                      key={dream.id}
                      dream={dream}
                      onSelect={(d) => setSelectedDreamForDetail(d)}
                      onOpenChat={(d) => handleOpenChat(d)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 2: ARCHETYPE CODEX */}
        {activeTab === 'archetypes' && (
          <div className="space-y-6">
            <button
              onClick={() => setActiveTab('catalog')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#78716C] hover:text-[#1C1917] transition-colors cursor-pointer group"
            >
              <span className="transition-transform group-hover:-translate-x-1">←</span>
              <span>Return to Dream Archive</span>
            </button>
            <ArchetypeCodex
              dreams={dreams}
              onSelectDream={(d) => setSelectedDreamForDetail(d)}
            />
          </div>
        )}

        {/* TAB 3: ACTIVE IMAGINATION GUIDE */}
        {activeTab === 'active-imagination' && (
          <div className="space-y-6">
            <button
              onClick={() => setActiveTab('catalog')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#78716C] hover:text-[#1C1917] transition-colors cursor-pointer group"
            >
              <span className="transition-transform group-hover:-translate-x-1">←</span>
              <span>Return to Dream Archive</span>
            </button>
            <ActiveImaginationGuide
              dreams={dreams}
              onOpenChatWithDream={(d) => handleOpenChat(d)}
            />
          </div>
        )}

        {/* TAB 4: METHODOLOGY */}
        {activeTab === 'methodology' && (
          <div className="space-y-6">
            <button
              onClick={() => setActiveTab('catalog')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#78716C] hover:text-[#1C1917] transition-colors cursor-pointer group"
            >
              <span className="transition-transform group-hover:-translate-x-1">←</span>
              <span>Return to Dream Archive</span>
            </button>
            <MethodologyView />
          </div>
        )}
      </main>

      {/* Museum Editorial Footer */}
      <footer className="mt-auto border-t border-[#E7E2DA] bg-[#F7F4EE] text-xs text-[#78716C] py-8 transition-colors">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-cinzel font-semibold text-[#1C1917]">Oneiros Archive</span>
            <span aria-hidden="true">·</span>
            <span>Carl Jung Analytical Psychology & Dalí-Magritte Surrealism</span>
          </div>

          <div className="flex items-center gap-6 text-[11px] font-mono">
            <span>{health ? `${health.textProvider === 'deepseek' ? 'DeepSeek' : 'Gemini'} · ${health.mediaProvider === 'dashscope' ? '通义千问' : 'Gemini Media'}` : 'Dreams, symbols & imagination'}</span>
            <span aria-hidden="true">·</span>
            <span>{cloud ? `${provider === 'aliyun' ? '阿里云' : 'Vercel'} · Personal Cloud Archive` : 'Personal Local Archive'}</span>
          </div>
        </div>
      </footer>

      {/* MODALS */}
      {settingsOpen && <CloudSettings onClose={() => setSettingsOpen(false)} onSaved={() => setArchiveRevision((value) => value + 1)} />}
      {/* 1. Wake Recording Modal */}
      <WakeRecorderModal
        isOpen={isRecordModalOpen}
        onClose={() => setIsRecordModalOpen(false)}
        onDreamCreated={handleDreamCreated}
      />

      {/* 2. Dream Detail & Jungian Interpretation Modal */}
      {selectedDreamForDetail && (
        <DreamDetailModal
          isOpen={!!selectedDreamForDetail}
          onClose={() => setSelectedDreamForDetail(null)}
          dream={selectedDreamForDetail}
          onUpdate={handleDreamUpdated}
          onDelete={handleDreamDeleted}
          onOpenChat={(d, sym) => {
            handleOpenChat(d, sym);
          }}
        />
      )}

      {/* 3. Multi-Turn Symbol Chat Modal */}
      {selectedDreamForChat && (
        <SymbolChatModal
          isOpen={!!selectedDreamForChat}
          onClose={() => {
            setSelectedDreamForChat(null);
            setInitialSymbolForChat(undefined);
          }}
          dream={selectedDreamForChat}
          onUpdateChatHistory={handleUpdateChatHistory}
          initialSymbolQuery={initialSymbolForChat}
        />
      )}
    </div>
  );
}
