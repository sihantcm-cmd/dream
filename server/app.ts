import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { GoogleGenAI, Type } from '@google/genai';
import { createDreamStore } from './dreamStore';
import { parseDream, parseChatHistory, parseInterpretation } from './validation';
import type { DreamEntry } from '../src/types';
import { getAiConfig } from './aiConfig';
import { AiProviderError, deepseekText, dashscopeTranscribe, dashscopeImage } from './domesticAi';

import type { ArchiveRuntime, RequestArchiveContext } from './runtime';
import { getAiEnvironment } from './aiEnvironment';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function createApp(runtime?: ArchiveRuntime) {
const app = express();
const localContext: RequestArchiveContext | null = runtime ? null : {
  dreamStore: createDreamStore(path.resolve(appRoot, process.env.DATA_DIR || './data')),
  aiConfig: getAiConfig(),
};
app.disable('x-powered-by');
// Reject cross-origin browser writes in both local and authenticated deployments.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('Origin');
    if (req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({ error: 'Cross-origin writes are not allowed.' });
    if (origin) {
      try {
        if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Cross-origin writes are not allowed.' });
      } catch { return res.status(403).json({ error: 'Invalid origin.' }); }
    }
  }
  next();
});
app.use(express.json({ limit: runtime ? '4mb' : '50mb' }));
if (runtime) runtime.mount(app);
else app.get('/api/session', (_req, res) => res.json({ mode: 'local', configured: true }));
function archiveContext(res: express.Response): RequestArchiveContext { return runtime ? res.locals.archive : localContext!; }

function sendStorageError(res: express.Response, error: unknown, fallback: string) {
  const status = Number((error as { status?: number })?.status);
  const safe = [400, 409, 413, 503].includes(status);
  return res.status(safe ? status : 500).json({ error: safe && error instanceof Error ? error.message.slice(0, 500) : fallback });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown, maxLength = 100_000): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function getAiClient() {
  const apiKey = getAiEnvironment().GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured. Add your Gemini API key to .env.');
  }
  return new GoogleGenAI({ apiKey, httpOptions: { timeout: 150_000, retryOptions: { attempts: 1 } } });
}

