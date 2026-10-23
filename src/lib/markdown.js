(function () {
  // Node (unit tests) loads the package; the page loads marked's UMD build first, which sets window.marked.
  const { Marked } = typeof module !== 'undefined' ? require('marked') : window.marked;

  const FRONT_FENCE = /^---\s*$/;
  // A fence line, also inside a blockquote or list item (any indent): tasks between fences are code, not tasks
  const FENCE = /^\s*(?:>\s*)*(`{3,}|~{3,})(.*)/;
  // A task line: optional indent and `>` prefixes, a - * + bullet, [ ], [x] or [X], then text (as marked's listIsTask)
  const TASK = /^(\s*(?:>\s*)*[-*+][ \t]+\[)([ xX])(\] +)(\S.*)/;
  const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
  const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]*$/i;

  const str = (s) => (typeof s === 'string' ? s : '');
  const esc = (s) => str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // Index of the line closing the frontmatter (-1: none), as note-parse reads it
  const frontEnd = (lines) => (FRONT_FENCE.test(lines[0].replace(/^﻿/, '')) ? lines.findIndex((l, i) => i > 0 && FRONT_FENCE.test(l)) : -1);

  // Every task line in source order outside frontmatter and code fences: { line, m } (m = TASK match). Lines may end in \r.
  function scanTasks(lines) {
    const tasks = [];
    const end = frontEnd(lines);
    let fence = null; // opening marker while inside a fenced block
    lines.forEach((line, i) => {
      if (i <= end) return;
      const f = FENCE.exec(line);
      if (fence) {
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null;
        return;
      }
      if (f && !(f[1][0] === '`' && f[2].includes('`'))) { fence = f[1]; return; }
      const m = TASK.exec(line);
      if (m) tasks.push({ line: i, m });
    });
    return tasks;
  }

  // The URL as the browser will read it (it drops C0 controls and spaces), or null when its scheme is not allowed
  function safeUrl(href, image) {
    const url = str(href).trim();
    const scheme = SCHEME.exec(url.replace(/[\x00-\x20]/g, ''));
    if (!scheme) return url; // relative, or #fragment
    if (/^(https?|mailto)$/i.test(scheme[1])) return url;
    return image && DATA_IMAGE.test(url) ? url : null;
  }

  // Per-render state: renderMarkdown is synchronous, so one shared parser instance is safe
  let state = null;

  const wikilink = {
    name: 'wikilink',
    level: 'inline',
    start(src) { const i = src.indexOf('[['); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^\[\[([^\]\n]+)\]\]/.exec(src);
      if (!m) return undefined;
      const [left, ...rest] = m[1].split('|'); // split as note-parse's parseNote does
      const [target, ...heading] = left.split('#');
      if (!target.trim()) return undefined; // [[#H]] (same note) stays text
      return { type: 'wikilink', raw: m[0], target: target.trim(), alias: rest.join('|').trim(), heading: heading.join('#').trim() };
    },
    renderer(t) {
      const cls = state.isResolved(t.target) ? 'wikilink' : 'wikilink unresolved';
      return `<a href="#" class="${cls}" data-note="${esc(t.target)}"${t.heading ? ` data-heading="${esc(t.heading)}"` : ''}>${esc(t.alias || t.target)}</a>`;
    },
  };

  const parser = new Marked({ gfm: true, breaks: true, async: false }, {
    extensions: [wikilink],
    renderer: {
      html({ text }) { return esc(text); }, // raw HTML (block and inline) shows as text
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const url = safeUrl(href, false);
        if (url === null) return text;
        return `<a href="${esc(url)}"${title ? ` title="${esc(title)}"` : ''}>${text}</a>`;
      },
      image({ href, title, text }) {
        const url = safeUrl(href, true);
        if (url === null) return esc(text);
        return `<img src="${esc(url)}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ''}>`;
      },
      // Pair each task item with its source line (by text, in order) so data-task matches toggleTaskByIndex; an item the
      // scan does not know (an ordered-list task, say) gets a disabled checkbox with no index.
      listitem(item) {
        state.pending = null;
        const m = item.task && TASK.exec(item.raw.split('\n')[0]);
        if (m) {
          const k = state.tasks.findIndex((t, j) => j >= state.next && t.m[4].trimEnd() === m[4].trimEnd());
          if (k >= 0) { state.pending = k; state.next = k + 1; }
        }
        return false; // marked's own <li>; its checkbox token renders first, below
      },
      checkbox({ checked }) {
        const n = state.pending;
        state.pending = null;
        const box = n === null ? 'type="checkbox" disabled' : `type="checkbox" data-task="${n}"`;
        return `<input ${box}${checked ? ' checked' : ''}> `;
      },
    },
  });

  // HTML safe for innerHTML: raw HTML escaped, only http(s)/mailto/relative links (and raster data: images), frontmatter hidden
  function renderMarkdown(md, opts = {}) {
    const lines = str(md).split('\n');
    const end = frontEnd(lines);
    state = { tasks: scanTasks(lines), next: 0, pending: null, isResolved: opts.isResolved || (() => false) };
    try {
      return parser.parse(lines.slice(end + 1).join('\n').replace(/^﻿/, ''));
    } finally {
      state = null;
    }
  }

  // Flips [ ] <-> [x] on the n-th task line (numbered as renderMarkdown numbers its checkboxes); unchanged if out of range
  function toggleTaskByIndex(content, n) {
    const lines = str(content).split('\n');
    const task = scanTasks(lines)[n];
    if (!task) return content;
    lines[task.line] = lines[task.line].replace(TASK, (all, a, c, b, rest) => a + (c === ' ' ? 'x' : ' ') + b + rest);
    return lines.join('\n');
  }

  const api = { renderMarkdown, toggleTaskByIndex };
  if (typeof module !== 'undefined') module.exports = api;
  else window.CortexLib = Object.assign(window.CortexLib || {}, api);
})();
