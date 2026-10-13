import React from 'react';
import { Compass, Moon, Sparkles } from 'lucide-react';

export type NavTab = 'cover' | 'catalog' | 'archetypes' | 'active-imagination' | 'methodology';

interface HeaderProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  onOpenRecordModal: () => void;
  dreamCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onOpenRecordModal,
  dreamCount,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-[#FAF8F5]/90 backdrop-blur-md border-b border-[#E7E2DA] transition-colors">
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between gap-8">
        {/* Zone 1: Brand Wordmark (Single text element in high-contrast editorial serif) */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setActiveTab('cover')}
            className="flex items-center gap-2.5 text-left group focus:outline-none cursor-pointer"
            title="Return to Cover Monograph"
          >
            <span className="w-8 h-8 rounded-full bg-[#1C1917] text-[#FAF8F5] flex items-center justify-center font-cinzel text-sm font-semibold tracking-wider transition-transform group-hover:scale-105">
              Ω
            </span>
            <span className="font-editorial text-2xl font-semibold tracking-tight text-[#1C1917] whitespace-nowrap">
              Oneiros
            </span>
          </button>
        </div>

        {/* Zone 2: Navigation Links (Clean single-line text links with subtle hover underlines) */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#57534E]">
          <button
            onClick={() => setActiveTab('cover')}
            className={`whitespace-nowrap pb-0.5 border-b-2 transition-all cursor-pointer ${
              activeTab === 'cover'
                ? 'border-[#1C1917] text-[#1C1917] font-semibold'
                : 'border-transparent hover:text-[#1C1917]'
            }`}
          >
            Cover Monograph
          </button>
          <button
            onClick={() => setActiveTab('catalog')}
            className={`whitespace-nowrap pb-0.5 border-b-2 transition-all cursor-pointer ${
              activeTab === 'catalog'
                ? 'border-[#1C1917] text-[#1C1917] font-semibold'
                : 'border-transparent hover:text-[#1C1917]'
            }`}
          >
            Dream Archive <span className="text-xs text-[#78716C] ml-1">({dreamCount})</span>
          </button>
          <button
            onClick={() => setActiveTab('archetypes')}
            className={`whitespace-nowrap pb-0.5 border-b-2 transition-all cursor-pointer ${
              activeTab === 'archetypes'
                ? 'border-[#1C1917] text-[#1C1917] font-semibold'
                : 'border-transparent hover:text-[#1C1917]'
            }`}
          >
            Archetype Codex
          </button>
          <button
            onClick={() => setActiveTab('active-imagination')}
            className={`whitespace-nowrap pb-0.5 border-b-2 transition-all cursor-pointer ${
              activeTab === 'active-imagination'
                ? 'border-[#1C1917] text-[#1C1917] font-semibold'
                : 'border-transparent hover:text-[#1C1917]'
            }`}
          >
            Active Imagination
          </button>
          <button
            onClick={() => setActiveTab('methodology')}
            className={`whitespace-nowrap pb-0.5 border-b-2 transition-all ${
              activeTab === 'methodology'
                ? 'border-[#1C1917] text-[#1C1917] font-semibold'
                : 'border-transparent hover:text-[#1C1917]'
            }`}
          >
            Curatorial Method
          </button>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={onOpenRecordModal}
            className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold tracking-wide uppercase text-[#FAF8F5] bg-[#1C1917] hover:bg-[#2E2A27] active:scale-[0.98] transition-all rounded-md shadow-xs whitespace-nowrap cursor-pointer"
          >
            <Moon className="w-3.5 h-3.5 text-[#D6CEBE]" />
            <span>Record Morning Dream</span>
          </button>
        </div>
      </div>
    </header>
  );
};