function sendAiError(res: express.Response, operation: string, error: unknown) {
  if (error instanceof AiProviderError) {
    const provider = error.provider === 'deepseek' ? 'DeepSeek' : '阿里云百炼';
    const keyName = error.provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'DASHSCOPE_API_KEY';
    const details: Record<string, string> = {
      AI_NOT_CONFIGURED: `请在 API 设置或本机 .env 填入 ${keyName} ；本机修改 .env 后需重启。`,
      AI_CONFIGURATION_INVALID: '请检查 .env 中的模型与北京地域业务空间 ID 配置。',
      AI_KEY_INVALID: `密钥无效，请检查 .env 中的 ${keyName} ；本机修改 .env 后需重启。`,
      AI_QUOTA_EXCEEDED: '余额或配额不足，或请求过于频繁。请在服务商控制台检查后重试。',
      AI_ACCESS_DENIED: '访问被拒绝，请检查账号的模型权限和密钥所属地域。',
      AI_MODEL_UNAVAILABLE: '模型不可用，请检查 .env 中的模型名称与访问权限。',
      AI_CONTENT_BLOCKED: '服务商未接受本次内容，请调整描述后重试。',
      AI_CONNECTION_FAILED: '连接超时或失败，请检查网络后手动重试；草稿仍可保存。',
      AI_INVALID_RESPONSE: '返回结果为空、不完整或格式不正确，请稍后重试。',
      AI_INVALID_AUDIO: '请提供不超过 3 分钟的 PCM WAV 录音，Base64 编码后不超过 10 MB。',
      AI_RESPONSE_TOO_LARGE: '返回内容超过本机接收上限。',
      AI_IMAGE_DOWNLOAD_FAILED: '图片已请求生成，但下载失败。请检查网络；再次生成可能另行计费。',
      PROVIDER_ERROR: '请求失败，请检查模型配置、网络和账户状态。',
    };
    console.error(`${error.provider} ${operation} failed: ${error.code} (HTTP ${error.status})`);
    const status = error.code === 'AI_INVALID_AUDIO' ? 400
      : ['AI_NOT_CONFIGURED', 'AI_CONFIGURATION_INVALID'].includes(error.code) ? 503 : 502;
    return res.status(status).json({ error: `${provider}：${details[error.code]}`, code: error.code, provider: error.provider });
  }
  const message = error instanceof Error ? error.message : String(error);
  const missingKey = message.includes('GEMINI_API_KEY is not configured');
  const status = isRecord(error) ? Number(error.status || error.code) : 0;
  const normalized = message.toLowerCase();
  let code = 'PROVIDER_ERROR';
  let detail = 'Gemini 请求失败，请检查模型配置、网络连接和账户权限。';
  if (missingKey) {
    code = 'AI_NOT_CONFIGURED';
    detail = 'GEMINI_API_KEY is not configured. 在本机 .env 填入 Gemini API 密钥；本机修改 .env 后需重启。';
  } else if (status === 429 || /resource_exhausted|quota exceeded|rate limit/.test(normalized)) {
    code = 'AI_QUOTA_EXCEEDED';
    detail = 'Gemini 配额不足或请求过于频繁。请在 Google AI Studio 检查该项目的模型配额与计费状态，稍后重试。';
  } else if (status === 401 || /api.key.not.valid|api_key_invalid|invalid api key/.test(normalized)) {
    code = 'AI_KEY_INVALID';
    detail = 'Gemini 密钥无效。请检查 .env 中的 GEMINI_API_KEY，更新后重启服务。';
  } else if (status === 403 || /permission_denied/.test(normalized)) {
    code = 'AI_ACCESS_DENIED';
    detail = 'Gemini 拒绝访问。请检查密钥的 API 限制、项目/模型权限及所在地区是否受支持。';
  } else if (status === 404 || /model.*not found|model.*not supported/.test(normalized)) {
    code = 'AI_MODEL_UNAVAILABLE';
    detail = '当前 Gemini 模型不可用。请核对 .env 中的模型名称与该项目的模型访问权限。';
  } else if (/timeout|timed out|fetch failed|econn|enotfound/.test(normalized)) {
    code = 'AI_CONNECTION_FAILED';
    detail = '连接 Gemini 超时或失败。请检查本机能否访问 Google Gemini API；梦境草稿仍可保存。';
  }
  // Provider errors may contain request data or credentials. Log only a safe category.
  console.error(`Gemini ${operation} failed: ${code}${Number.isFinite(status) && status ? ` (HTTP ${status})` : ''}`);
  return res.status(missingKey ? 503 : 502).json({
    error: detail, code,
  });
}

// A lightweight readiness endpoint for local and hosted deployments.
app.get('/api/health', async (_req, res) => {
  const { dreamStore, aiConfig } = archiveContext(res);
  const { textProvider, mediaProvider, textModel, imageModel, transcriptionModel } = aiConfig;
  const allowedChatModels = new Set(aiConfig.chatModels.map(({ id }) => id));
  try {
    const dreamCount = dreamStore.count ? await dreamStore.count() : (await dreamStore.list()).length;
    res.json({
      status: 'ok',
      mode: runtime ? 'cloud' : 'local',
      ...aiConfig,
      dreamCount,
      textModel,
      imageModel,
      transcriptionModel,
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ status: 'error', error: 'Dream archive storage is unavailable.' });
  }
});

