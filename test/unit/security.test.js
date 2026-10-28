const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isSafeExternalUrl } = require('../../electron/security');

test('http, https and mailto URLs are safe', () => {
  for (const u of ['https://a.b', 'http://a.b/x?y=1', 'mailto:a@b.c']) assert.equal(isSafeExternalUrl(u), true, u);
});

test('other schemes and non-URLs are not safe', () => {
  for (const u of ['javascript:alert(1)', 'file:///c:/x', 'cmd:/c calc', 'not a url', '', undefined, null, 42]) {
    assert.equal(isSafeExternalUrl(u), false, String(u));
  }
});

test('only strings are URLs: values that merely stringify to a safe URL are refused', () => {
  for (const u of [['https://a.b'], { toString: () => 'https://a.b' }, new URL('https://a.b')]) {
    assert.equal(isSafeExternalUrl(u), false, String(u));
  }
});

test('dataforge plugin does not use innerHTML for empty query results', async () => {
  const fs = require('node:fs');
  const code = fs.readFileSync('src/plugins/dataforge/plugin.js', 'utf8');
  // runQuery should not assign innerHTML for 'No results found'
  assert.equal(code.includes("resultsEl.innerHTML = '<div"), false);
  assert.equal(code.includes("textContent = 'No results found'"), true);
});
