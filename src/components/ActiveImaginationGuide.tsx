import React from 'react';
import { Compass, Sparkles, MessageSquare, Feather, Eye } from 'lucide-react';
import { DreamEntry } from '../types';

interface ActiveImaginationGuideProps {
  dreams: DreamEntry[];
  onOpenChatWithDream: (dream: DreamEntry) => void;
}

export const ActiveImaginationGuide: React.FC<ActiveImaginationGuideProps> = ({
  dreams,
  onOpenChatWithDream,
}) => {
  const steps = [
    {
      num: '01',
      title: 'Hypnopompic Descent & Stillness',
      description:
        'Sit in a quiet space without sensory distractions. Close your eyes and allow your waking ego’s analytical defenses to loosen. Bring a specific dream scene, unresolved threshold, or lingering figure into your mind’s eye without forcing a narrative.',
      icon: Eye,
    },
    {
      num: '02',
      title: 'Autonomous Animation of the Symbol',
      description:
        'Do not direct the dream character or symbol. Allow it to move, alter its form, or speak under its own autonomy. Carl Jung emphasized that true active imagination occurs only when the unconscious entity acts independently of the ego’s conscious will.',
      icon: Sparkles,
    },
    {
      num: '03',
      title: 'Direct Ethical Dialogue',
      description:
        'Speak directly to the figure. Ask: "Who are you? Why have you entered my dream? What do you require of me in waking life?" Treat the figure as an authentic psychic reality with valid desires and warnings.',
      icon: MessageSquare,
    },
    {
      num: '04',
      title: 'Ethical Confrontation & Concordance',
      description:
        'Do not blindly obey malevolent commands, nor dismiss paradoxical advice. Engage in reasoned psychological negotiation with the archetype, reaching an agreement on how its energy can be expressed creatively and morally in your waking hours.',
      icon: Compass,
    },
    {
      num: '05',
      title: 'Physical Integration & Ritual Act',
      description:
        'Seal the conversation in the physical world. Jung recorded his visions in the Red Book via calligraphy and painting. You can record the dialogue in Oneiros, paint the symbol, or make a concrete behavioral adjustment in your waking life.',
      icon: Feather,
    },
  ];

  return (
    <div className="space-y-12 max-w-5xl mx-auto py-4">
      {/* Header */}
      <div className="border-b border-[#E7E2DA] pb-8 space-y-3">
        <div className="text-xs uppercase tracking-widest text-[#78716C] font-cinzel">
          The Technique of Carl Gustav Jung
        </div>
        <h2 className="font-editorial text-3xl sm:text-5xl font-semibold text-[#1C1917]">
          The Art of Active Imagination
        </h2>
        <p className="text-sm font-body-serif text-[#57534E] max-w-3xl leading-relaxed">
          Active Imagination is a profound psychological method developed by Carl Jung to bridge the conscious ego and the autonomous unconscious.
          Rather than merely analyzing a dream post-facto, you re-enter the dream atmosphere while awake and engage its figures in living conversation.
        </p>
      </div>

      {/* Steps Matrix */}
      <section className="space-y-6">
        <h3 className="font-editorial text-2xl font-medium text-[#1C1917]">
          The Fivefold Process of Engagement
        </h3>

        <div className="space-y-6">
          {steps.map((st, i) => {
            const Icon = st.icon;
            return (
              <div
                key={i}
                className="p-8 bg-white border border-[#E7E2DA] rounded-xl flex flex-col md:flex-row gap-6 items-start hover:border-[#1C1917] transition-all shadow-xs"
              >
                <div className="flex items-center gap-4 shrink-0">
                  <div className="font-mono text-2xl font-bold text-[#B45309] w-12">
                    {st.num}
                  </div>
                  <div className="w-10 h-10 rounded-full bg-[#F3EFEA] flex items-center justify-center text-[#1C1917]">
                    <Icon className="w-5 h-5" />
                  </div>
                </div>

                <div className="space-y-2 flex-1">
                  <h4 className="font-editorial text-lg font-semibold text-[#1C1917]">
                    {st.title}
                  </h4>
                  <p className="text-sm font-body-serif text-[#57534E] leading-relaxed">
                    {st.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Interactive Launch Section */}
      {dreams.length > 0 && (
        <section className="p-8 bg-[#F5F1EB] border border-[#DDD6C8] rounded-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-editorial text-xl font-semibold text-[#1C1917]">
              Practice Active Imagination with Recorded Dreams
            </h3>
            <span className="text-xs text-[#78716C]">Choose a dream to initiate dialogue</span>
          </div>
          <p className="text-xs font-body-serif text-[#57534E] leading-relaxed">
            Select one of your saved dreams to open a multi-turn session with our Jungian symbol analyst.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {dreams.slice(0, 4).map((d) => (
              <button
                key={d.id}
                onClick={() => onOpenChatWithDream(d)}
                className="p-4 bg-white border border-[#E0D9CD] hover:border-[#1C1917] rounded-lg text-left transition-all flex items-center justify-between group cursor-pointer"
              >
                <div className="truncate mr-3">
                  <div className="font-editorial text-sm font-medium text-[#1C1917] group-hover:text-[#B45309] truncate">
                    {d.title}
                  </div>
                  <div className="text-[11px] text-[#78716C] font-mono mt-0.5">
                    {d.interpretation?.dominantMood || 'Reflective'}
                  </div>
                </div>
                <span className="text-xs text-[#1C1917] font-semibold shrink-0">Open →</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