app.get('/api/archive/export', async (_req, res) => {
  if (runtime) return res.status(400).json({ error: '云端备份请使用页面导出，文件会由浏览器从私有存储下载。' });
  const { dreamStore, aiConfig } = archiveContext(res);
  const { textProvider, mediaProvider, textModel, imageModel, transcriptionModel } = aiConfig;
  const allowedChatModels = new Set(aiConfig.chatModels.map(({ id }) => id));
  try {
    const dreams = await dreamStore.list();
    const mimeTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.mp4': 'audio/mp4', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
    const entries = [];
    let size = 0;
    for (const dream of dreams) {
      const entry = { ...dream };
      for (const field of ['imageUrl', 'audioUrl'] as const) {
        const url = entry[field];
        if (!url) continue;
        const match = url.match(/^\/(media|samples|src\/assets\/images)\/([a-zA-Z0-9_.-]+)$/);
        if (!match) continue;
        const root = match[1] === 'media' ? dreamStore.mediaDirectory! : path.join(appRoot, 'src/assets/images');
        const mime = mimeTypes[path.extname(match[2])];
        if (!mime) throw new Error('Unsupported archive media type.');
        const bytes = await readFile(path.join(root, match[2]));
        entry[field] = `data:${mime};base64,${bytes.toString('base64')}`;
      }
      size += Buffer.byteLength(JSON.stringify(entry));
      if (size > 48 * 1024 * 1024) return res.status(413).json({ error: '档案超过 48 MB，请直接备份整个 data 文件夹（包含全部录音和图片）。' });
      entries.push(entry);
    }
    res.attachment(`oneiros-backup-${new Date().toISOString().slice(0, 10)}.json`);
    res.json({ version: 1, exportedAt: new Date().toISOString(), dreams: entries });
  } catch { res.status(500).json({ error: 'Could not export all archive media. Back up the data folder directly.' }); }
});

// Persistent archive API. The first browser can move its old localStorage archive to the server.
app.get('/api/dreams', async (req, res) => {
  const { dreamStore, aiConfig } = archiveContext(res);
  const { textProvider, mediaProvider, textModel, imageModel, transcriptionModel } = aiConfig;
  const allowedChatModels = new Set(aiConfig.chatModels.map(({ id }) => id));
  try {
    if (dreamStore.listPage) {
      const offset = Number(req.query.offset || 0), limit = Number(req.query.limit || 20);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) return res.status(400).json({ error: 'Invalid archive page.' });
      return res.json(await dreamStore.listPage({ offset, limit }));
    }
    res.json({ dreams: await dreamStore.list() });
  } catch (error) {
    console.error('Reading the dream archive failed:', error);
    res.status(500).json({ error: 'Could not read the dream archive.' });
  }
});

app.get('/api/dreams/:id', async (req, res) => {
  const { dreamStore, aiConfig } = archiveContext(res);
  const { textProvider, mediaProvider, textModel, imageModel, transcriptionModel } = aiConfig;
  const allowedChatModels = new Set(aiConfig.chatModels.map(({ id }) => id));
  try {
    const dream = dreamStore.get ? await dreamStore.get(req.params.id) : (await dreamStore.list()).find((entry) => entry.id === req.params.id);
    if (!dream) return res.status(404).json({ error: 'Dream entry was not found.' });
    res.json({ dream });
  } catch { res.status(500).json({ error: 'Could not read the dream archive.' }); }
});

app.post('/api/dreams/import', async (req, res) => {
  const { dreamStore, aiConfig } = archiveContext(res);
  const { textProvider, mediaProvider, textModel, imageModel, transcriptionModel } = aiConfig;
  const allowedChatModels = new Set(aiConfig.chatModels.map(({ id }) => id));
  const entries = req.body?.dreams;
  if (!Array.isArray(entries) || entries.length > 500) return res.status(400).json({ error: 'Import no more than 500 dreams at a time.' });
  const dreams = entries.map(parseDream);
  if (dreams.some((entry) => !entry)) return res.status(400).json({ error: 'The archive contains invalid dream entries. Your original file has not been changed.' });
  try { res.json(dreamStore.importBatch ? await dreamStore.importBatch(dreams as DreamEntry[]) : await dreamStore.importDreams(dreams as DreamEntry[])); }
  catch (error) { sendStorageError(res, error, 'Could not import the archive.'); }
});

app.put('/api/dreams/:id', async (req, res) => {
  const { dreamStore, aiConfig } = archiveContext(res);
  const { textProvider, mediaProvider, textModel, imageModel, transcriptionModel } = aiConfig;
  const allowedChatModels = new Set(aiConfig.chatModels.map(({ id }) => id));
  const dream = parseDream(req.body);
  if (!dream || dream.id !== req.params.id) return res.status(400).json({ error: 'Dream entry is invalid or its ID does not match.' });
  try {
    const updated = await dreamStore.update(req.params.id, dream);
    if (!updated) return res.status(404).json({ error: 'Dream entry was not found.' });
    res.json({ dream: updated });
  } catch (error) { sendStorageError(res, error, 'Could not update the dream.'); }
});

