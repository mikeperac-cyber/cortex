const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

// Synapse end to end against a local stand-in for the providers (main honours CORTEX_AI_BASE_URL in unpackaged runs):
// the key goes in through the settings form and never shows up in the page, each task's reply lands where it should,
// model text is rendered safely, and switching to OpenRouter sends the next request there.
const ANTHROPIC_KEY = 'sk-ant-e2e-secret-1234';
const OPENROUTER_KEY = 'sk-or-e2e-secret-5678';

function reply(prompt) {
  if (prompt.includes('<titles>')) return 'Beta\nGhost\nAlpha';
  if (prompt.includes('flashcards')) return 'What ships? :: v2\nWho to call? :: Ana';
  if (prompt.includes('action items')) return '- [ ] Call Ana\n- [ ] Ship v2';
  if (prompt.includes('Question:')) return 'Beta says so. See [[Beta]].';
  return '- a point <img src=x onerror="window.__xss=1">\n\n**TL;DR:** fine';
}

module.exports = {
  seed: {
    'Alpha.md': '# Alpha\n\nWe should call Ana and ship v2.\n',
    'Beta.md': '# Beta\n\nThe v2 launch is approved.\n',
    'Gamma.md': '# Gamma\n\nUnrelated.\n',
  },
  async run({ js, sleep, vault, afterQuit }) {
    const requests = [];
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const body = JSON.parse(raw);
        requests.push({ url: req.url, auth: req.headers.authorization, body });
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url.startsWith('/v1/messages')) {
          res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', content: [{ type: 'text', text: reply(body.messages[0].content) }], usage: { input_tokens: 1, output_tokens: 1 } }));
        } else {
          res.end(JSON.stringify({ model: body.model, choices: [{ message: { content: 'from openrouter' }, finish_reason: 'stop' }], usage: {} }));
        }
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    process.env.CORTEX_AI_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    afterQuit(() => server.close());

    const poll = async (code, what) => {
      for (let i = 0; i < 200; i++) { if (await js(code)) return; await sleep(50); }
      throw new Error('Timed out waiting for ' + what + ': ' + await js('document.getElementById("synStatus")?.textContent'));
    };
    const syn = `App.plugins.find(p => p.name === 'synapse')`;
    const runKind = async (kind) => {
      await js(`App.openPlugin('synapse')`);
      await poll(`!!${syn}.config`, 'the AI settings');
      await js(`${syn}.config = null; document.querySelector('#plugin-synapse [data-kind="${kind}"]').click(); 0`);
      await poll(`!${syn}.busy && !!document.querySelector('#synResult')?.textContent`, kind + ' result');
    };

    await poll('App._notes.length === 3', 'the index');
    await js(`App.openFile(${JSON.stringify(path.join(vault, 'Alpha.md'))})`);
    await poll('App.activeTab && App.activeTab.endsWith("Alpha.md")', 'Alpha to open');

    // 1. No key yet: the settings form is open and a task asks for the key without calling out
    await js(`App.openPlugin('synapse')`);
    await poll(`!!${syn}.config && !document.getElementById('synSettings').hidden`, 'the key form');
    await js(`document.querySelector('#plugin-synapse [data-kind="summarize"]').click(); 0`);
    await poll(`/API key/.test(document.getElementById('synStatus').textContent)`, 'the missing-key message');
    assert.equal(requests.length, 0);

    // 2. Save a key through the form: it never comes back into the page
    await js(`document.getElementById('synKey').value = ${JSON.stringify(ANTHROPIC_KEY)}; document.getElementById('synSave').click(); 0`);
    await poll(`${syn}.config.providers.anthropic.hasKey === true`, 'the key to be saved');
    assert.equal(await js(`document.documentElement.outerHTML.includes(${JSON.stringify(ANTHROPIC_KEY)})`), false, 'key visible in the page');
    assert.equal(await js(`JSON.stringify(${syn}.config).includes('secret')`), false, 'key returned to the renderer');

    // 3. Summarize: model text is rendered without running markup
    await runKind('summarize');
    assert.match(await js(`document.getElementById('synResult').textContent`), /TL;DR/);
    assert.equal(await js(`document.querySelector('#synResult img')`), null, 'model HTML was rendered');
    assert.equal(await js('window.__xss'), undefined);
    assert.equal(requests[0].auth, 'Bearer ' + ANTHROPIC_KEY);
    assert.match(requests[0].body.messages[0].content, /<note title="Alpha">/);

    // 4. Links: only real notes other than this one; "Add to note" edits the open note through the editor
    await runKind('links');
    assert.equal(await js(`[...document.querySelectorAll('#synResult li')].map(li => li.textContent).join('|')`), 'Beta');
    await js(`[...document.querySelectorAll('#synResultActions button')].find(b => b.textContent === 'Add to note').click(); 0`);
    await poll(`document.getElementById('editorTextarea').value.includes('## Related\\n- [[Beta]]')`, 'the links in the note');
    assert.equal(await js(`!!document.getElementById('plugin-synapse')`), false, 'the panel should close to show the edit');

    // 5. Flashcards go to Recall, tasks to TaskFlow
    await runKind('flashcards');
    await js(`[...document.querySelectorAll('#synResultActions button')].find(b => b.textContent === 'Add 2 cards to Recall').click(); 0`);
    assert.ok(await js(`App.plugins.find(p => p.name === 'recall').cards.some(c => c.front === 'What ships?' && c.back === 'v2')`));
    await runKind('tasks');
    await js(`[...document.querySelectorAll('#synResultActions button')].find(b => b.textContent === 'Add 2 tasks to TaskFlow').click(); 0`);
    assert.equal(await js(`App.plugins.find(p => p.name === 'taskflow').tasks.filter(t => ['Call Ana', 'Ship v2'].includes(t.title) && t.column === 'todo').length`), 2);
    assert.equal(await js(`new Set(App.plugins.find(p => p.name === 'taskflow').tasks.map(t => t.id)).size === App.plugins.find(p => p.name === 'taskflow').tasks.length`), true, 'task ids collide');

    // 6. Ask your vault: matching notes are sent and offered to open
    await js(`App.openPlugin('synapse')`);
    await poll(`!!${syn}.config`, 'the AI settings');
    await js(`document.getElementById('synQuestion').value = 'What did we decide about the v2 launch?'; document.getElementById('synAsk').click(); 0`);
    await poll(`!${syn}.busy && /Beta says so/.test(document.getElementById('synResult').textContent)`, 'the answer');
    assert.match(requests[requests.length - 1].body.messages[0].content, /<note title="Beta">/);
    assert.ok(await js(`[...document.querySelectorAll('#synResultActions button')].some(b => b.textContent === 'Open Beta')`));

    // 7. OpenRouter: its own key, OpenAI-format endpoint
    await js(`(() => { const s = document.getElementById('synProvider'); s.value = 'openrouter'; s.dispatchEvent(new Event('change')); })()`);
    assert.equal(await js(`document.getElementById('synModel').value`), 'openrouter/auto');
    await js(`document.getElementById('synKey').value = ${JSON.stringify(OPENROUTER_KEY)}; document.getElementById('synSave').click(); 0`);
    await poll(`${syn}.config.provider === 'openrouter' && ${syn}.config.providers.openrouter.hasKey`, 'OpenRouter to be active');
    await runKind('summarize');
    assert.match(await js(`document.getElementById('synResult').textContent`), /from openrouter/);
    const last = requests[requests.length - 1];
    assert.equal(last.url, '/openrouter/chat/completions');
    assert.equal(last.auth, 'Bearer ' + OPENROUTER_KEY);

    afterQuit(() => {
      const file = path.join(vault, '..', 'userData', 'ai.json');
      const disk = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      assert.ok(!disk.includes(ANTHROPIC_KEY) && !disk.includes(OPENROUTER_KEY), 'a plain API key was written to disk');
    });
  },
};
