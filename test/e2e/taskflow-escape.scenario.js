const assert = require('node:assert/strict');

// Task text is user input: the board must show it literally, never parse it as HTML.
module.exports = {
  async run({ js }) {
    const title = 'a <b>x</b> & "q"';
    const due = '2026-<i>12</i>-31';
    const tags = ['<u>t</u>', 'a&b'];
    const tf = `App.plugins.find(p => p.name === 'taskflow')`;
    const card = (id) => `document.querySelector('.tf-task[data-id="' + ${id} + '"]')`;
    const check = async (id, what) => {
      assert.equal(await js(`!!${card(id)}`), true, what + ': no card rendered');
      const text = await js(`${card(id)}.textContent`);
      assert.ok(text.includes(title), what + ': the title is not shown literally: ' + JSON.stringify(text));
      assert.equal(await js(`${card(id)}.querySelector('b, i, u')`), null, what + ': task text was parsed as HTML');
      return text;
    };

    // 1. A stored task with markup in its title, due date and tags
    await js(`(() => { const tf = ${tf};
      tf.tasks.push({ id: 424242, title: ${JSON.stringify(title)}, column: 'todo', priority: 'medium', due: ${JSON.stringify(due)}, tags: ${JSON.stringify(tags)} });
      tf.renderPanel(); return 0; })()`);
    const text = await check(424242, 'stored task');
    assert.ok(text.includes('Due: ' + due), 'the due date is not shown literally: ' + JSON.stringify(text));
    for (const tag of tags) assert.ok(text.includes('#' + tag), 'the tag is not shown literally: ' + tag);

    // 2. A task typed into the "New task" dialog
    await js(`window.__op = ${tf}.addTask(); 0`);
    assert.equal(await js('document.getElementById("askOverlay").classList.contains("visible")'), true, 'ask dialog did not open');
    await js(`(() => {
      const input = document.getElementById('askInput');
      input.value = ${JSON.stringify(title)};
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await js('window.__op');
    const added = await js(`${tf}.tasks[${tf}.tasks.length - 1].id`);
    await check(added, 'added task');

    // 3. The card's Edit and Delete buttons work on that task only
    const answer = async (text) => js(`(() => {
      const input = document.getElementById('askInput');
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await js(`${card(added)}.querySelector('[data-action="edit"]').click(); 0`);
    await answer('Renamed');
    for (let i = 0; i < 100 && (await js(`${tf}.tasks.find(t => t.id === ${added}).title`)) !== 'Renamed'; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(await js(`${tf}.tasks.find(t => t.id === ${added}).title`), 'Renamed');
    const before = await js(`${tf}.tasks.length`);
    await js(`window.confirm = () => true; ${card(added)}.querySelector('[data-action="delete"]').click(); 0`);
    assert.equal(await js(`${tf}.tasks.length`), before - 1);
    assert.equal(await js(`${tf}.tasks.some(t => t.id === ${added})`), false);
    assert.equal(await js(`${tf}.tasks.some(t => t.id === 424242)`), true, 'another task was deleted');
  },
};
