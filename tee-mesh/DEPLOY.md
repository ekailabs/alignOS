# tee-mesh — deployment & debug runbook

How to deploy and manage alignOS mesh nodes on Phala dstack. Nothing here is secret; the only
secrets live in a local **gitignored** `deploy/.env*` (your keys) — never commit them.

## Two independent chains (don't conflate)
- **AlignRegistry** → an app contract on **Ethereum Sepolia** (chainId 11155111). Currently
  `0xf31768d4E42d5e80aE95415309D7908ae730Fb41`. Nodes self-register here at boot; the contract is
  the seed list. `register()` is **open** — any funded key can register.
- **CVM KMS** → Phala's managed KMS (`--kms phala`, the default) on **prod7** = node-id **12**,
  gateway `dstack-pha-prod7.phala.network`. This is separate from the registry chain and need not match it.

## Credentials — what's yours vs shared
You do **not** need anyone's private key. Two ways to operate:

1. **Run your own node (recommended, zero shared secrets).** Use *your own* Phala API key
   (`npx phala auth login`) and *your own* Sepolia-funded key. Point `REGISTRY_CONTRACT` at the
   same registry above → your node self-registers and **joins the existing mesh via gossip**. You
   manage your own CVMs; you can't touch someone else's.
2. **Manage the existing 3 CVMs.** That requires access to the *owner's* Phala workspace — either
   the owner shares their Phala **API key** (a shared secret — be deliberate) or adds you to the
   workspace/team. The funded **Sepolia private key** never needs sharing: use your own; `register()` is open.

