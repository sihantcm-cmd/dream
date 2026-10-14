export interface AiSettings {
  deepseekApiKey: string;
  dashscopeApiKey: string;
  deepseekModel: string;
  deepseekReasoningEffort: 'none' | 'low' | 'high' | 'max';
  dashscopeAsrModel: string;
  dashscopeImageModel: string;
  dashscopeWorkspaceId: string;
}

export const DEFAULT_SETTINGS: Readonly<AiSettings> = Object.freeze({
  deepseekApiKey: '', dashscopeApiKey: '', deepseekModel: 'deepseek-v4-pro', deepseekReasoningEffort: 'max',
  dashscopeAsrModel: 'qwen-audio-3.1-asr-flash', dashscopeImageModel: 'qwen-image-3.0-pro', dashscopeWorkspaceId: '',
});

export function publicSettings(settings: AiSettings) {
  const { deepseekApiKey, dashscopeApiKey, ...models } = settings;
  return { ...models, deepseekKeyConfigured: Boolean(deepseekApiKey), dashscopeKeyConfigured: Boolean(dashscopeApiKey) };
}

export function updateSettings(current: AiSettings, input: unknown): AiSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置格式不正确。');
  const patch = input as Record<string, unknown>;
  const updated = { ...current };
  for (const field of ['deepseekModel', 'dashscopeAsrModel', 'dashscopeImageModel'] as const) {
    if (patch[field] === undefined) continue;
    if (typeof patch[field] !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(patch[field])) throw new Error('模型名称格式不正确。');
    updated[field] = patch[field];
  }
  if (patch.deepseekReasoningEffort !== undefined) {
    if (!['none', 'low', 'high', 'max'].includes(String(patch.deepseekReasoningEffort))) throw new Error('请选择有效的思考强度。');
    updated.deepseekReasoningEffort = patch.deepseekReasoningEffort as AiSettings['deepseekReasoningEffort'];
  }
  if (patch.dashscopeWorkspaceId !== undefined) {
    if (typeof patch.dashscopeWorkspaceId !== 'string' || (patch.dashscopeWorkspaceId !== '' && !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(patch.dashscopeWorkspaceId))) throw new Error('百炼业务空间 ID 格式不正确。');
    updated.dashscopeWorkspaceId = patch.dashscopeWorkspaceId;
  }
  for (const [field, clear] of [['deepseekApiKey', 'clearDeepseekKey'], ['dashscopeApiKey', 'clearDashscopeKey']] as const) {
    if (patch[clear] !== undefined && typeof patch[clear] !== 'boolean') throw new Error('密钥删除选项不正确。');
    if (patch[clear] === true) updated[field] = '';
    if (patch[field] === undefined || patch[field] === '') continue;
    if (typeof patch[field] !== 'string' || !/^[a-zA-Z0-9_.-]{16,512}$/.test(patch[field])) throw new Error('API 密钥格式不正确，请检查是否含空格。');
    if (patch[clear]) throw new Error('不能同时删除和替换同一密钥。');
    updated[field] = patch[field];
  }
  return updated;
}

/** Cloud calls never inherit AI keys from a developer's local environment. */
export function settingsEnvironment(settings: AiSettings): Readonly<Record<string, string>> {
  return Object.freeze({
    AI_TEXT_PROVIDER: 'deepseek', AI_MEDIA_PROVIDER: 'dashscope',
    DEEPSEEK_API_KEY: settings.deepseekApiKey, DASHSCOPE_API_KEY: settings.dashscopeApiKey,
    DEEPSEEK_MODEL: settings.deepseekModel, DEEPSEEK_REASONING_EFFORT: settings.deepseekReasoningEffort,
    DASHSCOPE_ASR_MODEL: settings.dashscopeAsrModel, DASHSCOPE_IMAGE_MODEL: settings.dashscopeImageModel,
    DASHSCOPE_WORKSPACE_ID: settings.dashscopeWorkspaceId, ONEIROS_AI_TIMEOUT_MS: '240000',
  });
}
