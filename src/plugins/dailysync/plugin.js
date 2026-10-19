// ============================================
// CORTEX Plugin: DailySync — Daily Notes & Calendar (Optimized)
// ============================================

class DailySyncPlugin {
  name = 'dailysync';
  app = null;
  panelEl = null;
  currentDate = new Date();

  async init() {}

  open() { this.renderPanel(); }

  close() { if (this.panelEl) this.panelEl.classList.remove('visible'); }

  renderPanel() {
    this.close();
    const root = document.getElementById('plugin-root');
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const panel = document.createElement('div');
    panel.className = 'plugin-panel visible';
    panel.id = 'plugin-dailysync';
    panel.innerHTML = `
      <div class="plugin-panel-header">
        <span class="plugin-panel-title">DailySync — ${dateStr}</span>
        <div style="display:flex;gap:8px;">
          <button class="icon-btn" id="dsNewNote" title="New Daily Note"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.5"/></svg></button>
          <button class="icon-btn" id="dsOpenToday" title="Open Today's Note"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4C2 3.44772 2.44772 3 3 3H5L6 4H11C11.5523 4 12 4.44772 12 5V10C12 10.5523 11.5523 11 11 11H3C2.44772 11 2 10.5523 2 10V4Z" fill="currentColor"/></svg></button>
          <button class="icon-btn" id="dsClose" title="Close"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" stroke-width="1.5"/></svg></button>
        </div>
      </div>
      <div class="plugin-panel-body">
        <div style="display:grid;grid-template-columns:1fr 300px;gap:20px;">
          <div>
            <h3 style="font-family:var(--font-display);font-size:18px;margin-bottom:12px;">Today's Journal</h3>
            <textarea id="dsJournal" style="width:100%;min-height:300px;padding:16px;background:var(--bg-2);border:1px solid var(--border-1);border-radius:8px;color:var(--text-0);font-family:var(--font-mono);font-size:13px;line-height:1.7;resize:vertical;" placeholder="What's on your mind today?...">${this.getTodayNote()}</textarea>
            <div style="margin-top:8px;display:flex;gap:8px;">
              <button id="dsSave" style="padding:6px 16px;background:var(--accent-dim);border:1px solid var(--accent-0);border-radius:6px;color:var(--accent-0);cursor:pointer;font-size:12px;">Save Note</button>
              <button id="dsCreateNote" style="padding:6px 16px;background:var(--bg-3);border:1px solid var(--border-1);border-radius:6px;color:var(--text-1);cursor:pointer;font-size:12px;">Create as Note</button>
            </div>
          </div>
          <div>
            <h3 style="font-family:var(--font-display);font-size:14px;margin-bottom:12px;color:var(--text-2);">October 2026</h3>
            <div id="dsCalendar" style="background:var(--bg-2);border:1px solid var(--border-1);border-radius:8px;padding:12px;"></div>
            <h3 style="font-family:var(--font-display);font-size:14px;margin:16px 0 8px;color:var(--text-2);">Habits</h3>
            <div style="background:var(--bg-2);border:1px solid var(--border-1);border-radius:8px;padding:12px;">
              ${this.renderHabits()}
            </div>
          </div>
        </div>
      </div>
    `;

    root.appendChild(panel);
    this.panelEl = panel;
    this.renderCalendar();

    panel.querySelector('#dsClose').addEventListener('click', () => this.close());
    panel.querySelector('#dsSave').addEventListener('click', () => this.saveNote());
    panel.querySelector('#dsCreateNote').addEventListener('click', () => this.createNote());
    panel.querySelector('#dsNewNote').addEventListener('click', () => {
      panel.querySelector('#dsJournal').value = '';
      panel.querySelector('#dsJournal').focus();
    });
    panel.querySelector('#dsOpenToday').addEventListener('click', () => this.openTodayNote());
  }

  renderCalendar() {
    const cal = document.getElementById('dsCalendar');
    if (!cal) return;
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date().getDate();
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    let html = `<div style="text-align:center;font-weight:600;margin-bottom:8px;font-size:13px;">${monthNames[month]} ${year}</div>`;
    html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;font-size:10px;text-align:center;color:var(--text-3);margin-bottom:4px;">';
    ['S','M','T','W','T','F','S'].forEach(d => html += `<div>${d}</div>`);
    html += '</div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;">';

    for (let i = 0; i < firstDay; i++) html += '<div></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = d === today;
      html += `<div style="text-align:center;padding:4px 0;border-radius:4px;font-size:11px;${isToday ? 'background:var(--accent-0);color:var(--bg-0);font-weight:600;' : 'color:var(--text-1);'}">${d}</div>`;
    }
    html += '</div>';
    cal.innerHTML = html;
  }

  renderHabits() {
    const habits = JSON.parse(localStorage.getItem('cortex_habits') || '[]');
    if (habits.length === 0) return '<div style="color:var(--text-3);font-size:12px;">No habits tracked yet.</div>';
    const today = CortexLib.localDateStr();
    return habits.map(h => {
      const done = h.completed && h.completed.includes(today);
      return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
        <input type="checkbox" ${done ? 'checked' : ''} data-habit="${h.id}" style="accent-color:var(--accent-0);">
        <span style="font-size:12px;${done ? 'text-decoration:line-through;color:var(--text-3);' : ''}">${h.name}</span>
      </div>`;
    }).join('');
  }

  getTodayNote() {
    const today = CortexLib.localDateStr();
    return localStorage.getItem('cortex_daily_' + today) || '';
  }

  saveNote() {
    const today = CortexLib.localDateStr();
    const content = document.getElementById('dsJournal').value;
    localStorage.setItem('cortex_daily_' + today, content);
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:40px;right:20px;padding:8px 16px;background:var(--success);color:var(--bg-0);border-radius:6px;font-size:12px;z-index:9999;animation:fadeIn 200ms;';
    toast.textContent = 'Note saved';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  async createNote() {
    const today = CortexLib.localDateStr();
    const content = document.getElementById('dsJournal').value;
    const notePath = this.app.vaultPath + '/Daily Notes/' + today + '.md';
    // overwrite:false: if today's note already exists it is opened as-is, never replaced by the journal text (which stays in the textarea)
    const result = await window.cortex.writeFile(notePath, '# ' + today + '\n\n' + content, { overwrite: false });
    if (!result.success && !result.exists) { alert('Could not create the note: ' + result.error); return; }
    await this.app.openFile(notePath);
    this.close();
  }

  async openTodayNote() {
    await this.app.openDailyNote();
    this.close();
  }
}

window.DailySyncPlugin = DailySyncPlugin;
