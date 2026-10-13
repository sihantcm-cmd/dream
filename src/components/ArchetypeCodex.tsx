import React from 'react';
import { DreamEntry } from '../types';
import { Compass, BookOpen, Layers } from 'lucide-react';

interface ArchetypeCodexProps {
  dreams: DreamEntry[];
  onSelectDream: (dream: DreamEntry) => void;
}

export const ArchetypeCodex: React.FC<ArchetypeCodexProps> = ({ dreams, onSelectDream }) => {
  // Aggregate archetypes from dreams
  const archetypesMap = new Map<string, { count: number; descriptions: string[]; dreams: DreamEntry[] }>();

  dreams.forEach((d) => {
    d.interpretation?.archetypes?.forEach((a) => {
      const cleanName = a.name.split('(')[0].trim();
      if (!archetypesMap.has(cleanName)) {
        archetypesMap.set(cleanName, { count: 0, descriptions: [], dreams: [] });
      }
      const item = archetypesMap.get(cleanName)!;
      item.count += 1;
      if (!item.descriptions.includes(a.description)) {
        item.descriptions.push(a.description);
      }
      if (!item.dreams.some((dr) => dr.id === d.id)) {
        item.dreams.push(d);
      }
    });
  });

  const standardArchetypes = [
    {
      name: 'The Shadow',
      definition:
        'The hidden or repressed aspects of the psyche that the conscious ego does not recognize or refuses to acknowledge. Often appears as antagonistic figures, menacing strangers, or animal companions in darkness.',
      mythicParallel: 'The underworld journey of Gilgamesh, Hades, Mr. Hyde.',
      individuationRole: 'Integration is the primary threshold for self-knowledge and moral wholeness.',
    },
    {
      name: 'The Anima & Animus',
      definition:
        'The contra-sexual soul-image mediating between ego and the deeper unconscious. The Anima (inner feminine in a masculine psyche) brings emotional depth, relatedness, and poetic intuition; the Animus (inner masculine) brings focused discernment, structure, and assertive logos.',
      mythicParallel: 'Beatrice in Dante’s Divine Comedy, Ariadne leading the labyrinth.',
      individuationRole: 'Unlocks creative inspiration and transpersonal spiritual connection.',
    },
    {
      name: 'The Persona',
      definition:
        'The social mask constructed to interact with the external world and conform to cultural expectations. Appears in dreams as tailored suits, masks, bowler hats, uniforms, or fragile armor.',
      mythicParallel: 'The theatrical masks of Greek tragedy.',
      individuationRole: 'Requires differentiation so the ego does not falsely identify with the social mask.',
    },
    {
      name: 'The Self',
      definition:
        'The archetype of psychic wholeness, balance, and the unifying center of the conscious and unconscious. Appears as cosmic portals, luminous spheres, mandalas, radiant trees, or divine kings.',
      mythicParallel: 'The philosopher’s stone in alchemy, the central sun.',
      individuationRole: 'The ultimate teleological goal of the individuation journey.',
    },
    {
      name: 'The Threshold Guardian',
      definition:
        'The gatekeeper figure testing the dreamer’s psychological readiness before entering a deeper stratum of the unconscious. Often manifests as Sphinxes, silent watchers, stern guides, or impassable rivers.',
      mythicParallel: 'Cerberus at the gates of the underworld, the angel with the flaming sword.',
      individuationRole: 'Tests whether the ego possesses the courage to relinquish old psychological defenses.',
    },
  ];

  return (
    <div className="space-y-12 max-w-6xl mx-auto py-4">
      {/* Editorial Header */}
      <div className="border-b border-[#E7E2DA] pb-8 space-y-3">
        <div className="text-xs uppercase tracking-widest text-[#78716C] font-cinzel">
          Carl Jung’s Analytical Depth Psychology
        </div>
        <h2 className="font-editorial text-3xl sm:text-5xl font-semibold text-[#1C1917]">
          Archetype Codex & Collective Unconscious
        </h2>
        <p className="text-sm font-body-serif text-[#57534E] max-w-3xl leading-relaxed">
          Archetypes are universal, archaic patterns and images that derive from the collective unconscious.
          When your dreams speak in symbols, they utilize these primordial templates to navigate your personal individuation.
        </p>
      </div>

      {/* Detected Archetypes in Dream Journal */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="font-editorial text-2xl font-medium text-[#1C1917]">
            Archetypes Detected in Your Dreams
          </h3>
          <span className="text-xs text-[#78716C] font-mono">
            {archetypesMap.size} Unique Archetypes Identified
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from(archetypesMap.entries()).map(([name, data], idx) => (
            <div
              key={idx}
              className="p-6 bg-white border border-[#E7E2DA] rounded-xl space-y-4 hover:border-[#1C1917] transition-all shadow-xs flex flex-col justify-between"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-cinzel text-sm font-semibold text-[#1C1917] uppercase tracking-wide">
                    {name}
                  </span>
                  <span className="text-xs font-mono text-[#B45309] font-bold">
                    {data.count} {data.count === 1 ? 'Manifestation' : 'Manifestations'}
                  </span>
                </div>
                <p className="text-xs text-[#57534E] font-body-serif leading-relaxed line-clamp-3">
                  {data.descriptions[0]}
                </p>
              </div>

              <div className="pt-3 border-t border-[#F0EBE3] space-y-2">
                <span className="text-[11px] uppercase tracking-wider text-[#A8A29E] font-cinzel">
                  Manifested in Dreams:
                </span>
                <div className="space-y-1">
                  {data.dreams.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => onSelectDream(d)}
                      className="block text-left text-xs font-medium text-[#1C1917] hover:text-[#B45309] transition-colors truncate w-full"
                    >
                      → {d.title}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Classical Jungian Archetype Reference Encyclopedia */}
      <section className="space-y-6 pt-6 border-t border-[#E7E2DA]">
        <h3 className="font-editorial text-2xl font-medium text-[#1C1917]">
          Primordial Archetype Foundations
        </h3>

        <div className="space-y-6">
          {standardArchetypes.map((arch, idx) => (
            <div
              key={idx}
              className="p-8 bg-[#F5F1EB] border border-[#DDD6C8] rounded-xl space-y-4 transition-all"
            >
              <div className="flex items-center justify-between border-b border-[#E2DBD0] pb-3">
                <h4 className="font-cinzel text-lg font-semibold text-[#1C1917] uppercase tracking-wide">
                  {arch.name}
                </h4>
                <span className="text-xs text-[#78716C] font-mono">Foundational Concept</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-[#44403C] font-body-serif leading-relaxed">
                <div className="space-y-1">
                  <span className="font-semibold text-[#1C1917] not-italic block uppercase text-[10px] tracking-wider font-cinzel">
                    Psychological Definition
                  </span>
                  <p>{arch.definition}</p>
                </div>

                <div className="space-y-1">
                  <span className="font-semibold text-[#1C1917] not-italic block uppercase text-[10px] tracking-wider font-cinzel">
                    Mythological Parallel
                  </span>
                  <p>{arch.mythicParallel}</p>
                </div>

                <div className="space-y-1">
                  <span className="font-semibold text-[#1C1917] not-italic block uppercase text-[10px] tracking-wider font-cinzel">
                    Function in Individuation
                  </span>
                  <p>{arch.individuationRole}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
