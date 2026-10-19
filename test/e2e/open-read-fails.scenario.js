const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ipcMain } = require('electron');

// A note whose read fails (antivirus/sync lock, offline placeholder, a folder) must not open as an empty, saveable tab:
// the first keystroke would autosave "" over the real text. It is reported instead, and nothing is written.
module.exports = {
  seed: { 'Locked.md': 'precious original', 'Fine.md': 'fine original', 'Sub/Inner.md': 'inner' },

  async run({ vault, js, sleep }) {
    const locked = path.join(vault, 'Locked.md');
    await js('window.__alerts = []; window.alert = (m) => window.__alerts.push(String(m)); 0'); // a blocking alert would hang the run
    for (let i = 0; i < 100 && !(await js('document.querySelectorAll(".file-tree-item").length > 0')); i++) await sleep(50);

    // Stand-ins for main's handlers (they cannot be restored once replaced, so this scenario ends with them): Locked.md
    // cannot be read, every other read is real; writes are recorded and really happen.
    const writes = [];
    ipcMain.removeHandler('read-file');
    ipcMain.handle('read-file', async (event, filePath) => {
      if (/Locked\.md$/.test(filePath)) return { success: false, error: 'EBUSY: resource busy or locked' };
      try { return { success: true, content: fs.readFileSync(filePath, 'utf8') }; } catch (err) { return { success: false, error: err.message }; }
    });
    ipcMain.removeHandler('write-file');
    ipcMain.handle('write-file', async (event, filePath, content) => {
      writes.push(filePath);
      fs.writeFileSync(filePath, content);
      return { success: true };
    });
    const type = (text) => js(`(() => {
      const t = document.getElementById('editorTextarea');
      t.value = ${JSON.stringify(text)};
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);

    // 1. The unreadable note: no tab, one alert naming the note and the error, and typing + waiting writes nothing
    await js(`document.querySelector('.file-tree-item[data-name="Locked.md"]').click()`); // like a user: the tree hides the welcome screen first
    for (let i = 0; i < 100 && !(await js('window.__alerts.length')); i++) await sleep(50);
    assert.equal(await js('App.openTabs.length'), 0, 'a note that could not be read opened as a tab');
    assert.equal(await js('document.getElementById("welcomeDashboard").classList.contains("visible")'), true, 'the editor was left blank, without a tab or the welcome screen');
    assert.equal(await js('document.querySelectorAll(".editor-tab").length'), 0);
    const alerts = await js('window.__alerts');
    assert.equal(alerts.length, 1, 'expected exactly one alert, got ' + JSON.stringify(alerts));
    assert.ok(alerts[0].includes('Locked.md') && alerts[0].includes('EBUSY'), 'the alert does not name the note and the error: ' + alerts[0]);
    await type('typed into nothing');
    await sleep(1200); // well past the 500 ms autosave debounce
    assert.deepEqual(writes, [], 'something was written after a failed open');
    assert.equal(fs.readFileSync(locked, 'utf8'), 'precious original', 'the real note was overwritten');

    // 2. A folder is not a note either
    await js(`App.openFile(${JSON.stringify(path.join(vault, 'Sub'))})`);
    assert.equal(await js('App.openTabs.length'), 0, 'a folder opened as a tab');
    assert.equal((await js('window.__alerts')).length, 2);

    // 3. A readable note still opens, with its text, and without an alert
    await js(`App.openFile(${JSON.stringify(path.join(vault, 'Fine.md'))})`);
    assert.deepEqual(await js('App.openTabs.map(t => [t.name, t.content])'), [['Fine.md', 'fine original']]);
    assert.equal((await js('window.__alerts')).length, 2, 'a readable note raised an alert');
  },
};
