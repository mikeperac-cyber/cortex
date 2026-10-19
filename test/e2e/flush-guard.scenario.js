const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ipcMain } = require('electron');

// Text that could not be saved is never dropped without the user's say-so: the vault switch waits for the renderer's
// answer, and "stay" leaves everything as it was. Also: a failing flush request must not wedge later ones.
module.exports = {
  seed: { 'Locked.md': 'locked original' },

  async run({ win, vault, js, sleep }) {
    const { setVault, requestFlush } = require('../../electron/main.js');
    const poll = async (code, what) => {
      for (let i = 0; i < 200; i++) { if (await js(code)) return; await sleep(50); }
      throw new Error('Timed out waiting for ' + what);
    };
    await js(`window.__confirms = []; window.__confirmAnswer = false;
      window.confirm = (m) => { window.__confirms.push(String(m)); return window.__confirmAnswer; };
      window.alert = () => {}; 0`);
    await poll('document.querySelectorAll(".file-tree-item").length > 0', 'the file tree');

    // A throwing webContents.send resolves the request as "proceed" and leaves nothing stuck behind it
    let acks = 0;
    ipcMain.on('app:flushed', () => { acks++; });
    win.webContents.send = () => { throw new Error('send failed'); };
    try {
      assert.equal(await requestFlush(), true, 'a throwing send must resolve the flush as proceed');
    } finally {
      delete win.webContents.send;
    }
    assert.equal(await requestFlush(), true);
    assert.equal(acks, 1, 'the flush request after a failed send never reached the renderer');

    const locked = path.join(vault, 'Locked.md');
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-other-vault-'));
    try {
      fs.writeFileSync(path.join(other, 'Other.md'), 'other vault note');
      await js(`App.openFile(${JSON.stringify(locked)})`);
      fs.chmodSync(locked, 0o444);
      await js(`(() => {
        const t = document.getElementById('editorTextarea');
        t.value = 'cannot be saved';
        t.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);

      // (a) the save fails and the user answers "stay": nothing changes
      await setVault(other);
      for (let i = 0; i < 20; i++) { // give a wrongly-sent vault:changed time to arrive
        assert.equal(await js('App.vaultPath'), vault, 'vault switched although the user chose to stay');
        assert.equal(await js('App.openTabs.length'), 1, 'the dirty tab was closed');
        await sleep(50);
      }
      assert.equal(await js('App.openTabs[0].modified'), true);
      assert.equal(await js('window.__confirms.length'), 1);
      const message = await js('window.__confirms[0]');
      assert.match(message, /could not be saved/);
      assert.ok(message.includes('Locked.md'), 'the prompt does not name the note: ' + message);
      assert.equal(await js('window.cortex.getVaultPath()'), vault, 'main moved its vault root');
      assert.deepEqual(await js(`window.cortex.writeFile(App.vaultPath + '/Probe.md', 'probe')`), { success: true });
      assert.equal(fs.readFileSync(path.join(vault, 'Probe.md'), 'utf8'), 'probe', 'writes no longer go to the old vault');

      // (b) the user accepts the loss: the switch goes ahead and the note is dropped unsaved
      await js('window.__confirmAnswer = true; 0');
      await setVault(other);
      await poll(`App.vaultPath === ${JSON.stringify(other)} && App.openTabs.length === 0`, 'the renderer to follow the vault switch');
      assert.equal(await js('window.cortex.getVaultPath()'), other);
      assert.equal(await js('window.__confirms.length'), 2);
      assert.equal(fs.readFileSync(locked, 'utf8'), 'locked original');
      assert.equal(await js('document.getElementById("welcomeDashboard").classList.contains("visible")'), true);
    } finally {
      fs.chmodSync(locked, 0o666);
      await fs.promises.rm(other, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
};
