// These presets use providers' OpenAI-compatible Chat Completions endpoints.
export const modelProviders = [
  {
    name: 'OpenAI', endpoint: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o', vision: true }, { id: 'gpt-4o-mini', vision: true },
      { id: 'gpt-4.1', vision: true }, { id: 'gpt-4.1-mini', vision: true },
      { id: 'gpt-4.1-nano', vision: true },
    ],
  },
  {
    name: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }, { id: 'deepseek-flash' },
    ],
  },
  {
    name: '阿里云百炼', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'qwen-max' }, { id: 'qwen-plus' }, { id: 'qwen-turbo' },
      { id: 'qwen-long' }, { id: 'qwq-plus' },
      { id: 'qwen-vl-max', vision: true }, { id: 'qwen-vl-plus', vision: true },
    ],
  },
  {
    name: '智谱 AI', endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { id: 'glm-4.5' }, { id: 'glm-4.5-air' }, { id: 'glm-4.5-flash' },
      { id: 'glm-4-plus' }, { id: 'glm-4-air' }, { id: 'glm-4-flash' },
      { id: 'glm-4v-plus', vision: true },
    ],
  },
  {
    name: '月之暗面 Kimi', endpoint: 'https://api.moonshot.cn/v1',
    models: [
      { id: 'moonshot-v1-8k' }, { id: 'moonshot-v1-32k' },
      { id: 'moonshot-v1-128k' }, { id: 'kimi-k2-0711-preview' },
    ],
  },
  {
    name: 'Google Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [
      { id: 'gemini-2.5-pro', vision: true },
      { id: 'gemini-2.5-flash', vision: true },
      { id: 'gemini-2.5-flash-lite', vision: true },
      { id: 'gemini-2.0-flash', vision: true },
    ],
  },
  {
    name: 'Mistral', endpoint: 'https://api.mistral.ai/v1',
    models: [
      { id: 'mistral-large-latest' }, { id: 'mistral-medium-latest' },
      { id: 'mistral-small-latest' }, { id: 'ministral-8b-latest' },
      { id: 'pixtral-large-latest', vision: true },
    ],
  },
  {
    name: 'xAI', endpoint: 'https://api.x.ai/v1',
    models: [{ id: 'grok-3' }, { id: 'grok-3-mini' }, { id: 'grok-4' }],
  },
  {
    name: 'Groq', endpoint: 'https://api.groq.com/openai/v1',
    models: [
      { id: 'llama-3.3-70b-versatile' }, { id: 'llama-3.1-8b-instant' },
      { id: 'openai/gpt-oss-120b' }, { id: 'openai/gpt-oss-20b' },
    ],
  },
  {
    name: 'Together AI', endpoint: 'https://api.together.xyz/v1',
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
      { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo' },
      { id: 'deepseek-ai/DeepSeek-V3' },
    ],
  },
  {
    name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'openai/gpt-4o', vision: true },
      { id: 'anthropic/claude-sonnet-4', vision: true },
      { id: 'google/gemini-2.5-pro', vision: true },
      { id: 'deepseek/deepseek-chat-v3-0324' },
      { id: 'meta-llama/llama-3.3-70b-instruct' },
    ],
  },
  {
    name: 'Perplexity', endpoint: 'https://api.perplexity.ai',
    models: [{ id: 'sonar' }, { id: 'sonar-pro' }, { id: 'sonar-reasoning-pro' }],
  },
  {
    name: 'Cohere', endpoint: 'https://api.cohere.ai/compatibility/v1',
    models: [
      { id: 'command-a-03-2025' }, { id: 'command-r-plus-08-2024' },
      { id: 'command-r-08-2024' },
    ],
  },
];

export const modelPresets = modelProviders.flatMap((provider) =>
  provider.models.map((model) => ({
    key: `${provider.name}:${model.id}`,
    provider: provider.name,
    endpoint: provider.endpoint,
    model: model.id,
    vision: Boolean(model.vision),
  })),
);

export function applyModelPreset(form, key) {
  const preset = modelPresets.find((item) => item.key === key);
  return preset
    ? { ...form, endpoint: preset.endpoint, model: preset.model, vision: preset.vision }
    : form;
}
