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

// Agent-drafting settings with defaults applied. Read by agent-runner and draft-loop so the
// defaults live in exactly one place. Override any field via the `agent` block in config.json.
function agentConfig() {
  return {
    cli: 'auto',          // 'auto' | 'claude' | 'codex'  (auto prefers claude)
    workspace: null,      // absolute path; null → first granted folder, else cwd
    timeoutMs: 120000,
    concurrency: 1,
    autoDraft: true,
    claudeArgs: null,     // override flags (prompt is always appended last)
    codexArgs: null,
    ...(load().agent || {}),
  };
}

module.exports = { DIR, CONFIG, ensureDir, load, save, agentConfig };
