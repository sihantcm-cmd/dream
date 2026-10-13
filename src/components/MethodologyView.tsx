import React from 'react';
import { Palette, Sparkles, Brain, Cpu, Sliders } from 'lucide-react';

export const MethodologyView: React.FC = () => {
  return (
    <div className="space-y-12 max-w-5xl mx-auto py-4">
      {/* Header */}
      <div className="border-b border-[#E7E2DA] pb-8 space-y-3">
        <div className="text-xs uppercase tracking-widest text-[#78716C] font-cinzel">
          Curatorial Architecture
        </div>
        <h2 className="font-editorial text-3xl sm:text-5xl font-semibold text-[#1C1917]">
          The Oneiros Method
        </h2>
        <p className="text-sm font-body-serif text-[#57534E] max-w-3xl leading-relaxed">
          Bridging unconscious morning memories with classical psychoanalytic depth and museum-grade surrealist visual synthesis.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Card 1: Surrealism & Visual Language */}
        <div className="p-8 bg-white border border-[#E7E2DA] rounded-xl space-y-4 shadow-xs">
          <div className="w-10 h-10 rounded-full bg-[#F3EFEA] flex items-center justify-center text-[#B45309]">
            <Palette className="w-5 h-5" />
          </div>
          <h3 className="font-editorial text-xl font-semibold text-[#1C1917]">
            Dalí & Magritte Classical Surrealism
          </h3>
          <p className="text-xs text-[#57534E] font-body-serif leading-relaxed">
            Unlike chaotic abstract distortions, classical surrealism relies on hyper-precise academic oil painting technique to render impossible, dreamlike scenes with uncanny realism.
            Metaphysical horizons, silent deserts, impossible floating doorframes, melting brass instruments, and daytime skies framing nighttime moons reveal the union of opposites (*coincidentia oppositorum*).
          </p>
          <div className="pt-2 text-[11px] text-[#78716C] font-mono border-t border-[#F0EBE3]">
            Artwork sizes follow the configured image model; choose a square, classical, or horizon composition.
          </div>
        </div>

        {/* Card 2: Voice Capture & Hypnopompic Preservation */}
        <div className="p-8 bg-white border border-[#E7E2DA] rounded-xl space-y-4 shadow-xs">
          <div className="w-10 h-10 rounded-full bg-[#F3EFEA] flex items-center justify-center text-[#1E3A8A]">
            <Sparkles className="w-5 h-5" />
          </div>
          <h3 className="font-editorial text-xl font-semibold text-[#1C1917]">
            Hypnopompic Voice Capture
          </h3>
          <p className="text-xs text-[#57534E] font-body-serif leading-relaxed">
            Dream recall degrades rapidly within five minutes of awakening as the analytical waking ego takes control of neural pathways.
            Our bedside one-tap voice recorder captures spoken descriptions immediately before hypnopompic fading, preserving raw affective tone, emotional nuances, and fragile sensory fragments.
          </p>
          <div className="pt-2 text-[11px] text-[#78716C] font-mono border-t border-[#F0EBE3]">
            Recordings are transcribed verbatim; the original audio stays with your local journal.
          </div>
        </div>

        {/* Card 3: Analytical Depth Psychology */}
        <div className="p-8 bg-white border border-[#E7E2DA] rounded-xl space-y-4 shadow-xs">
          <div className="w-10 h-10 rounded-full bg-[#F3EFEA] flex items-center justify-center text-[#14532D]">
            <Brain className="w-5 h-5" />
          </div>
          <h3 className="font-editorial text-xl font-semibold text-[#1C1917]">
            Jungian Archetypal Matrix
          </h3>
          <p className="text-xs text-[#57534E] font-body-serif leading-relaxed">
            Carl Jung identified dreams not merely as disguised wish fulfillments, but as natural, autonomous compensatory messages from the unconscious.
            Oneiros dissects each narrative to identify archetypal presences—The Shadow, Anima/Animus, The Persona, The Threshold Guardian, and The Self—formulating reflective questions for waking life integration.
          </p>
          <div className="pt-2 text-[11px] text-[#78716C] font-mono border-t border-[#F0EBE3]">
            Structured JSON schemas ensure rigorous psychoanalytic categorization.
          </div>
        </div>

        {/* Card 4: Multi-Turn Symbol Dialogue Agent */}
        <div className="p-8 bg-white border border-[#E7E2DA] rounded-xl space-y-4 shadow-xs">
          <div className="w-10 h-10 rounded-full bg-[#F3EFEA] flex items-center justify-center text-[#78350F]">
            <Cpu className="w-5 h-5" />
          </div>
          <h3 className="font-editorial text-xl font-semibold text-[#1C1917]">
            Contextual Symbol Chatbot
          </h3>
          <p className="text-xs text-[#57534E] font-body-serif leading-relaxed">
            A specialized multi-turn conversational partner acting as a Jungian psychoanalyst and depth cartographer.
            The agent maintains conversation history, references specific dream transcripts, and adapts to user performance requirements via selectable model profiles.
          </p>
          <div className="pt-2 text-[11px] text-[#78716C] font-mono border-t border-[#F0EBE3]">
            Available dialogue models are loaded from your configured text service.
          </div>
        </div>
      </div>
    </div>
  );
};
