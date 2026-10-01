import { MODELS, getSettings } from './settings.js';

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const MAX_INPUT_CHARS = 6000;
const inFlight = new Map();

const systemPrompt = (language) =>
  `You compress LinkedIn posts. Reply with exactly ONE plain sentence in ${language}, ` +
  `at most 25 words, stating the post's actual point: what happened, what is claimed, or what is being sold. ` +
  `Drop motivational fluff, hashtags, emojis and calls to action. ` +
  `If the post is engagement bait or a humblebrag, say so plainly. No preamble, no quotes.`;

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
  if (!settings.apiKey) throw Object.assign(new Error('AI Gateway API key missing'), { code: 'NO_KEY' });

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

async function requestSummary(text, { apiKey, model, language }) {
  const preset = MODELS[model] ?? {};
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt(language) },
      { role: 'user', content: text },
    ],
    max_tokens: 400,
    temperature: 0.3,
    stream: false,
  };
  if (preset.reasoning) body.reasoning = preset.reasoning;
  if (preset.order) body.providerOptions = { gateway: { order: preset.order } };

  const res = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gateway ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const summary = data.choices?.[0]?.message?.content?.trim().replace(/^["“”']+|["“”']+$/g, '');
  if (!summary) throw new Error('Empty summary');
  return summary;
}

async function cacheKey(input) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return 'tldr:' + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
