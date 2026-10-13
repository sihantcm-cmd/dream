import { inflateSync } from 'node:zlib';
import { Agent } from 'undici';

type Provider = 'deepseek' | 'dashscope';

export type AiProviderErrorCode =
  | 'AI_NOT_CONFIGURED' | 'AI_CONFIGURATION_INVALID' | 'AI_KEY_INVALID'
  | 'AI_QUOTA_EXCEEDED' | 'AI_ACCESS_DENIED' | 'AI_MODEL_UNAVAILABLE'
  | 'AI_CONTENT_BLOCKED' | 'AI_CONNECTION_FAILED' | 'AI_INVALID_RESPONSE'
  | 'AI_INVALID_AUDIO' | 'AI_RESPONSE_TOO_LARGE' | 'AI_IMAGE_DOWNLOAD_FAILED'
  | 'PROVIDER_ERROR';

// Never retain a provider's raw error text: it can echo credentials or dream text.
export class AiProviderError extends Error {
  constructor(
    public readonly provider: Provider,
    public readonly code: AiProviderErrorCode,
    public readonly status = 502,
  ) {
    super(`${provider}: ${code}`);
    this.name = 'AiProviderError';
  }
}

export interface TextMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_AUDIO_BASE64_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 150_000;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 25_000;
// Native fetch otherwise has a separate five-minute header timeout, even when
// its AbortSignal allows a longer generation. Reuse this dispatcher per module.
const providerDispatcher = new Agent({ headersTimeout: 600_000, bodyTimeout: 600_000 });
const IMAGE_DIMENSIONS = {
  '1:1': [1328, 1328],
  '4:3': [1472, 1104],
  '16:9': [1664, 928],
} as const;
const HIGH_QUALITY_IMAGE_DIMENSIONS = {
  '1:1': [2048, 2048],
  '4:3': [2304, 1728],
  '16:9': [2688, 1512],
} as const;

function isQwenImage3(model: string) {
  return model === 'qwen-image-3.0-pro' || model === 'qwen-image-3.0';
}

export function getImageDimensions(model: string): Record<keyof typeof IMAGE_DIMENSIONS, readonly [number, number]> {
  return isQwenImage3(model) ? HIGH_QUALITY_IMAGE_DIMENSIONS : IMAGE_DIMENSIONS;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keyFor(provider: Provider) {
  const name = provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'DASHSCOPE_API_KEY';
  const key = process.env[name]?.trim();
  if (!key || key === `MY_${name}`) throw new AiProviderError(provider, 'AI_NOT_CONFIGURED', 503);
  return key;
}

function dashscopeOrigin() {
  const workspaceId = process.env.DASHSCOPE_WORKSPACE_ID?.trim();
  if (!workspaceId) return 'https://dashscope.aliyuncs.com';
  // Only an ID is configurable; credentials can never be directed to an arbitrary URL.
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(workspaceId)) {
    throw new AiProviderError('dashscope', 'AI_CONFIGURATION_INVALID', 503);
  }
  return `https://${workspaceId}.cn-beijing.maas.aliyuncs.com`;
}

function providerFailure(provider: Provider, status: number, body: unknown): AiProviderError {
  const error = record(body) && record(body.error) ? body.error : body;
  const detail = record(error)
    ? `${typeof error.code === 'string' ? error.code : ''} ${typeof error.message === 'string' ? error.message : ''}`.toLowerCase()
    : '';
  let code: AiProviderErrorCode = 'PROVIDER_ERROR';
  if (status === 401 || /invalid.?api.?key|authentication|unauthorized/.test(detail)) code = 'AI_KEY_INVALID';
  else if (status === 402 || status === 429 || /quota|balance|insufficient|rate.?limit|throttl/.test(detail)) code = 'AI_QUOTA_EXCEEDED';
  else if (/datainspectionfailed|content.?filter|content.?policy|inappropriatecontent|safety/.test(detail)) code = 'AI_CONTENT_BLOCKED';
  else if (status === 403 || /access.?denied|permission/.test(detail)) code = 'AI_ACCESS_DENIED';
  else if (status === 404 || /model.*(?:not.?found|not.?support|unavailable)/.test(detail)) code = 'AI_MODEL_UNAVAILABLE';
  return new AiProviderError(provider, code, status >= 400 ? status : 502);
}

