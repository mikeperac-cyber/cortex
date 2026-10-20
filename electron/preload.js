const { contextBridge, ipcRenderer } = require('electron');

// index:* answers { success, <key> }: hand the page the bare payload, or an empty one (and a console error) on failure
const indexQuery = (channel, key, empty) => (...args) => ipcRenderer.invoke(channel, ...args).then(
  (reply) => {
    if (reply && reply.success) return reply[key];
    console.error(channel + ' failed:', reply && reply.error);
    return empty();
  },
  (err) => {
    console.error(channel + ' failed:', err);
    return empty();
  },
);

// The page gets only the payload, never the IpcRendererEvent; the returned function removes exactly this listener.
function subscribe(channel, handler) {
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); }; // removeListener returns the emitter: never hand it to the page
}

contextBridge.exposeInMainWorld('cortex', {
  index: {
    notes: indexQuery('index:notes', 'notes', () => []),
    resolve: indexQuery('index:resolve', 'note', () => null),
    backlinks: indexQuery('index:backlinks', 'backlinks', () => []),
    tags: indexQuery('index:tags', 'tags', () => []),
    graph: indexQuery('index:graph', 'graph', () => ({ nodes: [], edges: [] })),
    search: indexQuery('index:search', 'results', () => []),
    onUpdated: (callback) => subscribe('vault:index-updated', () => callback()),
    onFileChanged: (callback) => subscribe('vault:file-changed', (e, absPath) => callback(absPath)),
  },
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
  // main asks for a save-everything before closing or switching vault. callback(asking) resolves false to veto
  // ("the user wants to keep unsaved text"); true, undefined or a throw let main proceed, and the ack is always sent.
  // The callback calls asking() before it blocks on a question to the user, so main's timeout does not cut the user short.
  onFlush: (callback) => ipcRenderer.on('app:flush', async () => {
    let proceed = true;
    try {
      proceed = (await callback(() => ipcRenderer.send('app:flush-asking'))) !== false;
    } catch (err) {
      console.error('flush failed:', err);
    }
    ipcRenderer.send('app:flushed', proceed);
  }),
  onMenuAction: (action, callback) => ipcRenderer.on('menu:' + action, callback),
});
