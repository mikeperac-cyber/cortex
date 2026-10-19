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
