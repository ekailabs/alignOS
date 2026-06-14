'use strict';
// Local draft overlay: locally-generated replies, keyed by taskId, in ~/.alignos/drafts.json.
// status ∈ {'drafting','ready','error'}. Keyed by taskId so drafting is idempotent across
// re-polls and app restarts. Raw workspace files never land here — only the reply text.
const fs = require('fs');
const path = require('path');
const { DIR, ensureDir } = require('./config');

const DRAFTS = path.join(DIR, 'drafts.json');

function readAll() {
  try { return JSON.parse(fs.readFileSync(DRAFTS, 'utf8')); } catch { return {}; }
}
function writeAll(map) {
  ensureDir();
  fs.writeFileSync(DRAFTS, JSON.stringify(map, null, 2));
}

function all() { return readAll(); }
function get(taskId) { return readAll()[taskId] || null; }
function set(taskId, patch) {
  const map = readAll();
  const next = { ...(map[taskId] || {}), ...patch, at: new Date().toISOString() };
  map[taskId] = next;
  writeAll(map);
  return next;
}
function remove(taskId) {
  const map = readAll();
  delete map[taskId];
  writeAll(map);
}

module.exports = { DRAFTS, all, get, set, remove };
