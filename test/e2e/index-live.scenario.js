const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The vault index follows the disk while the app runs: new, deleted and renamed notes (and folders) reach cortex.index.* without a
// rescan, `vault:index-updated` / `vault:file-changed` arrive in the renderer, and a vault switch re-points index and watcher
// together, but only once the renderer has not vetoed it.
module.exports = {
  seed: { 'Welcome.md': '# Welcome\n\nHello there.\n' },

  async run({ vault, js, sleep }) {
    const { setVault } = require('../../electron/main.js');
    const poll = async (check, what, ms = 5000) => {
      const end = Date.now() + ms;
      for (;;) {
        const value = await check();
        if (value) return value;
        if (Date.now() > end) throw new Error('Timed out waiting for ' + what);
        await sleep(50);
      }
    };
    // Windows refuses to rename or delete a folder while a file inside it is open, and the index may be reading one for a few ms.
    // Async on purpose: a blocking retry would stall the main process that has to finish that read.
    const retry = async (fn) => {
      for (let i = 0; ; i++) {
        try { return fn(); } catch (err) { if (i >= 40 || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(err.code)) throw err; }
        await sleep(50);
      }
    };
    const rels = async (root = vault) => (await js('cortex.index.notes()')).map((n) => path.relative(root, n.path)).sort();
    const waitRels = async (expected, what, root = vault, ms = 5000) => {
      const want = JSON.stringify([...expected].sort());
      let last;
      try {
        await poll(async () => (last = JSON.stringify(await rels(root))) === want, what, ms);
      } catch (err) {
        throw new Error(`${err.message}; the index has ${last}, wanted ${want}`);
      }
    };

    // Nothing may escape the main process unnoticed: an unhandled rejection or a console.error from main is a failure
    const problems = [];
    const onBad = (err) => problems.push(String((err && err.stack) || err));
    process.on('unhandledRejection', onBad);
    process.on('uncaughtException', onBad);
    const realError = console.error;
    console.error = (...args) => { if (args[0] !== '[renderer]') problems.push(args.map(String).join(' ')); realError(...args); };

    const welcome = path.join(vault, 'Welcome.md');
    const fresh = path.join(vault, 'Fresh.md');
    const locked = path.join(vault, 'Locked.md');
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-other-vault-'));
    try {
      await js(`window.__confirmAnswer = false; window.confirm = () => window.__confirmAnswer; window.alert = () => {};
        window.__upd = 0; window.__updArgs = []; window.__upd2 = 0; window.__files = [];
        window.__unsub = cortex.index.onUpdated((...a) => { window.__upd++; window.__updArgs.push(a.length); });
        cortex.index.onUpdated(() => { window.__upd2++; });
        cortex.index.onFileChanged((...a) => { window.__files.push(a); }); 0`);
      await poll(() => js('document.querySelectorAll(".file-tree-item").length > 0'), 'the file tree');
      await waitRels(['Welcome.md'], 'the initial scan');
      assert.equal((await js('cortex.index.resolve("welcome")')).path, welcome);
      assert.deepEqual((await js('cortex.index.graph()')).nodes.map((n) => n.id), [welcome]);
      assert.deepEqual((await js('cortex.index.search("hello")')).map((r) => r.path), [welcome]);
      // The page gets a plain function, and calling it gives back nothing: removeListener returns ipcRenderer itself,
      // which contextBridge would copy into the page (raw send/invoke on any channel).
      assert.deepEqual(await js(`['onUpdated', 'onFileChanged'].map((name) => {
        const off = cortex.index[name](() => {});
        return [typeof off, Object.keys(off).length, typeof off()];
      })`), [['function', 0, 'undefined'], ['function', 0, 'undefined']], 'an unsubscribe function leaked something to the page');

      // 1. a note written from outside appears (with its link and tag), and the renderer is told
      fs.writeFileSync(fresh, '[[Welcome]] #t');
      await waitRels(['Fresh.md', 'Welcome.md'], 'Fresh.md to be indexed', vault, 3000);
      assert.deepEqual((await js(`cortex.index.backlinks(${JSON.stringify(welcome)})`)).map((b) => b.stem), ['Fresh']);
      assert.ok((await js('cortex.index.tags()')).some((t) => t.tag === 't'), 'the tag t is missing');
      await poll(() => js('window.__upd > 0'), 'vault:index-updated', 3000);
      await poll(() => js(`window.__files.some((a) => a.length === 1 && a[0] === ${JSON.stringify(fresh)})`), 'vault:file-changed with the absolute path', 3000);
      assert.equal(await js('window.__updArgs.every((n) => n === 0)'), true, 'onUpdated callbacks must get no arguments');

      // 2. deleting it while watched drops it
      fs.unlinkSync(fresh);
      await waitRels(['Welcome.md'], 'Fresh.md to leave the index', vault, 3000);
      assert.deepEqual(await js(`cortex.index.backlinks(${JSON.stringify(welcome)})`), []);

      // 3. a folder with a note: created, renamed (only the new path stays), deleted
      const sub = path.join(vault, 'sub');
      const sub2 = path.join(vault, 'sub2');
      fs.mkdirSync(sub);
      fs.writeFileSync(path.join(sub, 'Inner.md'), '# Inner\n');
      await waitRels(['Welcome.md', path.join('sub', 'Inner.md')], 'sub/Inner.md to be indexed');
      await retry(() => fs.renameSync(sub, sub2));
      await waitRels(['Welcome.md', path.join('sub2', 'Inner.md')], 'the folder rename to show in the index');
      await retry(() => fs.rmSync(sub2, { recursive: true }));
      await waitRels(['Welcome.md'], 'the folder delete to show in the index');

      // 4. a vetoed vault switch leaves index and watcher on the original vault
      fs.writeFileSync(path.join(other, 'Other.md'), '# Other\n');
      fs.writeFileSync(locked, 'locked original');
      await waitRels(['Locked.md', 'Welcome.md'], 'Locked.md to be indexed');
      await js(`App.openFile(${JSON.stringify(locked)})`);
      fs.chmodSync(locked, 0o444); // the save of the dirty tab then fails, so the renderer asks, and answers "stay"
      await js(`(() => {
        const t = document.getElementById('editorTextarea');
        t.value = 'cannot be saved';
        t.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      const before = await js('cortex.index.notes()');
      assert.equal(await setVault(other), false, 'a vetoed vault switch must report false');
      assert.deepEqual(await js('cortex.index.notes()'), before, 'a vetoed switch changed the index');
      fs.writeFileSync(path.join(vault, 'After.md'), '# After veto\n');
      await waitRels(['After.md', 'Locked.md', 'Welcome.md'], 'the old vault to stay watched after the veto');

      // 5. an accepted switch moves both: only the new vault is served, and only its edits arrive
      const upd = await js('window.__upd');
      await js('window.__confirmAnswer = true; 0');
      assert.equal(await setVault(other), true, 'an accepted vault switch must report true');
      await waitRels(['Other.md'], 'the index to switch to the new vault', other);
      await poll(async () => (await js('window.__upd')) > upd, 'vault:index-updated after the reset');
      fs.writeFileSync(path.join(vault, 'Stale.md'), '# Old vault\n');
      await sleep(500); // the old watcher is closed: this must never show up
      await js('window.__unsub(); 0');
      const frozen = await js('window.__upd');
      const upd2 = await js('window.__upd2');
      fs.writeFileSync(path.join(other, 'New.md'), '# New\n');
      await waitRels(['New.md', 'Other.md'], 'the new vault to be watched', other);
      await poll(async () => (await js('window.__upd2')) > upd2, 'vault:index-updated from the new vault');
      assert.equal(await js('window.__upd'), frozen, 'an unsubscribed onUpdated callback was still called');
      assert.ok(!(await rels(other)).includes('Stale.md'));

      assert.deepEqual(problems, [], 'unexpected errors in the main process');
    } finally {
      console.error = realError;
      process.off('unhandledRejection', onBad);
      process.off('uncaughtException', onBad);
      try { fs.chmodSync(locked, 0o666); } catch { /* never created */ }
      await setVault(vault).catch(() => {}); // unwatch `other` before it is deleted
      await fs.promises.rm(other, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
};
