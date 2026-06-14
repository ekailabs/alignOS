# Assist-Client — Local Agent Drafting for the Inbox

**Date:** 2026-06-14
**Status:** Draft (awaiting review)
**Scope:** `assist-client` only (Electron app + shared `src/` + CLI). No backend changes.

## Problem

Every incoming request from a peer's assistant lands in the owner's private space
(`assist-remote`) as an `input-required` task. The Electron app polls `tasks/list`, shows the
request, and displays a **draft reply** that today comes from the remote (`task.artifacts`).

Two gaps:

1. **The deployed TEE node has no model.** The sibling spec
   (`2026-06-14-tee-quick-mode-owner-style-loop-design.md`) verified that the live Phala node
   ships without `claude`/`codex` installed and no API key, so its draft is a placeholder. The
   owner's *laptop*, however, has `claude` / `codex` installed and the actual workspace files.
2. **No local drafting exists.** `mesh-client.js` has `approve` / `followup` / `decline` but no
   way to generate a draft locally and surface it in the inbox.

We want: for **every** incoming request, run the owner's local `claude` (Claude Code) or
`codex` CLI **read-only** in their workspace, capture the reply, and fill it into the inbox
draft automatically — so a reviewed, grounded draft is waiting when the owner opens a request.

## Goal / Success Criteria

- A background process running inside the app drafts a reply for **each** `input-required`
  request, with no manual trigger.
- The draft is produced by the owner's locally-installed `claude` or `codex`, run with cwd set
  to the owner's workspace so it is grounded in real local files. The run is **read-only** — the
  agent never edits the workspace.
- The draft appears in the inbox: a status chip in the list, and the full (editable) draft in
  the review screen, replacing the "(no draft yet)" placeholder.
- On **Approve**, the (possibly owner-edited) local draft text is what gets sent.
- Raw local files never leave the machine — only the reviewed draft is sent.
- It works end-to-end and is verifiable without the full TEE backend.

## Key Findings (validated)

