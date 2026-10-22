(function () {
  const FRONT_FENCE = /^---\s*$/;
  const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
  const INLINE_CODE = /(?<!`)(`+)(?!`)[^]*?(?<!`)\1(?!`)/g;
  const HEADING = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
  const LINK = /!?\[\[([^\]\n]+)\]\]/g;
  const TAG = /(?:^|\s)#([\p{L}\p{M}\p{N}_\-\/]+)/gu; // \p{M}: a decomposed (NFD) letter keeps its combining marks
  const FM_KEY = /^([\p{L}\p{N}_\-]+):\s*(.*?)\s*$/u;

  const str = (s) => (typeof s === 'string' ? s : '');
  const normalizeStem = (s) => str(s).normalize('NFC').toLowerCase().trim();

  // Non-whitespace filler: `x`#y must not become a tag. Same length keeps offsets valid for link rewriting.
  const blank = (s) => '\0'.repeat(s.length);

  // Blanks fenced (``` / ~~~) and inline code, keeping line count and line lengths. shortcut: inline spans are per line, upgrade if multi-line spans matter.
  function maskCode(lines) {
    let fence = null; // opening marker while inside a fenced block
    return lines.map((line) => {
      const f = FENCE.exec(line);
      if (fence) {
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null;
        return blank(line);
      }
      if (f && !(f[1][0] === '`' && f[2].includes('`'))) { fence = f[1]; return blank(line); }
      return line.replace(INLINE_CODE, blank);
    });
  }

  const unquote = (v) => v.replace(/^(["'])(.*)\1$/, '$2');

  // Minimal YAML subset: `key: scalar`, `key: [a, b]`, and `key:` followed by `- item` lines.
  function parseFrontmatter(lines) {
    const fm = {};
    let list = null; // the array a following `- item` line appends to
    for (const line of lines) {
      const item = /^\s*-\s+(.*?)\s*$/.exec(line);
      if (item && list) { list.push(unquote(item[1])); continue; }
      const m = FM_KEY.exec(line);
      list = null;
      if (!m || m[1] === '__proto__') continue;
      const v = m[2];
      if (v === '') fm[m[1]] = list = [];
      else if (v[0] === '[' && v.endsWith(']')) fm[m[1]] = v.slice(1, -1).split(',').map((x) => unquote(x.trim())).filter(Boolean);
      else fm[m[1]] = unquote(v);
    }
    for (const k in fm) if (Array.isArray(fm[k]) && !fm[k].length) fm[k] = ''; // `key:` with no items is just empty
    return fm;
  }

  // Index of the line closing the frontmatter (-1: none, so it is all body)
  const frontEnd = (lines) => (FRONT_FENCE.test(lines[0]) ? lines.findIndex((l, i) => i > 0 && FRONT_FENCE.test(l)) : -1);

  function parseNote(content) {
    const lines = str(content).replace(/^﻿/, '').split(/\r?\n/);
    const end = frontEnd(lines);
    const frontmatter = end > 0 ? parseFrontmatter(lines.slice(1, end)) : {};
    const body = lines.map((l, i) => (i <= end ? '' : l)); // frontmatter lines stay as empty slots so `line` is the original index
    const masked = maskCode(body);

    const tags = [];
    const seen = new Set();
    const addTag = (t) => { const k = normalizeStem(t); if (k && !seen.has(k)) { seen.add(k); tags.push(t); } };
    for (const t of [].concat(frontmatter.tags || [])) for (const x of t.split(/[,\s]+/)) addTag(x.replace(/^#/, ''));

    const headings = [];
    const links = [];
    masked.forEach((text, line) => {
      const h = HEADING.test(text) && HEADING.exec(body[line]); // detect on masked (fenced = no heading), read text from the original
      if (h) headings.push({ level: h[1].length, text: h[2], line });
      for (const m of text.matchAll(TAG)) if (!/^\p{N}+$/u.test(m[1])) addTag(m[1]);
      for (const m of text.matchAll(LINK)) {
        const [left, ...rest] = m[1].split('|');
        const [target, ...heading] = left.split('#');
        if (!target.trim()) continue; // [[#H]] points at the same note
        links.push({ target: target.trim(), alias: rest.join('|').trim() || null, heading: heading.join('#').trim() || null, line });
      }
    });

    const title = (headings.find((h) => h.level === 1) || {}).text || '';
    return { frontmatter, title, headings, tags, links };
  }

  // Points every link whose target is oldStem at newStem, keeping alias, heading, embed and everything else byte for byte.
  // Links are found exactly as parseNote finds them (masked code and frontmatter skipped); the text replaced is the original's.
  function rewriteLinks(content, oldStem, newStem) {
    const src = str(content);
    const bom = src[0] === '﻿' ? '﻿' : '';
    const parts = src.slice(bom.length).split(/(\r?\n)/); // even: lines (no \r, as maskCode needs), odd: their line breaks
    const lines = parts.filter((_, i) => i % 2 === 0);
    const end = frontEnd(lines);
    const masked = maskCode(lines.map((l, i) => (i <= end ? '' : l)));
    const key = normalizeStem(oldStem);
    let changed = false;
    lines.forEach((line, k) => {
      let out = '';
      let from = 0;
      for (const m of masked[k].matchAll(LINK)) {
        const inner = m[1];
        const cut = inner.search(/[|#]/); // the target ends at the alias or heading, as in parseNote
        const target = cut < 0 ? inner : inner.slice(0, cut);
        if (!target.trim() || normalizeStem(target) !== key) continue;
        const start = m.index + m[0].length - 2 - inner.length + (target.length - target.trimStart().length);
        out += line.slice(from, start) + newStem;
        from = start + target.trim().length;
      }
      if (from) { parts[2 * k] = out + line.slice(from); changed = true; }
    });
    return changed ? bom + parts.join('') : src;
  }

  const api = { normalizeStem, parseNote, rewriteLinks };
  if (typeof module !== 'undefined') module.exports = api;
  else window.CortexLib = Object.assign(window.CortexLib || {}, api);
})();
