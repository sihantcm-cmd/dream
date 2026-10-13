import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { Agent } from 'undici';

// An explicitly invoked live check. No dotenv loading, API credentials, mocks,
// external URLs, or automatic retries belong in this script.
const appRoot = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = path.join(appRoot, 'data', 'ai-verification');
const stageNames = ['transcribe', 'interpret', 'image', 'chat'];
const labels = { transcribe: '转写', interpret: '梦境解读', image: '绘图', chat: '对话' };
const chatQuestion = '这是合成语音验收样例。请用中文简短回应：蓝色的门和海洋可以引导我思考哪些个人联想？';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
let report;
let reportPath;
let baseUrl;
let imageOptions;
let expectedImageDimensions;
let stageTimeoutMs = 180_000;
let aiDispatcher;
const usedCache = new Set();

function getOptions() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--audio' || !args[1]) {
    throw new Error('用法：node scripts/verify-ai.mjs --audio <合成测试音频路径>');
  }
  const parsed = new URL(process.env.ONEIROS_BASE_URL || 'http://127.0.0.1:3000');
  if (!['http:', 'https:'].includes(parsed.protocol) ||
      !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
      parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('ONEIROS_BASE_URL 必须是无凭据、查询参数或子路径的 localhost/127.0.0.1 地址。');
  }
  return { audioPath: path.resolve(args[1]), baseUrl: parsed.origin };
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  // Be conservative even if a future local API includes credentials in errors.
  return message.replace(/AIza[\w-]+/g, '[redacted]')
    .replace(/\bsk-[A-Za-z0-9_.-]+/g, '[redacted]')
    .replace(/((?:api[_-]?key|authorization|token)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .slice(0, 600);
}

async function request(route, { method = 'GET', body, timeout = 20_000, allow404 = false, binary = false } = {}) {
  if (!route.startsWith('/') || route.startsWith('//')) throw new Error('Only local API paths are allowed.');
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
    dispatcher: aiDispatcher,
    redirect: 'error',
  });
  if (allow404 && response.status === 404) return null;
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(`${route}: HTTP ${response.status}${typeof details.error === 'string' ? ` — ${safeError(details.error)}` : ''}`);
  }
  if (binary) return { bytes: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get('content-type') || '' };
  return response.json();
}

