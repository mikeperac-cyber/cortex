const fs = require('fs/promises');
const path = require('path');
const { parseNote, normalizeStem } = require('../src/lib/note-parse.js');

const POOL = 16; // concurrent file reads
const MD = /\.md$/i;
const FRONT_FENCE = /^---\s*$/;
const W_TITLE = 1000, W_HEAD = 100, W_BODY = 1; // per matched term: stem/title > heading > body
const SNIPPET = 118; // + up to two ellipses, ~120 chars

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const splitLines = (s) => s.replace(/^﻿/, '').split(/\r?\n/); // same split as parseNote, so link.line indexes it
const within = (k, dir) => k === dir || k.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

async function readNote(abs) {
  const fh = await fs.open(abs, 'r'); // a directory fails here (EISDIR/EPERM), so it is never read as a note
  try {
    return { mtimeMs: (await fh.stat()).mtimeMs, content: await fh.readFile('utf8') };
  } finally {
    await fh.close();
  }
}

// Every non-dot .md file under dir; stops early once alive() turns false. A directory named x.md is descended into.
async function listMd(dir, alive = () => true, out = []) {
  let items;
  try { items = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const it of items) {
    if (!alive()) break;
    if (it.name[0] === '.') continue;
    const abs = path.join(dir, it.name);
    if (it.isDirectory()) await listMd(abs, alive, out);
    else if (MD.test(it.name)) out.push(abs);
  }
  return out;
}

