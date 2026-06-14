# alignOS Assist — assist-client / assist-remote design

**Date:** 2026-06-13
**Status:** Design draft — approved for implementation planning. Open implementation risks tracked in §16.
**Repo area:** new `assist-client/` (Node/Electron) + additions to `tee-mesh/node/` for `assist-remote` (Deno)
**Vocabulary:** see [docs/taxonomy.md](../../taxonomy.md). User-facing copy hides all implementation names.

---

## 1. Summary

A calm desktop app (+ a parallel CLI) that is the human's **gateway** for human-agent
collaboration. Each human owns an assistant. Other people's assistants can ask yours for
help; anything that needs the human's call lands in an **inbox**, where the human stays in
charge with three actions: **Approve · Follow up · Decline**. A **Preferences** screen lets
the owner set who can reach the assistant, what it can answer automatically, what it knows,
and which local folders it may read — so less needs the human over time.

Two named parts (see taxonomy):
- **`assist-client`** — the local desktop app + CLI on the human's machine.
- **`assist-remote`** — the assistant runtime in the owner's confidential compute (a dstack
  TEE CVM, implemented in `tee-mesh/node`).

Requests flow over the **A2A protocol**. None of that vocabulary is shown to the user.

**Product one-liner:** *"Set up your assistant. It works for you in a private space only
you control — and whenever something needs your call, it lands in your inbox. You stay in
charge."*

---

## 2. Goals and non-goals

### Goals (v1)
- `assist-client` Electron app + parallel CLI over one logic core.
- The **"Ask my assistant"** loop end-to-end: a peer's assistant asks → `assist-remote`
  drafts a reply → it surfaces in the inbox → owner Approves / Follows up / Declines → the
  reply returns to the asker.
- Real mesh participation: `assist-remote` is a genuine A2A agent in `tee-mesh`.
- **Connect** to an *already-running* private space via a one-time setup token (no key
  pasting after claim).
- **Demo assumption:** the operator has already provisioned the TEE machines; onboarding
  starts from gateway URLs + setup tokens, not from provisioning.
- **Onboarding memory:** after claim, offer to seed the remote node with a redacted,
  compacted 30-day agent-log digest from `~/.claude`, `~/.codex`, `~/.openclaw`, `~/.pi`,
  `~/.opencode`, and `~/.hermes`.
- **Two operating modes:** Quick Mode runs in the TEE from synced notes + logs-derived
  memory; Deep Mode runs locally when a task needs folders, files, or local tools.
- **Preferences control center:** Connections (who can reach you), Auto-handle rules
  (allow-list), What your assistant knows (notes/docs and onboarding log memory in the
  private space), Folders it can read later in Deep Mode (deny-by-default, redacted).
- A nearly-free capture seam (`decisions.jsonl`) so future eval/RLHF has real data from day one.

### Non-goals (deferred — see §12)
- No eval rubric, gates, judge, meta-eval, best-of-N, or model training in v1. We **capture**
  the signal; we do not **consume** it.
- No owner **profile** ("about me / how I work") — personalization; belongs with the deferred
  per-owner RLHF layer.
- No full edge **execution** (the assistant *acting* on your machine). v1 does edge **reads**
  only (fetch scoped, redacted local context for drafting).
- No inbound push webhooks / `PushNotificationConfig` CRUD — v1 is client-initiated SSE.
- No one-click provisioning — the node is deployed ahead of time and the app connects.
- **Single-device in v1** — one owner key, one client. Multi-device deferred.
- No connections graph view, action-approval kind, or "outside" export.

> **Descope lever:** *Folders it can read* (the live local-data path) is the heaviest v1
> piece. If a smaller first slice is wanted, move it to v1.1 and keep Connections /
> Auto-handle / notes — the loop still stands.

---

## 3. Product framing — hide the jargon, keep the guarantee

Drop "TEE / CVM / node / mesh / attestation / agent" from everything the user sees. Keep an
honest, plain-language privacy promise. Be explicit (never claim "nothing leaves"): replies
are written by a model, the request context is sent from the private space to that model
provider to draft, and approved replies are sent to the asker.

