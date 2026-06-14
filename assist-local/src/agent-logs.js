'use strict';
// Read only the owner's approved local agent-log roots and compact them into a redacted
// digest — the local "your own work is the signal" grounding source.
// Standalone, deny-by-default-friendly, secrets masked before anything is returned.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { redact } = require('./redact');

const HOME = os.homedir();
// Owner-approved local agent-log roots. Keep this list narrow: raw logs never leave
// the machine, and only redacted prompt/output pairs from these roots may be uploaded.
const LOG_SOURCES = [
  { dir: path.join(HOME, '.claude'), source: 'claude' },
  { dir: path.join(HOME, '.codex'), source: 'codex' },
  { dir: path.join(HOME, '.openclaw'), source: 'openclaw' },
  { dir: path.join(HOME, '.pi'), source: 'pi' },
  { dir: path.join(HOME, '.opencode'), source: 'opencode' },
  { dir: path.join(HOME, '.hermes'), source: 'hermes' },
];
const OPENCODE_STORAGE = path.join(HOME, '.opencode', 'storage');
const TEXT_EXTS = new Set(['.jsonl', '.ndjson', '.json', '.log', '.txt', '.md']);

function walk(dir, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (TEXT_EXTS.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

function sourceAllowed(dir, allow) {
  if (!allow) return true;
  for (const a of allow) {
    const root = a.replace(/\/$/, '');
    if (dir === root || dir.startsWith(root + path.sep)) return true;
  }
  return false;
}

function relativeLabel(file, root, source) {
  const rel = path.relative(root, file);
  if (source === 'claude' && rel.startsWith(`projects${path.sep}`)) {
    return path.basename(path.dirname(file));
  }
  if (source === 'codex' && rel.startsWith(`sessions${path.sep}`)) {
    return 'codex/' + path.basename(file).slice(8, 18);
  }
  const parent = path.dirname(rel);
  return parent && parent !== '.' ? `${source}/${parent}` : source;
}

// Recent session/log files across the approved source roots, newest first. (allow = optional
// Set of allowed source dirs for deny-by-default scope; null = all built-in roots.)
function recentFiles(days, allow = null) {
  const cutoff = Date.now() - days * 86400000;
  const files = [];
  for (const { dir, source } of LOG_SOURCES) {
    if (!sourceAllowed(dir, allow)) continue;
    for (const f of walk(dir)) {
      let st; try { st = fs.statSync(f); } catch { continue; }
      if (st.mtimeMs < cutoff) continue;
      const project = relativeLabel(f, dir, source);
      files.push({ file: f, source, mtimeMs: st.mtimeMs, project });
    }
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function pullText(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map((p) => (p && ['text', 'input_text', 'output_text'].includes(p.type) ? (p.text || '')
      : (typeof p === 'string' ? p : (p && p.content ? pullText(p.content) : '')))).filter(Boolean).join(' ');
  }
  if (typeof c === 'object') {
    return c.text || (typeof c.message === 'string' ? c.message : '') || (c.content ? pullText(c.content) : '') || '';
  }
  return '';
}

function normalizeRole(role) {
  if (role === 'assistant' || role === 'user') return role;
  if (role === 'model') return 'assistant';
  return null;
}

function parseGenericMessage(j) {
  const p = j.payload || j;
  if (p && p.type === 'message' && p.role) {
    return { role: normalizeRole(p.role), text: pullText(p.content != null ? p.content : p.text).trim() };
  }
  if (p && p.message && typeof p.message === 'object' && p.message.role) {
    return { role: normalizeRole(p.message.role), text: pullText(p.message.content != null ? p.message.content : p.message.text).trim() };
  }
  if (p && (p.type === 'user_message' || p.type === 'agent_message')) {
    return {
      role: p.type === 'user_message' ? 'user' : 'assistant',
      text: pullText(p.message != null ? p.message : p.text).trim(),
      fallback: true,
    };
  }
  return null;
}

// opencode keeps a structured JSON store (not jsonl). Project worktrees are the folders.
function opencodeFolders(cutoff) {
  const out = [];
  const pdir = path.join(OPENCODE_STORAGE, 'project');
  let files = [];
  try { files = fs.readdirSync(pdir).filter((f) => f.endsWith('.json')); } catch { return out; }
  for (const f of files) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(pdir, f), 'utf8')); } catch { continue; }
    const p = j.worktree || j.path;
    if (!p || p === HOME || p === '/' || p.length < 4) continue;
    const last = (j.time && (j.time.updated || j.time.created)) || 0;
    if (cutoff && last && last < cutoff) continue;
    out.push({ path: p, lastActive: last });
  }
  return out;
}

