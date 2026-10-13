import React, { useState, useEffect } from 'react';
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

const STORAGE_KEY = 'oneiros_dreams_v1';

export default function App() {
  // Load dreams from localStorage or fallback to SEED_DREAMS
  const [dreams, setDreams] = useState<DreamEntry[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to parse saved dreams:', e);
    }
    return SEED_DREAMS;
  });

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

  // Save dreams to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dreams));
    } catch (e) {
      console.warn('Failed to save dreams to storage:', e);
    }
  }, [dreams]);

  // Handle new dream creation
  const handleDreamCreated = (newDream: DreamEntry) => {
    setDreams((prev) => [newDream, ...prev]);
    // Allow WakeRecorderModal to evaporate cleanly before DreamDetailModal emerges
    setTimeout(() => {
      setSelectedDreamForDetail(newDream);
    }, 390);
  };

  // Handle updating chat history for a dream
  const handleUpdateChatHistory = (dreamId: string, newHistory: ChatMessage[]) => {
    setDreams((prev) =>
      prev.map((d) => (d.id === dreamId ? { ...d, chatHistory: newHistory } : d))
    );
    if (selectedDreamForDetail?.id === dreamId) {
      setSelectedDreamForDetail((prev) => (prev ? { ...prev, chatHistory: newHistory } : null));
    }
    if (selectedDreamForChat?.id === dreamId) {
      setSelectedDreamForChat((prev) => (prev ? { ...prev, chatHistory: newHistory } : null));
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
        onOpenRecordModal={() => setIsRecordModalOpen(true)}
        dreamCount={dreams.length}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        {/* TAB 0: MONOGRAPH COVER & ENTRANCE */}
        {activeTab === 'cover' && (
          <JournalCover
            onEnterArchive={() => setActiveTab('catalog')}
            onOpenRecord={() => setIsRecordModalOpen(true)}
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
                  Oneiros transcribes your voice, synthesizes high-resolution surrealist artwork (1K, 2K, 4K) in the lineage of Salvador Dalí and René Magritte, and structures your unconscious motifs through Carl Jung’s depth archetypes.
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
                      Speak immediately upon waking · Instant Gemini verbatim transcription
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                  <button
                    onClick={() => setIsRecordModalOpen(true)}
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
                <span>Resolution affordances: 1K · 2K · 4K</span>
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
            <span>Powered by Gemini 3.5 & Gemini 3 Pro</span>
            <span aria-hidden="true">·</span>
            <span>Local Secure Session</span>
          </div>
        </div>
      </footer>

      {/* MODALS */}
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
