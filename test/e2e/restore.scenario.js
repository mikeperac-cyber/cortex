const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Workspace restore, per vault: the open tabs (in order), the active tab, the side panel and the layout come back. A note gone
// from disk is skipped without an alert, a garbage stored value restores nothing, and a vault switch writes the old vault's
// workspace at once without writing one for the new vault while the old tabs are torn down. The app cannot restart inside a
// scenario, so a restart is simulated: save, close every tab, put panel and layout back to their defaults, restore.
module.exports = {
  seed: { 'A.md': '# Alpha\n', 'B.md': '# Beta\n## Two\n', 'C.md': '# Gamma\n' },

  async run({ win, vault, js, sleep }) {
    const { setVault } = require('../../electron/main.js');
    const q = JSON.stringify;
    const errors = [];
    win.webContents.on('console-message', (e, level, message) => { if (level >= 3) errors.push(message); });
    const poll = async (check, what, ms = 5000) => {
      const end = Date.now() + ms;
      for (;;) {
        if (await check()) return;
        if (Date.now() > end) throw new Error('Timed out waiting for ' + what);
        await sleep(50);
      }
    };
    const norm = (name, root = vault) => path.join(root, name).replace(/\\/g, '/');
    const [A, B, C] = ['A.md', 'B.md', 'C.md'].map((n) => norm(n));
    const other = path.join(path.dirname(vault), 'other'); // the second vault, in this run's temp tree
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, 'A.md'), '# Other A\n');
    const state = () => js(`({
      tabs: App.openTabs.map((t) => t.path),
      strip: [...document.querySelectorAll('.editor-tab')].map((e) => e.textContent),
      active: App.activeTab,
      panel: App.sidebarPanel,
      header: document.querySelector('#sidePanelHeader span').textContent,
      outline: [...document.querySelectorAll('#fileTree .outline-item')].map((e) => e.textContent),
      layout: App._layoutMode,
      body: ['layout-editor-only', 'layout-preview-only'].filter((c) => document.body.classList.contains(c)),
      welcome: document.getElementById('welcomeDashboard').classList.contains('visible'),
    })`);
    const restoredAB = (active, outline) => ({
      tabs: [A, B], strip: ['A.md', 'B.md'], active, panel: 'outline', header: 'Outline', outline,
      layout: 'editor', body: ['layout-editor-only'], welcome: false,
    });
    const stored = async (key) => JSON.parse(await js(`localStorage.getItem(${q(key)})`));

    await js('window.__alerts = []; window.alert = (m) => { window.__alerts.push(String(m)); }; window.confirm = () => true; 0');
    await poll(() => js('document.getElementById("welcomeDashboard").classList.contains("visible")'), 'the end of startup');
    const key = 'cortex_workspace:' + await js('App.vaultPath');
    const otherKey = 'cortex_workspace:' + other;

    // 1. A, B and C open, B active, the Outline panel, the editor-only layout (the layout button, as a user would)
    for (const p of [A, B, C]) await js(`App.openFile(${q(p)})`);
    await js(`App.switchTab(${q(B)}); App.togglePanel('outline'); document.getElementById('btnLayoutCycle').click(); 0`);
    assert.equal(await js('App._layoutMode'), 'editor');

    // 2. C leaves the disk (and the index); its tab stays open
    fs.unlinkSync(path.join(vault, 'C.md'));
    await poll(() => js('App._notes.length === 2'), 'C.md to leave the index');

    // 3. The immediate save writes the workspace under this vault's key
    await js('App.saveWorkspace(); 0');
    const workspace = { tabs: [A, B, C], active: B, panel: 'outline', layout: 'editor' };
    assert.deepEqual(await stored(key), workspace);

    // 4. "Restart": A and B come back in order with B active, the Outline of B, the editor layout; the missing C raises no alert
    assert.equal(await js(`(() => {
      [...App.openTabs].forEach((t) => App.removeTab(t));
      App.togglePanel('fileExplorer');
      App.setLayout('split');
      return App.restoreWorkspace();
    })()`), true);
    assert.deepEqual(await state(), restoredAB(B, ['Beta', 'Two']));
    assert.equal(await js('document.querySelector(".activity-btn[data-panel=outline]").classList.contains("active")'), true);
    assert.deepEqual(await js('window.__alerts'), []);
    // with tabs open a restore changes nothing
    assert.equal(await js('App.restoreWorkspace()'), false);
    assert.deepEqual(await state(), restoredAB(B, ['Beta', 'Two']));

    // 5. A garbage stored value restores nothing and throws nothing; the Welcome screen stays
    assert.deepEqual(await js(`(async () => {
      [...App.openTabs].forEach((t) => App.removeTab(t));
      localStorage.setItem(${q(key)}, '{bad');
      const restored = await App.restoreWorkspace();
      return { restored, tabs: App.openTabs.length, welcome: document.getElementById('welcomeDashboard').classList.contains('visible') };
    })()`), { restored: false, tabs: 0, welcome: true });
    assert.equal(await js(`localStorage.setItem(${q(key)}, ${q(q(workspace))}); App.restoreWorkspace()`), true);
    assert.deepEqual(await state(), restoredAB(B, ['Beta', 'Two']));

    // 6. Vault switch right after a tab switch (its debounced save still pending): the old vault's workspace is written at once
    //    with that switch; the new vault (no workspace of its own) restores nothing, and tearing the old tabs down writes no
    //    workspace under its key
    await js(`App.switchTab(${q(A)}); 0`);
    assert.equal(await setVault(other), true);
    await poll(() => js(`App.vaultPath === ${q(other)} && !App._restoring && App._notes.length === 1`), 'the switch to the other vault');
    await sleep(600); // negative check: any save the teardown scheduled (300 ms) would have fired by now
    assert.deepEqual(await stored(key), { ...workspace, tabs: [A, B], active: A });
    assert.equal(await js(`localStorage.getItem(${q(otherKey)})`), null, 'the teardown wrote a workspace under the new vault');
    assert.deepEqual(await js('[App.openTabs.length, document.getElementById("welcomeDashboard").classList.contains("visible")]'), [0, true]);

    // 7. Switching back restores A and B (A active, as it was left); the other vault's empty workspace was written on leaving
    assert.equal(await setVault(vault), true);
    await poll(() => js(`App.vaultPath === ${q(vault)} && !App._restoring && App.openTabs.length === 2`), 'the restore after switching back');
    assert.deepEqual(await state(), restoredAB(A, ['Alpha']));
    assert.deepEqual((await stored(otherKey)).tabs, []);

    assert.deepEqual(await js('window.__alerts'), []);
    assert.deepEqual(errors, [], 'renderer errors');
  },
};
