(function () {
  const FRONT_FENCE = /^---\s*$/;
  const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
  const INLINE_CODE = /(?<!`)(`+)(?!`)[^]*?(?<!`)\1(?!`)/g;
  const HEADING = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
  const LINK = /!?\[\[([^\]\n]+)\]\]/g;
  const TAG = /(?:^|\s)#([\p{L}\p{M}\p{N}_\-\/]+)/gu; // \p{M}: a decomposed (NFD) letter keeps its combining marks
  const FM_KEY = /^([\p{L}\p{N}_\-]+):\s*(.*?)\s*$/u;
  // Not prose: wikilinks and embeds (any [[ up to its first ], so an unclosed one hides the rest of the line), whole [text](target)
  // links, bare URLs, tags (as TAG). Each alternative stops at a fixed character, so a failed try never rescans the line.
  const NOT_PROSE = /!?\[\[[^\]\n]*\]{0,2}|\[[^[\]\n]*\]\([^)\n]*\)?|https?:\/\/\S+|(?<!\S)#[\p{L}\p{M}\p{N}_\-\/]+/gu;
  const WORD = /[\p{L}\p{M}\p{N}_]/u;
  const NO_LEAD = /[\p{L}\p{M}\p{N}_[!]/u; // what a mention may not follow: a word, [ (it would read [[[stem]]]) or ! (an embed)
  const MAX_LINE = 10000; // longer lines are never searched for mentions

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

  // BOM, lines without their breaks (as maskCode needs), and the breaks: `bom + parts.join('')` is the content again
  function splitKeep(content) {
    const src = str(content);
    const bom = src[0] === '﻿' ? '﻿' : '';
    const parts = src.slice(bom.length).split(/(\r?\n)/); // even: lines, odd: their line breaks
    return { src, bom, parts, lines: parts.filter((_, i) => i % 2 === 0) };
  }

  // The lines as parseNote reads them: frontmatter emptied, code blanked, count and lengths kept
  function maskBody(lines) {
    const end = frontEnd(lines);
    return maskCode(lines.map((l, i) => (i <= end ? '' : l)));
  }

  // Points every link whose target is oldStem at newStem, keeping alias, heading, embed and everything else byte for byte.
  // Links are found exactly as parseNote finds them (masked code and frontmatter skipped); the text replaced is the original's.
  function rewriteLinks(content, oldStem, newStem) {
    const { src, bom, parts, lines } = splitKeep(content);
    const masked = maskBody(lines);
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

  // Whole-word occurrences of stem in the prose of lines, ignoring case and Unicode form. Frontmatter, code and NOT_PROSE spans
  // are skipped; they are blanked to same-length filler, so a column is one of the original line.
  // shortcut: same-length slice compare, upgrade if Unicode folding changes length
  function mentionsIn(lines, stem) {
    const word = str(stem).normalize('NFC').trim();
    const key = word.toLowerCase(); // normalizeStem(stem)
    const found = [];
    if (word.length < 3) return found;
    maskBody(lines).forEach((text, line) => {
      if (text.length > MAX_LINE || !text.normalize('NFC').toLowerCase().includes(key)) return; // most lines stop here
      const prose = text.replace(NOT_PROSE, blank);
      for (let col = 0; col + word.length <= prose.length; col++) {
        if (NO_LEAD.test(prose[col - 1] || '') || WORD.test(prose[col + word.length] || '')) continue;
        if (prose.slice(col, col + word.length).normalize('NFC').toLowerCase() !== key) continue;
        found.push({ line, col });
        col += word.length - 1; // the next one starts after this one
      }
    });
    return found;
  }

  // 0-based { line, col } of every plain-text mention of stem; frontmatter lines count, a BOM and \r do not.
  function findMentions(content, stem) {
    return mentionsIn(splitKeep(content).lines, stem);
  }

  // The content with the mention at m turned into [[stem]] ([[stem|text]] when its spelling differs); null unless m is still
  // a mention there. Line breaks and BOM stay as they were.
  function linkMention(content, m, stem) {
    const { bom, parts, lines } = splitKeep(content);
    const { line, col } = m || {};
    if (!mentionsIn(lines, stem).some((x) => x.line === line && x.col === col)) return null;
    const word = str(stem).normalize('NFC').trim();
    const text = lines[line].slice(col, col + word.length);
    parts[2 * line] = lines[line].slice(0, col) + '[[' + (text === stem ? stem : stem + '|' + text) + ']]' + lines[line].slice(col + word.length);
    return bom + parts.join('');
  }

  const api = { normalizeStem, parseNote, rewriteLinks, findMentions, linkMention };
  if (typeof module !== 'undefined') module.exports = api;
  else window.CortexLib = Object.assign(window.CortexLib || {}, api);
})();
