import { DEFAULTS, MODELS, getSettings } from './settings.js';

const $ = (id) => document.getElementById(id);

for (const [id, { label }] of Object.entries(MODELS)) {
  $('model').add(new Option(label, id));
}

const settings = await getSettings();
$('apiKey').value = settings.apiKey;
$('model').value = settings.model;
$('language').value = settings.language;
$('minChars').value = settings.minChars;
$('enabled').checked = settings.enabled;

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    apiKey: $('apiKey').value.trim(),
    model: $('model').value,
    language: $('language').value.trim() || DEFAULTS.language,
    minChars: Number($('minChars').value) || 0,
    enabled: $('enabled').checked,
  });
  $('status').textContent = 'Saved';
  setTimeout(() => ($('status').textContent = ''), 1500);
});
