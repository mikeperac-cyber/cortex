const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Closing the window while a note cannot be saved asks first. "Stay" keeps the window and the dirty tab; "discard" closes.
// The refusal is answered slowly (the renderer is blocked ~3.5 s, like a person reading a native dialog): main's 3 s
// flush timeout must not close the window underneath the open question.
module.exports = {
  seed: { 'Locked.md': 'locked original' },

  async run({ win, vault, js, sleep, afterQuit }) {
    const poll = async (check, what, ms = 15000) => {
      const end = Date.now() + ms;
      for (;;) {
        if (await check()) return;
        if (Date.now() > end) throw new Error('Timed out waiting for ' + what);
        await sleep(50);
      }
    };
    const locked = path.join(vault, 'Locked.md');
    const restore = () => { try { fs.chmodSync(locked, 0o666); } catch { /* already gone */ } };
    // The quit this scenario ends with can also happen early (a wrongly closed window), which must not look like a pass;
    // the hooks run on quit even if the process exits before this function's own finally.
    let stayVerified = false;
    afterQuit(restore);
    afterQuit(() => assert.ok(stayVerified, 'the window closed before the "stay" answer was honoured'));
    afterQuit(() => assert.equal(fs.readFileSync(locked, 'utf8'), 'locked original', 'the unsaved text reached the disk'));

    await js(`window.__confirms = []; window.__confirmAnswer = false; window.__confirmDelay = 3500;
      window.confirm = (m) => {
        window.__confirms.push(String(m));
        const end = Date.now() + window.__confirmDelay;
        while (Date.now() < end) { /* block like a native dialog */ }
        return window.__confirmAnswer;
      };
      window.alert = () => {}; 0`);
    await poll(() => js('document.querySelectorAll(".file-tree-item").length > 0'), 'the file tree');
    await js(`App.openFile(${JSON.stringify(locked)})`);
    fs.chmodSync(locked, 0o444);
    try {
      await js(`(() => {
        const t = document.getElementById('editorTextarea');
        t.value = 'cannot be saved';
        t.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);

      // 1. close, answer "stay": the window survives past main's 3 s timeout and the tab is still dirty
      win.close();
      await poll(() => js('window.__confirms.length === 1'), 'the close to ask the user'); // resolves once the blocked renderer is back
      for (let i = 0; i < 40; i++) {
        assert.equal(win.isDestroyed(), false, 'the window closed although the user chose to stay');
        await sleep(50);
      }
      assert.equal(await js('App.openTabs.length === 1 && App.openTabs[0].modified'), true);
      stayVerified = true;

      // 2. close again (the guards were cleared), answer "discard": the app quits
      await js('window.__confirmAnswer = true; window.__confirmDelay = 0; 0');
      win.close();
      await poll(() => win.isDestroyed(), 'the window to close after the user accepted');
    } finally {
      restore();
    }
  },
};
