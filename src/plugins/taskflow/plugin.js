// ============================================
// CORTEX Plugin: TaskFlow — Kanban & Tasks (Optimized)
// ============================================

class TaskFlowPlugin {
  name = 'taskflow';
  app = null;
  tasks = [];
  columns = ['backlog', 'todo', 'inprogress', 'done'];
  panelEl = null;
  _dragEl = null;

  async init() { this.loadTasks(); }

  loadTasks() {
    const stored = localStorage.getItem('cortex_tasks');
    this.tasks = stored ? JSON.parse(stored) : [
      { id: 1, title: 'Set up Cortex workspace', column: 'done', priority: 'high', due: null, tags: ['setup'] },
      { id: 2, title: 'Create project notes', column: 'todo', priority: 'medium', due: null, tags: ['notes'] },
      { id: 3, title: 'Review weekly goals', column: 'backlog', priority: 'low', due: null, tags: ['review'] },
    ];
    this.saveTasks();
  }

  saveTasks() { localStorage.setItem('cortex_tasks', JSON.stringify(this.tasks)); }

  open() { this.renderPanel(); }

  close() { if (this.panelEl) this.panelEl.classList.remove('visible'); }

  renderPanel() {
    this.close();
    const root = document.getElementById('plugin-root');

    const panel = document.createElement('div');
    panel.className = 'plugin-panel visible';
    panel.id = 'plugin-taskflow';
    panel.innerHTML = `
      <div class="plugin-panel-header">
        <span class="plugin-panel-title">TaskFlow — Kanban Board</span>
        <div style="display:flex;gap:8px;">
          <button class="icon-btn" id="tfAddTask" title="Add Task"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2V12M2 7H12" stroke="currentColor" stroke-width="1.5"/></svg></button>
          <button class="icon-btn" id="tfClose" title="Close"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2L12 12M12 2L2 12" stroke="currentColor" stroke-width="1.5"/></svg></button>
        </div>
      </div>
      <div class="plugin-panel-body">
        <div style="display:flex;gap:12px;overflow-x:auto;align-items:flex-start;padding-bottom:20px;min-height:100%;">
          ${this.columns.map(col => this.renderColumn(col)).join('')}
        </div>
      </div>
    `;

    root.appendChild(panel);
    this.panelEl = panel;

    panel.querySelector('#tfAddTask').addEventListener('click', () => this.addTask());
    panel.querySelector('#tfClose').addEventListener('click', () => this.close());

    // Drag & drop
    panel.querySelectorAll('.tf-task').forEach(el => {
      el.draggable = true;
      el.addEventListener('dragstart', (e) => { this._dragEl = el; e.dataTransfer.setData('text/plain', el.dataset.id); });
      el.addEventListener('dragend', () => { this._dragEl = null; });
    });
    panel.querySelectorAll('.tf-column-body').forEach(el => {
      el.addEventListener('dragover', (e) => e.preventDefault());
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const taskId = parseInt(e.dataTransfer.getData('text/plain'));
        const newCol = el.dataset.column;
        const task = this.tasks.find(t => t.id === taskId);
        if (task) { task.column = newCol; this.saveTasks(); this.renderPanel(); }
      });
    });
  }

  renderColumn(col) {
    const labels = { backlog: 'Backlog', todo: 'To Do', inprogress: 'In Progress', done: 'Done' };
    const colors = { backlog: 'var(--text-2)', todo: 'var(--info)', inprogress: 'var(--warning)', done: 'var(--success)' };
    const colTasks = this.tasks.filter(t => t.column === col);

    return `
      <div class="tf-column" data-column="${col}">
        <div class="tf-column-header" style="color:${colors[col]}">
          <span>${labels[col]}</span>
          <span style="font-size:11px;background:var(--bg-3);padding:2px 8px;border-radius:10px;">${colTasks.length}</span>
        </div>
        <div class="tf-column-body" data-column="${col}">
          ${colTasks.map(t => this.renderTask(t)).join('')}
        </div>
        <button class="tf-add-btn" data-col="${col}">+ Add</button>
      </div>
    `;
  }

  renderTask(task) {
    const priorityColors = { high: 'var(--danger)', medium: 'var(--warning)', low: 'var(--success)' };
    return `
      <div class="tf-task" data-id="${task.id}" draggable="true">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${priorityColors[task.priority] || 'var(--text-3)'};"></span>
          <span style="font-size:13px;flex:1;">${task.title}</span>
        </div>
        ${task.due ? `<div style="font-size:11px;color:var(--text-2);margin-bottom:4px;">Due: ${task.due}</div>` : ''}
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          ${(task.tags || []).map(tag => `<span style="font-size:10px;padding:2px 6px;background:var(--bg-3);border-radius:3px;color:var(--text-2);">#${tag}</span>`).join('')}
        </div>
        <div style="display:flex;gap:4px;margin-top:8px;">
          <button class="tf-task-action" data-id="${task.id}" data-action="edit" style="font-size:10px;padding:2px 6px;background:var(--bg-3);border:none;border-radius:3px;color:var(--text-2);cursor:pointer;">Edit</button>
          <button class="tf-task-action" data-id="${task.id}" data-action="delete" style="font-size:10px;padding:2px 6px;background:var(--bg-3);border:none;border-radius:3px;color:var(--danger);cursor:pointer;">Delete</button>
        </div>
      </div>
    `;
  }

  addTask() {
    const title = prompt('Task title:');
    if (!title) return;
    const column = prompt('Column (backlog/todo/inprogress/done):', 'todo');
    const priority = prompt('Priority (high/medium/low):', 'medium');
    this.tasks.push({
      id: Date.now(), title,
      column: this.columns.includes(column) ? column : 'todo',
      priority: ['high', 'medium', 'low'].includes(priority) ? priority : 'medium',
      due: null, tags: [],
    });
    this.saveTasks();
    this.renderPanel();
  }
}

window.TaskFlowPlugin = TaskFlowPlugin;
