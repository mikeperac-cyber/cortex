const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { join, dirname } = require('node:path');
const { VaultIndex } = require('../../electron/vault-index');

// A key ending in "/" makes an (empty) directory instead of a file.
function put(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    if (rel.endsWith('/')) { fs.mkdirSync(abs, { recursive: true }); continue; }
    fs.mkdirSync(dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
}

function setup(t, files = {}) {
  const base = fs.mkdtempSync(join(os.tmpdir(), 'cortex-vidx-'));
  const root = join(base, 'v');
  fs.mkdirSync(root);
  put(root, files);
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return { base, root, idx: new VaultIndex() };
}

async function indexed(t, files) {
  const s = setup(t, files);
  await s.idx.reset(s.root);
  return s;
}

const names = (idx) => idx.notes().map((n) => n.name).sort();
const code = (c) => Object.assign(new Error(c), { code: c });

// Temporarily replaces an fs/promises function (the index looks it up at call time).
async function patched(name, make, fn) {
  const real = fsp[name];
  fsp[name] = make(real);
  try { return await fn(); } finally { fsp[name] = real; }
}

test('reset indexes nested .md; ignores .txt, dot entries, descends into a directory named x.md', async (t) => {
  const { idx } = await indexed(t, {
    'Welcome.md': '# Welcome', 'a/Dup.md': 'd', 'Çalışma.md': 'c', 'notes.txt': 'no',
    '.git/Hidden.md': 'h', '.dot.md': 'd', 'weird.md/Inner.md': 'in', 'empty.md/': '', 'UP.MD': 'u',
  });
  assert.deepEqual(names(idx), ['Dup.md', 'Inner.md', 'UP.MD', 'Welcome.md', 'Çalışma.md']);
});

test('reset of a missing or invalid root yields an empty index and does not throw', async (t) => {
  const { base, idx } = setup(t);
  await idx.reset(join(base, 'nope'));
  assert.deepEqual(idx.notes(), []);
  await idx.reset(undefined);
  assert.deepEqual(idx.notes(), []);
});

test('NoteMeta shape: no content; words counts the body after frontmatter; path keeps the on-disk spelling', async (t) => {
  const { root, idx } = await indexed(t, { 'Sub/Note.md': '---\ntitle: x words here\n---\n# Title\n#tag one [[Other]] three\nfour' });
  const [n] = idx.notes();
  assert.deepEqual(Object.keys(n).sort(), ['links', 'mtimeMs', 'name', 'path', 'stem', 'tags', 'title', 'words']);
  assert.equal(n.content, undefined);
  assert.equal(n.path, join(root, 'Sub', 'Note.md'));
  assert.deepEqual([n.name, n.stem, n.title, n.tags, n.words], ['Note.md', 'Note', 'Title', ['tag'], 7]);
  assert.deepEqual(n.links.map((l) => [l.target, l.line]), [['Other', 4]]);
  assert.ok(n.mtimeMs > 0);
  for (const r of [idx.resolve('note'), idx.tags(), idx.graph(), idx.search('title'), idx.backlinks(n.path)]) {
    assert.ok(!JSON.stringify(r).includes('"content"'));
  }
});

test('resolve is case-insensitive for non-ASCII and Unicode-form-insensitive', async (t) => {
  const { idx } = await indexed(t, { 'Çalışma.md': 'x' });
  assert.equal(idx.resolve('çalışma').name, 'Çalışma.md');
  assert.equal(idx.resolve('c\u0327al\u0131\u015fma').name, 'Çalışma.md'); // decomposed ç
  assert.equal(idx.resolve('nope'), null);
  assert.equal(idx.resolve(undefined), null);
});

test('resolve: duplicate stems pick fewest segments, then shortest path, then alphabetical', async (t) => {
  const { root, idx } = await indexed(t, {
    'x/y/One.md': '', 'z/One.md': '',
    'bb/Two.md': '', 'c/Two.md': '',
    'b/Three.md': '', 'a/Three.md': '',
  });
  assert.equal(idx.resolve('One').path, join(root, 'z/One.md'));
  assert.equal(idx.resolve('Two').path, join(root, 'c/Two.md'));
  assert.equal(idx.resolve('three').path, join(root, 'a/Three.md'));
});

const BACK = {
  'Welcome.md': '# Welcome\n[[Welcome]] self\n',
  'Ref.md': 'a\nb\nsee [[Welcome|home]]\n',
  'Other.md': 'x [[welcome#Part]] y [[Welcome]]\nz\n',
  'Win.md': 'a\r\n[[Welcome]]\r\n',
  'Lonely.md': '[[Missing]]',
};

test('backlinks: alias and heading forms count, self excluded, one row per line, CRLF-clean text', async (t) => {
  const { root, idx } = await indexed(t, BACK);
  assert.deepEqual(idx.backlinks(join(root, 'Welcome.md')).map((b) => [b.stem, b.line, b.text]), [
    ['Other', 0, 'x [[welcome#Part]] y [[Welcome]]'],
    ['Ref', 2, 'see [[Welcome|home]]'],
    ['Win', 1, '[[Welcome]]'],
  ]);
  assert.equal(idx.backlinks(join(root, 'Welcome.md'))[1].path, join(root, 'Ref.md'));
});

test('backlinks: path keys are case-insensitive and accept forward slashes; unknown path gives []', async (t) => {
  const { root, idx } = await indexed(t, BACK);
  const alt = join(root, 'Welcome.md').toUpperCase().replace(/\\/g, '/');
  assert.equal(idx.backlinks(alt).length, 3);
  assert.deepEqual(idx.backlinks(join(root, 'Nope.md')), []);
  assert.deepEqual(idx.backlinks(undefined), []);
});

test('mentions: plain-text mentions in other notes by stem then position, CRLF-clean text; self excluded; limit; unknown path', async (t) => {
  const { root, idx } = await indexed(t, {
    'Target.md': 'Target names itself',
    'B.md': 'x\r\nsee target and [[Target]] and TARGET\r\n',
    'A.md': 'Target first',
    'Other.md': 'nothing here',
    'sub/Target.md': 'a shadowed duplicate',
  });
  const target = join(root, 'Target.md');
  assert.deepEqual(idx.mentions(target), [
    { path: join(root, 'A.md'), stem: 'A', line: 0, col: 0, text: 'Target first' },
    { path: join(root, 'B.md'), stem: 'B', line: 1, col: 4, text: 'see target and [[Target]] and TARGET' },
    { path: join(root, 'B.md'), stem: 'B', line: 1, col: 30, text: 'see target and [[Target]] and TARGET' },
  ]);
  assert.deepEqual(idx.mentions(target, 2).map((m) => [m.stem, m.col]), [['A', 0], ['B', 4]]);
  assert.deepEqual(idx.mentions(join(root, 'sub', 'Target.md')), [], '[[Target]] would not point at the shadowed note');
  assert.deepEqual(idx.mentions(join(root, 'Nope.md')), []);
  assert.deepEqual(idx.mentions(undefined), []);
});

test('graph: ids are paths, labels are stems, deduped edges, self and unresolved dropped', async (t) => {
  const { root, idx } = await indexed(t, {
    'A.md': '[[B]]\n[[b|again]]\n[[A]] [[Missing]]', 'B.md': '[[A#H]]', 'C.md': '',
  });
  const g = idx.graph();
  assert.deepEqual(g.nodes, ['A', 'B', 'C'].map((s) => ({ id: join(root, s + '.md'), label: s })));
  assert.deepEqual(g.edges, [
    { source: join(root, 'A.md'), target: join(root, 'B.md') },
    { source: join(root, 'B.md'), target: join(root, 'A.md') },
  ]);
});

test('tags: counts, order, case-insensitive grouping, first casing in path order, sorted paths', async (t) => {
  const { root, idx } = await indexed(t, {
    'b/Two.md': '#alpha #project #beta', 'a/One.md': '#alpha #Project', 'c/Three.md': 'no tags',
  });
  assert.deepEqual(idx.tags(), [
    { tag: 'alpha', count: 2, paths: [join(root, 'a/One.md'), join(root, 'b/Two.md')] },
    { tag: 'Project', count: 2, paths: [join(root, 'a/One.md'), join(root, 'b/Two.md')] },
    { tag: 'beta', count: 1, paths: [join(root, 'b/Two.md')] },
  ]);
});

const SEARCH = {
  'Meeting.md': 'agenda\n',
  'Notes.md': '# Project Meeting\ntext',
  'Heads.md': '# Top\n## Meeting minutes\nbody',
  'Body.md': 'we had a meeting yesterday\nsecond line',
  'Long.md': 'start ' + 'lorem ipsum '.repeat(40) + 'needle ' + 'dolor sit '.repeat(40),
  'Other.md': 'nothing here',
  'Çalışma.md': 'x',
};

test('search: stem/title outrank heading outrank body; ties by stem; case-insensitive', async (t) => {
  const { idx } = await indexed(t, SEARCH);
  const res = idx.search('MEETING');
  assert.deepEqual(res.map((r) => r.stem), ['Meeting', 'Notes', 'Heads', 'Body']);
  assert.ok(res[0].score === res[1].score && res[1].score > res[2].score && res[2].score > res[3].score);
  assert.deepEqual(Object.keys(res[0]).sort(), ['path', 'score', 'snippet', 'stem']);
  assert.equal(idx.search('çalışma')[0].stem, 'Çalışma');
  assert.equal(idx.search('c\u0327al\u0131\u015fma')[0].stem, 'Çalışma'); // decomposed ç
});

test('search: all terms must match, in any field; limit caps; empty or blank query gives []', async (t) => {
  const { idx } = await indexed(t, SEARCH);
  assert.deepEqual(idx.search('meeting yesterday').map((r) => r.stem), ['Body']);
  assert.deepEqual(idx.search('yesterday notes'), []);
  assert.deepEqual(idx.search('meeting body').map((r) => r.stem), ['Body', 'Heads']);
  assert.equal(idx.search('meeting', 2).length, 2);
  assert.deepEqual(idx.search(''), []);
  assert.deepEqual(idx.search('  \t '), []);
});

test('search: snippet is one short line around the first body hit; stem-only hit shows the stem', async (t) => {
  const { idx } = await indexed(t, SEARCH);
  const by = Object.fromEntries(idx.search('meeting').map((r) => [r.stem, r.snippet]));
  assert.equal(by.Meeting, 'Meeting');
  assert.match(by.Body, /^we had a meeting yesterday$/);
  const long = idx.search('needle')[0].snippet;
  assert.match(long, /needle/);
  assert.ok(long.length <= 125 && !/[\r\n]/.test(long), long);
  assert.ok(long.startsWith('…') && long.endsWith('…'));
  assert.match(idx.search('SECOND')[0].snippet, /second line/);
});

test('search: snippet stays aligned with the original lines after leading blank lines', async (t) => {
  const { idx } = await indexed(t, {
    'Fm.md': '---\ntags: [a]\n---\n\nThe Meeting was LONG\nsecond',
    'Blank.md': '\n\nfirst line\nMeeting Here',
  });
  const by = Object.fromEntries(idx.search('meeting').map((r) => [r.stem, r.snippet]));
  assert.equal(by.Fm, 'The Meeting was LONG');
  assert.equal(by.Blank, 'Meeting Here');
});

test('empty vault: all queries return empty results', async (t) => {
  const { root, idx } = await indexed(t);
  assert.deepEqual(idx.notes(), []);
  assert.deepEqual(idx.graph(), { nodes: [], edges: [] });
  assert.deepEqual(idx.tags(), []);
  assert.deepEqual(idx.search('x'), []);
  assert.deepEqual(idx.backlinks(join(root, 'a.md')), []);
  assert.equal(idx.resolve('a'), null);
});

test('update: added, changed refreshes tags, unchanged is ignored, removed drops backlinks', async (t) => {
  const { root, idx } = await indexed(t, { 'Target.md': 'x', 'Src.md': '[[Target]] #old' });
  const target = join(root, 'Target.md');
  const fresh = join(root, 'sub', 'Fresh.md');
  fs.mkdirSync(dirname(fresh));
  fs.writeFileSync(fresh, '[[Target]]');
  assert.equal(await idx.update(fresh), 'added');
  assert.equal(idx.backlinks(target).length, 2);
  assert.equal(await idx.update(fresh), 'ignored');
  fs.writeFileSync(join(root, 'Src.md'), '[[Target]] #new #fresh');
  assert.equal(await idx.update(join(root, 'Src.md')), 'changed');
  assert.deepEqual(idx.tags().map((x) => x.tag), ['fresh', 'new']);
  fs.unlinkSync(fresh);
  assert.equal(await idx.update(fresh), 'removed');
  assert.deepEqual(idx.backlinks(target).map((b) => b.stem), ['Src']);
  assert.equal(await idx.update(fresh), 'ignored');
});

// Windows paths are case-insensitive: the renderer may pass any spelling, the index keeps the one on disk.
const winOnly = { skip: process.platform !== 'win32' && 'case-insensitive file system only' };
const sloppy = (p) => p.toLowerCase().replace(/\\/g, '/');

test('update with another spelling of an unchanged note is ignored and keeps the on-disk spelling', winOnly, async (t) => {
  const { root, idx } = await indexed(t, { 'Sub/Note.md': '# Real' });
  const before = idx.notes()[0];
  assert.equal(await idx.update(sloppy(join(root, 'Sub', 'Note.md'))), 'ignored');
  assert.equal(await idx.update(join(root, 'SUB', 'NOTE.MD')), 'ignored');
  const [n] = idx.notes();
  assert.deepEqual([n.path, n.name, n.stem], [join(root, 'Sub', 'Note.md'), 'Note.md', 'Note']);
  assert.equal(n, before); // not re-parsed
  assert.equal(idx.resolve('note').stem, 'Note');
  fs.writeFileSync(join(root, 'Sub', 'Note.md'), '# Real two');
  assert.equal(await idx.update(sloppy(join(root, 'Sub', 'Note.md'))), 'changed');
  assert.deepEqual([idx.notes()[0].path, idx.notes()[0].title], [join(root, 'Sub', 'Note.md'), 'Real two']);
});

test('update(dir) with another spelling keeps the on-disk spelling of every child', winOnly, async (t) => {
  const { root, idx } = await indexed(t, { 'Top/Sub/Note.md': 'n', 'Top/Other.md': 'o' });
  put(root, { 'Top/Sub/Fresh.md': 'f' });
  fs.writeFileSync(join(root, 'Top/Other.md'), 'o2');
  assert.equal(await idx.update(sloppy(join(root, 'Top'))), 'added');
  assert.deepEqual(idx.notes().map((n) => n.path), ['Top/Other.md', 'Top/Sub/Fresh.md', 'Top/Sub/Note.md'].map((r) => join(root, r)));
  assert.equal(await idx.update(sloppy(join(root, 'Top', 'Sub'))), 'ignored');
  assert.deepEqual(idx.notes().map((n) => n.name), ['Other.md', 'Fresh.md', 'Note.md']);
});

test('a case-only rename is picked up by an update with either spelling', winOnly, async (t) => {
  const { root, idx } = await indexed(t, { 'Note.md': 'n', 'Dir/Child.md': 'c' });
  fs.renameSync(join(root, 'Note.md'), join(root, 'note.md'));
  assert.equal(await idx.update(join(root, 'Note.md')), 'changed');
  assert.deepEqual(idx.notes().map((n) => n.name), ['Child.md', 'note.md']);
  fs.renameSync(join(root, 'Dir'), join(root, 'dir'));
  assert.equal(await idx.update(join(root, 'DIR')), 'changed');
  assert.deepEqual(idx.notes().map((n) => n.path), [join(root, 'dir/Child.md'), join(root, 'note.md')]);
});

test('paths keep the spelling of the root given to reset', winOnly, async (t) => {
  const { root, idx } = setup(t, { 'Sub/Note.md': 'n' });
  const given = join(dirname(root), 'V');
  await idx.reset(given);
  assert.equal(idx.notes()[0].path, join(given, 'Sub', 'Note.md'));
  assert.equal(await idx.update(join(root, 'Sub', 'Note.md')), 'ignored');
  assert.equal(idx.notes()[0].path, join(given, 'Sub', 'Note.md'));
});

test('update: unknown, non-md, outside the root and dot-segment paths are ignored; never throws', async (t) => {
  const { base, root, idx } = await indexed(t, { 'x.txt': 'x', '.git/x.md': 'g', '.obsidian/notes.md': 'o', 'ok.md': 'ok' });
  fs.writeFileSync(join(base, 'outside.md'), 'o');
  for (const p of [join(root, 'nope.md'), join(root, 'x.txt'), join(root, '.git/x.md'), join(root, '.obsidian/notes.md'),
    join(root, '.git'), join(base, 'outside.md'), join(root, '..', 'outside.md'), '', undefined, null, 42, {}]) {
    assert.equal(await idx.update(p), 'ignored', String(p));
  }
  assert.deepEqual(names(idx), ['ok.md']);
});

test('update before any reset is ignored', async (t) => {
  const { root } = setup(t, { 'a.md': 'a' });
  assert.equal(await new VaultIndex().update(join(root, 'a.md')), 'ignored');
});

test('update: a half-written file is parsed as far as it goes', async (t) => {
  const { root, idx } = await indexed(t);
  fs.writeFileSync(join(root, 'Half.md'), '---\ntags: [a\n# Ti [[Unfin');
  assert.equal(await idx.update(join(root, 'Half.md')), 'added');
  fs.writeFileSync(join(root, 'Empty.md'), '');
  assert.equal(await idx.update(join(root, 'Empty.md')), 'added');
  assert.deepEqual(names(idx), ['Empty.md', 'Half.md']);
});

test('update: a file that vanishes between stat and read is removed; other read errors keep the note', async (t) => {
  const { root, idx } = await indexed(t, { 'Gone.md': 'g', 'Busy.md': 'b' });
  const gone = join(root, 'Gone.md');
  const busy = join(root, 'Busy.md');
  fs.writeFileSync(gone, 'g2');
  fs.writeFileSync(busy, 'b2');
  const failing = (target, err) => (real) => async (p, ...rest) => { if (p === target) throw err; return real(p, ...rest); };
  assert.equal(await patched('open', failing(gone, code('ENOENT')), () => idx.update(gone)), 'removed');
  assert.equal(await patched('open', failing(busy, code('EBUSY')), () => idx.update(busy)), 'ignored');
  assert.deepEqual(names(idx), ['Busy.md']);
});

test('update(dir): a renamed folder drops the old subtree and indexes the new one', async (t) => {
  const { root, idx } = await indexed(t, { 'Old/One.md': '#a', 'Old/sub/Two.md': '[[One]]', 'Keep.md': 'k' });
  fs.renameSync(join(root, 'Old'), join(root, 'New'));
  assert.equal(await idx.update(join(root, 'Old')), 'removed');
  assert.equal(await idx.update(join(root, 'New')), 'added');
  assert.deepEqual(idx.notes().map((n) => n.path), [join(root, 'Keep.md'), join(root, 'New/One.md'), join(root, 'New/sub/Two.md')]);
  assert.equal(idx.backlinks(join(root, 'New/One.md'))[0].stem, 'Two');
  assert.equal(await idx.update(join(root, 'New')), 'ignored');
});

test('update(dir): a deleted folder removes every note under it, and only those', async (t) => {
  const { root, idx } = await indexed(t, { 'Old/One.md': '', 'Old/sub/Two.md': '', 'Older/Three.md': '', 'Old.md': '' });
  fs.rmSync(join(root, 'Old'), { recursive: true, maxRetries: 5, retryDelay: 50 });
  assert.equal(await idx.update(join(root, 'Old')), 'removed');
  assert.deepEqual(names(idx), ['Old.md', 'Three.md']);
});

test('update(dir): a folder of notes dropped into the vault is indexed; dot entries inside are skipped', async (t) => {
  const { base, root, idx } = await indexed(t, { 'Keep.md': 'k' });
  put(base, { 'Dropped/A.md': 'a', 'Dropped/deep/B.md': 'b', 'Dropped/.hid/C.md': 'c', 'Dropped/n.txt': 'n' });
  fs.renameSync(join(base, 'Dropped'), join(root, 'Dropped'));
  assert.equal(await idx.update(join(root, 'Dropped')), 'added');
  assert.deepEqual(names(idx), ['A.md', 'B.md', 'Keep.md']);
});

test('update(dir): changed content is refreshed and reported; update(root) rescans everything', async (t) => {
  const { root, idx } = await indexed(t, { 'd/A.md': 'a', 'd/B.md': 'b', 'Top.md': 't' });
  fs.writeFileSync(join(root, 'd/A.md'), 'a2 #new');
  assert.equal(await idx.update(join(root, 'd')), 'changed');
  assert.deepEqual(idx.tags().map((x) => x.tag), ['new']);
  fs.unlinkSync(join(root, 'd/B.md'));
  assert.equal(await idx.update(join(root, 'd')), 'removed');
  fs.writeFileSync(join(root, 'Late.md'), 'l');
  fs.unlinkSync(join(root, 'Top.md'));
  assert.equal(await idx.update(root), 'added');
  assert.deepEqual(names(idx), ['A.md', 'Late.md']);
});

test('reset(B) during reset(A) leaves only B', async (t) => {
  const a = setup(t, Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`d${i % 10}/A${i}.md`, 'a'])));
  const b = setup(t, { 'B.md': 'b' });
  const idx = new VaultIndex();
  const first = idx.reset(a.root);
  await idx.reset(b.root);
  await first;
  assert.deepEqual(idx.notes().map((n) => n.name), ['B.md']);
});

