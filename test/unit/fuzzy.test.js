const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fuzzyScore, rankNotes } = require('../../src/lib/fuzzy');

test('fuzzyScore: subsequence only; empty query matches', () => {
  assert.equal(fuzzyScore('xyz', 'meeting'), 0); assert.ok(fuzzyScore('mtg', 'meeting') > 0); assert.ok(fuzzyScore('', 'a') > 0); });
test('fuzzyScore: contiguous > scattered, word start > mid-word, shorter wins', () => {
  assert.ok(fuzzyScore('meet', 'meeting') > fuzzyScore('meet', 'm e e t'));
  assert.ok(fuzzyScore('plan', 'project plan') > fuzzyScore('plan', 'airplane'));
  assert.ok(fuzzyScore('plan', 'plan') > fuzzyScore('plan', 'plan b')); });
test('fuzzyScore: case, diacritics, dotless i', () => {
  assert.ok(fuzzyScore('calisma', 'Çalışma') > 0); assert.ok(fuzzyScore('CAL', 'Çalışma') > 0);
  assert.ok(fuzzyScore('istanbul', 'Istanbul') > 0 && fuzzyScore('istanbul', 'İstanbul') > 0); });
test('fuzzyScore: a query longer than the text, or with letters the text lacks, scores 0; spaces in the query are ignored', () => {
  assert.equal(fuzzyScore('meetings', 'meet'), 0); assert.equal(fuzzyScore('ba', 'ab'), 0);
  assert.ok(fuzzyScore('proj plan', 'Project Plan') > 0); assert.ok(fuzzyScore('  ', 'a') > 0); });

const N = (stem, rel = stem + '.md') => ({ path: '/v/' + rel, stem, rel, key: rel.toLowerCase() });
const [A, B, D1, D2] = [N('Alpha'), N('Beta'), N('Dup'), N('Dup', 'sub/Dup.md')];
test('rankNotes: empty query = recents MRU-first (unknown keys ignored), then A-Z', () =>
  assert.deepEqual(rankNotes('', [A, B, D1], ['zzz', 'dup.md', 'beta.md']).map(n => n.stem), ['Dup', 'Beta', 'Alpha']));
test('rankNotes: stem hit outranks folder-only hit; non-matches drop', () =>
  assert.deepEqual(rankNotes('dup', [N('Other', 'dup/Other.md'), D1, A], []).map(n => n.rel), ['Dup.md', 'dup/Other.md']));
test('rankNotes: duplicate stems stay separate rows; recency breaks ties; limit applies', () => {
  assert.deepEqual(rankNotes('dup', [D1, D2], ['sub/dup.md']).map(n => n.rel), ['sub/Dup.md', 'Dup.md']);
  assert.equal(rankNotes('', [A, B, D1], [], 2).length, 2); });
test('rankNotes: an empty vault gives no rows', () => {
  assert.deepEqual(rankNotes('', [], []), []); assert.deepEqual(rankNotes('x', [], []), []); });
test('rankNotes: without recents ties fall back to stem then path; the input is not reordered', () => {
  const notes = [D2, D1];
  assert.deepEqual(rankNotes('dup', notes, []).map(n => n.rel), ['Dup.md', 'sub/Dup.md']);
  assert.deepEqual(notes, [D2, D1]); });
