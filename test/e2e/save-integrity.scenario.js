const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Tab identity is the path (never the display name) and "modified" means "not yet on disk".
module.exports = {
  seed: {
    'a/Notes.md': 'in a',
    'b/Notes.md': 'in b',
    'a&quot;b.md': 'weird name', // an HTML entity in a file name must show literally in the tab strip
    'Locked.md': 'locked original',
    'X.md': 'x original',
  },

  async run({ vault, js, sleep }) {
    const poll = async (code, what) => {
      for (let i = 0; i < 100; i++) { if (await js(code)) return; await sleep(50); }
      throw new Error('Timed out waiting for ' + what);
    };
    // every prompt is recorded: nothing in this scenario fails to save at close/switch time, so none may appear
    await js('window.alert = () => {}; window.__confirms = []; window.confirm = (m) => { window.__confirms.push(String(m)); return true; }; 0');
    const abs = (rel) => path.join(vault, rel);
    const slash = (rel) => abs(rel).replace(/\\/g, '/');
    const open = (rel) => js(`App.openFile(${JSON.stringify(abs(rel))})`);
    const type = (text) => js(`(() => {
      const t = document.getElementById('editorTextarea');
      t.value = ${JSON.stringify(text)};
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const tabs = () => js('Array.from(document.querySelectorAll(".editor-tab"))');

    await poll('document.querySelectorAll(".file-tree-item").length > 0', 'the file tree');

    // 1. Two concurrent opens of one file make one tab
    await js(`Promise.all([App.openFile(${JSON.stringify(abs('a/Notes.md'))}), App.openFile(${JSON.stringify(abs('a/Notes.md'))})])`);
    assert.equal(await js('App.openTabs.length'), 1, 'concurrent opens added two tabs for one file');

    // 2. Tabs are found by path: two notes called Notes.md
    await open('b/Notes.md');
    assert.equal(await js('document.querySelectorAll(".editor-tab").length'), 2);
    assert.equal(await js('document.querySelectorAll(".editor-tab")[1].dataset.path'), slash('b/Notes.md'));
    await js('document.querySelectorAll(".editor-tab")[1].click()');
    assert.equal(await js('App.activeTab'), slash('b/Notes.md'), 'clicking the second tab did not activate b/Notes.md');
    await js('document.querySelectorAll(".editor-tab")[0].click()');
    assert.equal(await js('App.activeTab'), slash('a/Notes.md'), 'clicking the first tab did not activate a/Notes.md');
    assert.equal(await js('document.getElementById("editorTextarea").value'), 'in a');

    // 3. Tab titles are text: a name that looks like an HTML entity stays literal, and its close button still finds the tab
    await open('a&quot;b.md');
    assert.equal(await js('Array.from(document.querySelectorAll(".editor-tab")).pop().firstElementChild.textContent'), 'a&quot;b.md');
    await js('Array.from(document.querySelectorAll(".editor-tab")).pop().querySelector(".tab-close").click()');
    await poll('App.openTabs.length === 2', 'the weird-named tab to close');
    assert.equal(await js('document.querySelectorAll(".editor-tab").length'), 2);

    // 4. A failed save keeps the tab modified and says so; the retry after the cause is fixed lands on disk
    const locked = abs('Locked.md');
    await open('Locked.md');
    fs.chmodSync(locked, 0o444);
    try {
      await type('edited while locked');
      assert.equal(await js('App.flushSaves()'), false, 'flushSaves reported success for a failed write');
      assert.equal(await js('App.openTabs.find(t => t.path.endsWith("/Locked.md")).modified'), true, 'a failed save cleared modified');
      assert.match(await js('document.getElementById("statusbarError").textContent'), /Save failed/);
      assert.equal(await js('document.querySelector(".editor-tab.active").classList.contains("modified")'), true, 'dirty tab has no modified marker');
      assert.equal(fs.readFileSync(locked, 'utf8'), 'locked original');
    } finally {
      fs.chmodSync(locked, 0o666);
    }
    assert.equal(await js('App.flushSaves()'), true, 'retry after the file became writable failed');
    assert.equal(fs.readFileSync(locked, 'utf8'), 'edited while locked');
    assert.equal(await js('App.openTabs.find(t => t.path.endsWith("/Locked.md")).modified'), false);
    assert.equal(await js('document.getElementById("statusbarError").textContent'), '');
    assert.equal(await js('document.querySelector(".editor-tab.active").classList.contains("modified")'), false);

    // 5. Switching vault saves what was typed, then closes every tab and shows the welcome screen
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-other-vault-'));
    try {
      fs.writeFileSync(path.join(other, 'Other.md'), 'other vault note');
      await open('X.md');
      await type('typed before the switch');
      await require('../../electron/main.js').setVault(other);
      await poll(`App.vaultPath === ${JSON.stringify(other)} && App.openTabs.length === 0`, 'the renderer to follow the vault switch');
      assert.equal(fs.readFileSync(abs('X.md'), 'utf8'), 'typed before the switch', 'vault switch lost unsaved text');
      assert.equal(await js('document.querySelectorAll(".editor-tab").length'), 0);
      assert.equal(await js('document.getElementById("welcomeDashboard").classList.contains("visible")'), true);
      await poll('document.getElementById("fileTree").textContent.includes("Other.md")', 'the new vault in the file tree');
      assert.deepEqual(await js('window.__confirms'), [], 'a vault switch with everything saved must not ask the user anything');
    } finally {
      await require('../../electron/main.js').setVault(vault).catch(() => {}); // unwatch `other` first: deleting a watched root makes fs.watch report EPERM
      // The app may still be reading the welcome stats from this folder, and Windows then refuses the delete for a moment.
      // Async on purpose: a sync retry blocks this (the app's main) process, so the read could never finish and release the file.
      await fs.promises.rm(other, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
};
