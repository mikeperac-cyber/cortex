const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeVault } = require('../../src/lib/vault-health');

const N = (path, links = [], words = 50) => ({ path, stem: path.split('/').pop().slice(0, -3), links: links.map((target, line) => ({ target, line })), words, tags: [] });

test('empty vault is perfectly healthy', () => {
  assert.deepEqual(analyzeVault([]), { total: 0, score: 100, broken: [], orphans: [], stubs: [], duplicates: [] });
});

test('broken links are grouped by target (case-folded), most referenced first', () => {
  const r = analyzeVault([N('/v/A.md', ['Ghost', 'B']), N('/v/B.md', ['ghost', 'Other']), N('/v/C.md', ['A'])]);
  assert.deepEqual(r.broken.map((b) => [b.target, b.sources.map((s) => s.stem)]), [['Ghost', ['A', 'B']], ['Other', ['B']]]);
  assert.deepEqual(r.broken[0].sources[1], { path: '/v/B.md', stem: 'B', line: 0 });
});

test('orphans: no resolved link in or out; self-links and broken links do not count; daily notes and templates exempt', () => {
  const r = analyzeVault([
    N('/v/A.md', ['B']), N('/v/B.md'), N('/v/Lonely.md', ['Lonely', 'Ghost']),
    N('/v/Daily Notes/2026-10-25.md'), N('/v/Templates/T.md', [], 1),
  ]);
  assert.deepEqual(r.orphans.map((n) => n.stem), ['Lonely']);
  assert.deepEqual(r.stubs, []);
});

test('stubs and duplicate stems', () => {
  const r = analyzeVault([N('/v/Plan.md', ['plan'], 3), N('/v/sub/plan.md', ['Plan'], 40)]);
  assert.deepEqual(r.stubs.map((n) => n.path), ['/v/Plan.md']);
  assert.deepEqual(r.duplicates, [{ stem: 'Plan', paths: ['/v/Plan.md', '/v/sub/plan.md'] }]);
});

test('score is the share of notes without any issue', () => {
  // A<->B healthy; C orphan; D links to a missing note (and is an orphan)
  const r = analyzeVault([N('/v/A.md', ['B']), N('/v/B.md', ['A']), N('/v/C.md'), N('/v/D.md', ['Nope'])]);
  assert.equal(r.score, 50);
});
