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

// One throwing page callback must not stop ipcRenderer from calling the other listeners on its channel
const guard = (channel, handler) => (...args) => {
  try { handler(...args); } catch (err) { console.error(channel + ' callback failed:', err); }
};

contextBridge.exposeInMainWorld('cortex', {
  index: {
    notes: indexQuery('index:notes', 'notes', () => []),
    resolve: indexQuery('index:resolve', 'note', () => null),
    backlinks: indexQuery('index:backlinks', 'backlinks', () => []),
    mentions: indexQuery('index:mentions', 'mentions', () => []),
    tags: indexQuery('index:tags', 'tags', () => []),
    graph: indexQuery('index:graph', 'graph', () => ({ nodes: [], edges: [] })),
    search: indexQuery('index:search', 'results', () => []),
    onUpdated: (callback) => subscribe('vault:index-updated', guard('vault:index-updated', () => callback())),
    onFileChanged: (callback) => subscribe('vault:file-changed', guard('vault:file-changed', (e, absPath) => callback(absPath))),
  },
  // BYOK AI: the key goes in through setConfig and never comes back out; completions run in main
  ai: {
    getConfig: () => ipcRenderer.invoke('ai:get-config'),
    setConfig: (opts) => ipcRenderer.invoke('ai:set-config', opts),
    complete: (req) => ipcRenderer.invoke('ai:complete', req),
  },
  getVaultPath: () => ipcRenderer.invoke('get-vault-path'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content, opts) => ipcRenderer.invoke('write-file', filePath, content, opts),
  appendFile: (filePath, text) => ipcRenderer.invoke('append-file', filePath, text),
  listFiles: (dirPath) => ipcRenderer.invoke('list-files', dirPath),
  createFolder: (folderPath) => ipcRenderer.invoke('create-folder', folderPath),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  linkMention: (sourcePath, line, col, targetPath) => ipcRenderer.invoke('link-mention', sourcePath, line, col, targetPath),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  onVaultChanged: (callback) => subscribe('vault:changed', guard('vault:changed', (e, path) => callback(path))),
  // main asks for a save-everything before closing or switching vault. callback(asking) resolves false to veto
  // ("the user wants to keep unsaved text"); true, undefined or a throw let main proceed, and the ack is always sent.
  // The callback calls asking() before it blocks on a question to the user, so main's timeout does not cut the user short.
  onFlush: (callback) => subscribe('app:flush', async () => {
    let proceed = true;
    try {
      proceed = (await callback(() => { ipcRenderer.send('app:flush-asking'); })) !== false;
    } catch (err) {
      console.error('flush failed:', err);
    }
    ipcRenderer.send('app:flushed', proceed);
  }),
  onMenuAction: (action, callback) => subscribe('menu:' + action, guard('menu:' + action, () => callback())),
});
