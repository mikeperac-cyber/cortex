const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { createVaultFs } = require('./vault-fs');
const { VaultIndex } = require('./vault-index');
const { isSafeExternalUrl } = require('./security');

let mainWindow;
// CORTEX_VAULT (another vault) and CORTEX_E2E (hidden window) are test hooks for the e2e harness: only an unpackaged run
// honours them, so an environment variable can never repoint or hide an installed copy.
const testHooks = !app.isPackaged;
const e2e = testHooks && process.env.CORTEX_E2E === '1';
let vaultPath = testHooks && process.env.CORTEX_VAULT
  ? path.resolve(process.env.CORTEX_VAULT)
  : path.join(app.getPath('documents'), 'CortexVault');

const vaultFs = createVaultFs({
  getRoot: () => vaultPath,
  trash: (absPath) => shell.trashItem(absPath),
});

let flushInFlight = null;

// Asks the renderer to write every unsaved tab. Resolves `proceed`: false only when the renderer says the user chose to keep
// unsaved text (ack false); true on any other ack, with no window, or after 3 s so a hung renderer cannot block quitting.
// The 3 s clock stops once the renderer reports it is asking the user (`app:flush-asking`): a person may take longer.
// Concurrent callers (repeated close clicks, a vault switch during a close) share one request.
function requestFlush() {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return Promise.resolve(true);
  if (flushInFlight) return flushInFlight;
  let settle;
  const request = new Promise((resolve) => { settle = resolve; });
  flushInFlight = request; // set before anything below can finish() it
  const finish = (proceed) => {
    clearTimeout(timer);
    ipcMain.removeListener('app:flush-asking', onAsking);
    ipcMain.removeListener('app:flushed', onAck);
    if (!win.isDestroyed()) win.webContents.removeListener('render-process-gone', onGone);
    flushInFlight = null;
    settle(proceed);
  };
  const onAck = (event, proceed) => finish(proceed !== false);
  const onAsking = () => clearTimeout(timer);
  const onGone = () => finish(true); // a crashed renderer can no longer answer, and must not leave the window unclosable
  const timer = setTimeout(() => finish(true), 3000);
  ipcMain.once('app:flush-asking', onAsking);
  ipcMain.once('app:flushed', onAck);
  win.webContents.once('render-process-gone', onGone);
  try { win.webContents.send('app:flush'); } catch { finish(true); }
  return request;
}

const index = new VaultIndex();
let indexReady = Promise.resolve(); // the newest reset; never rejects
let watcher = null;
const watchTimers = new Map(); // absolute path -> its pending 100 ms debounce timer
let updatedTimer = null;

// Best effort: the window can be gone or mid-teardown, and a timer or watcher callback must never throw because of it.
function notify(channel, ...args) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
  } catch { /* nobody left to tell */ }
}

// shortcut: full notes() payload on each update, upgrade to deltas past ~5k notes
function scheduleIndexUpdated() {
  clearTimeout(updatedTimer);
  updatedTimer = setTimeout(() => { updatedTimer = null; notify('vault:index-updated'); }, 150);
}

function stopWatching() {
  try { watcher?.close(); } catch { /* already closed */ }
  watcher = null;
  for (const timer of watchTimers.values()) clearTimeout(timer);
  watchTimers.clear();
  clearTimeout(updatedTimer);
  updatedTimer = null;
}

async function applyChange(w, abs) {
  try {
    const result = await index.update(abs);
    if (w !== watcher || result === 'ignored') return; // a vault switch closed this watcher while the update ran
    if (/\.md$/i.test(abs)) notify('vault:file-changed', abs);
    scheduleIndexUpdated();
  } catch (err) {
    console.error('index update failed:', err);
  }
}

