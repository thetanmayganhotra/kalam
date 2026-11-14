const { contextBridge, ipcRenderer } = require('electron');

// Per-launch token for our local server's /api/* (see server.js).
const tokenArg = process.argv.find((a) => a.startsWith('--kalam-token='));
contextBridge.exposeInMainWorld('kalamApi', { token: tokenArg ? tokenArg.slice('--kalam-token='.length) : '' });

contextBridge.exposeInMainWorld('kalamFS', {
  open: () => ipcRenderer.invoke('file:open'),
  save: (args) => ipcRenderer.invoke('file:save', args),
  pdf: (args) => ipcRenderer.invoke('pdf:export', args),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
});

// Groq key + voice settings. The key goes in once and is never handed back to the page (only a masked hint).
contextBridge.exposeInMainWorld('kalamAccount', {
  status: () => ipcRenderer.invoke('account:status'),
  setupSeen: () => ipcRenderer.invoke('account:setupSeen'),
  setKey: (key) => ipcRenderer.invoke('account:setKey', key),
  clearKey: () => ipcRenderer.invoke('account:clearKey'),
  setVoiceMode: (mode) => ipcRenderer.invoke('voice:setMode', mode),
  downloadOffline: () => ipcRenderer.invoke('offline:download'),
  cancelOffline: () => ipcRenderer.invoke('offline:cancel'),
  removeOffline: () => ipcRenderer.invoke('offline:remove'),
  onOfflineProgress: (fn) => ipcRenderer.on('offline:progress', (_e, st) => fn(st)),
  on: (name, fn) => {
    const ch = { settings: 'ui:settings' }[name];
    if (ch) ipcRenderer.on(ch, () => fn());
  },
});
