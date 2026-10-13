import { getDeepseekReasoningEffort, getImageDimensions } from './domesticAi';

// Evaluate after dotenv has loaded the local configuration.
export function getAiConfig() {
  const textProvider = process.env.AI_TEXT_PROVIDER || 'deepseek';
  const mediaProvider = process.env.AI_MEDIA_PROVIDER || 'dashscope';
  if (!['deepseek', 'gemini'].includes(textProvider) || !['dashscope', 'gemini'].includes(mediaProvider)) {
    throw new Error('Unsupported AI_TEXT_PROVIDER or AI_MEDIA_PROVIDER in .env.');
  }
  const textModel = textProvider === 'deepseek'
    ? process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro'
    : process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';
  const imageModel = mediaProvider === 'dashscope'
    ? process.env.DASHSCOPE_IMAGE_MODEL || 'qwen-image-3.0-pro'
    : process.env.GEMINI_IMAGE_MODEL || 'gemini-nano-banana-2.1';
  const transcriptionModel = mediaProvider === 'dashscope'
    ? process.env.DASHSCOPE_ASR_MODEL || 'qwen-audio-3.1-asr-flash'
    : process.env.GEMINI_TRANSCRIPTION_MODEL || 'gemini-3.5-transcribe';
  const keyPresent = (name: string) => Boolean(process.env[name]?.trim() && !/^(MY_|YOUR_|<)/i.test(process.env[name]!.trim()));
  const textReady = keyPresent(textProvider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'GEMINI_API_KEY');
  const mediaReady = keyPresent(mediaProvider === 'dashscope' ? 'DASHSCOPE_API_KEY' : 'GEMINI_API_KEY');
  const textReasoningEffort = textProvider === 'deepseek' ? getDeepseekReasoningEffort() : null;
  const defaults = textProvider === 'deepseek'
    ? [{ id: 'deepseek-v4-pro', label: `DeepSeek V4 Pro${textReasoningEffort === 'max' ? ' · 深度思考 MAX' : ''}` }, { id: 'deepseek-flash', label: 'DeepSeek Flash' }]
    : [{ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' }, { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' }, { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' }];
  const chatModels = defaults.some(({ id }) => id === textModel) ? defaults : [{ id: textModel, label: textModel }, ...defaults];
  return {
    textProvider, mediaProvider, textModel, imageModel, transcriptionModel, chatModels,
    textReasoningEffort, aiRequestTimeoutMs: 660_000,
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
