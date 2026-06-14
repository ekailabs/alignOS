'use strict';
// Granted-folders store + flags. Deny-by-default: only listed folders are readable, and the
// granted set is the sandbox the local agent-log reader may use.
// Stored in ~/.alignos/scope.json (ALIGN_HOME overrides via config.js).
const fs = require('fs');
const path = require('path');
const { DIR, ensureDir } = require('./config');

const SCOPE = path.join(DIR, 'scope.json');
const DEFAULT = { folders: [], useHistory: false, useAllLogs: false };

function load() {
  try { return { ...DEFAULT, ...JSON.parse(fs.readFileSync(SCOPE, 'utf8')) }; }
  catch { return { ...DEFAULT }; }
}
function save(s) { ensureDir(); fs.writeFileSync(SCOPE, JSON.stringify(s, null, 2)); return s; }

function grant(folders, { useHistory = true, useAllLogs = false } = {}) {
  const s = load();
  s.folders = [...new Set([...s.folders, ...folders])];
  s.useHistory = useHistory;
  s.useAllLogs = useAllLogs;
  return save(s);
}
function revoke(folder) {
  const s = load();
  s.folders = s.folders.filter((f) => f !== folder);
  return save(s);
}
// Deny-by-default: a path is allowed only if it is, or is under, a granted folder.
function allows(p) {
  return load().folders.some((f) => p === f || p.startsWith(f.replace(/\/$/, '') + path.sep));
}

module.exports = { SCOPE, load, save, grant, revoke, allows };
