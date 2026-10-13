import React from 'react';
import { MessageSquare, Sparkles, Volume2, ArrowRight } from 'lucide-react';
import { DreamEntry } from '../types';

interface DreamCardProps {
  dream: DreamEntry;
  onSelect: (dream: DreamEntry) => void;
  onOpenChat: (dream: DreamEntry) => void;
}

export const DreamCard: React.FC<DreamCardProps> = ({
  dream,
  onSelect,
  onOpenChat,
}) => {
  const formattedDate = new Date(dream.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <article className="group bg-white border border-[#E7E2DA] hover:border-[#1C1917] rounded-xl overflow-hidden transition-all duration-200 flex flex-col justify-between shadow-xs hover:shadow-md">
      <div>
        {/* Surrealist Artwork Thumbnail Frame */}
        <div
          onClick={() => onSelect(dream)}
          className="relative aspect-4/3 bg-[#1C1917] overflow-hidden cursor-pointer"
        >
          <img
            src={dream.imageUrl}
            alt={dream.title}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500 ease-out"
          />

          {/* Clean Unboxed Overlay Metadata */}
          <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-xs text-[#FAF8F5] text-[10px] font-mono tracking-wider px-2 py-0.5 rounded border border-white/10">
            {dream.resolution}
          </div>

          {dream.audioDurationSeconds && (
            <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-xs text-[#FAF8F5] text-[10px] font-mono px-2 py-0.5 rounded border border-white/10 flex items-center gap-1">
              <Volume2 className="w-2.5 h-2.5" />
              <span>{dream.audioDurationSeconds}s</span>
            </div>
          )}
        </div>

        {/* Content Section */}
        <div className="p-6 space-y-3">
          {/* Metadata: Unboxed Text with Separators (Strict Zero-Pill Rule) */}
          <div className="flex items-center gap-2 text-xs text-[#78716C] font-mono">
            <span>{formattedDate}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate max-w-[150px]">{dream.interpretation?.dominantMood || 'Surreal'}</span>
          </div>

          <h3
            onClick={() => onSelect(dream)}
            className="font-editorial text-xl font-semibold text-[#1C1917] hover:text-[#B45309] transition-colors cursor-pointer leading-snug line-clamp-2"
          >
            {dream.title}
          </h3>

          <p className="text-xs text-[#57534E] font-body-serif leading-relaxed line-clamp-3">
            {dream.interpretation?.coreTheme || dream.transcript}
          </p>

          {/* Detected Archetype Unboxed Labels */}
          {dream.interpretation?.archetypes && (
            <div className="pt-2 text-xs text-[#78716C] flex flex-wrap items-center gap-x-2 gap-y-1 font-cinzel">
              <span className="text-[10px] uppercase text-[#A8A29E]">Archetypes:</span>
              {dream.interpretation.archetypes.slice(0, 2).map((a, i) => (
                <span key={i} className="text-[#1C1917] font-medium">
                  {a.name.split('(')[0].trim()}
                  {i < Math.min(dream.interpretation.archetypes.length, 2) - 1 && ' ·'}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Action Footer */}
      <div className="px-6 py-4 border-t border-[#F0EBE3] bg-[#FAF8F5] flex items-center justify-between text-xs">
        <button
          onClick={() => onOpenChat(dream)}
          className="flex items-center gap-1.5 text-[#57534E] hover:text-[#1C1917] font-medium transition-colors"
        >
          <MessageSquare className="w-3.5 h-3.5 text-[#B45309]" />
          <span>Symbol Chat ({dream.chatHistory?.length || 0})</span>
        </button>

        <button
          onClick={() => onSelect(dream)}
          className="flex items-center gap-1 font-semibold text-[#1C1917] hover:text-[#B45309] transition-colors cursor-pointer"
        >
          <span>Examine</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </article>
  );
};