test('an older reset that finishes after the newer one commits discards its results', async (t) => {
  const a = setup(t, { 'A.md': 'a' });
  const b = setup(t, { 'B.md': 'b' });
  const idx = new VaultIndex();
  let first;
  await patched('readdir', (real) => async (p, ...rest) => {
    const r = await real(p, ...rest);
    if (p === a.root) await new Promise((res) => setTimeout(res, 80)); // A's scan is slow, B commits meanwhile
    return r;
  }, async () => {
    first = idx.reset(a.root);
    await idx.reset(b.root);
    assert.deepEqual(idx.notes().map((n) => n.name), ['B.md']);
    await first;
  });
  assert.deepEqual(idx.notes().map((n) => n.name), ['B.md']);
});

test('an update already reading when a reset commits does not leak into the new index', async (t) => {
  const a = await indexed(t, { 'A.md': 'a' });
  const b = setup(t, { 'B.md': 'b' });
  const slow = join(a.root, 'New.md');
  fs.writeFileSync(slow, 'n');
  let release;
  const gate = new Promise((res) => { release = res; });
  await patched('open', (real) => async (p, ...rest) => { if (p === slow) await gate; return real(p, ...rest); }, async () => {
    const u = a.idx.update(slow); // stat is done, the read is blocked
    await new Promise((res) => setTimeout(res, 40));
    await a.idx.reset(b.root);
    release();
    await u;
  });
  assert.deepEqual(a.idx.notes().map((n) => n.name), ['B.md']);
});

