const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = {
  seed: { 'A.md': 'content of A', 'B.md': 'content of B' },

  async run({ vault, js, sleep }) {
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

    // Renaming a FILE keeps its tab: the open one moves in place, an unopened one opens at the new path
    const alertsBefore = (await alerts()).length;
    const tabs = () => js('App.openTabs.map(t => t.name)');
    await js(`App.openFile(${JSON.stringify(path.join(vault, 'C.md'))})`);
    await rename('C.md', 'D.md');
    assert.deepEqual(await tabs(), ['D.md'], 'the open tab did not move with the renamed file');
    assert.ok((await js('App.activeTab')).endsWith('/D.md'));
    await rename('B.md', 'E.md');
    assert.deepEqual(await tabs(), ['D.md', 'E.md'], 'renaming an unopened file did not open it');
    assert.ok((await js('App.activeTab')).endsWith('/E.md'));

    // Windows refuses to rename a folder (EPERM/EBUSY) while a handle is open on it, and the app's own background scans of
    // the vault (tree listing, note cache) briefly hold one: retry the way fs.rm's maxRetries does, discarding the transient alert.
    const renameFolder = async (from, to) => {
      for (let i = 0; i < 20; i++) {
        const before = (await alerts()).length;
        await rename(from, to);
        const now = await alerts();
        if (now.length === before || !/EPERM|EBUSY/.test(now[now.length - 1])) return;
        await js('window.__alerts.pop(); 0');
        await sleep(100);
      }
    };

    // Renaming a FOLDER opens nothing (there is no note to show) and raises no alert; a tab inside it follows its file
    fs.writeFileSync(path.join(vault, 'Archive', 'Inner.md'), 'inner');
    await js(`App.openFile(${JSON.stringify(path.join(vault, 'Archive', 'Inner.md'))})`);
    assert.deepEqual(await tabs(), ['D.md', 'E.md', 'Inner.md']);
    await renameFolder('Archive', 'Archive2');
    assert.deepEqual(await tabs(), ['D.md', 'E.md', 'Inner.md'], 'renaming a folder opened a tab');
    assert.ok((await js('App.openTabs[2].path')).endsWith('/Archive2/Inner.md'), 'the tab inside the folder did not follow it');
    await answer('App.createFolder()', 'Empty');
    await renameFolder('Empty', 'Empty2');
    assert.deepEqual(await tabs(), ['D.md', 'E.md', 'Inner.md'], 'renaming an empty folder opened a tab');
    assert.ok(fs.statSync(path.join(vault, 'Empty2')).isDirectory());
    assert.equal((await alerts()).length, alertsBefore, 'a valid rename raised an alert');
  },
};
