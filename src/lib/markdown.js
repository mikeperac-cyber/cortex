(function () {
  // Node (unit tests) loads the package; the page loads marked's UMD build first, which sets window.marked.
  const { Marked } = typeof module !== 'undefined' ? require('marked') : window.marked;

  const FRONT_FENCE = /^---\s*$/;
  // A task line: optional indent and `>` prefixes, a - * + bullet, [ ], [x] or [X], then text (as marked's listIsTask)
  const TASK = /^(\s*(?:>\s*)*[-*+][ \t]+\[)([ xX])(\] +)(\S.*)/;
  const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
  const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]*$/i;

  const str = (s) => (typeof s === 'string' ? s : '');
  const esc = (s) => str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const newlines = (s) => str(s).split('\n').length - 1;

  // Index of the line closing the frontmatter (-1: none), as note-parse reads it
  const frontEnd = (lines) => (FRONT_FENCE.test(lines[0].replace(/^\uFEFF/, '')) ? lines.findIndex((l, i) => i > 0 && FRONT_FENCE.test(l)) : -1);

  // Walks marked's block tokens keeping the source line each starts on (a token's raw holds its newlines; blockquote and list
  // item children keep their parent's line structure). Each task item marked will render as a checkbox gets item.cortexTask = N
  // and tasks[N] = its 0-based line in `lines`, but only if that line really is this task (same text): otherwise it gets no
  // index, so a click can never flip some other line.
  function numberTasks(tokens, line, lines, tasks) {
    for (const t of tokens) {
      if (t.type === 'list') {
        let l = line;
        for (const item of t.items) {
          const want = item.task && TASK.exec(item.raw.split('\n')[0]);
          const got = want && TASK.exec(lines[l] || '');
          if (got && got[4].trimEnd() === want[4].trimEnd()) { item.cortexTask = tasks.length; tasks.push(l); }
          numberTasks(item.tokens, l, lines, tasks);
          l += newlines(item.raw);
        }
      } else if (t.type === 'blockquote') {
        numberTasks(t.tokens, line, lines, tasks);
      }
      line += newlines(t.raw);
    }
  }

  // The source split in lines, marked's tokens for the body (frontmatter cut off), and the task lines in render order
  function lex(md) {
    const lines = str(md).split('\n');
    const end = frontEnd(lines);
    const tokens = parser.lexer(lines.slice(end + 1).join('\n').replace(/^\uFEFF/, ''));
    const tasks = [];
    numberTasks(tokens, end + 1, lines, tasks);
    return { lines, tokens, tasks };
  }

  // The URL as the browser will read it, or null when it is not allowed. The browser drops C0 controls and spaces and reads
  // \ as /; a URL starting with // (or \\) is protocol-relative, which against the page's file:// base is a UNC path: rendering
  // it would open an SMB connection.
  function safeUrl(href, image) {
    const url = str(href).trim();
    const bare = url.replace(/[\x00-\x20]/g, '').replace(/\\/g, '/');
    if (bare.startsWith('//')) return null;
    const scheme = SCHEME.exec(bare);
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
      // numberTasks gave each task item whose source line it confirmed an index; any other task item (an ordered-list task,
      // say) gets a disabled checkbox with no index
      listitem(item) {
        state.pending = item.cortexTask ?? null;
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
    const { tokens } = lex(md);
    state = { pending: null, isResolved: opts.isResolved || (() => false) };
    try {
      return parser.parser(tokens);
    } finally {
      state = null;
    }
  }

  // Flips [ ] <-> [x] on the line renderMarkdown rendered as checkbox data-task="n"; unchanged if there is none
  function toggleTaskByIndex(content, n) {
    const { lines, tasks } = lex(content);
    const line = tasks[n];
    if (line === undefined) return content;
    lines[line] = lines[line].replace(TASK, (all, a, c, b, rest) => a + (c === ' ' ? 'x' : ' ') + b + rest);
    return lines.join('\n');
  }

  const api = { renderMarkdown, toggleTaskByIndex };
  if (typeof module !== 'undefined') module.exports = api;
  else window.CortexLib = Object.assign(window.CortexLib || {}, api);
})();