| Internal | User-facing |
|---|---|
| Deploy/provision the CVM | **Set up** |
| TEE / CVM / node | *(invisible)* — at most "your assistant's private space" |
| `assist-remote` drafting via model API | "your assistant writes a reply" |
| agent (owner's) / peer agent | **your assistant** / **someone's assistant** |
| A2A task in `input-required`/`auth-required` | a **request** in your **Inbox** |
| connections / approval list / scope | **Connections** / **Auto-handle** / **what it can read** |
| Approve / Follow up / Decline | same words |
| owner credential | *(invisible after setup — a local key registered with your assistant)* |

---

## 4. Architecture and topology

A user's presence is the pair **{edge device (`assist-client`), private space
(`assist-remote`)}**. `assist-remote` is a **separate process** in the owner's CVM; the app
and CLI are **clients** to it over an owner-authenticated channel (§5).

**Operator-provisioned, owner-claimed.** The infrastructure operator may provision a pool of
TEE/CVM instances ahead of time, but does not become the long-term assistant owner. Each
running instance is claimed by one human owner through the setup-token flow (§11), and owner
routes are then bound to that owner's local key.

Example starting point:

| Instance | Provisioned by | Claimed owner | Assistant identity |
|---|---|---|---|
| CVM 1 | Operator | Albi | Albi's `assist-remote` |
| CVM 2 | Operator | Andrew | Andrew's `assist-remote` |
| CVM 3 | Operator | Shashank | Shashank's `assist-remote` |

```
┌──────────────── User's edge device — assist-client (Node/Electron) ─────────────┐
│  renderer/ (vanilla JS)  ◄──IPC via preload──►  src/main.js (Electron main, thin)│
│  Set up · Inbox · Review · Preferences          bin/alignos (CLI, thin)          │
│                                  └── src/ (Electron-free core) ──┐               │
│                                  mesh-client · inbox-store ·     │               │
│                                  scope · redact · agent-logs ·    │               │
│                                  edge-reader · identity          │               │
│  raw local agent logs (~/.claude, ~/.codex, ~/.openclaw, ~/.pi, ~/.opencode,     │
│  ~/.hermes) stay here; scoped+redacted slices can be sent after approval         │
└───────────────┬──────────────────────────────────────────────────┬─────────────┘
   owner-auth +  │ A2A JSON-RPC/HTTP        edge sends only a redacted│ context slice
   client SSE    │ (tasks/resubscribe)      for local-data requests   │ (laptop must be online)
                 ▼                                                    ▼
        ┌──────────── assist-remote — owner's private space (TEE/CVM) ────────────┐
        │  tee-mesh/node (existing) + new A2A surface                             │
        │   identity (node_id, pubkey, quote) · on-chain registry · gossip · card │
        │   a2a.ts: A2A server      inbox.ts: task store (Deno KV) + policy +      │
        │   draft.ts: drafts replies via MODEL API CALL FROM INSIDE THE CVM        │
        │   knowledge store (synced notes/docs)                                   │
        └──────────────────────────────┬──────────────────────────────────────────┘
                                        │ on-chain registry + HTTP gossip
                                        ▼
                              ── the rest of the mesh (other users' assistants) ──
```

**Drafting runs inside `assist-remote`** (a model API call from the CVM). This is what lets
it draft while the laptop is asleep — the "a draft is ready when you open the inbox" UX.
For a request that needs **local data**, `assist-client` (the hands) reads a scoped +
redacted slice and sends *only that* to `assist-remote` to draft from; raw files never leave
the device, and such requests require the laptop online and always go to the inbox (§6).

**Body vs hands.** The CVM is the assistant's always-on, attestable *body* (identity,
drafting, mesh presence). The edge is its *privileged hands* — the only thing that can read
local files.

---

## 5. A2A foundation

A2A-native (the mesh already serves an agent-card). References: A2A spec latest / v0.3.0,
github.com/a2aproject/A2A.

**TEE service discovery endpoints:**

