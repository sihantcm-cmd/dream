import type {
  ChatMessage,
  ChatModelOption,
  DreamEntry,
  ImageResolution,
  Interpretation,
  AspectRatioOption,
} from '../types';
import { authenticatedHeaders, getCloudClient, getSessionConfig, isAliyunMode, isCloudMode, notifySessionExpired } from './cloud';

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
    const headers = await authenticatedHeaders(init.headers);
    const res = await fetch(url, { ...init, headers, credentials: 'same-origin', signal: controller.signal });
    if (!res.ok) {
      if (res.status === 401) notifySessionExpired();
      const errorData = await res.json().catch(() => ({}));
      throw new HttpError(errorData.error || `Request failed with HTTP ${res.status}`, res.status);
    }
    return res.status === 204 ? undefined as T : await res.json();
  } catch (error) {
    if (timedOut) throw new Error('请求超时，草稿已保留，请稍后重试。');
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
  const dreams: DreamEntry[] = [];
  let offset = 0;
  do {
    const data = await requestJson<{ dreams: DreamEntry[]; hasMore?: boolean; nextOffset?: number }>(
      isCloudMode() ? `/api/dreams?offset=${offset}&limit=20` : '/api/dreams');
    dreams.push(...data.dreams);
    if (!data.hasMore) return dreams;
    if (!Number.isInteger(data.nextOffset) || data.nextOffset! <= offset) throw new Error('档案分页响应无效，请重试。');
    offset = data.nextOffset!;
  } while (offset <= 500);
  throw new Error('档案数量超过可读取范围。');
}

export async function bootstrapDreams(dreams: DreamEntry[]): Promise<DreamEntry[]> {
  const data = await requestJson<{ dreams: DreamEntry[] }>('/api/dreams/bootstrap', {
    method: 'POST', ...jsonBody({ dreams }),
  });
  return data.dreams;
}

export async function importDreams(dreams: DreamEntry[]): Promise<{ dreams: DreamEntry[]; imported: number; skipped: number }> {
  if (isCloudMode()) {
    if (dreams.length > 500) throw new Error('单次最多导入 500 条梦境。');
    let imported = 0;
    let skipped = 0;
    for (const entry of dreams) {
      const normalized = await prepareCloudDream(entry, true);
      const result = await requestJson<{ imported: number; skipped: number }>('/api/dreams/import', {
        method: 'POST', ...jsonBody({ dreams: [normalized] }),
      }, 60_000);
      imported += result.imported;
      skipped += result.skipped;
    }
    return { dreams: await listDreams(), imported, skipped };
  }
  return requestJson('/api/dreams/import', {
    method: 'POST', ...jsonBody({ dreams }),
  });
}

