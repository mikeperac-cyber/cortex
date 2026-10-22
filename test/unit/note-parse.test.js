const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseNote, normalizeStem, rewriteLinks, findMentions, linkMention } = require('../../src/lib/note-parse');

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
test('a decomposed (NFD) tag keeps its combining marks', () =>
  assert.deepEqual(p('#C\u0327al\u0131s\u0327ma x').tags.map((t) => t.normalize('NFC')), ['\u00C7al\u0131\u015Fma']));
test('# heading and #123 are not tags; url fragments are not tags', () => assert.deepEqual(p('# Title\n#123 http://x/#frag').tags, []));
test('frontmatter: inline list, block list, scalar; merges tags', () => {
  const r = p('---\ntags: [a, b]\nstatus: "active"\naliases:\n  - X\n---\n# T #c');
  assert.deepEqual(r.frontmatter, { tags: ['a', 'b'], status: 'active', aliases: ['X'] }); assert.deepEqual(r.tags, ['a', 'b', 'c']); });
test('unclosed frontmatter is treated as body', () => assert.deepEqual(p('---\ntags: [a]\n').frontmatter, {}));
test('BOM is stripped; title and headings', () => { const r = p('﻿# T\n## S'); assert.equal(r.title, 'T'); assert.deepEqual(r.headings, [{ level: 1, text: 'T', line: 0 }, { level: 2, text: 'S', line: 1 }]); });
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
  assert.deepEqual(p('## A ##\n```\n# no\n```\n#\n###### F').headings, [{ level: 2, text: 'A', line: 0 }, { level: 6, text: 'F', line: 5 }]); });
test('headings carry their 0-based original line; frontmatter counts, fenced headings are skipped', () =>
  assert.deepEqual(p('---\nt: 1\n---\n~~~\n# no\n~~~\n## Yes').headings, [{ level: 2, text: 'Yes', line: 6 }]));
test('frontmatter block lists may sit at column 0; a bare key is an empty string', () =>
  assert.deepEqual(p('---\naliases:\n- A\n- "B"\nempty:\n---').frontmatter, { aliases: ['A', 'B'], empty: '' }));
test('frontmatter tags accept a scalar and a leading #', () =>
  assert.deepEqual(p('---\ntags: "#x, y"\n---\n#X').tags, ['x', 'y']));

const r = rewriteLinks;
test('rewriteLinks: plain, alias, heading and embed forms', () => assert.equal(r('a [[Old]] [[old|x]] [[Old#H]] ![[Old]]', 'Old', 'New'), 'a [[New]] [[New|x]] [[New#H]] ![[New]]'));
test('rewriteLinks: does not touch longer names', () => assert.equal(r('[[Older]]', 'Old', 'New'), '[[Older]]'));
test('rewriteLinks: skips fenced and inline code', () => assert.equal(r('~~~\n[[Old]]\n~~~\n`[[Old]]` [[Old]]', 'Old', 'New'), '~~~\n[[Old]]\n~~~\n`[[Old]]` [[New]]'));
test('rewriteLinks: non-ASCII, case-insensitive match', () => assert.equal(r('[[çalışma]]', 'Çalışma', 'Yeni'), '[[Yeni]]'));
test('rewriteLinks: CRLF kept; links at start and end of the file; two on a line', () =>
  assert.equal(r('[[Old]] a\r\nb [[Old]] [[old|y]]\r\nc [[Old]]', 'Old', 'New'), '[[New]] a\r\nb [[New]] [[New|y]]\r\nc [[New]]'));
test('rewriteLinks: alias and heading together', () => assert.equal(r('[[Old#H|x]]', 'Old', 'New'), '[[New#H|x]]'));
test('rewriteLinks: identical output when nothing matches', () => {
  const s = '﻿---\r\nup: 1\r\n---\r\n[[Other]] `x` [[Old Notes]]\n';
  assert.equal(r(s, 'Old', 'New'), s);
});
test('rewriteLinks: frontmatter is skipped as parseNote skips it; CRLF fences hide links; BOM kept', () =>
  assert.equal(r('﻿---\r\nup: [[Old]]\r\n---\r\n```\r\n[[Old]]\r\n```\r\n[[Old]]', 'Old', 'New'), '﻿---\r\nup: [[Old]]\r\n---\r\n```\r\n[[Old]]\r\n```\r\n[[New]]'));
test('rewriteLinks: a padded target is replaced in place; [[#H]] and an alias that names the stem are not links to it', () =>
  assert.equal(r('[[ Old ]] [[#Old]] [[X|Old]] [[X#Old]]', 'old', 'New'), '[[ New ]] [[#Old]] [[X|Old]] [[X#Old]]'));

test('findMentions: whole words, any case, any number per line, original coordinates', () => {
  assert.deepEqual(findMentions('---\na: b\n---\nI read Target; target! Targets no', 'Target'), [{ line: 3, col: 7 }, { line: 3, col: 15 }]); });
test('findMentions: skips links, code, URLs, link targets, frontmatter; short stems', () => {
  assert.deepEqual(findMentions('[[Target]] [[Target|x]] `Target` ![[Target]] [t](http://x/Target) https://x/Target\n~~~\nTarget\n~~~', 'Target'), []);
  assert.deepEqual(findMentions('---\ntitle: Target\n---\nbody', 'Target'), []); assert.deepEqual(findMentions('ab ab', 'ab'), []); });
test('findMentions: non-ASCII and CRLF', () => assert.deepEqual(findMentions('x\r\nsee çalışma', 'Çalışma'), [{ line: 1, col: 4 }]));
test('linkMention: exact case -> [[Stem]], other case keeps the text as alias, stale -> null', () => {
  assert.equal(linkMention('see Target now', { line: 0, col: 4 }, 'Target'), 'see [[Target]] now');
  assert.equal(linkMention('see target now', { line: 0, col: 4 }, 'Target'), 'see [[Target|target]] now');
  assert.equal(linkMention('see [[Target]] now', { line: 0, col: 6 }, 'Target'), null);
  assert.equal(linkMention('a\r\nsee Target', { line: 1, col: 4 }, 'Target'), 'a\r\nsee [[Target]]'); });
test('findMentions: link text and tags are not prose; a BOM is no column; over-long lines are skipped', () => {
  assert.deepEqual(findMentions('[Target](x) #target #a/target Target', 'Target'), [{ line: 0, col: 30 }]);
  assert.deepEqual(findMentions('﻿Target', 'Target'), [{ line: 0, col: 0 }]);
  assert.equal(linkMention('﻿Target', { line: 0, col: 0 }, 'Target'), '﻿[[Target]]');
  assert.deepEqual(findMentions('Target ' + 'x'.repeat(10000), 'Target'), []); });
test('findMentions: linear on pathological lines; an unclosed [[ hides the rest of its line', () => {
  const t0 = Date.now();
  assert.equal(findMentions(('Target ' + '[['.repeat(4990) + ' Target\n').repeat(50), 'Target').length, 50);
  assert.deepEqual(findMentions('[[x [Target]] [[Target', 'Target'), []);
  assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0} ms`); });
test('linkMention: a position that is not a mention, or a bad one, gives null', () => {
  for (const m of [{ line: 0, col: 5 }, { line: 1, col: 0 }, null, {}]) assert.equal(linkMention('see Target', m, 'Target'), null); });
test('rewriteLinks: a decomposed spelling matches the precomposed stem', () => assert.equal(r('[[Ça]]', 'Ça', 'B'), '[[B]]'));
