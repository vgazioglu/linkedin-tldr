// Model presets. `order` pins the fastest inference providers on AI Gateway
// (Cerebras / Groq run gpt-oss at very high tokens/s).
export const MODELS = {
  'openai/gpt-oss-120b': {
    label: 'gpt-oss-120b · Cerebras → Groq (fastest, recommended)',
    order: ['cerebras', 'groq'],
    reasoning: { effort: 'low' },
  },
  'openai/gpt-oss-20b': {
    label: 'gpt-oss-20b · Groq (cheapest)',
    order: ['groq'],
    reasoning: { effort: 'low' },
  },
  'google/gemini-2.5-flash-lite': {
    label: 'gemini-2.5-flash-lite · Google',
  },
};

// Summaries default to the browser's UI language, e.g. "tr" -> "Turkish".
const uiLanguage =
  new Intl.DisplayNames(['en'], { type: 'language' }).of(chrome.i18n.getUILanguage().split('-')[0]) ?? 'English';

export const DEFAULTS = {
  apiKey: '',
  model: 'openai/gpt-oss-120b',
  language: uiLanguage,
  minChars: 280,
  enabled: true,
};

export async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}