Fund a Sepolia key from a faucet (https://sepoliafaucet.com). ~0.02 ETH covers many registrations.

## Prerequisites
- `npx phala` (Phala CLI, run via npx — not on PATH). `npx phala auth login` once.
- Foundry (`forge`/`cast`) — only if (re)deploying the registry.
- Docker — to build/push images. Deno — only for local-mesh testing.

## Secrets file (`deploy/.env`, gitignored)
```
PRIVATE_KEY=0x<your sepolia-funded key>
REGISTRY_RPC=https://ethereum-sepolia-rpc.publicnode.com
REGISTRY_CONTRACT=0xf31768d4E42d5e80aE95415309D7908ae730Fb41
```
⚠️ Each line must end in a newline. Appending to a file whose last line lacks `\n` concatenates
values (we hit `REGISTRY_RPC=...comREGISTRY_CONTRACT=0x...` → "invalid dns name"). Verify with
`cat -A deploy/.env`. Editor autosave/lock files (`#.env#`, `.#.env`) are gitignored too — don't commit them.

## Persistent node data
The node image declares `/data`, and the compose files mount it as a named volume. The node
stores:
- `ALIGN_OWNER_STATE=/data/owner.json` — claimed owner public key for signed `/owner/*`
  routes.
- `ALIGN_TASKS=/data/tasks.json` — A2A task history, including asks, drafts, approvals, and
  answers sent back to other users.
- `ALIGN_EVENTLOG=/data/events.jsonl` — append-only operational/audit events.
- `ALIGN_PEERS=/data/peers.json` — last known peer discovery directory, used to warm
  `/peers` and `/services` after restarts while registry/gossip catches up.
- `ALIGN_KNOWLEDGE=/data/knowledge.json` — redacted onboarding knowledge corpus used for
  owner voice/style grounding.

Raw local agent logs are not mounted into the TEE. During onboarding or Deep Mode, the edge
sends only redacted/compacted slices to the TEE.

## Images (pulled by the CVM from ghcr — `build:` contexts do NOT work remotely)
```
DOCKER_BUILDKIT=0 docker build -t ghcr.io/<you>/alignos-node:vN  node
DOCKER_BUILDKIT=0 docker build -t ghcr.io/<you>/alignos-skill:latest agents/skill
docker push ghcr.io/<you>/alignos-node:vN
docker push ghcr.io/<you>/alignos-skill:latest
```
Then make each ghcr package **Public** (UI only — `gh api ... visibility` 404s):
`github.com/users/<you>/packages/container/<pkg>/settings` → Change visibility → Public.
(Or keep private and wire pull creds into the CVM — more setup.) Use a fresh tag (`:vN`) per node
change so the CVM re-pulls. Update the `image:` refs in `deploy/docker-compose.phala*.yaml`.

## Deploy a node (chicken-and-egg: app_id/URL unknown until first deploy)
The skill is chosen per-CVM via `SKILL`; config is passed inline by **env**, not bind-mounts.
```
cd deploy
# 1. per-node env (gitignored): copy .env, add the skill + manifest (SELF_URL filled in step 3)
cp .env .env.x
printf 'ALIGN_GOSSIP_INTERVAL=5\nSKILL=calc\nALIGN_MANIFEST_JSON=[{"name":"calc","url":"http://skill:8080"}]\n' >> .env.x
# Optional for owner-assistant service discovery:
printf 'ALIGN_OWNER_HANDLE=albi\nALIGN_OWNER_DISPLAY_NAME=Albi\n' >> .env.x

# 2. first deploy on prod7 (node-id 12) → note the App ID it prints
npx phala deploy -n alignos-x -c docker-compose.phala.skill.yaml -e .env.x --node-id 12

# 3. set the real gateway URL, then upgrade IN PLACE + restart (never delete+redeploy)
echo 'ALIGN_SELF_URL=https://<app_id>-8080.dstack-pha-prod7.phala.network' >> .env.x
npx phala deploy --cvm-id <vm_uuid> -c docker-compose.phala.skill.yaml -e .env.x
npx phala cvms restart <vm_uuid>     # deploy does NOT restart containers — you must
```
Find nodes: `npx phala nodes list --json`. Find your CVMs: `npx phala cvms list`.

## Verify
```
URL=https://<app_id>-8080.dstack-pha-prod7.phala.network
curl $URL/                # status: mode should be "tee"
curl $URL/peers           # full mesh directory (all nodes + their skills)
curl $URL/services        # owner-assistant service directory
open $URL/dashboard       # demo dashboard
bash scripts/e2e-routing.sh $URL   # asserts sample questions route to the right skill
cast call 0xf317…Fb41 "getMembers()(bytes32[])" --rpc-url $REGISTRY_RPC  # on-chain members
```
Local dry-run (no TEE/Phala, fast): `bash scripts/compose-test.sh` (anvil + 3 containers + e2e).

## Debug runbook (symptom → cause → fix)
- **Gateway TLS ok then connection EOF / nothing** → node container isn't serving. Check
  `npx phala cvms logs <id> -c <container>` (default = first container; container names are
  prefixed, not bare `node`). Look for the `[alignos] identity …` / `serving on :8080` / `register …`
  lines. node:v4+ serves *before* registering, so a chain problem no longer blocks serving.
- **`register failed … invalid dns name` / weird RPC URL** → malformed `.env` (missing newline,
  values concatenated). `cat -A .env*` and fix.
- **`register failed` (network/timeout)** → is the key Sepolia-funded? is `REGISTRY_RPC` reachable?
  Public RPCs rate-limit; the node tolerates it (serves anyway, retries membership on a 30s TTL).
- **Image won't pull / CVM stuck provisioning** → the ghcr package isn't Public. Flip it (above).
- **`Another operation is already in progress`** → a prior deploy/restart is still running; wait
  ~15s and retry (the deploy/restart helpers loop on this).
- **mode=local instead of tee** → the dstack socket wasn't reachable; ensure the compose mounts
  `/var/run/dstack.sock` and `DSTACK_SOCKET=/var/run/dstack.sock` is set.
- **A peer shows `stale` forever** → fixed in node:v4 (liveness stamped on every fetch). If you see
  it, the node is on an old image — rebuild/repush/upgrade.
- **Shared-key registrations collide** → when several nodes use the *same* PRIVATE_KEY they can clash
  on tx nonces if they boot together. Stagger restarts (~40s apart) or give each node its own key.

## Gotchas checklist
- [ ] images Public on ghcr, referenced by a fresh `:vN` tag
- [ ] `.env` lines newline-terminated; no `#.env#` committed
- [ ] config via env (`ALIGN_MANIFEST_JSON`, `SKILL`), not bind-mounts
- [ ] node data volume mounted at `/data` (`owner.json`, `tasks.json`, `events.jsonl`, `peers.json`, `knowledge.json`)
- [ ] deploy → get app_id → set `ALIGN_SELF_URL` → upgrade `--cvm-id` → `cvms restart`
- [ ] `--node-id 12` (prod7), default `--kms phala`
