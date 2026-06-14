# TEE Quick Mode — Owner-Style Refinement Loop

**Date:** 2026-06-14
**Status:** Draft (awaiting review)
**Owner node under test:** `shashank` @ `…-8080.dstack-pha-prod7.phala.network` (`mode: tee`)

## Problem

Quick mode is the default path: a peer hits `/ask-<handle>?mode=quick`, the node drafts a
reply in the owner's voice and auto-sends it (no human review). Two gaps:

1. **The deployed TEE node has no model.** The image (`tee-mesh/node/Dockerfile`) is
   `denoland/deno:alpine` + node code — it does not install `claude`/`codex`/`pi`, and no
   `ANTHROPIC_API_KEY` is set. `draft.ts` tries each CLI, falls back to the Anthropic API,
   then to a hardcoded placeholder. **Verified live:**
   `POST /ask-shashank?mode=quick` → `"Thanks for reaching out. (placeholder draft — no
   local model available)"`. The pipeline works; it has no brain.
2. **Quick mode does a single draft.** The goal is for an inbound prompt to go through a
   **5–6 pass loop** that refines the answer, where each pass reproduces **the owner's own
   prompting structure** (learned from their agent-log data) rather than a generic agent loop.

## Goal / Success Criteria

- A real model answers in quick mode (no more placeholder), using the owner's **Claude
  subscription** (cheapest), not pay-per-token API billing.
- An inbound question runs through a **5–6 pass refinement loop** on the node; the answer
  visibly improves across passes and can stop early on convergence.
- Each pass is shaped by a **prompting-style profile** distilled from the owner's logs —
  their opening framing and their characteristic follow-up moves ("make it tighter", "give
  me the tradeoffs", "be concrete", "what breaks at scale").
- The live Phala node returns real, looped answers after redeploy.

## Key Findings (validated)

- `claude -p --append-system-prompt …` runs **headless** on the subscription (returns clean
  stdout, exit 0). This is the load-bearing primitive `draft.ts` already uses.
- Local node boot needs no TEE/chain: absent `DSTACK_SOCKET` → `mode: local`; absent
  `REGISTRY_RPC/CONTRACT/PRIVATE_KEY` → standalone. Env: `ALIGN_PORT`, `ALIGN_SELF_URL`,
  `ALIGN_OWNER_HANDLE`, `ALIGN_MANIFEST(_JSON)`, `ALIGN_TASKS`, `ALIGN_KNOWLEDGE`,
  `ALIGN_DRAFT_BACKEND`.
- `agent-logs.js → ingestCorpus()` currently flattens sessions into `{prompt → output}`
  pairs, **discarding the multi-turn follow-up chain** — exactly the signal the loop needs.
- This machine's `~/.claude` logs are the owner's own prompting data — the style source for
  local testing.

## Design: Owner-Style Refinement Loop

Led by loop-shape option 1 (replicate how the owner prompts), with a thin convergence guard
from option 3 (so passes actually improve and can stop early). Two components.

### Component A — Prompting-style profile

**Capture (client, `agent-logs.js`):** extend `ingestCorpus()` to additionally emit
`chains` — a redacted, capped sample of the owner's *ordered consecutive prompts within a
session* (their refinement moves). Existing `redact()` / `stripCode()` / size caps apply
unchanged. Uploaded alongside `pairs` via the existing `/owner/knowledge` POST.

**Store (node, `knowledge.ts`):** persist `chains` next to `pairs` in `knowledge.json`. Add a
cached `style_profile` string field.

**Distill (node, `loop.ts`):** on first loop use (and whenever the corpus updates),
one cached `claude -p` call summarizes `chains` into a short profile: *how this owner opens a
task and the follow-up moves they tend to make*. Cached in `knowledge.json`; never recomputed
per request.

**Interface:** `getStyleProfile(): Promise<string>` (lazy, cached) in `loop.ts`/`knowledge.ts`.

### Component B — The loop

New file `tee-mesh/node/loop.ts`. `draft.ts` stays the **single-pass primitive** (`infer`,
`runCli`, `callApi` reused; export `infer`).

```
draftLooped(task) -> { artifact, passes }
  N        = clamp(ALIGN_LOOP_PASSES default 6, 2..8)
  profile  = await getStyleProfile()                 // cached
  answer   = await infer(task, "")                   // pass 1 (current behavior)
  trail    = [answer]
  for k in 2..N:
    next = await refinePass(task, answer, profile, k) // ONE CLI call per pass
    if converged(answer, next): break                 // cheap, no LLM call
    answer = next; trail.push(answer)
  return { artifact: replyArtifact(answer), passes: trail }
```

`refinePass` system prompt: *"You simulate how <owner> iterates on their assistant's output.
Here is how they prompt and the follow-ups they make: <profile>. Given the original request
and the current draft: (1) decide the single most likely next refinement the owner would
ask for, (2) apply it and return only the improved reply."* — **one call folds "next prompt"
+ "apply"** → cost control. `converged()` = cheap normalized string-similarity ≥ threshold.

### Wiring (`a2a.ts`)

In `onMessageSend`'s new-task auto path, replace `t.artifacts = [await draftReply(t, "")]`
with `draftLooped(t)` when `ALIGN_LOOP=on`. Record pass count via `appendEvent("a2a_loop",
{ task, passes })` for audit/dashboard. Followup/deep paths unchanged.

## Data Flow

```
peer → /ask-<handle>?mode=quick → a2a new task (auto policy)
  → draftLooped:  infer(pass1) → refinePass×(2..N, early-stop) → final answer
  → task.completed, artifact auto-sent
  (profile derived once from uploaded chains, cached in knowledge.json)
```

## Config / Knobs

- `ALIGN_LOOP` = `on|off` (default `off` until validated, then `on`)
- `ALIGN_LOOP_PASSES` = `6` (clamped 2..8)
- `ALIGN_DRAFT_BACKEND` = `claude` (reused; `api` is fallback)

## Cost Controls

- One CLI call per pass + one cached profile call. Worst case ~7 subscription calls/question;
  typically fewer with early-stop. No API billing on the happy path.

## TEE Model Access (M3) — subscription token in TEE

- Dockerfile: add Node to the `deno:alpine` base (`apk add nodejs npm`) and
  `npm i -g @anthropic-ai/claude-code`; keep `--allow-run=claude,codex,pi`.
- Inject `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token` on the Mac) as a **dstack
  secret/env**. Point claude config at a writable dir under `/data` (`CLAUDE_CONFIG_DIR` or
  `HOME=/data`). Verify `claude -p` runs non-interactively in-container with the token.
