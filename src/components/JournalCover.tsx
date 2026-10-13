import React from 'react';
import {
  Moon,
  Sparkles,
  ArrowRight,
  Compass,
  Volume2,
  BookOpen,
  Maximize2,
  Layers,
} from 'lucide-react';
import { DreamEntry } from '../types';
import { resolutionLabel } from '../services/imageOptions';
import coverImage from '../assets/images/dream_journal_cover_1791909647210.jpg';

interface JournalCoverProps {
  onEnterArchive: () => void;
  onOpenRecord: () => void;
  featuredDream?: DreamEntry;
  onSelectFeatured: (dream: DreamEntry) => void;
  totalDreams: number;
}

export const JournalCover: React.FC<JournalCoverProps> = ({
  onEnterArchive,
  onOpenRecord,
  featuredDream,
  onSelectFeatured,
  totalDreams,
}) => {
  const coverImagePath = coverImage;

  return (
    <div className="space-y-12 animate-dream-in">
      {/* SECTION 1: MUSEUM OIL PAINTING COVER SHOWCASE */}
      <div className="relative rounded-2xl overflow-hidden border border-[#D5CEC2] shadow-2xl bg-[#161514] min-h-[580px] sm:min-h-[640px] flex flex-col justify-between">
        {/* Background Oil Painting */}
        <div className="absolute inset-0 z-0">
          <img
            src={coverImagePath}
            alt="Oneiros Surrealist Oil Painting Cover"
            className="w-full h-full object-cover object-center filter brightness-[0.92] contrast-[1.04]"
          />
          {/* Measured curatorial vignette scrim for contrast without obscuring painting */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/30 backdrop-blur-[0.5px]" />
          <div className="absolute inset-0 bg-radial from-transparent via-transparent to-black/60" />
        </div>

        {/* Top Curatorial Bar */}
        <div className="relative z-10 p-6 sm:p-10 flex items-center justify-between text-[#FAF8F5]">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center font-cinzel text-xs font-semibold">
              Ω
            </span>
            <div className="text-[11px] uppercase tracking-widest font-cinzel text-white/80">
              Oneiros Psychoanalytic Archive · Vol. I
            </div>
          </div>

          <div className="text-right text-[11px] font-mono text-white/70">
            <span>Autumn 2026 Edition</span>
            <span className="hidden sm:inline" aria-hidden="true"> · </span>
            <span className="hidden sm:inline">Dalí & Magritte Lineage</span>
          </div>
        </div>

        {/* Center / Bottom Monograph Title & Entrance Callouts */}
        <div className="relative z-10 p-6 sm:p-12 max-w-4xl space-y-6 text-[#FAF8F5]">
          <div className="space-y-3">
            <div className="inline-block text-xs uppercase tracking-[0.25em] font-cinzel text-[#E5D7B7] drop-shadow-sm">
              The Unconscious in Oil & Archetype
            </div>
            <h1 className="font-editorial text-4xl sm:text-6xl md:text-7xl font-semibold tracking-tight text-white leading-[1.08] drop-shadow-md">
              Oneiros <span className="font-normal italic text-[#F3EFEA]">· 梦境志</span>
            </h1>
            <p className="font-body-serif text-base sm:text-lg text-white/90 max-w-2xl leading-relaxed drop-shadow-xs">
              晨起即录，梦影成画。在意识与混沌的边缘，以超现实主义油画定格潜意识，用荣格原型剖析梦之隐喻。
            </p>
          </div>

          {/* Epigraph / Quote */}
          <div className="pt-2 border-t border-white/20 max-w-xl text-xs sm:text-sm font-body-serif italic text-white/80 flex items-center gap-2">
            <span>“Who looks outside, dreams; who looks inside, awakes.”</span>
            <span className="not-italic text-[11px] font-mono text-white/60">— C.G. Jung</span>
          </div>

          {/* Entrance CTAs (入口操作) */}
          <div className="pt-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
            <button
              onClick={onEnterArchive}
              className="px-7 py-3.5 bg-[#FAF8F5] hover:bg-white text-[#1C1917] font-semibold text-xs uppercase tracking-wider rounded-lg shadow-xl hover:shadow-2xl flex items-center justify-center gap-3 transition-all duration-200 active:scale-[0.98] cursor-pointer group"
            >
              <span>开启潜意识画廊 · Enter Archive</span>
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </button>

            <button
              onClick={onOpenRecord}
              className="px-6 py-3.5 bg-black/45 hover:bg-black/65 text-[#FAF8F5] border border-white/30 hover:border-white/60 font-semibold text-xs uppercase tracking-wider rounded-lg backdrop-blur-md flex items-center justify-center gap-2.5 transition-all duration-200 active:scale-[0.98] cursor-pointer"
            >
              <Moon className="w-4 h-4 text-[#E5D7B7]" />
              <span>记录晨起梦境 · Wake Record</span>
            </button>
          </div>
        </div>

        {/* Bottom Metadata Ribbon on Cover (Strict zero-pill) */}
        <div className="relative z-10 px-6 sm:px-12 py-4 bg-black/60 backdrop-blur-md border-t border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs font-mono text-white/75">
          <div className="flex items-center gap-2">
            <span>Painting: Celestial Threshold & The Liquid Chronos</span>
            <span aria-hidden="true">·</span>
            <span>Oil on Gessoed Linen</span>
          </div>
          <div className="flex items-center gap-4">
            <span>Square · Classical · Horizon</span>
            <span aria-hidden="true">·</span>
            <span>{totalDreams} Dreams Preserved</span>
          </div>
        </div>
      </div>

      {/* SECTION 2: CURATORIAL ENTRANCE DECK (三条探索途径) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
        {/* Route 1: Voice Hypnopompic Station */}
        <div
          onClick={onOpenRecord}
          className="p-8 bg-white border border-[#E7E2DA] hover:border-[#1C1917] rounded-xl space-y-4 transition-all duration-200 shadow-xs hover:shadow-md cursor-pointer group"
        >
          <div className="w-10 h-10 rounded-full bg-[#F3EFEA] flex items-center justify-center text-[#1C1917] group-hover:scale-105 transition-transform">
            <Volume2 className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wider font-cinzel text-[#78716C]">
              01. Hypnopompic Station
            </div>
            <h3 className="font-editorial text-xl font-semibold text-[#1C1917]">
              晨起即录 · 留住残梦
            </h3>
          </div>
          <p className="text-xs text-[#57534E] font-body-serif leading-relaxed">
            醒来即录，捕捉未经意识滤镜修改的原始梦境片段。实时音频声波可视化，并将录音逐字转写为文字。
          </p>
          <div className="pt-2 text-xs font-semibold text-[#1C1917] flex items-center gap-1 group-hover:text-[#B45309] transition-colors">
            <span>立即唤醒录音</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Route 2: Surrealist Oil Artistry */}
        <div
          onClick={onEnterArchive}
          className="p-8 bg-white border border-[#E7E2DA] hover:border-[#1C1917] rounded-xl space-y-4 transition-all duration-200 shadow-xs hover:shadow-md cursor-pointer group"
        >
          <div className="w-10 h-10 rounded-full bg-[#F3EFEA] flex items-center justify-center text-[#B45309] group-hover:scale-105 transition-transform">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wider font-cinzel text-[#78716C]">
              02. Surrealist Synthesis
            </div>
            <h3 className="font-editorial text-xl font-semibold text-[#1C1917]">
              达利与马格利特 · 油画具象化
            </h3>
          </div>
          <p className="text-xs text-[#57534E] font-body-serif leading-relaxed">
            提取梦境核心情感张力，以经典超现实主义油画技法（玄秘地平线、悬浮重力、物象并置）生成梦境画作，支持方形、古典与横幅构图。
          </p>
          <div className="pt-2 text-xs font-semibold text-[#1C1917] flex items-center gap-1 group-hover:text-[#B45309] transition-colors">
            <span>浏览梦境油画典藏</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Route 3: Jungian Depth Inquiry */}
        <div
          onClick={onEnterArchive}
          className="p-8 bg-white border border-[#E7E2DA] hover:border-[#1C1917] rounded-xl space-y-4 transition-all duration-200 shadow-xs hover:shadow-md cursor-pointer group"
        >
          <div className="w-10 h-10 rounded-full bg-[#F3EFEA] flex items-center justify-center text-[#1E3A8A] group-hover:scale-105 transition-transform">
            <Compass className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wider font-cinzel text-[#78716C]">
              03. Archetype Dialogue
            </div>
            <h3 className="font-editorial text-xl font-semibold text-[#1C1917]">
              荣格深度心理学 · 意象对话
            </h3>
          </div>
          <p className="text-xs text-[#57534E] font-body-serif leading-relaxed">
            解析阴影（Shadow）、阿尼玛（Anima）、自性（Self）与门槛守护者。提供多轮深度意象对话智能体与积极想象实践。
          </p>
          <div className="pt-2 text-xs font-semibold text-[#1C1917] flex items-center gap-1 group-hover:text-[#B45309] transition-colors">
            <span>查阅原型图鉴与问答</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>

      {/* SECTION 3: FEATURED CURATED DREAM ENTRY (今日特展入口) */}
      {featuredDream && (
        <div className="p-8 bg-[#F6F2EC] border border-[#DDD6C8] rounded-2xl flex flex-col md:flex-row gap-8 items-center justify-between">
          <div className="space-y-3 max-w-xl">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest font-cinzel text-[#78716C]">
              <span>Featured Archival Entry</span>
              <span aria-hidden="true">·</span>
              <span>Accession № {featuredDream.id.slice(-6).toUpperCase()}</span>
            </div>
            <h3 className="font-editorial text-2xl sm:text-3xl font-semibold text-[#1C1917]">
              {featuredDream.title}
            </h3>
            <p className="text-xs font-body-serif text-[#57534E] leading-relaxed line-clamp-2">
              {featuredDream.interpretation?.coreTheme || featuredDream.transcript}
            </p>
            <div className="pt-2">
              <button
                onClick={() => onSelectFeatured(featuredDream)}
                className="px-5 py-2.5 bg-[#1C1917] hover:bg-[#2F2B28] text-[#FAF8F5] text-xs font-semibold uppercase tracking-wider rounded-md transition-all shadow-xs flex items-center gap-2 cursor-pointer active:scale-95"
              >
                <span>检视此篇特展梦境 · View Exhibition</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div
            onClick={() => onSelectFeatured(featuredDream)}
            className="w-full md:w-64 h-48 rounded-xl overflow-hidden shadow-md border border-[#D5CEC2] shrink-0 cursor-pointer group relative"
          >
            {featuredDream.imageUrl ? <img
              src={featuredDream.imageUrl}
              alt={featuredDream.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            /> : <div className="h-full bg-[#1C1917] text-[#D6CEBE] flex items-center justify-center font-body-serif">☾ &nbsp; Written Dream · 文字梦境</div>}
            <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] font-mono px-2 py-0.5 rounded backdrop-blur-xs">
              {featuredDream.imageUrl ? resolutionLabel(featuredDream.resolution) : featuredDream.status === 'draft' ? 'DRAFT' : '文字解读'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
