export const MODELS = {
  'cf-llama-3.3-70b': {
    label: 'cf-llama-3.3-70b · Llama 70B (Önerilen - Kusursuz Türkçe & Hızlı)',
  },
  'gemini-2.5-flash': {
    label: 'gemini-2.5-flash · Gemini Flash (Çok Akıcı Türkçe & 1 sn)',
  },
  'local-qwen2.5-coder-7b': {
    label: 'local-qwen2.5-coder-7b · Yerel Ollama (Tamamen Çevrimdışı)',
  },
  'local-qwen2.5-coder-14b': {
    label: 'local-qwen2.5-coder-14b · Yerel Ollama 14B',
  },
};

export const DEFAULTS = {
  apiKey: 'sk-master-key-belirleyin',
  apiUrl: 'http://localhost:4000/v1/chat/completions',
  model: 'cf-llama-3.3-70b',
  language: 'Turkish',
  minChars: 280,
  enabled: true,
};

export async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}
