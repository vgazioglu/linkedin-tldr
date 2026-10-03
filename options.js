import { DEFAULTS, MODELS, PROVIDERS, getSettings } from './settings.js';

const $ = (id) => document.getElementById(id);

// Populate providers
for (const [id, info] of Object.entries(PROVIDERS)) {
  $('provider').add(new Option(info.label, id));
}

function updateModelOptions(selectedProvider, currentModel) {
  const modelSelect = $('model');
  modelSelect.innerHTML = '';

  for (const [id, info] of Object.entries(MODELS)) {
    if (!info.provider || info.provider === selectedProvider) {
      modelSelect.add(new Option(info.label, id));
    }
  }

  // If current model is not in list, add it
  if (currentModel && !Array.from(modelSelect.options).some((o) => o.value === currentModel)) {
    modelSelect.add(new Option(`${currentModel} (Custom)`, currentModel));
  }

  if (currentModel) {
    modelSelect.value = currentModel;
    $('customModel').value = currentModel;
  }
}

async function tryFetchLiteLLMModels() {
  try {
    const key = $('apiKey').value.trim() || 'sk-master-key-belirleyin';
    const res = await fetch('http://localhost:4000/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.data && Array.isArray(data.data) && data.data.length > 0) {
      const modelSelect = $('model');
      const currentVal = $('customModel').value || $('model').value;
      modelSelect.innerHTML = '';
      for (const m of data.data) {
        modelSelect.add(new Option(`${m.id} · LiteLLM`, m.id));
      }
      if (currentVal) {
        if (!Array.from(modelSelect.options).some((o) => o.value === currentVal)) {
          modelSelect.add(new Option(`${currentVal} (Custom)`, currentVal));
        }
        modelSelect.value = currentVal;
      }
    }
  } catch {
    // LiteLLM offline or error, keep preset list
  }
}

async function tryFetchOllamaModels() {
  try {
    const res = await fetch('http://localhost:11434/api/tags');
    if (!res.ok) return;
    const data = await res.json();
    if (data.models && Array.isArray(data.models) && data.models.length > 0) {
      const modelSelect = $('model');
      const currentVal = $('customModel').value || $('model').value;
      modelSelect.innerHTML = '';
      for (const m of data.models) {
        modelSelect.add(new Option(`${m.name} · Installed`, m.name));
      }
      if (currentVal) {
        if (!Array.from(modelSelect.options).some((o) => o.value === currentVal)) {
          modelSelect.add(new Option(`${currentVal} (Custom)`, currentVal));
        }
        modelSelect.value = currentVal;
      }
    }
  } catch {
    // Ollama offline or not responding, keep preset list
  }
}

const settings = await getSettings();

$('provider').value = settings.provider || 'litellm';
$('endpoint').value = settings.endpoint || PROVIDERS[settings.provider]?.defaultEndpoint || '';
$('apiKey').value = settings.apiKey || PROVIDERS[settings.provider]?.defaultApiKey || '';
$('customModel').value = settings.model || 'local-qwen2.5-coder-7b';
$('language').value = settings.language || 'Turkish';
$('minChars').value = settings.minChars;
$('enabled').checked = settings.enabled;

updateModelOptions($('provider').value, settings.model);
if ($('provider').value === 'litellm') {
  tryFetchLiteLLMModels();
} else if ($('provider').value === 'ollama') {
  tryFetchOllamaModels();
}

function onProviderChange() {
  const prov = $('provider').value;
  const info = PROVIDERS[prov];
  if (info) {
    $('endpoint').value = info.defaultEndpoint;
    if (prov === 'litellm') {
      if (!$('apiKey').value) $('apiKey').value = info.defaultApiKey;
      $('apiKeyHint').textContent = 'LiteLLM Master Key (sk-master-key-belirleyin).';
      tryFetchLiteLLMModels();
    } else if (prov === 'ollama') {
      $('apiKeyHint').textContent = 'Ollama local does not need an API key.';
      tryFetchOllamaModels();
    } else if (prov === 'vercel') {
      $('apiKeyHint').textContent = 'Required: Vercel dashboard → AI Gateway → API Keys';
    } else {
      $('apiKeyHint').textContent = 'Optional API key for custom endpoint';
    }
  }
  updateModelOptions(prov, info?.defaultModel || '');
}

$('provider').addEventListener('change', onProviderChange);

$('model').addEventListener('change', () => {
  $('customModel').value = $('model').value;
});

function showStatus(text, isError = false) {
  const status = $('status');
  status.textContent = text;
  status.className = isError ? 'error' : 'success';
}

$('save').addEventListener('click', async () => {
  const provider = $('provider').value;
  const endpoint = $('endpoint').value.trim() || PROVIDERS[provider]?.defaultEndpoint;
  const model = $('customModel').value.trim() || $('model').value;

  await chrome.storage.local.set({
    provider,
    endpoint,
    apiKey: $('apiKey').value.trim(),
    model,
    language: $('language').value.trim() || DEFAULTS.language,
    minChars: Number($('minChars').value) || 0,
    enabled: $('enabled').checked,
  });

  showStatus('Saved successfully!');
  setTimeout(() => showStatus(''), 2500);
});

$('test').addEventListener('click', async () => {
  showStatus('Testing connection...');
  const provider = $('provider').value;
  const endpoint = $('endpoint').value.trim() || PROVIDERS[provider]?.defaultEndpoint;
  const model = $('customModel').value.trim() || $('model').value;
  const apiKey = $('apiKey').value.trim();

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say OK' }],
        max_tokens: 10,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      showStatus(`Error (${res.status}): ${errText.slice(0, 100)}`, true);
      return;
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content?.trim();
    showStatus(`Connection successful! ("${reply}")`, false);
  } catch (err) {
    showStatus(`Connection failed: ${err.message}`, true);
  }
});

