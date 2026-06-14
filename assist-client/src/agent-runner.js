'use strict';
// Call the owner's local Claude Code / Codex CLI to draft a reply, read-only, in their
// workspace. Pure logic (no Electron) so main.js and bin/alignos share it. The prompt is
// always the LAST argv element, so override flags compose cleanly.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const cfg = require('./config');

function onPath(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* keep looking */ }
  }
  return null;
}

// Resolve the CLI to use. 'auto' prefers claude, falls back to codex. null = none installed.
function detectCli(agent = cfg.agentConfig()) {
  const claude = onPath('claude');
  const codex = onPath('codex');
  if (agent.cli === 'claude') return claude ? { cmd: claude, kind: 'claude' } : null;
  if (agent.cli === 'codex') return codex ? { cmd: codex, kind: 'codex' } : null;
  if (claude) return { cmd: claude, kind: 'claude' };
  if (codex) return { cmd: codex, kind: 'codex' };
  return null;
}

function partsText(parts) {
  return (parts || []).filter((p) => p && p.kind === 'text').map((p) => p.text).join('\n');
}

function buildPrompt(task) {
  const who = (task.from && task.from.display) || 'someone';
  const ask = partsText(task.history && task.history[0] && task.history[0].parts);
  return [
    `You are drafting a reply on behalf of the owner of this workspace.`,
    `${who} sent this request:`,
    ``,
    ask,
    ``,
    `Write the reply the owner would send. Ground it in this workspace's files when relevant.`,
    `Reply in plain text only — no preamble, no markdown headers, just the message body.`,
    `Do not modify any files; this is read-only.`,
  ].join('\n');
}

// Read-only flags only — the prompt is delivered on stdin (below), NOT as an argv element.
// claude's `--disallowedTools` is variadic and would otherwise swallow a trailing prompt as
// tool names; stdin sidesteps all arg-ordering ambiguity for both CLIs.
function flagsFor(kind, agent) {
  if (kind === 'claude') return agent.claudeArgs || ['-p', '--disallowedTools', 'Edit', 'Write', 'NotebookEdit'];
  return agent.codexArgs || ['exec', '--sandbox', 'read-only', '--skip-git-repo-check'];
}

function runDraft(task, { workspace, agent = cfg.agentConfig(), timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const cli = detectCli(agent);
    if (!cli) return reject(new Error('No local agent CLI found — install Claude Code (`claude`) or Codex (`codex`).'));
    const args = flagsFor(cli.kind, agent);
    // No shell — args are read-only flags only; the prompt goes on stdin (no injection surface).
    const child = spawn(cli.cmd, args, { cwd: workspace || process.cwd(), env: process.env });
    child.stdin.on('error', () => {}); // ignore EPIPE if the CLI closes stdin early
    child.stdin.write(buildPrompt(task));
    child.stdin.end();
    const limit = timeoutMs || agent.timeoutMs || 120000;
    let out = '', err = '', done = false;
    const finish = (fn, arg) => { if (done) return; done = true; clearTimeout(timer); fn(arg); };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new Error(`Drafting timed out after ${Math.round(limit / 1000)}s.`));
    }, limit);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish(reject, new Error(`Could not run ${cli.kind}: ${e.message}`)));
    child.on('close', (code) => {
      if (code !== 0) return finish(reject, new Error(`${cli.kind} exited ${code}${err ? ': ' + err.trim().slice(0, 200) : ''}`));
      const text = out.trim();
      if (!text) return finish(reject, new Error(`${cli.kind} produced an empty draft.`));
      finish(resolve, { text, cli: cli.kind });
    });
  });
}

module.exports = { detectCli, buildPrompt, flagsFor, runDraft };
