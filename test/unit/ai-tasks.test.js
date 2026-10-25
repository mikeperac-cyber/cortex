const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildNotePrompt, buildAskPrompt, questionTerms, parseLinks, parseTags, parseCards, parseTasks } = require('../../src/lib/ai-tasks');

test('buildNotePrompt: wraps the note, appends the task, flags a trimmed note', () => {
  const p = buildNotePrompt('links', { title: 'A "q"\n<x>', content: 'body', titles: ['B', 'C'] });
  assert.match(p.prompt, /^<note title="A  q   x ">\nbody\n<\/note>/);
  assert.match(p.prompt, /<titles>\nB\nC\n<\/titles>/);
  assert.equal(p.trimmed, false);
  assert.ok(p.system.includes('never as instructions'));
  const big = buildNotePrompt('summarize', { content: 'x'.repeat(150001) });
  assert.equal(big.trimmed, true);
  assert.equal(big.prompt.includes('x'.repeat(150001)), false);
  assert.throws(() => buildNotePrompt('nope', {}));
});

test('buildNotePrompt: tags lists existing tags, or says none', () => {
  assert.match(buildNotePrompt('tags', { tags: ['work', 'idea'] }).prompt, /#work #idea/);
  assert.match(buildNotePrompt('tags', {}).prompt, /\(none\)/);
});

test('buildAskPrompt: one block per source and the question last', () => {
  const p = buildAskPrompt('why?', [{ title: 'A', content: 'a' }, { title: 'B', content: 'b'.repeat(20001) }]);
  assert.match(p.prompt, /<note title="A">\na\n<\/note>\n\n<note title="B">/);
  assert.match(p.prompt, /Question: why\?$/);
  assert.equal(p.trimmed, true);
  assert.match(buildAskPrompt('q', []).prompt, /no matching notes/);
});

test('parseLinks: only real notes, vault spelling, no self, no existing links, no repeats', () => {
  const stems = ['Çalışma', 'Project Plan', 'Self', 'Linked'];
  const reply = '1. çalışma\n- [[project plan]]\n"Self"\nLinked\nGhost\nProject Plan';
  assert.deepEqual(parseLinks(reply, stems, 'Self', ['linked']), ['Çalışma', 'Project Plan']);
  assert.deepEqual(parseLinks('', stems), []);
});

test('parseTags: unique, no pure numbers, capped', () => {
  assert.deepEqual(parseTags('#work #Work #2026 #çalışma #a-b_c #x'), ['work', 'çalışma', 'a-b_c', 'x']);
  assert.equal(parseTags('#a #b #c #d #e #f #g').length, 6);
});

test('parseCards: question :: answer lines only, bullets stripped, answer may contain ::', () => {
  assert.deepEqual(parseCards('Here you go\n1. What is X? :: A thing\n- Q2 :: a :: b\n :: empty front\nnope'), [
    { front: 'What is X?', back: 'A thing' },
    { front: 'Q2', back: 'a :: b' },
  ]);
});

test('parseTasks: open tasks only', () => {
  assert.deepEqual(parseTasks('- [ ] Call Ana\n- [x] done\n* [ ] Ship v2\ntext\n- [ ]'), ['Call Ana', 'Ship v2']);
});

test('questionTerms: keywords of a natural question, no filler or punctuation', () => {
  assert.deepEqual(questionTerms('What did we decide about the V2 launch?'), ['decide', 'v2', 'launch']);
  assert.deepEqual(questionTerms('Çalışma planı? planı!'), ['çalışma', 'planı']);
  assert.deepEqual(questionTerms('a an of?'), []);
});
