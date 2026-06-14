# TEE Quick Mode — Owner-Style Refinement Loop Implementation Plan

> Historical implementation plan. The design shipped, but the live Phala M3 deployment uses the
> Codex-backed image (`ghcr.io/sm86/alignos-node:codex1`) with `ALIGN_DRAFT_BACKEND=codex`,
> `ALIGN_LOOP=on`, and `CODEX_AUTH_JSON_B64`, not the original Claude-token image path below.
> See [`../quick-mode-style-loop-design.md`](../quick-mode-style-loop-design.md),
> [`../notes/2026-06-14-loop-local-verification.md`](../notes/2026-06-14-loop-local-verification.md),
> and [`../../../tee-mesh/DEPLOY.md`](../../../tee-mesh/DEPLOY.md) for the current runbook.

**Goal:** Make TEE quick mode answer with a real model by running an inbound prompt through a configurable refinement loop that replays the owner's prompting style learned from their agent logs.

**Architecture:** A new `loop.ts` orchestrates passes over the existing single-pass `draft.ts` primitive: pass 1 is the current draft, passes 2–6 call `refinePass()` (one `claude -p` call each) that acts as the owner, picks the next refinement in their style, and applies it — stopping early on convergence. The owner's prompting style is distilled (one cached call) from redacted "follow-up chains" extracted from their logs by `agent-logs.js`. `a2a.ts` gains an injectable drafter seam so the loop is wired behind `ALIGN_LOOP=on` and unit-testable. M3 bakes the `claude` CLI + an OAuth token into the TEE image.

**Tech Stack:** Deno + TypeScript (`tee-mesh/node`), Node/CommonJS + Electron (`assist-local`). Tests: `deno test -A` for node code, `node --test` for client code.

---

## File Structure

**Node (`tee-mesh/node/`)**
- `loop.ts` — **new.** Loop orchestration: `similarity`, `converged`, `runLoop` (pure), `refinePass`, `getStyleProfile`, `draftLooped`.
- `loop_test.ts` — **new.** Unit tests for the pure pieces.
- `draft.ts` — **modify.** Extract+export `complete(system,user)`; export `infer`.
- `knowledge.ts` — **modify.** Store `chains` + cached `style_profile`; add `getChains`/`getCachedProfile`/`setCachedProfile`; invalidate profile on corpus update.
- `knowledge_test.ts` — **new.** Profile-cache invalidation test.
- `a2a.ts` — **modify.** Injectable `draftNew`/`draftRevise` on `A2ACtx`; `ALIGN_LOOP` gate; `a2a_loop` event.
- `a2a_test.ts` — **new.** Wiring test with a fake drafter.
- `ingress.ts` — **modify.** Pass the whole `/owner/knowledge` body to `setCorpus`.
- `Dockerfile` — **modify.** Add Node + `claude` CLI; `HOME=/data`.
- `scripts/dev-local.sh` — **new.** Local standalone run for M0–M2.

**Client (`assist-local/`)**
- `src/agent-logs.js` — **modify.** Add `userPromptChain` (pure) + `ingestStyle`; export both.
- `src/agent-logs.test.js` — **new.** `userPromptChain` test (`node --test`).
- `src/mesh-client.js` — **modify.** `uploadKnowledge(pairs, chains)`.
- `src/main.js`, `bin/alignos` — **modify.** Upload chains alongside pairs.

---

## Task 1: M0 — Local dev harness, kill the placeholder

**Files:**
- Create: `tee-mesh/node/scripts/dev-local.sh`

- [ ] **Step 1: Create the local-run script**

```bash
# tee-mesh/node/scripts/dev-local.sh
#!/usr/bin/env bash
set -euo pipefail
export ALIGN_PORT="${ALIGN_PORT:-8787}"
export ALIGN_OWNER_HANDLE="${ALIGN_OWNER_HANDLE:-shashank}"
export ALIGN_MANIFEST_JSON="${ALIGN_MANIFEST_JSON:-[]}"
export ALIGN_TASKS="${ALIGN_TASKS:-/tmp/align-dev-tasks.json}"
export ALIGN_KNOWLEDGE="${ALIGN_KNOWLEDGE:-/tmp/align-dev-knowledge.json}"
export ALIGN_DRAFT_BACKEND="${ALIGN_DRAFT_BACKEND:-claude}"
export ALIGN_LOOP="${ALIGN_LOOP:-off}"
export ALIGN_LOOP_PASSES="${ALIGN_LOOP_PASSES:-6}"
export ALIGN_SELF_URL="${ALIGN_SELF_URL:-http://localhost:${ALIGN_PORT}}"
cd "$(dirname "$0")/.."
exec deno task start
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x tee-mesh/node/scripts/dev-local.sh`

