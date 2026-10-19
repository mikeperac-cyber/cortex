// ============================================
// CORTEX Plugin: Recall — Spaced Repetition (Optimized)
// ============================================

class RecallPlugin {
  name = 'recall';
  app = null;
  cards = [];
  panelEl = null;
  currentCard = null;
  reviewQueue = [];

  async init() { this.loadCards(); }

  loadCards() {
    const stored = localStorage.getItem('cortex_cards');
    this.cards = stored ? JSON.parse(stored) : [
      { id: 1, front: 'What is a "second brain"?', back: 'A digital system for capturing, organizing, and retrieving knowledge.', interval: 1, repetitions: 0, nextReview: new Date().toISOString() },
      { id: 2, front: 'What is spaced repetition?', back: 'A learning technique with increasing intervals between reviews.', interval: 1, repetitions: 0, nextReview: new Date().toISOString() },
      { id: 3, front: 'What is a Zettelkasten?', back: 'A note-taking method using atomic, linked notes.', interval: 1, repetitions: 0, nextReview: new Date().toISOString() },
    ];
    this.saveCards();
  }

  saveCards() { localStorage.setItem('cortex_cards', JSON.stringify(this.cards)); }

  // nextReview is a stored ISO (UTC) timestamp; due means its LOCAL calendar day is today or earlier. A missing or unparseable date counts as due.
  isDue(card, today) {
    const when = card.nextReview ? new Date(card.nextReview) : null;
    return (when && !isNaN(when) ? CortexLib.localDateStr(when) : today) <= today;
  }

  open() { this.renderPanel(); }

  close() { if (this.panelEl) this.panelEl.classList.remove('visible'); }