app.delete('/api/dreams/:id', async (req, res) => {
  const { dreamStore, aiConfig } = archiveContext(res);
  const { textProvider, mediaProvider, textModel, imageModel, transcriptionModel } = aiConfig;
  const allowedChatModels = new Set(aiConfig.chatModels.map(({ id }) => id));
  try {
    const removed = await dreamStore.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Dream entry was not found.' });
    res.json({ deleted: true });
  } catch { res.status(500).json({ error: 'Could not delete the dream.' }); }
});

app.post('/api/dreams/bootstrap', async (req, res) => {
  const { dreamStore, aiConfig } = archiveContext(res);
  const { textProvider, mediaProvider, textModel, imageModel, transcriptionModel } = aiConfig;
  const allowedChatModels = new Set(aiConfig.chatModels.map(({ id }) => id));
  const initialDreams = req.body?.dreams;
  if (!Array.isArray(initialDreams) || initialDreams.length > 500) {
    return res.status(400).json({ error: 'Provide an archive with no more than 500 dreams.' });
  }

  const dreams = initialDreams.map(parseDream);
  if (dreams.some((dream) => dream === null)) {
    return res.status(400).json({ error: 'The archive contains a dream with invalid fields.' });
  }

  try {
    const result = dreamStore.bootstrapBatch ? await dreamStore.bootstrapBatch(dreams as DreamEntry[]) : await dreamStore.bootstrap(dreams as DreamEntry[]);
    res.status(result.imported ? 201 : 200).json(result);
  } catch (error) {
    sendStorageError(res, error, 'Could not import the dream archive.');
  }
});

app.post('/api/dreams', async (req, res) => {
  const { dreamStore, aiConfig } = archiveContext(res);
  const { textProvider, mediaProvider, textModel, imageModel, transcriptionModel } = aiConfig;
  const allowedChatModels = new Set(aiConfig.chatModels.map(({ id }) => id));
  const dream = parseDream(req.body);
  if (!dream) return res.status(400).json({ error: 'Dream entry is missing required fields.' });

  try {
    const savedDream = await dreamStore.create(dream);
    res.status(201).json({ dream: savedDream });
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? Number(error.status)
      : 500;
    if (status === 409) return res.status(409).json({ error: 'This dream has already been saved.' });
    sendStorageError(res, error, 'Could not save the dream.');
  }
});

app.patch('/api/dreams/:id/chat', async (req, res) => {
  const { dreamStore, aiConfig } = archiveContext(res);
  const { textProvider, mediaProvider, textModel, imageModel, transcriptionModel } = aiConfig;
  const allowedChatModels = new Set(aiConfig.chatModels.map(({ id }) => id));
  const chatHistory = parseChatHistory(req.body?.chatHistory);
  if (!chatHistory) return res.status(400).json({ error: 'Chat history is invalid or too long.' });

  try {
    const dream = await dreamStore.updateChatHistory(req.params.id, chatHistory);
    if (!dream) return res.status(404).json({ error: 'Dream entry was not found.' });
    res.json({ dream });
  } catch (error) {
    sendStorageError(res, error, 'Could not save the chat history.');
  }
});

