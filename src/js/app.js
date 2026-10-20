// ============================================
// CORTEX — Core Application (Feature-Rich)
// ============================================

const App = {
  vaultPath: '',
  files: [],
  openTabs: [],
  activeTab: null,
  currentView: 'editor',
  sidebarPanel: 'fileExplorer',
  settings: { theme: 'dark', previewSplit: true },
  plugins: [],
  commands: [],
  _domCache: {},
  _debounceTimers: {},
  _graphCleanup: null,
  _fileTreeAbort: null,
  _searchAbort: null,
  _notes: [], // NoteMeta[] from the vault index
  _tags: [], // { tag, count, paths }[]
  _stemSet: new Set(), // normalized stems of every note
  _starredNotes: new Set(JSON.parse(localStorage.getItem('cortex_starred') || '[]')),
  _focusMode: false,
  _layoutMode: 'split', // split, editor, preview
  _slashOpen: false,
  _slashQuery: '',
  _slashIndex: 0,
  _wikilinkOpen: false,
  _wikilinkQuery: '',
  _wikilinkIndex: 0,

  $(id) {
    if (!this._domCache[id]) this._domCache[id] = document.getElementById(id);
    return this._domCache[id];
  },

  // The one spelling of a path for tab identity (forward slashes): the tree/list give native `\` paths, createFile builds `/` ones.
  normPath(p) { return p.replace(/\\/g, '/'); },

  debounce(key, fn, ms) {
    clearTimeout(this._debounceTimers[key]);
    this._debounceTimers[key] = setTimeout(fn, ms);
  },

  async init() {
    await this.loadVault();
    this.setupEventListeners();
    this.registerCoreCommands();
    await this.loadPlugins();
    this.renderFileTree();
    this.updateTitleBar();
    this.setupMenuListeners();
    await this.refreshIndex(); // the welcome stats read it
    this.showWelcome();
  },

  async refreshIndex() {
    const [notes, tags] = await Promise.all([window.cortex.index.notes(), window.cortex.index.tags()]);
    this._notes = notes;
    this._tags = tags;
    this._stemSet = new Set(notes.map(n => CortexLib.normalizeStem(n.stem)));
  },

  // Fresh index data for what shows it: the welcome stats and the open panel. Never the editor, the file tree or the search box.
  async onIndexUpdated() {
    await this.refreshIndex();
    if (this.$('welcomeDashboard').classList.contains('visible')) this.updateWelcomeStats();
    const tree = this.$('fileTree');
    if (this.sidebarPanel === 'backlinks') this.renderBacklinks(tree);
    else if (this.sidebarPanel === 'tags') this.renderTagsPanel(tree);
    else if (this.sidebarPanel === 'search') this.runSearch();
    if (this.$('graphView').classList.contains('visible')) this.initGraph();
  },

  async loadVault() {
    const result = await window.cortex.getVaultPath();
    if (result) this.vaultPath = result;
  },

  updateTitleBar() {
    const el = this.$('titleBarPath');
    if (el) el.textContent = '~/' + this.vaultPath.split(/[\\/]/).pop();
  },

  setupMenuListeners() {
    window.cortex.onFlush((asking) => this.confirmFlush(asking));
    // main only sends this after every tab was saved, or the user agreed to drop the ones that could not be (confirmFlush)
    window.cortex.onVaultChanged((path) => {
      this.vaultPath = path;
      [...this.openTabs].forEach(t => this.removeTab(t));
      this.showWelcome();
      this.updateTitleBar();
      this.renderFileTree();
      this.onIndexUpdated();
    });
    window.cortex.index.onUpdated(() => this.debounce('index', () => this.onIndexUpdated(), 150));
    window.cortex.onMenuAction('new-file', () => this.createFile());
    window.cortex.onMenuAction('toggle-preview', () => this.togglePreview());
    window.cortex.onMenuAction('toggle-graph', () => this.togglePanel('graph'));
    window.cortex.onMenuAction('open-search', () => this.togglePanel('search'));
  },

  setupEventListeners() {
    const textarea = this.$('editorTextarea');
    textarea.addEventListener('input', () => this.onEditorInput());
    textarea.addEventListener('keydown', (e) => this.onEditorKeydown(e));
    textarea.addEventListener('click', () => this.updateCursorPosition());
    textarea.addEventListener('keyup', () => this.updateCursorPosition());

    document.querySelectorAll('.activity-btn[data-panel]').forEach(btn => {
      btn.addEventListener('click', () => this.togglePanel(btn.dataset.panel));
    });

    this.$('btnNewFile').addEventListener('click', () => this.createFile());
    this.$('btnNewFolder').addEventListener('click', () => this.createFolder());
    this.$('btnRefreshFiles').addEventListener('click', () => this.renderFileTree());
    this.$('btnMinimize').addEventListener('click', () => window.cortex.minimize());
    this.$('btnMaximize').addEventListener('click', () => window.cortex.maximize());
    this.$('btnClose').addEventListener('click', () => window.cortex.close());
    this.$('btnCommandPalette').addEventListener('click', () => this.openCommandPalette());
    this.$('btnFocusMode').addEventListener('click', () => this.toggleFocusMode());
    this.$('btnLayoutCycle').addEventListener('click', () => this.cycleLayout());
    this.$('btnGraphRefresh').addEventListener('click', () => this.initGraph());
    this.$('editorTabs').addEventListener('click', (e) => this.onTabClick(e));

    document.addEventListener('keydown', (e) => this.onGlobalKeydown(e));
    document.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    document.addEventListener('click', () => this.hideContextMenu());

    window.addEventListener('resize', () => this.debounce('resize', () => {
      if (this.$('graphView').classList.contains('visible')) this.initGraph();
    }, 200));

    // Welcome dashboard buttons
    const wd = this.$('welcomeDashboard');
    if (wd) {
      this.$('btnWelcomeNewNote').addEventListener('click', () => this.createFile());
      this.$('btnWelcomeDaily').addEventListener('click', () => this.openDailyNote());
      this.$('btnWelcomeGraph').addEventListener('click', () => { this.hideWelcome(); this.togglePanel('graph'); });
      this.$('btnWelcomeSearch').addEventListener('click', () => { this.hideWelcome(); this.togglePanel('search'); });
    }
  },

  // ---- Welcome Dashboard ----

  showWelcome() {
    if (this.openTabs.length === 0) {
      this.$('welcomeDashboard').classList.add('visible');
      this.$('editorContent').style.display = 'none';
      this.$('editorTabs').style.display = 'none';
      this.updateWelcomeStats();
    }
  },

  hideWelcome() {
    this.$('welcomeDashboard').classList.remove('visible');
    this.$('editorContent').style.display = '';
    this.$('editorTabs').style.display = '';
  },

  updateWelcomeStats() {
    const statsEl = this.$('welcomeStats');
    if (!statsEl) return;
    const stats = [[this._notes.length, 'Notes'], [this._tags.length, 'Tags'], [this._starredNotes.size, 'Starred'], [this.plugins.length, 'Plugins']];
    statsEl.replaceChildren(...stats.map(([value, label]) => {
      const stat = document.createElement('div');
      stat.className = 'welcome-stat';
      const v = document.createElement('div');
      v.className = 'welcome-stat-value';
      v.textContent = value;
      const l = document.createElement('div');
      l.className = 'welcome-stat-label';
      l.textContent = label;
      stat.append(v, l);
      return stat;
    }));
  },

  // The only daily-note opener (Welcome button and DailySync). overwrite:false makes create-if-absent atomic: an existing note is opened as-is, never rewritten.
  async openDailyNote() {
    const today = CortexLib.localDateStr();
    const notePath = this.vaultPath + '/Daily Notes/' + today + '.md';
    const template = '# ' + today + '\n\n## Notes\n\n## Tasks\n- [ ] \n\n## Reflections\n';
    const result = await window.cortex.writeFile(notePath, template, { overwrite: false });
    if (!result.success && !result.exists) { alert('Could not open the daily note: ' + result.error); return; }
    await this.renderFileTree();
    this.hideWelcome();
    await this.openFile(notePath);
  },

  // ---- Focus Mode ----

  toggleFocusMode() {
    this._focusMode = !this._focusMode;
    document.body.classList.toggle('focus-mode', this._focusMode);
  },

  // ---- Layout Cycling ----

  cycleLayout() {
    const modes = ['split', 'editor', 'preview'];
    const idx = modes.indexOf(this._layoutMode);
    this._layoutMode = modes[(idx + 1) % modes.length];
    document.body.classList.remove('layout-editor-only', 'layout-preview-only');
    if (this._layoutMode === 'editor') document.body.classList.add('layout-editor-only');
    else if (this._layoutMode === 'preview') document.body.classList.add('layout-preview-only');
    else {
      this.$('previewPane').classList.add('visible');
    }
  },

  // ---- File Operations ----

  async renderFileTree() {
    const tree = this.$('fileTree');
    if (!this.vaultPath) return;
    if (this._fileTreeAbort) this._fileTreeAbort.abort();
    const { signal } = this._fileTreeAbort = new AbortController();

    const result = await window.cortex.listFiles(this.vaultPath);
    if (!result.success) return;
    const items = document.createDocumentFragment();
    await this.renderFileTreeItems(items, result.files); // every folder is listed before callers go on (no scan left holding one open)
    if (signal.aborted || this.sidebarPanel !== 'fileExplorer') return; // a newer render, or another panel, owns #fileTree now
    this.files = result.files;
    tree.replaceChildren(items);
  },

  async renderFileTreeItems(container, items, depth = 0) {
    const fragment = document.createDocumentFragment();
    const folders = [];
    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'file-tree-item';
      el.dataset.path = item.path;
      el.dataset.name = item.name;

      const isFolder = item.isDirectory;
      const icon = isFolder
        ? '<svg class="file-icon" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4C2 3.44772 2.44772 3 3 3H5L6 4H11C11.5523 4 12 4.44772 12 5V10C12 10.5523 11.5523 11 11 11H3C2.44772 11 2 10.5523 2 10V4Z" fill="currentColor"/></svg>'
        : '<svg class="file-icon" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 2H8L11 5V12H4V2Z" stroke="currentColor" stroke-width="1" fill="none"/><path d="M8 2V5H11" stroke="currentColor" stroke-width="1"/></svg>';

      const isStarred = !isFolder && this._starredNotes.has(item.path);
      const starIcon = isStarred ? ' <span style="color:var(--accent-0);font-size:10px;">&#9733;</span>' : '';

      el.innerHTML = `${icon}<span class="file-name">${item.name}${starIcon}</span><div class="file-actions">
        <button class="action-star" title="${isStarred ? 'Unstar' : 'Star'}"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1L7.5 4.5L11 5L8.5 7.5L9 11L6 9.5L3 11L3.5 7.5L1 5L4.5 4.5L6 1Z" stroke="currentColor" stroke-width="1" fill="${isStarred ? 'currentColor' : 'none'}"/></svg></button>
        <button class="action-rename" title="Rename"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 10H10" stroke="currentColor" stroke-width="1"/></svg></button>
        <button class="action-delete" title="Delete"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3H10M4 3V2H8V3M3 3L4 10H8L9 3" stroke="currentColor" stroke-width="1"/></svg></button>
      </div>`;

      el.addEventListener('click', (e) => {
        if (e.target.closest('.file-actions')) return;
        if (isFolder) {
          el.classList.toggle('expanded');
          const next = el.nextElementSibling;
          if (next && next.classList.contains('folder-children')) {
            next.style.display = next.style.display === 'none' ? '' : 'none';
          }
        } else {
          this.hideWelcome();
          this.openFile(item.path);
        }
      });

      // Star button
      const starBtn = el.querySelector('.action-star');
      if (starBtn) {
        starBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleStar(item.path);
        });
      }

      fragment.appendChild(el);

      if (isFolder) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'folder-children';
        folders.push(window.cortex.listFiles(item.path).then(result => {
          if (result.success) return this.renderFileTreeItems(childrenContainer, result.files, depth + 1);
        }));
        fragment.appendChild(childrenContainer);
      }
    });
    container.appendChild(fragment);
    await Promise.all(folders);
  },

  toggleStar(filePath) {
    if (this._starredNotes.has(filePath)) this._starredNotes.delete(filePath);
    else this._starredNotes.add(filePath);
    localStorage.setItem('cortex_starred', JSON.stringify([...this._starredNotes]));
    this.renderFileTree();
  },

  async openFile(filePath) {
    filePath = this.normPath(filePath); // tab.path and activeTab always hold the normalized form
    const open = this.findTab(filePath);
    if (open) { this.switchTab(open.path); return; }

    const result = await window.cortex.readFile(filePath);
    const raced = this.findTab(filePath);
    if (raced) { this.switchTab(raced.path); return; } // a concurrent open finished while we were reading
    const name = filePath.split(/[\\/]/).pop();
    // Never an empty tab for a failed read: its first autosave would overwrite the real note (the write may well succeed)
    if (!result.success) { alert('Could not open ' + name + ': ' + result.error); this.showWelcome(); return; } // callers hide the welcome screen first
    const tab = { path: filePath, name, content: result.content, modified: false };
    this.openTabs.push(tab);
    this.hideWelcome();
    this.switchTab(filePath);
    this.renderTabs();
  },

  switchTab(filePath) {
    filePath = this.normPath(filePath);
    const tab = this.findTab(filePath);
    this.activeTab = tab ? tab.path : filePath;
    if (tab) {
      this.$('editorTextarea').value = tab.content;
      this.updatePreview(tab.content);
      this.updateStatusBar(tab.content);
      this.updateTabStyles();
    }
    if (this.sidebarPanel === 'backlinks') this.renderBacklinks(this.$('fileTree'));
  },

  renderTabs() {
    const container = this.$('editorTabs');
    const fragment = document.createDocumentFragment();
    this.openTabs.forEach(tab => {
      const el = document.createElement('div');
      el.className = 'editor-tab' + (tab.path === this.activeTab ? ' active' : '') + (tab.modified ? ' modified' : '');
      el.dataset.path = tab.path; // tabs are looked up by this, never by the display name
      const label = document.createElement('span');
      label.textContent = tab.name;
      const close = document.createElement('button');
      close.className = 'tab-close';
      close.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.5"/></svg>';
      el.append(label, close);
      fragment.appendChild(el);
    });
    container.innerHTML = '';
    container.appendChild(fragment);
  },

  updateTabStyles() {
    const dirty = new Set(this.openTabs.filter(t => t.modified).map(t => t.path));
    document.querySelectorAll('.editor-tab').forEach(el => {
      el.classList.toggle('active', el.dataset.path === this.activeTab);
      el.classList.toggle('modified', dirty.has(el.dataset.path));
    });
  },

  // The open tab for a normalized path, ignoring letter case: NTFS treats Welcome.md and welcome.md as one file, so a tab keeps
  // the single spelling it was opened with and every other spelling resolves to it.
  findTab(p) {
    const key = p.toUpperCase();
    return this.openTabs.find(t => t.path.toUpperCase() === key);
  },

  // Open tabs at `p`: the tab for that file, or every tab under it when `p` is a folder.
  tabsAt(p) {
    const key = p.toUpperCase();
    return this.openTabs.filter(t => { const u = t.path.toUpperCase(); return u === key || u.startsWith(key + '/'); });
  },

  // Writes the tab's unsaved text now and drops its pending autosave. false if the write failed (the tab stays modified).
  async flushTab(tab) {
    for (;;) {
      clearTimeout(this._debounceTimers['save_' + tab.path]);
      if (!tab.modified) return true;
      if (!(await this.saveFile(tab))) return false;
      // typing during the write leaves the tab modified: go round again
    }
  },

  // Saves every dirty tab; true only if all writes succeeded.
  async flushSaves() {
    const results = await Promise.all(this.openTabs.map(t => this.flushTab(t)));
    return results.every(Boolean);
  },

  // Runs when main is about to close the window or switch vault. true = go ahead; false = the user chose to keep editing.
  // Anything that cannot be saved is named to the user first: it would be lost for good.
  async confirmFlush(asking) {
    if (await this.flushSaves()) return true;
    const names = this.openTabs.filter(t => t.modified).map(t => t.name);
    asking(); // a native confirm blocks this window: tell main a person is deciding so its timeout does not close us underneath
    return confirm(names.length + ' note(s) could not be saved: ' + names.join(', ') + '. Discard these changes and continue?');
  },

  // The tab is only closed once its text is on disk; if that fails it stays open with the error shown.
  async closeTab(filePath) {
    const tab = this.findTab(this.normPath(filePath));
    if (!tab) return;
    // A tab whose save fails is kept open (the text is not lost) unless the user chooses to discard it
    if (!(await this.flushTab(tab)) && !confirm('"' + tab.name + '" could not be saved (' + tab.saveError + '). Close it and lose your changes?')) return;
    this.removeTab(tab);
  },

  // Drops a tab without writing it: for tabs whose file was closed after a flush, moved or deleted.
  removeTab(tab) {
    const idx = this.openTabs.indexOf(tab);
    if (idx === -1) return;
    clearTimeout(this._debounceTimers['save_' + tab.path]); // no autosave may fire for a tab that is gone
    this.openTabs.splice(idx, 1);
    if (this.activeTab === tab.path) {
      if (this.openTabs.length > 0) {
        this.switchTab(this.openTabs[Math.max(0, idx - 1)].path);
      } else {
        this.activeTab = null;
        this.$('editorTextarea').value = '';
        this.$('previewContent').innerHTML = '';
        this.updateStatusBar('');
        this.showWelcome();
      }
    }
    this.renderTabs();
    this.updateSaveError();
  },

  async createFile() {
    const input = await Dialogs.ask({ title: 'New note', placeholder: 'Note name' });
    if (!input) return;
    const parsed = CortexLib.normalizeName(input, '.md');
    if (!parsed.ok) { alert(parsed.error); return; }
    const filePath = this.vaultPath + '/' + parsed.name;
    const title = parsed.name.replace(/\.md$/i, '').split('/').pop();
    // overwrite:false makes "create" atomic: an existing note is opened as-is, never rewritten
    const result = await window.cortex.writeFile(filePath, '# ' + title + '\n\nStart writing...\n', { overwrite: false });
    if (!result.success && !result.exists) { alert('Could not create the note: ' + result.error); return; }
    await this.renderFileTree();
    this.hideWelcome();
    await this.openFile(filePath);
  },

  async createFolder() {
    const input = await Dialogs.ask({ title: 'New folder', placeholder: 'Folder name' });
    if (!input) return;
    const parsed = CortexLib.normalizeName(input, '');
    if (!parsed.ok) { alert(parsed.error); return; }
    const result = await window.cortex.createFolder(this.vaultPath + '/' + parsed.name);
    if (!result.success) { alert('Could not create the folder: ' + result.error); return; }
    await this.renderFileTree();
  },

  async deleteFile(filePath) {
    const name = filePath.split(/[\\/]/).pop();
    const contents = (await this.isFolder(filePath)) ? ' (and its contents)' : '';
    if (!confirm('Move "' + name + '"' + contents + ' to the Recycle Bin?')) return;
    const affected = this.tabsAt(this.normPath(filePath));
    // Flush first so no autosave can fire into the path once it is gone (the result is moot: the file is being deleted)
    await Promise.all(affected.map(t => this.flushTab(t)));
    const result = await window.cortex.deleteFile(filePath);
    if (!result.success) { alert('Could not delete: ' + result.error); return; }
    affected.forEach(t => this.removeTab(t));
    await this.renderFileTree();
  },

  async renameFile(oldPath) {
    const segments = oldPath.split(/[\\/]/);
    const oldName = segments.pop();
    const input = await Dialogs.ask({ title: 'Rename', value: oldName });
    if (!input || input === oldName) return;
    const parsed = CortexLib.normalizeName(input, '');
    if (!parsed.ok) { alert(parsed.error); return; }
    const newPath = segments.join('/') + '/' + parsed.name;
    const from = this.normPath(oldPath);
    const affected = this.tabsAt(from); // the file's own tab, or every tab inside a renamed folder
    // Pending autosaves reach the disk before the move, so none can fire into the old path afterwards
    const saved = await Promise.all(affected.map(t => this.flushTab(t)));
    if (saved.includes(false)) { alert('Could not save your changes first: ' + affected.find(t => t.saveError).saveError); return; }
    const result = await window.cortex.renameFile(oldPath, newPath);
    if (!result.success) {
      alert(result.exists ? '"' + parsed.name + '" already exists.' : 'Could not rename: ' + result.error);
      return;
    }
    // The open tabs move with their files: same text, same position, and any save from here on targets the new path
    affected.forEach(tab => {
      clearTimeout(this._debounceTimers['save_' + tab.path]);
      if (this.activeTab === tab.path) this.activeTab = newPath + tab.path.slice(from.length);
      tab.path = newPath + tab.path.slice(from.length);
      tab.name = tab.path.split('/').pop();
      if (tab.modified) this.debounce('save_' + tab.path, () => this.saveFile(tab), 500); // typed while the rename was in flight
    });
    this.renderTabs();
    await this.renderFileTree();
    // A renamed file is shown (its tab already moved, or it opens); a renamed folder has nothing to open
    if (!(await this.isFolder(newPath))) await this.openFile(newPath);
  },

  // Listing succeeds only on a folder (a file fails with ENOTDIR); a missing path counts as an empty folder.
  async isFolder(p) {
    return (await window.cortex.listFiles(p)).success;
  },

  // ---- Editor with Slash Commands & Wikilinks ----

  onEditorInput() {
    const textarea = this.$('editorTextarea');
    const content = textarea.value;
    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = content.substring(0, cursorPos);

    // Check for slash command
    const slashMatch = textBeforeCursor.match(/\/(\w*)$/);
    if (slashMatch) {
      this._slashQuery = slashMatch[1];
      this._slashOpen = true;
      this._slashIndex = 0;
      this.showSlashPalette(cursorPos);
    } else {
      this.hideSlashPalette();
    }

    // Check for wikilink
    const wikilinkMatch = textBeforeCursor.match(/\[\[([^\]]*)$/);
    if (wikilinkMatch) {
      this._wikilinkQuery = wikilinkMatch[1];
      this._wikilinkOpen = true;
      this._wikilinkIndex = 0;
      this.showWikilinkAutocomplete(cursorPos);
    } else {
      this.hideWikilinkAutocomplete();
    }

    // Update content
    const tab = this.openTabs.find(t => t.path === this.activeTab);
    if (tab) {
      tab.content = content;
      if (!tab.modified) { tab.modified = true; this.updateTabStyles(); }
      this.debounce('save_' + tab.path, () => this.saveFile(tab), 500);
    }
    this.debounce('preview', () => this.updatePreview(content), 100);
    this.updateStatusBar(content);
  },

  showSlashPalette(cursorPos) {
    const palette = this.$('slashPalette');
    const textarea = this.$('editorTextarea');
    const rect = textarea.getBoundingClientRect();
    const lines = textarea.value.substring(0, cursorPos).split('\n');
    const currentLine = lines[lines.length - 1];
    const approxCharWidth = 8.4;
    const left = Math.min(currentLine.length * approxCharWidth + 32, rect.width - 340);
    const top = lines.length * 24.5 - textarea.scrollTop + 32;

    palette.style.left = left + 'px';
    palette.style.top = top + 'px';

    const slashCommands = [
      { id: 'h1', label: 'Heading 1', desc: 'Large section heading', icon: 'H1', action: () => this.insertSlashCommand('# ') },
      { id: 'h2', label: 'Heading 2', desc: 'Medium section heading', icon: 'H2', action: () => this.insertSlashCommand('## ') },
      { id: 'h3', label: 'Heading 3', desc: 'Small section heading', icon: 'H3', action: () => this.insertSlashCommand('### ') },
      { id: 'bold', label: 'Bold', desc: 'Bold text', icon: 'B', action: () => this.insertSlashCommand('**text**') },
      { id: 'italic', label: 'Italic', desc: 'Italic text', icon: 'I', action: () => this.insertSlashCommand('*text*') },
      { id: 'code', label: 'Code Block', desc: 'Inline code', icon: '<>', action: () => this.insertSlashCommand('`code`') },
      { id: 'codeblock', label: 'Code Block', desc: 'Multi-line code block', icon: '{ }', action: () => this.insertSlashCommand('\n```\ncode\n```\n') },
      { id: 'link', label: 'Link', desc: 'Insert a link', icon: '[ ]', action: () => this.insertSlashCommand('[text](url)') },
      { id: 'image', label: 'Image', desc: 'Insert an image', icon: '[img]', action: () => this.insertSlashCommand('![alt](url)') },
      { id: 'list', label: 'Bullet List', desc: 'Unordered list', icon: '-', action: () => this.insertSlashCommand('\n- ') },
      { id: 'task', label: 'Task List', desc: 'Checkbox item', icon: '[ ]', action: () => this.insertSlashCommand('\n- [ ] ') },
      { id: 'quote', label: 'Quote', desc: 'Blockquote', icon: '>', action: () => this.insertSlashCommand('\n> ') },
      { id: 'hr', label: 'Divider', desc: 'Horizontal rule', icon: '---', action: () => this.insertSlashCommand('\n---\n') },
      { id: 'table', label: 'Table', desc: 'Markdown table', icon: '| |', action: () => this.insertSlashCommand('\n| Header | Header |\n|----------|----------|\n| Cell | Cell |\n') },
      { id: 'tag', label: 'Tag', desc: 'Insert a tag', icon: '#', action: () => this.insertSlashCommand('#') },
      { id: 'wikilink', label: 'Note Link', desc: 'Link to another note', icon: '[[ ]]', action: () => this.insertSlashCommand('[[') },
    ];

    const filtered = slashCommands.filter(c => c.label.toLowerCase().includes(this._slashQuery.toLowerCase()));

    const container = this.$('slashItems');
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    filtered.slice(0, 12).forEach((cmd, i) => {
      const el = document.createElement('div');
      el.className = 'slash-item' + (i === 0 ? ' selected' : '');
      el.innerHTML = `<span class="slash-icon">${cmd.icon}</span><span class="slash-label">${cmd.label}</span><span class="slash-desc">${cmd.desc}</span>`;
      el.addEventListener('click', () => { this.hideSlashPalette(); cmd.action(); });
      el.addEventListener('mousedown', (e) => e.preventDefault());
      fragment.appendChild(el);
    });
    container.appendChild(fragment);
    palette.classList.add('visible');
  },

  hideSlashPalette() {
    this._slashOpen = false;
    this.$('slashPalette').classList.remove('visible');
  },

  showWikilinkAutocomplete(cursorPos) {
    const autocomplete = this.$('wikilinkAutocomplete');
    const textarea = this.$('editorTextarea');
    const rect = textarea.getBoundingClientRect();
    const lines = textarea.value.substring(0, cursorPos).split('\n');
    const currentLine = lines[lines.length - 1];
    const approxCharWidth = 8.4;
    const left = Math.min(currentLine.length * approxCharWidth + 32, rect.width - 300);
    const top = lines.length * 24.5 - textarea.scrollTop + 32;

    autocomplete.style.left = left + 'px';
    autocomplete.style.top = top + 'px';

    const query = CortexLib.normalizeStem(this._wikilinkQuery);
    const matches = this._notes.filter(n => CortexLib.normalizeStem(n.stem).includes(query));

    const container = this.$('wikilinkItems');
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    matches.slice(0, 8).forEach((note, i) => {
      const el = document.createElement('div');
      el.className = 'wikilink-item' + (i === 0 ? ' selected' : '');
      const name = document.createElement('span');
      name.className = 'wikilink-name';
      name.textContent = note.stem;
      const shortPath = document.createElement('span');
      shortPath.className = 'wikilink-path';
      shortPath.textContent = note.path.replace(this.vaultPath, '').replace(/\\/g, '/');
      el.append(name, shortPath);
      el.addEventListener('click', () => { this.insertWikilink(note.stem); this.hideWikilinkAutocomplete(); });
      el.addEventListener('mousedown', (e) => e.preventDefault());
      fragment.appendChild(el);
    });
    container.appendChild(fragment);
    autocomplete.classList.add('visible');
  },

  hideWikilinkAutocomplete() {
    this._wikilinkOpen = false;
    this.$('wikilinkAutocomplete').classList.remove('visible');
  },

  insertSlashCommand(text) {
    const textarea = this.$('editorTextarea');
    const cursorPos = textarea.selectionStart;
    const content = textarea.value;
    const beforeCursor = content.substring(0, cursorPos);
    const afterCursor = content.substring(cursorPos);
    const slashMatch = beforeCursor.match(/\/(\w*)$/);
    const newBefore = slashMatch ? beforeCursor.replace(/\/(\w*)$/, text) : beforeCursor + text;
    textarea.value = newBefore + afterCursor;
    textarea.selectionStart = textarea.selectionEnd = newBefore.length;
    textarea.focus();
    this.hideSlashPalette();
    this.onEditorInput(); // assigning .value fires no `input` event: tab.content, autosave and the preview must hear of it
  },

  insertWikilink(name) {
    const textarea = this.$('editorTextarea');
    const cursorPos = textarea.selectionStart;
    const content = textarea.value;
    const beforeCursor = content.substring(0, cursorPos);
    const afterCursor = content.substring(cursorPos);
    const match = beforeCursor.match(/\[\[([^\]]*)$/);
    const newBefore = match ? beforeCursor.replace(/\[\[([^\]]*)$/, `[[${name}]]`) : beforeCursor + `[[${name}]]`;
    textarea.value = newBefore + afterCursor;
    textarea.selectionStart = textarea.selectionEnd = newBefore.length;
    textarea.focus();
    this.hideWikilinkAutocomplete();
    this.onEditorInput(); // as in insertSlashCommand
  },

  // Writes the tab's text; resolves true once it is on disk. `modified` means "not yet on disk": it is cleared only after the
  // write succeeds (and only if nothing was typed meanwhile). A failure leaves it set and shows the error in the status bar.
  // Writes to one file are queued so an older write can never land after a newer one.
  saveFile(tab) {
    const write = async () => {
      const content = tab.content;
      let ok = false;
      try { // anything going wrong here (a rejected call, a reply that is not a result) is a failed save, never an exception
        const result = await window.cortex.writeFile(tab.path, content);
        ok = !!result.success;
        if (ok) {
          delete tab.saveError;
          if (tab.content === content) tab.modified = false;
        } else {
          tab.saveError = result.error || 'unknown error';
        }
      } catch (err) {
        tab.saveError = err.message;
      }
      this.updateTabStyles();
      this.updateSaveError();
      return ok;
    };
    // `write` handles its own errors, but the second `write` keeps the queue alive even if a link in it ever rejects
    tab.saving = (tab.saving || Promise.resolve()).then(write, write);
    return tab.saving;
  },

  updateSaveError() {
    const failed = this.openTabs.find(t => t.saveError);
    this.$('statusbarError').textContent = failed ? 'Save failed: ' + failed.saveError : '';
  },

  onEditorKeydown(e) {
    if (this._slashOpen) {
      const items = document.querySelectorAll('.slash-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._slashIndex = Math.min(this._slashIndex + 1, items.length - 1);
        items.forEach(i => i.classList.remove('selected'));
        if (items[this._slashIndex]) items[this._slashIndex].classList.add('selected');
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._slashIndex = Math.max(this._slashIndex - 1, 0);
        items.forEach(i => i.classList.remove('selected'));
        if (items[this._slashIndex]) items[this._slashIndex].classList.add('selected');
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (items[this._slashIndex]) items[this._slashIndex].click();
        return;
      }
    }

    if (this._wikilinkOpen) {
      const items = document.querySelectorAll('.wikilink-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._wikilinkIndex = Math.min(this._wikilinkIndex + 1, items.length - 1);
        items.forEach(i => i.classList.remove('selected'));
        if (items[this._wikilinkIndex]) items[this._wikilinkIndex].classList.add('selected');
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._wikilinkIndex = Math.max(this._wikilinkIndex - 1, 0);
        items.forEach(i => i.classList.remove('selected'));
        if (items[this._wikilinkIndex]) items[this._wikilinkIndex].classList.add('selected');
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (items[this._wikilinkIndex]) items[this._wikilinkIndex].click();
        return;
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.target;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      this.onEditorInput(); // as in insertSlashCommand
    }
  },

  onGlobalKeydown(e) {
    if (e.ctrlKey && e.key === 'p') { e.preventDefault(); this.openCommandPalette(); }
    if (e.ctrlKey && e.key === 'n') { e.preventDefault(); this.createFile(); }
    if (e.ctrlKey && e.shiftKey && e.key === 'F') { e.preventDefault(); this.togglePanel('search'); }
    if (e.ctrlKey && e.key === 'g') { e.preventDefault(); this.togglePanel('graph'); }
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      const tab = this.openTabs.find(t => t.path === this.activeTab);
      if (tab) this.flushTab(tab);
    }
    if (e.ctrlKey && e.key === 'w') { e.preventDefault(); if (this.activeTab) this.closeTab(this.activeTab); }
    if (e.key === 'F11') { e.preventDefault(); this.toggleFocusMode(); }
    if (e.key === 'Escape') {
      this.closeCommandPalette();
      this.hideContextMenu();
      this.hidePluginPanels();
      this.hideSlashPalette();
      this.hideWikilinkAutocomplete();
    }
  },

  onTabClick(e) {
    const closeBtn = e.target.closest('.tab-close');
    if (closeBtn) { e.stopPropagation(); this.closeTab(closeBtn.closest('.editor-tab').dataset.path); return; }
    const tab = e.target.closest('.editor-tab');
    if (tab) this.switchTab(tab.dataset.path);
  },

  // ---- Preview ----

  updatePreview(markdown) {
    this.$('previewContent').innerHTML = this.parseMarkdown(markdown || '');
  },

  togglePreview() {
    this.$('previewPane').classList.toggle('visible');
  },

  parseMarkdown(md) {
    if (!md) return '';
    let html = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Wikilinks
    html = html.replace(/\[\[([^\]]+)\]\]/g, '<a href="#" class="wikilink" data-note="$1">$1</a>');

    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/___(.*?)___/g, '<strong><em>$1</em></strong>');
    html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
    html = html.replace(/_(.*?)_/g, '<em>$1</em>');
    html = html.replace(/~~(.*?)~~/g, '<del>$1</del>');
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;margin:1em 0;">');
    html = html.replace(/^&gt; (.*$)/gim, '<blockquote>$1</blockquote>');
    html = html.replace(/^---$/gim, '<hr>');
    html = html.replace(/^\d+\. (.*$)/gim, '<li>$1</li>');
    html = html.replace(/^[\-\*] (.*$)/gim, '<li>$1</li>');
    html = html.replace(/^\[ \] (.*$)/gim, '<div class="task-list-item"><input type="checkbox" disabled> $1</div>');
    html = html.replace(/^\[x\] (.*$)/gim, '<div class="task-list-item"><input type="checkbox" disabled checked> $1</div>');

    html = html.replace(/\|(.+)\|/g, (match) => {
      const cells = match.split('|').filter(c => c.trim());
      if (cells.every(c => c.trim().match(/^[\-:]+$/))) return '';
      return '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>';
    });

    html = html.replace(/^(?!<[a-z/])(.*\S.*)$/gim, '<p>$1</p>');
    html = html.replace(/\n{3,}/g, '\n\n');
    return html;
  },

  // ---- Status Bar ----

  updateStatusBar(content) {
    const words = content ? content.trim().split(/\s+/).length : 0;
    const chars = content ? content.length : 0;
    const readingTime = Math.max(1, Math.round(words / 200));

    this.$('statusbarWords').textContent = words + ' words';
    this.$('statusbarChars').textContent = chars + ' chars';
    this.$('statusbarReadingTime').textContent = readingTime + ' min read';

    const textarea = this.$('editorTextarea');
    const pos = textarea.selectionStart;
    const lines = textarea.value.substring(0, pos).split('\n');
    this.$('statusbarCursor').textContent = 'Ln ' + lines.length + ', Col ' + (lines[lines.length - 1].length + 1);
  },

  updateCursorPosition() {
    const textarea = this.$('editorTextarea');
    const pos = textarea.selectionStart;
    const lines = textarea.value.substring(0, pos).split('\n');
    this.$('statusbarCursor').textContent = 'Ln ' + lines.length + ', Col ' + (lines[lines.length - 1].length + 1);
  },

  // ---- Panels ----

  togglePanel(panel) {
    if (this.sidebarPanel === panel) {
      this.$('sidePanel').classList.add('collapsed');
      this.sidebarPanel = null;
      document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
      this.hideGraphView();
    } else {
      this.$('sidePanel').classList.remove('collapsed');
      this.sidebarPanel = panel;
      document.querySelectorAll('.activity-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.panel === panel);
      });
      this.updatePanelContent(panel);
    }
  },

  updatePanelContent(panel) {
    const header = this.$('sidePanelHeader');
    const tree = this.$('fileTree');
    const titles = { fileExplorer: 'File Explorer', search: 'Search', graph: 'Graph View', backlinks: 'Backlinks', tags: 'Tags', starred: 'Starred' };
    header.querySelector('span').textContent = titles[panel] || panel;
    if (panel !== 'graph') this.hideGraphView(); // the editor and preview come back

    if (panel === 'fileExplorer') {
      tree.style.display = '';
      this.renderFileTree();
    } else if (panel === 'search') {
      tree.style.display = '';
      this.renderSearchPanel(tree);
    } else if (panel === 'graph') {
      tree.style.display = 'none';
      this.showGraphView();
    } else if (panel === 'backlinks') {
      tree.style.display = '';
      this.renderBacklinks(tree);
    } else if (panel === 'tags') {
      tree.style.display = '';
      this.renderTagsPanel(tree);
    } else if (panel === 'starred') {
      tree.style.display = '';
      this.renderStarredPanel(tree);
    }
  },

  renderSearchPanel(container) {
    container.innerHTML = '<div style="padding:12px;"><input type="text" id="searchInput" placeholder="Search notes..." style="width:100%;padding:8px 12px;background:var(--bg-3);border:1px solid var(--border-1);border-radius:6px;color:var(--text-0);font-size:13px;"><div id="searchResults" style="margin-top:12px;"></div></div>';
    container.querySelector('#searchInput').addEventListener('input', () => this.debounce('search', () => this.runSearch(), 300));
  },

  // Runs the search box's query against the index; only the newest query may fill the results.
  async runSearch() {
    const input = document.getElementById('searchInput'); // not this.$: the panel recreates these on every render
    const list = document.getElementById('searchResults');
    if (!input || !list) return;
    if (this._searchAbort) this._searchAbort.abort();
    const { signal } = this._searchAbort = new AbortController();
    const query = input.value.trim();
    if (query.length < 2) { list.replaceChildren(); return; }
    const results = await window.cortex.index.search(query, 50);
    if (signal.aborted) return;
    list.replaceChildren(...(results.length
      ? results.map(r => this.panelRow(r.stem, r.snippet, () => { this.hideWelcome(); this.openFile(r.path); }))
      : [this.panelNote('No results found.')]));
  },

  // A clickable panel row: a note's stem with a line of its text under it. User text, so textContent only.
  panelRow(title, detail, onClick) {
    const el = document.createElement('div');
    el.className = 'file-tree-item panel-row';
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = title;
    el.append(name);
    if (detail) {
      const line = document.createElement('span');
      line.className = 'panel-row-detail';
      line.textContent = detail;
      el.append(line);
    }
    el.addEventListener('click', onClick);
    return el;
  },

  panelNote(text) {
    const el = document.createElement('div');
    el.className = 'panel-note';
    el.textContent = text;
    return el;
  },

  // Each tag expands to its notes; tags left open stay open when the index refreshes the panel.
  renderTagsPanel(container) {
    if (this._tags.length === 0) { container.replaceChildren(this.panelNote('No tags found. Add #tags to your notes.')); return; }
    const open = new Set([...container.querySelectorAll('.tag-item.expanded')].map(el => el.dataset.tag));
    const fragment = document.createDocumentFragment();
    this._tags.forEach(t => {
      const el = document.createElement('div');
      el.className = 'file-tree-item tag-item';
      el.dataset.tag = t.tag;
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = '#' + t.tag + ' (' + t.count + ')';
      el.append(name);
      const notes = document.createElement('div');
      notes.className = 'folder-children';
      notes.append(...t.paths.map(p => {
        const row = this.panelRow(p.split(/[\\/]/).pop().replace(/\.md$/i, ''), null, () => { this.hideWelcome(); this.openFile(p); });
        row.classList.add('tag-note');
        return row;
      }));
      const expanded = open.has(t.tag);
      el.classList.toggle('expanded', expanded);
      notes.hidden = !expanded;
      el.addEventListener('click', () => { notes.hidden = !el.classList.toggle('expanded'); });
      fragment.append(el, notes);
    });
    container.replaceChildren(fragment);
  },

  renderStarredPanel(container) {
    container.innerHTML = '';
    const starredFiles = Array.from(this._starredNotes);
    if (starredFiles.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No starred notes. Star a note to pin it here.</p></div>';
      return;
    }
    const fragment = document.createDocumentFragment();
    starredFiles.forEach(filePath => {
      const el = document.createElement('div');
      el.className = 'file-tree-item';
      const name = filePath.split(/[\\/]/).pop();
      el.innerHTML = '<span class="file-name">' + name + '</span>';
      el.addEventListener('click', () => { this.hideWelcome(); this.openFile(filePath); });
      fragment.appendChild(el);
    });
    container.appendChild(fragment);
  },

  // The notes linking to the active one, each with the line that links. Pass the tab path as is: the index resolves it.
  async renderBacklinks(container) {
    const tab = this.activeTab;
    if (!tab) { container.replaceChildren(this.panelNote('Select a note to see backlinks.')); return; }
    const links = await window.cortex.index.backlinks(tab);
    if (this.sidebarPanel !== 'backlinks' || this.activeTab !== tab) return; // the user moved on while we asked
    if (!links.length) { container.replaceChildren(this.panelNote('No backlinks found.')); return; }
    const header = this.panelNote(links.length + (links.length === 1 ? ' backlink' : ' backlinks'));
    header.classList.add('panel-heading');
    container.replaceChildren(header, ...links.map(b => this.panelRow(b.stem, b.text.trim(), () => { this.hideWelcome(); this.openFile(b.path); })));
  },

  // ---- Graph View ----

  showGraphView() {
    this.$('graphView').classList.add('visible');
    this.$('editorPane').style.display = 'none';
    this.$('previewPane').style.display = 'none';
    this.initGraph();
  },

  hideGraphView() {
    this.$('graphView').classList.remove('visible');
    this.$('editorPane').style.display = '';
    this.$('previewPane').style.display = '';
    if (this._graphCleanup) { this._graphCleanup.abort(); this._graphCleanup = null; }
  },

  // Lays the graph out afresh. Aborting _graphCleanup stops its animation loop and removes its click handler, so a re-open,
  // Refresh, resize or index update never leaves a second loop or handler behind.
  async initGraph() {
    if (this._graphCleanup) this._graphCleanup.abort();
    const { signal } = this._graphCleanup = new AbortController();
    const graph = await window.cortex.index.graph();
    if (signal.aborted) return; // hidden or restarted while we waited

    const canvas = this.$('graphCanvas');
    const ctx = canvas.getContext('2d');
    const container = this.$('graphView');
    const width = canvas.width = container.clientWidth;
    const height = canvas.height = container.clientHeight;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.35;

    const nodes = graph.nodes.map((n, i) => {
      const angle = (i / graph.nodes.length) * Math.PI * 2;
      return { path: n.id, label: n.label, x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius, vx: 0, vy: 0 };
    });
    const byPath = new Map(nodes.map(n => [n.path, n]));
    const edges = graph.edges.map(e => [byPath.get(e.source), byPath.get(e.target)]).filter(([s, t]) => s && t);

    // One step of the forces; returns the fastest node's speed
    const simulate = () => {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 800 / (dist * dist);
          nodes[i].vx -= (dx / dist) * force;
          nodes[i].vy -= (dy / dist) * force;
          nodes[j].vx += (dx / dist) * force;
          nodes[j].vy += (dy / dist) * force;
        }
      }
      edges.forEach(([node, target]) => {
        const dx = target.x - node.x;
        const dy = target.y - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 120) * 0.01;
        node.vx += (dx / dist) * force;
        node.vy += (dy / dist) * force;
        target.vx -= (dx / dist) * force;
        target.vy -= (dy / dist) * force;
      });
      let max = 0;
      nodes.forEach(node => {
        node.vx += (centerX - node.x) * 0.001;
        node.vy += (centerY - node.y) * 0.001;
        node.vx *= 0.85;
        node.vy *= 0.85;
        node.x += node.vx;
        node.y += node.vy;
        max = Math.max(max, Math.hypot(node.vx, node.vy));
      });
      return max;
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(232, 168, 76, 0.2)';
      ctx.lineWidth = 1;
      edges.forEach(([node, target]) => {
        ctx.beginPath();
        ctx.moveTo(node.x, node.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      });
      nodes.forEach(node => {
        const isActive = this.normPath(node.path).toUpperCase() === (this.activeTab || '').toUpperCase();
        ctx.beginPath();
        ctx.arc(node.x, node.y, isActive ? 8 : 5, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? '#e8a84c' : '#8f8a7e';
        ctx.fill();
        ctx.fillStyle = isActive ? '#e8a84c' : '#8f8a7e';
        ctx.font = (isActive ? '600 ' : '') + '11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(node.label, node.x, node.y - 12);
      });
      ctx.fillStyle = '#5c584f';
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(nodes.length + ' nodes', 16, 24);
    };

    const animate = () => {
      if (signal.aborted) return;
      const speed = simulate();
      draw();
      if (speed >= 0.05) requestAnimationFrame(animate); // settled: Refresh, a resize or an index update starts it again
    };
    animate();

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = nodes.find(node => Math.hypot(node.x - x, node.y - y) < 12);
      if (hit) {
        this.openFile(hit.path);
        this.hideGraphView();
      }
    }, { signal });
  },

  // ---- Command Palette ----

  openCommandPalette() {
    this.$('commandPaletteOverlay').classList.add('visible');
    this.$('commandInput').value = '';
    this.$('commandInput').focus();
    this.renderCommandResults('');
  },

  closeCommandPalette() {
    this.$('commandPaletteOverlay').classList.remove('visible');
  },

  renderCommandResults(query) {
    const container = this.$('commandResults');
    container.innerHTML = '';

    const allCommands = [
      ...this.commands,
      ...this.openTabs.map(t => ({
        name: 'Open: ' + t.name,
        icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 2H8L11 5V12H4V2Z" stroke="currentColor" stroke-width="1"/></svg>',
        action: () => this.switchTab(t.path),
      })),
    ];

    const filtered = allCommands.filter(c => c.name.toLowerCase().includes(query.toLowerCase()));

    const fragment = document.createDocumentFragment();
    filtered.slice(0, 20).forEach((cmd, i) => {
      const el = document.createElement('div');
      el.className = 'command-result-item' + (i === 0 ? ' selected' : '');
      el.innerHTML = `<span class="cmd-icon">${cmd.icon || ''}</span><span class="cmd-label">${cmd.name}</span><span class="cmd-shortcut">${cmd.shortcut || ''}</span>`;
      el.addEventListener('click', () => { cmd.action(); this.closeCommandPalette(); });
      fragment.appendChild(el);
    });
    container.appendChild(fragment);

    if (filtered.length === 0) {
      container.innerHTML = '<div style="padding:16px;color:var(--text-3);font-size:13px;text-align:center;">No results found</div>';
    }
  },

  registerCoreCommands() {
    this.commands = [
      { name: 'New File', shortcut: 'Ctrl+N', icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.5"/></svg>', action: () => this.createFile() },
      { name: 'Toggle Preview', shortcut: 'Ctrl+E', icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4H12M2 7H12M2 10H8" stroke="currentColor" stroke-width="1"/></svg>', action: () => this.togglePreview() },
      { name: 'Toggle Graph View', shortcut: 'Ctrl+G', icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="4" cy="7" r="2" stroke="currentColor" stroke-width="1"/><circle cx="10" cy="3" r="2" stroke="currentColor" stroke-width="1"/><circle cx="10" cy="11" r="2" stroke="currentColor" stroke-width="1"/><path d="M6 7L8 3M6 7L8 11" stroke="currentColor" stroke-width="1"/></svg>', action: () => this.togglePanel('graph') },
      { name: 'Open Search', shortcut: 'Ctrl+Shift+F', icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1"/><path d="M9.5 9.5L12 12" stroke="currentColor" stroke-width="1"/></svg>', action: () => this.togglePanel('search') },
      { name: 'Focus Mode', shortcut: 'F11', icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1"/></svg>', action: () => this.toggleFocusMode() },
      { name: 'Cycle Layout', icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="2" width="4" height="10" rx="1" stroke="currentColor" stroke-width="1"/><rect x="8" y="2" width="4" height="10" rx="1" stroke="currentColor" stroke-width="1"/></svg>', action: () => this.cycleLayout() },
      { name: 'Open TaskFlow', icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4H12M2 7H12M2 10H8" stroke="currentColor" stroke-width="1"/></svg>', action: () => this.openPlugin('taskflow') },
      { name: 'Open DailySync', icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="3" width="10" height="9" stroke="currentColor" stroke-width="1"/><path d="M2 6H12" stroke="currentColor" stroke-width="1"/></svg>', action: () => this.openPlugin('dailysync') },
      { name: 'Open Recall', icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="2" width="8" height="10" rx="1" stroke="currentColor" stroke-width="1"/><path d="M5 5H9M5 7.5H9" stroke="currentColor" stroke-width="1"/></svg>', action: () => this.openPlugin('recall') },
      { name: 'Open DataForge', icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="2" width="10" height="10" rx="1" stroke="currentColor" stroke-width="1"/><path d="M2 5H12M5 5V12" stroke="currentColor" stroke-width="1"/></svg>', action: () => this.openPlugin('dataforge') },
      { name: 'Open FocusPulse', icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1"/><path d="M7 4V7L9 8" stroke="currentColor" stroke-width="1"/></svg>', action: () => this.openPlugin('focuspulse') },
    ];
  },

  // ---- Context Menu ----

  onContextMenu(e) {
    if (!e.target.closest('.file-tree-item')) return;
    e.preventDefault();
    const menu = this.$('contextMenu');
    const item = e.target.closest('.file-tree-item');
    const filePath = item.dataset.path;

    menu.innerHTML = `
      <div class="context-menu-item" data-action="open"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2H6L8 4V10H2V2Z" stroke="currentColor" stroke-width="1"/></svg>Open</div>
      <div class="context-menu-item" data-action="star"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1L7.5 4.5L11 5L8.5 7.5L9 11L6 9.5L3 11L3.5 7.5L1 5L4.5 4.5L6 1Z" stroke="currentColor" stroke-width="1"/></svg>Star</div>
      <div class="context-menu-sep"></div>
      <div class="context-menu-item" data-action="rename"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 10H10" stroke="currentColor" stroke-width="1"/></svg>Rename</div>
      <div class="context-menu-item danger" data-action="delete"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3H10M4 3V2H8V3M3 3L4 10H8L9 3" stroke="currentColor" stroke-width="1"/></svg>Delete</div>
    `;
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.add('visible');

    menu.onclick = (ev) => {
      const action = ev.target.closest('.context-menu-item')?.dataset.action;
      if (action === 'open') { this.hideWelcome(); this.openFile(filePath); }
      if (action === 'star') this.toggleStar(filePath);
      if (action === 'rename') this.renameFile(filePath);
      if (action === 'delete') this.deleteFile(filePath);
    };
  },

  hideContextMenu() {
    this.$('contextMenu').classList.remove('visible');
  },

  // ---- Plugin System ----

  async loadPlugins() {
    const pluginGlobals = ['TaskFlowPlugin', 'DailySyncPlugin', 'RecallPlugin', 'DataForgePlugin', 'FocusPulsePlugin'];
    for (const globalName of pluginGlobals) {
      try {
        const PluginClass = window[globalName];
        if (PluginClass) {
          const instance = new PluginClass();
          instance.app = this;
          this.plugins.push(instance);
          if (instance.init) await instance.init();
        }
      } catch (e) { console.warn('Failed to load plugin:', globalName, e); }
    }

    const cmdInput = this.$('commandInput');
    if (cmdInput) {
      cmdInput.addEventListener('input', (e) => this.renderCommandResults(e.target.value));
      cmdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const selected = document.querySelector('.command-result-item.selected');
          if (selected) selected.click();
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const items = document.querySelectorAll('.command-result-item');
          const current = document.querySelector('.command-result-item.selected');
          let idx = Array.from(items).indexOf(current);
          if (e.key === 'ArrowDown') idx = Math.min(idx + 1, items.length - 1);
          else idx = Math.max(idx - 1, 0);
          items.forEach(i => i.classList.remove('selected'));
          if (items[idx]) items[idx].classList.add('selected');
        }
      });
    }
  },

  openPlugin(name) {
    const plugin = this.plugins.find(p => p.name === name);
    if (plugin && plugin.open) plugin.open();
  },

  hidePluginPanels() {
    document.querySelectorAll('.plugin-panel').forEach(p => p.classList.remove('visible'));
    this.plugins.forEach(p => { if (p.close) p.close(); });
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
