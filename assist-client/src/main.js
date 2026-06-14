'use strict';
// Electron main — thin: every handler just calls the shared src/ modules (same code the
// CLI uses). No logic lives here.
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const mc = require('./mesh-client');
const cfg = require('./config');
const store = require('./inbox-store');
const scope = require('./scope');
const agentLogs = require('./agent-logs');

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 720, height: 880, minWidth: 560, minHeight: 600,
    title: 'AlignOS', backgroundColor: '#EFEDE6', titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('bootstrap', async () => { const c = cfg.load(); return { connected: !!c.url, onboarded: !!scope.load().onboarded, url: c.url || '' }; });
ipcMain.handle('health', async () => mc.health());
ipcMain.handle('setup', async (_e, { url, token }) => {
  const clean = String(url).replace(/\/$/, '');
  cfg.save({ url: clean });
  if (token) await require('./identity').claim(clean, token);
  return { ok: true };
});
ipcMain.handle('seed', async () => {
  const { pairs, stats } = agentLogs.ingestCorpus({ days: 7, maxPairs: 1500 });
  const r = await mc.uploadKnowledge(pairs);
  return { uploaded: r.count, sessions: stats.sessions, days: stats.days, bySource: stats.bySource };
});
ipcMain.handle('suggest-folders', async () => agentLogs.suggestFolders({ days: 30 }));
ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], message: 'Folder your assistant may read' });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('grant-folders', async (_e, { folders, useHistory, useAllLogs }) => {
  const s = scope.grant(folders || [], { useHistory: !!useHistory, useAllLogs: !!useAllLogs });
  return scope.save({ ...s, onboarded: true });
});
ipcMain.handle('skip-onboarding', async () => scope.save({ ...scope.load(), onboarded: true }));
ipcMain.handle('inbox', async () => mc.inbox());
ipcMain.handle('handled', async () => mc.handled());
ipcMain.handle('show', async (_e, { id }) => mc.getTask(id));
ipcMain.handle('approve', async (_e, { id }) => { const t = await mc.approve(id); store.record({ taskId: id, verdict: 'approve' }); return t; });
ipcMain.handle('followup', async (_e, { id, msg }) => { const t = await mc.followup(id, msg); store.record({ taskId: id, verdict: 'followup', instruction: msg }); return t; });
ipcMain.handle('decline', async (_e, { id, note }) => { const t = await mc.decline(id, note); store.record({ taskId: id, verdict: 'decline', note }); return t; });
