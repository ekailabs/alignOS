'use strict';
// Read the owner's recent Claude Code (~/.claude) + Codex (~/.codex) sessions and compact
// them into a redacted digest — the local "your own work is the signal" grounding source.
// Standalone (our own), deny-by-default-friendly, secrets masked before anything is returned.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { redact } = require('./redact');

const HOME = os.homedir();
const SOURCES = [
  [path.join(HOME, '.claude', 'projects'), 'claude'],
  [path.join(HOME, '.codex', 'sessions'), 'codex'],
];

function walk(dir, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

// Recent session files across both sources, newest first. (allow = optional Set of allowed
// source dirs for deny-by-default scope; null = both.)
function recentFiles(days, allow = null) {
  const cutoff = Date.now() - days * 86400000;
  const files = [];
  for (const [dir, source] of SOURCES) {
    if (allow && !allow.has(dir)) continue;
    for (const f of walk(dir)) {
      let st; try { st = fs.statSync(f); } catch { continue; }
      if (st.mtimeMs < cutoff) continue;
      const project = source === 'claude'
        ? path.basename(path.dirname(f))
        : 'codex/' + path.basename(f).slice(8, 18);
      files.push({ file: f, source, mtimeMs: st.mtimeMs, project });
    }
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function pullText(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (p && p.type === 'text' ? (p.text || '') : (typeof p === 'string' ? p : ''))).filter(Boolean).join(' ');
  if (typeof c === 'object') return c.text || (typeof c.message === 'string' ? c.message : '') || '';
  return '';
}

function readSession(file, source) {
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { return []; }
  const msgs = [];
  for (const ln of lines) {
    let j; try { j = JSON.parse(ln); } catch { continue; }
    if (source === 'claude') {
      if (j.type === 'user' || j.type === 'assistant') {
        const t = pullText(j.message && j.message.content).trim();
        if (t && !t.startsWith('<command') && !t.startsWith('[{')) msgs.push({ role: j.type, text: t });
      }
    } else {
      const p = j.payload || j;
      if (p && (p.role || p.type === 'message' || j.type === 'response_item' || j.type === 'event_msg')) {
        const t = pullText(p.content != null ? p.content : (p.message != null ? p.message : p.text)).trim();
        if (t && t.length > 1 && !t.startsWith('{')) msgs.push({ role: p.role || 'agent', text: t });
      }
    }
  }
  return msgs;
}

// Compact recent sessions into a redacted, size-bounded digest, grouped by project.
function digest({ days = 3, maxChars = 22000, perMsg = 360, allow = null } = {}) {
  const files = recentFiles(days, allow);
  const byProject = new Map();
  for (const f of files) {
    if (!byProject.has(f.project)) byProject.set(f.project, []);
    byProject.get(f.project).push(f);
  }
  const out = [];
  let chars = 0, sessions = 0;
  for (const [project, group] of byProject) {
    const label = project.replace(/^-Users-[^-]+-/, '').replace(/-/g, '/');
    let block = '';
    for (const f of group.slice(0, 6)) {
      const msgs = readSession(f.file, f.source);
      if (!msgs.length) continue;
      sessions++;
      for (const m of msgs.slice(-14)) block += `- ${m.role}: ${m.text.replace(/\s+/g, ' ').slice(0, perMsg)}\n`;
    }
    if (!block) continue;
    const section = `\n## ${label}\n${block}`;
    out.push(section);
    chars += section.length;
    if (chars > maxChars) break;
  }
  let text = redact(out.join('')).masked;
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n…(truncated)';
  return { digest: text, stats: { sessions, projects: byProject.size, days } };
}

// The real working directory recorded inside a session (robust vs. decoding the dir name).
function sessionCwd(file, source) {
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split('\n', 60); } catch { return null; }
  for (const ln of lines) {
    if (!ln) continue;
    let j; try { j = JSON.parse(ln); } catch { continue; }
    if (source === 'claude' && j.cwd) return j.cwd;
    if (source === 'codex' && j.payload && j.payload.cwd) return j.payload.cwd;
  }
  return null;
}

// Folders the owner has actually worked in recently — onboarding suggestions, ranked by
// recency then activity. Each: { path, sessions, lastActive, sources }.
function suggestFolders({ days = 30 } = {}) {
  const cutoff = Date.now() - days * 86400000;
  const agg = new Map();
  for (const [dir, source] of SOURCES) {
    for (const f of walk(dir)) {
      let st; try { st = fs.statSync(f); } catch { continue; }
      if (st.mtimeMs < cutoff) continue;
      const cwd = sessionCwd(f, source);
      if (!cwd || cwd === HOME) continue;
      const e = agg.get(cwd) || { path: cwd, sessions: 0, lastActive: 0, sources: new Set() };
      e.sessions++;
      e.lastActive = Math.max(e.lastActive, st.mtimeMs);
      e.sources.add(source);
      agg.set(cwd, e);
    }
  }
  return [...agg.values()]
    .map((e) => ({ path: e.path, sessions: e.sessions, lastActive: e.lastActive, sources: [...e.sources].sort().join('+') }))
    .sort((a, b) => b.lastActive - a.lastActive || b.sessions - a.sessions);
}

// Strip code so the corpus is natural language only (we want how the user PROMPTS, not code).
function stripCode(s) {
  return String(s || '')
    .replace(/```[\s\S]*?```/g, '[code]')                 // fenced blocks
    .replace(/`[^`\n]{40,}`/g, '[code]')                  // long inline code
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Moment 1: distill every session into redacted { prompt -> final NL output } pairs — the
// corpus that teaches the agent how the owner prompts/communicates. Tool output, code, and
// snippets are removed; secrets redacted. days=null = all history.
function ingestCorpus({ days = null, maxPairs = 2000, maxLen = 700, project = null } = {}) {
  const cutoff = days ? Date.now() - days * 86400000 : 0;
  const files = [];
  for (const [dir, source] of SOURCES) {
    for (const f of walk(dir)) {
      let st; try { st = fs.statSync(f); } catch { continue; }
      if (st.mtimeMs < cutoff) continue;
      const proj = source === 'claude' ? path.basename(path.dirname(f)) : 'codex';
      files.push({ file: f, source, mtimeMs: st.mtimeMs, project: proj });
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const pairs = [];
  for (const f of files) {
    if (pairs.length >= maxPairs) break;
    const label = f.project.replace(/^-Users-[^-]+-/, '').replace(/-/g, '/');
    if (project && label !== project) continue;
    const msgs = readSession(f.file, f.source); // already NL-ish (tool noise dropped)
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].role !== 'user') continue;
      const prompt = stripCode(msgs[i].text);
      if (prompt.length < 3 || prompt === '[code]') continue;
      const out = [];
      for (let j = i + 1; j < msgs.length && msgs[j].role !== 'user'; j++) {
        if (msgs[j].role === 'assistant') out.push(msgs[j].text);
      }
      const output = stripCode(out.join('\n'));
      if (!output) continue;
      pairs.push({
        project: label,
        prompt: redact(prompt).masked.slice(0, maxLen),
        output: redact(output).masked.slice(0, maxLen),
      });
      if (pairs.length >= maxPairs) break;
    }
  }
  return { pairs, stats: { pairs: pairs.length, sessions: files.length } };
}

module.exports = { digest, recentFiles, readSession, sessionCwd, suggestFolders, ingestCorpus };


