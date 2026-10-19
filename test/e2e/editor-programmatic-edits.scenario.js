const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Text the editor inserts itself (wikilink pick, slash command, Tab) assigns textarea.value without an `input` event.
// It must still reach tab.content, or autosave / Ctrl+S / closing the tab write the text from before the insertion.
module.exports = {
  seed: { 'Welcome.md': '# Welcome\n' },

  async run({ vault, js, sleep }) {
    const note = path.join(vault, 'Welcome.md');
    const poll = async (code, what) => {
      for (let i = 0; i < 100; i++) { if (await js(code)) return; await sleep(50); }
      throw new Error('Timed out waiting for ' + what);
    };
    // what a user does: the text changes and an `input` event follows (this is what arms the slash / wikilink palettes)
    const type = (text, caret = text.length) => js(`(() => {
      const t = document.getElementById('editorTextarea');
      t.value = ${JSON.stringify(text)};
      t.selectionStart = t.selectionEnd = ${caret};
      t.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    // the edit is in the tab at once, and the very next save puts exactly that text on disk
    const landed = async (what) => {
      const shown = await js('document.getElementById("editorTextarea").value');
      assert.equal(await js('App.openTabs[0].content'), shown, what + ': the tab never saw the edit');
      assert.equal(await js('App.flushSaves()'), true, what + ': save failed');
      assert.equal(fs.readFileSync(note, 'utf8'), shown, what + ': the file does not hold the inserted text');
      assert.equal(await js('App.openTabs[0].modified'), false, what + ': still modified after the save');
      return shown;
    };

    await js(`App.openFile(${JSON.stringify(note)})`);
    await poll('App._allNotes.some(n => n.name === "Welcome.md")', 'the note cache (wikilink suggestions)');

    // 1. Picking a wikilink suggestion: type "[[Wel", pick Welcome
    await type('[[Wel');
    assert.equal(await js('document.querySelectorAll(".wikilink-item").length'), 1, 'no wikilink suggestion for "[[Wel"');
    await js('document.querySelector(".wikilink-item").click()');
    assert.equal(await landed('wikilink'), '[[Welcome]]');
    assert.equal(await js('App._wikilinkOpen || App._slashOpen'), false, 'the inserted wikilink re-opened a palette');

    // 2. Every slash command: the inserted text lands in the tab and never re-arms the slash palette
    let picked = 0;
    for (const query of ['', 'Divider', 'Table', 'Tag', 'Note']) {
      await type('/' + query);
      const count = await js('document.querySelectorAll(".slash-item").length');
      assert.ok(count > 0, 'no slash command for "' + query + '"');
      for (let i = 0; i < count; i++) {
        await type('/' + query);
        await js(`document.querySelectorAll('.slash-item')[${i}].click()`);
        const shown = await landed('slash command "' + query + '" #' + i);
        assert.equal(await js('App._slashOpen'), false, 'the text ' + JSON.stringify(shown) + ' re-opened the slash palette');
        if (query !== 'Note') assert.equal(await js('App._wikilinkOpen'), false, 'the text ' + JSON.stringify(shown) + ' opened the wikilink palette');
        picked++;
      }
    }
    assert.equal(picked, 16, 'expected to exercise all 16 slash commands');

    // 3. Tab indents by two spaces at the caret
    await type('ab', 1);
    await js(`document.getElementById('editorTextarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))`);
    assert.equal(await landed('Tab'), 'a  b');
  },
};
