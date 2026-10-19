const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ipcMain } = require('electron');

// Closing the window right after typing must not lose the text still waiting in the autosave debounce.
module.exports = {
  seed: { 'Note.md': 'original text' },

  async run({ win, vault, js, sleep, afterQuit }) {
    const note = path.join(vault, 'Note.md');
    for (let i = 0; i < 100 && !(await js('document.querySelectorAll(".file-tree-item").length > 0')); i++) await sleep(50);
    await js(`App.openFile(${JSON.stringify(note)})`);
    await js(`(() => {
      const t = document.getElementById('editorTextarea');
      t.value = 'typed-just-now';
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    assert.equal(fs.readFileSync(note, 'utf8'), 'original text', 'the debounce already fired; this would not test the flush');

    // a close where every save succeeds must not ask the user anything (the renderer reports prompts through the console)
    await js(`window.confirm = (m) => { console.log('CONFIRM ' + m); return true; }; 0`);
    const prompts = [];
    win.webContents.on('console-message', (e, level, message) => { if (message.startsWith('CONFIRM')) prompts.push(message); });
    let acks = 0;
    ipcMain.on('app:flushed', () => { acks++; });
    afterQuit(() => {
      assert.equal(fs.readFileSync(note, 'utf8'), 'typed-just-now', 'closing the window lost the unsaved text');
      assert.equal(acks, 1, 'quick repeated closes must share one flush, saw ' + acks);
      assert.deepEqual(prompts, [], 'a close with everything saved must not prompt');
    });
    win.close();
    win.close();
    win.close();
  },
};