async function readLimitedBody(response: Response, limit: number, provider: Provider): Promise<Buffer> {
  const advertisedLength = Number(response.headers.get('content-length'));
  if (advertisedLength > limit) {
    await response.body?.cancel();
    throw new AiProviderError(provider, 'AI_RESPONSE_TOO_LARGE');
  }
  if (!response.body) throw new AiProviderError(provider, 'AI_INVALID_RESPONSE');
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new AiProviderError(provider, 'AI_RESPONSE_TOO_LARGE');
      }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts, length);
}

async function postJson(
  provider: Provider,
  url: string,
  body: unknown,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const apiKey = keyFor(provider);
  try {
    // A single submission avoids unexpectedly paying twice after a network timeout.
    const requestOptions: RequestInit & { dispatcher: Agent } = {
      method: 'POST',
      headers: {
        ...options.headers,
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
      redirect: 'error',
      dispatcher: providerDispatcher,
    };
    const response = await fetch(url, requestOptions);
    const bytes = await readLimitedBody(response, MAX_JSON_BYTES, provider);
    let result: unknown;
    try { result = JSON.parse(bytes.toString('utf8')); }
    catch {
      if (!response.ok) throw providerFailure(provider, response.status, null);
      throw new AiProviderError(provider, 'AI_INVALID_RESPONSE');
    }
    if (!response.ok || (record(result) && (result.error || result.code))) {
      throw providerFailure(provider, response.status, result);
    }
    if (!record(result)) throw new AiProviderError(provider, 'AI_INVALID_RESPONSE');
    return result;
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError(provider, 'AI_CONNECTION_FAILED');
  }
}

function completionText(result: Record<string, unknown>, provider: Provider) {
  const choice = Array.isArray(result.choices) ? result.choices[0] : null;
  if (!record(choice) || !record(choice.message)) throw new AiProviderError(provider, 'AI_INVALID_RESPONSE');
  if (choice.finish_reason === 'content_filter') throw new AiProviderError(provider, 'AI_CONTENT_BLOCKED');
  if (choice.finish_reason === 'length') throw new AiProviderError(provider, 'AI_INVALID_RESPONSE');
  const content = choice.message.content;
  if (typeof content !== 'string' || !content.trim()) throw new AiProviderError(provider, 'AI_INVALID_RESPONSE');
  return content.trim();
}

export function getDeepseekReasoningEffort(): 'none' | 'low' | 'high' | 'max' {
  const effort = process.env.DEEPSEEK_REASONING_EFFORT || 'max';
  if (!['none', 'low', 'high', 'max'].includes(effort)) {
    throw new AiProviderError('deepseek', 'AI_CONFIGURATION_INVALID', 503);
  }
  return effort as 'none' | 'low' | 'high' | 'max';
}

export async function deepseekText(options: {
  model: string;
  messages: TextMessage[];
  json?: boolean;
}): Promise<string> {
  const effort = getDeepseekReasoningEffort();
  const thinking = effort !== 'none';
  const result = await postJson('deepseek', 'https://api.deepseek.com/chat/completions', {
    model: options.model,
    messages: options.messages,
    stream: false,
    thinking: { type: thinking ? 'enabled' : 'disabled' },
    ...(thinking ? { reasoning_effort: effort } : {}),
    max_tokens: thinking ? 65536 : options.json ? 8192 : 4096,
    ...(options.json ? { response_format: { type: 'json_object' } } : {}),
  }, { timeoutMs: thinking ? 600_000 : REQUEST_TIMEOUT_MS });
  const text = completionText(result, 'deepseek');
  // Match the archive's per-message limit; only the final answer is persisted.
  if (!options.json && text.length > 20_000) throw new AiProviderError('deepseek', 'AI_RESPONSE_TOO_LARGE');
  return text;
}

function validateWav(base64: string, mimeType: string) {
  const invalid = () => new AiProviderError('dashscope', 'AI_INVALID_AUDIO', 400);
  if (!['audio/wav', 'audio/x-wav'].includes(mimeType.toLowerCase())
      || base64.length > MAX_AUDIO_BASE64_BYTES
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw invalid();
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.toString('base64') !== base64 || bytes.length < 44
      || bytes.toString('ascii', 0, 4) !== 'RIFF'
      || bytes.toString('ascii', 8, 12) !== 'WAVE') throw invalid();
  const riffEnd = bytes.readUInt32LE(4) + 8;
  if (riffEnd > bytes.length || riffEnd < 44) throw invalid();
  let byteRate = 0;
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= riffEnd;) {
    const type = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > riffEnd) throw invalid();
    if (type === 'fmt ') {
      if (size < 16) throw invalid();
      const format = bytes.readUInt16LE(start);
      const channels = bytes.readUInt16LE(start + 2);
      const sampleRate = bytes.readUInt32LE(start + 4);
      byteRate = bytes.readUInt32LE(start + 8);
      const blockAlign = bytes.readUInt16LE(start + 12);
      const bitDepth = bytes.readUInt16LE(start + 14);
      if (format !== 1 || ![1, 2].includes(channels) || bitDepth !== 16
          || sampleRate < 8000 || sampleRate > 48000 || blockAlign !== channels * 2
          || byteRate !== sampleRate * blockAlign) throw invalid();
    }
    if (type === 'data') dataSize += size;
    offset = start + size + (size % 2);
  }
  // The UI converts recordings to PCM WAV and caps a transcription at three minutes.
  if (!byteRate || !dataSize || dataSize / byteRate > 180) throw invalid();
}