  renderPanel() {
    this.close();
    const root = document.getElementById('plugin-root');
    const today = CortexLib.localDateStr();
    const dueCards = this.cards.filter(c => this.isDue(c, today));

    const panel = document.createElement('div');
    panel.className = 'plugin-panel visible';
    panel.id = 'plugin-recall';
    panel.innerHTML = `
      <div class="plugin-panel-header">
        <span class="plugin-panel-title">Recall — Spaced Repetition</span>
        <div style="display:flex;gap:8px;">
          <button class="icon-btn" id="rcAddCard" title="Add Card"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.5"/></svg></button>
          <button class="icon-btn" id="rcStartReview" title="Start Review"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 2L12 7L4 12V2Z" fill="currentColor"/></svg></button>
          <button class="icon-btn" id="rcClose" title="Close"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" stroke-width="1.5"/></svg></button>
        </div>
      </div>
      <div class="plugin-panel-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
          <div>
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
              <div style="background:var(--accent-dim);padding:8px 16px;border-radius:8px;">
                <div style="font-size:24px;font-weight:700;color:var(--accent-0);font-family:var(--font-display);">${dueCards.length}</div>
                <div style="font-size:11px;color:var(--text-2);">Due Today</div>
              </div>
              <div style="background:var(--bg-2);padding:8px 16px;border-radius:8px;">
                <div style="font-size:24px;font-weight:700;font-family:var(--font-display);">${this.cards.length}</div>
                <div style="font-size:11px;color:var(--text-2);">Total Cards</div>
              </div>
            </div>
            <h3 style="font-family:var(--font-display);font-size:14px;margin-bottom:8px;color:var(--text-2);">Recent Cards</h3>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${this.cards.slice(0, 10).map(c => `
                <div style="background:var(--bg-2);border:1px solid var(--border-1);border-radius:8px;padding:12px;">
                  <div style="font-size:13px;font-weight:500;margin-bottom:4px;">${c.front}</div>
                  <div style="font-size:12px;color:var(--text-2);">${c.back}</div>
                </div>
              `).join('')}
            </div>
          </div>
          <div>
            <h3 style="font-family:var(--font-display);font-size:14px;margin-bottom:8px;color:var(--text-2);">Add New Card</h3>
            <div style="background:var(--bg-2);border:1px solid var(--border-1);border-radius:8px;padding:16px;">
              <input id="rcFront" placeholder="Front (question)" style="width:100%;padding:8px 12px;background:var(--bg-3);border:1px solid var(--border-1);border-radius:6px;color:var(--text-0);font-size:13px;margin-bottom:8px;">
              <textarea id="rcBack" placeholder="Back (answer)" style="width:100%;min-height:80px;padding:8px 12px;background:var(--bg-3);border:1px solid var(--border-1);border-radius:6px;color:var(--text-0);font-size:13px;resize:vertical;margin-bottom:8px;"></textarea>
              <button id="rcSaveCard" style="padding:6px 16px;background:var(--accent-dim);border:1px solid var(--accent-0);border-radius:6px;color:var(--accent-0);cursor:pointer;font-size:12px;">Save Card</button>
            </div>
            <h3 style="font-family:var(--font-display);font-size:14px;margin:16px 0 8px;color:var(--text-2);">Statistics</h3>
            <div style="background:var(--bg-2);border:1px solid var(--border-1);border-radius:8px;padding:16px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span style="font-size:12px;color:var(--text-2);">Reviews completed</span>
                <span style="font-size:12px;font-weight:600;">${this.cards.reduce((sum, c) => sum + (c.repetitions || 0), 0)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;">
                <span style="font-size:12px;color:var(--text-2);">Average interval</span>
                <span style="font-size:12px;font-weight:600;">${(this.cards.reduce((sum, c) => sum + (c.interval || 0), 0) / Math.max(this.cards.length, 1)).toFixed(1)} days</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    root.appendChild(panel);
    this.panelEl = panel;

    panel.querySelector('#rcClose').addEventListener('click', () => this.close());
    panel.querySelector('#rcAddCard').addEventListener('click', () => { panel.querySelector('#rcFront').focus(); });
    panel.querySelector('#rcSaveCard').addEventListener('click', () => this.saveCard());
    panel.querySelector('#rcStartReview').addEventListener('click', () => this.startReview());
  }

  saveCard() {
    const front = document.getElementById('rcFront').value;
    const back = document.getElementById('rcBack').value;
    if (!front || !back) return;
    this.cards.push({ id: Date.now(), front, back, interval: 1, repetitions: 0, nextReview: new Date().toISOString() });
    this.saveCards();
    this.renderPanel();
  }

  startReview() {
    const today = CortexLib.localDateStr();
    this.reviewQueue = this.cards.filter(c => this.isDue(c, today));
    if (this.reviewQueue.length === 0) { alert('No cards due for review!'); return; }
    this.showReviewCard();
  }

  showReviewCard() {
    if (this.reviewQueue.length === 0) { this.renderPanel(); return; }
    this.currentCard = this.reviewQueue[0];
    const root = document.getElementById('plugin-root');

    const panel = document.createElement('div');
    panel.className = 'plugin-panel visible';
    panel.id = 'plugin-recall-review';
    panel.innerHTML = `
      <div class="plugin-panel-header">
        <span class="plugin-panel-title">Review Mode — ${this.reviewQueue.length} cards remaining</span>
        <button class="icon-btn" id="rcExitReview" title="Exit"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" stroke-width="1.5"/></svg></button>
      </div>
      <div class="plugin-panel-body" style="display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <div style="max-width:500px;width:100%;text-align:center;">
          <div style="font-size:11px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:16px;">Question</div>
          <div id="rcCardFront" style="font-family:var(--font-display);font-size:22px;margin-bottom:32px;line-height:1.4;">${this.currentCard.front}</div>
          <div id="rcCardBack" style="display:none;font-size:16px;color:var(--text-1);margin-bottom:32px;padding:20px;background:var(--bg-2);border-radius:8px;">${this.currentCard.back}</div>
          <button id="rcReveal" style="padding:10px 32px;background:var(--bg-3);border:1px solid var(--border-1);border-radius:8px;color:var(--text-0);cursor:pointer;font-size:14px;">Reveal Answer</button>
          <div id="rcGrades" style="display:none;gap:8px;justify-content:center;">
            <button class="rc-grade" data-grade="again" style="padding:10px 20px;background:rgba(232,124,124,0.1);border:1px solid var(--danger);border-radius:8px;color:var(--danger);cursor:pointer;font-size:12px;">Again</button>
            <button class="rc-grade" data-grade="hard" style="padding:10px 20px;background:rgba(232,200,76,0.1);border:1px solid var(--warning);border-radius:8px;color:var(--warning);cursor:pointer;font-size:12px;">Hard</button>
            <button class="rc-grade" data-grade="good" style="padding:10px 20px;background:rgba(126,201,126,0.1);border:1px solid var(--success);border-radius:8px;color:var(--success);cursor:pointer;font-size:12px;">Good</button>
            <button class="rc-grade" data-grade="easy" style="padding:10px 20px;background:rgba(108,184,232,0.1);border:1px solid var(--info);border-radius:8px;color:var(--info);cursor:pointer;font-size:12px;">Easy</button>
          </div>
        </div>
      </div>
    `;

    root.appendChild(panel);

    panel.querySelector('#rcReveal').addEventListener('click', () => {
      document.getElementById('rcCardFront').style.display = 'none';
      document.getElementById('rcCardBack').style.display = 'block';
      document.getElementById('rcReveal').style.display = 'none';
      document.getElementById('rcGrades').style.display = 'flex';
    });

    panel.querySelectorAll('.rc-grade').forEach(btn => {
      btn.addEventListener('click', () => this.gradeCard(btn.dataset.grade));
    });

    panel.querySelector('#rcExitReview').addEventListener('click', () => { panel.remove(); this.renderPanel(); });
  }

  gradeCard(grade) {
    const card = this.currentCard;
    const grades = { again: 0, hard: 1, good: 2, easy: 3 };
    const quality = grades[grade];
    if (quality >= 2) {
      card.repetitions = (card.repetitions || 0) + 1;
      if (card.repetitions === 1) card.interval = 1;
      else if (card.repetitions === 2) card.interval = 3;
      else card.interval = Math.round((card.interval || 1) * 2.5);
    } else { card.repetitions = 0; card.interval = 1; }
    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + card.interval);
    card.nextReview = nextReview.toISOString();
    this.saveCards();
    this.reviewQueue.shift();
    this.showReviewCard();
  }
}

window.RecallPlugin = RecallPlugin;
