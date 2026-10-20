// ============================================
// CORTEX Plugin: DataForge — Queries & Templates (Optimized)
// ============================================

class DataForgePlugin {
  name = 'dataforge';
  app = null;
  panelEl = null;
  _searchDebounce = null;

  async init() {}

  open() { this.renderPanel(); }

  close() { if (this.panelEl) this.panelEl.classList.remove('visible'); }

  renderPanel() {
    this.close();
    const root = document.getElementById('plugin-root');

    const panel = document.createElement('div');
    panel.className = 'plugin-panel visible';
    panel.id = 'plugin-dataforge';
    panel.innerHTML = `
      <div class="plugin-panel-header">
        <span class="plugin-panel-title">DataForge — Queries & Templates</span>
        <div style="display:flex;gap:8px;">
          <button class="icon-btn" id="dfRunQuery" title="Run Query"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 2L12 7L4 12V2Z" fill="currentColor"/></svg></button>
          <button class="icon-btn" id="dfClose" title="Close"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" stroke-width="1.5"/></svg></button>
        </div>
      </div>
      <div class="plugin-panel-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
          <div>
            <h3 style="font-family:var(--font-display);font-size:14px;margin-bottom:8px;color:var(--text-2);">Query Editor</h3>
            <textarea id="dfQuery" style="width:100%;min-height:120px;padding:12px;background:var(--bg-2);border:1px solid var(--border-1);border-radius:8px;color:var(--text-0);font-family:var(--font-mono);font-size:12px;line-height:1.6;resize:vertical;" placeholder="e.g. tag:project status:active"># Sample queries:
# tag:project
# status:active
# created:today
# All notes containing 'meeting'">tag:project</textarea>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
              <button class="df-preset" data-q="tag:project" style="padding:4px 10px;background:var(--bg-3);border:1px solid var(--border-1);border-radius:4px;color:var(--text-2);cursor:pointer;font-size:11px;">tag:project</button>
              <button class="df-preset" data-q="status:active" style="padding:4px 10px;background:var(--bg-3);border:1px solid var(--border-1);border-radius:4px;color:var(--text-2);cursor:pointer;font-size:11px;">status:active</button>
              <button class="df-preset" data-q="created:today" style="padding:4px 10px;background:var(--bg-3);border:1px solid var(--border-1);border-radius:4px;color:var(--text-2);cursor:pointer;font-size:11px;">created:today</button>
            </div>
            <h3 style="font-family:var(--font-display);font-size:14px;margin:20px 0 8px;color:var(--text-2);">Templates</h3>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${this.renderTemplate('Meeting Notes', '# {{date}}\n\n## Attendees\n- \n\n## Agenda\n- \n\n## Notes\n\n## Action Items\n- [] ')}
              ${this.renderTemplate('Project Brief', '# {{title}}\n\n## Overview\n\n## Goals\n- \n\n## Timeline\n\n## Resources\n\n## Notes')}
              ${this.renderTemplate('Daily Standup', '# {{date}} Standup\n\n## Yesterday\n- \n\n## Today\n- \n\n## Blockers\n- ')}
              ${this.renderTemplate('Book Notes', '# {{title}}\n\n**Author:** \n**Date Started:** {{date}}\n\n## Summary\n\n## Key Ideas\n\n## Quotes\n\n## Notes')}
            </div>
          </div>
          <div>
            <h3 style="font-family:var(--font-display);font-size:14px;margin-bottom:8px;color:var(--text-2);">Results</h3>
            <div id="dfResults" style="background:var(--bg-2);border:1px solid var(--border-1);border-radius:8px;padding:12px;min-height:200px;font-size:13px;color:var(--text-2);">
              Run a query to see results...
            </div>
            <h3 style="font-family:var(--font-display);font-size:14px;margin:20px 0 8px;color:var(--text-2);">Quick Stats</h3>
            <div style="background:var(--bg-2);border:1px solid var(--border-1);border-radius:8px;padding:12px;">
              <div id="dfStats" style="font-size:12px;color:var(--text-2);">Loading...</div>
            </div>
          </div>
        </div>
      </div>
    `;

    root.appendChild(panel);
    this.panelEl = panel;

    panel.querySelector('#dfClose').addEventListener('click', () => this.close());
    panel.querySelector('#dfRunQuery').addEventListener('click', () => this.runQuery());
    panel.querySelectorAll('.df-preset').forEach(btn => {
      btn.addEventListener('click', () => { panel.querySelector('#dfQuery').value = btn.dataset.q; this.runQuery(); });
    });

    this.updateStats();
  }

  renderTemplate(name, content) {
    return `
      <div style="background:var(--bg-2);border:1px solid var(--border-1);border-radius:8px;padding:12px;">
        <div style="font-size:13px;font-weight:500;margin-bottom:4px;">${name}</div>
        <div style="font-size:11px;color:var(--text-2);margin-bottom:8px;">${content.split('\n').slice(0, 2).join(' / ')}</div>
        <button class="df-insert" data-name="${name}" data-content="${encodeURIComponent(content)}" style="padding:4px 10px;background:var(--accent-dim);border:1px solid var(--accent-0);border-radius:4px;color:var(--accent-0);cursor:pointer;font-size:11px;">Insert Template</button>
      </div>
    `;
  }

  async runQuery() {
    // this panel's own elements: every open appends a new panel, and the old hidden ones keep the same ids
    const query = this.panelEl.querySelector('#dfQuery').value;
    const resultsEl = this.panelEl.querySelector('#dfResults');
    resultsEl.textContent = 'Searching...';

    const results = await window.cortex.index.search(query.replace(/^(tag:|status:|created:)/, ''), 50);
    resultsEl.innerHTML = '';

    if (results.length > 0) {
      const fragment = document.createDocumentFragment();
      results.forEach(r => {
        const el = document.createElement('div');
        el.className = 'file-tree-item';
        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = r.stem;
        el.append(name);
        el.addEventListener('click', () => { this.app.openFile(r.path); this.close(); });
        fragment.appendChild(el);
      });
      resultsEl.appendChild(fragment);
    } else {
      resultsEl.innerHTML = '<div style="color:var(--text-3);text-align:center;padding:20px;">No results found</div>';
    }
  }

  // From the app's copy of the vault index (refreshed on every index update)
  updateStats() {
    const statsEl = this.panelEl.querySelector('#dfStats');
    statsEl.replaceChildren(...[['Total Notes', this.app._notes.length], ['Total Tags', this.app._tags.length]].map(([label, count]) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:4px;';
      const value = document.createElement('span');
      value.style.cssText = 'font-weight:600;color:var(--text-0);';
      value.textContent = count;
      row.append(label, value);
      return row;
    }));
  }
}

window.DataForgePlugin = DataForgePlugin;
