export const MODELS = {
  'local-qwen2.5-coder-7b': {
    label: 'local-qwen2.5-coder-7b · LiteLLM Yerel (Önerilen - Hızlı & Akıcı)',
  },
  'local-qwen3.8-distill-9b': {
    label: 'local-qwen3.8-distill-9b · LiteLLM Yerel',
  },
  'groq-gpt-oss-120b': {
    label: 'groq-gpt-oss-120b · LiteLLM Groq (Ultra Hızlı Bulut)',
  },
  'gemini-2.5-flash': {
    label: 'gemini-2.5-flash · LiteLLM Gemini',
  },
};

export const DEFAULTS = {
  apiKey: 'sk-master-key-belirleyin',
  apiUrl: 'http://localhost:4000/v1/chat/completions',
  model: 'local-qwen2.5-coder-7b',
  language: 'Turkish',
  minChars: 280,
  enabled: true,
};

export async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}