- `claude -p "<prompt>"` runs **headless** on the owner's Claude subscription, returns clean
  stdout, exit 0. In headless `-p` mode, tools that need permission (Edit/Write) are denied with
  no one to approve, so it is effectively read-only; we additionally pass `--disallowedTools` to
  make that explicit. (Same primitive the node's `draft.ts` uses.)
- `codex exec --sandbox read-only "<prompt>"` runs non-interactively, read-only.
- `agent-logs.js` already detects which CLIs the owner uses (`~/.claude`, `~/.codex`, …) and
  which folders they work in (`suggestFolders` / `sessionCwd`) — the workspace default source.
- `scope.js` is the deny-by-default granted-folder sandbox; the drafting workspace must be a
  granted folder.
- `main.js` is intentionally thin (handlers delegate to `src/`), and `preload.js` is the only
  renderer↔main surface. New logic lives in `src/`, mirrored by both `main.js` and `bin/alignos`.

## Design

A drafting loop in the Electron main process watches the inbox and, for each undrafted request,
calls a shared runner that spawns the local CLI read-only and writes the result to a local
draft-overlay store. The renderer shows the overlay draft and sends it on approve. Four new
units plus edits to existing files.

### Component A — `src/agent-runner.js` (new)

The "call Claude/Codex locally" core. Pure logic, no Electron deps, used by both `main.js` and
`bin/alignos`.

- `detectCli()` → resolves the CLI per `config.agent.cli` (`'auto' | 'claude' | 'codex'`);
  `auto` prefers `claude`, falls back to `codex`. Looks the binary up on `PATH`. Returns
  `{ cmd, kind }` or `null` when neither is installed.
- `buildPrompt(task)` → composes the prompt from the task: the asker
  (`task.from.display`), the question (`text(history[0].parts)`), and instructions to draft a
  reply **on the owner's behalf**, plain text, read-only, grounded in the workspace.
- `runDraft(task, { workspace, signal })` → spawns the CLI (`child_process.spawn`) with
  `cwd: workspace`, captures stdout, enforces `config.agent.timeoutMs` (kill on timeout),
  resolves `{ text, cli }` or rejects with a friendly error. Default argv:
  - claude: `['-p', prompt, '--disallowedTools', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']`
  - codex: `['exec', '--sandbox', 'read-only', prompt]`
  - Both overridable via `config.agent.claudeArgs` / `codexArgs`. Exact flags are re-verified
    against the installed CLIs during implementation (claude-code-guide / `claude --help`).

### Component B — `src/draft-store.js` (new)

Local overlay persistence in `~/.alignos/drafts.json` (under `config.DIR`, honoring
`ALIGN_HOME`). Map `taskId → { status, text, cli, workspace, at, error }` where
`status ∈ {'drafting','ready','error'}`. API: `get(taskId)`, `set(taskId, patch)`, `all()`,
`remove(taskId)`. Keyed by taskId so drafting is idempotent across restarts and re-polls.

### Component C — Drafting loop in `src/main.js`

The "process running". A `draft-loop` module (kept small, may live inline in `main.js` or as
`src/draft-loop.js`):

- An interval (`~15s`, plus a kick on app start and after `approve`/`decline`/`followup`) calls
  `mc.inbox()`. For each `input-required` task whose draft-store entry is absent or `error`
  (and not currently `drafting`), it enqueues a draft job.
- A concurrency cap (`config.agent.concurrency`, default `1`) drains the queue so we never spawn
  many agents at once.
- Per job: resolve workspace (`config.agent.workspace` || first `scope` folder || `cwd`); set
  store `status:'drafting'`; `runDraft`; on success store `{status:'ready', text, cli}`, on
  failure `{status:'error', error}`. Either way `win.webContents.send('draft-updated',{taskId})`.
- Disabled when `config.agent.autoDraft === false`, or when not connected/onboarded, or when
  `detectCli()` is null (one-time friendly error draft so the UI can explain).

### Component D — Renderer (`app.js` / `index.html` / `styles.css`)

- **Inbox list:** each row shows a status chip — `Drafting…` / `Draft ready` / `Draft failed` —
  sourced from `api.drafts()`.
- **Review screen:** `rv-draft` shows the overlay draft (preferred over the remote artifact),
  rendered as an **editable** field so the owner can tweak before sending; a spinner while
  `status:'drafting'`; a **Redraft** button (`api.redraft(id)`); provenance line "Drafted
  locally by Claude Code in `~/workspace`." Subscribes to `draft-updated` to refresh live.
- **Approve** sends the current (edited) draft text.
- `MOCK` gains `drafts/draftGet/redraft` and a no-op `onDraftUpdated` so browser dev still
  renders.

### Edits to existing files

- `src/mesh-client.js`: `approve(taskId, text)` → `message/send` with `text` as parts (empty
  array when no text). **Backend assumption:** a locally-drafted reply is sent as the owner's
  message content. If `assist-remote` only relays empty approvals, we revisit (the one place
  this design touches the client/remote contract).
- `src/preload.js`: expose `drafts`, `draftGet(id)`, `redraft(id)`, and an `onDraftUpdated(cb)`
  subscription over `ipcRenderer.on('draft-updated', …)`.
- `src/main.js`: IPC handlers `drafts` / `draft-get` / `redraft`; `approve` looks up the local
  draft and passes its text to `mc.approve`; start the drafting loop in `createWindow`/whenReady.
- `src/config.js`: no code change; a `config.agent` block is read with defaults:
  `{ cli:'auto', workspace:null, timeoutMs:120000, concurrency:1, autoDraft:true, claudeArgs:null, codexArgs:null }`.
- `bin/alignos`: add `alignos draft <id>` (draft one request now and print it) and
  `alignos watch` (run the loop headless) — same runner/store, for GUI-free testing.

## Data Flow

```
incoming request → assist-remote task (input-required, no/placeholder artifact)
  → main.js draft-loop poll → enqueue → agent-runner.runDraft(claude/codex, cwd=workspace, read-only)
  → draft-store.set(taskId, {status:'ready', text}) → 'draft-updated' → renderer shows overlay draft
  → owner edits/approves → mesh-client.approve(taskId, draftText) → message/send → peer
```

## Error Handling

- No CLI installed → one `status:'error'` draft with a friendly "install Claude Code or Codex"
  message; loop does not retry-spam.
- Workspace missing/ungranted → `status:'error'`, redraftable once configured.
- Spawn failure / nonzero exit / timeout → process killed, `status:'error'`, **Redraft** offered.
- Loop failures are isolated per task; one bad draft never blocks the others or crashes main.
- Privacy: workspace constrained to a granted folder; raw files never sent; only the reviewed
  draft leaves on approve (consistent with existing `rv-prov` provenance copy).

## Testing ("make sure it works")

- `test/agent-runner.test.js` (plain `node`, no framework): a fake `claude` stub placed on a
  temp `PATH` echoing a canned reply → asserts CLI detection, prompt delivery, stdout capture,
  store write, and the error + timeout paths.
- `node --check` on every changed file; `node -e "require(...)"` smoke for the CommonJS modules.
- `alignos watch` against the `MOCK`/a local node to exercise the loop headless.
- Real end-to-end against the owner's running private space when available. (Electron GUI launch
  may need `npm install`; the runner/store/CLI logic is testable without it.)

## Out of Scope (v1)

- Pushing drafts back to `assist-remote` as artifacts (a backend endpoint) — local overlay only.
- Code-change/diff drafts (the agent editing the workspace) — read-only text replies only.
- Per-request workspace routing — one configured default workspace.
- Multi-pass owner-style refinement (that's the sibling node-side spec).
