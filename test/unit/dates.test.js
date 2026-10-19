process.env.TZ = 'Europe/Istanbul';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { localDateStr } = require('../../src/lib/dates');

test('uses the local calendar day, not UTC', () => assert.equal(localDateStr(new Date('2026-10-19T22:30:00Z')), '2026-10-20'));
test('zero-pads month and day', () => assert.equal(localDateStr(new Date(2026, 0, 5, 12)), '2026-01-05'));
test('defaults to now', () => assert.match(localDateStr(), /^\d{4}-\d{2}-\d{2}$/));
