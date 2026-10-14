import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatMessage, DreamEntry } from '../src/types.js';
import { parseChatHistory, parseDream } from './validation.js';

export const CLOUD_MEDIA_BUCKET = 'oneiros-media';
const MAX_DREAM_BYTES = 1_000_000;
const MAX_PAGE_BYTES = 3_000_000;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_ASR_BYTES = 7.5 * 1024 * 1024;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID}$`);
const MEDIA_PATTERN = new RegExp(`^/cloud-media/(${UUID})/(${UUID})\\.(png|jpg|webp|webm|ogg|m4a|wav|mp3)$`);
const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const AUDIO_TYPES: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' };
const SAMPLE_IMAGES = new Set(['/samples/dream_desert_clocks_1791907918913.jpg', '/samples/dream_mirror_ocean_1791907919046.jpg']);
type MediaKind = 'image' | 'audio';
type CloudDream = DreamEntry & { imagePath?: string; audioPath?: string };
type DreamRow = { owner_id?: string; id: string; data: Record<string, unknown>; chat_history: unknown; created_at: string };

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

function checkError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return;
  if (error.code === '23505') fail('A dream with this ID already exists.', 409);
  if (error.code === '23514') fail('这条梦境及对话超过云端 1 MB 保存上限，请缩短内容后重试。', 413);
  if (error.code === 'P0001' && error.message === 'ARCHIVE_LIMIT') fail('云端档案最多保存 500 条梦境，请先导出并删除部分记录。', 413);
  // Database/storage errors can include request details; only expose a safe category.
  fail('云端存储暂时不可用，请稍后重试。', 503);
}

/** A request-scoped store. The caller must verify the Supabase user before passing userId. */
export function createCloudDreamStore(client: SupabaseClient, userId: string) {
  if (!UUID_PATTERN.test(userId)) fail('Invalid archive owner.');
  const bucket = client.storage.from(CLOUD_MEDIA_BUCKET);

  function ownedPath(mediaPath: string, kind?: MediaKind): string {
    const match = typeof mediaPath === 'string' && mediaPath.match(MEDIA_PATTERN);
    if (!match || match[1] !== userId) fail('文件必须属于当前账号，请重新上传。');
    if (kind && !Object.values(kind === 'image' ? IMAGE_TYPES : AUDIO_TYPES).includes(match[3])) {
      fail('文件类型与用途不匹配。');
    }
    return mediaPath.slice('/cloud-media/'.length);
  }

  function normalizeDream(value: DreamEntry): CloudDream {
    const parsed = parseDream(value);
    if (!parsed) fail('Dream entry contains invalid fields.');
    const input = value as CloudDream;
    const normalizeMedia = (url: string, stable: string | undefined, kind: MediaKind) => {
      const reference = stable ?? url;
      if (reference === '' || (kind === 'image' && SAMPLE_IMAGES.has(reference))) return reference;
      ownedPath(reference, kind);
      return reference;
    };
    const imageUrl = normalizeMedia(parsed.imageUrl, input.imagePath, 'image');
    const audioUrl = input.audioPath !== undefined || parsed.audioUrl !== undefined
      ? normalizeMedia(parsed.audioUrl ?? '', input.audioPath, 'audio') : undefined;
    // Signed URLs expire and contain bearer tokens; only canonical owned paths enter the DB.
    const { imagePath: _imagePath, audioPath: _audioPath, ...rest } = parsed as CloudDream;
    const normalized: CloudDream = { ...rest, imageUrl, ...(audioUrl === undefined ? {} : { audioUrl }) };
    if (Buffer.byteLength(JSON.stringify(normalized)) > MAX_DREAM_BYTES) {
      fail('这条梦境及对话超过云端 1 MB 保存上限，请缩短内容后重试。', 413);
    }
    return normalized;
  }

  function rowDream(row: DreamRow): CloudDream {
    const dream = parseDream({ ...row.data, id: row.id, createdAt: new Date(row.created_at).toISOString(), chatHistory: row.chat_history });
    if (!dream) fail('云端档案格式异常，请保留数据并联系维护者。', 500);
    return dream;
  }

  async function resolveDreams(dreams: CloudDream[]): Promise<CloudDream[]> {
    const paths = [...new Set(dreams.flatMap((dream) => [dream.imageUrl, dream.audioUrl]
      .filter((url): url is string => Boolean(url?.startsWith('/cloud-media/')))
      .map((url) => ownedPath(url))))];
    const urls = new Map<string, string>();
    if (paths.length) {
      const result = await bucket.createSignedUrls(paths, 3600);
      checkError(result.error);
      for (const item of result.data ?? []) {
        // A deleted/missing file must not prevent the owner from opening their other dreams.
        if (item.path && !item.error && item.signedUrl) urls.set(item.path, item.signedUrl);
      }
    }
    return dreams.map((dream) => ({
      ...dream,
      ...(dream.imageUrl.startsWith('/cloud-media/') ? {
        imagePath: dream.imageUrl,
        imageUrl: urls.get(ownedPath(dream.imageUrl, 'image')) ?? '',
      } : {}),
      ...(dream.audioUrl?.startsWith('/cloud-media/') ? {
        audioPath: dream.audioUrl,
        audioUrl: urls.get(ownedPath(dream.audioUrl, 'audio')) ?? '',
      } : {}),
    }));
  }

  async function get(id: string): Promise<CloudDream | null> {
    const result = await client.from('cloud_dreams').select('id,data,chat_history,created_at')
      .eq('owner_id', userId).eq('id', id).maybeSingle();
    checkError(result.error);
    return result.data ? (await resolveDreams([rowDream(result.data as DreamRow)]))[0] : null;
  }

  async function listPage({ offset = 0, limit = 50 }: { offset?: number; limit?: number } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 500 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      fail('Invalid archive page.');
    }
    const result = await client.from('cloud_dreams').select('id,data,chat_history,created_at')
      .eq('owner_id', userId).order('created_at', { ascending: false }).order('id', { ascending: true })
      .range(offset, offset + limit);
    checkError(result.error);
    const rows = (result.data ?? []) as DreamRow[];
    const candidates: CloudDream[] = [];
    let byteSize = 0;
    for (const row of rows.slice(0, limit)) {
      const dream = rowDream(row);
      // Reserve room for two signed URLs and the response envelope.
      const size = Buffer.byteLength(JSON.stringify(dream)) + 12_000;
      if (candidates.length && byteSize + size > MAX_PAGE_BYTES) break;
      candidates.push(dream);
      byteSize += size;
    }
    return {
      dreams: await resolveDreams(candidates),
      hasMore: rows.length > candidates.length,
      nextOffset: offset + candidates.length,
    };
  }

  async function list(): Promise<CloudDream[]> {
    const dreams: CloudDream[] = [];
    let offset = 0;
    while (offset < 500) {
      const page = await listPage({ offset });
      dreams.push(...page.dreams);
      if (!page.hasMore || page.nextOffset === offset) break;
      offset = page.nextOffset;
    }
    return dreams;
  }

  async function count() {
    const result = await client.from('cloud_dreams').select('id', { count: 'exact', head: true }).eq('owner_id', userId);
    checkError(result.error);
    return result.count ?? 0;
  }

  async function saveBatch(values: DreamEntry[], mode: 'bootstrap' | 'import' | 'create') {
    if (!Array.isArray(values) || values.length > 500) fail('Import no more than 500 dreams at a time.');
    const dreams = values.map(normalizeDream);
    const result = await client.rpc('cloud_save_dreams', { p_owner: userId, p_dreams: dreams, p_mode: mode });
    checkError(result.error);
    return result.data as { imported: number; skipped: number; initialized: boolean };
  }

  function mediaExtension(mimeType: string, kind: MediaKind) {
    if (kind !== 'image' && kind !== 'audio') fail('Unsupported media kind.');
    const types = kind === 'image' ? IMAGE_TYPES : AUDIO_TYPES;
    if (!Object.hasOwn(types, mimeType)) fail('Unsupported media MIME type.');
    const extension = types[mimeType];
    return extension;
  }

  async function createUpload(mimeType: string, kind: MediaKind) {
    const extension = mediaExtension(mimeType, kind);
    const path = `${userId}/${randomUUID()}.${extension}`;
    const result = await bucket.createSignedUploadUrl(path, { upsert: false });
    checkError(result.error);
    if (!result.data) fail('无法创建上传地址，请稍后重试。', 503);
    return { ...result.data, path, mediaPath: `/cloud-media/${path}` };
  }

  async function uploadMedia(data: string, mimeType: string, kind: MediaKind): Promise<string> {
    const extension = mediaExtension(mimeType, kind);
    const limit = kind === 'image' ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
    if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length > Math.ceil(limit / 3) * 4) {
      fail('媒体文件不是有效的 Base64，或超过大小限制。');
    }
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > limit || bytes.toString('base64') !== data) fail('媒体文件无效或超过大小限制。');
    const path = `${userId}/${randomUUID()}.${extension}`;
    const result = await bucket.upload(path, bytes, { contentType: mimeType, upsert: false });
    checkError(result.error);
    return `/cloud-media/${path}`;
  }

  async function signMediaPath(mediaPath: string) {
    if (mediaPath === '' || SAMPLE_IMAGES.has(mediaPath)) return mediaPath;
    const path = ownedPath(mediaPath);
    const result = await bucket.createSignedUrl(path, 3600);
    checkError(result.error);
    if (!result.data?.signedUrl) fail('找不到这个文件，请重新上传。', 404);
    return result.data.signedUrl;
  }

  async function readOwnedAudio(mediaPath: string) {
    const path = ownedPath(mediaPath, 'audio');
    if (!path.endsWith('.wav')) fail('转写需要 WAV 文件，请重新录制或转换。');
    const result = await bucket.download(path);
    checkError(result.error);
    if (!result.data || result.data.size > MAX_ASR_BYTES) fail('转写音频超过 7.5 MB，请将录音缩短到 3 分钟以内。', 413);
    const bytes = Buffer.from(await result.data.arrayBuffer());
    if (bytes.length < 44 || bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WAVE') {
      fail('音频不是有效的 WAV 文件，请重新录制。');
    }
    return { bytes, mimeType: 'audio/wav' };
  }

  return {
    list, listPage, count, get, createUpload, uploadMedia, signMediaPath, readOwnedAudio,
    async bootstrap(dreams: DreamEntry[]) {
      const result = await saveBatch(dreams, 'bootstrap');
      return { dreams: await list(), imported: result.imported > 0 };
    },
    async importDreams(dreams: DreamEntry[]) {
      const result = await saveBatch(dreams, 'import');
      return { dreams: await list(), imported: result.imported, skipped: result.skipped };
    },
    // Paged routes can return only the mutation summary, then let the client reload pages.
    importBatch: (dreams: DreamEntry[]) => saveBatch(dreams, 'import'),
    bootstrapBatch: (dreams: DreamEntry[]) => saveBatch(dreams, 'bootstrap'),
    async create(dream: DreamEntry) {
      await saveBatch([dream], 'create');
      return get(dream.id);
    },
    async update(id: string, dream: DreamEntry) {
      const normalized = normalizeDream({ ...dream, id });
      const { id: _id, createdAt: _createdAt, chatHistory: _chat, ...data } = normalized;
      const result = await client.from('cloud_dreams').update({ data, updated_at: new Date().toISOString() })
        .eq('owner_id', userId).eq('id', id).select('id,data,chat_history,created_at').maybeSingle();
      checkError(result.error);
      return result.data ? (await resolveDreams([rowDream(result.data as DreamRow)]))[0] : null;
    },
    async remove(id: string) {
      const result = await client.from('cloud_dreams').delete().eq('owner_id', userId).eq('id', id).select('id');
      checkError(result.error);
      return Boolean(result.data?.length);
    },
    async updateChatHistory(id: string, chatHistory: ChatMessage[]) {
      const parsedChat = parseChatHistory(chatHistory);
      if (!parsedChat) fail('Chat history is invalid.');
      if (Buffer.byteLength(JSON.stringify(parsedChat)) > MAX_DREAM_BYTES) fail('对话超过云端 1 MB 保存上限。', 413);
      const result = await client.from('cloud_dreams').update({ chat_history: parsedChat, updated_at: new Date().toISOString() })
        .eq('owner_id', userId).eq('id', id).select('id,data,chat_history,created_at').maybeSingle();
      checkError(result.error);
      return result.data ? (await resolveDreams([rowDream(result.data as DreamRow)]))[0] : null;
    },
    saveGeneratedImage: (data: string, mimeType: string) => uploadMedia(data, mimeType, 'image'),
  };
}
