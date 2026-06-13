#!/usr/bin/env bash
# Local 3-node alignOS mesh on anvil. No docker, no TEE — proves the gossip + registry
# logic end to end. Nodes run in local-identity mode with distinct ALIGN_NODE_ID.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DENO="$HOME/.deno/bin/deno"
FB="$HOME/.foundry/bin"
RPC="http://localhost:8545"
# anvil account[0]
KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
WORK="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== anvil =="
"$FB/anvil" --silent --port 8545 >/dev/null & PIDS+=($!)
sleep 1.5

echo "== deploy AlignRegistry =="
cd "$ROOT/contracts"
ADDR=$("$FB/forge" create src/AlignRegistry.sol:AlignRegistry --rpc-url "$RPC" --private-key "$KEY" --broadcast --json | "$DENO" eval 'const d=JSON.parse(await new Response(Deno.stdin.readable).text());console.log(d.deployedTo)')
echo "registry: $ADDR"

start_agent() { # name port
  cd "$ROOT/agents/$1"; PORT="$2" "$DENO" run --allow-net --allow-read --allow-env server.ts >/dev/null 2>&1 & PIDS+=($!)
}
start_node() { # id port manifest
  cd "$ROOT/node"
  ALIGN_NODE_ID="$1" ALIGN_PORT="$2" ALIGN_SELF_URL="http://localhost:$2" \
    ALIGN_MANIFEST="$3" ALIGN_GOSSIP_INTERVAL=2 ALIGN_EVENTLOG="$WORK/$1.jsonl" \
    REGISTRY_RPC="$RPC" REGISTRY_CONTRACT="$ADDR" PRIVATE_KEY="$KEY" \
    "$DENO" run --allow-net --allow-env --allow-read --allow-write main.ts >"$WORK/$1.log" 2>&1 & PIDS+=($!)
}

echo "== agents (different sets per node) =="
start_agent echo 9101   # node-a: echo only
start_agent ping 9201   # node-b: ping only
start_agent echo 9301; start_agent ping 9302   # node-c: both
sleep 1
echo '[{"name":"echo","url":"http://localhost:9101"}]' > "$WORK/a.json"
echo '[{"name":"ping","url":"http://localhost:9201"}]' > "$WORK/b.json"
echo '[{"name":"echo","url":"http://localhost:9301"},{"name":"ping","url":"http://localhost:9302"}]' > "$WORK/c.json"

echo "== nodes =="
start_node node-a 8081 "$WORK/a.json"
start_node node-b 8082 "$WORK/b.json"
start_node node-c 8083 "$WORK/c.json"
sleep 8

echo "== /peers as seen by node-a =="
curl -s http://localhost:8081/peers | "$DENO" eval 'const ps=JSON.parse(await new Response(Deno.stdin.readable).text()); for(const p of ps) console.log(`  ${p.app_id} v${p.version} agents=[${p.agents.map(a=>a.name).join(",")}] stale=${p.stale}`)'

echo "== cross-node proxy: ask node-a for node-c'\''s echo agent URL, then call it =="
URL=$(curl -s http://localhost:8081/peers | "$DENO" eval 'const ps=JSON.parse(await new Response(Deno.stdin.readable).text()); const c=ps.find(p=>p.app_id==="node-c"); console.log(c.agents.find(a=>a.name==="echo").url)')
echo "  resolved: $URL"
curl -s "$URL?q=hello-from-test" ; echo

echo "== on-chain getMembers() =="
"$FB/cast" call "$ADDR" "getMembers()(bytes32[])" --rpc-url "$RPC"

echo "== node count check =="
N=$(curl -s http://localhost:8081/peers | "$DENO" eval 'console.log(JSON.parse(await new Response(Deno.stdin.readable).text()).length)')
echo "  node-a sees $N nodes (expect 3)"
test "$N" = "3" && echo "PASS" || { echo "FAIL"; exit 1; }