function readSession(file, source) {
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { return []; }
  const msgs = [];
  const fallback = [];
  for (const ln of lines) {
    let j;
    try { j = JSON.parse(ln); } catch {
      const t = ln.trim();
      if (t.length > 1) msgs.push({ role: source, text: t });
      continue;
    }
    if (source === 'claude') {
      if (j.type === 'user' || j.type === 'assistant') {
        const t = pullText(j.message && j.message.content).trim();
        if (t && !t.startsWith('<command') && !t.startsWith('[{')) msgs.push({ role: j.type, text: t });
      }
    } else {
      const m = parseGenericMessage(j);
      if (!m || !m.role || !m.text || m.text.length <= 1 || m.text.startsWith('{')) continue;
      (m.fallback ? fallback : msgs).push({ role: m.role, text: m.text });
    }
  }
  return msgs.length ? msgs : fallback;
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
    if (j.cwd && typeof j.cwd === 'string') return j.cwd;
    if (j.projectPath && typeof j.projectPath === 'string') return j.projectPath;
    if (j.workspace && typeof j.workspace === 'string') return j.workspace;
  }
  return null;
}

// Folders the owner has actually worked in recently — onboarding suggestions, ranked by
// recency then activity. Each: { path, sessions, lastActive, sources }.
function suggestFolders({ days = 30 } = {}) {
  const cutoff = Date.now() - days * 86400000;
  const agg = new Map();
  for (const { dir, source } of LOG_SOURCES) {
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
  for (const o of opencodeFolders(cutoff)) {
    const e = agg.get(o.path) || { path: o.path, sessions: 0, lastActive: 0, sources: new Set() };
    e.sessions += 1;
    e.lastActive = Math.max(e.lastActive, o.lastActive || 0);
    e.sources.add('opencode');
    agg.set(o.path, e);
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

// Ordered user prompts within one session — the owner's refinement moves (redacted, capped).
function userPromptChain(msgs, { maxLen = 280, maxTurns = 8 } = {}) {
  const out = [];
  for (const m of msgs) {
    if (m.role !== 'user') continue;
    const t = stripCode(String(m.text || '')).replace(/\s+/g, ' ').trim();
    if (t.length < 8) continue;
    out.push(redact(t).masked.slice(0, maxLen));
    if (out.length >= maxTurns) break;
  }
  return out;
}

// Build redacted prompt chains across recent sessions — the corpus that teaches the loop how
// the owner iterates. Mirrors ingestCorpus(); chains with <2 turns are skipped.
function ingestStyle({ days = 7, maxChains = 60, maxLen = 280, maxTurns = 8 } = {}) {
  const files = recentFiles(days);
  const chains = [];
  for (const f of files) {
    if (chains.length >= maxChains) break;
    const msgs = readSession(f.file, f.source);
    const chain = userPromptChain(msgs, { maxLen, maxTurns });
    if (chain.length >= 2) chains.push(chain);
  }
  return { chains };
}

// Moment 1: distill recent sessions into redacted { prompt -> final NL output } pairs —
// the corpus that teaches the agent how the owner prompts/communicates. Tool output, code,
// and snippets are removed; secrets redacted. Default is the last 7 days; pass days=null
// only for an explicit all-history import.
function ingestCorpus({ days = 7, maxPairs = 2000, maxLen = 700, project = null } = {}) {
  const cutoff = days ? Date.now() - days * 86400000 : 0;
  const files = [];
  for (const { dir, source } of LOG_SOURCES) {
    for (const f of walk(dir)) {
      let st; try { st = fs.statSync(f); } catch { continue; }
      if (st.mtimeMs < cutoff) continue;
      const proj = relativeLabel(f, dir, source);
      files.push({ file: f, source, mtimeMs: st.mtimeMs, project: proj });
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const pairs = [];
  const bySource = {};
  const convoSet = new Set(); // distinct conversations that contributed ≥1 redacted example
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
      bySource[f.source] = (bySource[f.source] || 0) + 1;
      convoSet.add(f.file);
      if (pairs.length >= maxPairs) break;
    }
  }
  return { pairs, stats: { pairs: pairs.length, convos: convoSet.size, sessions: files.length, bySource, days } };
}

// Light expertise read: tally domain keywords across the redacted corpus and project labels,
// pick the strongest of our three agent-card domains (Albi / Andrew / Shashank). Used only to
// greet the owner ("expert in X") — never uploaded, never a gate. A per-URL override
// (personas.json) pins this deterministically for the demo.
const EXPERTISE = [
  { domain: 'GTM, PMF, and product development', kw: /\b(gtm|go-?to-?market|pmf|product-?market fit|positioning|launch|growth|startup|customers|product development)\b/ },
  { domain: 'confidential compute, privacy, and security', kw: /\b(confidential comput\w*|tee|enclave|privacy|security|attestation|dstack|phala|kms|trusted execution)\b/ },
  { domain: 'system design and agent infrastructure', kw: /\b(system design|distributed systems?|agent infra\w*|orchestration|routing|scalability|architecture|infrastructure)\b/ },
];
function inferExpertise(pairs) {
  const text = pairs.map((p) => `${p.project} ${p.prompt}`).join(' \n ').toLowerCase();
  let best = EXPERTISE[0], bestN = 0;
  for (const e of EXPERTISE) {
    const m = text.match(new RegExp(e.kw.source, 'g'));
    const n = m ? m.length : 0;
    if (n > bestN) { bestN = n; best = e; }
  }
  return { domain: best.domain, signal: bestN };
}

module.exports = { LOG_SOURCES, digest, recentFiles, readSession, sessionCwd, suggestFolders, ingestCorpus, inferExpertise, userPromptChain, ingestStyle };
