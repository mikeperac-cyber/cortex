const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseNote, normalizeStem } = require('../../src/lib/note-parse');

const p = parseNote;
test('wikilink forms', () => {
  assert.deepEqual(p('[[A]] [[B|x]] [[C#H]] ![[D]]').links.map(l => [l.target, l.alias, l.heading]),
    [['A', null, null], ['B', 'x', null], ['C', null, 'H'], ['D', null, null]]); });
test('same-note [[#H]] and empty [[]] links are skipped', () => assert.deepEqual(p('[[#H]] [[]]').links, []));
test('link line numbers are 0-based and CRLF-safe', () => assert.equal(p('a\r\nb [[X]]').links[0].line, 1));
test('code fences (``` and ~~~) and inline code hide links and tags', () => {
  const r = p('~~~\n[[In]] #in\n~~~\n`[[Also]] #also` [[Out]] #out');
  assert.deepEqual(r.links.map(l => l.target), ['Out']); assert.deepEqual(r.tags, ['out']); });
test('tags: dedupe case-insensitively, first casing wins', () => assert.deepEqual(p('#Project #project').tags, ['Project']));
test('tags keep non-ASCII and nested', () => assert.deepEqual(p('#çalışma #a/b').tags, ['çalışma', 'a/b']));
test('# heading and #123 are not tags; url fragments are not tags', () => assert.deepEqual(p('# Title\n#123 http://x/#frag').tags, []));
test('frontmatter: inline list, block list, scalar; merges tags', () => {
  const r = p('---\ntags: [a, b]\nstatus: "active"\naliases:\n  - X\n---\n# T #c');
  assert.deepEqual(r.frontmatter, { tags: ['a', 'b'], status: 'active', aliases: ['X'] }); assert.deepEqual(r.tags, ['a', 'b', 'c']); });
test('unclosed frontmatter is treated as body', () => assert.deepEqual(p('---\ntags: [a]\n').frontmatter, {}));
test('BOM is stripped; title and headings', () => { const r = p('﻿# T\n## S'); assert.equal(r.title, 'T'); assert.deepEqual(r.headings, [{ level: 1, text: 'T' }, { level: 2, text: 'S' }]); });
test('normalizeStem folds case and Unicode form (decomposed C+cedilla == precomposed ç)', () =>
  assert.equal(normalizeStem('Çalışma'), normalizeStem('çalışma')));

test('frontmatter lines add no body links/tags/headings; line is the original index', () => {
  const r = p('﻿---\ntitle: x #nope [[Nope]]\n# H\n---\n[[Real]] #real');
  assert.deepEqual(r.links, [{ target: 'Real', alias: null, heading: null, line: 4 }]);
  assert.deepEqual(r.tags, ['real']); assert.deepEqual(r.headings, []); assert.equal(r.title, ''); });
test('CRLF frontmatter parses clean and keeps link lines', () => {
  const r = p('---\r\ntags: [a]\r\nstatus: ok\r\n---\r\n[[X]]\r\n');
  assert.deepEqual(r.frontmatter, { tags: ['a'], status: 'ok' }); assert.equal(r.links[0].line, 4); });
test('non-string input yields an empty note instead of throwing', () => {
  for (const bad of [undefined, null, 42, {}]) assert.deepEqual(p(bad), { frontmatter: {}, title: '', headings: [], tags: [], links: [] });
  assert.equal(normalizeStem(undefined), ''); assert.equal(normalizeStem(null), ''); });
test('alias and heading together; empty alias/heading become null', () => {
  assert.deepEqual(p('[[T#H|a]] [[U|]] [[V#]]').links.map(l => [l.target, l.alias, l.heading]), [['T', 'a', 'H'], ['U', null, null], ['V', null, null]]); });
test('an unclosed fence hides the rest; double-backtick spans hide links', () => {
  assert.deepEqual(p('``` js\n[[In]]\n[[Also]] #in').links, []);
  assert.deepEqual(p('`` a ` [[In]] `` [[Out]]').links.map(l => l.target), ['Out']); });
test('headings: closing hashes stripped; fenced and empty ones skipped', () => {
  assert.deepEqual(p('## A ##\n```\n# no\n```\n#\n###### F').headings, [{ level: 2, text: 'A' }, { level: 6, text: 'F' }]); });
test('frontmatter block lists may sit at column 0; a bare key is an empty string', () =>
  assert.deepEqual(p('---\naliases:\n- A\n- "B"\nempty:\n---').frontmatter, { aliases: ['A', 'B'], empty: '' }));
test('frontmatter tags accept a scalar and a leading #', () =>
  assert.deepEqual(p('---\ntags: "#x, y"\n---\n#X').tags, ['x', 'y']));
