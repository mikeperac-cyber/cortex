const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ipcMain } = require('electron');

// A save that blows up (the IPC call rejects, or main answers with something that is not a result) must show as a
// failed save and must not disable later saves of that tab.
module.exports = {
  seed: { 'Q.md': 'q original' },

  async run({ vault, js, sleep }) {
    for (let i = 0; i < 200 && !(await js('document.querySelectorAll(".file-tree-item").length > 0')); i++) await sleep(50);
    const note = path.join(vault, 'Q.md');
    const type = (text) => js(`(() => {
      const t = document.getElementById('editorTextarea');
      t.value = ${JSON.stringify(text)};
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const status = () => js('document.getElementById("statusbarError").textContent');
    const modified = () => js('App.openTabs[0].modified');

    // Stand-in for main's write handler (it cannot be restored once replaced, so this scenario ends with it):
    // 1st call rejects, 2nd returns a non-result, from the 3rd on it really writes.
    let calls = 0;
    ipcMain.removeHandler('write-file');
    ipcMain.handle('write-file', async (event, filePath, content) => {
      calls++;
      if (calls === 1) throw new Error('boom from main');
      if (calls === 2) return undefined;
      fs.writeFileSync(filePath, content);
      return { success: true };
    });

    await js(`App.openFile(${JSON.stringify(note)})`);

    await type('first');
    assert.equal(await js('App.flushSaves()'), false, 'a rejected write counted as saved');
    assert.match(await status(), /Save failed: .*boom from main/);
    assert.equal(await modified(), true, 'a rejected write cleared modified');

    await type('second');
    assert.equal(await js('App.flushSaves()'), false, 'a non-result counted as saved (the queue died after the first failure?)');
    assert.match(await status(), /Save failed/);
    assert.equal(await modified(), true);

    await type('third');
    assert.equal(await js('App.flushSaves()'), true, 'saving stayed broken after earlier failures');
    assert.equal(fs.readFileSync(note, 'utf8'), 'third');
    assert.equal(await modified(), false);
    assert.equal(await status(), '');
    assert.equal(calls, 3);
  },
};
