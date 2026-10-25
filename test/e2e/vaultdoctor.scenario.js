const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Vault Doctor reports what the index knows (broken links, orphans, stubs, duplicate names) and "Create note" makes the
// missing note without ever replacing one.
module.exports = {
  seed: {
    'A.md': '# A\n\nSee [[B]] and [[Ghost]] and [[ghost]] for the full picture of this project.\n',
    'B.md': '# B\n\nA perfectly ordinary note with enough words to not be a stub at all.\n',
    'Lonely.md': 'tiny',
    'sub/b.md': '# b\n\nAnother note named b, in a folder, with plenty of words in it too.\n',
    'Daily Notes/2026-10-25.md': 'x',
  },
  async run({ js, sleep, vault }) {
    const poll = async (code, what) => {
      for (let i = 0; i < 200; i++) { if (await js(code)) return; await sleep(50); }
      throw new Error('Timed out waiting for ' + what);
    };
    await poll('App._notes.length === 5', 'the index');
    await js(`document.getElementById('btnVaultDoctor').click(); 0`);
    await poll(`!!document.querySelector('#plugin-vaultdoctor .vd-score')`, 'the report');

    const sections = await js(`Object.fromEntries([...document.querySelectorAll('#vdReport .syn-card:not(.vd-head)')].map(c => [
      c.querySelector('.syn-h').firstChild.textContent.trim(),
      [...c.querySelectorAll('.vd-name')].map(n => n.textContent),
    ]))`);
    assert.deepEqual(sections, {
      'Broken links': ['Ghost'],
      'Orphan notes': ['Lonely'],
      'Stub notes': ['Lonely'],
      'Duplicate names': ['B'],
    });
    // A, B, sub/b are duplicates or carry a broken link; Lonely is an orphan stub; the daily note is fine -> 1 of 5
    assert.equal(await js(`document.querySelector('.vd-score').textContent`), '20%');

    await js(`[...document.querySelectorAll('#vdReport button')].find(b => b.textContent === 'Create note').click(); 0`);
    const ghost = path.join(vault, 'Ghost.md');
    for (let i = 0; i < 100 && !fs.existsSync(ghost); i++) await sleep(50);
    assert.equal(fs.readFileSync(ghost, 'utf8'), '# Ghost\n\n');

    // Created again (a stale report): the existing note is left alone
    fs.writeFileSync(ghost, 'mine');
    await js(`App.plugins.find(p => p.name === 'vaultdoctor').createNote('Ghost')`);
    assert.equal(fs.readFileSync(ghost, 'utf8'), 'mine');

    // Panels are removed on close, never stacked
    await js(`App.openPlugin('vaultdoctor'); App.openPlugin('vaultdoctor'); 0`);
    assert.equal(await js(`document.querySelectorAll('#plugin-vaultdoctor').length`), 1);
    await js('App.hidePluginPanels(); 0');
    assert.equal(await js(`document.querySelectorAll('.plugin-panel').length`), 0);
  },
};