- [ ] **Step 3: Start the node (terminal 1)**

Run: `bash tee-mesh/node/scripts/dev-local.sh`
Expected: logs `[alignos] identity node_id=… mode=local …` then `[alignos] serving on :8787 …`

- [ ] **Step 4: Verify quick mode returns a real answer (terminal 2)**

Run:
```bash
curl -sS -X POST localhost:8787/ask-shashank \
  -H 'content-type: application/json' \
  -d '{"mode":"quick","question":"How would you design a rate limiter for a multi-tenant API?"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["artifacts"][0]["parts"][0]["text"])'
```
Expected: a real multi-sentence answer about rate limiting. It MUST NOT contain `placeholder draft`. (Stop the node with Ctrl-C after.)

- [ ] **Step 5: Commit**

```bash
git add tee-mesh/node/scripts/dev-local.sh
git commit -m "feat(node): local dev-run script; quick mode answers with claude CLI"
```

---

## Task 2: `similarity` + `converged` (pure)

**Files:**
- Create: `tee-mesh/node/loop.ts`
- Test: `tee-mesh/node/loop_test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tee-mesh/node/loop_test.ts
import { converged, similarity } from "./loop.ts";

// dependency-free assert, matching owner_test.ts's house style
const eq = (a: unknown, b: unknown, m = "") => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
};

Deno.test("similarity: identical = 1, disjoint = 0, partial in-between", () => {
  eq(similarity("hello world", "hello world"), 1);
  eq(similarity("alpha beta", "gamma delta"), 0);
  const s = similarity("the quick brown fox", "the quick brown cat");
  if (!(s > 0 && s < 1)) throw new Error(`expected partial, got ${s}`);
});

Deno.test("converged: identical converges, disjoint does not", () => {
  eq(converged("same text here", "same text here"), true);
  eq(converged("totally one thing", "completely other words"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tee-mesh/node && deno test -A loop_test.ts`
Expected: FAIL — `Module not found "./loop.ts"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// tee-mesh/node/loop.ts
// Owner-style refinement loop: pass 1 = draft, passes 2..N = refine in the owner's
// prompting style, stop early on convergence. Pure helpers here are unit-tested.

const tokens = (s: string): Set<string> =>
  new Set((s.toLowerCase().match(/\b\w+\b/g) ?? []));

export function similarity(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 1 : inter / union;
}

export function converged(a: string, b: string, threshold = 0.85): boolean {
  return similarity(a, b) >= threshold;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tee-mesh/node && deno test -A loop_test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tee-mesh/node/loop.ts tee-mesh/node/loop_test.ts
git commit -m "feat(node): similarity + converged helpers for the refinement loop"
```

---

## Task 3: `runLoop` orchestrator (pure, injected I/O)

**Files:**
- Modify: `tee-mesh/node/loop.ts`
- Test: `tee-mesh/node/loop_test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tee-mesh/node/loop_test.ts`:
```ts
import { runLoop } from "./loop.ts";

Deno.test("runLoop: runs N passes when never converging", async () => {
  let refineCalls = 0;
  const trail = await runLoop({
    passes: 5,
    first: () => Promise.resolve("p1"),
    refine: (_cur, k) => { refineCalls++; return Promise.resolve(`p${k}`); },
    isConverged: () => false,
  });
  eq(trail, ["p1", "p2", "p3", "p4", "p5"]);
  eq(refineCalls, 4);
});

Deno.test("runLoop: stops early on convergence", async () => {
  let refineCalls = 0;
  const trail = await runLoop({
    passes: 6,
    first: () => Promise.resolve("same"),
    refine: () => { refineCalls++; return Promise.resolve("same"); },
  });
  eq(trail, ["same", "same"]);
  eq(refineCalls, 1);
});

Deno.test("runLoop: clamps passes to 8", async () => {
  const trail = await runLoop({
    passes: 100,
    first: () => Promise.resolve("x0"),
    refine: (_c, k) => Promise.resolve(`x${k}`),
    isConverged: () => false,
  });
  eq(trail.length, 8);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tee-mesh/node && deno test -A loop_test.ts`
