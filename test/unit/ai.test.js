const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { join } = require('node:path');
const { createAi, PROVIDERS, DEFAULT_MODEL } = require('../../electron/ai');

// Stand-in for Electron's safeStorage: reversible, but never the plain key on disk
const fakeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from('enc:' + [...s].reverse().join('')),
  decryptString: (b) => { const s = b.toString(); if (!s.startsWith('enc:')) throw new Error('bad'); return [...s.slice(4)].reverse().join(''); },
});

// One local server answering for every provider: /v1/messages (Anthropic), /<provider>/chat/completions (OpenAI format).
// respond(req) may return { status, body } to override the default success reply.
async function setup(t, { storage = fakeStorage(), respond = () => null } = {}) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'cortex-ai-'));
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const r = { url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null };
      seen.push(r);
      const anthropic = req.url.startsWith('/v1/messages');
      const out = respond(r) || {
        status: 200,
        body: anthropic
          ? { id: 'msg_1', type: 'message', role: 'assistant', model: r.body.model, stop_reason: 'end_turn', content: [{ type: 'text', text: ' pong ' }], usage: { input_tokens: 5, output_tokens: 2 } }
          : { model: r.body.model, choices: [{ message: { role: 'assistant', content: ' pong ' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } },
      };
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const configPath = join(dir, 'ai.json');
  const make = () => createAi({ configPath, safeStorage: storage, baseURL: `http://127.0.0.1:${server.address().port}` });
  return { configPath, seen, make, ai: make() };
}

test('defaults: Anthropic active, every provider listed without a key', async (t) => {
  const { ai } = await setup(t);
  const cfg = await ai.getConfig();
  assert.equal(cfg.provider, 'anthropic');
  assert.deepEqual(Object.keys(cfg.providers), ['anthropic', 'openrouter', 'nvidia']);
  assert.deepEqual(cfg.providers.anthropic, { label: 'Anthropic', model: DEFAULT_MODEL, defaultModel: DEFAULT_MODEL, hasKey: false, remembered: false });
  assert.equal(cfg.providers.nvidia.model, PROVIDERS.nvidia.defaultModel);
});

test('no key: complete refuses with needsKey and never calls out', async (t) => {
  const { ai, seen } = await setup(t);
  const r = await ai.complete({ prompt: 'x' });
  assert.equal(r.needsKey, true);
  assert.match(r.error, /Anthropic API key/);
  assert.equal(seen.length, 0);
});

test('keys are stored encrypted per provider, survive a restart and never reach getConfig', async (t) => {
  const { ai, make, configPath } = await setup(t);
  await ai.setConfig({ provider: 'openrouter', apiKey: '  sk-or-secret-123  ', model: 'anthropic/claude-sonnet-4.5:free' });
  const cfg = await ai.setConfig({ provider: 'nvidia', apiKey: 'nvapi-secret-456' });
  assert.equal(cfg.provider, 'nvidia');
  assert.equal(cfg.providers.openrouter.hasKey, true);
  assert.equal(cfg.providers.nvidia.remembered, true);
  assert.equal(cfg.providers.anthropic.hasKey, false);
  assert.ok(!JSON.stringify(cfg).includes('secret'));
  const disk = fs.readFileSync(configPath, 'utf8');
  assert.ok(!disk.includes('sk-or-secret-123') && !disk.includes('nvapi-secret-456'), 'plain key written to disk');
  const again = await make().getConfig(); // a new process reads the file
  assert.equal(again.provider, 'nvidia');
  assert.equal(again.providers.openrouter.model, 'anthropic/claude-sonnet-4.5:free');
  assert.equal(again.providers.openrouter.hasKey, true);
});

test('without OS encryption the key is kept for this session only', async (t) => {
  const { ai, make, configPath } = await setup(t, { storage: fakeStorage(false) });
  const cfg = await ai.setConfig({ apiKey: 'sk-ant-secret-123' });
  assert.equal(cfg.providers.anthropic.hasKey, true);
  assert.equal(cfg.providers.anthropic.remembered, false);
  assert.ok(!fs.readFileSync(configPath, 'utf8').includes('secret'));
  assert.equal((await make().getConfig()).providers.anthropic.hasKey, false);
});

test('setConfig: empty key clears, bad input changes nothing', async (t) => {
  const { ai } = await setup(t);
  await ai.setConfig({ apiKey: 'sk-ant-secret-123' });
  for (const bad of [{ apiKey: 'short' }, { model: 'Bad Model!' }, { model: 42 }, { provider: 'openai' }, { provider: 'toString' }]) {
    assert.equal((await ai.setConfig(bad)).success, false, JSON.stringify(bad));
  }
  const cfg = await ai.getConfig();
  assert.equal(cfg.provider, 'anthropic');
  assert.equal(cfg.providers.anthropic.hasKey, true);
  assert.equal((await ai.setConfig({ apiKey: '' })).providers.anthropic.hasKey, false);
});

test('garbage config file falls back to defaults', async (t) => {
  const { configPath, make } = await setup(t);
  fs.writeFileSync(configPath, '{not json');
  assert.equal((await make().getConfig()).provider, 'anthropic');
  fs.writeFileSync(configPath, 'null');
  assert.equal((await make().getConfig()).providers.nvidia.model, PROVIDERS.nvidia.defaultModel);
});

test('Anthropic: official SDK wire format, refusal fallback only for models that take it', async (t) => {
  const { ai, seen } = await setup(t);
  await ai.setConfig({ apiKey: 'sk-ant-right-key' });
  assert.deepEqual(await ai.complete({ system: 'S', prompt: 'ping', maxTokens: 999999 }), { success: true, text: 'pong', truncated: false, model: DEFAULT_MODEL, usage: { input: 5, output: 2 } });
  const { url, headers, body } = seen[0];
  assert.match(url, /^\/v1\/messages/);
  assert.equal(headers.authorization, 'Bearer sk-ant-right-key');
  assert.ok(headers['anthropic-version']);
  assert.match(headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.deepEqual(body, { model: DEFAULT_MODEL, max_tokens: 16000, messages: [{ role: 'user', content: 'ping' }], system: 'S', fallbacks: 'default' });
  await ai.setConfig({ model: 'claude-haiku-5-5' });
  await ai.complete({ prompt: 'ping' });
  assert.equal(seen[1].body.fallbacks, undefined);
  assert.equal(seen[1].headers['anthropic-beta'], undefined);
});

test('OpenRouter and NVIDIA: OpenAI chat-completions format with the provider key and model', async (t) => {
  const { ai, seen } = await setup(t);
  await ai.setConfig({ provider: 'nvidia', apiKey: 'nvapi-key-456' });
  await ai.setConfig({ provider: 'openrouter', apiKey: 'sk-or-key-123' });
  assert.deepEqual(await ai.complete({ system: 'S', prompt: 'ping' }), { success: true, text: 'pong', truncated: false, model: 'openrouter/auto', usage: { input: 5, output: 2 } });
  assert.equal(seen[0].url, '/openrouter/chat/completions');
  assert.equal(seen[0].headers.authorization, 'Bearer sk-or-key-123');
  assert.equal(seen[0].headers['x-title'], 'Cortex');
  assert.deepEqual(seen[0].body, { model: 'openrouter/auto', max_tokens: 4000, messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'ping' }] });
  await ai.setConfig({ provider: 'nvidia' });
  await ai.complete({ prompt: 'ping' });
  assert.equal(seen[1].url, '/nvidia/chat/completions');
  assert.equal(seen[1].headers.authorization, 'Bearer nvapi-key-456');
  assert.deepEqual(seen[1].body.messages, [{ role: 'user', content: 'ping' }]);
  assert.equal(seen[1].body.model, PROVIDERS.nvidia.defaultModel);
});