test('reset twice on the same root does not duplicate', async (t) => {
  const { root, idx } = setup(t, { 'a.md': '', 'b/c.md': '' });
  await Promise.all([idx.reset(root), idx.reset(root)]);
  assert.deepEqual(names(idx), ['a.md', 'c.md']);
});

test('reset drops what the previous root held', async (t) => {
  const a = await indexed(t, { 'A.md': '#x' });
  const b = setup(t, { 'B.md': '' });
  await a.idx.reset(b.root);
  assert.deepEqual(names(a.idx), ['B.md']);
  assert.deepEqual(a.idx.tags(), []);
  assert.equal(await a.idx.update(join(a.root, 'A.md')), 'ignored'); // old root is outside the new one
});

test('update during reset is queued and replayed after the commit, in order', async (t) => {
  const { root, idx } = setup(t, { 'Old.md': 'o' });
  const fresh = join(root, 'Fresh.md');
  const later = join(root, 'Later.md');
  let pending;
  let resetDone = false;
  const done = [];
  // The file appears right after the scan listed the directory, so the scan can never see it.
  await patched('readdir', (real) => async (...a) => {
    const r = await real(...a);
    if (!pending) {
      fs.writeFileSync(fresh, '# Fresh');
      fs.writeFileSync(later, 'later');
      pending = [idx.update(fresh).then((x) => { done.push(['fresh', x, resetDone]); return x; }),
        idx.update(later).then((x) => { done.push(['later', x, resetDone]); return x; })];
    }
    return r;
  }, async () => { await idx.reset(root); resetDone = true; });
  assert.deepEqual(await Promise.all(pending), ['added', 'added']);
  assert.deepEqual(done, [['fresh', 'added', true], ['later', 'added', true]]);
  assert.deepEqual(names(idx), ['Fresh.md', 'Later.md', 'Old.md']);
});

