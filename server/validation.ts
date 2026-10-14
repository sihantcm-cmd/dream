import type { ChatMessage, DreamEntry, Interpretation } from '../src/types';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const AUDIO_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/mpeg']);
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown, maxLength = 100_000): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function isTimestamp(value: unknown): value is string {
  return isString(value, 80) && Boolean(value.trim()) && Number.isFinite(Date.parse(value));
}

// Blob URLs cannot survive a browser restart or move to another device.
function isMediaUrl(value: unknown, kind: 'image' | 'audio'): value is string {
  if (typeof value !== 'string') return false;
  if (value === '') return true;
  if (value !== value.trim() || /[\u0000-\u001f\u007f\\]/.test(value)) return false;
  if (value.startsWith('data:')) {
    const match = value.match(/^data:([^;,]+)(?:;codecs=[^;,]+)?;base64,([A-Za-z0-9+/]*={0,2})$/);
    if (!match || !match[2] || match[2].length % 4 !== 0) return false;
    const types = kind === 'image' ? IMAGE_TYPES : AUDIO_TYPES;
    const limit = kind === 'image' ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
    if (!types.has(match[1]) || match[2].length > Math.ceil(limit / 3) * 4) return false;
    const decoded = Buffer.from(match[2], 'base64');
    return decoded.length > 0 && decoded.length <= limit && decoded.toString('base64') === match[2];
  }
  if (value.length > 4_096 || value.startsWith('//') || value.startsWith('#') || value.startsWith('?')) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
    } catch {
      return false;
    }
  }
  // Vite development paths, built assets, and server media are relative URLs.
  return !value.split(/[/?#]/).some((part) => part === '..');
}

export function parseInterpretation(value: unknown): Interpretation | null {
  if (!isRecord(value) ||
    !isString(value.title, 300) || !isString(value.coreTheme) ||
    !isString(value.unconsciousTension) || !isString(value.dominantMood, 500) ||
    !isString(value.individuationGuidance) || !isString(value.surrealistImagePrompt, 20_000) ||
    !Array.isArray(value.archetypes) || value.archetypes.length > 100 ||
    !Array.isArray(value.symbols) || value.symbols.length > 100
  ) return null;
  const archetypes: Interpretation['archetypes'] = [];
  for (const item of value.archetypes) {
    if (!isRecord(item) || !isString(item.name, 300) || !isString(item.description) || !isString(item.appearanceInDream)) return null;
    archetypes.push({ name: item.name, description: item.description, appearanceInDream: item.appearanceInDream });
  }
  const symbols: Interpretation['symbols'] = [];
  for (const item of value.symbols) {
    if (!isRecord(item) || !isString(item.symbol, 300) || !isString(item.archetypalMeaning) || !isString(item.personalReflectionPrompt)) return null;
    symbols.push({ symbol: item.symbol, archetypalMeaning: item.archetypalMeaning, personalReflectionPrompt: item.personalReflectionPrompt });
  }
  return {
    title: value.title, coreTheme: value.coreTheme, unconsciousTension: value.unconsciousTension,
    dominantMood: value.dominantMood, archetypes, symbols,
    individuationGuidance: value.individuationGuidance, surrealistImagePrompt: value.surrealistImagePrompt,
  };
}

export function parseChatHistory(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length > 5000) return null;
  const messages: ChatMessage[] = [];
  for (const message of value) {
    if (!isRecord(message) || (message.role !== 'user' && message.role !== 'model') ||
      !isString(message.content, 20_000) || !isTimestamp(message.timestamp)
    ) return null;
    messages.push({ role: message.role, content: message.content, timestamp: message.timestamp });
  }
  return messages;
}

export function parseDream(value: unknown): DreamEntry | null {
  // Old browser-only archives recorded ephemeral audio URLs. Preserve their
  // transcripts while dropping the recording reference that can no longer play.
  if (isRecord(value) && typeof value.audioUrl === 'string' && value.audioUrl.startsWith('blob:')) {
    value = { ...value, audioUrl: undefined };
  }
  if (!isRecord(value) ||
    !isString(value.id, 120) || !value.id.trim() || !isTimestamp(value.createdAt) ||
    !isString(value.title, 300) || !value.title.trim() ||
    !isString(value.transcript) || !value.transcript.trim() ||
    (value.resolution !== 'native' && value.resolution !== '1K' && value.resolution !== '2K' && value.resolution !== '4K') ||
    (value.aspectRatio !== '1:1' && value.aspectRatio !== '4:3' && value.aspectRatio !== '16:9') ||
    (value.status !== undefined && value.status !== 'draft' && value.status !== 'complete') ||
    (value.imagePath !== undefined && !isMediaUrl(value.imagePath, 'image')) ||
    (value.audioPath !== undefined && !isMediaUrl(value.audioPath, 'audio')) ||
    !isMediaUrl(value.imageUrl, 'image') || !isString(value.imagePrompt, 20_000) ||
    (value.audioUrl !== undefined && !isMediaUrl(value.audioUrl, 'audio')) ||
    (value.emotionalNotes !== undefined && !isString(value.emotionalNotes, 4_000)) ||
    (value.audioDurationSeconds !== undefined && (typeof value.audioDurationSeconds !== 'number' || !Number.isFinite(value.audioDurationSeconds) || value.audioDurationSeconds < 0))
  ) return null;
  const interpretation = parseInterpretation(value.interpretation);
  const chatHistory = parseChatHistory(value.chatHistory === undefined ? [] : value.chatHistory);
  if (!interpretation || !chatHistory) return null;
  // Rebuild objects explicitly so unrecognized fields cannot enter the archive.
  return {
    id: value.id, createdAt: value.createdAt, title: value.title, transcript: value.transcript,
    resolution: value.resolution, aspectRatio: value.aspectRatio, status: value.status ?? 'complete',
    ...(value.imagePath === undefined ? {} : { imagePath: value.imagePath }),
    ...(value.audioPath === undefined ? {} : { audioPath: value.audioPath }),
    imageUrl: value.imageUrl, imagePrompt: value.imagePrompt, interpretation, chatHistory,
    ...(value.audioUrl === undefined ? {} : { audioUrl: value.audioUrl }),
    ...(value.emotionalNotes === undefined ? {} : { emotionalNotes: value.emotionalNotes }),
    ...(value.audioDurationSeconds === undefined ? {} : { audioDurationSeconds: value.audioDurationSeconds }),
  } as DreamEntry;
}
