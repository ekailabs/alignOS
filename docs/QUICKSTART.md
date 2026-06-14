# Quickstart

Four ways in, fastest first. Path A needs **no Docker, no TEE, no cloud**, it runs the whole
mesh on your laptop in a couple of minutes.

| Path | You get | Needs |
|---|---|---|
| **A: Local mesh** | A 3-node mesh on anvil; gossip + registry + routing, end to end | Deno, Foundry |
| **B: Containers** | The same mesh in the exact images Phala runs | Docker |
| **C: Edge client** | The desktop app / CLI talking to a private space | Node 18+ (Electron for the app) |
| **D: Phala deploy** | A real TEE node on `dstack-pha-prod7` | Phala CLI, see DEPLOY.md |

---

## Prerequisites

- **[Deno](https://deno.com)**, the node runtime (`assist-remote`).
- **[Foundry](https://book.getfoundry.sh/getting-started/installation)** (`anvil`, `forge`,
  `cast`), local chain + contract deploy.
- **Node 18+**, the edge client (`assist-local`). Electron is pulled in by `npm install`.
- *(Path B only)* **Docker**.

---

## Path A: the local mesh (≈2 min)

```bash
bash tee-mesh/scripts/local-test.sh
```

This single script ([`local-test.sh`](../tee-mesh/scripts/local-test.sh)):

1. starts **anvil** on `:8545`,
2. deploys **`AlignRegistry`**,
3. starts **3 persona agents** (Albi · Andrew · Shashank) and **3 nodes** (`:8081`, `:8082`,
   `:8083`) in local-identity mode,
4. waits for **gossip to converge**, then asserts every node sees all three and a **cross-node
   agent call** resolves.

You'll see each node register on-chain, the `/peers` and `/services` directories, a live
cross-CVM proxy call, and finally `PASS`.

**Then watch routing pick the right specialist** (works against any node URL, local or a live
prod7 gateway):

```bash
bash tee-mesh/scripts/e2e-routing.sh http://localhost:8081
```

```
PASS  "how should we find PMF?"                  -> albi      answer=…PMF…
PASS  "how does remote attestation work …?"      -> andrew    answer=…Confidential Compute…
PASS  "how should we design the agent routing …" -> shashank  answer=…Agent Infra…
```

> Want a single standalone node with a **real model** (your Claude subscription) instead of the
> three demo agents? Run [`tee-mesh/node/scripts/dev-local.sh`](../tee-mesh/node/scripts/dev-local.sh)
> It boots a node on `:8787` with `ALIGN_DRAFT_BACKEND=claude`. Point the client at it below.

---

## Path B: the containerized mesh

```bash
bash tee-mesh/scripts/compose-test.sh
```

Same outcome as Path A, but in Docker against the exact `ghcr.io/sm86/alignos-{node,skill}`
images that run on Phala, useful for validating images before a cloud deploy.

---

## Path C: the edge client (your laptop)

```bash
cd assist-local
npm install
```

**The desktop app** (full onboarding):

```bash
npm start
```

You'll walk through: **Welcome → Connect** (paste a private-space gateway URL) **→ Consent**
(it shows exactly what it reads and what it uploads, redacted) **→ Seed** (ingests your last 7
days of agent logs, redacted) **→ Folders** (deny-by-default: pick which folders Deep Mode may
ever read). Then the **Inbox** opens.

**Or the headless CLI**, same logic core:

```bash
node bin/alignos setup --url http://localhost:8787   # connect + claim + seed (use your space URL)
node bin/alignos status                              # connection health
node bin/alignos watch                               # draft every incoming request locally (read-only)
node bin/alignos inbox                               # requests that need you
node bin/alignos show <id>                           # one request + its drafted reply
node bin/alignos approve <id>                        # send the reply
node bin/alignos ask --owner andrew --mode quick "how does remote attestation work?"
```

Full CLI reference: [`assist-local/README.md`](../assist-local/README.md). Nothing is sent
until you approve, raw local files never leave the machine, only the reviewed reply does.

---

## Path D: deploy a real TEE node to Phala

Standing up a mesh for a whole **organization** (and adding members node by node) is the
**[operator guide → OPERATORS.md](OPERATORS.md)**. The exact commands, image build, and debug
runbook live in **[`tee-mesh/DEPLOY.md`](../tee-mesh/DEPLOY.md)**. The short version:

```bash
PRIVATE_KEY=0x… bash tee-mesh/scripts/deploy-registry.sh    # → REGISTRY_CONTRACT=0x…
npx phala deploy -c tee-mesh/deploy/docker-compose.phala.yaml -e <env>   # per CVM
curl https://<app_id>-8080.dstack-pha-prod7.phala.network/peers          # → the full mesh
```

---

## Next

- Reproduce the **grounded-answer "wow"** (a node answers what only its owner's private logs
  know; a base model can't): **[DEMO.md](DEMO.md)**.
- Understand what you just ran: **[ARCHITECTURE.md](ARCHITECTURE.md)**.
