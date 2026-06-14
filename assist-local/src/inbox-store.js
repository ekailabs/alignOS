'use strict';
// The kept-for-later signal: every human decision appends to ~/.alignos/decisions.jsonl.
// (No rubric, no training in v1 — capture only. This is what future eval/RLHF consumes.)
const fs = require('fs');
const path = require('path');
const { DIR, ensureDir } = require('./config');

const DECISIONS = path.join(DIR, 'decisions.jsonl');

function record(entry) {
  ensureDir();
  fs.appendFileSync(DECISIONS, JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n');
}

module.exports = { DECISIONS, record };