// Audio transcription endpoint.
app.post('/api/transcribe', async (req, res) => {
  const { dreamStore, aiConfig } = archiveContext(res);
  const { textProvider, mediaProvider, textModel, imageModel, transcriptionModel } = aiConfig;
  const allowedChatModels = new Set(aiConfig.chatModels.map(({ id }) => id));
  let { audioBase64, mimeType } = req.body ?? {};
  if (runtime) {
    try {
      const audio = await dreamStore.readOwnedAudio!(req.body?.audioPath);
      audioBase64 = audio.bytes.toString('base64'); mimeType = audio.mimeType;
    } catch { return res.status(400).json({ error: '录音不存在、超出大小限制，或不属于当前账号。请重新上传。' }); }
  }
  if (!isString(audioBase64, 28_000_000) || !audioBase64.trim()) {
    return res.status(400).json({ error: 'Audio data is required.' });
  }
  const cleanMime = typeof mimeType === 'string' ? mimeType.split(';')[0].toLowerCase() : 'audio/webm';
  if (!['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/m4a'].includes(cleanMime)) {
    return res.status(400).json({ error: 'Audio MIME type is invalid.' });
  }

  const cleanBase64 = audioBase64.includes(',') ? audioBase64.split(',').pop()! : audioBase64;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64) || Buffer.from(cleanBase64, 'base64').length > 20 * 1024 * 1024) {
    return res.status(400).json({ error: 'Provide valid base64 audio up to 20 MB.' });
  }
  try {
    let transcript: string;
    if (mediaProvider === 'dashscope') {
      transcript = await dashscopeTranscribe({ model: transcriptionModel, audioBase64: cleanBase64, mimeType: cleanMime });
    } else {
      const response = await getAiClient().interactions.create({
        model: transcriptionModel,
        input: [{ type: 'audio', mime_type: cleanMime, data: cleanBase64 }],
        generation_config: { transcription_config: { mode: { type: 'verbatim' } } },
      });
      transcript = response.output_text || '';
    }
    if (!transcript.trim()) throw new Error('Transcription returned no spoken text.');
    res.json({ transcript: transcript.trim() });
  } catch (error) {
    sendAiError(res, 'transcription', error);
  }
});

