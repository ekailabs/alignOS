'use strict';
// The only renderer↔main surface. Mirrors the CLI verbs.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alignos', {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  setup: (payload) => ipcRenderer.invoke('setup', payload),
  inbox: () => ipcRenderer.invoke('inbox'),
  handled: () => ipcRenderer.invoke('handled'),
  show: (id) => ipcRenderer.invoke('show', { id }),
  approve: (id) => ipcRenderer.invoke('approve', { id }),
  followup: (id, msg) => ipcRenderer.invoke('followup', { id, msg }),
  decline: (id, note) => ipcRenderer.invoke('decline', { id, note }),
});
