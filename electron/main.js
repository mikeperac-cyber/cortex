const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fse = require('fs-extra');

let mainWindow;
let vaultPath = path.join(app.getPath('documents'), 'CortexVault');
const fileCache = new Map();
const CACHE_TTL = 30000;
let watcher = null;

function getCached(key) {
  const entry = fileCache.get(key);
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry.value;
  fileCache.delete(key);
  return null;
}

function setCache(key, value) {
  fileCache.set(key, { value, time: Date.now() });
  if (fileCache.size > 500) fileCache.clear();
}

function invalidateCache(filePath) {
  fileCache.delete(filePath);
  const dir = path.dirname(filePath);
  for (const key of fileCache.keys()) {
    if (key.startsWith(dir)) fileCache.delete(key);
  }
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
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      enableWebSQL: false,
      v8CacheOptions: 'code',
    },
    icon: path.join(__dirname, '../src/assets/icon.png'),
    backgroundColor: '#0f0e0c',
  });

  mainWindow.loadFile(path.join(__dirname, '../src/index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });

  // Setup native menu
  const template = [
    { label: 'File', submenu: [
      { label: 'New File', accelerator: 'Ctrl+N', click: () => mainWindow.webContents.send('menu:new-file') },
      { label: 'Open Vault', click: async () => {
        const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Select Vault Folder' });
        if (!result.canceled && result.filePaths.length > 0) {
          vaultPath = result.filePaths[0];
          fileCache.clear();
          mainWindow.webContents.send('vault:changed', vaultPath);
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

ipcMain.handle('read-file', (event, filePath) => {
  const cached = getCached(filePath);
  if (cached) return { success: true, content: cached };
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    setCache(filePath, content);
    return { success: true, content };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('write-file', (event, filePath, content) => {
  try {
    fse.ensureDirSync(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf-8');
    invalidateCache(filePath);
    setCache(filePath, content);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('list-files', (event, dirPath) => {
  const cached = getCached('list:' + dirPath);
  if (cached) return { success: true, files: cached };
  try {
    if (!fs.existsSync(dirPath)) return { success: true, files: [] };
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    const files = items.map(item => ({
      name: item.name,
      isDirectory: item.isDirectory(),
      path: path.join(dirPath, item.name),
      ext: item.name.includes('.') ? item.name.split('.').pop() : '',
    }));
    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    setCache('list:' + dirPath, files);
    return { success: true, files };
  } catch (err) {
    return { success: false, error: err.message, files: [] };
  }
});

ipcMain.handle('create-folder', (event, folderPath) => {
  try {
    fs.mkdirSync(folderPath, { recursive: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-file', (event, filePath) => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    invalidateCache(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('rename-file', (event, oldPath, newPath) => {
  try {
    fs.renameSync(oldPath, newPath);
    invalidateCache(oldPath);
    invalidateCache(newPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('search-files', (event, dirPath, query) => {
  try {
    const results = [];
    const searchDir = (dir) => {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          searchDir(fullPath);
        } else if (item.name.endsWith('.md')) {
          const cached = getCached(fullPath);
          const content = cached || fs.readFileSync(fullPath, 'utf-8');
          if (content.toLowerCase().includes(query.toLowerCase()) ||
              item.name.toLowerCase().includes(query.toLowerCase())) {
            results.push({ name: item.name, path: fullPath, preview: content.substring(0, 200) });
          }
        }
      }
    };
    searchDir(dirPath);
    return { success: true, results };
  } catch (err) {
    return { success: false, error: err.message, results: [] };
  }
});

ipcMain.handle('get-recent-files', (event, dirPath) => {
  try {
    const files = [];
    const collectFiles = (dir) => {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) collectFiles(fullPath);
        else if (item.name.endsWith('.md')) {
          const stats = fs.statSync(fullPath);
          files.push({ name: item.name, path: fullPath, mtime: stats.mtime });
        }
      }
    };
    collectFiles(dirPath);
    files.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    return { success: true, files: files.slice(0, 20) };
  } catch (err) {
    return { success: false, error: err.message, files: [] };
  }
});

ipcMain.handle('batch-read', (event, filePaths) => {
  const results = {};
  for (const fp of filePaths) {
    const cached = getCached(fp);
    if (cached) { results[fp] = cached; continue; }
    try {
      const content = fs.readFileSync(fp, 'utf-8');
      setCache(fp, content);
      results[fp] = content;
    } catch { results[fp] = null; }
  }
  return results;
});

ipcMain.handle('select-vault', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Select Vault Folder' });
  if (!result.canceled && result.filePaths.length > 0) {
    vaultPath = result.filePaths[0];
    fileCache.clear();
    return { success: true, path: vaultPath };
  }
  return { success: false };
});

ipcMain.handle('open-external', (event, url) => { shell.openExternal(url); });

// Forward window control events
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
