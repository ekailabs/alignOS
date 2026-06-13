'use strict';
// Non-secret connection config in ~/.alignos/config.json (ALIGN_HOME overrides the dir).
// The owner private key lives separately (identity.js): OS keychain or a 0600 file.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = process.env.ALIGN_HOME || path.join(os.homedir(), '.alignos');
const CONFIG = path.join(DIR, 'config.json');

function ensureDir() { fs.mkdirSync(DIR, { recursive: true }); }
function load() { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; } }
function save(patch) {
  ensureDir();
  const next = { ...load(), ...patch };
  fs.writeFileSync(CONFIG, JSON.stringify(next, null, 2));
  return next;
}

module.exports = { DIR, CONFIG, ensureDir, load, save };
