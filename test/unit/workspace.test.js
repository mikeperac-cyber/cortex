const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeWorkspace } = require('../../src/lib/workspace');

test('sanitizeWorkspace: garbage never throws and yields the empty workspace', () => {
  const empty = { tabs: [], active: null, panel: null, layout: 'split' };
  for (const raw of [null, undefined, 42, '{bad', '[]', '"x"', { tabs: 'a' }, []]) assert.deepEqual(sanitizeWorkspace(raw), empty); });
test('sanitizeWorkspace: keeps strings, dedupes by pathKey, caps at 20, repairs active/panel/layout', () => {
  const w = sanitizeWorkspace(JSON.stringify({ tabs: ['C:/v/A.md', 7, 'c:/V/a.MD', 'C:/v/B.md'], active: 'gone', panel: 'evil', layout: 'x' }));
  assert.deepEqual(w, { tabs: ['C:/v/A.md', 'C:/v/B.md'], active: 'C:/v/B.md', panel: null, layout: 'split' });
  assert.equal(sanitizeWorkspace({ tabs: Array.from({ length: 30 }, (_, i) => 'C:/v/' + i + '.md') }).tabs.length, 20); });
test('sanitizeWorkspace: valid panel and layout pass through', () =>
  assert.deepEqual(sanitizeWorkspace({ tabs: ['a'], active: 'a', panel: 'outline', layout: 'editor' }), { tabs: ['a'], active: 'a', panel: 'outline', layout: 'editor' }));
