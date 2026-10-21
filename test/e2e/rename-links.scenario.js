const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Renaming a note rewrites the wikilinks that resolve to it (never those of a same-named note elsewhere), and open tabs follow
// edits made on disk: a clean tab reloads, a dirty one keeps its text and says "Changed on disk", the app's own saves change nothing.
module.exports = {
  seed: {
    'Old.md': 'see [[Old]]',
    'sub/Old.md': 'nested old',
    'Ref.md': 'see [[Old|the old one]] and [[Old]]',
    'Typing.md': 'typing original',
    'Self.md': 'me [[Self]]',
    'Linker.md': 'go [[Self]]',
    'Box/Note.md': 'boxed',
    'straße.md': 'sharp s',
    'STRASSE.md': 'double s',
    'Target.md': 'target',
    'Locked.md': 'to [[Target]]',
  },

  async run({ vault, js, sleep }) {
    const poll = async (check, what, ms = 5000) => {
      const end = Date.now() + ms;
      for (;;) {
        if (await check()) return;
        if (Date.now() > end) throw new Error('Timed out waiting for ' + what);
        await sleep(50);
      }
    };
    const q = JSON.stringify;
    const abs = (...p) => path.join(vault, ...p);
    const slash = (p) => p.replace(/\\/g, '/');
    const read = (...p) => fs.readFileSync(abs(...p), 'utf8');
    const tabOf = (p) => `App.findTab(${q(slash(p))})`;
    const editor = () => js('document.getElementById("editorTextarea").value');
    const status = () => js('document.getElementById("statusbarError").textContent');
    const alerts = () => js('window.__alerts');
    const open = (p) => js(`App.openFile(${q(p)})`);
    const type = (text) => js(`(() => {
      const t = document.getElementById('editorTextarea');
      t.value = ${q(text)};
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    // Runs `start` (an App method call, un-awaited), answers the ask dialog with `text`, waits for it to finish.
    const answer = async (start, text) => {
      await js(`window.__op = ${start}; 0`);
      assert.equal(await js('document.getElementById("askOverlay").classList.contains("visible")'), true, 'ask dialog did not open');
      await js(`(() => {
        const input = document.getElementById('askInput');
        input.value = ${q(text)};
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`);
      await js('window.__op');
    };
    const rename = (from, to) => answer(`App.renameFile(${q(from)})`, to);

    await js(`window.__alerts = []; window.alert = (m) => window.__alerts.push(String(m)); window.confirm = () => true;
      window.__changed = []; cortex.index.onFileChanged((p) => window.__changed.push(p));
      window.__flashes = [];
      new MutationObserver(() => {
        const text = document.getElementById('statusbarError').textContent;
        if (text.includes('Changed on disk')) window.__flashes.push(text);
      }).observe(document.getElementById('statusbarError'), { childList: true, characterData: true, subtree: true }); 0`);
    await poll(async () => (await js('cortex.index.notes()')).length === 11, 'the initial index scan');

    // 1. Duplicate stems: [[Old]] resolves to the shorter-path root Old.md, so renaming sub/Old.md rewrites nothing
    assert.deepEqual(await js(`cortex.renameFile(${q(abs('sub', 'Old.md'))}, ${q(abs('sub', 'Other.md'))})`), { success: true, updated: [] });
    assert.equal(read('Ref.md'), 'see [[Old|the old one]] and [[Old]]');
    assert.equal(read('Old.md'), 'see [[Old]]');

    // 2. Renaming the root Old.md rewrites Ref.md and Old's own self-link; the open, clean Ref tab follows within 2 s
    await open(abs('Ref.md'));
    assert.equal(await js('App.flushSaves()'), true);
    const r2 = await js(`cortex.renameFile(${q(abs('Old.md'))}, ${q(abs('New.md'))})`);
    assert.equal(r2.success, true);
    assert.deepEqual([...r2.updated].sort(), [abs('New.md'), abs('Ref.md')].sort(), 'updated lists the rewritten notes (absolute, native)');
    assert.equal('failed' in r2, false, 'failed is only present when something failed');
    assert.equal(read('Ref.md'), 'see [[New|the old one]] and [[New]]');
    assert.equal(read('New.md'), 'see [[New]]');
    assert.equal(read('sub', 'Other.md'), 'nested old');
    await poll(() => js(`${tabOf(abs('Ref.md'))}.content.includes('[[New')`), 'the open Ref tab to follow the rewrite', 2000);
    assert.equal(await editor(), 'see [[New|the old one]] and [[New]]');

    // 3. An edit made outside the app reloads a clean tab
    fs.writeFileSync(abs('Ref.md'), 'edited outside');
    await poll(async () => (await editor()) === 'edited outside', 'the clean tab to reload');
    assert.equal(await js(`${tabOf(abs('Ref.md'))}.modified`), false);
    assert.equal(await status(), '');

    // 4. A dirty tab keeps its text when its file changes on disk and says so; its autosave pauses, so the outside edit stays
    //    on disk until the user saves explicitly
    const notice = 'Changed on disk: Ref.md (Ctrl+S keeps yours)';
    await type('my unsaved words'); // its autosave is now pending
    fs.writeFileSync(abs('Ref.md'), 'changed outside again');
    await poll(async () => (await status()).includes('Changed on disk'), 'the Changed on disk notice');
    assert.equal(await status(), notice);
    await type('my unsaved words, more'); // typing on must not start a new autosave either
    await sleep(800); // a negative check: longer than the 500 ms autosave delay
    assert.equal(read('Ref.md'), 'changed outside again', 'an autosave overwrote the outside edit');
    assert.equal(await status(), notice);
    assert.equal(await js(`${tabOf(abs('Ref.md'))}.content`), 'my unsaved words, more');
    assert.equal(await editor(), 'my unsaved words, more');
    assert.equal(await js('App.flushSaves()'), true); // an explicit save (as Ctrl+S, closing the tab or quitting) keeps the tab's text
    assert.equal(read('Ref.md'), 'my unsaved words, more');
    assert.equal(await status(), '', 'a successful save clears the notice');

    // 5. The app's own save, with typing going on while it is written, never shows "Changed on disk"
    const typing = abs('Typing.md');
    await js('window.__flashes = []; 0');
    await open(typing);
    for (const n of [1, 2, 3]) {
      const seen = await js(`window.__changed.filter((p) => p === ${q(typing)}).length`);
      await type('draft ' + n);
      await js(`(async () => {
        const tab = ${tabOf(typing)};
        clearTimeout(App._debounceTimers['save_' + tab.path]);
        window.__save = App.saveFile(tab);
        await Promise.resolve(); // the queued write has taken tab.content and is on its way; it cannot have finished
        const t = document.getElementById('editorTextarea');
        t.value = ${q('draft ' + n + ' and more')};
        t.dispatchEvent(new Event('input', { bubbles: true }));
        clearTimeout(App._debounceTimers['save_' + tab.path]); // stays dirty: only the write above reaches the disk
      })()`);
      assert.equal(await js('window.__save'), true);
      assert.equal(read('Typing.md'), 'draft ' + n);
      await poll(async () => (await js(`window.__changed.filter((p) => p === ${q(typing)}).length`)) > seen, 'the watcher to report our own save', 3000);
      await js(`${tabOf(typing)}.checking`);
      assert.equal(await js(`${tabOf(typing)}.content`), 'draft ' + n + ' and more', 'typing was lost to a reload');
      assert.equal(await editor(), 'draft ' + n + ' and more');
    }
    assert.deepEqual(await js('window.__flashes'), [], 'an own save showed Changed on disk');
    assert.equal(await js('App.flushSaves()'), true);

    // 6. Through the app: every dirty tab is saved first, so no late autosave writes stale links over the rewrite;
    //    the renamed note's tab moves and shows its rewritten self-link, the linking tab follows
    await open(abs('Linker.md'));
    await type('go [[Self]] plus typing'); // autosave still pending
    await open(abs('Self.md'));
    await rename(abs('Self.md'), 'Me.md');
    assert.equal(fs.existsSync(abs('Self.md')), false);
    assert.equal(read('Me.md'), 'me [[Me]]');
    assert.equal(read('Linker.md'), 'go [[Me]] plus typing');
    await poll(() => js(`${tabOf(abs('Me.md'))}?.content === 'me [[Me]]'`), 'the renamed tab to show its rewritten self-link', 2000);
    assert.equal(await editor(), 'me [[Me]]');
    await poll(() => js(`${tabOf(abs('Linker.md'))}.content === 'go [[Me]] plus typing'`), 'the linking tab to follow', 2000);
    for (let i = 0; i < 20; i++) { // ~1 s, longer than the autosave delay
      assert.equal(read('Linker.md'), 'go [[Me]] plus typing', 'a stale autosave overwrote the rewrite');
      await sleep(50);
    }
    assert.deepEqual(await alerts(), []);

    // 7. Folder or file is decided before the rename: a listing that fails afterwards must not open the folder as a note
    const tabsBefore = await js('App.openTabs.length');
    await js(`window.__isFolder = App.isFolder; App.isFolder = async (p) => App.normPath(p) === ${q(slash(abs('Box')))}; 0`);
    try {
      await rename(abs('Box'), 'Crate');
    } finally {
      await js('App.isFolder = window.__isFolder; 0');
    }
    assert.ok(fs.statSync(abs('Crate', 'Note.md')).isFile());
    assert.equal(await js('App.openTabs.length'), tabsBefore, 'renaming a folder opened a tab');
    assert.deepEqual(await alerts(), [], 'renaming a folder raised an alert');

    // 8. straße.md and STRASSE.md are two files on NTFS: two tabs, and renaming or closing one leaves the other alone
    const sharp = slash(abs('straße.md'));
    const double = slash(abs('STRASSE.md'));
    const gasse = slash(abs('Gasse.md'));
    await open(abs('straße.md'));
    await open(abs('STRASSE.md'));
    assert.deepEqual(await js(`App.openTabs.map((t) => t.path).filter((p) => p === ${q(sharp)} || p === ${q(double)})`), [sharp, double], 'straße.md and STRASSE.md share a tab');
    await rename(abs('straße.md'), 'Gasse.md');
    assert.equal(read('Gasse.md'), 'sharp s');
    assert.equal(await js(`App.openTabs.some((t) => t.path === ${q(gasse)} && t.content === 'sharp s')`), true, 'the straße.md tab did not move');
    assert.equal(await js(`App.openTabs.some((t) => t.path === ${q(double)} && t.content === 'double s')`), true, 'renaming straße.md moved the STRASSE.md tab');
    await js(`App.closeTab(${q(gasse)})`);
    assert.equal(await js(`App.openTabs.some((t) => t.path === ${q(gasse)})`), false);
    assert.equal(await js(`App.openTabs.some((t) => t.path === ${q(double)})`), true, 'closing Gasse.md closed STRASSE.md');
    assert.equal(read('STRASSE.md'), 'double s');

    // 9. A linking note that cannot be written does not stop the rename, and one alert names it
    fs.chmodSync(abs('Locked.md'), 0o444);
    try {
      await rename(abs('Target.md'), 'Goal.md');
    } finally {
      fs.chmodSync(abs('Locked.md'), 0o666);
    }
    assert.equal(read('Goal.md'), 'target');
    assert.equal(read('Locked.md'), 'to [[Target]]');
    assert.deepEqual(await alerts(), ['Renamed, but 1 note(s) could not be updated: Locked.md']);
  },
};
