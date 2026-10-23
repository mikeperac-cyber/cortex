const { test } = require('node:test');
const assert = require('node:assert/strict');
const { continueList, indentSelection, toggleWrap } = require('../../src/lib/editor-edits');

const apply = (t, e) => t.slice(0, e.from) + e.insert + t.slice(e.to);

test('continueList: bullet, number, task, nested', () => {
  assert.equal(apply('- a', continueList('- a', 3)), '- a\n- ');
  assert.equal(apply('1. a', continueList('1. a', 4)), '1. a\n2. ');
  assert.equal(apply('- [x] done', continueList('- [x] done', 10)), '- [x] done\n- [ ] ');
  assert.equal(apply('  - n', continueList('  - n', 5)), '  - n\n  - '); });
test('continueList: empty item exits the list; mid-line and plain lines are null', () => {
  assert.equal(apply('- ', continueList('- ', 2)), ''); assert.equal(continueList('- a b', 3), null); assert.equal(continueList('plain', 5), null); });
test('indentSelection: multi-line, outdent, collapsed caret', () => {
  assert.equal(apply('a\nb\nc', indentSelection('a\nb\nc', 0, 3, false)), '  a\n  b\nc');
  assert.equal(apply('  a', indentSelection('  a', 0, 3, true)), 'a');
  assert.equal(apply('a', indentSelection('a', 1, 1, false)), 'a  '); });
test('toggleWrap: wrap, unwrap, empty selection', () => {
  const w = toggleWrap('word', 0, 4, '**'); assert.equal(apply('word', w), '**word**'); assert.deepEqual([w.selStart, w.selEnd], [2, 6]);
  assert.equal(apply('**word**', toggleWrap('**word**', 2, 6, '**')), 'word');
  const e = toggleWrap('', 0, 0, '*'); assert.equal(apply('', e), '**'); assert.equal(e.selStart, 1); });

// beyond the brief: the other list kinds, caret placement, a line in the middle of the text, outdent by tab
test('continueList: *, +, quote, caret lands after the new prefix, later text kept', () => {
  assert.equal(apply('* a', continueList('* a', 3)), '* a\n* ');
  assert.equal(apply('+ a', continueList('+ a', 3)), '+ a\n+ ');
  assert.equal(apply('> q', continueList('> q', 3)), '> q\n> ');
  assert.equal(apply('9. a\nz', continueList('9. a\nz', 4)), '9. a\n10. \nz');
  const e = continueList('- a\nz', 3); assert.deepEqual([e.selStart, e.selEnd], [6, 6]);
  const x = continueList('x\n  - [ ] \ny', 10); assert.equal(apply('x\n  - [ ] \ny', x), 'x\n\ny'); assert.equal(x.selStart, 2); });
test('indentSelection: outdent removes a tab, keeps the selection on the same text', () => {
  assert.equal(apply('\ta\nb', indentSelection('\ta\nb', 0, 4, true)), 'a\nb');
  const e = indentSelection('a\nb', 1, 3, false); assert.equal(apply('a\nb', e), '  a\n  b'); assert.deepEqual([e.selStart, e.selEnd], [3, 7]);
  assert.equal(apply('x', indentSelection('x', 0, 1, true)), 'x'); });
test('toggleWrap: unwrap when the markers sit just outside the selection', () => {
  const e = toggleWrap('**word**', 2, 6, '**'); assert.deepEqual([e.selStart, e.selEnd], [0, 4]);
  assert.equal(apply('*w*', toggleWrap('*w*', 0, 3, '*')), 'w'); });
