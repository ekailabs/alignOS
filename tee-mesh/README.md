# alignOS

A mesh of dstack TEE CVMs. Each node hosts isolated agent containers **and** meshes with
the other nodes, so every CVM is aware of every other CVM and the agents it runs —
exchanging A2A-style **agent cards** plus how to connect to them. Trusted-setup PoC.

## How it works

- **Membership = on-chain** (`contracts/AlignRegistry.sol`). Each node self-registers
  `(node_id, pubkey, codeId, gatewayUrl)` at boot, so the contract is the seed list — no
  hand-edited peer file, no deploy-order coupling. Unlike TEEBridge/ERC-733 it stores the
  gateway URL, which is what lets peers actually dial each other.
- **Discovery = HTTP gossip over the gateway** (`node/gossip.ts`). Each node pulls every
  peer's node card + their `/peers` view and merges into an eventually-consistent directory
  (last-write-wins by `version`, tombstones for deletes, `last_seen` liveness, backoff+jitter).
- **Identity = the dstack socket** (`node/identity.ts`). `node_id = keccak(app_id:instance_id)`
  (unique even across replicas sharing an app_id); pubkey derived from `GetKey`; quote from
  `GetQuote`. Falls back to local-dev identity when no socket — boot is never blocked on KMS.
- **Agents = sibling containers** on an `internal` docker network. The node reverse-proxies
  `/agents/<name>/*` to them and is their sole egress; cross-CVM calls go node→node over the
  gateway. The node does not hold the docker socket.
- **Node data = `/data` volume.** The TEE node persists owner claim state to
  `/data/owner.json`, A2A tasks to `/data/tasks.json`, audit events to
  `/data/events.jsonl`, the peer discovery snapshot to `/data/peers.json`, and redacted
  onboarding knowledge to `/data/knowledge.json`. This includes requests handled for other
  users. Raw local agent logs are not mounted into the TEE; only
  redacted/compacted onboarding or Deep Mode slices are sent across.

## Node HTTP surface
- `GET /.well-known/agent-card.json` — this node's aggregated node card
- `GET /.well-known/alignos-service.json` — this node projected as an owner-bound assistant service
- `GET /peers` — the full directory (every known node card)
- `GET /services` — the service directory: every known owner assistant, its owner handle,
  `ask-{owner}` endpoint, owner-auth endpoint, Quick Mode URL, and Deep Mode handoff URL
- `GET|POST /ask-<owner>?mode=quick|deep` — owner-specific ask endpoint. Demo examples:
  `/ask-albi?mode=quick`, `/ask-andrew?mode=quick`, `/ask-shashank?mode=deep`.
- `POST /gossip` — merge a pushed directory (pull is the default path)
- `GET /quote?report_data=…` — dstack quote (public verifier surface)
- `ALL /agents/<name>/*` — reverse-proxy to a local agent
- `POST /route {question}` — score the question against every skill across the mesh and
  forward to the best agent (possibly on another CVM); returns `{routed_to, answer, candidates}`
- `GET /dashboard` — demo-day mesh visualization (nodes → isolated skills + live ask box)

## Live deployment (prod7, Phala KMS)
A 3-node mesh is running on `dstack-pha-prod7`, registry on Ethereum Sepolia
`0xf31768d4E42d5e80aE95415309D7908ae730Fb41`. Each node runs a different persona/domain skill:
- Albi (GTM, PMF, Product Development): `https://85b887ee69cfcd49061d5bbdc5ffa94da11f2939-8080.dstack-pha-prod7.phala.network`
- Andrew (Confidential Compute, Privacy, Security): `https://29736dcf7742550956c28a1174c1e0724b6d769c-8080.dstack-pha-prod7.phala.network`
- Shashank (System Design, Agent Infra): `https://29b4c80372a66a7086d9c953b4c9902c7071b701-8080.dstack-pha-prod7.phala.network`

**Demo dashboard**: open `<any node>/dashboard` — shows every node, its isolated agents/skills,
liveness + `mode=tee`, and a live "ask the mesh" box. Routing fans across CVMs: ask
`how should we find PMF?` / `how does remote attestation work in a TEE?` /
`how should we design the agent routing layer?` and watch each land on the right node.
`curl <any>/peers` shows all three raw nodes; `curl <any>/services` shows the owner-bound
assistant services. For the demo instantiation, the three services are Albi, Andrew, and
Shashank. Each service advertises `/ask-albi`, `/ask-andrew`, or `/ask-shashank` with a
`mode=quick|deep` parameter. Quick Mode runs through the TEE; Deep Mode hands off to the
owner's local `assist-client`.

## Run the local 3-node mesh (anvil, no docker/TEE)
```bash
bash scripts/local-test.sh
```
Spins up anvil, deploys the registry, runs 3 nodes with different agent sets, and asserts
all three converge and a cross-node agent call resolves.

## Chains
- **AlignRegistry** → Ethereum Sepolia (L1, chainId 11155111). The node is chain-agnostic;
  point `REGISTRY_RPC` anywhere. Deploy with `PRIVATE_KEY=0x… bash scripts/deploy-registry.sh`.
- **CVM KMS** → Phala's managed KMS (default `--kms phala`) on prod7 (the `dstack-pha-prod7`
  domain). This is a *separate* chain from the registry and does not need to match it.

## Deploy to 3 Phala CVMs (prod7)
Images are pulled from ghcr (`ghcr.io/sm86/alignos-{node,skill}`); the manifest is
passed inline via `ALIGN_MANIFEST_JSON` (no host bind-mounts on the CVM).
1. `PRIVATE_KEY=0x… bash scripts/deploy-registry.sh` → record `REGISTRY_CONTRACT`.
2. Per CVM: an env file with `REGISTRY_*`/`PRIVATE_KEY` + a distinct `ALIGN_MANIFEST_JSON`.
   `npx phala deploy -c deploy/docker-compose.phala.yaml -e <env>`, then set `ALIGN_SELF_URL`
   to the issued gateway URL and upgrade in place (`phala deploy --cvm-id`; restart).
3. `curl https://<app_id>-8080.dstack-pha-prod7.phala.network/peers` on each → full mesh.
