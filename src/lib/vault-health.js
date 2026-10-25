// Vault health for the Vault Doctor plugin: what makes a second brain harder to use, computed from the index's NoteMeta list.
(function () {
  const { normalizeStem } = typeof module !== 'undefined' ? require('./note-parse.js') : window.CortexLib;

  const STUB_WORDS = 10;
  const EXEMPT = /(?:^|[\\/])(?:Daily Notes|Templates)[\\/]/i; // dated and template notes are not expected to be linked or long
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  // notes: NoteMeta[] ({ path, stem, links: [{ target, line }], words, tags }). Links resolve by stem, as in the index.
  // Returns { total, score, broken: [{ target, sources: [{ path, stem, line }] }], orphans, stubs, duplicates: [{ stem, paths }] }.
  // score: the percentage of notes with none of these issues.
  function analyzeVault(notes) {
    const byKey = new Map();
    for (const n of notes) {
      const k = normalizeStem(n.stem);
      (byKey.get(k) || byKey.set(k, []).get(k)).push(n);
    }
    const linked = new Set(); // paths with a resolved link in or out
    const brokenBy = new Map(); // normalized target -> { target, sources }
    const flagged = new Set();
    for (const n of notes) {
      const self = normalizeStem(n.stem);
      for (const l of n.links || []) {
        const k = normalizeStem(l.target);
        const hits = byKey.get(k);
        if (!hits) {
          const b = brokenBy.get(k) || brokenBy.set(k, { target: l.target.trim(), sources: [] }).get(k);
          b.sources.push({ path: n.path, stem: n.stem, line: l.line });
          flagged.add(n.path);
        } else if (k !== self) {
          linked.add(n.path);
          for (const h of hits) linked.add(h.path);
        }
      }
    }
    const byStem = (a, b) => cmp(normalizeStem(a.stem), normalizeStem(b.stem)) || cmp(a.path, b.path);
    const exempt = (n) => EXEMPT.test(n.path);
    const orphans = notes.filter((n) => !exempt(n) && !linked.has(n.path)).sort(byStem);
    const stubs = notes.filter((n) => !exempt(n) && (n.words || 0) < STUB_WORDS).sort(byStem);
    const duplicates = [...byKey.values()].filter((g) => g.length > 1)
      .map((g) => ({ stem: g[0].stem, paths: g.map((n) => n.path).sort() }))
      .sort((a, b) => cmp(normalizeStem(a.stem), normalizeStem(b.stem)));
    for (const n of [...orphans, ...stubs]) flagged.add(n.path);
    for (const d of duplicates) d.paths.forEach((p) => flagged.add(p));
    const broken = [...brokenBy.values()].sort((a, b) => b.sources.length - a.sources.length || cmp(normalizeStem(a.target), normalizeStem(b.target)));
    const total = notes.length;
    return { total, score: total ? Math.round((100 * (total - flagged.size)) / total) : 100, broken, orphans, stubs, duplicates };
  }

  const api = { analyzeVault };
  if (typeof module !== 'undefined') module.exports = api;
  else window.CortexLib = Object.assign(window.CortexLib || {}, api);
})();