| Endpoint | Audience | Purpose |
|---|---|---|
| `GET /.well-known/agent-card.json` | Mesh peers / verifiers | Raw node card: node identity, gateway, TEE mode, attestation digest, agent cards, and optional owner metadata. |
| `GET /.well-known/alignos-service.json` | Mesh peers / clients | This TEE projected as one owner-bound assistant service, including owner handle, `ask-{owner}` endpoint, owner-auth endpoint, Quick Mode URL, and Deep Mode handoff URL. |
| `GET /peers` | Mesh peers / operators | Raw eventually-consistent directory of node cards. |
| `GET /services` | Mesh peers / clients | Service discovery directory across the mesh. In the demo it returns Albi, Andrew, and Shashank as three owner assistant services. |
| `GET\|POST /ask-<owner>?mode=quick\|deep` | Peer assistants / clients | Owner-specific ask endpoint, e.g. `/ask-albi`, `/ask-andrew`, `/ask-shashank`. `mode=quick` runs through the TEE; `mode=deep` returns a local `assist-client` handoff contract. |
| `POST /a2a` | Peer assistants | Public A2A surface for inbound asks and task lookup. This is the TEE Quick Mode endpoint for service-to-service requests. |
| `POST /owner/a2a` | Owner's `assist-client` | Owner-authenticated inbox/review/control surface. |

- **Request object = the A2A `Task`** (`id`, `contextId`, `status`, `artifacts`, `history`).
  An inbox item is a `Task` in an interrupted state wrapped in a thin local envelope
  (read/unread, `pulledAt`, decision link).
- **The inbox = Tasks in** `input-required` (assistant needs the human) or `auth-required`
  (consent to read local data).