Expected: FAIL — `runLoop is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `tee-mesh/node/loop.ts`:
```ts
export interface RunLoopOpts {
  passes: number;
  first: () => Promise<string>;
  refine: (current: string, k: number) => Promise<string>;
  isConverged?: (a: string, b: string) => boolean;
}

export async function runLoop(opts: RunLoopOpts): Promise<string[]> {
  const passes = Math.max(1, Math.min(opts.passes, 8));
  const isConverged = opts.isConverged ?? converged;
  let current = await opts.first();
  const trail = [current];
  for (let k = 2; k <= passes; k++) {
    const next = await opts.refine(current, k);
    trail.push(next);
    if (isConverged(current, next)) break;
    current = next;
  }
  return trail;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tee-mesh/node && deno test -A loop_test.ts`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add tee-mesh/node/loop.ts tee-mesh/node/loop_test.ts
git commit -m "feat(node): runLoop orchestrator with early-stop and pass clamp"
```

---

## Task 4: Extract `complete()`/export `infer` in draft.ts; add `refinePass`/`draftLooped`

**Files:**
- Modify: `tee-mesh/node/draft.ts`
- Modify: `tee-mesh/node/loop.ts`

- [ ] **Step 1: Refactor draft.ts to expose a generic completion primitive**

In `tee-mesh/node/draft.ts`, replace the `infer` function (lines ~47–77) with this split (keep `buildPrompt`, `runCli`, `callApi`, `BACKEND`, `MODEL_KEY` as-is):
```ts
// Generic single completion across the configured backends. Throws if none produce output.
export async function complete(system: string, user: string): Promise<string> {
  const order = BACKEND === "auto" ? ["claude", "api"] : [BACKEND];
  for (const b of order) {
    try {
      if (b === "claude") {
        return (await runCli("claude", ["-p", "--append-system-prompt", system], user)).trim();
      }
      if (b === "codex") {
        return (await runCli("codex", ["exec", "--skip-git-repo-check", `${system}\n\n${user}`], null)).trim();
      }
      if (b === "pi") {
        return (await runCli("pi", ["-p", `${system}\n\n${user}`], null)).trim();
      }
      if (b === "api" && MODEL_KEY) return (await callApi(system, user)).trim();
    } catch (_e) { /* fall through to the next backend */ }
  }
  throw new Error("no model backend available");
}

export async function infer(task: Task, instruction: string): Promise<string> {
  const { system, user } = buildPrompt(task, instruction);
  try {
    return await complete(system, user);
  } catch {
    const ask = textOf(task.history[0]?.parts ?? []);
    return `Thanks for reaching out. (placeholder draft — no local model available)\nRe: "${
      ask.slice(0, 160)
    }"`;
  }
}
```

- [ ] **Step 2: Verify draft.ts still type-checks**

Run: `cd tee-mesh/node && deno check draft.ts`
Expected: no errors. (`draftReply` still calls `infer`; behavior unchanged.)

- [ ] **Step 3: Add `refinePass` and `draftLooped` to loop.ts**

Append to `tee-mesh/node/loop.ts` (add the imports at the top of the file):
```ts
import { type Artifact, type Task, textOf } from "./inbox.ts";
import { complete, infer } from "./draft.ts";
import { appendEvent } from "./eventlog.ts";
import { getStyleProfile } from "./profile.ts";

export async function refinePass(
  task: Task,
  current: string,
  profile: string,
  k: number,
): Promise<string> {
  const ask = textOf(task.history[0]?.parts ?? []);
  const system =
    "You simulate how a specific person iterates on their AI assistant's output to make it " +
    "better. " +
    (profile ? `Here is how that person prompts:\n${profile}\n\n` : "") +
    "Given the original request and the current draft reply: (1) internally decide the single " +
    "most useful next refinement that person would ask for, (2) apply it. Output ONLY the " +
    "improved reply — plain text, no preamble, no markdown, no sign-off line.";
  const user =
    `Original request:\n${ask}\n\nCurrent draft (pass ${k - 1}):\n${current}\n\n` +
    "Return the improved reply.";
  try {
    return (await complete(system, user)).trim() || current;
  } catch {
    return current; // a failed pass never regresses the answer
  }
}

