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
  approve: (id, text) => ipcRenderer.invoke('approve', { id, text }),
  drafts: () => ipcRenderer.invoke('drafts'),
  draftGet: (id) => ipcRenderer.invoke('draft-get', { id }),
  redraft: (id) => ipcRenderer.invoke('redraft', { id }),
  onDraftUpdated: (cb) => ipcRenderer.on('draft-updated', (_e, payload) => cb(payload)),
  followup: (id, msg, draftText) => ipcRenderer.invoke('followup', { id, msg, draftText }),
  decline: (id, note) => ipcRenderer.invoke('decline', { id, note }),
});
