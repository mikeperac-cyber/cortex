const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { createVaultFs } = require('./vault-fs');
const { isSafeExternalUrl } = require('./security');

let mainWindow;
// CORTEX_VAULT points the app at another vault (the e2e harness uses a temp one)
let vaultPath = process.env.CORTEX_VAULT
  ? path.resolve(process.env.CORTEX_VAULT)
  : path.join(app.getPath('documents'), 'CortexVault');

const vaultFs = createVaultFs({
  getRoot: () => vaultPath,
  trash: (absPath) => shell.trashItem(absPath),
});

function setVault(absPath) {
  vaultPath = path.resolve(absPath);
  mainWindow?.webContents.send('vault:changed', vaultPath);
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
    show: process.env.CORTEX_E2E !== '1',
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
          setVault(result.filePaths[0]);
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
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

module.exports = { setVault };
