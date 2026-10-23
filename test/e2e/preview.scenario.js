const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, ipcMain, shell } = require('electron');

// Preview interactions: a wikilink opens its note (or creates it after a confirm), a task checkbox edits the source and saves,
// external links go through the open-external bridge, and nothing the page does can navigate or spawn a window.
module.exports = {
  seed: { 'A.md': '[[B]] [[Missing]] [[bad:name]]\n- [ ] t1\n- [ ] t2\n[ext](https://example.com)', 'B.md': '# B\n- [ ] b1' },

  async run({ win, vault, js, sleep }) {
    const poll = async (check, what, ms = 5000) => {
      const end = Date.now() + ms;
      for (;;) {
        const value = await check();
        if (value) return value;
        if (Date.now() > end) throw new Error('Timed out waiting for ' + what);
        await sleep(50);
      }
    };
    const active = () => js('App.activeTab');
    const disk = () => fs.readFileSync(path.join(vault, 'A.md'), 'utf8');
    const external = [];
    ipcMain.removeHandler('open-external');
    ipcMain.handle('open-external', async (event, url) => { external.push(url); return { success: true }; });
    const opened = [];
    shell.openExternal = async (url) => { opened.push(url); };

    await js('window.alert = (m) => { window.__alert = m; }; window.confirm = () => true; 0');
    await poll(async () => (await js('App._notes.length')) === 2, 'the index');
    await js(`App.openFile(${JSON.stringify(path.join(vault, 'A.md'))})`);
    await poll(() => js('!!document.querySelector("#previewContent a.wikilink")'), 'the preview');

    // Wikilink to an existing note
    await js('document.querySelector("#previewContent a.wikilink[data-note=B]").click(); 0');
    await poll(async () => /B\.md$/.test(await active()), 'B to open');

    // Task checkbox: the second one toggles in the source and reaches the disk; the first stays open
    await js(`App.openFile(${JSON.stringify(path.join(vault, 'A.md'))})`);
    await poll(() => js('!!document.querySelector("#previewContent input[data-task=\\"1\\"]")'), 'the checkbox');
    await js('document.querySelector("#previewContent input[data-task=\\"1\\"]").click(); 0');
    await poll(() => disk().includes('- [x] t2'), 'the toggle to be saved', 1500 + 3000);
    assert.ok(disk().includes('- [ ] t1'), 't1 changed');
    assert.ok((await js('document.getElementById("editorTextarea").value')).includes('- [x] t2'), 'textarea not updated');
    await poll(() => js('document.querySelector("#previewContent input[data-task=\\"1\\"]").checked'), 're-rendered checked box');

    // Missing note: confirm, then created with the exclusive-create path and opened
    await js('document.querySelector("#previewContent a.wikilink[data-note=Missing]").click(); 0');
    await poll(async () => /Missing\.md$/.test(await active()), 'Missing to open');
    assert.equal(fs.readFileSync(path.join(vault, 'Missing.md'), 'utf8'), '# Missing\n');

    // A target that is not a valid note name creates nothing
    await js(`App.openFile(${JSON.stringify(path.join(vault, 'A.md'))})`);
    await poll(() => js('!!document.querySelector("#previewContent a.wikilink[data-note=\\"bad:name\\"]")'), 'the bad link');
    await js('window.__alert = null; document.querySelector("#previewContent a.wikilink[data-note=\\"bad:name\\"]").click(); 0');
    await poll(() => js('window.__alert'), 'the invalid-name alert');
    assert.deepEqual(fs.readdirSync(vault).filter((f) => f.endsWith('.md')).sort(), ['A.md', 'B.md', 'Missing.md']);

    // External link: through the bridge, window untouched
    const url = win.webContents.getURL();
    await js('document.querySelector("#previewContent a[href^=\\"https://example.com\\"]").click(); 0');
    await poll(() => external.length === 1, 'the external link to reach the bridge');
    assert.equal(external[0], 'https://example.com');
    assert.equal(win.webContents.getURL(), url, 'the window navigated');

    // A stale preview never toggles: edit A, switch to B inside the 100 ms render debounce, click B's box -> B's own task toggles
    const aPath = path.join(vault, 'A.md');
    const bPath = path.join(vault, 'B.md');
    await js(`App.openFile(${JSON.stringify(aPath)})`);
    await poll(() => js('!!document.querySelector("#previewContent a.wikilink")'), 'A preview');
    await js(`(() => { const t = document.getElementById('editorTextarea'); t.value = '- [ ] a1\\n- [ ] a2\\n- [ ] a3\\n'; App.onEditorInput();
      App.switchTab(${JSON.stringify(bPath)}); })(); 0`);
    await sleep(300); // the cancelled render must not land over B's preview
    assert.ok(!(await js('document.getElementById("previewContent").textContent.includes("a3")')), 'A\'s render landed on B');
    await js('document.querySelector("#previewContent input[data-task=\\"0\\"]").click(); 0');
    await poll(() => fs.readFileSync(bPath, 'utf8').includes('- [x] b1'), 'B\'s own task to toggle');
    await poll(() => !/\[x\] a/.test(fs.readFileSync(aPath, 'utf8')) && fs.readFileSync(aPath, 'utf8').includes('a3'), 'A to autosave untouched');

    // Same note: insert a task above and click at once on the older render -> nothing toggles, the preview refreshes
    await js(`(() => { const t = document.getElementById('editorTextarea'); t.value = '- [ ] new\\n' + t.value; App.onEditorInput();
      document.querySelector('#previewContent input[data-task="0"]').click(); })(); 0`);
    await poll(() => js('document.querySelectorAll("#previewContent input[data-task]").length === 2'), 'the refreshed preview');
    const text = await js('document.getElementById("editorTextarea").value');
    assert.equal(text, '- [ ] new\n# B\n- [x] b1', 'a stale click changed the text: ' + JSON.stringify(text));

    // The guards: window.open spawns nothing (a safe URL goes to the shell), and navigating the page is refused
    await js("window.open('https://example.com'); 0");
    await poll(() => opened.length === 1, 'window.open to reach the shell');
    await js("window.open('file:///C:/Windows/notepad.exe'); 0");
    await js("location.href = 'https://example.com/x'; 0");
    await sleep(600);
    assert.equal(BrowserWindow.getAllWindows().length, 1, 'a window was opened');
    assert.equal(win.webContents.getURL(), url, 'the window navigated away');
    assert.equal(opened.length, 2, 'unexpected shell opens: ' + opened); // window.open + the refused navigation reached the shell; file: never did
  },
};
