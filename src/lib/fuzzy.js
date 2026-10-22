(function () {
  const BREAKS = ' -_/.';
  // Per matched character: a base, a bonus after a word break (or at the start), a bigger one for following the previous match, so a
  // contiguous run beats the same letters scattered over word starts, and a word start beats mid-word. All even: the length
  // tie-break below (< 1) can never reorder two different raw scores.
  const BASE = 10, WORD_START = 6, ADJACENT = 8;

  // Case, Unicode form, diacritics and the Turkish dotless i all fold away: "calisma" finds "Çalışma", "istanbul" finds "İstanbul".
  const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ı/g, 'i');

  // 0 unless `query` is a subsequence of `text`; else the score of the best alignment (spaces in the query are ignored, so "proj plan"
  // finds "Project Plan"). An empty query matches everything. shortcut: one O(query x text) pass per note, fine for thousands of notes.
  function fuzzyScore(query, text) {
    const q = [...fold(query).replace(/\s+/g, '')];
    if (!q.length) return 1;
    const t = [...fold(text)];
    if (q.length > t.length) return 0;
    let prev = null; // prev[j]: best score with the previous query character matched at text[j] (-Infinity: it cannot be)
    for (const ch of q) {
      const cur = t.map(() => -Infinity);
      let earlier = -Infinity; // best prev[k] for k < j - 1: a match that does not touch text[j]
      for (let j = 0; j < t.length; j++) {
        if (prev && j >= 2) earlier = Math.max(earlier, prev[j - 2]);
        if (t[j] !== ch) continue;
        const from = !prev ? 0 : Math.max(earlier, j ? prev[j - 1] + ADJACENT : -Infinity);
        cur[j] = from + BASE + (j === 0 || BREAKS.includes(t[j - 1]) ? WORD_START : 0);
      }
      prev = cur;
    }
    const best = Math.max(...prev);
    return best === -Infinity ? 0 : best + 1 / (1 + t.length);
  }

  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  // notes: { path, stem, rel, key }[] (rel: vault-relative "/" path; key: the caller's identity key). recent: keys, newest first.
  // Empty query: the recent notes in order, then the rest A-Z. Otherwise the matches, best first (a stem hit counts double a path hit).
  function rankNotes(query, notes, recent, limit = 20) {
    const age = new Map();
    recent.forEach((key, i) => { if (!age.has(key)) age.set(key, i); });
    const items = notes.map((note) => ({ note, name: fold(note.stem), age: age.has(note.key) ? age.get(note.key) : Infinity, score: 1 }));
    const order = (a, b) => cmp(a.age, b.age) || cmp(a.name, b.name) || cmp(a.note.rel, b.note.rel); // recent first, then A-Z
    if (query.trim()) {
      items.forEach((it) => { it.score = Math.max(2 * fuzzyScore(query, it.note.stem), fuzzyScore(query, it.note.rel)); });
      items.sort((a, b) => b.score - a.score || order(a, b));
    } else items.sort(order);
    return items.filter((it) => it.score > 0).slice(0, limit).map((it) => it.note);
  }

  const api = { fuzzyScore, rankNotes };
  if (typeof module !== 'undefined') module.exports = api;
  else window.CortexLib = Object.assign(window.CortexLib || {}, api);
})();
