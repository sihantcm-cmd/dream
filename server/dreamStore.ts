import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChatMessage, DreamEntry } from '../src/types';
import { parseChatHistory, parseDream } from './validation';

const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
};
const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/mpeg': 'mp3',
};

function invalidDreamError() {
  return Object.assign(new Error('Dream entry contains invalid fields.'), { status: 400 });
}

export function createDreamStore(dataDirectory: string) {
  const dreamsFile = path.join(dataDirectory, 'dreams.json');
  const initializedFile = path.join(dataDirectory, '.archive-initialized');
  const mediaDirectory = path.join(dataDirectory, 'media');
  let pendingWrite: Promise<void> = Promise.resolve();

  async function exists(filename: string): Promise<boolean> {
    try {
      await access(filename);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async function readFileDreams(): Promise<DreamEntry[]> {
    let content: string;
    try {
      content = await readFile(dreamsFile, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const parsed: unknown = JSON.parse(content);
    if (!Array.isArray(parsed)) throw new Error('Dream archive must contain a JSON array.');
    const dreams: DreamEntry[] = [];
    const ids = new Set<string>();
    for (const item of parsed) {
      const dream = parseDream(item);
      if (!dream || ids.has(dream.id)) throw new Error('Dream archive contains invalid or duplicate entries. Restore the archive from a backup.');
      dreams.push(dream);
      ids.add(dream.id);
    }
    return dreams;
  }

  async function markInitialized() {
    await mkdir(dataDirectory, { recursive: true });
    try {
      await writeFile(initializedFile, '1\n', { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  async function writeFileDreams(dreams: DreamEntry[]) {
    await mkdir(dataDirectory, { recursive: true });
    const temporaryFile = `${dreamsFile}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryFile, `${JSON.stringify(dreams, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      // Windows virus scanners can briefly hold the destination open. Retry the
      // atomic replacement without ever removing the previous archive first.
      for (let attempt = 0; ; attempt += 1) {
        try {
          await rename(temporaryFile, dreamsFile);
          break;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (attempt >= 6 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error;
          await delay(20 * 2 ** attempt);
        }
      }
    } catch (error) {
      await unlink(temporaryFile).catch(() => undefined);
      throw error;
    }
    await markInitialized();
  }

  function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = pendingWrite.then(operation);
    pendingWrite = result.then(() => undefined, () => undefined);
    return result;
  }

  async function storeMediaData(data: string, mimeType: string, kind: 'image' | 'audio'): Promise<string> {
    const extension = (kind === 'image' ? IMAGE_EXTENSIONS : AUDIO_EXTENSIONS)[mimeType];
    const limit = kind === 'image' ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
    if (!extension) throw new Error(`Unsupported ${kind} MIME type.`);
    if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length > Math.ceil(limit / 3) * 4) {
      throw new Error(`The ${kind} data is not valid base64 or exceeds its size limit.`);
    }
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > limit || bytes.toString('base64') !== data) {
      throw new Error(`The ${kind} is empty, malformed, or exceeds its size limit.`);
    }
    await mkdir(mediaDirectory, { recursive: true });
    const filename = `${randomUUID()}.${extension}`;
    await writeFile(path.join(mediaDirectory, filename), bytes, { flag: 'wx' });
    return `/media/${filename}`;
  }

  async function normalizeDream(value: DreamEntry): Promise<DreamEntry> {
    const dream = parseDream(value);
    if (!dream) throw invalidDreamError();
    const normalizeUrl = async (url: string, kind: 'image' | 'audio') => {
      const match = url.match(/^data:([^;,]+)(?:;codecs=[^;,]+)?;base64,([A-Za-z0-9+/]*={0,2})$/);
      return match ? storeMediaData(match[2], match[1], kind) : url;
    };
    return {
      ...dream,
      imageUrl: await normalizeUrl(dream.imageUrl, 'image'),
      ...(dream.audioUrl === undefined ? {} : { audioUrl: await normalizeUrl(dream.audioUrl, 'audio') }),
    };
  }

  return {
    mediaDirectory,

    async list(): Promise<DreamEntry[]> {
      await pendingWrite;
      return readFileDreams();
    },

    bootstrap(dreams: DreamEntry[]) {
      return withWriteLock(async () => {
        const current = await readFileDreams();
        // Existing empty archives also count as initialized: deleting every dream is intentional.
        if (await exists(initializedFile) || await exists(dreamsFile)) {
          await markInitialized();
          return { dreams: current, imported: false };
        }
        const normalized: DreamEntry[] = [];
        const ids = new Set<string>();
        for (const dream of dreams) {
          if (ids.has(dream.id)) continue;
          normalized.push(await normalizeDream(dream));
          ids.add(dream.id);
        }
        await writeFileDreams(normalized);
        return { dreams: normalized, imported: normalized.length > 0 };
      });
    },

    importDreams(dreams: DreamEntry[]) {
      return withWriteLock(async () => {
        const current = await readFileDreams();
        const ids = new Set(current.map((dream) => dream.id));
        const additions: DreamEntry[] = [];
        for (const dream of dreams) {
          if (ids.has(dream.id)) continue;
          additions.push(await normalizeDream(dream));
          ids.add(dream.id);
        }
        const merged = [...additions, ...current];
        await writeFileDreams(merged);
        return { dreams: merged, imported: additions.length, skipped: dreams.length - additions.length };
      });
    },

    create(dream: DreamEntry) {
      return withWriteLock(async () => {
        const current = await readFileDreams();
        if (current.some((entry) => entry.id === dream.id)) {
          throw Object.assign(new Error('A dream with this ID already exists.'), { status: 409 });
        }
        const normalized = await normalizeDream(dream);
        await writeFileDreams([normalized, ...current]);
        return normalized;
      });
    },

    update(id: string, dream: DreamEntry) {
      return withWriteLock(async () => {
        const current = await readFileDreams();
        const index = current.findIndex((entry) => entry.id === id);
        if (index < 0) return null;
        const updated = await normalizeDream({ ...dream, id, createdAt: current[index].createdAt });
        current[index] = updated;
        await writeFileDreams(current);
        return updated;
      });
    },

    remove(id: string) {
      return withWriteLock(async () => {
        const current = await readFileDreams();
        const next = current.filter((dream) => dream.id !== id);
        if (next.length === current.length) return false;
        await writeFileDreams(next);
        return true;
      });
    },

    updateChatHistory(id: string, chatHistory: ChatMessage[]) {
      return withWriteLock(async () => {
        const parsedChat = parseChatHistory(chatHistory);
        if (!parsedChat) throw Object.assign(new Error('Chat history is invalid.'), { status: 400 });
        const current = await readFileDreams();
        const index = current.findIndex((dream) => dream.id === id);
        if (index < 0) return null;
        const updated = { ...current[index], chatHistory: parsedChat };
        current[index] = updated;
        await writeFileDreams(current);
        return updated;
      });
    },

    saveGeneratedImage(data: string, mimeType: string) {
      return storeMediaData(data, mimeType, 'image');
    },
  };
}
