const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Ctrl+O quick switcher: fuzzy rows (non-ASCII names typed without diacritics, duplicate stems told apart by folder, names as text),
// recents first when the query is empty, keyboard-only use, and a recents list that is per vault and survives broken storage.
module.exports = {
  seed: {
    'Çalışma.md': '# Çalışma\n', 'Alpha.md': '# Alpha\n', 'Beta.md': '# Beta\n', 'Dup.md': '# Dup\n', 'sub/Dup.md': '# Dup in sub\n', 'a&b.md': '# a and b\n',
  },

  async run({ win, vault, js, sleep }) {
    const { setVault } = require('../../electron/main.js');
    const errors = [];
    win.webContents.on('console-message', (e, level, message) => { if (level >= 3) errors.push(message); });
    const poll = async (check, what, ms = 5000) => {
      const end = Date.now() + ms;
      for (;;) {
        const value = await check();
        if (value) return value;
        if (Date.now() > end) throw new Error('Timed out waiting for ' + what);
        await sleep(50);
      }
    };
    const visible = () => js('document.getElementById("switcherOverlay").classList.contains("visible")');
    const open = async (query = '') => {
      await js('App.openSwitcher(); 0');
      if (query) await type(query);
    };
    const type = (text) => js(`(() => {
      const input = document.getElementById('switcherInput');
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const key = (k, opts = {}, target = 'switcherInput') => js(`document.getElementById(${JSON.stringify(target)}).dispatchEvent(
      new KeyboardEvent('keydown', Object.assign({ key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }, ${JSON.stringify(opts)}))); 0`);
    const rows = () => js(`[...document.querySelectorAll('#switcherResults .switcher-item')].map((r) => [r.querySelector('.switcher-stem').textContent, r.querySelector('.switcher-rel').textContent])`);
    const stems = async () => (await rows()).map((r) => r[0]);
    const selected = () => js(`[...document.querySelectorAll('#switcherResults .switcher-item')].findIndex((r) => r.classList.contains('selected'))`);
    const waitActive = (suffix) => poll(async () => ((await js('App.activeTab')) || '').endsWith(suffix), 'the active tab to end ' + suffix);
    const pick = async (query, suffix) => {
      await open(query);
      await key('Enter');
      await waitActive(suffix);
    };
    const keyOf = (abs) => js(`CortexLib.pathKey(App.normPath(${JSON.stringify(abs)}))`);

    await js('window.alert = () => {}; window.confirm = () => true; 0');
    await poll(() => js('App._notes.length === 6'), 'the index to list the six seed notes');

    // Opens focused, with every note listed (no recents yet: A-Z by stem, accents and case folded)
    assert.equal(await visible(), false, 'the switcher starts hidden');
    await open();
    assert.equal(await visible(), true, 'openSwitcher did not show the overlay');
    assert.equal(await js('document.activeElement && document.activeElement.id'), 'switcherInput', 'the input is not focused');
    assert.deepEqual(await stems(), ['a&b', 'Alpha', 'Beta', 'Çalışma', 'Dup', 'Dup']);
    assert.equal(await selected(), 0, 'the first row is not selected');

    // A name typed without diacritics finds the accented note; Enter opens it and closes the overlay
    await type('calisma');
    assert.deepEqual((await stems())[0], 'Çalışma');
    await key('Enter');
    await waitActive('/Çalışma.md');
    assert.equal(await visible(), false, 'Enter left the overlay open');
    assert.equal(await js('App.openTabs.length'), 1);

    // Duplicate stems are two rows, told apart by the dim path line
    await open('dup');
    assert.deepEqual(await rows(), [['Dup', 'Dup.md'], ['Dup', 'sub/Dup.md']]);

    // Names are text: & and friends arrive untouched, in their own element
    await type('a&b');
    assert.deepEqual(await rows(), [['a&b', 'a&b.md']]);
    assert.equal(await js('document.querySelector("#switcherResults .switcher-stem").children.length'), 0);

    // Recents come first when the query is empty: open Beta, then Alpha
    await pick('beta', '/Beta.md');
    await pick('alpha', '/Alpha.md');
    await open();
    assert.deepEqual((await stems()).slice(0, 3), ['Alpha', 'Beta', 'Çalışma'], 'recents are not MRU-first');

    // Keyboard only: ArrowDown moves the selection (and stops at the ends), Enter opens the selected row
    await key('ArrowUp');
    assert.equal(await selected(), 0, 'ArrowUp ran off the top');
    await key('ArrowDown');
    assert.equal(await selected(), 1);
    await key('ArrowDown'); await key('ArrowUp');
    assert.equal(await selected(), 1);
    await key('Enter');
    await waitActive('/Beta.md');
    assert.equal(await visible(), false);

    // No match: a message, no rows, and Enter opens nothing (the overlay stays for another try)
    await open('zzzz');
    assert.equal(await js('document.getElementById("switcherResults").textContent'), 'No matching notes');
    assert.deepEqual(await rows(), []);
    const tabs = await js('App.openTabs.length');
    const active = await js('App.activeTab');
    await key('Enter');
    await sleep(200); // negative check: nothing may happen
    assert.equal(await js('App.openTabs.length'), tabs, 'Enter on no results opened a tab');
    assert.equal(await js('App.activeTab'), active);
    assert.equal(await visible(), true);

    // Escape closes it (even from the empty state above) and gives the focus back to where it was
    await key('Escape');
    assert.equal(await visible(), false, 'Escape left the no-match overlay open');
    await js('document.getElementById("editorTextarea").focus(); 0');
    await open('alpha');
    await key('Escape');
    assert.equal(await visible(), false, 'Escape left the overlay open');
    assert.equal(await js('document.activeElement && document.activeElement.id'), 'editorTextarea', 'the focus did not return to the editor');

    // Ctrl+O toggles it, but not over the ask dialog (which only swallows Esc/Enter/Tab)
    const ctrlO = (target) => js(`${target}.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true })); 0`);
    await ctrlO('document');
    assert.equal(await visible(), true, 'Ctrl+O did not open the switcher');
    await ctrlO('document');
    assert.equal(await visible(), false, 'Ctrl+O did not close it again');
    await js('window.__ask = Dialogs.ask({ title: "Blocking" }); 0');
    await ctrlO('document.getElementById("askInput")');
    assert.equal(await visible(), false, 'Ctrl+O opened the switcher over the ask dialog');
    await key('Escape', {}, 'askInput');
    assert.equal(await js('window.__ask'), null);

    // Mouse: a click on a row opens it; a click on the dim backdrop closes the overlay, a click inside it does not
    await open('beta');
    await js('document.querySelector("#switcherResults .switcher-item").click(); 0');
    await waitActive('/Beta.md');
    assert.equal(await visible(), false, 'a row click left the overlay open');
    await open('alpha');
    await js('document.querySelector("#switcherOverlay .command-palette").click(); 0');
    assert.equal(await visible(), true, 'a click inside the box closed the overlay');
    await js('document.getElementById("switcherOverlay").click(); 0');
    assert.equal(await visible(), false, 'a backdrop click left the overlay open');

    // The palette lists it, and the two overlays never stack
    assert.equal(await js('App.commands.some((c) => c.name === "Quick Open" && c.shortcut === "Ctrl+O")'), true, 'no Quick Open command');
    await js(`(() => {
      App.openCommandPalette();
      const input = document.getElementById('commandInput');
      input.value = 'quick open';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#commandResults .command-result-item').click();
    })()`);
    assert.equal(await visible(), true, 'the palette command did not open the switcher');
    assert.equal(await js('document.getElementById("commandPaletteOverlay").classList.contains("visible")'), false, 'the palette stayed open');
    await js('App.openCommandPalette(); 0');
    assert.equal(await visible(), false, 'opening the palette left the switcher open');
    await js('App.closeCommandPalette(); 0');

    // Recents are stored per vault, as keys, newest first
    const stored = () => js('JSON.parse(localStorage.getItem("cortex_recent:" + App.vaultPath))');
    assert.deepEqual(await stored(), [await keyOf(path.join(vault, 'Beta.md')), await keyOf(path.join(vault, 'Alpha.md')), await keyOf(path.join(vault, 'Çalışma.md'))]);

    // Garbage or unreadable storage never breaks the switcher or tab switching
    await js('localStorage.setItem("cortex_recent:" + App.vaultPath, "{not json"); App._recent = null; 0');
    await open();
    assert.equal((await rows()).length, 6, 'garbage in storage broke the list');
    await js('localStorage.setItem("cortex_recent:" + App.vaultPath, JSON.stringify([7, null, "x"])); App._recent = null; 0');
    await open();
    assert.equal((await rows()).length, 6);
    await key('Escape');
    await js(`(() => {
      window.__realGet = Storage.prototype.getItem; window.__realSet = Storage.prototype.setItem;
      Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error('storage blocked'); };
      App._recent = null;
    })()`);
    try {
      await pick('alpha', '/Alpha.md');
      await js('App.switchTab(App.openTabs[0].path); 0');
      await open();
      assert.equal((await rows()).length, 6, 'blocked storage broke the list');
      await key('Escape');
    } finally {
      await js('Storage.prototype.getItem = window.__realGet; Storage.prototype.setItem = window.__realSet; 0');
    }

    // A vault switch starts from that vault's own list: tabs closing on the way out do not write into it
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-e2e-other-'));
    fs.writeFileSync(path.join(other, 'Other.md'), '# Other\n');
    try {
      assert.ok((await js('App.openTabs.length')) > 1, 'the vault switch needs several open tabs');
      assert.equal(await setVault(other), true, 'the vault switch was refused');
      await poll(() => js('App.vaultPath === ' + JSON.stringify(other) + ' && App._notes.length === 1'), 'the new vault in the renderer');
      assert.equal(await js('App._recent'), null, 'the old vault list was kept');
      assert.equal(await js('localStorage.getItem("cortex_recent:" + App.vaultPath)'), null, 'the old vault tabs were recorded in the new vault');
      await open();
      assert.deepEqual(await rows(), [['Other', 'Other.md']]);
      await key('Escape');
    } finally {
      await setVault(vault).catch(() => {}); // unwatch `other` before it is deleted
      await fs.promises.rm(other, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }

    assert.deepEqual(errors, [], 'renderer errors');
  },
};