async function saveReport() {
  report.updatedAt = new Date().toISOString();
  const temporaryPath = `${reportPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, reportPath);
}

function requireText(value, label) {
  assert.ok(typeof value === 'string' && value.trim(), `${label} must contain text.`);
}

function validateInterpretation(value) {
  for (const field of ['title', 'coreTheme', 'unconsciousTension', 'dominantMood', 'individuationGuidance', 'surrealistImagePrompt']) {
    requireText(value?.[field], `Interpretation.${field}`);
  }
  assert.ok(Array.isArray(value.archetypes) && Array.isArray(value.symbols), 'Interpretation must include archetypes and symbols.');
  for (const item of value.archetypes) {
    for (const field of ['name', 'description', 'appearanceInDream']) requireText(item?.[field], `Archetype.${field}`);
  }
  for (const item of value.symbols) {
    for (const field of ['symbol', 'archetypalMeaning', 'personalReflectionPrompt']) requireText(item?.[field], `Symbol.${field}`);
  }
}

async function readMedia(url) {
  assert.match(url || '', /^\/media\/[a-zA-Z0-9_.-]+$/, 'Expected a persisted local media URL.');
  return request(url, { binary: true });
}

async function validateImage(value) {
  assert.equal(value?.imageSize, imageOptions.imageSize);
  assert.equal(value?.aspectRatio, imageOptions.aspectRatio);
  const { bytes, mimeType } = await readMedia(value.imageUrl);
  assert.ok(bytes.length > 100, 'Generated image is empty or too small.');
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const isWebp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  assert.ok((isPng && mimeType.startsWith('image/png')) ||
    (isJpeg && mimeType.startsWith('image/jpeg')) || (isWebp && mimeType.startsWith('image/webp')),
  'Generated media must be a PNG, JPEG, or WebP with a matching content type.');
  if (isPng && expectedImageDimensions) {
    assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', 'PNG is missing its image header.');
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], expectedImageDimensions,
      'Generated PNG dimensions differ from the model’s advertised native resolution.');
  }
}

async function stage(name, body, validate) {
  const previous = report.stages[name];
  // Keep an acknowledged paid response even if a later media read fails. A
  // resume must revalidate it, never silently purchase another generation.
  if (previous?.result !== undefined) {
    try {
      await validate(previous.result);
      previous.status = 'passed';
      delete previous.error;
      usedCache.add(name);
      await saveReport();
      return previous.result;
    } catch (error) {
      previous.status = 'failed';
      previous.error = safeError(error);
      await saveReport();
      throw new Error(`${labels[name]}缓存校验失败，已保留结果且未重复调用 AI：${safeError(error)}`);
    }
  }
  const record = { status: 'running', startedAt: new Date().toISOString() };
  report.stages[name] = record;
  await saveReport();
  console.log(`${labels[name]}：正在调用本机 API（仅一次）…`);
  const started = performance.now();
  try {
    const route = { transcribe: '/api/transcribe', interpret: '/api/interpret', image: '/api/generate-image', chat: '/api/chat-symbol' }[name];
    record.result = await request(route, { method: 'POST', body, timeout: stageTimeoutMs });
    record.durationMs = Math.round(performance.now() - started);
    record.respondedAt = new Date().toISOString();
    await saveReport();
    await validate(record.result);
    record.status = 'passed';
    record.completedAt = new Date().toISOString();
    await saveReport();
    return record.result;
  } catch (error) {
    record.status = 'failed';
    record.durationMs ??= Math.round(performance.now() - started);
    record.error = safeError(error);
    await saveReport();
    throw error;
  }
}

async function persistDream(audio, mimeType, transcript, interpretation, image, chat) {
  const id = `ai-verification-${report.cacheKey.slice(0, 24)}`;
  const route = `/api/dreams/${id}`;
  const expected = {
    id, createdAt: report.createdAt,
    title: `【AI 功能验收·合成语音】${interpretation.title}`.slice(0, 300),
    transcript, emotionalNotes: '合成语音测试样例，仅用于验证转写、解读、绘图和对话，不代表用户的真实梦境。',
    status: 'complete', resolution: imageOptions.imageSize, aspectRatio: imageOptions.aspectRatio,
    imageUrl: image.imageUrl, imagePrompt: interpretation.surrealistImagePrompt,
    interpretation, chatHistory: [], audioUrl: `data:${mimeType};base64,${audio.toString('base64')}`,
  };
  report.persistence = { ...(report.persistence || {}), status: 'running', dreamId: id };
  await saveReport();
  let stored = await request(route, { allow404: true });
  if (!stored) stored = await request('/api/dreams', { method: 'POST', body: expected });
  assert.ok(stored?.dream, 'Saving the verification dream did not return a dream.');
  const compareDream = (dream) => {
    for (const field of ['id', 'title', 'transcript', 'emotionalNotes', 'status', 'resolution', 'aspectRatio', 'imageUrl', 'imagePrompt', 'interpretation']) {
      assert.ok(isDeepStrictEqual(dream[field], expected[field]), `Persisted ${field} does not match; existing data was not overwritten.`);
    }
  };
  compareDream(stored.dream);
  const userMessage = { role: 'user', content: chatQuestion, timestamp: report.stages.chat.startedAt };
  const modelMessage = { role: 'model', content: chat.reply, timestamp: report.stages.chat.respondedAt };
  const history = stored.dream.chatHistory;
  assert.ok(Array.isArray(history), 'Persisted chatHistory must be an array.');
  const alreadySaved = history.some((message, index) =>
    JSON.stringify(message) === JSON.stringify(userMessage) && JSON.stringify(history[index + 1]) === JSON.stringify(modelMessage));
  const expectedHistory = alreadySaved ? history : [...history, userMessage, modelMessage];
  if (!alreadySaved) await request(`${route}/chat`, { method: 'PATCH', body: { chatHistory: expectedHistory } });
  const confirmed = (await request(route)).dream;
  compareDream(confirmed);
  assert.ok(isDeepStrictEqual(confirmed.chatHistory, expectedHistory), 'Chat history did not survive the persistence round trip.');
  const storedAudio = await readMedia(confirmed.audioUrl);
  assert.equal(sha256(storedAudio.bytes), report.audioSha256, 'Persisted recording bytes differ from the supplied audio.');
  await validateImage(image);
  report.persistence = { status: 'passed', dreamId: id, confirmedAt: new Date().toISOString(), audioUrl: confirmed.audioUrl, imageUrl: confirmed.imageUrl };
  await saveReport();
}

async function main() {
  const options = getOptions();
  baseUrl = options.baseUrl;
  const health = await request('/api/health');
  assert.equal(health.aiConfigured, true, 'AI 尚未配置：先配置服务端 AI 密钥并重启，再运行验收。');
  for (const capability of ['transcribe', 'interpret', 'image', 'chat']) {
    assert.equal(health.capabilities?.[capability], true, `AI 功能 ${labels[capability]} 尚未配置；本次未发起任何付费调用。`);
  }
  const models = { text: health.textModel, image: health.imageModel, transcription: health.transcriptionModel };
  for (const [name, model] of Object.entries(models)) requireText(model, `Health ${name} model`);
  const providers = { text: health.textProvider, media: health.mediaProvider };
  for (const [name, provider] of Object.entries(providers)) requireText(provider, `Health ${name} provider`);
  const resolutions = health.imageOptions?.resolutions;
  const aspectRatios = health.imageOptions?.aspectRatios;
  assert.ok(Array.isArray(resolutions) && resolutions.length && Array.isArray(aspectRatios) && aspectRatios.length,
    'Health must advertise supported image options before a paid request.');
  imageOptions = {
    imageSize: resolutions.includes('native') ? 'native' : resolutions.includes('1K') ? '1K' : resolutions[0],
    aspectRatio: aspectRatios.includes('1:1') ? '1:1' : aspectRatios[0],
  };
  expectedImageDimensions = health.imageOptions?.dimensions?.[imageOptions.aspectRatio];
  if (expectedImageDimensions !== undefined) {
    assert.ok(Array.isArray(expectedImageDimensions) && expectedImageDimensions.length === 2 &&
      expectedImageDimensions.every((dimension) => Number.isInteger(dimension) && dimension > 0),
    'Health must advertise valid native image dimensions before a paid request.');
  }
  if (health.aiRequestTimeoutMs !== undefined) {
    assert.ok(Number.isInteger(health.aiRequestTimeoutMs) && health.aiRequestTimeoutMs > 0 && health.aiRequestTimeoutMs <= 3_600_000,
      'Health contains an invalid AI request timeout.');
    stageTimeoutMs = Math.max(stageTimeoutMs, health.aiRequestTimeoutMs + 30_000);
  }
  // Node's built-in fetch has a separate five-minute header timeout. Allow the
  // explicit request deadline to control long, high-quality image generations.
  aiDispatcher = new Agent({ headersTimeout: stageTimeoutMs + 30_000, bodyTimeout: stageTimeoutMs + 30_000 });
  const textReasoningEffort = health.textReasoningEffort ?? 'none';
  const audio = await readFile(options.audioPath);
  assert.ok(audio.length > 100 && audio.length <= 20 * 1024 * 1024, 'Supply a spoken audio fixture of more than 100 bytes and no more than 20 MB.');
  const mimeType = { '.wav': 'audio/wav', '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.mp4': 'audio/mp4', '.m4a': 'audio/mp4' }[path.extname(options.audioPath).toLowerCase()];
  assert.ok(mimeType, 'Unsupported audio file extension. Use WAV, WebM, Ogg, MP3, MP4, or M4A.');
  const audioSha256 = sha256(audio);
  const cacheKey = sha256(JSON.stringify({ version: 3, baseUrl, audioSha256, models, providers, textReasoningEffort, imageDimensions: expectedImageDimensions, ...imageOptions, chatQuestion }));
  await mkdir(outputDirectory, { recursive: true });
  reportPath = path.join(outputDirectory, `${cacheKey}.json`);
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.cacheKey, cacheKey, 'Verification cache signature mismatch.');
    assert.ok(report.stages && report.createdAt, 'Verification cache is incomplete.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    report = { version: 3, cacheKey, baseUrl, audioSha256, audioFile: options.audioPath, models, providers, textReasoningEffort, imageOptions, imageDimensions: expectedImageDimensions, createdAt: new Date().toISOString(), stages: {} };
    await saveReport();
  }
  const transcribed = await stage('transcribe', { audioBase64: audio.toString('base64'), mimeType },
    (value) => requireText(value?.transcript, 'Transcript'));
  const interpretation = await stage('interpret', { transcript: transcribed.transcript, emotionalNotes: 'Synthetic audio fixture for an explicitly labelled AI verification dream.' }, validateInterpretation);
  const image = await stage('image', { prompt: interpretation.surrealistImagePrompt, ...imageOptions }, validateImage);
  const chat = await stage('chat', {
    messages: [{ role: 'user', content: chatQuestion }],
    dreamContext: { title: interpretation.title, transcript: transcribed.transcript, coreTheme: interpretation.coreTheme, unconsciousTension: interpretation.unconsciousTension, archetypes: interpretation.archetypes, symbols: interpretation.symbols },
  }, (value) => {
    requireText(value?.reply, 'Chat reply');
    assert.equal(value.modelUsed, models.text, 'Chat used a different model from the configured text model.');
  });
  await persistDream(audio, mimeType, transcribed.transcript, interpretation, image, chat);
  report.status = 'passed';
  delete report.error;
  await saveReport();
}

try {
  await main();
} catch (error) {
  process.exitCode = 1;
  if (report && reportPath) {
    report.status = 'failed';
    report.error = safeError(error);
    if (report.persistence?.status === 'running') report.persistence.status = 'failed';
    await saveReport().catch(() => undefined);
  }
  console.error(`验收未完成：${safeError(error)}`);
} finally {
  await aiDispatcher?.close();
  for (const name of stageNames) {
    const result = report?.stages?.[name];
    const status = result?.status === 'passed' ? '通过' : result?.status === 'failed' ? '失败' : '未完成';
    const duration = typeof result?.durationMs === 'number' ? `${(result.durationMs / 1000).toFixed(1)} 秒` : '—';
    console.log(`${labels[name]}：${status} | ${duration}${usedCache.has(name) ? ' | 已复用缓存' : ''}`);
  }
  if (reportPath) console.log(`验收记录：${reportPath}`);
  if (report?.persistence?.status === 'passed') console.log(`存储回读：通过 | 梦境 ID：${report.persistence.dreamId}`);
}
