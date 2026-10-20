(function () {
  const ILLEGAL = /[\\:*?"<>|\x00-\x1f]/;
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i; // Windows device names, with or without an extension

  // Validates a user-typed note/folder name (forward slashes mean subfolders) and appends `ext` ('.md' for notes, '' for folders and renames).
  function normalizeName(input, ext = '') {
    const bad = (error) => ({ ok: false, error });
    const raw = typeof input === 'string' ? input.trim() : '';
    if (!raw) return bad('Name cannot be empty');
    if (ILLEGAL.test(raw)) return bad('Names cannot contain \\ : * ? " < > |');
    for (const segment of raw.split('/')) {
      if (!segment) return bad('Names cannot start or end with "/" or contain "//"');
      if (segment.startsWith('.')) return bad('Names cannot start with a dot');
      if (/[. ]$/.test(segment)) return bad('Names cannot end with a dot or a space');
      if (RESERVED.test(segment.split('.')[0])) return bad('"' + segment + '" is a reserved name');
    }
    return { ok: true, name: raw.toLowerCase().endsWith(ext.toLowerCase()) ? raw : raw + ext };
  }

  // The spelling-insensitive identity of a path, as NTFS compares names: each code point takes its one-letter capital, and keeps
  // itself when there is none (ß -> "SS" is two letters), so Welcome.md == welcome.md while straße.md != STRASSE.md.
  const pathKey = (p) => Array.from(p, (ch) => { const up = ch.toUpperCase(); return Array.from(up).length === 1 ? up : ch; }).join('');

  const api = { normalizeName, pathKey };
  if (typeof module !== 'undefined') module.exports = api;
  else window.CortexLib = Object.assign(window.CortexLib || {}, api);
})();
