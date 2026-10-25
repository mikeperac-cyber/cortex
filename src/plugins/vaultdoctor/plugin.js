// ============================================
// CORTEX Plugin: Vault Doctor — find and fix what makes a vault harder to use
// ============================================
// Broken links, orphan notes, stubs and ambiguous duplicate names, from the live index, each with a one-click fix.

class VaultDoctorPlugin {
  name = 'vaultdoctor';
  app = null;
  panelEl = null;
  static LIST_MAX = 50; // rows shown per section; the count says how many there are

  async init() {}

  open() { this.renderPanel(); }

  close() { this.panelEl?.remove(); this.panelEl = null; }

  // The index changed (a fix landed, or an outside edit): refresh the report in place
  onIndexUpdated() { if (this.panelEl) this.renderReport(); }

  renderPanel() {
    this.close();
    const panel = document.createElement('div');
    panel.className = 'plugin-panel visible';
    panel.id = 'plugin-vaultdoctor';
    panel.innerHTML = `
      <div class="plugin-panel-header">
        <span class="plugin-panel-title">Vault Doctor — Optimize Your Vault</span>
        <div style="display:flex;gap:8px;">
          <button class="icon-btn" id="vdRescan" title="Rescan"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12 7C12 9.76 9.76 12 7 12C4.24 12 2 9.76 2 7C2 4.24 4.24 2 7 2C8.66 2 10.16 2.77 11.09 4.04" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></button>
          <button class="icon-btn" id="vdClose" title="Close"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" stroke-width="1.5"/></svg></button>
        </div>
      </div>
      <div class="plugin-panel-body"><div class="syn-wrap" id="vdReport"></div></div>
    `;
    document.getElementById('plugin-root').appendChild(panel);
    this.panelEl = panel;
    panel.querySelector('#vdClose').addEventListener('click', () => this.close());
    panel.querySelector('#vdRescan').addEventListener('click', async () => { await this.app.refreshIndex(); this.renderReport(); });
    this.renderReport();
  }

  el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  button(label, fn, primary) {
    const b = this.el('button', 'syn-btn' + (primary ? ' syn-btn-primary' : ''), label);
    b.addEventListener('click', fn);
    return b;
  }

  rel(p) {
    const root = this.app.normPath(this.app.vaultPath) + '/';
    const n = this.app.normPath(p);
    return n.startsWith(root) ? n.slice(root.length) : n;
  }

  section(title, hint, rows, makeRow) {
    const card = this.el('section', 'syn-card');
    const h = this.el('h3', 'syn-h', title + ' ');
    h.append(this.el('span', rows.length ? 'vd-count vd-bad' : 'vd-count', String(rows.length)));
    card.append(h, this.el('p', 'syn-dim', rows.length ? hint : 'None. Nice.'));
    const list = this.el('div', 'vd-list');
    for (const r of rows.slice(0, VaultDoctorPlugin.LIST_MAX)) list.append(makeRow(r));
    if (rows.length > VaultDoctorPlugin.LIST_MAX) list.append(this.el('div', 'syn-dim', '…and ' + (rows.length - VaultDoctorPlugin.LIST_MAX) + ' more'));
    card.append(list);
    return card;
  }

  row(label, sub, ...buttons) {
    const r = this.el('div', 'vd-row');
    const text = this.el('div', 'vd-text');
    text.append(this.el('div', 'vd-name', label));
    if (sub) text.append(this.el('div', 'syn-dim', sub));
    const actions = this.el('div', 'syn-actions');
    actions.append(...buttons);
    r.append(text, actions);
    return r;
  }

  renderReport() {
    const box = this.panelEl?.querySelector('#vdReport');
    if (!box) return;
    const r = CortexLib.analyzeVault(this.app._notes);
    const head = this.el('section', 'syn-card vd-head');
    const score = this.el('div', 'vd-score', r.score + '%');
    score.classList.add(r.score >= 80 ? 'vd-good' : r.score >= 50 ? 'vd-ok' : 'vd-bad');
    head.append(score, this.el('div', 'syn-dim', r.total + ' notes · ' + r.score + '% have no issues'));
    const open = (p) => { this.close(); this.app.hideWelcome(); this.app.openFile(p); };

    box.replaceChildren(
      head,
      this.section('Broken links', 'Links to notes that do not exist. Create the note, or fix the link in the notes that use it.', r.broken, (b) => {
        const sub = b.sources.length + ' link' + (b.sources.length === 1 ? '' : 's') + ' from ' + [...new Set(b.sources.map(s => s.stem))].join(', ');
        const creatable = !b.target.includes('/') && CortexLib.normalizeName(b.target, '.md').ok;
        return this.row(b.target, sub,
          ...(creatable ? [this.button('Create note', () => this.createNote(b.target), true)] : []),
          this.button('Open ' + b.sources[0].stem, () => open(b.sources[0].path)));
      }),
      this.section('Orphan notes', 'Nothing links here and it links nowhere: it will be hard to find again. Synapse can suggest links.', r.orphans, (n) =>
        this.row(n.stem, this.rel(n.path), this.button('Open', () => open(n.path)), this.button('Suggest links (AI)', () => this.suggestLinks(n.path), true))),
      this.section('Stub notes', 'Fewer than 10 words. Flesh them out or merge them.', r.stubs, (n) =>
        this.row(n.stem, (n.words || 0) + ' words · ' + this.rel(n.path), this.button('Open', () => open(n.path)))),
      this.section('Duplicate names', 'Same name in different folders: [[links]] can only reach one of them. Rename one.', r.duplicates, (d) =>
        this.row(d.stem, d.paths.map(p => this.rel(p)).join(' · '), ...d.paths.map(p => this.button('Open ' + this.rel(p), () => open(p))))),
    );
  }

  async createNote(target) {
    const parsed = CortexLib.normalizeName(target, '.md');
    if (!parsed.ok) { this.app.notice(parsed.error); return; }
    const filePath = this.app.vaultPath + '/' + parsed.name;
    const result = await window.cortex.writeFile(filePath, '# ' + target + '\n\n', { overwrite: false }); // never replaces a note
    if (!result.success && !result.exists) { this.app.notice('Could not create ' + target + ': ' + result.error); return; }
    this.app.notice('Created ' + target);
    await this.app.renderFileTree();
  }

  async suggestLinks(path) {
    this.close();
    this.app.hideWelcome();
    await this.app.openFile(path);
    const synapse = this.app.plugins.find(p => p.name === 'synapse');
    if (!synapse) return;
    await synapse.open();
    synapse.run('links');
  }
}

window.VaultDoctorPlugin = VaultDoctorPlugin;
