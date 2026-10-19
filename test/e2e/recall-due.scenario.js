const assert = require('node:assert/strict');

// A card is due once its stored ISO nextReview falls on or before today's LOCAL calendar day.
// Timestamps are built from local date parts (never string slicing), so the cases straddle the UTC date boundary on any machine:
// at UTC+3, 00:30 local tomorrow is already "today" in UTC (b), which the old UTC-slicing filter wrongly called due.
module.exports = {
  async run({ js, sleep }) {
    const poll = async (code, what) => {
      for (let i = 0; i < 200; i++) { if (await js(code)) return; await sleep(50); }
      throw new Error('Timed out waiting for ' + what);
    };
    await poll('!!App.plugins.find(p => p.name === "recall")', 'the Recall plugin to load');
    await js('window.alert = () => {}; 0'); // startReview alerts when nothing is due, and a blocking alert would hang the run

    await js(`(() => {
      const now = new Date();
      const at = (dayOffset, hour, minute) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute).toISOString();
      const card = (id, nextReview) => Object.assign({ id, front: 'F' + id, back: 'B' + id, interval: 1, repetitions: 0 }, nextReview === undefined ? {} : { nextReview });
      localStorage.setItem('cortex_cards', JSON.stringify([
        card(1, at(0, 0, 30)),   // a: 00:30 local today (UTC date is yesterday east of UTC)  -> due
        card(2, at(1, 0, 30)),   // b: 00:30 local tomorrow (UTC date is today east of UTC)   -> NOT due
        card(3),                 // c: no nextReview                                         -> due
        card(4, at(0, 23, 30)),  // d: 23:30 local today (UTC date is tomorrow west of UTC)  -> due
        card(5, 'not a date'),   // e: unparseable                                           -> due
      ]));
      const recall = App.plugins.find(p => p.name === 'recall');
      recall.loadCards();
      App.openPlugin('recall');
    })()`);

    const shownDue = await js(`(() => {
      const label = [...document.querySelectorAll('#plugin-recall div')].find(d => d.textContent.trim() === 'Due Today');
      return label.previousElementSibling.textContent.trim();
    })()`);
    assert.equal(shownDue, '4', 'Due Today number on the panel');

    await js('App.plugins.find(p => p.name === "recall").startReview()');
    // joined to a string so a failure prints the ids instead of "[Array]"
    assert.equal(await js('App.plugins.find(p => p.name === "recall").reviewQueue.map(c => c.id).join(",")'), '1,3,4,5', 'ids of the cards in the review queue');
  },
};
