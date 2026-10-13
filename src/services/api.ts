import type {
  ChatMessage,
  ChatModelOption,
  DreamEntry,
  ImageResolution,
  Interpretation,
  AspectRatioOption,
} from '../types';

const ARCHIVE_TIMEOUT_MS = 15_000;
const AI_TIMEOUT_MS = 660_000;

class HttpError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = ARCHIVE_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new HttpError(errorData.error || `Request failed with HTTP ${res.status}`, res.status);
    }
    return res.status === 204 ? undefined as T : await res.json();
  } catch (error) {
    if (timedOut) throw new Error('The request timed out. Your draft is still available; please retry.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abort);
  }
}

function jsonBody(value: unknown): RequestInit {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) };
}

export interface BackendHealth {
  status: string;
  aiConfigured: boolean;
  dreamCount: number;
  textModel: string;
  imageModel: string;
  transcriptionModel: string;
  textReasoningEffort: 'none' | 'low' | 'high' | 'max' | null;
  aiRequestTimeoutMs: number;
  textProvider: 'deepseek' | 'gemini';
  mediaProvider: 'dashscope' | 'gemini';
  capabilities: { interpret: boolean; chat: boolean; transcribe: boolean; image: boolean };
  chatModels: Array<{ id: string; label: string }>;
  imageOptions: { resolutions: ImageResolution[]; aspectRatios: AspectRatioOption[]; dimensions: Partial<Record<AspectRatioOption, [number, number]>> };
  transcriptionOptions: { requiresWav: boolean; maxDurationSeconds: number; maxBase64Bytes: number };
}

export function getHealth(): Promise<BackendHealth> {
  return requestJson('/api/health');
}

export async function listDreams(): Promise<DreamEntry[]> {
  const data = await requestJson<{ dreams: DreamEntry[] }>('/api/dreams');
  return data.dreams;
}

export async function bootstrapDreams(dreams: DreamEntry[]): Promise<DreamEntry[]> {
  const data = await requestJson<{ dreams: DreamEntry[] }>('/api/dreams/bootstrap', {
    method: 'POST', ...jsonBody({ dreams }),
  });
  return data.dreams;
}

export async function importDreams(dreams: DreamEntry[]): Promise<{ dreams: DreamEntry[]; imported: number; skipped: number }> {
  return requestJson('/api/dreams/import', {
    method: 'POST', ...jsonBody({ dreams }),
  });
}

export async function createDream(dream: DreamEntry): Promise<DreamEntry> {
  try {
    const data = await requestJson<{ dream: DreamEntry }>('/api/dreams', {
      method: 'POST', ...jsonBody(dream),
    });
    return data.dream;
  } catch (error) {
    // A request can be committed even if its response never reaches the browser.
    if (!(error instanceof HttpError) || error.status === 409) {
      try {
        const existing = await requestJson<{ dream: DreamEntry }>(`/api/dreams/${encodeURIComponent(dream.id)}`);
        if (existing.dream.title === dream.title && existing.dream.transcript === dream.transcript &&
            existing.dream.createdAt === dream.createdAt) return existing.dream;
      } catch { /* Retain the original save error when confirmation is unavailable. */ }
    }
    throw error;
  }
}

export async function updateDream(dream: DreamEntry): Promise<DreamEntry> {
  const data = await requestJson<{ dream: DreamEntry }>(`/api/dreams/${encodeURIComponent(dream.id)}`, {
    method: 'PUT', ...jsonBody(dream),
  });
  return data.dream;
}

export async function deleteDream(id: string): Promise<void> {
  await requestJson(`/api/dreams/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function updateDreamChatHistory(dreamId: string, chatHistory: ChatMessage[]): Promise<DreamEntry> {
  const data = await requestJson<{ dream: DreamEntry }>(
    `/api/dreams/${encodeURIComponent(dreamId)}/chat`,
    { method: 'PATCH', ...jsonBody({ chatHistory }) }
  );
  return data.dream;
}

export async function transcribeAudio(audioBase64: string, mimeType = 'audio/webm', signal?: AbortSignal): Promise<string> {
  const data = await requestJson<{ transcript: string }>('/api/transcribe', {
    method: 'POST', ...jsonBody({ audioBase64, mimeType: mimeType.split(';')[0] }), signal,
  }, AI_TIMEOUT_MS);
  return data.transcript || '';
}

export function interpretDream(transcript: string, emotionalNotes?: string, signal?: AbortSignal): Promise<Interpretation> {
  return requestJson('/api/interpret', {
    method: 'POST', ...jsonBody({ transcript, emotionalNotes }), signal,
  }, AI_TIMEOUT_MS);
}

export function generateSurrealistImage(
  prompt: string,
  imageSize: ImageResolution = '1K',
  aspectRatio: AspectRatioOption = '1:1',
  signal?: AbortSignal
): Promise<{ imageUrl: string; imageSize: string; aspectRatio: string }> {
  return requestJson('/api/generate-image', {
    method: 'POST', ...jsonBody({ prompt, imageSize, aspectRatio }), signal,
  }, AI_TIMEOUT_MS);
}

export async function sendSymbolChatMessage(
  messages: Array<{ role: 'user' | 'model'; content: string }>,
  dreamContext: DreamEntry,
  modelName?: ChatModelOption,
  signal?: AbortSignal
): Promise<string> {
  // Keep the complete journal on disk, but bound the model's context window.
  const recentMessages = messages.slice(-40);
  while (recentMessages[0]?.role === 'model') recentMessages.shift();
  const data = await requestJson<{ reply: string }>('/api/chat-symbol', {
    method: 'POST',
    ...jsonBody({
      messages: recentMessages,
      dreamContext: {
        title: dreamContext.title,
        transcript: dreamContext.transcript,
        coreTheme: dreamContext.interpretation?.coreTheme,
        unconsciousTension: dreamContext.interpretation?.unconsciousTension,
        archetypes: dreamContext.interpretation?.archetypes,
        symbols: dreamContext.interpretation?.symbols,
      },
      modelName,
    }),
    signal,
  }, AI_TIMEOUT_MS);
  if (!data.reply?.trim()) throw new Error('The model returned an empty reply. Your question can be retried.');
  return data.reply;
}
