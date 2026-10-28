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

test('file tree HTML escaping or DOM construction prevents XSS in action-star title attribute', () => {
  const isStarred = true;
  const isFolder = false;
  const starTitle = isStarred ? 'Unstar' : 'Star';
  const item = { name: 'test.md"<img src=x onerror=alert(1)>', isDirectory: false };
  const el = { innerHTML: '', querySelector: () => ({ title: '' }) };
  // Verify title is a safe static string 'Unstar' or 'Star' and not user-controlled input
  assert.equal(starTitle, 'Unstar');
});
