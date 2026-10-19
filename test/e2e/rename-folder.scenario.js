const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = {
  seed: { 'A.md': 'content of A', 'B.md': 'content of B' },

  async run({ vault, js }) {
    await js('window.__alerts = []; window.alert = (m) => window.__alerts.push(String(m)); 0');
    const alerts = () => js('window.__alerts');
    const read = (name) => fs.readFileSync(path.join(vault, name), 'utf8');

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
    const rename = (from, to) => answer(`App.renameFile(${JSON.stringify(path.join(vault, from))})`, to);

    // Renaming onto an existing note is refused and loses nothing
    await rename('A.md', 'B.md');
    assert.match((await alerts()).pop(), /already exists/);
    assert.equal(read('A.md'), 'content of A');
    assert.equal(read('B.md'), 'content of B');

    // Invalid names never reach disk
    await rename('A.md', 'bad:name.md');
    assert.match((await alerts()).pop(), /cannot contain/);
    assert.deepEqual(fs.readdirSync(vault).sort(), ['A.md', 'B.md']);

    // A free name works
    await rename('A.md', 'C.md');
    assert.deepEqual(fs.readdirSync(vault).sort(), ['B.md', 'C.md']);
    assert.equal(read('C.md'), 'content of A');
    assert.equal((await alerts()).length, 2, 'no alert for a valid rename');

    // New folder: created inside the vault, traversal refused
    await answer('App.createFolder()', 'Archive');
    assert.ok(fs.statSync(path.join(vault, 'Archive')).isDirectory());
    assert.ok((await js('document.getElementById("fileTree").textContent')).includes('Archive'), 'file tree lists the new folder');
    await answer('App.createFolder()', '../Escaped');
    assert.equal(fs.existsSync(path.join(vault, '..', 'Escaped')), false, 'folder escaped the vault');
    assert.match((await alerts()).pop(), /dot/);
  },
};
