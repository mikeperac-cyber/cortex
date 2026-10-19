const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// "Create as Note" when today's note already exists opens that note as-is. The journal text typed in the panel must not
// vanish with it: the panel is rebuilt from localStorage the next time it opens.
module.exports = {
  async run({ vault, js, sleep }) {
    const today = await js('CortexLib.localDateStr()');
    const note = path.join(vault, 'Daily Notes', today + '.md');
    const draft = 'half-written journal entry';
    await js('window.__alerts = []; window.alert = (m) => window.__alerts.push(String(m)); 0'); // a blocking alert would hang the run
    const panel = (code) => js(`(() => { const p = App.plugins.find(p => p.name === 'dailysync'); return ${code}; })()`);

    await js('App.openDailyNote()'); // today's note now exists, with the template
    const template = fs.readFileSync(note, 'utf8');

    await js(`App.openPlugin('dailysync')`);
    await panel(`(p.panelEl.querySelector('#dsJournal').value = ${JSON.stringify(draft)}, 0)`);
    await panel(`(p.panelEl.querySelector('#dsCreateNote').click(), 0)`);
    for (let i = 0; i < 100 && (await panel(`p.panelEl.classList.contains('visible')`)); i++) await sleep(50);
    assert.equal(await panel(`p.panelEl.classList.contains('visible')`), false, 'the panel did not close');

    assert.equal(fs.readFileSync(note, 'utf8'), template, 'the existing note was rewritten');
    assert.equal(await js(`localStorage.getItem('cortex_daily_' + CortexLib.localDateStr())`), draft, 'the journal draft was not kept');
    const toast = await js(`[...document.body.children].map(e => e.textContent).find(t => /already exists/.test(t)) || ''`);
    assert.match(toast, /already exists/);
    assert.match(toast, /draft/i, 'the user is not told the draft was kept');
    assert.deepEqual(await js('window.__alerts'), []);

    // reopening the panel shows the draft again
    await js(`App.openPlugin('dailysync')`);
    assert.equal(await panel(`p.panelEl.querySelector('#dsJournal').value`), draft, 'the reopened journal lost the draft');
  },
};
