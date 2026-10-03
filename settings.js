export const PROVIDERS = {
  litellm: {
    label: 'LiteLLM Proxy (Docker - localhost:4000)',
    defaultEndpoint: 'http://localhost:4000/v1/chat/completions',
    defaultModel: 'local-qwen2.5-coder-7b',
    defaultApiKey: 'sk-master-key-belirleyin',
    requiresKey: true,
  },
  ollama: {
    label: 'Ollama (Direct Local - localhost:11434)',
    defaultEndpoint: 'http://localhost:11434/v1/chat/completions',
    defaultModel: 'qwen2.5:7b',
    defaultApiKey: '',
    requiresKey: false,
  },
  vercel: {
    label: 'Vercel AI Gateway',
    defaultEndpoint: 'https://ai-gateway.vercel.sh/v1/chat/completions',
    defaultModel: 'openai/gpt-oss-120b',
    defaultApiKey: '',
    requiresKey: true,
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    defaultEndpoint: 'http://localhost:4000/v1/chat/completions',
    defaultModel: '',
    defaultApiKey: '',
    requiresKey: false,
  },
};

// Model presets. `order` pins the fastest inference providers on AI Gateway
// (Cerebras / Groq run gpt-oss at very high tokens/s).
export const MODELS = {
  // LiteLLM Yerel Modeller (Docker / Ollama)
  'local-qwen2.5-coder-7b': {
    label: 'local-qwen2.5-coder-7b · LiteLLM (Yerel LLM - Önerilen)',
    provider: 'litellm',
  },
  'qwen2.5-coder:7b': {
    label: 'qwen2.5-coder:7b · LiteLLM (Yerel LLM)',
    provider: 'litellm',
  },
  'local-qwen2.5-coder-14b': {
    label: 'local-qwen2.5-coder-14b · LiteLLM (Yerel LLM)',
    provider: 'litellm',
  },
  'local-qwen3.8-distill-9b': {
    label: 'local-qwen3.8-distill-9b · LiteLLM (Yerel LLM)',
    provider: 'litellm',
  },
  // LiteLLM Harici Modeller
  'groq-gpt-oss-120b': {
    label: 'groq-gpt-oss-120b · LiteLLM (Groq LPU - Ultra Hızlı Bulut)',
    provider: 'litellm',
  },
  'copilot-gpt-4o-mini': {
    label: 'copilot-gpt-4o-mini · LiteLLM (GitHub Copilot)',
    provider: 'litellm',
  },
  'gemini-2.5-flash': {
    label: 'gemini-2.5-flash · LiteLLM (Google Gemini)',
    provider: 'litellm',
  },
  'smart-chat': {
    label: 'smart-chat · LiteLLM (Akıllı Yönlendirici)',
    provider: 'litellm',
  },
  // Direct Ollama models
  'qwen2.5:7b': {
    label: 'qwen2.5:7b · Ollama Doğrudan (Local)',
    provider: 'ollama',
  },
  'llama3.1:8b': {
    label: 'llama3.1:8b · Ollama Doğrudan (Local)',
    provider: 'ollama',
  },
  // Vercel models
  'openai/gpt-oss-120b': {
    label: 'gpt-oss-120b · Cerebras → Groq (Vercel)',
    provider: 'vercel',
    order: ['cerebras', 'groq'],
    reasoning: { effort: 'low' },
  },
  'openai/gpt-oss-20b': {
    label: 'gpt-oss-20b · Groq (Vercel)',
    provider: 'vercel',
    order: ['groq'],
    reasoning: { effort: 'low' },
  },
};

export const DEFAULTS = {
  provider: 'litellm',
  endpoint: 'http://localhost:4000/v1/chat/completions',
  apiKey: 'sk-master-key-belirleyin',
  model: 'local-qwen2.5-coder-7b',
  language: 'Turkish',
  minChars: 280,
  enabled: true,
};

export async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

