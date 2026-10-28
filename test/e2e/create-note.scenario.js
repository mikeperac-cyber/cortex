const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WELCOME = '# Welcome\n\nSeed content that must survive.\n';

module.exports = {
  seed: { 'Welcome.md': WELCOME },

  async run({ vault, js }) {
    assert.equal(await js('typeof Dialogs'), 'object', 'Dialogs is not defined');

    // Starts App.createFile() un-awaited, answers the ask dialog (text then `key`), then waits for createFile to finish.
    const create = async (text, key = 'Enter') => {
      await js('window.__create = App.createFile(); 0');
      assert.equal(await js('document.getElementById("askOverlay").classList.contains("visible")'), true, 'ask dialog did not open');
      await js(`(() => {
        const input = document.getElementById('askInput');
        input.value = ${JSON.stringify(text)};
        input.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
      })()`);
      await js('window.__create');
      assert.equal(await js('document.getElementById("askOverlay").classList.contains("visible")'), false, 'ask dialog stayed open');
    };
    const activeTab = async () => (await js('App.activeTab')).replace(/\\/g, '/');

    // New note appears on disk, becomes the active tab, and shows in the file tree (stale-cache regression)
    await create('Test Note');
    const created = path.join(vault, 'Test Note.md');
    assert.ok(fs.readFileSync(created, 'utf8').startsWith('# Test Note'), 'new note starts with its title heading');
    assert.ok((await activeTab()).endsWith('/Test Note.md'), 'new note is the active tab');
    assert.ok((await js('document.querySelector(".editor-tab.active").textContent')).includes('Test Note.md'), 'active tab is rendered');
    assert.ok((await js('document.getElementById("fileTree").textContent')).includes('Test Note.md'), 'file tree lists the new note');

    // Creating an existing name never overwrites: content is unchanged and the existing note opens
    await create('Welcome');
    assert.equal(fs.readFileSync(path.join(vault, 'Welcome.md'), 'utf8'), WELCOME, 'existing note was overwritten');
    assert.ok((await activeTab()).endsWith('/Welcome.md'), 'existing note is the active tab');
    assert.equal(await js('document.getElementById("editorTextarea").value'), WELCOME, 'editor shows the untouched content');

    // Esc cancels: nothing is created
    await create('Cancelled', 'Escape');
    assert.deepEqual(fs.readdirSync(vault).sort(), ['Test Note.md', 'Welcome.md']);

    // Creating note inside folder via createFile(folderPath)
    const folderPath = path.join(vault, 'Projects');
    fs.mkdirSync(folderPath, { recursive: true });
    await js('App.renderFileTree()');

    const createInFolder = async (folder, text, key = 'Enter') => {
      await js(`window.__create = App.createFile(${JSON.stringify(folder)}); 0`);
      assert.equal(await js('document.getElementById("askOverlay").classList.contains("visible")'), true, 'ask dialog did not open');
      await js(`(() => {
        const input = document.getElementById('askInput');
        input.value = ${JSON.stringify(text)};
        input.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
      })()`);
      await js('window.__create');
    };

    await createInFolder(folderPath, 'Project Plan');
    const folderCreated = path.join(folderPath, 'Project Plan.md');
    assert.ok(fs.existsSync(folderCreated), 'note inside folder was created on disk');
    assert.ok((await activeTab()).endsWith('/Projects/Project Plan.md'), 'note inside folder is active tab');
  },
};
