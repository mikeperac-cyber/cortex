const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WELCOME = '# Welcome\n\nSeed content that must survive.\n';

// Tab identity must not depend on the path spelling: the file tree hands out native paths (backslashes on Windows)
// while createFile builds its own. These checks deliberately compare raw strings and counts, never normalised paths.
module.exports = {
  seed: { 'Welcome.md': WELCOME },

  async run({ vault, js, sleep }) {
    const poll = async (code, what) => {
      for (let i = 0; i < 100; i++) { if (await js(code)) return; await sleep(50); }
      throw new Error('Timed out waiting for ' + what);
    };
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
    const item = (name) => `document.querySelector('.file-tree-item[data-name="${name}"]')`;
    const treePath = (name) => js(`${item(name)}.dataset.path`);
    const tabNames = () => js('App.openTabs.map(t => t.name)');

    // 1. Open Welcome.md the way a user does (click its tree item), then "create" Welcome: same file, same single tab
    await poll(`!!${item('Welcome.md')}`, 'Welcome.md in the file tree');
    await js(`${item('Welcome.md')}.click()`);
    await poll('App.openTabs.length === 1', 'Welcome.md to open');
    const opened = await js('App.activeTab');

    await answer('App.createFile()', 'Welcome');
    assert.equal(await js('App.openTabs.length'), 1, 'creating an existing note opened a duplicate tab');
    assert.equal(await js('document.querySelectorAll(".editor-tab").length'), 1, 'a duplicate tab was rendered');
    assert.equal(await js('App.activeTab'), opened, 'the already-open tab is no longer the active one');
    assert.equal(fs.readFileSync(path.join(vault, 'Welcome.md'), 'utf8'), WELCOME, 'existing note was overwritten');

    // 2. A tab opened by createFile is found by the tree's own paths: rename and close must not leave a stale tab behind
    await answer('App.createFile()', 'Fresh');
    assert.deepEqual(await tabNames(), ['Welcome.md', 'Fresh.md']);

    await answer(`App.renameFile(${JSON.stringify(await treePath('Fresh.md'))})`, 'Fresh2.md');
    assert.deepEqual(await tabNames(), ['Welcome.md', 'Fresh2.md'], 'rename left the old tab open');

    await js(`App.closeTab(${JSON.stringify(await treePath('Fresh2.md'))})`);
    assert.deepEqual(await tabNames(), ['Welcome.md'], 'closeTab missed the tab opened by createFile');
    assert.equal(await js('document.querySelectorAll(".editor-tab").length'), 1);
  },
};
