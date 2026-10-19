const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeName } = require('../../src/lib/names');

const n = (s, e = '.md') => normalizeName(s, e);

test('adds .md once', () => { assert.equal(n('Idea').name, 'Idea.md'); assert.equal(n('Idea.md').name, 'Idea.md'); });
test('trims; keeps subfolders', () => { assert.equal(n('  spaced  ').name, 'spaced.md'); assert.equal(n('Projects/Plan').name, 'Projects/Plan.md'); });
test('accepts non-ASCII', () => assert.equal(n('Çalışma notları').name, 'Çalışma notları.md'));
test('folder names use ext ""', () => assert.equal(n('Archive', '').name, 'Archive'));
test('rejects traversal, illegal chars, reserved names, empty, trailing dot', () => {
  for (const bad of ['../x', 'a/../b', 'a:b', 'a|b', 'a?b', 'a\\b', 'a\\..\\b', 'CON', 'nul.md', '', '   ', 'x.']) assert.equal(n(bad, bad === 'x.' ? '' : '.md').ok, false, bad);
});
test('rejects absolute paths, empty segments, hidden segments, trailing dot with ext', () => {
  for (const bad of ['/abs', 'a//b', 'a/', '.hidden', 'a/.git/b', '.md', 'x.', 'a /b']) assert.equal(n(bad).ok, false, bad);
});
test('failure carries a message', () => assert.equal(typeof n('a:b').error, 'string'));