test('update queued during a superseded reset runs against the newest root only', async (t) => {
  const a = setup(t, { 'A.md': 'a' });
  const b = setup(t, { 'B.md': 'b' });
  const idx = new VaultIndex();
  const first = idx.reset(a.root);
  const stray = idx.update(join(a.root, 'A.md'));
  await idx.reset(b.root);
  await first;
  assert.equal(await stray, 'ignored');
  assert.deepEqual(idx.notes().map((n) => n.name), ['B.md']);
});

test('update racing a reset on the same vault never loses the note', async (t) => {
  const { root, idx } = setup(t, { 'a.md': '1' });
  await idx.reset(root);
  fs.writeFileSync(join(root, 'b.md'), '2');
  const u = idx.update(join(root, 'b.md'));
  const r = idx.reset(root);
  await Promise.all([u, r]);
  assert.deepEqual(names(idx), ['a.md', 'b.md']);
});

test('reset reads at most 16 files at once', async (t) => {
  const { root, idx } = setup(t, Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`n${i}.md`, 'x'])));
  let cur = 0;
  let max = 0;
  await patched('open', (real) => async (...a) => {
    cur++; max = Math.max(max, cur);
    try {
      const fh = await real(...a);
      const close = fh.close.bind(fh);
      fh.close = () => { cur--; return close(); };
      return fh;
    } catch (e) { cur--; throw e; }
  }, () => idx.reset(root));
  assert.equal(idx.notes().length, 80);
  assert.ok(max > 1 && max <= 16, `max concurrent reads: ${max}`);
});

test('scale smoke: 2000 small notes index in under 10 s', async (t) => {
  const { root, idx } = setup(t, Object.fromEntries(Array.from({ length: 2000 }, (_, i) =>
    [`d${i % 40}/Note${i}.md`, `# Note ${i}\nlinks to [[Note${(i + 1) % 2000}]] #t${i % 7}\nsome body text`])));
  const t0 = Date.now();
  await idx.reset(root);
  assert.equal(idx.notes().length, 2000);
  assert.equal(idx.graph().edges.length, 2000);
  assert.equal(idx.backlinks(join(root, 'd1/Note1.md')).length, 1);
  assert.ok(Date.now() - t0 < 10000);
});