- Fallback only: `ANTHROPIC_API_KEY` env if no token present.

## Milestones & Verification

- **M0 — Kill the placeholder (local):** run node locally with `ALIGN_DRAFT_BACKEND=claude`;
  `POST /ask-shashank?mode=quick` returns a real model answer.
- **M1 — Loop (local):** `ALIGN_LOOP=on`; confirm 5–6 passes run and the answer improves;
  pass trail logged.
- **M2 — Style profile (local):** ingest this machine's `~/.claude` chains; profile distilled
  + cached; refinements visibly match the owner's prompting moves.
- **M3 — TEE:** bake claude CLI + OAuth token into image; redeploy Phala node; live
  `/ask-shashank?mode=quick` returns a real looped answer (no placeholder).

## Testing

- Unit: `converged()` thresholds; `chains` extraction + redaction in `agent-logs.js`;
  profile caching (no recompute per request).
- Integration: local node end-to-end per M0/M1/M2; assert pass count and non-placeholder text.
- Live smoke: M3 `/ask` returns non-placeholder; check `events.jsonl` for `a2a_loop`.

## Risks / Caveats

- **Latency:** ~5–7 sequential CLI calls → quick-mode answer in tens of seconds. Acceptable
  for the async A2A/inbox model (peer polls the task); note it.
- **ToS / rate limits:** a personal Claude subscription token running automated server-side
  loops in a CVM may hit limits or policy edges. Owner's call; flagged.
- **Privacy:** uploaded `chains` must pass through existing redaction; never raw logs.
- **Image size:** adding Node bloats the TEE image; acceptable for subscription use.

## Out of Scope (YAGNI)

Streaming responses; multi-agent debate; deep-mode changes; persona switching; A2A surface
changes; any non-`claude` backend beyond what the code already supports.
