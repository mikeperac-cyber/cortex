// ============================================
// CORTEX Plugin: FocusPulse — Pomodoro Timer (Optimized)
// ============================================

class FocusPulsePlugin {
  name = 'focuspulse';
  app = null;
  panelEl = null;
  timer = null;
  timeLeft = 25 * 60;
  isRunning = false;
  mode = 'focus';
  sessions = 0;

  async init() { this.loadStats(); }

  loadStats() {
    const stored = localStorage.getItem('cortex_focus_stats');
    if (stored) { const stats = JSON.parse(stored); this.sessions = stats.sessions || 0; }
  }

  saveStats() { localStorage.setItem('cortex_focus_stats', JSON.stringify({ sessions: this.sessions, lastSession: new Date().toISOString() })); }

  open() { this.renderPanel(); }

  close() { this.panelEl?.remove(); this.panelEl = null; this.stopTimer(); }

  renderPanel() {
    this.close();
    const root = document.getElementById('plugin-root');

    const panel = document.createElement('div');
    panel.className = 'plugin-panel visible';
    panel.id = 'plugin-focuspulse';
    panel.innerHTML = `
      <div class="plugin-panel-header">
        <span class="plugin-panel-title">FocusPulse — Pomodoro Timer</span>
        <div style="display:flex;gap:8px;">
          <button class="icon-btn" id="fpClose" title="Close"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" stroke-width="1.5"/></svg></button>
        </div>
      </div>
      <div class="plugin-panel-body" style="display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <div style="display:flex;gap:8px;margin-bottom:24px;">
          <button class="fp-mode-btn active" data-mode="focus" style="padding:6px 16px;background:var(--accent-dim);border:1px solid var(--accent-0);border-radius:6px;color:var(--accent-0);cursor:pointer;font-size:12px;">Focus</button>
          <button class="fp-mode-btn" data-mode="shortBreak" style="padding:6px 16px;background:var(--bg-3);border:1px solid var(--border-1);border-radius:6px;color:var(--text-2);cursor:pointer;font-size:12px;">Short Break</button>
          <button class="fp-mode-btn" data-mode="longBreak" style="padding:6px 16px;background:var(--bg-3);border:1px solid var(--border-1);border-radius:6px;color:var(--text-2);cursor:pointer;font-size:12px;">Long Break</button>
        </div>
        <div id="fpTimer" style="font-family:var(--font-display);font-size:72px;font-weight:300;color:var(--text-0);margin-bottom:8px;font-variant-numeric:tabular-nums;">25:00</div>
        <div id="fpStatus" style="font-size:13px;color:var(--text-2);margin-bottom:24px;">Ready to focus</div>
        <div style="display:flex;gap:12px;">
          <button id="fpStart" style="padding:12px 32px;background:var(--accent-0);border:none;border-radius:8px;color:var(--bg-0);cursor:pointer;font-size:14px;font-weight:600;">Start</button>
          <button id="fpReset" style="padding:12px 24px;background:var(--bg-3);border:1px solid var(--border-1);border-radius:8px;color:var(--text-1);cursor:pointer;font-size:14px;">Reset</button>
        </div>
        <div style="margin-top:32px;display:flex;gap:24px;">
          <div style="text-align:center;">
            <div style="font-size:24px;font-weight:700;font-family:var(--font-display);color:var(--accent-0);">${this.sessions}</div>
            <div style="font-size:11px;color:var(--text-2);">Sessions Today</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:24px;font-weight:700;font-family:var(--font-display);color:var(--text-0);">${this.sessions * 25}</div>
            <div style="font-size:11px;color:var(--text-2);">Minutes Focused</div>
          </div>
        </div>
        <div style="margin-top:24px;width:100%;max-width:400px;">
          <div style="font-size:11px;color:var(--text-2);margin-bottom:4px;">Daily Goal: 8 sessions</div>
          <div style="height:6px;background:var(--bg-3);border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${Math.min((this.sessions / 8) * 100, 100)}%;background:var(--accent-0);border-radius:3px;transition:width 300ms;"></div>
          </div>
        </div>
      </div>
    `;

    root.appendChild(panel);
    this.panelEl = panel;

    panel.querySelector('#fpClose').addEventListener('click', () => this.close());
    panel.querySelector('#fpStart').addEventListener('click', () => this.toggleTimer());
    panel.querySelector('#fpReset').addEventListener('click', () => this.resetTimer());
    panel.querySelectorAll('.fp-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
    });
  }

  setMode(mode) {
    this.mode = mode;
    this.stopTimer();
    const times = { focus: 25 * 60, shortBreak: 5 * 60, longBreak: 15 * 60 };
    this.timeLeft = times[mode];
    this.updateDisplay();
    this.updateStatus();

    document.querySelectorAll('.fp-mode-btn').forEach(b => {
      const isActive = b.dataset.mode === mode;
      b.classList.toggle('active', isActive);
      b.style.background = isActive ? 'var(--accent-dim)' : 'var(--bg-3)';
      b.style.borderColor = isActive ? 'var(--accent-0)' : 'var(--border-1)';
      b.style.color = isActive ? 'var(--accent-0)' : 'var(--text-2)';
    });
  }

  toggleTimer() { if (this.isRunning) { this.stopTimer(); } else { this.startTimer(); } }

  startTimer() {
    this.isRunning = true;
    document.getElementById('fpStart').textContent = 'Pause';
    document.getElementById('fpStatus').textContent = 'Focusing...';
    this.timer = setInterval(() => { this.timeLeft--; this.updateDisplay(); if (this.timeLeft <= 0) this.completeSession(); }, 1000);
  }

  stopTimer() {
    this.isRunning = false;
    clearInterval(this.timer);
    const btn = document.getElementById('fpStart');
    if (btn) btn.textContent = 'Start';
    const status = document.getElementById('fpStatus');
    if (status) status.textContent = 'Ready to focus';
  }

  resetTimer() {
    this.stopTimer();
    const times = { focus: 25 * 60, shortBreak: 5 * 60, longBreak: 15 * 60 };
    this.timeLeft = times[this.mode];
    this.updateDisplay();
  }

  completeSession() {
    this.stopTimer();
    if (this.mode === 'focus') { this.sessions++; this.saveStats(); }
    const nextMode = this.mode === 'focus' ? 'shortBreak' : 'focus';
    this.setMode(nextMode);
    this.renderPanel();
  }

  updateDisplay() {
    const mins = Math.floor(this.timeLeft / 60);
    const secs = this.timeLeft % 60;
    const display = document.getElementById('fpTimer');
    if (display) display.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  updateStatus() {
    const status = document.getElementById('fpStatus');
    if (status) {
      const statuses = { focus: 'Time to focus!', shortBreak: 'Take a short break', longBreak: 'Take a long break' };
      status.textContent = statuses[this.mode] || 'Ready';
    }
  }
}

window.FocusPulsePlugin = FocusPulsePlugin;
