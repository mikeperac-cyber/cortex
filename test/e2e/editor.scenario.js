const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Edits the editor makes itself (Tab, Enter in a list, Ctrl+B/I, a preview checkbox) keep the native undo stack:
// assigning textarea.value used to wipe it, so Ctrl+Z after Tab lost everything typed before.
module.exports = {
  seed: { 'A.md': '' },

  async run({ win, vault, js, sleep }) {
    const note = path.join(vault, 'A.md');
    const poll = async (code, what) => {
      for (let i = 0; i < 100; i++) { if (await js(code)) return; await sleep(50); }
      throw new Error('Timed out waiting for ' + what);
    };
    const value = () => js('document.getElementById("editorTextarea").value');
    // a fresh start: the text and caret as a user left them (an `input` event follows, as after typing)
    const type = (text, start = text.length, end = start) => js(`(() => {
      const t = document.getElementById('editorTextarea');
      t.focus();
      t.value = ${JSON.stringify(text)};
      t.setSelectionRange(${start}, ${end});
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const key = (init) => js(`document.getElementById('editorTextarea').dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ bubbles: true, cancelable: true, ...init })}))`);
    const undo = () => js('document.execCommand("undo")');
    // the tab follows the textarea (undo fires `input` too), so autosave writes what is shown
    const synced = async (what) => assert.equal(await js('App.openTabs[0].content'), await value(), what + ': tab.content is behind the textarea');

    await js(`App.openFile(${JSON.stringify(note)})`);
    await js('document.getElementById("editorTextarea").focus()');
    if (!(await js('document.activeElement === document.getElementById("editorTextarea")'))) { win.show(); win.focus(); } // execCommand needs focus
    await poll('document.activeElement === document.getElementById("editorTextarea")', 'the editor to take focus');

    // 1. Tab adds two spaces; undo restores the text typed before it
    await type('abc');
    await key({ key: 'Tab', code: 'Tab' });
    assert.equal(await value(), 'abc  ');
    await synced('Tab');
    await undo();
    assert.equal(await value(), 'abc', 'undo after Tab did not restore the earlier text');
    await synced('undo of Tab');

    // 2. Shift+Tab outdents every touched line
    await type('  a\n  b', 0, 7);
    await key({ key: 'Tab', code: 'Tab', shiftKey: true });
    assert.equal(await value(), 'a\nb');

    // 3. Ctrl+B wraps the selection (and unwraps it again); undo restores
    await type('abc', 0, 3);
    await key({ key: 'b', code: 'KeyB', ctrlKey: true });
    assert.equal(await value(), '**abc**');
    assert.deepEqual(await js('[document.getElementById("editorTextarea").selectionStart, document.getElementById("editorTextarea").selectionEnd]'), [2, 5]);
    await synced('Ctrl+B');
    await undo();
    assert.equal(await value(), 'abc', 'undo after Ctrl+B did not restore the text');

    // 4. Ctrl+I matches the physical key: Caps Lock turns e.key into 'I'
    await type('abc', 0, 3);
    await key({ key: 'I', code: 'KeyI', ctrlKey: true });
    assert.equal(await value(), '*abc*');

    // 5. Enter at the end of a list item continues the list; on an empty item it ends the list; undo restores
    await type('1. a');
    await key({ key: 'Enter', code: 'Enter' });
    assert.equal(await value(), '1. a\n2. ');
    await key({ key: 'Enter', code: 'Enter' });
    assert.equal(await value(), '1. a\n');
    await undo();
    await undo();
    assert.equal(await value(), '1. a', 'undo after list continuation did not restore the text');
    // Enter while composing (IME) is left alone
    await type('- a');
    await key({ key: 'Enter', code: 'Enter', isComposing: true });
    assert.equal(await value(), '- a', 'Enter during IME composition continued the list');

    // 6. With the slash palette open, Enter picks the command instead of continuing the list
    await type('- /Divider');
    assert.equal(await js('App._slashOpen'), true, 'slash palette did not open');
    await key({ key: 'Enter', code: 'Enter' });
    assert.equal(await value(), '- \n---\n');
    assert.equal(await js('App._slashOpen'), false);

    // 7. A preview checkbox toggles through the same path: caret kept, undo unticks, the save writes the textarea
    await type('- [ ] t\nend', 2);
    await js('App.updatePreview(document.getElementById("editorTextarea").value)');
    await js('document.querySelector("#previewContent input[data-task=\\"0\\"]").click(); 0');
    assert.equal(await value(), '- [x] t\nend');
    assert.equal(await js('document.getElementById("editorTextarea").selectionStart'), 2, 'the toggle moved the caret');
    await undo();
    assert.equal(await value(), '- [ ] t\nend', 'undo after the checkbox toggle did not restore the text');
    await synced('undo of the toggle');
    assert.equal(await js('App.flushSaves()'), true, 'save failed');
    assert.equal(fs.readFileSync(note, 'utf8'), '- [ ] t\nend');

    // 8. Preview-only layout hides the textarea (no focus, so no execCommand): the toggle still reaches the textarea, the tab and the disk
    await js('App.setLayout("preview")');
    await js('App.updatePreview(document.getElementById("editorTextarea").value)');
    await js('document.querySelector("#previewContent input[data-task=\\"0\\"]").click(); 0');
    assert.equal(await js('document.activeElement === document.getElementById("editorTextarea")'), false, 'the hidden textarea took focus: the fallback path was not exercised');
    assert.equal(await value(), '- [x] t\nend', 'preview-only toggle missed the textarea');
    assert.equal(await js('App.openTabs[0].content'), '- [x] t\nend', 'preview-only toggle missed the tab');
    assert.equal(await js('App.openTabs[0].modified'), true, 'preview-only toggle left the tab clean');
    assert.equal(await js('App.flushSaves()'), true, 'save failed');
    assert.equal(fs.readFileSync(note, 'utf8'), '- [x] t\nend');
    await js('App.setLayout("split")');
    await js('document.getElementById("editorTextarea").focus()');

    // 9. A slash inside a word or URL opens no palette, so Enter continues the list; at line start the palette still owns Enter
    for (const line of ['- milk/bread', '- coffee w/o', '- see https://']) {
      await type(line);
      assert.equal(await js('App._slashOpen'), false, 'slash palette opened for ' + JSON.stringify(line));
      await key({ key: 'Enter', code: 'Enter' });
      assert.equal(await value(), line + '\n- ', 'Enter after ' + JSON.stringify(line));
    }
    await type('/');
    assert.equal(await js('App._slashOpen'), true, 'slash palette did not open at line start');
    await key({ key: 'Enter', code: 'Enter' });
    assert.equal(await value(), '# ');
    // a query with no match closes the palette: Enter is a plain Enter again (the browser's own, not prevented)
    await type('- a /zzz');
    assert.equal(await js('App._slashOpen'), false, 'empty slash palette stayed open');
    await type('[[zzzq');
    assert.equal(await js('App._wikilinkOpen'), false, 'empty wikilink autocomplete stayed open');
  },
};
