# Local Agent Drafting for the Inbox — Implementation Plan

**Goal:** For every incoming `input-required` request, run the owner's local `claude` or `codex` CLI read-only in their workspace and fill the result into the inbox as an editable draft that gets sent on approve.

**Architecture:** A background drafting loop in the Electron main process polls the inbox, calls a shared read-only CLI runner (cwd = the owner's workspace), and writes results to a local draft-overlay store (`~/.alignos/drafts.json`). The renderer shows the overlay draft, refreshes live on a `draft-updated` event, and sends the (possibly edited) draft text on approve. Fully contained in `assist-local`; no backend changes.

**Tech Stack:** Node.js (CommonJS), Electron 33 (`ipcMain`/`preload` bridge), `child_process.spawn`, plain `node` assert tests. No new dependencies.

---

## File Structure

**New files**
- `assist-local/src/draft-store.js` — overlay persistence in `~/.alignos/drafts.json`.
- `assist-local/src/agent-runner.js` — CLI detection + prompt build + read-only spawn.
- `assist-local/src/draft-loop.js` — inbox sweep, bounded queue, per-task drafting.
- `assist-local/test/draft-store.test.js`
- `assist-local/test/agent-runner.test.js`
- `assist-local/test/draft-loop.test.js`
- `assist-local/test/mesh-approve.test.js`

**Modified files**
- `assist-local/src/config.js` — add `agentConfig()` defaults helper.
- `assist-local/src/mesh-client.js` — `approve(taskId, text)`.
- `assist-local/src/main.js` — IPC handlers (`drafts`/`draft-get`/`redraft`), `approve` sends draft text, start the loop.
- `assist-local/src/preload.js` — expose `drafts`/`draftGet`/`redraft`/`onDraftUpdated`, `approve(id, text)`.
- `assist-local/renderer/app.js` — inbox chips, review editable draft, redraft, live refresh, MOCK.
- `assist-local/renderer/index.html` — editable draft textarea + redraft control.
- `assist-local/renderer/styles.css` — draft chip + editable-draft styling.
- `assist-local/bin/alignos` — `draft <id>` and `watch` commands.

> All commands below assume cwd `assist-local/`. Commit messages omit any Co-Authored-By trailer (repo convention).

---

## Task 1: Draft overlay store

**Files:**
- Create: `assist-local/src/draft-store.js`
- Test: `assist-local/test/draft-store.test.js`

- [ ] **Step 1: Write the failing test**

Create `assist-local/test/draft-store.test.js`:

```javascript
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Point ~/.alignos at a temp dir BEFORE requiring config-backed modules.
process.env.ALIGN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'alignos-drafts-'));
const store = require('../src/draft-store');

// starts empty
assert.deepStrictEqual(store.all(), {});
assert.strictEqual(store.get('t1'), null);

// set creates and timestamps
const a = store.set('t1', { status: 'drafting' });
assert.strictEqual(a.status, 'drafting');
assert.ok(a.at, 'stamps `at`');

// set merges into the existing entry
const b = store.set('t1', { status: 'ready', text: 'hello' });
assert.strictEqual(b.status, 'ready');
assert.strictEqual(b.text, 'hello');
assert.strictEqual(store.get('t1').text, 'hello');

// persisted to disk
assert.ok(fs.existsSync(store.DRAFTS));
assert.strictEqual(JSON.parse(fs.readFileSync(store.DRAFTS, 'utf8')).t1.text, 'hello');

// remove
store.remove('t1');
assert.strictEqual(store.get('t1'), null);

console.log('draft-store: OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/draft-store.test.js`
Expected: FAIL with `Cannot find module '../src/draft-store'`.

- [ ] **Step 3: Write the implementation**

Create `assist-local/src/draft-store.js`:

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/draft-store.test.js`
Expected: `draft-store: OK`

- [ ] **Step 5: Commit**

```bash
git add src/draft-store.js test/draft-store.test.js
git commit -m "feat(assist-local): local draft overlay store"
```

---

## Task 2: Read-only agent runner

**Files:**
- Modify: `assist-local/src/config.js` (add `agentConfig()`)
- Create: `assist-local/src/agent-runner.js`
- Test: `assist-local/test/agent-runner.test.js`

- [ ] **Step 1: Add the config defaults helper**

In `assist-local/src/config.js`, add `agentConfig` and export it. Replace the export line:

```javascript
module.exports = { DIR, CONFIG, ensureDir, load, save };
```

with:

```javascript
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
```

- [ ] **Step 2: Write the failing test**

Create `assist-local/test/agent-runner.test.js`:

```javascript
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.ALIGN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'alignos-runner-home-'));
const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'alignos-bin-'));
const log = path.join(bin, 'args.txt');

