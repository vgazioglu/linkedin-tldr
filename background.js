import { MODELS, getSettings } from './settings.js';

const DEFAULT_API_URL = 'http://localhost:4000/v1/chat/completions';
const MAX_INPUT_CHARS = 6000;
const inFlight = new Map();

const systemPrompt = (language) =>
  `Sen LinkedIn gönderilerini özetleyen bir asistansın. Gönderinin asıl konusunu, iddiasını veya ne anlatıldığını ` +
  `TAM OLARAK TEK BİR CÜMLE ile ve en fazla 25 kelimede Türkçe olarak özetle. ` +
  `Motivasyonel laf kalabalığını, hashtagleri, emojileri ve boş çağrıları at. ` +
  `Giriş cümlesi, tırnak işareti veya 'Bu gönderide...' gibi ifadeler kullanma. Doğrudan özeti ver.`;

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

  const text = rawText.slice(0, MAX_INPUT_CHARS);
  const key = await cacheKey(`${settings.model}|${settings.language}|${text}`);

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

async function requestSummary(text, { apiKey, apiUrl, model, language }) {
  const targetUrl = apiUrl || DEFAULT_API_URL;
  const body = {
    model: model || 'qwen2.5:7b',
    messages: [
      { role: 'system', content: systemPrompt(language) },
      { role: 'user', content: text },
    ],
    max_tokens: 150,
    temperature: 0.3,
    stream: false,
  };

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`API Hatası ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  let summary = data.choices?.[0]?.message?.content?.trim().replace(/^["“”']+|["“”']+$/g, '');
  if (!summary) throw new Error('Boş özet döndü');

  // Tek tam cümle garantisi: ilk nokta, soru işareti veya ünlemden sonrasını kes
  const match = summary.match(/^(.*?[.!?])(?:\s+[A-ZÇĞİÖŞÜ]|$)/s);
  if (match) summary = match[1].trim();

  return summary;
}

async function cacheKey(input) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return 'tldr:' + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