export async function draftLooped(task: Task): Promise<Artifact> {
  const passes = Math.max(2, Math.min(Number(Deno.env.get("ALIGN_LOOP_PASSES") ?? "6"), 8));
  const profile = await getStyleProfile();
  const trail = await runLoop({
    passes,
    first: () => infer(task, ""),
    refine: (cur, k) => refinePass(task, cur, profile, k),
  });
  await appendEvent("a2a_loop", { task: task.id, passes: trail.length });
  return {
    artifactId: crypto.randomUUID(),
    name: "reply",
    parts: [{ kind: "text", text: trail[trail.length - 1] }],
  };
}
```

(Note: `getStyleProfile` lives in `profile.ts`, created in Task 7. Until then, `deno check` of `loop.ts` will report a missing module — that is resolved in Task 7. Do not run the loop yet.)

- [ ] **Step 4: Commit**

```bash
git add tee-mesh/node/draft.ts tee-mesh/node/loop.ts
git commit -m "feat(node): complete() primitive + refinePass/draftLooped loop body"
```

---

## Task 5: Wire a2a.ts to the loop behind `ALIGN_LOOP` (injectable drafter)

**Files:**
- Modify: `tee-mesh/node/a2a.ts`
- Test: `tee-mesh/node/a2a_test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tee-mesh/node/a2a_test.ts
import { TaskStore, type Artifact, type Task } from "./inbox.ts";
import { handleA2A } from "./a2a.ts";

const eq = (a: unknown, b: unknown, m = "") => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
};

function fakeArtifact(text: string): Artifact {
  return { artifactId: "fake", name: "reply", parts: [{ kind: "text", text }] };
}

