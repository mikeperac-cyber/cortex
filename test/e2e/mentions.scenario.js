const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The Backlinks panel also lists unlinked mentions: other notes naming the open note in plain text. Link turns exactly that
// occurrence into a wikilink on disk without opening the note; a mention that moved on disk is refused (alert, nothing written);
// the source's dirty open tab is saved first, so its typing and the link both survive; a tab whose file changed on disk under
// unsaved typing is never written over.
module.exports = {
  seed: {
    'Target.md': '# Target\nmentions Src here',
    'Src.md': 'I read about target today. See [[Target]] too.',
    'Other.md': 'nothing here',
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
    const abs = (name) => path.join(vault, name);
    const slash = (p) => p.replace(/\\/g, '/');
    const read = (name) => fs.readFileSync(abs(name), 'utf8');
    const open = (name) => js(`App.openFile(${q(abs(name))})`);
    const panel = () => js('document.getElementById("fileTree").textContent');
    const waitPanel = async (check, what) => {
      let last;
      try {
        await poll(async () => check(last = await panel()), what);
      } catch (err) {
        throw new Error(`${err.message}; the panel shows ${q(last)}`);
      }
    };
    // each panel row as [stem, has a Link button]
    const rows = () => js(`[...document.querySelectorAll('#fileTree .panel-row')].map((r) => [r.querySelector('.file-name').textContent, !!r.querySelector('button')])`);
    const clickLink = (stem) => js(`[...document.querySelectorAll('#fileTree .panel-row')]
      .find((r) => r.querySelector('button') && r.querySelector('.file-name').textContent === ${q(stem)}).querySelector('button').click(); 0`);
    const mentionsOf = (name) => js(`cortex.index.mentions(${q(abs(name))})`);
    const alerts = () => js('window.__alerts');
    const tab = (name, code) => js(`(() => { const t = App.findTab(${q(slash(abs(name)))}); return ${code}; })()`);
    const type = (text) => js(`(() => {
      const t = document.getElementById('editorTextarea');
      t.value = ${q(text)};
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const holdAutosave = (name) => tab(name, `(clearTimeout(App._debounceTimers['save_' + t.path]), 0)`); // stays dirty until flushed

    await js('window.__alerts = []; window.alert = (m) => window.__alerts.push(String(m)); window.confirm = () => true; 0');
    await poll(async () => (await js('cortex.index.notes()')).length === 3, 'the initial index scan');

    // 1. Target's panel: its backlink, then the plain-text mention in Src with a real Link button
    await open('Target.md');
    await js('App.togglePanel("backlinks")');
    await waitPanel((t) => t.includes('1 backlink') && t.includes('Unlinked mentions (1)'), 'the backlink and the mention');
    assert.deepEqual(await rows(), [['Src', false], ['Src', true]]);
    assert.equal(await js('document.querySelector("#fileTree .panel-row button").tagName'), 'BUTTON');

    // 2. Link: exactly that occurrence becomes a wikilink, its text kept as alias; the note is not opened; the section goes,
    //    the backlink stays, the status bar says so
    await clickLink('Src');
    await poll(() => read('Src.md') !== 'I read about target today. See [[Target]] too.', 'the link on disk');
    assert.equal(read('Src.md'), 'I read about [[Target|target]] today. See [[Target]] too.');
    await waitPanel((t) => !t.includes('Unlinked mentions'), 'the mention section to go');
    assert.deepEqual(await rows(), [['Src', false]]);
    assert.equal(await js('App.openTabs.length'), 1, 'Link opened the note');
    assert.ok((await js('App.activeTab')).endsWith('/Target.md'));
    await poll(async () => (await js('document.getElementById("statusbarNotice").textContent')) === 'Linked in Src', 'the notice');

    // 3. A mention whose note was edited on disk after the list was made: alert, the file is left alone, the list is redrawn
    fs.writeFileSync(abs('Other.md'), 'about Target here');
    await poll(async () => (await mentionsOf('Target.md')).length === 1, 'the index to see the new mention');
    const [moved] = await mentionsOf('Target.md');
    assert.deepEqual([moved.stem, moved.line, moved.col, moved.text], ['Other', 0, 6, 'about Target here']);
    fs.writeFileSync(abs('Other.md'), 'no mention now');
    await js(`App.linkMention(${q(moved)})`);
    assert.deepEqual(await alerts(), ['That note changed — the list was refreshed.']);
    assert.equal(read('Other.md'), 'no mention now');
    await waitPanel((t) => t.includes('1 backlink') && !t.includes('Unlinked mentions'), 'the redrawn list');

    // 4. The section shows without backlinks too: Src has none, but Target names it
    fs.writeFileSync(abs('Src.md'), read('Src.md') + '\nTarget again');
    await poll(async () => (await mentionsOf('Target.md')).length === 1, 'the new mention in Src');
    await open('Src.md');
    await waitPanel((t) => t.includes('No backlinks found.') && t.includes('Unlinked mentions (1)'), 'the mentions of Src');
    assert.deepEqual(await rows(), [['Target', true]]);

    // 5. Src is open with unsaved typing: it is saved first, then linked; typing and link are both on disk and in the tab
    const typed = read('Src.md') + '\ntyped, not saved';
    await type(typed);
    await holdAutosave('Src.md');
    await open('Target.md');
    await waitPanel((t) => t.includes('Unlinked mentions (1)'), 'the mention in Src');
    assert.equal(await tab('Src.md', 't.modified'), true, 'the typing must still be unsaved');
    await clickLink('Src');
    const linked = 'I read about [[Target|target]] today. See [[Target]] too.\n[[Target]] again\ntyped, not saved';
    await poll(() => read('Src.md') === linked, 'the typing and the link on disk');
    await poll(() => tab('Src.md', `t.content === ${q(linked)} && !t.modified`), 'the Src tab to show the link');
    await sleep(300); // negative check: no late "Changed on disk" from the watcher
    assert.equal(await js('document.getElementById("statusbarError").textContent'), '');
    assert.deepEqual(await alerts(), ['That note changed — the list was refreshed.'], 'an alert during the dirty link');

    // 6. Src changed on disk under unsaved typing: saving it first would overwrite that change, so nothing is written
    await open('Src.md');
    await type(linked + '\nmine');
    await holdAutosave('Src.md');
    fs.writeFileSync(abs('Src.md'), 'outside: Target');
    await poll(() => tab('Src.md', 't.changedOnDisk === true'), 'the outside edit to be noticed');
    await open('Target.md');
    await waitPanel((t) => t.includes('Unlinked mentions (1)'), 'the mention in the outside edit');
    await clickLink('Src');
    await poll(async () => (await alerts()).length === 2, 'the changed-on-disk alert');
    assert.match((await alerts())[1], /changed on disk/i);
    await sleep(300); // negative check: nothing may be written
    assert.equal(read('Src.md'), 'outside: Target', 'the outside edit was overwritten');
    assert.ok((await tab('Src.md', 't.content')).endsWith('mine'), 'typed text was touched');

    assert.deepEqual(errors, [], 'renderer errors');
  },
};
