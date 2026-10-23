const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown, toggleTaskByIndex } = require('../../src/lib/markdown');

const R = renderMarkdown;
test('raw HTML is escaped', () => { const h = R('<script>alert(1)</script>'); assert.match(h, /&lt;script&gt;/); assert.doesNotMatch(h, /<script/); });
test('inline raw HTML is escaped too', () => assert.doesNotMatch(R('a <img src=x onerror=alert(1)> b'), /<img/));
test('javascript: links lose their anchor', () => assert.doesNotMatch(R('[x](javascript:alert(1))'), /javascript:/i));
test('obfuscated schemes and autolinks are dropped too', () => {
  // each href as the browser reads it: attribute entities decoded, C0 controls and spaces dropped
  const hrefs = (h) => [...h.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]
    .replace(/&#(\d+);/g, (x, d) => String.fromCharCode(d)).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[\x00-\x20]/g, ''));
  for (const md of ['[x](JaVaScRiPt:alert(1))', '[x](java&#x09;script:alert(1))', '[x](java\tscript:alert(1))', '[x](%20javascript:alert(1))',
    '[x](data:text/html,<b>)', '<javascript:alert(1)>', '[x](vbscript:msgbox)', '[x]: javascript:alert(1)\n\n[x]', '![x](data:text/html,x)'])
    for (const href of hrefs(R(md))) assert.doesNotMatch(href, /^(?!https?:|mailto:|data:image\/)[a-z][a-z0-9+.-]*:/i, md);
});
test('quotes cannot break out of attributes', () => { for (const md of ['[x](a" onmouseover="alert`1`)', '![i](x" onerror="alert`1`)']) assert.doesNotMatch(R(md), /<[^>]*\son(mouseover|error)=/i); });
test('images: https kept, javascript: dropped', () => { assert.match(R('![a](https://x/y.png)'), /<img[^>]+src="https:\/\/x\/y\.png"/); assert.doesNotMatch(R('![a](javascript:alert(1))'), /<img/); });
test('images: base64 raster data kept, svg data dropped', () => {
  assert.match(R('![a](data:image/png;base64,iVBORw0KGgo=)'), /<img[^>]+src="data:image\/png;base64,/);
  assert.doesNotMatch(R('![a](data:image/svg+xml;base64,PHN2Zz4=)'), /<img/);
});
test('allowed links keep their href', () => {
  assert.match(R('[a](https://x.y/?q=1&r=2)'), /href="https:\/\/x\.y\/\?q=1&amp;r=2"/);
  assert.match(R('[a](mailto:me@x.y)'), /href="mailto:me@x\.y"/);
  assert.match(R('[a](#top)'), /href="#top"/);
  assert.match(R('[a](notes/b.md)'), /href="notes\/b\.md"/);
});
test('task lists render checkboxes with data-task', () => { const h = R('- [ ] a\n- [x] b'); assert.equal((h.match(/type="checkbox"/g) || []).length, 2); assert.match(h, /data-task="0"/); assert.match(h, /data-task="1"[^>]*checked|checked[^>]*data-task="1"/); });
test('task checkboxes are not disabled', () => assert.doesNotMatch(R('- [ ] a'), /disabled/));
test('task numbering skips fenced tasks, matching toggleTaskByIndex', () => {
  const md = '```\n- [ ] in fence\n```\n- [ ] first\n> - [x] quoted';
  const h = R(md);
  assert.equal((h.match(/type="checkbox"/g) || []).length, 2);
  assert.match(h, /data-task="0"[^>]*>\s*first/);
  assert.match(h, /data-task="1"[^>]*checked[^>]*>\s*quoted/);
  assert.equal(toggleTaskByIndex(md, 1), '```\n- [ ] in fence\n```\n- [ ] first\n> - [ ] quoted');
});
test('wikilinks: alias, heading, unresolved class', () => { const h = R('[[B|bee]] [[Gone#H]]', { isResolved: t => t === 'B' }); assert.match(h, /data-note="B"[^>]*>bee</); assert.match(h, /class="wikilink unresolved"/); assert.match(h, /data-heading="H"/); });
test('wikilink exact markup', () => {
  assert.equal(R('[[B|bee]]', { isResolved: () => true }), '<p><a href="#" class="wikilink" data-note="B">bee</a></p>\n');
  assert.equal(R('[[Gone#H]]'), '<p><a href="#" class="wikilink unresolved" data-note="Gone" data-heading="H">Gone</a></p>\n');
});
test('wikilink text and targets are escaped', () => {
  const h = R('[["><img src=x onerror=alert(1)>|<b>x</b>]]');
  assert.doesNotMatch(h, /<img|<b>/);
  assert.match(h, /data-note="&quot;&gt;&lt;img/);
});
test('wikilinks inside code stay literal', () => assert.doesNotMatch(R('`[[A]]`'), /wikilink/));
test('snake_case and * bullets are not italicised', () => { assert.match(R('my_var_name'), /my_var_name/); assert.match(R('* item'), /<li>item<\/li>/); });
test('tables get <table>; fenced code stays literal; frontmatter is hidden', () => { assert.match(R('| a |\n|---|\n| b |'), /<table>/); assert.match(R('~~~\n**x**\n~~~'), /\*\*x\*\*/); assert.doesNotMatch(R('---\ntags: [a]\n---\n# T'), /tags:/); });
test('fenced code is escaped', () => assert.match(R('```html\n<script>x</script>\n```'), /&lt;script&gt;/));
test('empty input renders empty string', () => assert.equal(R(''), ''));
test('toggleTaskByIndex', () => {
  assert.equal(toggleTaskByIndex('- [ ] a\n- [x] b', 1), '- [ ] a\n- [ ] b');
  assert.equal(toggleTaskByIndex('~~~\n- [ ] no\n~~~\n- [ ] yes', 0), '~~~\n- [ ] no\n~~~\n- [x] yes');
  assert.equal(toggleTaskByIndex('  * [ ] a', 0), '  * [x] a'); assert.equal(toggleTaskByIndex('- [X] a', 0), '- [ ] a');
  assert.equal(toggleTaskByIndex('- [ ] a', 5), '- [ ] a'); });
test('toggleTaskByIndex keeps CRLF, BOM and frontmatter; numbers like the renderer', () => {
  assert.equal(toggleTaskByIndex('﻿---\nx: 1\n---\r\n+ [ ] a\r\n- [ ] b\r\n', 1), '﻿---\nx: 1\n---\r\n+ [ ] a\r\n- [x] b\r\n');
  assert.equal(toggleTaskByIndex('- [ ] a', -1), '- [ ] a');
});