test('errors become messages for every provider, never throws', async (t) => {
  const replies = {
    '/v1/messages': { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } },
    '/openrouter/chat/completions': { status: 200, body: { error: { message: 'upstream exploded', code: 502 } } },
    '/nvidia/chat/completions': { status: 404, body: { detail: 'Function not found' } },
  };
  let mode = null;
  const { ai } = await setup(t, { respond: (r) => mode || replies[r.url.replace(/\?.*$/, '')] });
  await ai.setConfig({ apiKey: 'sk-ant-wrong-key' });
  assert.match((await ai.complete({ prompt: 'p' })).error, /Anthropic API key was rejected/);
  await ai.setConfig({ provider: 'openrouter', apiKey: 'sk-or-key-123' });
  assert.match((await ai.complete({ prompt: 'p' })).error, /upstream exploded/);
  await ai.setConfig({ provider: 'nvidia', apiKey: 'nvapi-key-456', model: 'nope/model' });
  assert.match((await ai.complete({ prompt: 'p' })).error, /Unknown NVIDIA NIM model "nope\/model"/);
  mode = { status: 429, body: 'not json' };
  assert.match((await ai.complete({ prompt: 'p' })).error, /Rate limited by NVIDIA NIM/);
  mode = { status: 200, body: { model: 'm', choices: [{ message: { content: 'part' }, finish_reason: 'length' }] } };
  assert.equal((await ai.complete({ prompt: 'p' })).truncated, true);
});

test('refusals, invalid and oversized requests', async (t) => {
  const { ai, seen } = await setup(t, { respond: () => ({ status: 200, body: { id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'refusal', content: [], usage: {} } }) });
  await ai.setConfig({ apiKey: 'sk-ant-secret-123' });
  assert.match((await ai.complete({ prompt: 'P' })).error, /declined/);
  assert.equal((await ai.complete({ prompt: '   ' })).success, false);
  assert.equal((await ai.complete({ prompt: 'x'.repeat(400001) })).success, false);
  assert.equal((await ai.complete(null)).success, false);
  assert.equal(seen.length, 1);
});

test('an unreachable host is reported, not thrown', async (t) => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'cortex-ai-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ai = createAi({ configPath: join(dir, 'ai.json'), safeStorage: fakeStorage(), baseURL: 'http://127.0.0.1:9' });
  await ai.setConfig({ provider: 'openrouter', apiKey: 'sk-or-key-123' });
  assert.match((await ai.complete({ prompt: 'p' })).error, /Could not reach OpenRouter/);
});
