const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cortex', {
  getVaultPath: () => ipcRenderer.invoke('get-vault-path'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content, opts) => ipcRenderer.invoke('write-file', filePath, content, opts),
  listFiles: (dirPath) => ipcRenderer.invoke('list-files', dirPath),
  createFolder: (folderPath) => ipcRenderer.invoke('create-folder', folderPath),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  searchFiles: (dirPath, query) => ipcRenderer.invoke('search-files', dirPath, query),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  onVaultChanged: (callback) => ipcRenderer.on('vault:changed', (e, path) => callback(path)),
  onMenuAction: (action, callback) => ipcRenderer.on('menu:' + action, callback),
});
