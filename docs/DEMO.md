# Demo

One undeniable moment, plus two supporting beats. Everything here is reproducible.

---

## Prerequisites (local demo)

To record the beats below on your own machine:

- **Node backend.** [Deno](https://deno.com) installed (the mesh node runs via `deno task start`).
- **Answer in your voice (§1).** The `codex` CLI installed and logged in (`codex login`) on your
  `PATH`; the node shells out to it when started with `ALIGN_DRAFT_BACKEND=codex` (what the live
  nodes use). `claude` and the Anthropic API are also supported backends (see `ALIGN_DRAFT_BACKEND`).
- **Edge client (§1, §3).** Node.js, then `cd assist-local && npm install`. `bin/alignos` is plain
  JS, no build step. §3's local drafting uses `codex` too; if you also have `claude` installed, force
  codex with `"agent": { "cli": "codex" }` in `~/.alignos/config.json` (the default `auto` prefers
  claude).
- **Mesh routing (§2).** [Foundry](https://book.getfoundry.sh) (`anvil`/`forge`/`cast`) in addition
  to Deno. Without it, fall back to the live prod URLs under [Live endpoints](#live-endpoints).

Client state lives under `~/.alignos` (override with `ALIGN_HOME`); the dev node keeps its runtime
files under `/tmp/align-dev-*`.

**One-command check.** `bash scripts/demo-local-test.sh` runs §1 and §2 end to end and prints
PASS/FAIL. Run it once before you record.

---

## 1. The answer in your voice (the "wow")

**Claim:** a node answers in its owner's **voice and prompting style**, distilled from their private
agent logs, and that styling **never leaves their TEE**. Ask a base foundation model the same thing
and you get a competent but generic, voiceless answer. The contrast is taste plus privacy: the node
sounds like *that person*, because it learned how they think and write from their own agent traces,
redacted and gated the whole way.

What grounds the reply is the owner's redacted style corpus (their own prompts, plus prompt
**chains** the node distills into a prompting-style profile). The corpus shapes voice and rhythm; the
raw logs stay on the owner's device.

**On stage (about 75s):** ask Andrew's node a question in his domain and read the reply. It carries
his moves: broad to narrow, terse imperative, one axis at a time. Then ask a base model the same
question and read its reply: thorough, hedged, nobody's voice.

```bash
# Andrew's node, answering in his voice from his synced (redacted) style profile, inside his TEE
curl -sG "https://29736dcf7742550956c28a1174c1e0724b6d769c-8080.dstack-pha-prod7.phala.network/ask-andrew" \
  --data-urlencode "mode=quick" \
  --data-urlencode "q=<a question in Andrew's domain>" \
  | jq -r '.result.artifacts[0].parts[0].text'
# -> a reply in Andrew's voice and rhythm
```

> "This sounds like Andrew because his agent taught my agent how he thinks and writes, redacted and
> gated the whole way, and that style profile never left his TEE. No base model has his voice."

### The 3-way ablation (do this first, it is what the demo rests on)

Show three states of the **same** question:

| Run | Setup | Expected |
|---|---|---|
| **Base** | A bare `codex exec "<question>"`, no grounding | Competent but generic, nobody's voice |
| **Grounded** | The node with the owner's style corpus seeded | Same substance, in the owner's voice and rhythm |
| **Grounded, profile deleted** | Same node with that corpus removed | Reverts to a generic assistant voice |

The grounding signal is the owner's redacted `knowledge.json` (their own prompts plus prompt
**chains**) that the edge client uploads at onboarding. Toggling it on and off is the ablation.

**Reproduce locally** (no TEE needed) on your own Codex subscription. This walks the three rows
above:

```bash
# Row 1 - BASE (no grounding): competent but generic
codex exec --skip-git-repo-check "<a question in your domain>"

# Row 2 - GROUNDED
# 1. Boot a node with the codex backend (Deno; on :8787)
ALIGN_DRAFT_BACKEND=codex bash tee-mesh/node/scripts/dev-local.sh

# 2. Connect + seed it (tokenless). setup auto-ingests redacted prompts + prompt chains
#    from ~/.claude, ~/.codex, ... (last 7 days; add --all, or --days N, to widen).
cd assist-local && npm install && node bin/alignos setup --url http://localhost:8787

# 3. Ask in quick mode and read the reply in your voice (owner handle defaults to "shashank").
#    Use the curl form: the headless `alignos ask` returns the requester task, not the answer text.
curl -sG http://localhost:8787/ask-shashank --data-urlencode "mode=quick" \
  --data-urlencode "q=<the same question>" | jq -r '.result.artifacts[0].parts[0].text'

# Row 3 - GROUNDED, PROFILE DELETED: wipe the corpus, restart, ask again -> the generic voice returns
rm -f /tmp/align-dev-knowledge.json     # the node's corpus file ($ALIGN_KNOWLEDGE, set by dev-local.sh)
ALIGN_DRAFT_BACKEND=codex bash tee-mesh/node/scripts/dev-local.sh
curl -sG http://localhost:8787/ask-shashank --data-urlencode "mode=quick" \
  --data-urlencode "q=<the same question>" | jq -r '.result.artifacts[0].parts[0].text'
```

The strongest voice beat is the **owner-style refinement loop**: the reply visibly converging on the
owner's prompting style across passes. Restart the node with `ALIGN_LOOP=on ALIGN_LOOP_PASSES=6`.
This was verified end to end in
[specs/notes/2026-06-14-loop-local-verification.md](specs/notes/2026-06-14-loop-local-verification.md)
(M0: real answer, not a placeholder; M1: six passes ran; M2: the node reproduced the owner's
distilled prompting moves, *broad to narrow, terse imperative, one axis at a time*, not a generic
agent loop).

---

## 2. The mesh routes to the right specialist

Show that a question finds the right expert's node across CVMs, automatically. Against the live mesh:

```bash
bash tee-mesh/scripts/e2e-routing.sh \
  https://85b887ee69cfcd49061d5bbdc5ffa94da11f2939-8080.dstack-pha-prod7.phala.network
```

```
== e2e routing against https://85b887...phala.network ==
  PASS  "how should we find PMF?"                        -> albi
  PASS  "what GTM motion should we use?"                 -> albi
  PASS  "how does remote attestation work in a TEE?"     -> andrew
  PASS  "what privacy guarantees do enclaves provide?"   -> andrew
  PASS  "how should we design the agent routing layer?"  -> shashank
  PASS  "what system design scales this architecture?"   -> shashank
== 6 passed, 0 failed ==
E2E PASS
```

Or open any node's **`/dashboard`** and use the live "ask the mesh" box: you will watch each question
land on a different node.

**Reproduce locally** (3 nodes, no TEE). Needs Foundry (`anvil`/`forge`/`cast`) **and** Deno. The
canonical script boots a local chain, deploys the registry, starts the three persona skills and
nodes, and asserts they converge and cross-route:

```bash
# Proof: boots everything, asserts routing, then tears down.
bash tee-mesh/scripts/local-test.sh        # ends in PASS   (Docker variant: scripts/compose-test.sh)

# For recording, keep the 3-node mesh up (albi :8081, andrew :8082, shashank :8083):
KEEP=1 bash tee-mesh/scripts/local-test.sh
# then, in a second terminal:
bash tee-mesh/scripts/e2e-routing.sh http://localhost:8081   # the 6 PASS lines above
open http://localhost:8081/dashboard                         # live "ask the mesh" box
```

The entry node (`:8081`) routes to the others via gossip, so hitting one URL is enough. Always pass
the URL: `e2e-routing.sh` defaults to `http://localhost:8081`, and the live form needs the full prod
gateway URL.

---

## 3. Deep Mode, you stay in charge

The genuinely novel beat: a request can be answered by your agent running in your **exact local
environment** (harness, skills, files), read-only, and **nothing returns until you approve**.

The flow, end to end:

```bash
# A requester asks in deep mode. This buffers a task in the owner's node inbox, awaiting approval.
# Raw local files never leave; only your approved reply is sent back.
node bin/alignos ask --owner shashank --mode deep "<a request that needs your local context>"

# As the owner, you see it and your agent drafts read-only in your real environment:
node bin/alignos inbox            # or: node bin/alignos watch   (headless drafting loop)
node bin/alignos show <id>        # the request + the locally drafted reply

# Nothing returns until you decide:
node bin/alignos approve <id>     # send the reply   (or: followup <id> --msg ... / decline <id>)
```

In the **assist-local** desktop app this is one tap: a request deep-links straight to the
approve/decline card. Every decision is appended to `~/.alignos/decisions.jsonl`. The request waits
durably in the node inbox until you open the app, so on stage this is best **pre-recorded or
compressed to about 10 seconds**: the approval is async by design (that is the privacy feature; dead
air on stage is not).

<div align="center">
<img src="specs/mockups/5-quiet-complete.png" alt="The trust layer: 'Used your approved notes. Raw local files weren't sent.' plus the all-clear and the handled-privately audit." width="820">
<br><em>Mockup of the trust layer. Every auto-handled answer is logged with what it was allowed to use: "raw local files weren't sent."</em>
</div>

---

## Live endpoints

| Owner | Specialty | Dashboard |
|---|---|---|
| Albi | GTM · PMF · Product | `https://85b887ee69cfcd49061d5bbdc5ffa94da11f2939-8080.dstack-pha-prod7.phala.network/dashboard` |
| Andrew | Confidential Compute · Privacy | `https://29736dcf7742550956c28a1174c1e0724b6d769c-8080.dstack-pha-prod7.phala.network/dashboard` |
| Shashank | System Design · Agent Infra | `https://29b4c80372a66a7086d9c953b4c9902c7071b701-8080.dstack-pha-prod7.phala.network/dashboard` |

Registry on Ethereum Sepolia:
[`0xf31768d4E42d5e80aE95415309D7908ae730Fb41`](https://sepolia.etherscan.io/address/0xf31768d4E42d5e80aE95415309D7908ae730Fb41).
`curl <node>/peers` shows all three nodes; `curl <node>/services` shows the owner-bound
assistants.

> A 90-second screen recording of the voice moment is a safer demo link than a cold live URL. Record
> it once the ablation above is clean.
