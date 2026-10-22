(function () {
  const { pathKey } = typeof module !== 'undefined' ? require('./names.js') : window.CortexLib;
  const PANELS = ['fileExplorer', 'search', 'graph', 'backlinks', 'tags', 'starred', 'outline'];
  const LAYOUTS = ['split', 'editor', 'preview'];

  // A vault's stored workspace (JSON text or a parsed value) in a shape restore can trust; anything else is the empty one.
  // Never throws: the value comes from localStorage, which anything may have written.
  function sanitizeWorkspace(raw) {
    let w = raw;
    if (typeof w === 'string') { try { w = JSON.parse(w); } catch { w = null; } }
    if (!w || typeof w !== 'object' || Array.isArray(w)) w = {};
    const tabs = [];
    const keys = new Set();
    for (const p of Array.isArray(w.tabs) ? w.tabs : []) {
      if (tabs.length === 20) break;
      if (typeof p !== 'string' || keys.has(pathKey(p))) continue;
      keys.add(pathKey(p));
      tabs.push(p);
    }
    const active = typeof w.active === 'string' ? tabs.find((t) => pathKey(t) === pathKey(w.active)) : undefined;
    return {
      tabs,
      active: active ?? tabs[tabs.length - 1] ?? null,
      panel: PANELS.includes(w.panel) ? w.panel : null,
      layout: LAYOUTS.includes(w.layout) ? w.layout : 'split',
    };
  }

  const api = { sanitizeWorkspace };
  if (typeof module !== 'undefined') module.exports = api;
  else window.CortexLib = Object.assign(window.CortexLib || {}, api);
})();
