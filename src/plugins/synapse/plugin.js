// ============================================
// CORTEX Plugin: Synapse — AI assistant, bring your own key (Anthropic, OpenRouter, NVIDIA NIM)
// ============================================
// The key never enters this page: cortex.ai.* hands requests to the main process, which holds the key and calls the provider.

class SynapsePlugin {
  name = 'synapse';
  app = null;
  panelEl = null;
  config = null; // from cortex.ai.getConfig(): { provider, providers: { [id]: { label, model, hasKey, remembered } } }
  busy = false;
  last = null; // { kind, path, text, items } — the result on screen and what its action applies to

  async init() {}

  async open() {
    this.renderPanel();
    await this.refreshConfig();
  }

  close() { this.panelEl?.remove(); this.panelEl = null; }

  $(sel) { return this.panelEl?.querySelector(sel); }

  activeTab() { return this.app.openTabs.find(t => t.path === this.app.activeTab) || null; }

  stemOf(p) { return p.split(/[\\/]/).pop().replace(/\.md$/i, ''); }

  renderPanel() {
    this.close();
    const panel = document.createElement('div');
    panel.className = 'plugin-panel visible';
    panel.id = 'plugin-synapse';
    // static markup only: every user or model string below is set with textContent or the safe Markdown renderer
    panel.innerHTML = `
      <div class="plugin-panel-header">
        <span class="plugin-panel-title">Synapse — AI Assistant</span>
        <div style="display:flex;gap:8px;">
          <button class="icon-btn" id="synSettingsBtn" title="AI settings"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.2"/><path d="M7 1V3M7 11V13M1 7H3M11 7H13M2.8 2.8L4.2 4.2M9.8 9.8L11.2 11.2M2.8 11.2L4.2 9.8M9.8 4.2L11.2 2.8" stroke="currentColor" stroke-width="1.2"/></svg></button>
          <button class="icon-btn" id="synClose" title="Close"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" stroke-width="1.5"/></svg></button>
        </div>
      </div>
      <div class="plugin-panel-body">
        <div class="syn-wrap">
          <section class="syn-card" id="synSettings" hidden>
            <h3 class="syn-h">Bring your own key</h3>
            <div class="syn-row">
              <label class="syn-label" for="synProvider">Provider</label>
              <select class="syn-input" id="synProvider"></select>
            </div>
            <div class="syn-row">
              <label class="syn-label" for="synModel">Model</label>
              <input class="syn-input" id="synModel" autocomplete="off" spellcheck="false">
            </div>
            <div class="syn-row">
              <label class="syn-label" for="synKey">API key</label>
              <input class="syn-input" id="synKey" type="password" autocomplete="off" spellcheck="false">
            </div>
            <div class="syn-actions">
              <button class="syn-btn syn-btn-primary" id="synSave">Save</button>
              <button class="syn-btn" id="synForget">Remove key</button>
              <span class="syn-dim" id="synKeyState"></span>
            </div>
            <p class="syn-dim">Your key is encrypted with your system keychain and used only from this computer. The note text you
              run Synapse on is sent to the provider you choose here, and nothing else is.</p>
          </section>

          <section class="syn-card">
            <h3 class="syn-h">This note <span class="syn-dim" id="synNoteName"></span></h3>
            <div class="syn-actions">
              <button class="syn-btn" data-kind="summarize">Summarize</button>
              <button class="syn-btn" data-kind="links">Suggest links</button>
              <button class="syn-btn" data-kind="tags">Suggest tags</button>
              <button class="syn-btn" data-kind="flashcards">Make flashcards</button>
              <button class="syn-btn" data-kind="tasks">Extract tasks</button>
            </div>
          </section>

          <section class="syn-card">
            <h3 class="syn-h">Ask your vault</h3>
            <div class="syn-actions">
              <input class="syn-input" id="synQuestion" placeholder="What did I decide about…?" autocomplete="off" style="flex:1;">
              <button class="syn-btn syn-btn-primary" id="synAsk">Ask</button>
            </div>
          </section>

          <section class="syn-card" id="synResultCard" hidden>
            <div class="syn-status" id="synStatus" role="status"></div>
            <div class="syn-result preview-content" id="synResult"></div>
            <div class="syn-actions" id="synResultActions"></div>
          </section>
        </div>
      </div>
    `;
    document.getElementById('plugin-root').appendChild(panel);
    this.panelEl = panel;

    const tab = this.activeTab();
    this.$('#synNoteName').textContent = tab ? '— ' + this.stemOf(tab.path) : '— open a note first';
    this.$('#synClose').addEventListener('click', () => this.close());
    this.$('#synSettingsBtn').addEventListener('click', () => { this.$('#synSettings').hidden = !this.$('#synSettings').hidden; });
    this.$('#synProvider').addEventListener('change', () => this.fillProvider(this.$('#synProvider').value));
    this.$('#synSave').addEventListener('click', () => this.saveSettings());
    this.$('#synForget').addEventListener('click', () => this.saveSettings(''));
    panel.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => this.run(b.dataset.kind)));
    this.$('#synAsk').addEventListener('click', () => this.ask(this.$('#synQuestion').value));
    this.$('#synQuestion').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) this.ask(e.target.value); });
  }

  async refreshConfig() {
    this.config = await window.cortex.ai.getConfig();
    if (!this.panelEl || !this.config?.success) return;
    const select = this.$('#synProvider');
    select.replaceChildren(...Object.entries(this.config.providers).map(([id, p]) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = p.label + (p.hasKey ? ' ✓' : '');
      return opt;
    }));
    select.value = this.config.provider;
    this.fillProvider(this.config.provider);
    if (!this.config.providers[this.config.provider].hasKey) this.$('#synSettings').hidden = false;
  }

  fillProvider(id) {
    const p = this.config.providers[id];
    this.$('#synModel').value = p.model;
    this.$('#synModel').placeholder = p.defaultModel;
    this.$('#synKey').value = '';
    this.$('#synKey').placeholder = p.hasKey ? 'Saved — paste a new key to replace it' : 'Paste your ' + p.label + ' API key';
    this.$('#synKeyState').textContent = !p.hasKey ? 'No key yet' : p.remembered ? 'Key saved (encrypted)' : 'Key kept until you quit (no system keychain)';
  }

  // apiKey: '' removes the provider's key; otherwise whatever is typed (blank keeps the saved one)
  async saveSettings(apiKey = this.$('#synKey').value.trim() || undefined) {
    const opts = { provider: this.$('#synProvider').value, model: this.$('#synModel').value.trim() || undefined, apiKey };
    const result = await window.cortex.ai.setConfig(opts);
    if (!result.success) { this.showStatus(result.error, true); return; }
    this.config = result;
    await this.refreshConfig();
    this.app.notice(apiKey === '' ? 'AI key removed' : 'AI settings saved');
  }

  // One AI request at a time; resolves the reply or null (the error is on screen)
  async request(req, label) {
    if (this.busy) return null;
    this.busy = true;
    this.panelEl?.querySelectorAll('[data-kind], #synAsk').forEach(b => { b.disabled = true; });
    this.showStatus(label + '…');
    this.$('#synResult')?.replaceChildren();
    this.$('#synResultActions')?.replaceChildren();
    try {
      const reply = await window.cortex.ai.complete(req);
      if (!reply.success) {
        this.showStatus(reply.error, true);
        if (reply.needsKey && this.panelEl) this.$('#synSettings').hidden = false;
        return null;
      }
      return reply;
    } finally {
      this.busy = false;
      this.panelEl?.querySelectorAll('[data-kind], #synAsk').forEach(b => { b.disabled = false; });
    }
  }

  showStatus(text, error = false) {
    if (!this.panelEl) return;
    this.$('#synResultCard').hidden = false;
    const s = this.$('#synStatus');
    s.textContent = text;
    s.classList.toggle('syn-error', error);
  }

  async run(kind) {
    const tab = this.activeTab();
    if (!tab) { this.showStatus('Open a note first.', true); return; }
    const notes = this.app._notes;
    const req = CortexLib.buildNotePrompt(kind, {
      title: this.stemOf(tab.path),
      content: tab.content,
      titles: notes.map(n => n.stem).filter(s => CortexLib.normalizeStem(s) !== CortexLib.normalizeStem(this.stemOf(tab.path))),
      tags: this.app._tags.map(t => t.tag),
    });
    const labels = { summarize: 'Summarizing', links: 'Finding links', tags: 'Choosing tags', flashcards: 'Writing flashcards', tasks: 'Finding tasks' };
    const reply = await this.request(req, labels[kind]);
    if (!reply || !this.panelEl) return;
    this.showResult(kind, tab.path, reply, req.trimmed);
  }

  async ask(question) {
    question = String(question || '').trim();
    if (!question) return;
    // the index search ANDs its terms: search each keyword alone and rank notes by their summed scores
    const scores = new Map();
    for (const term of CortexLib.questionTerms(question)) {
      for (const h of await window.cortex.index.search(term, 10)) {
        const cur = scores.get(h.path) || scores.set(h.path, { ...h, score: 0 }).get(h.path);
        cur.score += h.score;
      }
    }
    const hits = [...scores.values()].sort((a, b) => b.score - a.score).slice(0, 6);
    const sources = [];
    for (const h of hits) {
      const read = await window.cortex.readFile(h.path);
      if (read.success) sources.push({ title: h.stem, content: read.content, path: h.path });
    }
    const reply = await this.request(CortexLib.buildAskPrompt(question, sources), 'Reading ' + sources.length + ' note' + (sources.length === 1 ? '' : 's'));
    if (!reply || !this.panelEl) return;
    this.showResult('ask', null, reply, false, sources);
  }

  showResult(kind, path, reply, trimmed, sources = []) {
    const tab = path ? this.app.openTabs.find(t => t.path === path) : null;
    let items = null;
    let text = reply.text;
    if (kind === 'links') {
      const linked = (CortexLib.parseNote(tab ? tab.content : '').links || []).map(l => CortexLib.normalizeStem(l.target));
      items = CortexLib.parseLinks(reply.text, this.app._notes.map(n => n.stem), this.stemOf(path), linked);
      text = items.length ? items.map(s => '- [[' + s + ']]').join('\n') : 'No new links to suggest.';
    } else if (kind === 'tags') {
      items = CortexLib.parseTags(reply.text);
      text = items.length ? items.map(t => '#' + t).join(' ') : 'No tags to suggest.';
    } else if (kind === 'flashcards') {
      items = CortexLib.parseCards(reply.text);
      text = items.length ? items.map(c => '- **' + c.front + '** — ' + c.back).join('\n') : 'No flashcards came back.';
    } else if (kind === 'tasks') {
      items = CortexLib.parseTasks(reply.text);
      text = items.length ? items.map(t => '- [ ] ' + t).join('\n') : 'No open action items found.';
    }
    this.last = { kind, path, text: reply.text, items };
    const notes = [reply.model, reply.usage.input + ' in / ' + reply.usage.output + ' out tokens'];
    if (trimmed) notes.push('the note was too long and only its start was sent');
    if (reply.truncated) notes.push('the reply hit its length limit');
    this.showStatus(notes.join(' · '));
    this.$('#synResult').innerHTML = CortexLib.renderMarkdown(text, { isResolved: (t) => this.app._stemSet.has(CortexLib.normalizeStem(t)) });
    this.$('#synResult').querySelectorAll('input').forEach(i => { i.disabled = true; });

    const actions = [];
    const btn = (label, fn, primary) => {
      const b = document.createElement('button');
      b.className = 'syn-btn' + (primary ? ' syn-btn-primary' : '');
      b.textContent = label;
      b.addEventListener('click', fn);
      actions.push(b);
    };
    if (kind === 'summarize' || kind === 'ask') {
      btn('Insert into note', () => this.insert('\n' + reply.text + '\n', false), true);
      btn('Copy', () => navigator.clipboard.writeText(reply.text).then(() => this.app.notice('Copied')).catch(() => this.app.notice('Copy failed')));
    } else if (kind === 'links' && items.length) {
      btn('Add to note', () => this.insert('\n\n## Related\n' + items.map(s => '- [[' + s + ']]').join('\n') + '\n', true, path), true);
    } else if (kind === 'tags' && items.length) {
      btn('Add to note', () => this.insert('\n\n' + items.map(t => '#' + t).join(' ') + '\n', true, path), true);
    } else if (kind === 'flashcards' && items.length) {
      btn('Add ' + items.length + ' cards to Recall', () => this.handOff('recall', 'addCards', items, path), true);
    } else if (kind === 'tasks' && items.length) {
      btn('Add ' + items.length + ' tasks to TaskFlow', () => this.handOff('taskflow', 'addTasks', items, path), true);
    }
    for (const s of sources) btn('Open ' + s.title, () => { this.close(); this.app.openFile(s.path); });
    this.$('#synResultActions').replaceChildren(...actions);
  }

  // Edits the open note through the editor (undoable, autosaved). `path` pins the note the result was made for.
  insert(text, atEnd, path = this.app.activeTab) {
    if (!path || this.app.activeTab !== path) {
      this.showStatus(path ? 'Switch back to ' + this.stemOf(path) + ' to add this.' : 'Open a note first.', true);
      return;
    }
    const textarea = this.app.$('editorTextarea');
    const at = atEnd ? textarea.value.length : textarea.selectionEnd;
    this.close();
    this.app.applyEdit({ from: at, to: at, insert: text, selStart: at + text.length, selEnd: at + text.length });
    this.app.notice('Added to ' + this.stemOf(path));
  }

  handOff(pluginName, method, items, path) {
    const plugin = this.app.plugins.find(p => p.name === pluginName);
    if (!plugin) return;
    const n = plugin[method](items, path ? this.stemOf(path) : null);
    this.$('#synResultActions').replaceChildren();
    this.app.notice('Added ' + n + (pluginName === 'recall' ? ' cards to Recall' : ' tasks to TaskFlow'));
  }
}

window.SynapsePlugin = SynapsePlugin;