// Structured Jungian interpretation endpoint.
app.post('/api/interpret', async (req, res) => {
  const { dreamStore, aiConfig } = archiveContext(res);
  const { textProvider, mediaProvider, textModel, imageModel, transcriptionModel } = aiConfig;
  const allowedChatModels = new Set(aiConfig.chatModels.map(({ id }) => id));
  const { transcript, emotionalNotes } = req.body ?? {};
  if (!isString(transcript, 30_000) || !transcript.trim()) {
    return res.status(400).json({ error: 'Dream transcript is required (maximum 30,000 characters).' });
  }
  if (emotionalNotes !== undefined && !isString(emotionalNotes, 4_000)) {
    return res.status(400).json({ error: 'Dream notes must be 4,000 characters or fewer.' });
  }

  const promptText = `Analyze the following morning dream transcript according to Carl Jung's depth psychology and psychoanalytic archetype theory.
Also create a prompt for generating a museum-grade surrealist painting representing the dream's core emotional theme.

Dream Transcript:
"""
${transcript}
"""
${emotionalNotes ? `Dreamer's Initial Feeling / Notes: "${emotionalNotes}"` : ''}

Provide a comprehensive, structured psychoanalytic synthesis. Use the same language as the dream transcript for all analysis fields; write the image prompt in English. Frame interpretations as possibilities for reflection, not diagnoses.`;

  try {
    const systemInstruction = `You are a careful Jungian dream reflection assistant and surrealist art curator.
Explore possible personal associations alongside archetypal motifs. Do not present symbolic meanings as universal facts, and do not provide medical, psychiatric, or diagnostic advice.`;
    let responseText: string;
    if (textProvider === 'deepseek') {
      responseText = await deepseekText({
        model: textModel, json: true,
        messages: [
          { role: 'system', content: `${systemInstruction}
Return only a valid JSON object with exactly this structure. All fields are required; archetypes and symbols should include relevant observations. Keep surrealistImagePrompt under 700 English characters.
{"title":"poetic title","coreTheme":"possible emotional theme","unconsciousTension":"possible tension","dominantMood":"mood","archetypes":[{"name":"name","description":"possible meaning","appearanceInDream":"how it appears"}],"symbols":[{"symbol":"symbol","archetypalMeaning":"possible association","personalReflectionPrompt":"personal reflection question"}],"individuationGuidance":"grounded exercise","surrealistImagePrompt":"surrealist painting prompt in English"}` },
          { role: 'user', content: promptText },
        ],
      });
    } else {
    const response = await getAiClient().models.generateContent({
      model: textModel,
      contents: promptText,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'A poetic, evocative title for the dream.' },
            coreTheme: { type: Type.STRING, description: 'A possible central emotional theme and conflict.' },
            unconsciousTension: { type: Type.STRING, description: 'Possible tension between conscious concerns and the dream imagery.' },
            dominantMood: { type: Type.STRING, description: 'The primary emotional atmosphere.' },
            archetypes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  description: { type: Type.STRING },
                  appearanceInDream: { type: Type.STRING },
                },
                required: ['name', 'description', 'appearanceInDream'],
              },
            },
            symbols: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  symbol: { type: Type.STRING },
                  archetypalMeaning: { type: Type.STRING },
                  personalReflectionPrompt: { type: Type.STRING },
                },
                required: ['symbol', 'archetypalMeaning', 'personalReflectionPrompt'],
              },
            },
            individuationGuidance: { type: Type.STRING, description: 'A grounded active imagination or waking-life reflection exercise.' },
            surrealistImagePrompt: { type: Type.STRING, description: 'A detailed surrealist oil painting prompt representing the dream.' },
          },
          required: [
            'title', 'coreTheme', 'unconsciousTension', 'dominantMood',
            'archetypes', 'symbols', 'individuationGuidance', 'surrealistImagePrompt',
          ],
        },
      },
    });
    responseText = response.text || '{}';
    }

    const interpretation = parseInterpretation(JSON.parse(responseText));
    // Archive drafts allow empty fields; generated analyses must contain usable text.
    if (!interpretation || [
      interpretation.title, interpretation.coreTheme, interpretation.unconsciousTension,
      interpretation.dominantMood, interpretation.individuationGuidance, interpretation.surrealistImagePrompt,
      ...interpretation.archetypes.flatMap(({ name, description, appearanceInDream }) => [name, description, appearanceInDream]),
      ...interpretation.symbols.flatMap(({ symbol, archetypalMeaning, personalReflectionPrompt }) => [symbol, archetypalMeaning, personalReflectionPrompt]),
    ].some((field) => !field.trim())) {
      return res.status(502).json({ error: 'AI returned an incomplete interpretation. Your draft is still available; please retry.' });
    }
    res.json(interpretation);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error('AI returned invalid JSON for dream interpretation.');
      return res.status(502).json({ error: 'AI returned an unreadable interpretation. Please try again.' });
    }
    sendAiError(res, 'interpretation', error);
  }
});

// Generate artwork and save it on the server so it remains available after a restart.
app.post('/api/generate-image', async (req, res) => {
  const { dreamStore, aiConfig } = archiveContext(res);
  const { textProvider, mediaProvider, textModel, imageModel, transcriptionModel } = aiConfig;
  const allowedChatModels = new Set(aiConfig.chatModels.map(({ id }) => id));
  const { prompt, imageSize = aiConfig.imageOptions.resolutions[0], aspectRatio = '1:1' } = req.body ?? {};
  if (!isString(prompt, 20_000) || !prompt.trim()) {
    return res.status(400).json({ error: 'Image prompt is required (maximum 20,000 characters).' });
  }
  if (!aiConfig.imageOptions.resolutions.includes(imageSize) || !aiConfig.imageOptions.aspectRatios.includes(aspectRatio)) {
    return res.status(400).json({ error: 'Unsupported image size or aspect ratio.' });
  }
  const selectedSize = imageSize;
  const selectedRatio = aspectRatio;
  const styledPrompt = `${prompt}. Museum-quality classic surrealist oil painting, metaphysical horizon, dream lighting, symbolic juxtaposition, uncanny poetry, and atmospheric depth.`;

  try {
    if (mediaProvider === 'dashscope') {
      const image = await dashscopeImage({ model: imageModel, prompt: styledPrompt, aspectRatio: selectedRatio });
      const imageUrl = await dreamStore.saveGeneratedImage(image.base64, image.mimeType);
      return res.json({ imageUrl: dreamStore.signMediaPath ? await dreamStore.signMediaPath(imageUrl) : imageUrl, ...(runtime ? { imagePath: imageUrl } : {}), imageSize: selectedSize, aspectRatio: selectedRatio, width: image.width, height: image.height });
    }
    const ai = getAiClient();
    const interaction = await ai.interactions.create({
      model: imageModel,
      input: styledPrompt,
      response_format: {
        type: 'image',
        aspect_ratio: selectedRatio,
        image_size: selectedSize,
      },
    });
    const image = interaction.output_image;
    if (!image?.data) throw new Error('The image model returned no image.');

    const mimeType = image.mime_type || 'image/png';
    const imageUrl = await dreamStore.saveGeneratedImage(image.data, mimeType);
    res.json({ imageUrl: dreamStore.signMediaPath ? await dreamStore.signMediaPath(imageUrl) : imageUrl, ...(runtime ? { imagePath: imageUrl } : {}), imageSize: selectedSize, aspectRatio: selectedRatio });
  } catch (error) {
    sendAiError(res, 'image generation', error);
  }
});

// Multi-turn dream-symbol dialogue.
app.post('/api/chat-symbol', async (req, res) => {
  const { dreamStore, aiConfig } = archiveContext(res);
  const { textProvider, mediaProvider, textModel, imageModel, transcriptionModel } = aiConfig;
  const allowedChatModels = new Set(aiConfig.chatModels.map(({ id }) => id));
  const { messages, dreamContext, modelName } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 100) {
    return res.status(400).json({ error: 'Provide between 1 and 100 chat messages.' });
  }
  if (!messages.every((message) =>
    isRecord(message) &&
    ['user', 'model', 'assistant'].includes(String(message.role)) &&
    isString(message.content, message.role === 'user' ? 8_000 : 20_000)
  )) return res.status(400).json({ error: 'A chat message is invalid.' });

  const chosenModel = typeof modelName === 'string' && allowedChatModels.has(modelName)
    ? modelName
    : textModel;
  const context = isRecord(dreamContext) ? dreamContext : {};
  const systemInstruction = `You are a thoughtful Jungian dream reflection assistant.
Explore the user's associations and the dream's imagery as possibilities, not diagnoses. Do not offer medical, psychiatric, or diagnostic advice. Respond in the user's language. Keep the final answer under 8,000 characters. End with a question or short active imagination prompt.

Dream entry:
- Title: ${String(context.title || 'Recorded Dream').slice(0, 300)}
- Transcript: ${String(context.transcript || '').slice(0, 12_000)}
- Core theme: ${String(context.coreTheme || '').slice(0, 2_000)}
- Unconscious tension: ${String(context.unconsciousTension || '').slice(0, 2_000)}
- Archetypes: ${JSON.stringify(context.archetypes || []).slice(0, 4_000)}
- Symbols: ${JSON.stringify(context.symbols || []).slice(0, 4_000)}`;

  try {
    if (textProvider === 'deepseek') {
      const reply = await deepseekText({
        model: chosenModel,
        messages: [{ role: 'system', content: systemInstruction }, ...messages.map((message: { role: string; content: string }) => ({
          role: message.role === 'user' ? 'user' as const : 'assistant' as const, content: message.content,
        }))],
      });
      return res.json({ reply, modelUsed: chosenModel });
    }
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: chosenModel,
      contents: messages.map((message: { role: string; content: string }) => ({
        role: message.role === 'model' || message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
      config: { systemInstruction },
    });
    if (!response.text?.trim()) throw new Error('The chat model returned an empty response.');
    res.json({ reply: response.text.trim(), modelUsed: chosenModel });
  } catch (error) {
    sendAiError(res, 'symbol chat', error);
  }
});


if (!runtime) app.use('/media', express.static(localContext!.dreamStore.mediaDirectory!, { maxAge: '1y', immutable: true, fallthrough: false }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = error?.type === 'entity.too.large' ? 413 : error?.status === 404 ? 404 : error instanceof SyntaxError ? 400 : 500;
  res.status(status).json({ error: status === 413 ? (runtime ? '上传内容过大，请通过页面将录音和图片直传到私有存储。' : 'Request exceeds the 50 MB upload limit.') : status === 400 ? 'Invalid JSON request body.' : status === 404 ? 'Resource not found.' : 'The server could not complete this request.' });
});
return app;
}