Deno.test("new auto task uses the injected draftNew and completes", async () => {
  const dir = await Deno.makeTempDir();
  Deno.env.set("ALIGN_TASKS", `${dir}/tasks.json`);
  const store = new TaskStore();
  await store.load();

  let calls = 0;
  const ctx = {
    store,
    selfId: "self",
    draftNew: (_t: Task) => { calls++; return Promise.resolve(fakeArtifact("LOOPED REPLY")); },
  };

  const rpc = JSON.stringify({
    jsonrpc: "2.0",
    id: "1",
    method: "message/send",
    params: { message: { role: "user", parts: [{ kind: "text", text: "hi" }], messageId: "m1" } },
  });
  const res = await handleA2A(ctx, rpc, false);
  const body = await res.json();

  eq(calls, 1);
  eq(body.result.status.state, "completed");
  eq(body.result.artifacts[0].parts[0].text, "LOOPED REPLY");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tee-mesh/node && deno test -A a2a_test.ts`
Expected: FAIL — `draftNew` is ignored (real `draftReply` runs), so `calls` is 0 / text mismatch.

- [ ] **Step 3: Implement the injectable drafter seam**

In `tee-mesh/node/a2a.ts`:

(a) Update imports and add the loop gate near the top:
```ts
import { draftReply } from "./draft.ts";
import { draftLooped } from "./loop.ts";

const LOOP_ON = (Deno.env.get("ALIGN_LOOP") ?? "off").toLowerCase() === "on";
const defaultDraftNew = (t: Task): Promise<Artifact> =>
  LOOP_ON ? draftLooped(t) : draftReply(t, "");
```
(`Artifact` is already exported from `inbox.ts`; add it to the existing `import { … } from "./inbox.ts"` line.)

(b) Extend `A2ACtx`:
```ts
export interface A2ACtx {
  store: TaskStore;
  policy?: Policy;
  selfId: string;
  draftNew?: (t: Task) => Promise<Artifact>;
  draftRevise?: (t: Task, instruction: string) => Promise<Artifact>;
}
```

(c) At the top of `onMessageSend`, resolve the drafters:
```ts
async function onMessageSend(ctx: A2ACtx, params: any, owner: boolean): Promise<Task> {
  const msg = params?.message as Message;
  if (!msg?.parts) throw new Error("message.parts required");
  const draftNew = ctx.draftNew ?? defaultDraftNew;
  const draftRevise = ctx.draftRevise ?? ((t: Task, instruction: string) => draftReply(t, instruction));
```

(d) Replace the three draft call sites:
- followup path: `t.artifacts = [await draftReply(t, textOf(msg.parts))];` → `t.artifacts = [await draftRevise(t, textOf(msg.parts))];`
- peer-input path: `t.artifacts = [await draftReply(t, "")];` → `t.artifacts = [await draftNew(t)];`
- new-task path: `t.artifacts = [await draftReply(t, "")];` → `t.artifacts = [await draftNew(t)];`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tee-mesh/node && deno test -A a2a_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tee-mesh/node/a2a.ts tee-mesh/node/a2a_test.ts
git commit -m "feat(node): inject drafter into a2a; ALIGN_LOOP gate + a2a_loop event"
```

---

## Task 6: `userPromptChain` (pure) in agent-logs.js

**Files:**
- Modify: `assist-local/src/agent-logs.js`
- Test: `assist-local/src/agent-logs.test.js`

- [ ] **Step 1: Write the failing test**

```js
// assist-local/src/agent-logs.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { userPromptChain } = require('./agent-logs');

test('userPromptChain keeps ordered user prompts, drops assistant + short', () => {
  const msgs = [
    { role: 'user', text: 'Design a rate limiter for a multi-tenant API' },
    { role: 'assistant', text: 'Here is a design with token buckets ...' },
    { role: 'user', text: 'ok' }, // too short, dropped
    { role: 'user', text: 'now make it tighter and add the tradeoffs' },
  ];
  const chain = userPromptChain(msgs);
  assert.strictEqual(chain.length, 2);
  assert.ok(chain[0].includes('rate limiter'));
  assert.ok(chain[1].includes('tradeoffs'));
});

test('userPromptChain caps each prompt length and total turns', () => {
  const long = 'x'.repeat(1000);
  const msgs = Array.from({ length: 20 }, () => ({ role: 'user', text: long }));
  const chain = userPromptChain(msgs, { maxLen: 100, maxTurns: 5 });
  assert.strictEqual(chain.length, 5);
  assert.ok(chain[0].length <= 100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd assist-local && node --test src/agent-logs.test.js`
Expected: FAIL — `userPromptChain is not a function`.

- [ ] **Step 3: Implement `userPromptChain` and export it**

In `assist-local/src/agent-logs.js`, add this function (place it just above `ingestCorpus`, after `stripCode`):
```js
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
```
Then add `userPromptChain` to the `module.exports` object on the last line.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd assist-local && node --test src/agent-logs.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add assist-local/src/agent-logs.js assist-local/src/agent-logs.test.js
git commit -m "feat(client): userPromptChain — extract redacted owner prompt chains"
```

---

## Task 7: `ingestStyle` + node-side `profile.ts` + upload wiring

**Files:**
- Modify: `assist-local/src/agent-logs.js`
- Modify: `assist-local/src/mesh-client.js`
- Modify: `assist-local/src/main.js`, `assist-local/bin/alignos`
- Modify: `tee-mesh/node/knowledge.ts`, `tee-mesh/node/ingress.ts`
- Create: `tee-mesh/node/profile.ts`
- Test: `tee-mesh/node/knowledge_test.ts`

- [ ] **Step 1: Add `ingestStyle` to agent-logs.js**

In `assist-local/src/agent-logs.js`, add (just below `userPromptChain`):
```js
// Build redacted prompt chains across recent sessions — the corpus that teaches the loop
// how the owner iterates. Mirrors ingestCorpus(); chains with <2 turns are skipped.
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
```
Add `ingestStyle` to `module.exports`.

- [ ] **Step 2: Update `uploadKnowledge` to send chains**

In `assist-local/src/mesh-client.js`, replace line 64:
```js
const uploadKnowledge = (pairs, chains) =>
  ownerPost('/owner/knowledge', chains ? { pairs, chains } : { pairs });
```

- [ ] **Step 3: Send chains from both upload call sites**

In `assist-local/src/main.js` (lines 51–52), replace with:
```js
  const { pairs, stats } = agentLogs.ingestCorpus({ days: 7, maxPairs: 1500 });
  const { chains } = agentLogs.ingestStyle({ days: 7 });
  const r = await mc.uploadKnowledge(pairs, chains);
```
In `assist-local/bin/alignos`, do the same at both blocks (lines ~49–50 and ~56–57): add `const { chains } = require('../src/agent-logs').ingestStyle(seedOpts());` after the `ingestCorpus` line and pass `chains` to `mc.uploadKnowledge(pairs, chains)`.

- [ ] **Step 4: Store chains + profile cache in knowledge.ts**

In `tee-mesh/node/knowledge.ts`, replace the body (keep the `Pair` interface and `styleExamples`) with:
```ts
const PATH = Deno.env.get("ALIGN_KNOWLEDGE") ?? "./knowledge.json";

interface Stored { pairs: Pair[]; chains: string[][]; style_profile?: string | null }
const loaded: Stored = (() => {
  try {
    const j = JSON.parse(Deno.readTextFileSync(PATH));
    return {
      pairs: (j.pairs ?? []) as Pair[],
      chains: (j.chains ?? []) as string[][],
      style_profile: (j.style_profile ?? null) as string | null,
    };
  } catch {
    return { pairs: [], chains: [], style_profile: null };
  }
})();

let pairs: Pair[] = loaded.pairs;
let chains: string[][] = loaded.chains;
let profile: string | null = loaded.style_profile ?? null;

function persist(): void {
  try {
    Deno.writeTextFileSync(
      PATH,
      JSON.stringify({ pairs, chains, style_profile: profile, updated_at: new Date().toISOString() }),
    );
  } catch { /* in-memory only */ }
}

function normalizeChains(next: unknown): string[][] {
  if (!Array.isArray(next)) return [];
  return next
    .filter((c): c is unknown[] => Array.isArray(c))
    .map((c) => c.filter((s): s is string => typeof s === "string").slice(0, 12))
    .filter((c) => c.length >= 2)
    .slice(0, 200);
}

export function setCorpus(body: { pairs?: unknown; chains?: unknown }): { count: number } {
  pairs = (Array.isArray(body?.pairs) ? body.pairs : [])
    .filter((p): p is Pair => !!p && typeof (p as Pair).prompt === "string")
    .slice(0, 5000);
  chains = normalizeChains(body?.chains);
  profile = null; // corpus changed → invalidate the cached style profile
  persist();
  return { count: pairs.length };
}

export function knowledgeStats(): { count: number } {
  return { count: pairs.length };
}

export function getChains(): string[][] {
  return chains;
}
export function getCachedProfile(): string | null {
  return profile;
}
export function setCachedProfile(p: string): void {
  profile = p;
  persist();
}
```

- [ ] **Step 5: Pass the whole body to setCorpus in ingress.ts**

In `tee-mesh/node/ingress.ts` (the `/owner/knowledge` handler, ~lines 123–124), replace:
```ts
      const body = JSON.parse(bodyText) as { pairs?: unknown; chains?: unknown };
      return Response.json(setCorpus(body));
```

- [ ] **Step 6: Create profile.ts (distill + cache)**

```ts
// tee-mesh/node/profile.ts
// The owner's prompting-style profile, distilled once from their prompt chains and cached
// in knowledge.json. Invalidated whenever the corpus is re-uploaded.
import { complete } from "./draft.ts";
import { getCachedProfile, getChains, setCachedProfile } from "./knowledge.ts";

export async function getStyleProfile(): Promise<string> {
  const cached = getCachedProfile();
  if (cached) return cached;
  const chains = getChains();
  if (!chains.length) return "";
  const sample = chains.slice(0, 12)
    .map((c, i) => `Session ${i + 1} — the owner's prompts in order:\n` + c.map((p) => `  • ${p}`).join("\n"))
    .join("\n\n");
  const system = "You analyze how a person prompts an AI assistant. Be concise and concrete.";
  const user =
    "Below are sequences of one person's prompts within sessions, in order. Describe HOW THEY " +
    "PROMPT: how they open a task, the kinds of follow-up moves they make to refine an answer, " +
    "their tone and level of specificity. 6-10 short bullet points. No preamble.\n\n" + sample;
  try {
    const out = (await complete(system, user)).trim();
    if (out) setCachedProfile(out);
    return out;
  } catch {
    return "";
  }
}
```

- [ ] **Step 7: Point loop.ts at profile.ts**

This is already imported in Task 4 as `import { getStyleProfile } from "./profile.ts";`. Confirm `loop.ts` now type-checks:
Run: `cd tee-mesh/node && deno check loop.ts a2a.ts main.ts`
Expected: no errors.

- [ ] **Step 8: Write + run the profile-cache invalidation test**

```ts
// tee-mesh/node/knowledge_test.ts
const eq = (a: unknown, b: unknown, m = "") => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
};

Deno.test("setCorpus stores chains and invalidates the cached profile", async () => {
  const dir = await Deno.makeTempDir();
  Deno.env.set("ALIGN_KNOWLEDGE", `${dir}/knowledge.json`);
  const k = await import(`./knowledge.ts?test=${crypto.randomUUID()}`);

  k.setCachedProfile("OLD PROFILE");
  eq(k.getCachedProfile(), "OLD PROFILE");

  k.setCorpus({
    pairs: [{ prompt: "hi", output: "yo" }],
    chains: [["first prompt here", "now refine it please"]],
  });

  eq(k.getCachedProfile(), null); // invalidated
  eq(k.getChains().length, 1);
  eq(k.knowledgeStats().count, 1);
});
```
Run: `cd tee-mesh/node && deno test -A knowledge_test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add tee-mesh/node/knowledge.ts tee-mesh/node/knowledge_test.ts tee-mesh/node/profile.ts \
        tee-mesh/node/ingress.ts assist-local/src/agent-logs.js assist-local/src/mesh-client.js \
        assist-local/src/main.js assist-local/bin/alignos
git commit -m "feat: prompting-style chains end-to-end (ingest, store, distill, cache)"
```

---

## Task 8: M1+M2 — Local integration of the full loop

**Files:** none (verification using Task 1 harness)

- [ ] **Step 1: Seed a knowledge corpus with chains for the local node**

Run:
```bash
cat > /tmp/align-dev-knowledge.json <<'JSON'
{
  "pairs": [{ "project": "demo", "prompt": "design the routing layer", "output": "use a registry + gossip" }],
  "chains": [
    ["how should we design the agent routing layer", "now make it concrete with components", "what breaks at scale and how do we mitigate"],
    ["draft the rate limiter design", "tighten it, fewer words", "add the tradeoffs section"]
  ]
}
JSON
```

- [ ] **Step 2: Start the node with the loop on**

Run: `ALIGN_LOOP=on ALIGN_LOOP_PASSES=6 bash tee-mesh/node/scripts/dev-local.sh`
Expected: serving on :8787.

- [ ] **Step 3: Ask in quick mode and confirm the loop ran**

Run (terminal 2):
```bash
curl -sS -X POST localhost:8787/ask-shashank -H 'content-type: application/json' \
  -d '{"mode":"quick","question":"How would you design a rate limiter for a multi-tenant API?"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["artifacts"][0]["parts"][0]["text"])'
```
Expected: a polished answer (no `placeholder draft`). This call takes ~20–60s (5–6 sequential model calls).

- [ ] **Step 4: Confirm the loop + profile fired**

Run: `grep -E 'a2a_loop' tee-mesh/node/events.jsonl | tail -1`
Expected: a line like `{"type":"a2a_loop", ... "passes":<2..6>}`. Then check the profile was cached:
Run: `python3 -c 'import json;print(bool(json.load(open("/tmp/align-dev-knowledge.json")).get("style_profile")))'`
Expected: `True`.

- [ ] **Step 5: (Optional) A/B sanity check vs single-pass**

Run the same curl with the node started **without** `ALIGN_LOOP=on` and eyeball that the looped answer is tighter/more complete. No assertion — qualitative.

- [ ] **Step 6: Commit a short verification note**

```bash
mkdir -p docs/specs/notes
cat > docs/specs/notes/2026-06-14-loop-local-verification.md <<'MD'
# Local loop verification (M1+M2)
- quick mode returns a real answer (no placeholder) with ALIGN_DRAFT_BACKEND=claude
- ALIGN_LOOP=on → events.jsonl shows a2a_loop with passes in 2..6
- style_profile cached in knowledge.json after first looped ask
MD
git add docs/specs/notes/2026-06-14-loop-local-verification.md
git commit -m "docs: local verification notes for the refinement loop (M1+M2)"
```

---

## Task 9: M3 — Bake a real model into the TEE image

**Files:**
- Modify: `tee-mesh/node/Dockerfile`

- [ ] **Step 1: Add Node + the claude CLI to the image**

Replace `tee-mesh/node/Dockerfile` with:
```dockerfile
FROM denoland/deno:alpine
# claude CLI (Node) — quick-mode inference uses the owner's subscription via CLAUDE_CODE_OAUTH_TOKEN
RUN apk add --no-cache nodejs npm \
 && npm i -g @anthropic-ai/claude-code \
 && npm cache clean --force
WORKDIR /app
COPY . .
RUN mkdir -p /data && chmod 0777 /data
# claude writes its config under $HOME; /data is the writable CVM volume
ENV HOME=/data
RUN deno cache main.ts
EXPOSE 8080
VOLUME ["/data"]
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-run=claude,codex,pi", "main.ts"]
```

- [ ] **Step 2: Build the image and verify the CLI is present + headless-capable**

Run:
```bash
docker build -t alignos-node:loop tee-mesh/node
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN="$(claude setup-token | tail -1)" \
  alignos-node:loop sh -lc 'echo "Reply with exactly: PONG" | claude -p --append-system-prompt "Output one word."'
```
Expected: prints `PONG`. (Generate the token interactively on your Mac with `claude setup-token`; it is the subscription-backed headless token.)

- [ ] **Step 3: Set deploy env / secrets**

In the dstack/Phala deploy config (see `tee-mesh/DEPLOY.md`), set:
- secret `CLAUDE_CODE_OAUTH_TOKEN` = the token from `claude setup-token`
- env `ALIGN_DRAFT_BACKEND=claude`, `ALIGN_LOOP=on`, `ALIGN_LOOP_PASSES=6`

- [ ] **Step 4: Deploy per DEPLOY.md, then verify the live node**

Run (after redeploy completes):
```bash
BASE="https://29b4c80372a66a7086d9c953b4c9902c7071b701-8080.dstack-pha-prod7.phala.network"
curl -sS --max-time 120 -X POST "$BASE/ask-shashank" -H 'content-type: application/json' \
  -d '{"mode":"quick","question":"How would you design a rate limiter for a multi-tenant API?"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["artifacts"][0]["parts"][0]["text"])'
```
Expected: a real answer, NOT containing `placeholder draft`.

- [ ] **Step 5: Commit**

```bash
git add tee-mesh/node/Dockerfile
git commit -m "feat(tee): bake model CLI auth support into the node image"
```

---

## Task 10: Full test sweep + finish

- [ ] **Step 1: Run all node tests**

Run: `cd tee-mesh/node && deno test -A`
Expected: PASS — `loop_test.ts`, `a2a_test.ts`, `knowledge_test.ts`, `owner_test.ts`.

- [ ] **Step 2: Run all client tests**

Run: `cd assist-local && node --test src/agent-logs.test.js`
Expected: PASS.

- [ ] **Step 3: Type-check the node**

Run: `cd tee-mesh/node && deno check main.ts`
Expected: no errors.

- [ ] **Step 4: Open the PR** (use the finishing-a-development-branch skill)

Branch: `feat/tee-quick-mode-owner-style-loop`. Summarize M0–M3 and the verification evidence in the PR body.

---

## Notes for the implementer

- **Latency is expected:** a looped quick-mode answer is 5–7 sequential `claude -p` calls → tens of seconds. The A2A/inbox model is async (the peer polls the task), so this is acceptable. Do not add streaming (out of scope).
- **Cost:** every model call goes through `claude -p` = the owner's subscription. `api` (ANTHROPIC_API_KEY) is fallback only. Do not introduce API-key calls on the happy path.
- **Privacy:** chains are redacted via the existing `redact()` before leaving the client. Never upload raw log text.
- **ToS caveat:** running a personal subscription token server-side in the CVM may hit rate limits / policy edges — owner accepted this tradeoff.