async function pool(items, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(POOL, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

function makeEntry(abs, mtimeMs, content) {
  const parsed = parseNote(content);
  const lines = splitLines(content);
  const fmEnd = FRONT_FENCE.test(lines[0]) ? lines.findIndex((l, i) => i > 0 && FRONT_FENCE.test(l)) : -1;
  const bodyStart = fmEnd > 0 ? fmEnd + 1 : 0;
  const body = lines.slice(bodyStart).join('\n');
  const name = path.basename(abs);
  const stem = name.slice(0, -3);
  return {
    key: abs.toLowerCase(),
    content,
    bodyStart,
    norm: { stem: normalizeStem(stem), title: normalizeStem(parsed.title), heads: normalizeStem(parsed.headings.map((h) => h.text).join('\n')), body: normalizeStem(body) },
    meta: { path: abs, name, stem, mtimeMs, title: parsed.title, tags: parsed.tags, links: parsed.links, words: (body.match(/\S+/g) || []).length },
  };
}

// shortcut: whole vault kept in memory (content + normalised body per note), upgrade to an on-disk index if vaults exceed ~100 MB
class VaultIndex {
  constructor() {
    this._store = new Map(); // lowercased absolute path -> entry
    this._rootKey = null;
    this._gen = 0; // bumped by every reset; only the newest one may commit
    this._pending = null; // the newest reset while it is in flight
    this._tail = Promise.resolve(); // updates run one at a time, in call order
    this._v = null; // derived lookups, rebuilt lazily after any change
  }

  async reset(root) {
    const gen = ++this._gen;
    const alive = () => gen === this._gen;
    const job = (async () => {
      try {
        const base = typeof root === 'string' && root ? path.resolve(root) : null;
        const staged = new Map();
        await pool(base ? await listMd(base, alive) : [], async (abs) => {
          if (!alive()) return;
          try {
            const { mtimeMs, content } = await readNote(abs);
            staged.set(abs.toLowerCase(), makeEntry(abs, mtimeMs, content));
          } catch { /* unreadable: skipped */ }
        });
        if (!alive()) return; // a newer reset owns the index now
        this._store = staged;
        this._rootKey = base && base.toLowerCase();
        this._v = null;
      } finally {
        if (alive()) this._pending = null;
      }
    })();
    this._pending = job;
    await job;
  }

  // Resolves with what changed. Calls made during a reset wait for its commit and then run in call order.
  update(absPath) {
    const run = async () => {
      try {
        while (this._pending) await this._pending.catch(() => {});
        return await this._apply(absPath);
      } catch {
        return 'ignored';
      }
    };
    return (this._tail = this._tail.then(run));
  }

  async _apply(p) {
    const store = this._store; // a reset that commits mid-flight swaps the store; this call then edits the discarded one
    const root = this._rootKey;
    if (typeof p !== 'string' || !p || root === null) return 'ignored';
    const abs = path.resolve(p);
    const key = abs.toLowerCase();
    const rel = path.relative(root, key);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) || rel.split(path.sep).some((s) => s[0] === '.')) return 'ignored';

    let st = null;
    try { st = await fs.stat(abs); } catch (err) { if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') return 'ignored'; }
    if (!st) return this._drop(store, key);
    if (st.isDirectory()) return this._rescan(store, abs, key);
    if (!MD.test(abs)) return 'ignored';
    try {
      return (await this._load(store, abs, key)) || 'ignored';
    } catch (err) {
      return err.code === 'ENOENT' ? this._drop(store, key) : 'ignored'; // vanished mid-read: gone; locked or unreadable: keep what we have
    }
  }

  // Reads abs into store; 'added' | 'changed', or null when nothing differs. Throws if unreadable.
  async _load(store, abs, key) {
    const { mtimeMs, content } = await readNote(abs);
    const prev = store.get(key);
    if (prev && prev.meta.mtimeMs === mtimeMs && prev.content === content && prev.meta.path === abs) return null;
    store.set(key, makeEntry(abs, mtimeMs, content));
    this._v = null;
    return prev ? 'changed' : 'added';
  }

  _drop(store, key) {
    let n = 0;
    for (const k of store.keys()) if (within(k, key)) { store.delete(k); n++; }
    if (n) this._v = null;
    return n ? 'removed' : 'ignored';
  }

  async _rescan(store, abs, key) {
    const seen = new Set();
    let added = 0, changed = 0, removed = 0;
    await pool(await listMd(abs), async (f) => {
      const k = f.toLowerCase();
      try {
        const r = await this._load(store, f, k);
        seen.add(k);
        if (r === 'added') added++; else if (r) changed++;
      } catch (err) {
        if (err.code !== 'ENOENT') seen.add(k); // unreadable now is not the same as gone
      }
    });
    for (const k of store.keys()) if (within(k, key) && !seen.has(k)) { store.delete(k); removed++; }
    if (removed) this._v = null;
    return added ? 'added' : changed ? 'changed' : removed ? 'removed' : 'ignored';
  }

  // Sorted entries, best note per stem, and the link graph; one pass, cached until the next change.
  _view() {
    if (this._v) return this._v;
    const sorted = [...this._store.values()].sort((a, b) => cmp(a.key, b.key));
    const depth = (e) => e.key.split(path.sep).length;
    const byStem = new Map();
    for (const e of sorted) { // sorted by path, so on a full tie the first stays
      const cur = byStem.get(e.norm.stem);
      if (!cur || depth(e) < depth(cur) || (depth(e) === depth(cur) && e.meta.path.length < cur.meta.path.length)) byStem.set(e.norm.stem, e);
    }
    const incoming = new Map(); // target entry -> [{ src, line }]
    const edges = [];
    for (const e of sorted) {
      const targets = new Set();
      for (const l of e.meta.links) {
        const t = byStem.get(normalizeStem(l.target));
        if (!t || t === e) continue;
        if (!targets.has(t)) { targets.add(t); edges.push({ source: e.meta.path, target: t.meta.path }); }
        const list = incoming.get(t) || incoming.set(t, []).get(t);
        const last = list[list.length - 1];
        if (!last || last.src !== e || last.line !== l.line) list.push({ src: e, line: l.line });
      }
    }
    return (this._v = { sorted, byStem, incoming, edges });
  }

  notes() {
    return this._view().sorted.map((e) => e.meta);
  }

  resolve(target) {
    const e = this._view().byStem.get(normalizeStem(target));
    return e ? e.meta : null;
  }

  backlinks(absPath) {
    if (typeof absPath !== 'string' || !absPath) return [];
    const e = this._store.get(path.resolve(absPath).toLowerCase());
    if (!e) return [];
    const lines = new Map();
    const textOf = (src, line) => {
      if (!lines.has(src)) lines.set(src, splitLines(src.content));
      return (lines.get(src)[line] || '').replace(/\r$/, '');
    };
    return [...(this._view().incoming.get(e) || [])]
      .sort((a, b) => cmp(a.src.norm.stem, b.src.norm.stem) || cmp(a.src.key, b.src.key) || a.line - b.line)
      .map(({ src, line }) => ({ path: src.meta.path, stem: src.meta.stem, line, text: textOf(src, line) }));
  }

  tags() {
    const groups = new Map();
    for (const e of this._view().sorted) {
      for (const t of e.meta.tags) {
        const k = normalizeStem(t);
        const g = groups.get(k) || groups.set(k, { tag: t, count: 0, paths: [] }).get(k);
        g.count++;
        g.paths.push(e.meta.path);
      }
    }
    return [...groups.values()].sort((a, b) => b.count - a.count || cmp(normalizeStem(a.tag), normalizeStem(b.tag)) || cmp(a.tag, b.tag));
  }

  graph() {
    const v = this._view();
    return { nodes: v.sorted.map((e) => ({ id: e.meta.path, label: e.meta.stem })), edges: v.edges.map((x) => ({ ...x })) };
  }

  search(query, limit = 50) {
    const terms = (typeof query === 'string' ? query : '').split(/\s+/).map(normalizeStem).filter(Boolean);
    if (!terms.length) return [];
    const hits = [];
    for (const e of this._store.values()) {
      const n = e.norm;
      let score = 0;
      for (const t of terms) {
        const w = n.stem.includes(t) || n.title.includes(t) ? W_TITLE : n.heads.includes(t) ? W_HEAD : n.body.includes(t) ? W_BODY : 0;
        if (!w) { score = 0; break; }
        score += w;
      }
      if (score) hits.push({ e, score });
    }
    hits.sort((a, b) => b.score - a.score || cmp(a.e.norm.stem, b.e.norm.stem) || cmp(a.e.key, b.e.key));
    return hits.slice(0, limit).map(({ e, score }) => ({ path: e.meta.path, stem: e.meta.stem, snippet: snippetOf(e, terms[0]), score }));
  }
}

// One line of ~120 chars around the first body hit of term; the stem when the term only matched the file name.
function snippetOf(e, term) {
  const body = e.norm.body;
  const i = body.indexOf(term);
  if (i < 0) return e.meta.stem;
  let k = 0;
  for (let p = body.indexOf('\n'); p !== -1 && p < i; p = body.indexOf('\n', p + 1)) k++;
  const from = body.lastIndexOf('\n', i) + 1;
  const to = body.indexOf('\n', i);
  const normLine = body.slice(from, to < 0 ? undefined : to);
  const orig = (splitLines(e.content)[e.bodyStart + k] || '').replace(/\r$/, '');
  const line = orig.length === normLine.length ? orig : normLine; // case/Unicode folding can shift offsets: then show the folded line
  const j = i - from;
  const start = Math.max(0, j - 40);
  const end = Math.min(line.length, Math.max(start + SNIPPET, j + term.length));
  return (start > 0 ? '…' : '') + line.slice(start, end).replace(/\s+/g, ' ').trim() + (end < line.length ? '…' : '');
}

module.exports = { VaultIndex };
