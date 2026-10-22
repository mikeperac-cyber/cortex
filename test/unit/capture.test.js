const { test } = require('node:test');
const assert = require('node:assert/strict');
const { captureLine, captureAppendix } = require('../../src/lib/capture');

const at = new Date(2026, 9, 21, 9, 5);

test('captureLine: local HH:MM, one line, trimmed; blank -> ""', () => {
  assert.equal(captureLine('  idea\nsecond\tline ', at), '- 09:05 idea second line');
  assert.equal(captureLine('   ', at), '');
  assert.equal(captureLine('', at), '');
  assert.equal(captureLine(undefined, at), '');
});

test('captureLine: 24 h clock, and the time defaults to now', () => {
  assert.equal(captureLine('x', new Date(2026, 9, 21, 23, 0)), '- 23:00 x');
  assert.match(captureLine('x'), /^- \d\d:\d\d x$/);
});

test('captureAppendix: adds the heading once and never touches existing text', () => {
  assert.equal(captureAppendix('# D\n', '- a'), '\n## Captures\n- a\n');
  assert.equal(captureAppendix('# D\n\n## Captures\n- x\n', '- a'), '- a\n');
  assert.equal(captureAppendix('# D\n## Captures', '- a'), '\n- a\n');
  assert.equal(captureAppendix('# D', '- a'), '\n\n## Captures\n- a\n');
  assert.equal(captureAppendix('', '- a'), '## Captures\n- a\n');
});

test('captureAppendix: CRLF notes stay CRLF', () => assert.equal(captureAppendix('# D\r\n', '- a'), '\r\n## Captures\r\n- a\r\n'));

test('captureAppendix: the heading is a whole line (trailing spaces allowed), in CRLF notes too', () => {
  assert.equal(captureAppendix('# D\n\n## Captures  \n', '- a'), '- a\n');
  assert.equal(captureAppendix('# D\r\n\r\n## Captures\r\n- x\r\n', '- a'), '- a\r\n');
  assert.equal(captureAppendix('# D\n\n## Captures later\n', '- a'), '\n## Captures\n- a\n');
  assert.equal(captureAppendix('# D\n\n### Captures\n', '- a'), '\n## Captures\n- a\n');
  assert.equal(captureAppendix('# D\n\n- ## Captures\n', '- a'), '\n## Captures\n- a\n');
});