export async function dashscopeTranscribe(options: {
  model: string;
  audioBase64: string;
  mimeType: string;
}): Promise<string> {
  keyFor('dashscope');
  validateWav(options.audioBase64, options.mimeType);
  const messages = [{
    role: 'user',
    content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${options.audioBase64}` } }],
  }];
  if (/^qwen-audio-3\.[01]-asr-flash(?:-\d{4}-\d{2}-\d{2})?$/.test(options.model)) {
    const result = await postJson('dashscope', `${dashscopeOrigin()}/api/v1/services/aigc/multimodal-generation/generation`, {
      model: options.model,
      input: { messages },
      // WAV contains its sample rate; do not mislabel valid uploads that are not 16 kHz.
      parameters: { format: 'wav' },
    }, { headers: { 'X-DashScope-SSE': 'disable' } });
    const text = record(result.output) ? result.output.text : undefined;
    if (typeof text !== 'string' || !text.trim()) throw new AiProviderError('dashscope', 'AI_INVALID_RESPONSE');
    return text.trim();
  }
  const result = await postJson('dashscope', `${dashscopeOrigin()}/compatible-mode/v1/chat/completions`, {
    model: options.model,
    messages,
    stream: false,
    asr_options: { enable_itn: false },
  });
  return completionText(result, 'dashscope');
}

function validatedImageUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new AiProviderError('dashscope', 'AI_IMAGE_DOWNLOAD_FAILED'); }
  // Qwen returns a signed OSS URL. Do not follow a compromised response to local services.
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
      || !/^[a-z0-9][a-z0-9.-]*\.oss-[a-z0-9-]+\.aliyuncs\.com$/i.test(url.hostname)
      || /-internal\.aliyuncs\.com$/i.test(url.hostname)) {
    throw new AiProviderError('dashscope', 'AI_IMAGE_DOWNLOAD_FAILED');
  }
  return url;
}

function pngDimensions(bytes: Buffer) {
  const invalid = () => new AiProviderError('dashscope', 'AI_INVALID_RESPONSE');
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw invalid();
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096 || width * height > 2048 * 2048) throw invalid();
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  const allowedDepths = colorType === 0 ? [1, 2, 4, 8, 16] : colorType === 3 ? [1, 2, 4, 8] : [8, 16];
  if (!channels || !allowedDepths.includes(bitDepth) || bytes[26] || bytes[27] || bytes[28] > 1) throw invalid();
  const compressed: Buffer[] = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const next = offset + 12 + size;
    if (next > bytes.length) throw invalid();
    if (type === 'IDAT' && size) compressed.push(bytes.subarray(offset + 8, offset + 8 + size));
    if (type === 'IEND') {
      if (size || next !== bytes.length || !compressed.length) throw invalid();
      // Verify the compressed pixel data as well as the container. Bound expansion
      // by the dimensions so a malformed upstream file cannot become a zip bomb.
      const passes = bytes[28] === 0 ? [[0, 0, 1, 1]] : [
        [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
        [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
      ];
      const rows = passes.flatMap(([x, y, dx, dy]) => {
        const passWidth = Math.max(0, Math.ceil((width - x) / dx));
        const passHeight = Math.max(0, Math.ceil((height - y) / dy));
        return passWidth ? Array(passHeight).fill(1 + Math.ceil(passWidth * channels * bitDepth / 8)) as number[] : [];
      });
      const expectedBytes = rows.reduce((sum, row) => sum + row, 0);
      let pixels: Buffer;
      try { pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: expectedBytes }); }
      catch { throw invalid(); }
      if (pixels.length !== expectedBytes) throw invalid();
      let rowOffset = 0;
      for (const rowBytes of rows) {
        if (pixels[rowOffset] > 4) throw invalid();
        rowOffset += rowBytes;
      }
      return { width, height };
    }
    offset = next;
  }
  throw invalid();
}

async function downloadImage(value: string) {
  let url = validatedImageUrl(value);
  const signal = AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS);
  try {
    for (let redirect = 0; redirect <= 3; redirect++) {
      // Deliberately no provider Authorization header on storage downloads.
      const response = await fetch(url, { signal, redirect: 'manual', headers: { Accept: 'image/png' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirect === 3) throw new AiProviderError('dashscope', 'AI_IMAGE_DOWNLOAD_FAILED');
        url = validatedImageUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new AiProviderError('dashscope', 'AI_IMAGE_DOWNLOAD_FAILED');
      }
      const bytes = await readLimitedBody(response, MAX_IMAGE_BYTES, 'dashscope');
      const dimensions = pngDimensions(bytes);
      return { base64: bytes.toString('base64'), mimeType: 'image/png', ...dimensions };
    }
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError('dashscope', 'AI_IMAGE_DOWNLOAD_FAILED');
  }
  throw new AiProviderError('dashscope', 'AI_IMAGE_DOWNLOAD_FAILED');
}

export async function dashscopeImage(options: {
  model: string;
  prompt: string;
  aspectRatio: keyof typeof IMAGE_DIMENSIONS;
}): Promise<{ base64: string; mimeType: string; width: number; height: number }> {
  const dimensions = getImageDimensions(options.model)[options.aspectRatio];
  if (!dimensions) throw new AiProviderError('dashscope', 'AI_CONFIGURATION_INVALID', 400);
  const enhanced = isQwenImage3(options.model);
  const result = await postJson('dashscope', `${dashscopeOrigin()}/api/v1/services/aigc/multimodal-generation/generation`, {
    model: options.model,
    input: { messages: [{ role: 'user', content: [{ text: options.prompt }] }] },
    parameters: {
      size: dimensions.join('*'), n: 1, watermark: false,
      ...(enhanced
        ? { prompt_extend: true, prompt_extend_mode: 'agent', enable_thinking: true }
        : { prompt_extend: false }),
    },
  }, { timeoutMs: enhanced ? 600_000 : REQUEST_TIMEOUT_MS });
  const choices = record(result.output) && Array.isArray(result.output.choices) ? result.output.choices : [];
  const choice = choices[0];
  const content = record(choice) && record(choice.message) && Array.isArray(choice.message.content) ? choice.message.content : [];
  const image = content.find((part: unknown) => record(part) && typeof part.image === 'string');
  if (!record(image) || typeof image.image !== 'string') throw new AiProviderError('dashscope', 'AI_INVALID_RESPONSE');
  return downloadImage(image.image);
}
