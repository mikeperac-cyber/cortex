const fs = require('fs/promises');
const Anthropic = require('@anthropic-ai/sdk');

// Bring-your-own-key AI. Keys live only in the main process: encrypted at rest with the OS keychain (safeStorage: DPAPI on
// Windows), never sent to the renderer, which keeps its `connect-src 'none'` CSP. The renderer can only ask for a completion.
// Anthropic goes through its official SDK; OpenRouter and NVIDIA NIM speak the OpenAI chat-completions format over fetch.
// Hosts are pinned so an environment variable (ANTHROPIC_BASE_URL, ...) can never send a user's key elsewhere.
const PROVIDERS = {
  anthropic: { label: 'Anthropic', defaultModel: 'claude-opus-5-5', baseURL: 'https://api.anthropic.com' },
  openrouter: { label: 'OpenRouter', defaultModel: 'openrouter/auto', baseURL: 'https://openrouter.ai/api/v1' },
  nvidia: { label: 'NVIDIA NIM', defaultModel: 'meta/llama-3.3-70b-instruct', baseURL: 'https://integrate.api.nvidia.com/v1' },
};
const DEFAULT_PROVIDER = 'anthropic';
const DEFAULT_MODEL = PROVIDERS.anthropic.defaultModel;
// Anthropic models that take the server-side refusal fallback (`fallbacks: "default"`); any other model id is sent without it
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/; // claude-opus-5-5, meta/llama-3.3-70b-instruct, vendor/model:free
const KEY = /^\S{8,512}$/;
const MAX_INPUT = 400000; // characters of system + prompt per request
const TIMEOUT_MS = 120000;

const ok = (text, truncated, model, input, output) => ({ success: true, text, truncated, model, usage: { input: input ?? 0, output: output ?? 0 } });
const fail = (error) => ({ success: false, error: String(error).slice(0, 300) });

function describeStatus(status, label, model, message) {
  if (status === 401) return 'The ' + label + ' API key was rejected. Check it in Synapse settings.';
  if (status === 402) return label + ' says this account is out of credits.';
  if (status === 403) return 'This ' + label + ' key may not use ' + model + '.';
  if (status === 404) return 'Unknown ' + label + ' model "' + model + '".';
  if (status === 429) return 'Rate limited by ' + label + '. Try again in a moment.';
  return label + ' API error ' + status + (message ? ': ' + message : '');
}

async function callAnthropic({ apiKey, baseURL, model, system, prompt, maxTokens }) {
  const params = { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
  if (system) params.system = system;
  if (FALLBACK_MODELS.has(model)) Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  try {
    const client = new Anthropic.Anthropic({ apiKey, baseURL, timeout: TIMEOUT_MS, maxRetries: 2 });
    const res = await client.beta.messages.create(params);
    if (res.stop_reason === 'refusal') return fail('The model declined this request.');
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return ok(text, res.stop_reason === 'max_tokens', res.model, res.usage?.input_tokens, res.usage?.output_tokens);
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) return fail('The request timed out.');
    if (err instanceof Anthropic.APIConnectionError) return fail('Could not reach the Anthropic API. Check your connection.');
    if (err instanceof Anthropic.APIError) return fail(describeStatus(err.status, 'Anthropic', model, err.message));
    return fail('AI request failed: ' + (err && err.message || err));
  }
}

// OpenAI-compatible chat completions (OpenRouter, NVIDIA NIM)
async function callChatCompletions({ apiKey, baseURL, label, model, system, prompt, maxTokens }) {
  const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }];
  let res;
  try {
    res = await fetch(baseURL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
        'HTTP-Referer': 'https://github.com/mikeperac-cyber/cortex', 'X-Title': 'Cortex', // OpenRouter app attribution; others ignore them
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return fail(err && err.name === 'TimeoutError' ? 'The request timed out.' : 'Could not reach ' + label + '. Check your connection.');
  }
  let body = null;
  try { body = await res.json(); } catch { /* not JSON: described by status below */ }
  const apiError = body && body.error ? (typeof body.error === 'string' ? body.error : body.error.message) : body?.detail;
  if (!res.ok) return fail(describeStatus(res.status, label, model, apiError));
  if (apiError) return fail(label + ': ' + apiError); // OpenRouter can answer 200 with an upstream error
  const choice = body && Array.isArray(body.choices) ? body.choices[0] : null;
  const text = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
  if (!choice) return fail(label + ' sent an empty reply.');
  return ok(text, choice.finish_reason === 'length', body.model || model, body.usage?.prompt_tokens, body.usage?.completion_tokens);
}

