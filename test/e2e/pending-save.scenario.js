const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A debounced autosave that is still pending when its tab goes away (close / rename) must neither be lost
// nor fire later against the old path. (Delete shares the rename code path but is not run here: it would
// send a file to the real Recycle Bin.)
module.exports = {
  seed: { 'Close.md': 'close original', 'Old.md': 'rename original', 'Dir/Inner.md': 'inner original' },

  async run({ vault, js, sleep }) {
    const poll = async (code, what) => {
      for (let i = 0; i < 100; i++) { if (await js(code)) return; await sleep(50); }
      throw new Error('Timed out waiting for ' + what);
    };
    await js('window.alert = (m) => { window.__lastAlert = String(m); }; window.confirm = () => true; 0');
    const abs = (...p) => path.join(vault, ...p);
    const open = (file) => js(`App.openFile(${JSON.stringify(file)})`);
    const type = (text) => js(`(() => {
      const t = document.getElementById('editorTextarea');
      t.value = ${JSON.stringify(text)};
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    // Runs `start` (an App method call, un-awaited), answers the ask dialog with `text`, waits for it to finish.
    const answer = async (start, text) => {
      await js(`window.__op = ${start}; 0`);
      assert.equal(await js('document.getElementById("askOverlay").classList.contains("visible")'), true, 'ask dialog did not open');
      await js(`(() => {
        const input = document.getElementById('askInput');
        input.value = ${JSON.stringify(text)};
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`);
      await js('window.__op');
    };
    // ~2 s, long enough for a leaked 500 ms debounce to fire: `gone` must never exist, `kept` must hold `text` at the end
    const watch = async (gone, kept, text) => {
      for (let i = 0; i < 40; i++) {
        assert.equal(fs.existsSync(gone), false, gone + ' was recreated by a late save');
        await sleep(50);
      }
      assert.equal(fs.readFileSync(kept, 'utf8'), text);
    };

    await poll('document.querySelectorAll(".file-tree-item").length > 0', 'the file tree');

    // close: the typed text is on disk when closeTab resolves, and no timer writes later
    await open(abs('Close.md'));
    await type('typed before close');
    await js(`App.closeTab(${JSON.stringify(abs('Close.md'))})`);
    assert.equal(fs.readFileSync(abs('Close.md'), 'utf8'), 'typed before close', 'closeTab did not flush');
    assert.equal(await js('App.openTabs.length'), 0);
    fs.writeFileSync(abs('Close.md'), 'changed outside');
    await sleep(900);
    assert.equal(fs.readFileSync(abs('Close.md'), 'utf8'), 'changed outside', 'a stale timer wrote after the tab closed');

    // rename a file with an autosave pending
    await open(abs('Old.md'));
    await type('typed before rename');
    await answer(`App.renameFile(${JSON.stringify(abs('Old.md'))})`, 'New.md');
    await watch(abs('Old.md'), abs('New.md'), 'typed before rename');
    assert.deepEqual(await js('App.openTabs.map(t => t.name)'), ['New.md']);
    assert.equal(await js('App.activeTab'), abs('New.md').replace(/\\/g, '/'));

    // rename a folder that holds an open, dirty note
    await open(abs('Dir', 'Inner.md'));
    await type('typed before folder rename');
    await answer(`App.renameFile(${JSON.stringify(abs('Dir'))})`, 'Moved');
    await watch(abs('Dir'), abs('Moved', 'Inner.md'), 'typed before folder rename');
    const paths = await js('App.openTabs.map(t => t.path)');
    assert.ok(paths.includes(abs('Moved', 'Inner.md').replace(/\\/g, '/')), 'the note inside the folder did not move with it');
    assert.equal(paths.some(p => p.includes('/Dir/')), false, 'a tab still points into the old folder');
    assert.equal(await js('window.__lastAlert'), undefined, 'unexpected alert: ' + await js('window.__lastAlert'));
  },
};
