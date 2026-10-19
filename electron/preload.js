const { contextBridge, ipcRenderer } = require('electron');

const cache = new Map();

contextBridge.exposeInMainWorld('cortex', {
  getVaultPath: () => ipcRenderer.invoke('get-vault-path'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  listFiles: (dirPath) => ipcRenderer.invoke('list-files', dirPath),
  createFolder: (folderPath) => ipcRenderer.invoke('create-folder', folderPath),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  searchFiles: (dirPath, query) => ipcRenderer.invoke('search-files', dirPath, query),
  getRecentFiles: (dirPath) => ipcRenderer.invoke('get-recent-files', dirPath),
  batchRead: (filePaths) => ipcRenderer.invoke('batch-read', filePaths),
  selectVault: () => ipcRenderer.invoke('select-vault'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  onVaultChanged: (callback) => ipcRenderer.on('vault:changed', (e, path) => callback(path)),
  onMenuAction: (action, callback) => ipcRenderer.on('menu:' + action, callback),
});