// fs.watch recursive: Windows/macOS only
function watchVault(root) {
  try {
    const w = fs.watch(root, { recursive: true }, (event, filename) => {
      try {
        // no filename says nothing about what changed; a dot-segment is hidden from the index (.git, .trash, ...)
        if (!filename || filename.split(/[\\/]/).some((segment) => segment[0] === '.')) return;
        const abs = path.join(root, filename); // the exact root string the index was reset with
        clearTimeout(watchTimers.get(abs));
        watchTimers.set(abs, setTimeout(() => { watchTimers.delete(abs); applyChange(w, abs); }, 100));
      } catch (err) {
        console.error('vault watcher callback failed:', err);
      }
    });
    w.on('error', (err) => console.error('vault watcher error:', err));
    watcher = w;
  } catch (err) {
    console.error('vault watcher could not start:', err);
  }
}

// Points index and watcher at root; the previous watcher and its timers are gone first.
function useVault(root) {
  stopWatching();
  const reset = index.reset(root)
    .catch((err) => console.error('index reset failed:', err))
    .then(() => { if (indexReady === reset) scheduleIndexUpdated(); }); // a superseded reset says nothing about the current vault
  indexReady = reset;
  watchVault(root);
}

// The renderer saves before the root moves: afterwards its old absolute paths would be refused as outside the vault.
// If it reports unsaved text the user wants to keep, the vault stays as it is.
// Resolves true if the vault was switched, false if the path was rejected or the renderer vetoed. Anything that must happen
// only on a real switch (an index reset, a watcher re-arm) belongs after the veto check, never before it.
async function setVault(absPath) {
  if (typeof absPath !== 'string' || !absPath) return false;
  if (!(await requestFlush())) return false;
  vaultPath = path.resolve(absPath);
  useVault(vaultPath);
  notify('vault:changed', vaultPath);
  return true;
}