// baseURL (tests only): replaces every provider's host, so one local stand-in can answer for all of them
function createAi({ configPath, safeStorage, baseURL = null }) {
  let config = null; // { provider, providers: { [id]: { model, keyEnc: base64 | null } } }, read once
  const sessionKeys = {}; // keys the OS could not encrypt: memory only, for this run, never written to disk

  const entry = (id) => config.providers[id] || (config.providers[id] = { model: PROVIDERS[id].defaultModel, keyEnc: null });

  async function load() {
    if (config) return config;
    let j = {};
    try { j = JSON.parse(await fs.readFile(configPath, 'utf8')) || {}; } catch { /* missing or unreadable: start clean */ }
    config = { provider: PROVIDERS[j.provider] ? j.provider : DEFAULT_PROVIDER, providers: {} };
    for (const id of Object.keys(PROVIDERS)) {
      const p = j.providers && typeof j.providers[id] === 'object' && j.providers[id] ? j.providers[id] : {};
      config.providers[id] = { model: typeof p.model === 'string' && MODEL.test(p.model) ? p.model : PROVIDERS[id].defaultModel, keyEnc: typeof p.keyEnc === 'string' ? p.keyEnc : null };
    }
    return config;
  }

  async function save() {
    const tmp = configPath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(config));
    await fs.rename(tmp, configPath);
  }

  function apiKey(id) {
    if (sessionKeys[id]) return sessionKeys[id];
    const enc = entry(id).keyEnc;
    if (!enc) return null;
    try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return null; } // written by another user/machine
  }

  async function getConfig() {
    await load();
    const providers = {};
    for (const [id, p] of Object.entries(PROVIDERS)) {
      providers[id] = { label: p.label, model: entry(id).model, defaultModel: p.defaultModel, hasKey: !!apiKey(id), remembered: !sessionKeys[id] && !!entry(id).keyEnc };
    }
    return { success: true, provider: config.provider, providers };
  }

  // { provider, model, apiKey }: provider selects the active one and the one model/apiKey apply to (default: the active one).
  // apiKey undefined keeps the stored key, '' removes it, anything else replaces it.
  async function setConfig(opts) {
    await load();
    const { provider, model, apiKey: key } = opts && typeof opts === 'object' ? opts : {};
    if (provider !== undefined && !Object.hasOwn(PROVIDERS, provider)) return fail('Unknown provider');
    if (model !== undefined && !(typeof model === 'string' && MODEL.test(model.trim()))) return fail('Invalid model id');
    if (key !== undefined && key !== '' && !(typeof key === 'string' && KEY.test(key.trim()))) return fail('Invalid API key');
    if (provider !== undefined) config.provider = provider;
    const id = config.provider;
    if (model !== undefined) entry(id).model = model.trim();
    if (key === '') { entry(id).keyEnc = null; delete sessionKeys[id]; }
    else if (key !== undefined) {
      if (safeStorage.isEncryptionAvailable()) {
        entry(id).keyEnc = safeStorage.encryptString(key.trim()).toString('base64');
        delete sessionKeys[id];
      } else {
        entry(id).keyEnc = null;
        sessionKeys[id] = key.trim();
      }
    }
    try { await save(); } catch (err) { return fail('Could not save AI settings: ' + err.message); }
    return getConfig();
  }

  // One user turn in, the text out, with the active provider: { success, text, truncated, model, usage } or
  // { success: false, error, needsKey? }. Never throws.
  async function complete(req) {
    await load();
    const { system = '', prompt, maxTokens = 4000 } = req && typeof req === 'object' ? req : {};
    if (typeof system !== 'string' || typeof prompt !== 'string' || !prompt.trim()) return fail('Invalid request');
    if (system.length + prompt.length > MAX_INPUT) return fail('This request is too large to send.');
    const id = config.provider;
    const p = PROVIDERS[id];
    const key = apiKey(id);
    if (!key) return { success: false, error: 'Add your ' + p.label + ' API key in Synapse settings first.', needsKey: true };
    const call = {
      apiKey: key,
      baseURL: baseURL ? baseURL + (id === 'anthropic' ? '' : '/' + id) : p.baseURL,
      label: p.label,
      model: entry(id).model,
      system,
      prompt,
      maxTokens: Number.isInteger(maxTokens) ? Math.min(16000, Math.max(256, maxTokens)) : 4000,
    };
    return id === 'anthropic' ? callAnthropic(call) : callChatCompletions(call);
  }

  return { getConfig, setConfig, complete };
}

module.exports = { createAi, PROVIDERS, DEFAULT_MODEL };
