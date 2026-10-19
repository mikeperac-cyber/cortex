const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = {
  async run({ vault, js }) {
    const today = await js('CortexLib.localDateStr()');
    const note = path.join(vault, 'Daily Notes', today + '.md');
    const activeTab = async () => (await js('App.activeTab')).replace(/\\/g, '/');
    await js('window.__alerts = []; window.alert = (m) => window.__alerts.push(m); 0'); // a blocking alert would hang the run

    // First call creates today's note from the template under the vault, and opens it
    await js('App.openDailyNote()');
    assert.ok(fs.existsSync(note), 'daily note was not created in the vault');
    assert.equal(
      fs.readFileSync(note, 'utf8'),
      '# ' + today + '\n\n## Notes\n\n## Tasks\n- [ ] \n\n## Reflections\n',
      'new daily note uses the template'
    );
    assert.ok((await activeTab()).endsWith('/Daily Notes/' + today + '.md'), 'daily note is the active tab');
    assert.equal(fs.existsSync(path.join(process.cwd(), 'undefined')), false, 'wrote to an undefined/ directory');

    // A second call never rewrites an existing note
    fs.writeFileSync(note, 'EDITED');
    await js('App.openDailyNote()');
    assert.equal(fs.readFileSync(note, 'utf8'), 'EDITED', 'existing daily note was overwritten');
    assert.deepEqual(await js('window.__alerts'), [], 'unexpected alert');
  },
};