// Ensure vault directory exists
if (!fs.existsSync(vaultPath)) {
  fs.mkdirSync(vaultPath, { recursive: true });
  fs.mkdirSync(path.join(vaultPath, 'Daily Notes'), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, 'Templates'), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, 'Projects'), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, 'Welcome.md'), `# Welcome to Cortex

Your second brain awaits. This is a **local-first** markdown workspace.

## Getting Started
- Create notes with \`Ctrl+N\`
- Search everything with \`Ctrl+Shift+F\`
- Open command palette with \`Ctrl+P\`
- Toggle graph view with \`Ctrl+G\`

## Plugins Active
1. **TaskFlow** — Kanban board & task management
2. **DailySync** — Daily notes & calendar
3. **Recall** — Spaced repetition flashcards
4. **DataForge** — Dataview queries & templates
5. **FocusPulse** — Pomodoro timer & focus stats

---
*Cortex: Your thoughts, connected.*
`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: !e2e,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      enableWebSQL: false,
      v8CacheOptions: 'code',
      backgroundThrottling: !e2e, // the hidden e2e window would otherwise stretch renderer timers to ~1 s
    },
    icon: path.join(__dirname, '../src/assets/icon.png'),
    backgroundColor: '#0f0e0c',
  });

  mainWindow.loadFile(path.join(__dirname, '../src/index.html'));
  const win = mainWindow;
  let closing = false;
  let saved = false;
  // Every close path (title-bar button, Alt+F4, app.quit) is held until the renderer has written its unsaved tabs
  win.on('close', (e) => {
    if (saved) return;
    e.preventDefault();
    if (closing) return;
    closing = true;
    requestFlush().then((proceed) => {
      if (!proceed) { closing = false; return; } // the user chose to keep their unsaved text: stay open
      saved = true;
      if (!win.isDestroyed()) win.close();
    });
  });
  win.on('closed', () => { mainWindow = null; });

  // Setup native menu
  const template = [
    { label: 'File', submenu: [
      { label: 'New File', accelerator: 'Ctrl+N', click: () => mainWindow.webContents.send('menu:new-file') },
      { label: 'Open Vault', click: async () => {
        const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Select Vault Folder' });
        if (!result.canceled && result.filePaths.length > 0) {
          setVault(result.filePaths[0]).catch((err) => console.error('Open Vault failed:', err));
        }
      }},
      { type: 'separator' },
      { label: 'Exit', accelerator: 'Alt+F4', click: () => app.quit() },
    ]},
    { label: 'View', submenu: [
      { label: 'Toggle Preview', accelerator: 'Ctrl+E', click: () => mainWindow.webContents.send('menu:toggle-preview') },
      { label: 'Graph View', accelerator: 'Ctrl+G', click: () => mainWindow.webContents.send('menu:toggle-graph') },
      { label: 'Search', accelerator: 'Ctrl+Shift+F', click: () => mainWindow.webContents.send('menu:open-search') },
    ]},
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// IPC Handlers
ipcMain.handle('get-vault-path', () => vaultPath);

ipcMain.handle('read-file', (event, filePath) => vaultFs.read(filePath));
ipcMain.handle('write-file', (event, filePath, content, opts) => vaultFs.write(filePath, content, opts));
ipcMain.handle('list-files', (event, dirPath) => vaultFs.list(dirPath));
ipcMain.handle('create-folder', (event, folderPath) => vaultFs.mkdir(folderPath));
ipcMain.handle('delete-file', (event, filePath) => vaultFs.remove(filePath));
ipcMain.handle('rename-file', (event, oldPath, newPath) => vaultFs.rename(oldPath, newPath));

// A call made during a vault switch must not see the old vault: wait until the newest reset has settled.
async function indexSettled() {
  let p;
  do { p = indexReady; await p; } while (p !== indexReady);
}

const needString = (value, name) => {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  return value;
};

// index:<name> answers { success: true, [key]: payload } once the scan is done, or { success: false, error, [key]: empty }.
function handleIndex(channel, key, empty, answer) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      await indexSettled();
      return { success: true, [key]: answer(...args) };
    } catch (err) {
      return { success: false, error: err.message, [key]: empty };
    }
  });
}
handleIndex('index:notes', 'notes', [], () => index.notes());
handleIndex('index:resolve', 'note', null, (target) => index.resolve(needString(target, 'target')));
handleIndex('index:backlinks', 'backlinks', [], (absPath) => index.backlinks(needString(absPath, 'path')));
handleIndex('index:tags', 'tags', [], () => index.tags());
handleIndex('index:graph', 'graph', { nodes: [], edges: [] }, () => index.graph());
handleIndex('index:search', 'results', [], (query, limit) => index.search(
  needString(query, 'query'),
  Number.isFinite(limit) ? Math.min(200, Math.max(1, Math.floor(limit))) : undefined, // undefined: the index default
));

// Kept until Task 8 replaces it with the indexed search; goes through vaultFs so it is confined and skips dot-entries.
ipcMain.handle('search-files', async (event, dirPath, query) => {
  try {
    const q = query.toLowerCase();
    const results = [];
    const searchDir = async (dir) => {
      const listing = await vaultFs.list(dir);
      if (!listing.success) throw new Error(listing.error);
      for (const item of listing.files) {
        if (item.isDirectory) {
          await searchDir(item.path);
        } else if (item.name.endsWith('.md')) {
          const file = await vaultFs.read(item.path);
          if (!file.success) continue;
          if (file.content.toLowerCase().includes(q) || item.name.toLowerCase().includes(q)) {
            results.push({ name: item.name, path: item.path, preview: file.content.substring(0, 200) });
          }
        }
      }
    };
    await searchDir(dirPath);
    return { success: true, results };
  } catch (err) {
    return { success: false, error: err.message, results: [] };
  }
});

ipcMain.handle('open-external', async (event, url) => {
  if (!isSafeExternalUrl(url)) return { success: false, error: 'URL scheme is not allowed' };
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Forward window control events
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

app.whenReady().then(() => {
  useVault(vaultPath);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Only emitted once every window has closed and the quit goes ahead (before-quit also fires when a refused close cancels it)
app.on('will-quit', stopWatching);

module.exports = { setVault, requestFlush };
