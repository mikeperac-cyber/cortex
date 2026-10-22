const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Quick capture (Ctrl+Shift+N): one line lands under "## Captures" at the end of today's daily note, without leaving the current
// note. Covers the note not existing yet, captures racing each other, a dirty open tab (typed text and capture both survive, no
// "Changed on disk"), the failure paths (alert, false, nothing lost, the text kept in the dialog), the notice and the keyboard.
module.exports = {
  async run({ win, vault, js, sleep }) {
    const q = JSON.stringify;
    const errors = [];
    win.webContents.on('console-message', (e, level, message) => { if (level >= 3) errors.push(message); });
    const poll = async (check, what, ms = 8000) => {
      const end = Date.now() + ms;
      for (;;) {
        if (await check()) return;
        if (Date.now() > end) throw new Error('Timed out waiting for ' + what);
        await sleep(50);
      }
    };

    const today = await js('CortexLib.localDateStr()');
    const note = path.join(vault, 'Daily Notes', today + '.md');
    const template = '# ' + today + '\n\n## Notes\n\n## Tasks\n- [ ] \n\n## Reflections\n';
    const disk = () => fs.readFileSync(note, 'utf8');
    const headings = (text) => (text.match(/^## Captures$/gm) || []).length;
    // the texts under "## Captures", without their "- HH:MM " prefix
    const captured = () => {
      const t = disk();
      return t.slice(t.indexOf('## Captures\n') + '## Captures\n'.length).split('\n').filter(Boolean).map((l) => l.replace(/^- \d\d:\d\d /, ''));
    };
    const capture = (text) => js(`App.captureToDaily(${q(text)})`);
    const alerts = () => js('window.__alerts');
    const notice = () => js('document.getElementById("statusbarNotice").textContent');
    const tab = (code) => js(`(() => { const t = App.openTabs[0]; return ${code}; })()`);
    const editor = () => js('document.getElementById("editorTextarea").value');
    const type = (text) => js(`(() => {
      const t = document.getElementById('editorTextarea');
      t.value = ${q(text)};
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const keydown = (target, key, opts = {}) => js(`${target}.dispatchEvent(
      new KeyboardEvent('keydown', Object.assign({ key: ${q(key)}, bubbles: true, cancelable: true }, ${q(opts)}))); 0`);
    const ctrlShiftN = (target = 'document') => keydown(target, 'N', { ctrlKey: true, shiftKey: true });
    const askVisible = () => js('document.getElementById("askOverlay").classList.contains("visible")');
    const askTitle = () => js('document.getElementById("askTitle").textContent');
    const askValue = () => js('document.getElementById("askInput").value');
    const fill = (text) => js(`document.getElementById('askInput').value = ${q(text)}; 0`);
    const enter = () => keydown('document.getElementById("askInput")', 'Enter');
    // the index holds the note as it is on disk now
    const caughtUp = () => poll(async () => {
      const entry = (await js('cortex.index.notes()')).find((n) => n.path.toLowerCase() === note.toLowerCase());
      return entry && entry.mtimeMs === fs.statSync(note).mtimeMs;
    }, 'the index to catch up with the daily note');

    await js('window.__alerts = []; window.alert = (m) => window.__alerts.push(String(m)); window.confirm = () => true; 0');
    await js(`window.__errTexts = [];
      new MutationObserver(() => {
        const text = document.getElementById('statusbarError').textContent;
        if (text) window.__errTexts.push(text);
      }).observe(document.getElementById('statusbarError'), { childList: true, characterData: true, subtree: true }); 0`);

    // 1. No daily note yet: the first capture creates it from the template, adds the heading once, and says so in the status bar
    assert.equal(fs.existsSync(note), false, 'the daily note must not exist yet');
    assert.equal(await capture('first'), true);
    const t1 = disk();
    assert.ok(t1.startsWith(template + '\n## Captures\n'), 'the note is the daily template plus the Captures heading');
    assert.match(t1, /\n## Captures\n- \d\d:\d\d first\n$/);
    assert.equal(headings(t1), 1);
    assert.match(await notice(), /Captured/, 'no notice after a successful capture');
    await poll(() => js(`document.getElementById('fileTree').textContent.includes(${q(today + '.md')})`), 'the explorer to list the new daily note');

    // 2. A second capture goes under the same heading; whitespace is collapsed and any character arrives as typed
    assert.equal(await capture('  second\n\tline <b>&amp;</b> çay ☕ '), true);
    assert.deepEqual(captured(), ['first', 'second line <b>&amp;</b> çay ☕']);
    assert.equal(headings(disk()), 1);

    // 3. Two captures at once, on a note with no heading yet: both lines land, in call order, under one heading
    fs.writeFileSync(note, template);
    assert.deepEqual(await js(`Promise.all([App.captureToDaily('p'), App.captureToDaily('q')])`), [true, true]);
    assert.deepEqual(captured(), ['p', 'q']);
    assert.equal(headings(disk()), 1, 'two concurrent captures wrote the heading twice');

    // 4. Blank text writes nothing and says nothing
    const before = disk();
    assert.equal(await capture(' \n\t '), false);
    assert.equal(disk(), before);
    assert.deepEqual(await alerts(), [], 'a blank capture alerted');

    // 5. The note is open with unsaved typing: the typed text is saved first, the capture follows, both are on disk and in the tab
    // (first the watcher must have caught up with the writes above: right after a note is made, the index picks its text up with
    // the folder scan, and the note's own change event then reports nothing new)
    await caughtUp();
    await js(`App.openFile(${q(note)})`);
    await type((await editor()) + '\ntyped, not saved');
    assert.equal(await tab('t.modified'), true, 'the typing must still be unsaved');
    assert.equal(await capture('dirty case'), true);
    await poll(async () => (await tab('t.content')).includes('dirty case'), 'the open tab to show the capture');
    const t5 = disk();
    assert.ok(t5.includes('typed, not saved') && t5.includes('dirty case'), 'typed text or capture is missing on disk');
    assert.ok(t5.indexOf('typed, not saved') < t5.indexOf('dirty case'), 'the capture must follow the typed text');
    assert.equal(await tab('t.content'), t5);
    assert.equal(await editor(), t5, 'the editor does not show what is on disk');
    assert.equal(await tab('t.modified'), false);
    await sleep(300); // negative check: no late "Changed on disk" from the watcher
    assert.equal(await js('document.getElementById("statusbarError").textContent'), '');
    assert.deepEqual(await js('window.__errTexts'), [], 'the status bar showed an error during the capture');
    assert.equal(headings(t5), 1);

    // 6. A failing write: nothing is lost, the caller is told. First the open tab's own save fails (typed text stays as typed) ...
    fs.chmodSync(note, 0o444);
    try {
      const frozen = disk();
      await type((await editor()) + '\nlocked typing');
      let seen = (await alerts()).length;
      assert.equal(await capture('blocked'), false, 'a capture that could not save the open tab reported success');
      assert.equal((await alerts()).length, seen + 1, 'no alert for the failed capture');
      assert.match((await alerts()).pop(), /Could not/);
      assert.equal(disk(), frozen, 'the read-only note changed');
      assert.ok((await tab('t.content')).endsWith('locked typing'), 'typed text was touched');
      assert.ok((await editor()).endsWith('locked typing'));
      assert.equal(await tab('t.modified'), true);
    } finally {
      fs.chmodSync(note, 0o666);
    }
    assert.equal(await js('App.flushSaves()'), true);
    assert.ok(disk().endsWith('locked typing'));

    // ... then, with no tab, the append itself fails; quickCapture comes back with the same text and the retry works
    await js(`App.closeTab(${q(note)})`);
    assert.equal(await js('App.openTabs.length'), 0);
    fs.chmodSync(note, 0o444);
    try {
      const frozen = disk();
      let seen = (await alerts()).length;
      assert.equal(await capture('blocked too'), false);
      assert.equal((await alerts()).length, seen + 1);
      assert.match((await alerts()).pop(), /Could not/);
      assert.equal(disk(), frozen);

      seen = (await alerts()).length;
      await js('window.__qc = App.quickCapture(); 0');
      assert.equal(await askVisible(), true, 'quickCapture did not open the dialog');
      assert.equal(await askTitle(), 'Quick capture');
      await fill('kept text');
      await enter();
      await poll(async () => (await alerts()).length === seen + 1, 'the failure alert');
      await poll(async () => (await askVisible()) && (await askValue()) === 'kept text', 'the dialog to come back with the same text');
      assert.equal(disk(), frozen);
    } finally {
      fs.chmodSync(note, 0o666);
    }
    await enter(); // the retry, now that the note is writable again
    assert.equal(await js('window.__qc'), undefined);
    assert.equal(await askVisible(), false);
    assert.equal(captured().pop(), 'kept text');
    assert.match(await notice(), /Captured/);

    // 7. The keyboard: Ctrl+Shift+N asks, Enter captures, Escape captures nothing
    await ctrlShiftN();
    assert.equal(await askVisible(), true, 'Ctrl+Shift+N did not open the dialog');
    assert.equal(await askTitle(), 'Quick capture');
    assert.equal(await js('document.activeElement && document.activeElement.id'), 'askInput');
    await fill('by keyboard');
    await enter();
    assert.equal(await askVisible(), false);
    await poll(() => captured().includes('by keyboard'), 'the keyboard capture on disk');

    const afterKeys = disk();
    await ctrlShiftN();
    await fill('never saved');
    await keydown('document.getElementById("askInput")', 'Escape');
    assert.equal(await askVisible(), false, 'Escape left the dialog open');
    await keydown('document', 'N', { ctrlKey: true }); // no Shift: not this shortcut
    assert.equal(await askVisible(), false, 'Ctrl+N without Shift opened the capture dialog');
    await sleep(200); // negative check: nothing may be written
    assert.equal(disk(), afterKeys, 'a cancelled capture wrote something');

    // ... and does nothing while any dialog is open: the ask dialog only swallows Esc/Enter/Tab, so the key reaches App
    await js('window.__ask = Dialogs.ask({ title: "Blocking" }); 0');
    await ctrlShiftN('document.getElementById("askInput")');
    assert.equal(await askTitle(), 'Blocking', 'Ctrl+Shift+N replaced the open dialog');
    await keydown('document.getElementById("askInput")', 'Escape');
    assert.equal(await js('window.__ask'), null);
    await js('App.openSwitcher(); 0');
    await ctrlShiftN('document.getElementById("switcherInput")');
    assert.equal(await askVisible(), false, 'Ctrl+Shift+N opened the dialog over the switcher');
    await js('App.closeSwitcher(); App.openCommandPalette(); 0');
    await ctrlShiftN('document.getElementById("commandInput")');
    assert.equal(await askVisible(), false, 'Ctrl+Shift+N opened the dialog over the command palette');
    await js('App.closeCommandPalette(); 0');

    // 8. The command palette lists it and runs it
    assert.equal(await js('App.commands.some((c) => c.name === "Quick Capture" && c.shortcut === "Ctrl+Shift+N")'), true, 'no Quick Capture command');
    await js(`(() => {
      App.openCommandPalette();
      const input = document.getElementById('commandInput');
      input.value = 'quick capture';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#commandResults .command-result-item').click();
    })()`);
    assert.equal(await askVisible(), true, 'the palette command did not open the dialog');
    assert.equal(await askTitle(), 'Quick capture');
    assert.equal(await js('document.getElementById("commandPaletteOverlay").classList.contains("visible")'), false);
    await keydown('document.getElementById("askInput")', 'Escape');

    // 9. The notice: text only, replaced by a newer one (whose timer wins), cleared when its time is up
    await js(`App.notice('<b>x</b>', 60000); 0`);
    assert.equal(await notice(), '<b>x</b>');
    assert.equal(await js('document.getElementById("statusbarNotice").children.length'), 0, 'the notice was parsed as HTML');
    await js(`App.notice('old', 100); App.notice('new', 60000); 0`);
    await sleep(400); // negative check: the first notice's timer must not clear the second
    assert.equal(await notice(), 'new', 'an older timer cleared a newer notice');
    await js(`App.notice('short', 100); 0`);
    await poll(async () => (await notice()) === '', 'the notice to clear');

    // 10. The open tab has unsaved typing AND its file changed on disk under it: a capture must not write the tab over that change
    await caughtUp();
    await js(`App.openFile(${q(note)})`);
    await type((await editor()) + '\nmine');
    fs.writeFileSync(note, disk() + 'external edit\n');
    await poll(() => tab('t.changedOnDisk'), 'the outside edit to be noticed');
    const outside = disk();
    const seen = (await alerts()).length;
    assert.equal(await capture('conflict'), false, 'a capture overwrote an outside edit');
    assert.equal((await alerts()).length, seen + 1);
    assert.match((await alerts()).pop(), /changed on disk/i);
    assert.equal(disk(), outside, 'the outside edit was overwritten or appended to');
    assert.ok((await tab('t.content')).endsWith('mine'), 'typed text was touched');
    assert.equal(await js('App.flushSaves()'), true); // the user's explicit save keeps their text, as ever
    assert.ok(disk().endsWith('mine'));

    assert.deepEqual(errors, [], 'renderer errors');
  },
};
