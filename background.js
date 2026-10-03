import { MODELS, PROVIDERS, getSettings } from './settings.js';

const MAX_INPUT_CHARS = 6000;
const inFlight = new Map();

const systemPrompt = (language) =>
  `You summarize LinkedIn posts. Regardless of what language the original post is written in (especially if English), ALWAYS translate and write the summary in ${language}. ` +
  `Reply with strictly ONE concise, complete plain sentence in ${language} (maximum 20 words) stating what happened, claimed, or sold. ` +
  `Never write a second sentence. Drop motivational fluff, hashtags, emojis and calls to action. ` +
  `If the post is engagement bait or a humblebrag, say so plainly. No preamble, no quotes, no markdown.\n\n` +
  `Example:\n` +
  `Post: I am excited to announce our company raised $10M from investors! We are also hiring designers.\n` +
  `Summary: Şirket 10 milyon dolar yatırım aldı ve tasarımcı arıyor.`;

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    return false;
  }
  if (msg?.type !== 'summarize') return false;
  summarize(msg.text).then(
    (summary) => sendResponse({ ok: true, summary }),
    (err) => sendResponse({ ok: false, error: err.message, code: err.code }),
  );
  return true; // async response
});

async function summarize(rawText) {
  const settings = await getSettings();
  const provider = PROVIDERS[settings.provider] ?? PROVIDERS.ollama;
  if (provider.requiresKey && !settings.apiKey) {
    throw Object.assign(new Error('API key missing'), { code: 'NO_KEY' });
  }

  const text = rawText.slice(0, MAX_INPUT_CHARS);
  const key = await cacheKey(`${settings.provider}|${settings.model}|${settings.language}|${text}`);

  const cached = (await chrome.storage.session.get(key))[key];
  if (cached) return cached;

  // Same post can be observed twice (LinkedIn re-renders); share one request.
  if (!inFlight.has(key)) {
    inFlight.set(
      key,
      requestSummary(text, settings)
        .then(async (summary) => {
          await chrome.storage.session.set({ [key]: summary });
          return summary;
        })
        .finally(() => inFlight.delete(key)),
    );
  }
  return inFlight.get(key);
}

// Cümlenin ortadan kesilmesini engelleyen ve sadece ilk tam cümleyi alan emniyet fonksiyonu
function extractSingleSentence(raw) {
  if (!raw) return '';
  let text = raw.trim().replace(/^["“”`\x27]+|["“”`\x27]+$/g, '').trim();

  // Model birden fazla cümle yazdıysa, ilk tam cümlenin sonunu (. ! ?) bulup sonrasını atar
  // Sayı (1.5) veya kısaltmaları (A.Ş.) korumak için cümlenin büyük harfle başlamasını kontrol eder
  const multiSentenceMatch = text.match(/^(.*?[.!?])(?:\s+[A-ZÇĞİÖŞÜ]|\s*$)/s);
  if (multiSentenceMatch && multiSentenceMatch[1].length >= 15) {
    return multiSentenceMatch[1].trim();
  }

  const simpleMatch = text.match(/^(.*?[.!?])(?:\s+|$)/s);
  if (simpleMatch && simpleMatch[1].length >= 15) {
    return simpleMatch[1].trim();
  }

  return text;
}

async function requestSummary(text, { apiKey, model, language, endpoint, provider }) {
  const preset = MODELS[model] ?? {};
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt(language) },
      { role: 'user', content: text },
    ],
    max_tokens: 90, // Güvenli tampon: Cümleyi yarım bırakmaz, ama uzatmasına da izin vermez
    temperature: 0.3,
    stream: false,
  };

  // Only pass gateway specific parameters if using Vercel
  if (provider === 'vercel' || (!provider && preset.provider === 'vercel')) {
    if (preset.reasoning) body.reasoning = preset.reasoning;
    if (preset.order) body.providerOptions = { gateway: { order: preset.order } };
  }

  const targetUrl = endpoint || PROVIDERS[provider]?.defaultEndpoint || 'http://localhost:11434/v1/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  let res;
  try {
    res = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new Error('LLM request timed out (15s)');
    }
    throw new Error(`LLM connection failed (${err.message}). Is Ollama running?`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LLM Error ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const rawContent = data.choices?.[0]?.message?.content ?? '';
  const summary = extractSingleSentence(rawContent);
  if (!summary) throw new Error('Empty summary');
  return summary;
}

async function cacheKey(input) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return 'tldr:' + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
