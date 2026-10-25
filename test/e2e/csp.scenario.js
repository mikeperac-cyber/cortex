const assert = require('node:assert/strict');
const path = require('node:path');

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'none'";

// The page runs under the CSP without tripping it (load, preview, graph, every plugin panel); the preview goes through the safe
// Markdown renderer (tables, numbered task checkboxes, resolved/unresolved wikilinks, raw HTML as text); and the preload bridge
// hands the page nothing but plain functions: no ipcRenderer, no IpcRendererEvent.
module.exports = {
  seed: {
    'Note.md': '---\ntags: [x]\n---\n# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [ ] one\n- [x] two\n\n' +
      '[[Other]] [[Missing|gone]]\n\n<img src=x onerror="window.__xss = 1">\n',
    'Other.md': '# Other',
  },

  async run({ win, vault, js, sleep }) {
    const messages = [];
    win.webContents.on('console-message', (e, level, message) => messages.push(message));
    const poll = async (check, what, ms = 5000) => {
      const end = Date.now() + ms;
      for (;;) {
        const value = await check();
        if (value) return value;
        if (Date.now() > end) throw new Error('Timed out waiting for ' + what);
        await sleep(50);
      }
    };

    // Reload so violations raised while the page loads (scripts, styles, fonts) are heard too
    win.webContents.reload();
    await poll(() => js('typeof App !== "undefined" && !!App.vaultPath').catch(() => false), 'the reloaded app', 15000);
    await js('window.alert = () => {}; window.confirm = () => true; 0');
    assert.equal(await js('document.querySelector(\'meta[http-equiv="Content-Security-Policy"]\')?.content'), CSP, 'the CSP meta');

    // Preview of a note: safe Markdown with the contract Task 11 relies on
    await js('App.refreshIndex()');
    await js(`App.openFile(${JSON.stringify(path.join(vault, 'Note.md'))})`);
    await js('App.setLayout("split"); 0');
    const preview = (code) => js(`(() => { const p = document.getElementById('previewContent'); return ${code}; })()`);
    await poll(() => preview('!!p.querySelector("table")'), 'the table in the preview');
    assert.deepEqual(await preview('[...p.querySelectorAll("input[type=checkbox]")].map((c) => [c.dataset.task, c.checked, c.disabled])'),
      [['0', false, false], ['1', true, false]]);
    assert.deepEqual(await preview('[...p.querySelectorAll("a.wikilink")].map((a) => [a.className, a.dataset.note, a.textContent])'),
      [['wikilink', 'Other', 'Other'], ['wikilink unresolved', 'Missing', 'gone']]);
    assert.equal(await preview('p.querySelectorAll("img").length'), 0, 'raw HTML became an element');
    assert.ok((await preview('p.textContent')).includes('<img src=x'), 'raw HTML is not shown as text');
    assert.ok(!(await preview('p.textContent')).includes('tags:'), 'frontmatter shown');
    assert.equal(await js('window.__xss'), undefined);

    // The preview follows the current editor text
    await js(`(() => {
      const t = document.getElementById('editorTextarea');
      t.value = '## Edited [[other]]';
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await poll(() => preview('p.querySelector("h2")?.textContent === "Edited other"'), 'the preview to follow the editor');
    assert.equal(await preview('p.querySelector("a.wikilink").className'), 'wikilink', 'stem resolution is case-insensitive');

    // Graph and every plugin panel
    await js('App.togglePanel("graph")');
    await poll(() => js('App._graphCleanup instanceof AbortController'), 'the graph to start');
    await js('App.togglePanel("fileExplorer")');
    for (const name of ['taskflow', 'dailysync', 'recall', 'dataforge', 'focuspulse', 'synapse', 'vaultdoctor']) {
      assert.ok(await js(`App.plugins.some((p) => p.name === ${JSON.stringify(name)})`), 'no plugin ' + name);
      await js(`App.openPlugin(${JSON.stringify(name)}); 0`);
      await sleep(300); // a negative check: give any blocked style/script a moment to be reported
      await js('App.hidePluginPanels(); 0');
    }

    // Preload bridge: subscriptions give back a plain unsubscribe that returns nothing, never the ipcRenderer emitter
    assert.deepEqual(await js(`[
      cortex.onVaultChanged(() => {}),
      cortex.onFlush(() => {}),
      cortex.onMenuAction('x', () => {}),
    ].map((off) => {
      const shape = [typeof off, off && typeof off === 'object' ? Object.keys(off).sort() : (typeof off === 'function' ? Object.keys(off) : [])];
      const leaks = !!off && ['send', 'invoke', 'sendSync', 'on'].some((k) => k in Object(off));
      const back = typeof off === 'function' ? typeof off() : 'none';
      return [shape, leaks, back];
    })`), [[['function', []], false, 'undefined'], [['function', []], false, 'undefined'], [['function', []], false, 'undefined']]);

    // Menu callbacks get no IpcRendererEvent
    await js('window.__menuArgs = null; cortex.onMenuAction("probe", (...a) => { window.__menuArgs = a.length; }); 0');
    win.webContents.send('menu:probe', 'extra');
    await poll(() => js('window.__menuArgs === 0'), 'the menu callback with no arguments');

    const csp = messages.filter((m) => /Content[ -]Security[ -]Policy/i.test(m));
    assert.deepEqual(csp, [], 'CSP messages');
  },
};
