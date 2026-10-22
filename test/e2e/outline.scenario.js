const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Outline panel: the active note's headings (fenced ones left out) as rows indented by level, from the editor text so unsaved
// typing counts. A click puts the caret at the start of that line of a CRLF note and scrolls to it. Typing refreshes the list
// without taking focus from the editor; another tab, a closed panel and a closed last tab never leave a stale list behind.
const filler = Array.from({ length: 150 }, (_, i) => 'line ' + i).join('\n');
module.exports = {
  seed: {
    'N.md': '# Top\r\ntext\r\n## Sub\r\n~~~\r\n# not\r\n~~~\r\n### Deep',
    'E.md': 'no headings',
    'Long.md': filler + '\n## Far',
  },

  async run({ win, vault, js, sleep }) {
    const q = JSON.stringify;
    const errors = [];
    win.webContents.on('console-message', (e, level, message) => { if (level >= 3) errors.push(message); });
    const poll = async (check, what, ms = 5000) => {
      const end = Date.now() + ms;
      for (;;) {
        if (await check()) return;
        if (Date.now() > end) throw new Error('Timed out waiting for ' + what);
        await sleep(50);
      }
    };
    const rows = () => js('[...document.querySelectorAll("#fileTree .outline-item")].map((e) => e.textContent)');
    const panel = () => js('document.getElementById("fileTree").textContent');
    const click = (text) => js(`[...document.querySelectorAll('#fileTree .outline-item')].find((e) => e.textContent === ${q(text)}).click()`);
    const ta = (code) => js(`(() => { const t = document.getElementById('editorTextarea'); return ${code}; })()`);
    const typeMore = (text) => js(`(() => {
      const t = document.getElementById('editorTextarea');
      t.focus();
      t.value += ${q(text)};
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const open = (name) => js(`App.openFile(${q(path.join(vault, name))})`);

    await js('window.alert = () => {}; window.confirm = () => true; 0');

    // The activity-bar button opens the panel; before any note is open there is nothing to outline
    assert.equal(await js('document.querySelector(".activity-btn[data-panel=outline]").title'), 'Outline');
    await js('document.querySelector(".activity-btn[data-panel=outline]").click()');
    assert.equal(await js('document.querySelector("#sidePanelHeader span").textContent'), 'Outline');
    assert.equal(await panel(), 'Open a note to see its outline.');

    // Headings of N: fenced "# not" left out, one indent class per level
    await open('N.md');
    await poll(async () => (await rows()).length === 3, 'the outline of N');
    assert.deepEqual(await rows(), ['Top', 'Sub', 'Deep']);
    assert.deepEqual(await js('[...document.querySelectorAll("#fileTree .outline-item")].map((e) => +/outline-l(\\d)/.exec(e.className)[1])'), [1, 2, 3]);
    const pad = await js('[...document.querySelectorAll("#fileTree .outline-item")].map((e) => parseFloat(getComputedStyle(e).paddingLeft))');
    assert.ok(pad[0] < pad[1] && pad[1] < pad[2], 'rows are not indented by level: ' + pad);

    // Click: the caret lands at the start of that line of the CRLF note and the editor has focus; Ln/Col follow
    assert.equal(await ta('t.value.includes("\\r")'), false, 'a textarea value keeps CR');
    await click('Sub');
    assert.equal(await ta('document.activeElement === t'), true, 'the editor did not get focus');
    assert.deepEqual(await ta('[t.selectionStart, t.selectionEnd]'), [11, 11]); // "# Top\ntext\n": 13 if the CRs were counted
    assert.equal(await ta('t.value.slice(11, 17)'), '## Sub');
    assert.equal(await js('document.getElementById("statusbarCursor").textContent'), 'Ln 3, Col 1');
    await click('Deep');
    assert.equal(await ta('t.selectionStart'), await ta('t.value.indexOf("### Deep")'));
    assert.equal(await js('document.getElementById("statusbarCursor").textContent'), 'Ln 7, Col 1');
    // The preview-only layout hides the editor (and workspace restore keeps it across launches): a jump brings the split back
    await js("App.setLayout('preview'); 0");
    await click('Sub');
    assert.equal(await js('App._layoutMode'), 'split', 'a jump left the editor hidden');
    assert.equal(await ta('document.activeElement === t'), true, 'the editor did not get focus in the preview-only layout');
    assert.equal(await ta('t.selectionStart'), 11);

    // Typing: a new heading shows up within 1.5 s (unsaved text included), the editor keeps focus, markup stays text
    await typeMore('\n#### New');
    await poll(async () => (await rows()).includes('New'), 'the new heading in the outline', 1500);
    assert.deepEqual(await rows(), ['Top', 'Sub', 'Deep', 'New']);
    assert.equal(await js('document.querySelector("#fileTree .outline-l4").textContent'), 'New');
    assert.equal(await ta('document.activeElement === t'), true, 'refreshing the outline took focus from the editor');
    await typeMore('\n# <img src=x onerror="window.__xss = 1"> & <b>bold</b>');
    await poll(async () => (await rows()).length === 5, 'the markup heading', 1500);
    assert.equal(await js('document.querySelectorAll("#fileTree img, #fileTree b").length'), 0, 'heading text was parsed as HTML');
    assert.equal(await js('window.__xss'), undefined);
    assert.equal((await rows())[4], '<img src=x onerror="window.__xss = 1"> & <b>bold</b>');

    // Another note: its own list, and the empty state; coming back shows the unsaved headings of N
    await open('E.md');
    await poll(async () => (await panel()) === 'No headings.', 'the empty state of E');
    assert.deepEqual(await rows(), []);
    fs.writeFileSync(path.join(vault, 'E.md'), 'no headings\n# From disk'); // a clean tab reloads from disk: the outline follows
    await poll(async () => (await rows()).includes('From disk'), 'the outline of the reloaded E', 8000);
    await open('N.md');
    await poll(async () => (await rows()).length === 5, 'N again');
    assert.deepEqual((await rows()).slice(0, 4), ['Top', 'Sub', 'Deep', 'New']);

    // A closed panel is not refreshed by typing (no stale outline over another panel); reopening shows the current text
    await js('App.togglePanel("backlinks")');
    await poll(async () => (await panel()) === 'No backlinks found.', 'the backlinks panel');
    await typeMore('\n## Later');
    await sleep(600); // negative check: the 300 ms debounce has long fired
    assert.equal(await js('document.querySelectorAll("#fileTree .outline-item").length'), 0, 'typing drew the outline over another panel');
    assert.equal(await panel(), 'No backlinks found.');
    await js('App.togglePanel("outline")');
    assert.ok((await rows()).includes('Later'), 'reopening the panel shows an old outline');

    // A long note: the jump scrolls the heading into view (24.5 px lines; the filler lines do not wrap)
    await open('Long.md');
    await poll(async () => (await rows()).length === 1, 'the outline of Long');
    assert.equal(await ta('t.scrollTop'), 0);
    await click('Far');
    const view = await ta('({ top: t.scrollTop, height: t.clientHeight, caret: t.value.substr(0, t.selectionStart).split("\\n").length - 1 })');
    assert.equal(view.caret, 150, 'the caret is not on the Far line');
    const lineTop = 24 + 150 * 24.5; // padding 24px + 14px * 1.75 per line
    assert.ok(view.top > 0 && view.top <= lineTop && lineTop < view.top + view.height, 'the heading is not in view: ' + JSON.stringify(view));

    // Every tab closed: back to the empty state
    await js('Promise.all([...App.openTabs].map((t) => App.closeTab(t.path)))');
    assert.equal(await js('App.openTabs.length'), 0);
    assert.equal(await panel(), 'Open a note to see its outline.');

    assert.deepEqual(errors, [], 'renderer errors');
  },
};
