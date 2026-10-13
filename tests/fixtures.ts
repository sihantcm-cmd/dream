import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Keep temporary archives inside the writable workspace: Windows sandbox Temp
// directories may prohibit the atomic replace used by the production store.
export function temporaryArchive(prefix: string) {
  return mkdtemp(fileURLToPath(new URL(`.tmp-${prefix}-`, import.meta.url)));
}

export function draftDream(id: string) {
  return {
    id,
    createdAt: '2026-10-13T12:00:00.000Z',
    title: `Dream ${id}`,
    transcript: 'I walked through a quiet garden beside a blue door.',
    status: 'draft' as const,
    resolution: '1K' as const,
    aspectRatio: '1:1' as const,
    imageUrl: '',
    imagePrompt: '',
    interpretation: {
      title: 'Not analysed',
      coreTheme: 'Not analysed',
      unconsciousTension: 'Not analysed',
      dominantMood: 'Not analysed',
      archetypes: [],
      symbols: [],
      individuationGuidance: 'Not analysed',
      surrealistImagePrompt: '',
    },
    chatHistory: [],
  };
}

// A complete, tiny PCM WAV; the media test never calls an external AI service.
export function tinyWav() {
  const bytes = Buffer.alloc(46);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(38, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8_000, 24);
  bytes.writeUInt32LE(16_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(2, 40);
  return bytes;
}
