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

## Node HTTP surface
- `GET /.well-known/agent-card.json` — this node's aggregated node card
- `GET /peers` — the full directory (every known node card)
- `POST /gossip` — merge a pushed directory (pull is the default path)
- `GET /quote?report_data=…` — dstack quote (public verifier surface)
- `ALL /agents/<name>/*` — reverse-proxy to a local agent

## Run the local 3-node mesh (anvil, no docker/TEE)
```bash
bash scripts/local-test.sh
```
Spins up anvil, deploys the registry, runs 3 nodes with different agent sets, and asserts
all three converge and a cross-node agent call resolves.

## Chains
- **AlignRegistry** → Ethereum Sepolia (L1, chainId 11155111). The node is chain-agnostic;
  point `REGISTRY_RPC` anywhere. Deploy with `PRIVATE_KEY=0x… bash scripts/deploy-registry.sh`.
- **CVM KMS** → Phala's managed Base KMS on prod7 (the `dstack-base-prod7` domain). This is a
  *separate* chain from the registry and does not need to match it.

## Deploy to 3 Phala CVMs (prod7)
1. `PRIVATE_KEY=0x… bash scripts/deploy-registry.sh` → record `REGISTRY_CONTRACT`.
2. Per CVM: copy `deploy/.env.example` → `.env`, fill `REGISTRY_*`/`PRIVATE_KEY`, give each a
   distinct `manifest.json`. `phala deploy` from `deploy/`, then set `ALIGN_SELF_URL` to the
   issued gateway URL and upgrade in place (`phala deploy --cvm-id`; `phala cvms restart`).
3. `curl https://<app_id>-8080.dstack-base-prod7.phala.network/peers` on each → full mesh.
