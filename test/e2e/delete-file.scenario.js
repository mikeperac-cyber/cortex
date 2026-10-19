const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ipcMain } = require('electron');

// Deleting asks first (saying where the file goes), and a deleted note's open tab is closed without any pending
// autosave writing the note back to life.
module.exports = {
  seed: { 'Doomed.md': 'doomed original', 'Keep.md': 'keep original', 'Folder/Inner.md': 'inner original' },

  async run({ vault, js, sleep }) {
    const doomed = path.join(vault, 'Doomed.md');
    const keep = path.join(vault, 'Keep.md');
    const folder = path.join(vault, 'Folder');
    await js(`window.__alerts = []; window.alert = (m) => window.__alerts.push(String(m));
      window.__confirms = []; window.__answer = true;
      window.confirm = (m) => { window.__confirms.push(String(m)); return window.__answer; }; 0`);
    for (let i = 0; i < 100 && !(await js('document.querySelectorAll(".file-tree-item").length > 0')); i++) await sleep(50);

    // Stand-in for main's delete handler (it cannot be restored once replaced, so this scenario ends with it): records the
    // call and really removes the path from the temp vault, so nothing here ever reaches the user's Recycle Bin.
    const deleted = [];
    ipcMain.removeHandler('delete-file');
    ipcMain.handle('delete-file', async (event, filePath) => {
      deleted.push(filePath);
      fs.rmSync(filePath, { recursive: true, force: true });
      return { success: true };
    });
    const type = (text) => js(`(() => {
      const t = document.getElementById('editorTextarea');
      t.value = ${JSON.stringify(text)};
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const tabNames = () => js('App.openTabs.map(t => t.name)');

    // 1. Declined: nothing is deleted
    await js('window.__answer = false; 0');
    await js(`App.deleteFile(${JSON.stringify(keep)})`);
    assert.deepEqual(deleted, [], 'deleted although the user declined');
    assert.ok(fs.existsSync(keep));
    assert.deepEqual(await js('window.__confirms'), ['Move "Keep.md" to the Recycle Bin?']);
    await js('window.__answer = true; window.__confirms = []; 0');

    // 2. A note with unsaved typing in its open tab: the delete handler gets the path, the tab closes, nothing rewrites the note
    await js(`App.openFile(${JSON.stringify(doomed)})`);
    await type('typed just before the delete');
    await js(`App.deleteFile(${JSON.stringify(doomed)})`);
    assert.deepEqual(deleted, [doomed]);
    assert.deepEqual(await tabNames(), []);
    assert.deepEqual(await js('window.__confirms'), ['Move "Doomed.md" to the Recycle Bin?']);

    // 3. The same through another spelling of the path: the tab opened as keep.md is the one deleted as Keep.md
    await js(`App.openFile(${JSON.stringify(path.join(vault, 'keep.md'))})`);
    assert.deepEqual(await tabNames(), ['keep.md']);
    await type('typed just before the delete');
    await js(`App.deleteFile(${JSON.stringify(keep)})`);
    assert.deepEqual(deleted, [doomed, keep]);
    assert.deepEqual(await tabNames(), [], 'the tab opened under another letter case survived the delete');

    // 4. A folder: the prompt says its contents go too, and the tabs inside it close
    await js(`App.openFile(${JSON.stringify(path.join(folder, 'Inner.md'))})`);
    await type('typed just before the delete');
    await js('window.__confirms = []; 0');
    await js(`App.deleteFile(${JSON.stringify(folder)})`);
    assert.deepEqual(deleted, [doomed, keep, folder]);
    assert.deepEqual(await js('window.__confirms'), ['Move "Folder" (and its contents) to the Recycle Bin?']);
    assert.deepEqual(await tabNames(), []);

    // 5. Well past the 500 ms autosave debounce: no write has brought any of them back
    for (let i = 0; i < 20; i++) {
      for (const p of [doomed, keep, folder, path.join(folder, 'Inner.md')]) assert.equal(fs.existsSync(p), false, p + ' was recreated after the delete');
      await sleep(100);
    }
    assert.deepEqual(await js('window.__alerts'), []);
  },
};
