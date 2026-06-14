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
const drafts = require('./draft-store');
const draftLoop = require('./draft-loop');

let win;

function notifyDraft(taskId) {
  if (win && !win.isDestroyed()) win.webContents.send('draft-updated', { taskId });
}
function startDraftLoop() {
  if (!cfg.load().url) return; // not connected yet — started again after setup
  draftLoop.start({ listInbox: () => mc.inbox(), onUpdate: notifyDraft });
}
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
  startDraftLoop();
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('bootstrap', async () => { const c = cfg.load(); return { connected: !!c.url, onboarded: !!scope.load().onboarded, url: c.url || '' }; });
ipcMain.handle('health', async () => mc.health());
function localOrigin(s) {
  try {
    const h = new URL(s).hostname.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch { return false; }
}
function rewriteUrl(s, connectedUrl) {
  if (typeof s !== 'string' || !/^https?:\/\//i.test(s)) return s;
  try {
    const src = new URL(s);
    if (!localOrigin(s)) return s;
    const base = new URL(connectedUrl);
    src.protocol = base.protocol;
    src.host = base.host;
    return src.toString();
  } catch { return s; }
}
function rewriteEndpoints(endpoints, connectedUrl) {
  return Object.fromEntries(Object.entries(endpoints || {}).map(([k, v]) => [k, rewriteUrl(v, connectedUrl)]));
}
function rewriteAgentCard(card, connectedUrl) {
  return { ...card, url: rewriteUrl(card.url, connectedUrl) };
}
function rewriteServiceCard(card, connectedUrl) {
  if (!card) return null;
  return {
    ...card,
    gateway_url: localOrigin(card.gateway_url) ? connectedUrl : card.gateway_url,
    endpoints: rewriteEndpoints(card.endpoints, connectedUrl),
    agents: Array.isArray(card.agents) ? card.agents.map((a) => rewriteAgentCard(a, connectedUrl)) : card.agents,
  };
}
ipcMain.handle('agent-cards', async () => {
  const connectedUrl = (cfg.load().url || '').replace(/\/$/, '');
  if (!connectedUrl) throw new Error('Connect to your TEE space first.');
  const [node, service, directory] = await Promise.all([
    mc.nodeCard({ url: connectedUrl }),
    mc.serviceCard({ url: connectedUrl }).catch(() => null),
    mc.services({ url: connectedUrl }).catch(() => ({ services: [] })),
  ]);
  const normalizedNode = {
    ...node,
    gateway_url: localOrigin(node.gateway_url) ? connectedUrl : (node.gateway_url || connectedUrl),
    agents: Array.isArray(node.agents) ? node.agents.map((a) => rewriteAgentCard(a, connectedUrl)) : [],
  };
  return {
    connected_url: connectedUrl,
    node: normalizedNode,
    service: rewriteServiceCard(service, connectedUrl),
    services: (directory.services || []).map((s) => rewriteServiceCard(s, connectedUrl)),
  };
});
ipcMain.handle('setup', async (_e, { url, token }) => {
  const clean = String(url).replace(/\/$/, '');
  cfg.save({ url: clean });
  await require('./identity').claim(clean, token || '');
  startDraftLoop();
  return { ok: true };
});
// Demo expertise: hardcoded per-space in <home>/personas.json so the three demo URLs are pinned
// deterministically and never committed to git. Falls back to keyword inference for unmapped
// spaces (e.g. localhost) so something real still shows. Format: { "<url-substring>": "<expertise>" }.
function personaExpertise(url) {
  try {
    const map = JSON.parse(require('fs').readFileSync(path.join(cfg.DIR, 'personas.json'), 'utf8'));
    for (const [sub, exp] of Object.entries(map)) {
      if (sub && !sub.startsWith('_') && url.includes(sub)) return exp;
    }
  } catch { /* no personas file — fall through to inference */ }
  return null;
}
ipcMain.handle('seed', async () => {
  const { pairs, stats } = agentLogs.ingestCorpus({ days: 7, maxPairs: 1500 });
  const { chains } = agentLogs.ingestStyle({ days: 7 });
  const r = await mc.uploadKnowledge(pairs, chains);
  const expertise = personaExpertise(cfg.load().url || '') || agentLogs.inferExpertise(pairs).domain;
  return { uploaded: r.count, convos: stats.convos, sessions: stats.sessions, days: stats.days, bySource: stats.bySource, expertise };
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
ipcMain.handle('ask-provider', async (_e, payload) => mc.requestProvider(payload || {}));
ipcMain.handle('drafts', async () => drafts.all());
ipcMain.handle('draft-get', async (_e, { id }) => drafts.get(id));
ipcMain.handle('redraft', async (_e, { id }) => {
  const t = await mc.getTask(id);
  return draftLoop.draftTask(t, { onUpdate: notifyDraft });
});
ipcMain.handle('approve', async (_e, { id, text }) => {
  const d = drafts.get(id);
  const reply = (text != null ? text : (d && d.status === 'ready' ? d.text : '')) || '';
  const t = await mc.approve(id, reply);
  store.record({ taskId: id, verdict: 'approve' });
  drafts.remove(id);
  return t;
});
ipcMain.handle('followup', async (_e, { id, msg }) => { const t = await mc.followup(id, msg); store.record({ taskId: id, verdict: 'followup', instruction: msg }); return t; });
ipcMain.handle('decline', async (_e, { id, note }) => { const t = await mc.decline(id, note); store.record({ taskId: id, verdict: 'decline', note }); return t; });
