const { test } = require('node:test');
const assert = require('node:assert/strict');
const { schedule } = require('../../src/lib/sm2');
const { localDateStr } = require('../../src/lib/dates');

const now = new Date(2026, 9, 25, 23, 50);

test('good answers grow 1, 6, then interval x ease', () => {
  let c = {};
  c = schedule(c, 'good', now); assert.deepEqual([c.repetitions, c.interval, c.ease], [1, 1, 2.5]);
  c = schedule(c, 'good', now); assert.deepEqual([c.repetitions, c.interval], [2, 6]);
  c = schedule(c, 'good', now); assert.deepEqual([c.repetitions, c.interval], [3, 15]);
});

test('again resets repetitions and lowers ease; ease never drops below 1.3', () => {
  let c = { repetitions: 5, interval: 40, ease: 1.4 };
  c = schedule(c, 'again', now);
  assert.deepEqual([c.repetitions, c.interval, c.ease], [0, 1, 1.3]);
});

test('easy raises ease, hard lowers it', () => {
  assert.equal(schedule({}, 'easy', now).ease, 2.6);
  assert.equal(schedule({}, 'hard', now).ease, 2.36);
});

test('due date is interval local days after today, garbage card fields start fresh', () => {
  const c = schedule({ repetitions: 'x', interval: -3, ease: NaN }, 'good', now);
  assert.equal(localDateStr(new Date(c.nextReview)), '2026-10-26');
  assert.throws(() => schedule({}, 'meh', now));
});