function writeStub(body) {
  fs.writeFileSync(path.join(bin, 'claude'), body);
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
}
// fake `claude`: record the argv it received, echo a canned reply.
writeStub(`#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync(${JSON.stringify(log)}, process.argv.slice(2).join('\\n'));
process.stdout.write('Thursday at 2pm works for me.');
`);
process.env.PATH = bin + path.delimiter + process.env.PATH;

const runner = require('../src/agent-runner');
const task = {
  from: { display: "Devon's assistant" },
  history: [{ role: 'user', parts: [{ kind: 'text', text: 'Are you free Thursday?' }] }],
};

(async () => {
  // detection
  const cli = runner.detectCli({ cli: 'auto' });
  assert.ok(cli && cli.kind === 'claude', 'detects claude on PATH');

  // happy path
  const r = await runner.runDraft(task, { workspace: bin, agent: { cli: 'auto' } });
  assert.strictEqual(r.text, 'Thursday at 2pm works for me.');
  assert.strictEqual(r.cli, 'claude');
  const delivered = fs.readFileSync(log, 'utf8');
  assert.ok(delivered.includes('Are you free Thursday?'), 'question reached the CLI');
  assert.ok(delivered.includes("Devon's assistant"), 'asker reached the CLI');

  // nonzero exit rejects with the exit code
  writeStub(`#!/bin/sh\necho boom 1>&2\nexit 3\n`);
  await assert.rejects(
    runner.runDraft(task, { workspace: bin, agent: { cli: 'auto' } }),
    /exited 3/,
  );

  // timeout kills the process
  writeStub(`#!/bin/sh\nsleep 5\n`);
  const t0 = Date.now();
  await assert.rejects(
    runner.runDraft(task, { workspace: bin, agent: { cli: 'auto' }, timeoutMs: 200 }),
    /timed out/,
  );
  assert.ok(Date.now() - t0 < 4000, 'killed well before the 5s sleep finished');

  // missing CLI rejects clearly
  const savedPath = process.env.PATH;
  process.env.PATH = '';
  await assert.rejects(
    runner.runDraft(task, { workspace: bin, agent: { cli: 'auto' } }),
    /No local agent CLI/,
  );
  process.env.PATH = savedPath;

  console.log('agent-runner: OK');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node test/agent-runner.test.js`
Expected: FAIL with `Cannot find module '../src/agent-runner'`.

- [ ] **Step 4: Write the implementation**

Create `assist-local/src/agent-runner.js`:

```javascript
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

// Flags first, prompt always last.
function argvFor(kind, prompt, agent) {
  const flags = kind === 'claude'
    ? (agent.claudeArgs || ['-p', '--disallowedTools', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
    : (agent.codexArgs || ['exec', '--sandbox', 'read-only']);
  return flags.concat(prompt);
}

function runDraft(task, { workspace, agent = cfg.agentConfig(), timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const cli = detectCli(agent);
    if (!cli) return reject(new Error('No local agent CLI found — install Claude Code (`claude`) or Codex (`codex`).'));
    const args = argvFor(cli.kind, buildPrompt(task), agent);
    // No shell — prompt is a single argv element, so no shell-injection surface.
    const child = spawn(cli.cmd, args, { cwd: workspace || process.cwd(), env: process.env });
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

module.exports = { detectCli, buildPrompt, argvFor, runDraft };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node test/agent-runner.test.js`
Expected: `agent-runner: OK`

- [ ] **Step 6: Commit**

```bash
git add src/config.js src/agent-runner.js test/agent-runner.test.js
git commit -m "feat(assist-local): read-only local agent runner (claude/codex)"
```

---

## Task 3: Drafting loop

**Files:**
- Create: `assist-local/src/draft-loop.js`
- Test: `assist-local/test/draft-loop.test.js`

- [ ] **Step 1: Write the failing test**

Create `assist-local/test/draft-loop.test.js`:

```javascript
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.ALIGN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'alignos-loop-'));
const store = require('../src/draft-store');
const loop = require('../src/draft-loop');

const tasks = [
  { id: 'a', from: { display: 'X' }, history: [{ parts: [{ kind: 'text', text: 'q1' }] }] },
  { id: 'b', from: { display: 'Y' }, history: [{ parts: [{ kind: 'text', text: 'q2' }] }] },
];
const listInbox = async () => tasks;
const updates = [];
const onUpdate = (id) => updates.push(id);

(async () => {
  // good run: both drafted, stored ready, onUpdate fired
  const okDraft = async (t) => ({ text: 'reply-' + t.id, cli: 'claude' });
  let r = await loop.sweep({ listInbox, onUpdate, runDraft: okDraft });
  assert.strictEqual(r.drafted, 2);
  assert.strictEqual(store.get('a').status, 'ready');
  assert.strictEqual(store.get('a').text, 'reply-a');
  assert.strictEqual(store.get('b').text, 'reply-b');
  assert.ok(updates.includes('a') && updates.includes('b'), 'fired updates');

  // idempotent: ready tasks are not redrafted
  let calls = 0;
  const countDraft = async (t) => { calls++; return { text: 'x', cli: 'claude' }; };
  r = await loop.sweep({ listInbox, onUpdate, runDraft: countDraft });
  assert.strictEqual(r.drafted, 0);
  assert.strictEqual(calls, 0);

  // error path: stored as error and retried on the next sweep
  store.remove('a'); store.remove('b');
  const badDraft = async () => { throw new Error('cli blew up'); };
  await loop.sweep({ listInbox, onUpdate, runDraft: badDraft });
  assert.strictEqual(store.get('a').status, 'error');
  assert.ok(/cli blew up/.test(store.get('a').error));
  assert.ok(loop.needsDraft('a'), 'errored task is retried');

  // autoDraft:false short-circuits — but cfg has no agent here, so assert default-on instead
  assert.ok(loop.needsDraft('never-seen'), 'unknown task needs a draft');

  console.log('draft-loop: OK');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/draft-loop.test.js`
Expected: FAIL with `Cannot find module '../src/draft-loop'`.

- [ ] **Step 3: Write the implementation**

Create `assist-local/src/draft-loop.js`:

```javascript
'use strict';
// Background drafting: poll the inbox, draft every undrafted request via the local CLI,
// store the result, notify the renderer. Network + notification deps are injected so this is
// unit-testable with no Electron and no node running.
const cfg = require('./config');
const scope = require('./scope');
const store = require('./draft-store');
const runner = require('./agent-runner');

const STALE_DRAFTING_MS = 10 * 60 * 1000; // a 'drafting' entry older than this = crashed run

function workspaceFor() {
  const agent = cfg.agentConfig();
  if (agent.workspace) return agent.workspace;
  const folders = scope.load().folders;
  if (folders && folders.length) return folders[0];
  return process.cwd();
}

function needsDraft(taskId) {
  const d = store.get(taskId);
  if (!d) return true;
  if (d.status === 'error') return true;
  if (d.status === 'drafting') {
    const age = d.at ? Date.now() - Date.parse(d.at) : Infinity;
    return age > STALE_DRAFTING_MS; // resume after a crash; otherwise leave it alone
  }
  return false; // 'ready'
}

// Draft one task now. Used by the loop, the redraft IPC handler, and the CLI.
async function draftTask(task, { onUpdate, runDraft = runner.runDraft } = {}) {
  const agent = cfg.agentConfig();
  const workspace = workspaceFor();
  store.set(task.id, { status: 'drafting', workspace, text: '', error: '' });
  if (onUpdate) onUpdate(task.id);
  try {
    const { text, cli } = await runDraft(task, { workspace, agent });
    store.set(task.id, { status: 'ready', text, cli, error: '' });
  } catch (e) {
    store.set(task.id, { status: 'error', error: e.message });
  }
  if (onUpdate) onUpdate(task.id);
  return store.get(task.id);
}

// One sweep: draft every input-required task that still needs it, bounded concurrency.
async function sweep({ listInbox, onUpdate, runDraft } = {}) {
  if (cfg.agentConfig().autoDraft === false) return { drafted: 0 };
  let tasks = [];
  try { tasks = await listInbox(); } catch { return { drafted: 0 }; }
  const queue = tasks.filter((t) => needsDraft(t.id));
  let drafted = 0;
  const limit = Math.max(1, cfg.agentConfig().concurrency || 1);
  async function worker() {
    while (queue.length) {
      await draftTask(queue.shift(), { onUpdate, runDraft });
      drafted++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
  return { drafted };
}

let _timer = null;
function start({ listInbox, onUpdate, intervalMs = 15000 } = {}) {
  stop();
  const tick = () => sweep({ listInbox, onUpdate }).catch(() => {});
  tick();
  _timer = setInterval(tick, intervalMs);
  if (_timer.unref) _timer.unref(); // don't keep a headless `alignos watch` from exiting cleanly
  return stop;
}
function stop() { if (_timer) { clearInterval(_timer); _timer = null; } }

module.exports = { workspaceFor, needsDraft, draftTask, sweep, start, stop };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/draft-loop.test.js`
Expected: `draft-loop: OK`

- [ ] **Step 5: Commit**

```bash
git add src/draft-loop.js test/draft-loop.test.js
git commit -m "feat(assist-local): inbox drafting loop with bounded queue"
```

---

## Task 4: Send the local draft on approve

**Files:**
- Modify: `assist-local/src/mesh-client.js:41-42`
- Test: `assist-local/test/mesh-approve.test.js`

- [ ] **Step 1: Write the failing test**

Create `assist-local/test/mesh-approve.test.js`:

```javascript
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.ALIGN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'alignos-mc-'));
const cfg = require('../src/config');
cfg.save({ url: 'http://localhost:9999' });

// Intercept the outgoing request and avoid needing a real signing key.
const http = require('../src/http');
const identity = require('../src/identity');
identity.signHeaders = () => ({});
let body = null;
http.request = async (_url, opts) => {
  body = JSON.parse(opts.body);
  return { status: 200, ok: true, json: async () => ({ result: { status: { state: 'completed' } } }) };
};

const mc = require('../src/mesh-client');

(async () => {
  await mc.approve('task-1', 'the drafted reply');
  assert.strictEqual(body.method, 'message/send');
  assert.strictEqual(body.params.message.taskId, 'task-1');
  assert.deepStrictEqual(body.params.message.parts, [{ kind: 'text', text: 'the drafted reply' }]);

  await mc.approve('task-2'); // no text → empty parts (back-compat)
  assert.deepStrictEqual(body.params.message.parts, []);

  console.log('mesh-client approve: OK');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/mesh-approve.test.js`
Expected: FAIL — `approve('task-1', 'the drafted reply')` currently ignores the 2nd arg, so `parts` is `[]` and the first `deepStrictEqual` throws.

- [ ] **Step 3: Write the implementation**

In `assist-local/src/mesh-client.js`, replace the `approve` definition (currently lines 41-42):

```javascript
const approve = (taskId) =>
  rpc('message/send', { message: { role: 'user', parts: [], messageId: rid(), taskId } }, { owner: true });
```

with:

```javascript
// Approve = send the reply. With a locally-drafted reply we send its text as the owner's
// message content; with no text (back-compat) we send empty parts.
const approve = (taskId, text) =>
  rpc('message/send', { message: { role: 'user', parts: text ? [{ kind: 'text', text }] : [], messageId: rid(), taskId } }, { owner: true });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/mesh-approve.test.js`
Expected: `mesh-client approve: OK`

- [ ] **Step 5: Commit**

```bash
git add src/mesh-client.js test/mesh-approve.test.js
git commit -m "feat(assist-local): approve sends the local draft text"
```

---

## Task 5: Wire main process + preload bridge

**Files:**
- Modify: `assist-local/src/main.js` (imports, IPC handlers, loop start, approve)
- Modify: `assist-local/src/preload.js`

- [ ] **Step 1: Add imports and the loop starter in `main.js`**

In `assist-local/src/main.js`, after the existing `const agentLogs = require('./agent-logs');` line, add:

```javascript
const drafts = require('./draft-store');
const draftLoop = require('./draft-loop');

function notifyDraft(taskId) {
  if (win && !win.isDestroyed()) win.webContents.send('draft-updated', { taskId });
}
function startDraftLoop() {
  if (!cfg.load().url) return; // not connected yet — started again after setup
  draftLoop.start({ listInbox: () => mc.inbox(), onUpdate: notifyDraft });
}
```

- [ ] **Step 2: Start the loop once the window exists**

In `assist-local/src/main.js`, change the `createWindow` body so it starts the loop after loading the file. Replace:

```javascript
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}
```

with:

```javascript
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  startDraftLoop();
}
```

- [ ] **Step 3: Restart the loop after first-time setup**

In `assist-local/src/main.js`, in the `setup` handler, add `startDraftLoop();` before `return { ok: true };`:

```javascript
ipcMain.handle('setup', async (_e, { url, token }) => {
  const clean = String(url).replace(/\/$/, '');
  cfg.save({ url: clean });
  await require('./identity').claim(clean, token || '');
  startDraftLoop();
  return { ok: true };
});
```

- [ ] **Step 4: Add draft IPC handlers and make approve send the draft text**

In `assist-local/src/main.js`, replace the existing `approve` handler line:

```javascript
ipcMain.handle('approve', async (_e, { id }) => { const t = await mc.approve(id); store.record({ taskId: id, verdict: 'approve' }); return t; });
```

with:

```javascript
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
```

- [ ] **Step 5: Expose the new surface in `preload.js`**

In `assist-local/src/preload.js`, replace the `approve` line and add the draft methods. Replace:

```javascript
  approve: (id) => ipcRenderer.invoke('approve', { id }),
```

with:

```javascript
  approve: (id, text) => ipcRenderer.invoke('approve', { id, text }),
  drafts: () => ipcRenderer.invoke('drafts'),
  draftGet: (id) => ipcRenderer.invoke('draft-get', { id }),
  redraft: (id) => ipcRenderer.invoke('redraft', { id }),
  onDraftUpdated: (cb) => ipcRenderer.on('draft-updated', (_e, payload) => cb(payload)),
```

- [ ] **Step 6: Syntax-check both files**

Run: `node --check src/main.js && node --check src/preload.js`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/main.js src/preload.js
git commit -m "feat(assist-local): wire draft loop + IPC into main/preload"
```

---

## Task 6: Inbox draft chips + MOCK

**Files:**
- Modify: `assist-local/renderer/app.js` (MOCK, `setView`, `loadInbox`, new `draftChip`)
- Modify: `assist-local/renderer/styles.css` (chip styles)

- [ ] **Step 1: Extend the MOCK with draft methods**

In `assist-local/renderer/app.js`, inside the `MOCK` IIFE, immediately AFTER the `const tasks = [ … ];` array and BEFORE `return {`, add:

```javascript
  const mockDrafts = {
    t1: { status: 'ready', text: tasks[0].artifacts[0].parts[0].text, cli: 'claude',
      workspace: '/Users/you/Documents/win26/ekai/alignOS', at: new Date().toISOString() },
    t2: { status: 'drafting', at: new Date().toISOString() },
  };
```

Then, inside the returned object, replace the `approve` line:

```javascript
    approve: async (id) => { const t = tasks.find((t) => t.id === id); t.status.state = 'completed'; return t; },
```

with:

```javascript
    approve: async (id, replyText) => {
      const t = tasks.find((t) => t.id === id);
      t.status.state = 'completed';
      if (replyText) t.artifacts = [{ parts: [{ kind: 'text', text: replyText }] }];
      return t;
    },
    drafts: async () => mockDrafts,
    draftGet: async (id) => mockDrafts[id] || null,
    redraft: async (id) => {
      mockDrafts[id] = { status: 'ready', text: 'Locally redrafted reply.', cli: 'claude',
        workspace: '/Users/you/Documents/win26/ekai/alignOS', at: new Date().toISOString() };
      return mockDrafts[id];
    },
    onDraftUpdated: () => {},
```

- [ ] **Step 2: Track the current view**

In `assist-local/renderer/app.js`, replace the `setView` function:

```javascript
function setView(v) {
  for (const s of SECTIONS) $(s).hidden = s !== v;
  $('head').hidden = ONBOARDING.has(v);
}
```

with:

```javascript
let _view = null;
function setView(v) {
  _view = v;
  for (const s of SECTIONS) $(s).hidden = s !== v;
  $('head').hidden = ONBOARDING.has(v);
}
```

- [ ] **Step 3: Add the chip helper and render chips in the inbox**

In `assist-local/renderer/app.js`, add this helper just above `async function loadInbox() {`:

```javascript
function draftChip(d) {
  const map = { drafting: ['dchip drafting', 'Drafting…'], ready: ['dchip ready', 'Draft ready'], error: ['dchip error', 'Draft failed'] };
  const c = d && map[d.status];
  return c ? `<span class="${c[0]}">${esc(c[1])}</span>` : '';
}
```

Then replace the whole `loadInbox` function with:

```javascript
async function loadInbox() {
  try {
    const tasks = await api.inbox();
    if (!tasks.length) { setView('allclear'); return; }
    setView('inbox');
    $('inbox-sub').textContent = `${tasks.length} request${tasks.length > 1 ? 's' : ''} need you`;
    const draftMap = api.drafts ? await api.drafts().catch(() => ({})) : {};
    const ul = $('inbox-list'); ul.innerHTML = '';
    for (const t of tasks) {
      const who = (t.from && t.from.display) || 'someone';
      const li = document.createElement('li');
      li.className = 'row';
      li.innerHTML = `<span class="av">${esc(initial(who))}</span><span class="rmain">` +
        `<span class="rtop"><span class="who">${esc(who)}</span>${draftChip(draftMap[t.id])}<span class="ago">${esc(ago(t.status.timestamp))}</span></span>` +
        `<span class="ask">${esc(text(t.history && t.history[0] && t.history[0].parts))}</span></span>`;
      li.addEventListener('click', () => openReview(t.id));
      ul.appendChild(li);
    }
  } catch (e) { fail(e.message); }
}
```

- [ ] **Step 4: Add chip styles**

In `assist-local/renderer/styles.css`, after the `.chip{…}` rule (line ~135), add:

```css
.dchip{font-family:var(--mono);font-size:9px;letter-spacing:.04em;text-transform:uppercase;border-radius:999px;padding:2px 7px;white-space:nowrap}
.dchip.ready{color:var(--green);background:var(--green-soft)}
.dchip.drafting{color:#8A6D1F;background:#F6EFD6}
.dchip.error{color:#9A3B33;background:#F6E1DE}
```

- [ ] **Step 5: Verify in the browser MOCK**

Run: `node --check renderer/app.js`
Expected: no output, exit 0.

Then open `renderer/index.html` directly in a browser (no Electron needed — `MOCK` drives it). Expected: the inbox shows two rows — "Mara's assistant" with a green **Draft ready** chip, "Devon's assistant" with a yellow **Drafting…** chip.

- [ ] **Step 6: Commit**

```bash
git add renderer/app.js renderer/styles.css
git commit -m "feat(assist-local): draft-status chips in the inbox"
```

---

## Task 7: Review screen — editable local draft, redraft, live refresh

**Files:**
- Modify: `assist-local/renderer/index.html:159-161` (add textarea + redraft control)
- Modify: `assist-local/renderer/styles.css` (editable draft + redraft styling)
- Modify: `assist-local/renderer/app.js` (`renderDraft`, `openReview`, approve/redraft/live-refresh wiring)

- [ ] **Step 1: Add the editable draft + redraft control to the HTML**

In `assist-local/renderer/index.html`, replace these three lines (159-161):

```html
      <div class="lbl">Your assistant drafted a reply</div>
      <div class="draft" id="rv-draft">—</div>
      <div class="prov" id="rv-prov"></div>
```

with:

```html
      <div class="lbl" id="rv-lbl">Drafted reply</div>
      <div class="draft" id="rv-draft">—</div>
      <textarea class="draft-edit" id="rv-draft-edit" rows="7" hidden></textarea>
      <div class="rv-draft-actions" id="rv-draft-actions" hidden>
        <button class="link" id="rv-redraft">↻ Redraft locally</button>
      </div>
      <div class="prov" id="rv-prov"></div>
```

- [ ] **Step 2: Style the editable draft + redraft row**

In `assist-local/renderer/styles.css`, after the `.draft{…}` rule (line ~138), add:

```css
.draft-edit{width:100%;box-sizing:border-box;padding:16px;border:1px solid var(--line);border-radius:14px;background:#fff;font:inherit;font-size:14px;line-height:1.6;color:#2C281F;resize:vertical}
.draft-edit:focus{outline:none;border-color:var(--green)}
.rv-draft-actions{display:flex;justify-content:flex-end;margin-top:8px}
.rv-draft-actions .link{font-size:12px}
```

- [ ] **Step 3: Add the `renderDraft` helper**

In `assist-local/renderer/app.js`, add this function just above `async function openReview(id) {`:

```javascript
// Show the draft for a non-terminal task: prefer the local overlay draft (editable when ready);
// fall back to the remote artifact when there's no local draft.
function renderDraft(t, d, who) {
  const editEl = $('rv-draft-edit'), staticEl = $('rv-draft');
  const remote = text(t.artifacts && t.artifacts[0] && t.artifacts[0].parts);
  $('rv-draft-actions').hidden = false;
  $('rv-consequence').innerHTML = `Approving <b>sends this reply to ${esc(who)}</b>.`;
  $('rv-approve').disabled = false;

  if (d && d.status === 'drafting') {
    editEl.hidden = true; staticEl.hidden = false;
    $('rv-lbl').textContent = 'Drafting locally…';
    staticEl.textContent = 'Your local agent is writing a reply in your workspace…';
    $('rv-prov').textContent = '';
    $('rv-approve').disabled = true;
    return;
  }
  if (d && d.status === 'ready') {
    staticEl.hidden = true; editEl.hidden = false;
    editEl.value = d.text;
    const ws = d.workspace ? d.workspace.replace(/^\/Users\/[^/]+/, '~') : 'your workspace';
    $('rv-lbl').textContent = 'Drafted reply (editable)';
    $('rv-prov').textContent = `Drafted locally by ${d.cli || 'your agent'} in ${ws}. Raw local files weren’t sent.`;
    return;
  }
  if (d && d.status === 'error') {
    editEl.hidden = true; staticEl.hidden = false;
    $('rv-lbl').textContent = 'Draft';
    staticEl.textContent = remote || '(local draft failed — Redraft to try again)';
    $('rv-prov').textContent = `Local draft failed: ${d.error || 'unknown error'}`;
    $('rv-approve').disabled = !remote;
    return;
  }
  // no local draft → existing remote-artifact behavior
  editEl.hidden = true; staticEl.hidden = false;
  $('rv-lbl').textContent = 'Your assistant drafted a reply';
  staticEl.textContent = remote || '(no draft yet)';
  $('rv-prov').textContent = 'Drafted in your private space. Raw local files weren’t sent.';
}
```

- [ ] **Step 4: Use `renderDraft` from `openReview`**

In `assist-local/renderer/app.js`, replace the whole `openReview` function with:

```javascript
async function openReview(id) {
  try {
    const t = await api.show(id); current = t;
    const who = (t.from && t.from.display) || 'someone';
    $('rv-who').textContent = who;
    $('rv-age').textContent = ago(t.status.timestamp);
    $('rv-chip').hidden = false; // v1: every known peer shows as a connection
    $('rv-ask').textContent = text(t.history && t.history[0] && t.history[0].parts);
    $('rv-compose').hidden = true; $('rv-compose-text').value = ''; $('rv-followup').classList.remove('on');

    const terminal = ['completed', 'canceled', 'rejected'].includes(t.status.state);
    $('rv-actions').hidden = terminal;
    if (terminal) {
      $('rv-draft-edit').hidden = true; $('rv-draft').hidden = false; $('rv-draft-actions').hidden = true;
      const sent = t.status.state === 'completed';
      $('rv-lbl').textContent = 'Drafted reply';
      $('rv-draft').textContent = sent ? (text(t.artifacts && t.artifacts[0] && t.artifacts[0].parts) || '(no reply)') : '(declined — nothing was sent)';
      $('rv-prov').textContent = '';
      $('rv-consequence').innerHTML = `<b>${sent ? 'Sent ✓' : 'Declined'}</b> · ${esc(ago(t.status.timestamp))}`;
    } else {
      const d = api.draftGet ? await api.draftGet(id).catch(() => null) : null;
      renderDraft(t, d, who);
    }
    setView('review');
  } catch (e) { fail(e.message); }
}
```

- [ ] **Step 5: Wire approve (send edited text), redraft, and live refresh**

In `assist-local/renderer/app.js`, in the `wire()` function, replace the existing approve handler:

```javascript
  $('rv-approve').addEventListener('click', async () => { try { await api.approve(current.id); toast('Approved — sent.'); loadInbox(); } catch (e) { fail(e.message); } });
```

with:

```javascript
  $('rv-approve').addEventListener('click', async () => {
    const editEl = $('rv-draft-edit');
    const replyText = editEl.hidden ? null : editEl.value.trim();
    try { await api.approve(current.id, replyText); toast('Approved — sent.'); loadInbox(); }
    catch (e) { fail(e.message); }
  });
  $('rv-redraft').addEventListener('click', async () => {
    $('rv-draft-edit').hidden = true; $('rv-draft').hidden = false;
    $('rv-lbl').textContent = 'Drafting locally…';
    $('rv-draft').textContent = 'Your local agent is writing a reply in your workspace…';
    $('rv-approve').disabled = true;
    try { await api.redraft(current.id); } catch (e) { /* surfaced on reopen */ }
    openReview(current.id);
  });
  if (api.onDraftUpdated) api.onDraftUpdated(({ taskId }) => {
    if (_view === 'review' && current && current.id === taskId) openReview(taskId);
    else if (_view === 'inbox') loadInbox();
  });
```

- [ ] **Step 6: Syntax-check and verify in the browser MOCK**

Run: `node --check renderer/app.js`
Expected: no output, exit 0.

Open `renderer/index.html` in a browser. Expected:
- Click "Mara's assistant" → an **editable textarea** holds the draft; prov reads "Drafted locally by claude in ~/Documents/win26/ekai/alignOS"; **↻ Redraft locally** is visible.
- Click "Devon's assistant" → shows "Drafting locally…" and Approve is disabled.
- On Mara, edit the text, click **Approve & send** → toast "Approved — sent." and the inbox reloads.

- [ ] **Step 7: Commit**

```bash
git add renderer/index.html renderer/styles.css renderer/app.js
git commit -m "feat(assist-local): editable local draft + redraft in review"
```

---

## Task 8: CLI commands (`draft`, `watch`)

**Files:**
- Modify: `assist-local/bin/alignos` (header comment, `resolveId` list, two new cases, usage line)

- [ ] **Step 1: Allow id resolution for `draft`**

In `assist-local/bin/alignos`, update the id-resolution list. Replace:

```javascript
  if (['show', 'approve', 'followup', 'decline'].includes(cmd)) id = await resolveId(id);
```

with:

```javascript
  if (['show', 'approve', 'followup', 'decline', 'draft'].includes(cmd)) id = await resolveId(id);
```

- [ ] **Step 2: Add the `draft` and `watch` cases**

In `assist-local/bin/alignos`, add these two cases immediately before the `default:` case in the `switch (cmd)`:

```javascript
    case 'draft': {
      if (!id) throw new Error('usage: alignos draft <id>');
      const loop = require('../src/draft-loop');
      const t = await mc.getTask(id);
      process.stderr.write('drafting locally…\n');
      const d = await loop.draftTask(t);
      if (d.status !== 'ready') throw new Error(d.error || 'draft failed');
      console.log(d.text);
      break;
    }
    case 'watch': {
      const loop = require('../src/draft-loop');
      console.error('watching inbox — drafting incoming requests (Ctrl-C to stop)…');
      loop.start({ listInbox: () => mc.inbox(), onUpdate: (tid) => console.error('  drafted', tid.slice(0, 8)) });
      await new Promise(() => {}); // run until interrupted
      break;
    }
```

- [ ] **Step 3: Update the usage line and header comment**

In `assist-local/bin/alignos`, replace the `default:` body usage string:

```javascript
      console.log('alignos: setup | status | inbox | show <id> | approve <id> | followup <id> --msg <t> | decline <id> [--note <t>]');
```

with:

```javascript
      console.log('alignos: setup | status | inbox | show <id> | draft <id> | watch | approve <id> | followup <id> --msg <t> | decline <id> [--note <t>]');
```

And in the header comment block at the top, add two lines after the `alignos show <id>` comment line:

```javascript
//   alignos draft <id>                 draft a reply locally with claude/codex and print it
//   alignos watch                      run the drafting loop headless for all incoming requests
```

- [ ] **Step 4: Syntax-check**

Run: `node --check bin/alignos`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add bin/alignos
git commit -m "feat(assist-local): alignos draft/watch CLI commands"
```

---

## Task 9: Full verification ("make sure it works")

**Files:** none (verification only)

- [ ] **Step 1: Run every unit test**

Run:
```bash
node test/draft-store.test.js && \
node test/agent-runner.test.js && \
node test/draft-loop.test.js && \
node test/mesh-approve.test.js
```
Expected: four `… : OK` lines, exit 0.

- [ ] **Step 2: Syntax-check every changed/created source file**

Run:
```bash
for f in src/config.js src/draft-store.js src/agent-runner.js src/draft-loop.js \
  src/mesh-client.js src/main.js src/preload.js renderer/app.js bin/alignos; do
  node --check "$f" || echo "FAILED: $f";
done
```
Expected: no `FAILED:` lines.

- [ ] **Step 3: End-to-end loop smoke with a fake CLI (no node, no Electron)**

Run:
```bash
TMP=$(mktemp -d) && BIN=$(mktemp -d) && \
printf '#!/bin/sh\nprintf "Sounds good — Thursday at 2pm works."\n' > "$BIN/claude" && chmod +x "$BIN/claude" && \
ALIGN_HOME="$TMP" PATH="$BIN:$PATH" node -e '
  const loop = require("./src/draft-loop");
  const store = require("./src/draft-store");
  const tasks = [{ id: "x1", from: { display: "Devon" }, history: [{ parts: [{ kind: "text", text: "Free Thursday?" }] }] }];
  loop.sweep({ listInbox: async () => tasks, onUpdate: () => {} }).then((r) => {
    const d = store.get("x1");
    if (r.drafted === 1 && d.status === "ready" && /Thursday/.test(d.text)) console.log("E2E OK:", JSON.stringify(d.text));
    else { console.error("E2E FAIL", r, d); process.exit(1); }
  });
'
```
Expected: `E2E OK: "Sounds good — Thursday at 2pm works."` — proving inbox→runner→store with a real spawned process and the overlay store.

- [ ] **Step 4: (If Electron is installed) launch the app**

Run: `npm install` then `npm start` (only if you intend to test the GUI). With no private space configured it shows onboarding; the drafting loop starts after setup. If `npm install` can't fetch Electron in this environment, skip — Steps 1-3 already verify all non-GUI logic.
Expected: app window opens without console errors; inbox rows show draft chips once a node is connected.

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "test(assist-local): verify local drafting end-to-end"
```

---

## Self-Review

**Spec coverage**
- "Background process drafts each input-required request, no manual trigger" → Task 3 (`sweep`/`start`), Task 5 (loop start in main).
- "Draft produced by local claude/codex, cwd = workspace, read-only" → Task 2 (`detectCli`, `argvFor` read-only flags, `runDraft` cwd).
- "Draft appears: inbox chip + editable review draft" → Task 6 (chips), Task 7 (editable draft).
- "Approve sends the (edited) local draft text" → Task 4 (`approve(taskId, text)`), Task 5 (approve handler), Task 7 (sends textarea value).
- "Raw files never leave; only reviewed draft sent" → prov copy in Task 7; only `text` crosses the wire in Task 4.
- "Works end-to-end, verifiable without the TEE backend" → Task 9 (unit + fake-CLI E2E).
- One configured default workspace → Task 3 (`workspaceFor`: config → first granted folder → cwd).
- CLI surface for GUI-free testing → Task 8 (`draft`/`watch`).
- Error handling (no CLI, timeout, nonzero exit, missing workspace) → Task 2 (runner rejects), Task 3 (stored as `error`, retried), Task 7 (error rendering + redraft).

**Placeholder scan:** No TBD/TODO; every code step shows complete code; no "add error handling" hand-waves.

**Type/signature consistency (checked across tasks):**
- `runner.runDraft(task, { workspace, agent, timeoutMs }) → { text, cli }` — defined Task 2, called Task 3.
- `loop.draftTask(task, { onUpdate, runDraft }) → store entry` — defined Task 3, called Tasks 5 (`redraft`), 8 (`draft`).
- `loop.sweep({ listInbox, onUpdate, runDraft }) → { drafted }` — defined Task 3, called Tasks 5 (via `start`), 9.
- `store.set/get/all/remove` — defined Task 1, used Tasks 3, 5.
- `mc.approve(taskId, text)` — defined Task 4, called Task 5.
- preload `approve(id, text)`, `drafts()`, `draftGet(id)`, `redraft(id)`, `onDraftUpdated(cb)` — defined Task 5, consumed Tasks 6, 7; MOCK mirrors them Task 6.
- main IPC names `drafts` / `draft-get` / `redraft` / `approve {id,text}` — defined Task 5, matched by preload Task 5.
- `cfg.agentConfig()` — defined Task 2, used Tasks 2, 3.
- `_view` set in `setView` (Task 6), read in `onDraftUpdated` wiring (Task 7).
