import { getAiEnvironment, getAiTimeoutMs } from './aiEnvironment.js';
import { getDeepseekReasoningEffort, getImageDimensions } from './domesticAi.js';

// Evaluate after dotenv has loaded the local configuration.
export function getAiConfig() {
  const environment = getAiEnvironment();
  const textProvider = environment.AI_TEXT_PROVIDER || 'deepseek';
  const mediaProvider = environment.AI_MEDIA_PROVIDER || 'dashscope';
  if (!['deepseek', 'gemini'].includes(textProvider) || !['dashscope', 'gemini'].includes(mediaProvider)) {
    throw new Error('Unsupported AI_TEXT_PROVIDER or AI_MEDIA_PROVIDER in .env.');
  }
  const textModel = textProvider === 'deepseek'
    ? environment.DEEPSEEK_MODEL || 'deepseek-v4-pro'
    : environment.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';
  const imageModel = mediaProvider === 'dashscope'
    ? environment.DASHSCOPE_IMAGE_MODEL || 'qwen-image-3.0-pro'
    : environment.GEMINI_IMAGE_MODEL || 'gemini-nano-banana-2.1';
  const transcriptionModel = mediaProvider === 'dashscope'
    ? environment.DASHSCOPE_ASR_MODEL || 'qwen-audio-3.1-asr-flash'
    : environment.GEMINI_TRANSCRIPTION_MODEL || 'gemini-3.5-transcribe';
  const keyPresent = (name: string) => Boolean(environment[name]?.trim() && !/^(MY_|YOUR_|<)/i.test(environment[name]!.trim()));
  const textReady = keyPresent(textProvider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'GEMINI_API_KEY');
  const mediaReady = keyPresent(mediaProvider === 'dashscope' ? 'DASHSCOPE_API_KEY' : 'GEMINI_API_KEY');
  const textReasoningEffort = textProvider === 'deepseek' ? getDeepseekReasoningEffort() : null;
  const defaults = textProvider === 'deepseek'
    ? [{ id: 'deepseek-v4-pro', label: `DeepSeek V4 Pro${textReasoningEffort === 'max' ? ' · 深度思考 MAX' : ''}` }, { id: 'deepseek-flash', label: 'DeepSeek Flash' }]
    : [{ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' }, { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' }, { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' }];
  const chatModels = defaults.some(({ id }) => id === textModel) ? defaults : [{ id: textModel, label: textModel }, ...defaults];
  return {
    textProvider, mediaProvider, textModel, imageModel, transcriptionModel, chatModels,
    textReasoningEffort, aiRequestTimeoutMs: getAiTimeoutMs(600_000) + 60_000,
    aiConfigured: textReady && mediaReady,
    capabilities: { interpret: textReady, chat: textReady, transcribe: mediaReady, image: mediaReady },
    imageOptions: {
      resolutions: mediaProvider === 'dashscope' ? ['native'] : ['1K', '2K', '4K'],
      aspectRatios: ['1:1', '4:3', '16:9'],
      dimensions: mediaProvider === 'dashscope' ? getImageDimensions(imageModel) : {},
    },
    transcriptionOptions: { requiresWav: mediaProvider === 'dashscope', maxDurationSeconds: mediaProvider === 'dashscope' ? 180 : 0, maxBase64Bytes: mediaProvider === 'dashscope' ? 10 * 1024 * 1024 : 28_000_000 },
  };
}
