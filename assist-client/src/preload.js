'use strict';
// The only renderer↔main surface. Mirrors the CLI verbs.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alignos', {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  health: () => ipcRenderer.invoke('health'),
  agentCards: () => ipcRenderer.invoke('agent-cards'),
  setup: (payload) => ipcRenderer.invoke('setup', payload),
  seed: () => ipcRenderer.invoke('seed'),
  suggestFolders: () => ipcRenderer.invoke('suggest-folders'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  grantFolders: (folders, opts) => ipcRenderer.invoke('grant-folders', { folders, ...opts }),
  skipOnboarding: () => ipcRenderer.invoke('skip-onboarding'),
  inbox: () => ipcRenderer.invoke('inbox'),
  handled: () => ipcRenderer.invoke('handled'),
  show: (id) => ipcRenderer.invoke('show', { id }),
  askProvider: (payload) => ipcRenderer.invoke('ask-provider', payload),
  approve: (id) => ipcRenderer.invoke('approve', { id }),
  followup: (id, msg) => ipcRenderer.invoke('followup', { id, msg }),
  decline: (id, note) => ipcRenderer.invoke('decline', { id, note }),
});
