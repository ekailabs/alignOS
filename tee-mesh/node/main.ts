// alignOS node host: identity -> self-register on-chain -> serve ingress + gossip loop.
import { type Address, type Hex } from "viem";
import { getIdentity } from "./identity.ts";
import {
  type AgentRef,
  agentsFingerprint,
  aggregateAgents,
  type NodeCard,
} from "./cards.ts";
import { makeRegistry } from "./registry.ts";
import { Directory, runGossip } from "./gossip.ts";
import { makeHandler } from "./ingress.ts";
import { appendEvent } from "./eventlog.ts";
import { TaskStore } from "./inbox.ts";
import { ownerState } from "./owner.ts";

const env = (k: string, d?: string) => Deno.env.get(k) ?? d;

const port = Number(env("ALIGN_PORT", "8080"));
const gatewayUrl = env("ALIGN_SELF_URL", `http://localhost:${port}`)!.replace(
  /\/$/,
  "",
);
const interval = Number(env("ALIGN_GOSSIP_INTERVAL", "5")) * 1000;
const manifestPath = env("ALIGN_MANIFEST", "./manifest.json")!;
const ownerHandle = env("ALIGN_OWNER_HANDLE") ?? env("ALIGN_OWNER");
const ownerDisplayName = env("ALIGN_OWNER_DISPLAY_NAME") ?? ownerHandle;

// Manifest from an inline env var (preferred on dstack — no host files to bind-mount) or a file.
const manifestJson = env("ALIGN_MANIFEST_JSON");
const refs: AgentRef[] = manifestJson
  ? JSON.parse(manifestJson)
  : JSON.parse(await Deno.readTextFile(manifestPath));
const agents = new Map(refs.map((r) => [r.name, r.url]));

const identity = await getIdentity();
console.log(
  `[alignos] identity node_id=${identity.node_id} mode=${identity.mode} app_id=${identity.app_id}`,
);
await appendEvent("boot", {
  node_id: identity.node_id,
  mode: identity.mode,
  gateway: gatewayUrl,
});

// Owner-claim bootstrap: print the single-use setup token so the owner can claim this node.
const _owner = ownerState();
if (_owner.token) {
  console.log(
    `[alignos] OWNER SETUP TOKEN: ${_owner.token}  (single-use, expires in ${_owner.tokenExpiresInMin}m)\n` +
      `[alignos]   claim:  alignos setup --url ${gatewayUrl} --token ${_owner.token}`,
  );
} else {
  console.log("[alignos] owner already claimed");
}

const dir = new Directory();
dir.load();
let selfCard: NodeCard;
let version = 0, fp: string | null = null;

async function refreshSelf() {
  const aggregated = await aggregateAgents(refs, gatewayUrl);
  const f = agentsFingerprint(aggregated);
  if (f !== fp) {
    fp = f;
    version++;
  }
  selfCard = {
    node_id: identity.node_id,
    gateway_url: gatewayUrl,
    pubkey: identity.pubkey,
    app_id: identity.app_id,
    owner: ownerHandle
      ? { handle: ownerHandle, display_name: ownerDisplayName, claimed: true }
      : undefined,
    mode: identity.mode,
    attestation_digest: identity.attestation_digest,
    version,
    updated_at: new Date().toISOString(),
    agents: aggregated,
  };
  dir.setSelf(selfCard);
}
await refreshSelf();

const stop = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(sig, () => {
    stop.abort();
    Deno.exit(0);
  });
}

// assist-remote: the A2A task store (file-backed; one file per node via ALIGN_TASKS).
const store = new TaskStore();
await store.load();

// Serve immediately — the gateway must always find a healthy backend. Registration and
// gossip run in the background so a slow/unreachable chain never blocks serving.
const handler = makeHandler({
  selfId: identity.node_id,
  getSelfCard: () => selfCard,
  dir,
  agents,
  identity,
  store,
});
Deno.serve({ port, hostname: "0.0.0.0" }, handler);
console.log(`[alignos] serving on :${port} gateway=${gatewayUrl}`);

(async () => {
  const rpc = env("REGISTRY_RPC"),
    contract = env("REGISTRY_CONTRACT"),
    pk = env("PRIVATE_KEY");
  if (!(rpc && contract && pk)) {
    console.log(
      "[alignos] standalone: REGISTRY_RPC/REGISTRY_CONTRACT/PRIVATE_KEY not all set",
    );
    await appendEvent("standalone", {});
    return;
  }
  const registry = makeRegistry(rpc, contract as Address, pk as Hex);
  try {
    const tx = await registry.register(
      identity.node_id,
      identity.pubkey,
      identity.code_id,
      gatewayUrl,
    );
    console.log(`[alignos] registered on-chain tx=${tx}`);
    await appendEvent("registered", {
      tx,
      node_id: identity.node_id,
      gateway: gatewayUrl,
    });
  } catch (e) {
    console.error(
      `[alignos] register failed (serving continues, gossip disabled): ${e}`,
    );
    await appendEvent("register_failed", { error: String(e) });
    return;
  }
  runGossip(
    dir,
    identity.node_id,
    gatewayUrl,
    registry,
    refreshSelf,
    interval,
    stop.signal,
  );
})();