export async function createDream(dream: DreamEntry): Promise<DreamEntry> {
  try {
    const prepared = await prepareCloudDream(dream);
    const data = await requestJson<{ dream: DreamEntry }>('/api/dreams', {
      method: 'POST', ...jsonBody(prepared),
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
  const prepared = await prepareCloudDream(dream);
  const data = await requestJson<{ dream: DreamEntry }>(`/api/dreams/${encodeURIComponent(dream.id)}`, {
    method: 'PUT', ...jsonBody(prepared),
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
  const audioPath = isCloudMode() ? await uploadCloudDataUrl(`data:${mimeType.split(';')[0]};base64,${audioBase64}`, 'audio', signal) : undefined;
  const data = await requestJson<{ transcript: string }>('/api/transcribe', {
    method: 'POST', ...jsonBody(audioPath ? { audioPath, mimeType: mimeType.split(';')[0] } : { audioBase64, mimeType: mimeType.split(';')[0] }), signal,
  }, AI_TIMEOUT_MS);
  return data.transcript || '';
}

export function interpretDream(transcript: string, emotionalNotes?: string, signal?: AbortSignal): Promise<Interpretation> {
  return requestJson('/api/interpret', {
    method: 'POST', ...jsonBody({ transcript, emotionalNotes }), signal,
  }, AI_TIMEOUT_MS);
}

export async function generateSurrealistImage(
  prompt: string,
  imageSize: ImageResolution = '1K',
  aspectRatio: AspectRatioOption = '1:1',
  signal?: AbortSignal
): Promise<{ imageUrl: string; imagePath?: string; imageSize: string; aspectRatio: string }> {
  const result = await requestJson<{ imageUrl: string; imagePath?: string; imageSize: string; aspectRatio: string }>('/api/generate-image', {
    method: 'POST', ...jsonBody({ prompt, imageSize, aspectRatio }), signal,
  }, AI_TIMEOUT_MS);
  return result;
}

async function uploadCloudDataUrl(dataUrl: string, kind: 'image' | 'audio', signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match || !match[1].startsWith(`${kind}/`)) throw new Error('媒体格式无效，请重新录音或导入。');
  const bytes = Uint8Array.from(atob(match[2].replace(/\s/g, '')), (char) => char.charCodeAt(0));
  const maximum = (kind === 'image' ? 40 : 20) * 1024 * 1024;
  if (bytes.byteLength > maximum) throw new Error(`媒体超过 ${maximum / 1024 / 1024} MB 上限。`);
  const media = await requestJson<{ path?: string; mediaPath: string; token?: string; signedUrl?: string; uploadUrl?: string; method?: string }>('/api/media/upload', {
    method: 'POST', ...jsonBody({ mimeType: match[1], kind }), signal,
  });
  if (isAliyunMode()) {
    if (!media.uploadUrl || !media.uploadUrl.startsWith('/api/media/content/') || !media.mediaPath?.startsWith('/media/')) {
      throw new Error('上传地址无效，请刷新页面后重试。');
    }
    const response = await fetch(media.uploadUrl, {
      method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': match[1] },
      body: new Blob([bytes], { type: match[1] }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      if (response.status === 401) notifySessionExpired();
      throw new Error('媒体上传失败，请检查网络并重试。');
    }
  } else {
    if (!media.path || !media.token) throw new Error('上传地址无效，请刷新页面后重试。');
    const { error } = await getCloudClient().storage.from('oneiros-media').uploadToSignedUrl(
      media.path, media.token, new Blob([bytes], { type: match[1] }), { contentType: match[1] });
    if (error) throw new Error('媒体上传失败，请检查网络并重试。');
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return media.mediaPath || `/cloud-media/${media.path}`;
}

async function prepareCloudDream(dream: DreamEntry, importing = false): Promise<DreamEntry> {
  if (!isCloudMode()) return dream;
  const result = { ...dream };
  for (const kind of ['image', 'audio'] as const) {
    const urlKey = kind === 'image' ? 'imageUrl' : 'audioUrl';
    const pathKey = kind === 'image' ? 'imagePath' : 'audioPath';
    const url = result[urlKey];
    if (importing && url && !url.startsWith('data:')) {
      throw new Error('备份中的媒体不是完整文件。请在来源 Oneiros 中重新导出包含媒体的 JSON 备份。');
    }
    if (url?.startsWith('data:')) {
      const path = await uploadCloudDataUrl(url, kind);
      result[urlKey] = path;
      result[pathKey] = path;
    } else if (url?.startsWith(isAliyunMode() ? '/media/' : '/cloud-media/')) {
      result[pathKey] = url;
    } else if (result[pathKey] && !importing) {
      result[urlKey] = result[pathKey];
    } else if (!url && importing) {
      delete result[pathKey];
    }
  }
  if (new Blob([JSON.stringify(result)]).size > 1024 * 1024) throw new Error('单条梦境文字与聊天记录超过 1 MB，请缩小后重试。');
  return result;
}

export async function exportArchive(): Promise<Blob> {
  if (!isCloudMode()) {
    const response = await fetch('/api/archive/export', { headers: await authenticatedHeaders(), signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error((await response.json()).error || '导出失败。');
    return response.blob();
  }
  const dreams = await listDreams();
  let totalBytes = 0;
  const exported: DreamEntry[] = [];
  for (const dream of dreams) {
    const entry = { ...dream };
    for (const kind of ['image', 'audio'] as const) {
      const urlKey = kind === 'image' ? 'imageUrl' : 'audioUrl';
      const pathKey = kind === 'image' ? 'imagePath' : 'audioPath';
      if (entry[urlKey]) {
        const mediaUrl = new URL(entry[urlKey], window.location.origin);
        const config = await getSessionConfig();
        const allowedMedia = isAliyunMode()
          ? mediaUrl.origin === window.location.origin && mediaUrl.pathname.startsWith('/media/')
          : !!config.supabaseUrl && mediaUrl.origin === new URL(config.supabaseUrl).origin;
        if (!allowedMedia) throw new Error('无法导出不属于私人存储的媒体。');
        const response = await fetch(mediaUrl, { signal: AbortSignal.timeout(60_000), credentials: isAliyunMode() ? 'same-origin' : 'omit' });
        if (response.status === 401) notifySessionExpired();
        if (!response.ok) throw new Error('下载备份媒体失败，请重试。');
        const blob = await response.blob();
        totalBytes += blob.size;
        if (totalBytes > 36 * 1024 * 1024) throw new Error('档案媒体超过单份 JSON 备份上限，请从私人存储下载完整备份。');
        entry[urlKey] = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('媒体备份读取失败。'));
          reader.readAsDataURL(blob);
        });
      }
      delete entry[pathKey];
    }
    exported.push(entry);
  }
  const backup = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), dreams: exported })], { type: 'application/json' });
  if (backup.size > 49 * 1024 * 1024) throw new Error('档案超过单份 49 MB JSON 备份上限。');
  return backup;
}

export interface CloudSettings {
  updatedAt?: string | null;
  deepseekKeyConfigured: boolean;
  dashscopeKeyConfigured: boolean;
  deepseekModel: string;
  deepseekReasoningEffort: 'none' | 'low' | 'high' | 'max';
  dashscopeAsrModel: string;
  dashscopeImageModel: string;
  dashscopeWorkspaceId: string;
}

export type CloudSettingsUpdate = Partial<CloudSettings> & {
  deepseekApiKey?: string; dashscopeApiKey?: string;
  clearDeepseekKey?: boolean; clearDashscopeKey?: boolean;
};

export function getCloudSettings(): Promise<CloudSettings> { return requestJson('/api/settings'); }
export function saveCloudSettings(settings: CloudSettingsUpdate): Promise<CloudSettings> {
  return requestJson('/api/settings', { method: 'PUT', ...jsonBody(settings) });
}
export function testCloudProvider(provider: 'deepseek' | 'dashscope'): Promise<{ ok?: boolean; message?: string }> {
  return requestJson('/api/settings/test', { method: 'POST', ...jsonBody({ provider }) }, AI_TIMEOUT_MS);
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