- **Request kinds** are projections of state + initiator, not a custom enum:

  | Kind | A2A representation | v1? |
  |---|---|---|
  | Peer question / judgment | peer `Task` in `input-required`, ask in `status.message` | **v1** |
  | Data-access / consent | `Task` in `auth-required`; human grants a scoped, redacted read | **v1** |
  | Action approval (your assistant's outbound) | your assistant's `Task` in `input-required` | v1.1 |

- **Human turns:** Approve → finalizing `Message` (same `taskId`/`contextId`) → `completed`;
  Follow up → `Message` on the same `contextId` → re-draft → back to inbox; Decline →
  `tasks/cancel` or refusal `Message` → `canceled`/`rejected`.
- **Drafts are `Artifact`s of `Part`s** — what Review renders.

**v1 A2A subset (required for the loop):**
```
message/send       peers → assist-remote; also carries Approve / Follow-up finalizing messages
tasks/list         owner inbox  = status in {input-required, auth-required}
tasks/get          one task + history for Review
tasks/cancel       Decline
tasks/resubscribe  client-initiated SSE — assist-client catches up + streams updates
```
**Deferred (interop completeness):** `message/stream`, `pushNotificationConfig/*`, inbound
webhooks.

**Push transport = client-initiated.** Laptops are behind NAT / asleep, so `assist-client`
opens the SSE stream *to* `assist-remote` (and polls `tasks/list` as a fallback). The durable
queue (§8) is the source of truth; nothing depends on inbound reachability.

**Owner-auth envelope** (every owner-route request — implement once in `mesh-client.js`, verify in `ingress.ts`):
```
X-Align-Key        ed25519 public key (base64url) — must equal the registered owner key
X-Align-Timestamp  unix seconds
X-Align-Nonce      16 random bytes (base64url)
X-Align-Signature  ed25519 over the canonical string (base64url)
canonical string = method + "\n" + path + "\n" + hex(sha256(body)) + "\n" + timestamp + "\n" + nonce
```
`assist-remote` rejects if the key ≠ the registered owner key, `|now − timestamp| > 60s`, or
the nonce was seen within the last 120s (LRU cache). Ed25519 via tweetnacl (client) / Deno
std crypto (remote).

---

## 6. Execution model and the needs-human policy

- **`assist-remote` (TEE):** always-on, attestable. Drafts replies. **Allow-list-gated:**
  pre-approved, no-local-data requests can auto-respond; everything else → `input-required`.
- **`assist-client` (edge):** runs Deep Mode locally for work that needs folders, files, or
  local tools. It can hand a scoped + redacted result back to `assist-remote` for review and
  mesh reply handling.

**Modes:**

| Mode | Runs where | Uses | Folder access | Default use |
|---|---|---|---|---|
| Quick Mode / TEE mode | `assist-remote` in the owner's CVM | Synced notes/docs, onboarding log memory, task history | No live folder access | Fast replies and "answer like the owner would" drafts based on prior logs. |
| Deep Mode / local mode | `assist-client` on the owner's machine | Local folders/files/tools, local Claude/Codex-style execution, plus TEE context | Explicit, scoped, per request | Work that needs repo/file inspection or local tool execution. |

**Two firm rules:**
1. **Execution follows data.** Quick Mode work lives entirely in the CVM and uses only
   synced/redacted memory. Deep Mode work runs on the local machine because that is where
   folders, files, and local tools live.
2. **Local-data requests always hit the inbox.** Reading any private folder is
   non-allow-listable — the locked Auto-handle guardrail. Never silent.

The policy lives in `assist-remote` (`inbox.ts`): auto-respond vs `input-required`, driven by
the owner's **Connections** + **Auto-handle** preferences. v1 default allow-list is empty →
everything needs the human until the owner opts specific things in.

---

## 7. Data residency and privacy (tiered)

| Data | Where | Notes |
|---|---|---|
| Raw local agent logs (`~/.claude`, `~/.codex`, `~/.openclaw`, `~/.pi`, `~/.opencode`, `~/.hermes`) | **Edge only** | Deny-by-default scope; `redact.js` masks secrets before anything leaves. |
| Onboarding agent-log digest | Edge → **CVM** (redacted) | Optional after claim; compacted 30-day agent-log history from the approved roots, not raw logs or broad folder access. |
| Onboarding knowledge corpus | **CVM** `/data/knowledge.json` | Redacted prompt/output pairs used only for owner voice/style grounding in Quick Mode drafts. |
| Local context slice for a request | Edge → **CVM** (redacted) | Only the minimal redacted slice needed to draft; on explicit in-the-moment approval. |
| Notes/docs in "what it knows" | Synced into **CVM** (redacted) | So the assistant can draft from them anytime, asleep or awake. |
| Assistant identity + keys | **CVM** | TEE-derived. |
| Owner credential | **Edge** | Ed25519 key in OS keychain where possible (macOS Keychain via `security`), else `~/.alignos/owner.key` mode `0600`. Public key registered with `assist-remote`. |
| Inbox / task source of truth | **CVM** `/data/tasks.json`; edge caches | Always-on; edge cache is for UI speed. Includes asks, drafts, approvals, and answers sent back to other users. |
| Operational/audit event log | **CVM** `/data/events.jsonl` | Append-only events for boot, registration, gossip, routing, proxying, A2A approvals/follow-ups/declines, and failures. |
| Peer/service discovery snapshot | **CVM** `/data/peers.json` | Last known node cards for `/peers` and `/services`, loaded at boot so discovery warms immediately after restart. |
| Preference/decision signal | **Edge** `decisions.jsonl` | Kept for future RLHF; not consumed in v1. |
| Anything to "outside" | Explicit opt-in only | Never silent. |

**Honesty (the model-path truth):** to draft, `assist-remote` makes a **model API call from
inside the CVM**; the request context (including any redacted local slice or synced notes)
is sent to that model provider. We do not claim "nothing leaves." Confidential inference
(so the provider can't read the prompt) is a future option, noted in §16.

---

## 8. Headless core, thin shells + file map

**Rule:** all logic in **Electron-free CommonJS `src/`**. Electron main and the CLI are thin
adapters; renderer and CLI hold zero logic. This is what makes headless testing over SSH
possible and keeps `assist-remote` a separate process.

**New: `assist-client/` (Node/Electron)**

| File | Role | Origin |
|---|---|---|
| `src/mesh-client.js` | Owner-auth A2A client: `tasks/list`/`get`/`cancel`, finalizing/follow-up `message/send`, SSE `tasks/resubscribe`, signs the owner envelope. | new |
| `src/inbox-store.js` | Edge cache of `Task`s + thin envelope + append-only `decisions.jsonl`. | new |
| `src/scope.js` | Deny-by-default local-data permission store for approved agent-log roots and folders, keyed on full path. | new |
| `src/redact.js` | Deterministic secret scrubber — pure, never throws. | new |
| `src/agent-logs.js` | Read + compact `~/.claude`, `~/.codex`, `~/.openclaw`, `~/.pi`, `~/.opencode`, and `~/.hermes` into a redacted slice for grounding. | new |
| `src/edge-reader.js` | For a local-data request: gather the scoped slice (`scope` + `redact` + `agent-logs`) and hand it to `assist-remote`. | new |
| `src/identity.js` | Generate owner keypair; claim with the setup token; store key (keychain/`0600`); sign requests. | new |
| `src/setup.js` | v1 connect flow: validate gateway URL + token, claim ownership, persist config, report health. | new |
| `src/main.js` | Electron main; thin `ipcMain` handlers. | new |
| `src/preload.js` | contextBridge — only renderer↔main surface (`window.alignos.*`). | new |
| `bin/alignos` | CLI shell — same `src/` calls, JSON/stdio. | new |
| `renderer/{index.html,app.js,styles.css}` | Single-window vanilla-JS state machine. | new |

**Changed: `tee-mesh/node/` (Deno) — `assist-remote`**

| File | Role |
|---|---|
| `node/a2a.ts` (new) | A2A JSON-RPC/HTTP surface (v1 subset, §5); reuses the agent-card. |
| `node/inbox.ts` (new) | Task store on **Deno KV** (durable, no dep), needs-human policy, human-review queue, SSE feed. |
| `node/draft.ts` (new) | Draft/redraft the reply `Artifact` via a **model API call from inside the CVM** (our own prompt-assembly + a model API call from inside the CVM). |
| `node/knowledge.ts` (new) | Store synced notes/docs the assistant draws on. |
| `node/owner.ts` (new) | Owner-auth verification (envelope §5) + setup-token mint/claim (§11). |
| `node/ingress.ts` (edit) | Mount A2A + owner-authenticated routes (`tasks/list`, resolve turns, SSE); keep public mesh routes separate. |
| `node/cards.ts` (edit) | Declare the owner `securityScheme` on the card. |

**Durability:** `assist-remote` persists tasks + queue in `/data/tasks.json` for the PoC
(Deno KV remains the later swap behind the same `TaskStore` seam). Operational/audit events
append to `/data/events.jsonl`; peer discovery snapshots write to `/data/peers.json`.
`decisions.jsonl` stays on the edge.

**Persisted state — `assist-client`:** config (non-secret) in `~/.alignos/config.json`;
owner private key in OS keychain or `~/.alignos/owner.key` (`0600`); `inbox.json`,
`decisions.jsonl`, `scope.json` in `~/.alignos/`. No combined `.alignosrc`.

**CLI surface (1:1 with IPC):**
```
alignos setup --url <gw> --token <t>   # connect + claim ownership
alignos status                         # identity + connection health
alignos inbox                          # requests needing you
alignos show <id>                      # request + draft (+ provenance)
alignos approve <id>                   # send the reply
alignos followup <id> --msg=-          # instruction on stdin; assistant re-drafts
alignos decline <id> [--note]          # refuse
alignos ask --mode quick <question>    # TEE answer from synced notes + log memory
alignos ask --mode deep <question>     # local execution; prompts for scoped access as needed
alignos scope [list|allow|deny] <path> # local-data folders / approved agent-log roots
alignos serve                          # run the edge bridge headless (no window)
```

**Runtimes:** `assist-client` = Node/Electron; `assist-remote` = Deno. Clean HTTP boundary.

**Multi-device:** v1 is **single-device** — the setup token binds exactly one owner key.
Named/revocable keys and per-device registration are deferred.

---

## 9. Request model and lifecycle

```
peer's assistant ──message/send──► assist-remote
                                      │  triage (inbox.ts: Connections + Auto-handle)
            Quick Mode eligible       │ else / needs local data / novel
                       ▼                  │                 ▼
              auto-respond in CVM         │     needs local data?──yes──► task=auth-required
              (logged)                    │            │ no                   │ assist-client reads
                                          │            ▼                      ▼ scoped+redacted slice
                                          │     draft in CVM (input-required) draft in CVM w/ slice
                                          │            └──────────┬───────────┘
                                          │     assist-client streams it in (SSE; durable queue)
                                          │                       │
                              ┌──────────── INBOX: human reviews (Review screen) ──────────┐
                              │   Approve   ·   Follow up   ·   Decline                     │
                              └────────┬──────────────┬───────────────┬────────────────────┘
                                       ▼              ▼               ▼
                          finalizing Message   instruction →     cancel / refusal
                          task → completed      re-draft → inbox  task → canceled
                                       │                              │
                              reply ──A2A──► asker   ────────────────►│ append decisions.jsonl
```

Envelope around a `Task`:
```js
{ task, read:false, pulledAt:"<iso>", decisionRef:null }
```
`decisions.jsonl` entry:
```js
{ taskId, contextId, verdict:"approve|followup|decline",
  instruction:"<follow-up text>", note:"<decline reason>", at:"<iso>" }
```

---

## 10. UI / screens and visual design

Single-window state machine (daybook's `<section hidden>` swap; sticky action footer).
**v1 screens:** Set up/Connect · Inbox · Review · All-clear (empty) · Handled-privately
(audit) · Preferences · plus loading/error/success.

- **Review** shows the asker (with a *Connected* trust chip), the ask, the read-only draft, a
  **provenance** line (*"Used your approved notes — raw local files weren't sent"*), and a
  **consequence** line (*"Approving sends this to Mara's assistant. You'll have a moment to
  undo."*) above **[Decline · Follow up · Approve]**.
- **Three actions, no inline editing:** Approve sends; Follow up opens a small instruction box
  → re-draft; Decline (optional reason). Rationale: simpler, cleaner provenance, richer future
  signal than a silent diff.
- **Preferences** (the control center): **Connections** (per-person auto-handle vs always-ask;
  anyone new = always ask), **Auto-handle** (toggles; the "reads a private folder → always
  ask" guardrail can't be switched on), **What your assistant knows** (notes/docs synced to
  the private space plus optional onboarding log memory — no profile in v1), **Folders it can
  read** (deny-by-default; no onboarding folder prompt; requested later only for Deep Mode,
  read-only, secrets masked, still needs in-the-moment okay).

**Visual design language — "Quiet"** (chosen direction; mockups in
[`mockups/`](./mockups/), `5-quiet-complete.html` + `6-quiet-preferences.html` are the
reference):
- Light, editorial-calm. Paper `#FBFAF7`, ink `#1B1A17`, muted `#7C766B`, hairline `#E8E3D8`,
  one indigo accent `#34357A`, a green `#3C6E4F` for trust/affirmation.
- Type: serif (`ui-serif`) for headlines/asks, system sans for body, mono for labels/meta.
- Components: hairline dividers over shadows, subtle initial-avatars, the dark-ink primary
  button, single quiet trust lines (provenance/consequence) rather than panels.
- Ethic: restraint; no emoji in user-facing prose; honest about what leaves.

---

## 11. Onboarding

Two phases; **v1 connects to an already-running private space.** One-click provisioning is a
later layer on the same connect path.

**v1 — connect + seed memory:**
1. For the demo, the node is already deployed by an operator via existing `tee-mesh` paths:
   local dev `scripts/local-test.sh` (anvil; defaults to `http://localhost:8080`), or
   `npx phala deploy` once by hand for a real CVM.
2. First launch → enter the gateway URL + a **one-time setup token** the node prints at boot.
3. `assist-client` generates an owner keypair and claims ownership with the token.
4. After a successful claim, `assist-client` offers to use recent local agent logs from
   `~/.claude`, `~/.codex`, `~/.openclaw`, `~/.pi`, `~/.opencode`, and `~/.hermes`
   to help the assistant understand the owner's work.
5. If approved, the edge reads, compacts, and redacts those logs locally, then sends only the
   bounded digest/corpus to `assist-remote` for storage in the CVM knowledge store.
6. Onboarding does **not** ask for folder access. Folder/file access is reserved for Deep
   Mode, where the TEE can suggest a scoped request and the edge enforces owner approval.

For the first multi-user instantiation, assume three operator-provisioned private spaces:
Albi claims one, Andrew claims one, and Shashank claims one. After claim, each instance
participates in the same mesh, advertises its assistant surface, and enforces its own
owner-auth key, inbox, preferences, and auto-handle policy.

**Setup-token rules (PoC, explicit):**
- **Single-use, 15-minute TTL**, minted at `assist-remote` boot (in logs / event log).
- The **first valid claim binds the owner key and immediately invalidates the token.**
- **Rotation/recovery:** the operator (who controls the CVM) restarts `assist-remote` to mint
  a fresh token; a new claim **rebinds** the owner key.
- **Wrong client claims first:** owner routes are bound to that key until the operator
  re-mints + rebinds. Acceptable for PoC because token visibility requires CVM/log access;
  hardening (claim challenge, attestation-bound claim) is a §16 risk.

**Later — one-click Set up:** wraps the deploy, captures the boot token, registers the key —
zero-touch. Needs Phala deploy auth (one-time key, or a bundled demo key).

---

## 12. v1 scope vs deferred

**Ships in v1:** Set up/Connect · Inbox · Review (trust layer) · All-clear · Handled-audit ·
**Preferences (all four controls)**; the "Ask my assistant" loop incl. **local-data reads**
(scope + redact + approved agent logs, edge-reads-then-CVM-drafts); real A2A (v1 subset) with
client-initiated SSE; Deno KV task store; owner-auth envelope; `decisions.jsonl` capture; CLI.

**Deferred (seam in place):**
- **v1.1:** full edge **execution** (acting on the machine); action-approval kind.
- **Later — eval/RLHF:** rubric, gates, judge, best-of-N, per-owner private training; owner
  **profile**. Consumes `decisions.jsonl`. (Pattern proven in daybook's `evals/`.)
- **Later — one-click provisioning; multi-device (named/revocable keys); inbound push
  webhooks / `message/stream`; connections view; "outside" export; confidential inference.**

---

## 13. Design inspiration (router-daybook) — no code dependency

`assist-client` is **standalone**: it does not import, vendor, or copy router-daybook.
Daybook informs the **design and UX** only; every module here is written fresh.

Patterns we borrow (re-implemented, not lifted):
- **App skeleton:** Electron + vanilla-JS single-window state machine; `preload.js`
  contextBridge as the only renderer↔main surface; CommonJS `src/`; Node builtins, minimal deps.
- **The "human is the gate" loop** and the calm, restraint-first product ethic.
- **Deny-by-default scope + deterministic redaction** before anything leaves the device.
- **Reading `~/.claude` / `~/.codex` sessions** as a local grounding source.
- **Prompt-assembly** shape for drafting (the inference transport is our own).
- **Ethic:** simple, calm, privacy-conscious, restraint; honest about what leaves.

---

## 14. Error handling

- **Serve-first:** keep the node's posture — boot serves immediately; registration/gossip background.
- **Laptop offline / asleep:** Deno-KV queue holds tasks; `assist-client` reconciles via
  `tasks/resubscribe` + a `tasks/list` catch-up on reconnect. No-local-data drafts proceed in
  the CVM meanwhile; local-data requests wait for the edge.
- **SSE drop:** reconnect with backoff; `tasks/list` is the truth, so a dropped stream
  self-heals — no missed request.
- **Draft/model failure:** task stays `input-required` with an error note; the human can
  Follow up to retry or Decline. Never auto-send.
- **Setup failure / bad token:** plain error + retry; expired/used token → "ask for a fresh
  one" (operator restarts to mint).
- **Owner-auth failure:** owner routes reject bad signatures/replays; a bad local key never
  clobbers a working config (validate-before-save).

---

## 15. Testing strategy

- **CLI is the scriptable test surface:** drive `setup → inbox → show → approve/followup/
  decline` headlessly, assert on JSON, in CI and over SSH on a CVM.
- **Local mesh loop:** extend `scripts/local-test.sh` so a peer node sends a task, it lands in
  the owner queue, the CLI approves, and the reply is asserted at the peer — anvil, no TEE.
- **Owner-auth + redact** get unit tests (pure-ish, high value): signature/replay accept-reject;
  scrubber coverage.
- **`node --check`** syntax on every file; renderer `$('id')` ↔ `index.html` cross-check.
- No automated UI tests; the headless core means the *logic* is testable without Electron.

---

## 16. Open questions / risks

- **Confidential inference:** v1 sends draft context from the CVM to a model provider in the
  clear (to the provider). Whether/when to move to a confidential-inference path is open and
  affects the privacy copy.
- **Model provider + key handling in the CVM:** which model API, and how its key is
  provisioned/rotated inside the CVM, is unspecified.
- **Setup-token hardening:** TOFU is fine for PoC; a claim challenge or attestation-bound
  claim is needed before GA (wrong-first-claim, §11).
- **A2A binding:** JSON-RPC-2.0-over-HTTP assumed; confirm against the node's plain-HTTP server.
- **SSE under real sleep/wake:** validate reconnection + catch-up on actual laptop sleep.
- **Scope of the redacted slice:** how `edge-reader` decides the *minimal* slice to send per
  request (relevance vs over-sharing) needs a concrete heuristic.
