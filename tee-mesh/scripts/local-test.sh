#!/usr/bin/env bash
# Local 3-node alignOS mesh on anvil. No docker, no TEE — proves the gossip + registry
# logic end to end. Nodes run in local-identity mode with user-name ALIGN_NODE_IDs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DENO="${DENO:-$(command -v deno || true)}"
ANVIL="${ANVIL:-$([ -x "$HOME/.foundry/bin/anvil" ] && echo "$HOME/.foundry/bin/anvil" || command -v anvil || true)}"
FORGE="${FORGE:-$([ -x "$HOME/.foundry/bin/forge" ] && echo "$HOME/.foundry/bin/forge" || command -v forge || true)}"
CAST="${CAST:-$([ -x "$HOME/.foundry/bin/cast" ] && echo "$HOME/.foundry/bin/cast" || command -v cast || true)}"
[ -x "$DENO" ] || { echo "deno not found; install Deno or set DENO=/path/to/deno" >&2; exit 127; }
[ -x "$ANVIL" ] || { echo "anvil not found; install Foundry or set ANVIL=/path/to/anvil" >&2; exit 127; }
[ -x "$FORGE" ] || { echo "forge not found; install Foundry or set FORGE=/path/to/forge" >&2; exit 127; }
[ -x "$CAST" ] || { echo "cast not found; install Foundry or set CAST=/path/to/cast" >&2; exit 127; }
RPC="http://localhost:8545"
# anvil account[0]
KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
WORK="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== anvil =="
"$ANVIL" --silent --port 8545 >/dev/null & PIDS+=($!)
sleep 1.5

echo "== deploy AlignRegistry =="
cd "$ROOT/contracts"
ADDR=$("$FORGE" create src/AlignRegistry.sol:AlignRegistry --rpc-url "$RPC" --private-key "$KEY" --json | "$DENO" eval 'const txt=await new Response(Deno.stdin.readable).text(); const s=txt.indexOf("{"), e=txt.lastIndexOf("}"); if(s<0||e<s) throw new Error("forge did not return JSON: "+txt); const d=JSON.parse(txt.slice(s,e+1)); console.log(d.deployedTo)')
echo "registry: $ADDR"

start_agent() { # skill port
  cd "$ROOT/agents/skill"; SKILL="$1" PORT="$2" "$DENO" run --allow-net --allow-env server.ts >/dev/null 2>&1 & PIDS+=($!)
}
start_node() { # id port manifest
  cd "$ROOT/node"
  case "$1" in
    albi) OWNER_HANDLE=albi OWNER_DISPLAY_NAME=Albi ;;
    andrew) OWNER_HANDLE=andrew OWNER_DISPLAY_NAME=Andrew ;;
    shashank) OWNER_HANDLE=shashank OWNER_DISPLAY_NAME=Shashank ;;
    *) OWNER_HANDLE="$1" OWNER_DISPLAY_NAME="$1" ;;
  esac
  ALIGN_NODE_ID="$1" ALIGN_PORT="$2" ALIGN_SELF_URL="http://localhost:$2" \
    ALIGN_OWNER_HANDLE="$OWNER_HANDLE" ALIGN_OWNER_DISPLAY_NAME="$OWNER_DISPLAY_NAME" \
    ALIGN_MANIFEST="$3" ALIGN_GOSSIP_INTERVAL=2 ALIGN_EVENTLOG="$WORK/$1.events.jsonl" \
    ALIGN_OWNER_STATE="$WORK/$1.owner.json" ALIGN_TASKS="$WORK/$1.tasks.json" ALIGN_PEERS="$WORK/$1.peers.json" \
    ALIGN_KNOWLEDGE="$WORK/$1.knowledge.json" \
    REGISTRY_RPC="$RPC" REGISTRY_CONTRACT="$ADDR" PRIVATE_KEY="$KEY" \
    "$DENO" run --allow-net --allow-env --allow-read --allow-write main.ts >"$WORK/$1.log" 2>&1 & PIDS+=($!)
}
wait_log() { # file pattern label
  for _ in $(seq 1 30); do
    grep -q "$2" "$1" 2>/dev/null && return 0
    sleep 1
  done
  echo "FAIL: timed out waiting for $3" >&2
  tail -80 "$1" >&2 || true
  exit 1
}

echo "== agents (different persona/domain skill per node) =="
start_agent albi 9101
start_agent andrew 9201
start_agent shashank 9301
sleep 1
echo '[{"name":"albi","url":"http://localhost:9101"}]' > "$WORK/a.json"
echo '[{"name":"andrew","url":"http://localhost:9201"}]' > "$WORK/b.json"
echo '[{"name":"shashank","url":"http://localhost:9301"}]' > "$WORK/c.json"

echo "== nodes =="
start_node albi 8081 "$WORK/a.json"
wait_log "$WORK/albi.log" "registered on-chain" "Albi registration"
start_node andrew 8082 "$WORK/b.json"
wait_log "$WORK/andrew.log" "registered on-chain" "Andrew registration"
start_node shashank 8083 "$WORK/c.json"
wait_log "$WORK/shashank.log" "registered on-chain" "Shashank registration"
for _ in $(seq 1 30); do
  N=$({ curl -s http://localhost:8081/peers || true; } | "$DENO" eval 'try { console.log(JSON.parse(await new Response(Deno.stdin.readable).text()).length) } catch { console.log(0) }')
  [ "$N" = "3" ] && break
  sleep 1
done
if [ "${N:-0}" != "3" ]; then
  echo "FAIL: Albi sees ${N:-0} nodes after waiting for convergence" >&2
  for f in "$WORK"/*.log; do echo "---- $f ----" >&2; tail -80 "$f" >&2 || true; done
  exit 1
fi

echo "== /peers as seen by Albi =="
curl -s http://localhost:8081/peers | "$DENO" eval 'const ps=JSON.parse(await new Response(Deno.stdin.readable).text()); for(const p of ps) console.log(`  ${p.app_id} v${p.version} agents=[${p.agents.map(a=>a.name).join(",")}] stale=${p.stale}`)'

echo "== /services as seen by Albi =="
curl -s http://localhost:8081/services | "$DENO" eval 'const d=JSON.parse(await new Response(Deno.stdin.readable).text()); for(const s of d.services) console.log(`  ${s.owner.display_name} (${s.owner.handle}) -> ${s.endpoints.ask} quick=${s.endpoints.quick_mode} deep=${s.endpoints.deep_mode}`)'

echo "== cross-node proxy: ask Albi for Shashank's agent URL, then call it =="
URL=$(curl -s http://localhost:8081/peers | "$DENO" eval 'const ps=JSON.parse(await new Response(Deno.stdin.readable).text()); const c=ps.find(p=>p.app_id==="shashank"); console.log(c.agents.find(a=>a.name==="shashank").url)')
echo "  resolved: $URL"
curl -sG "$URL" --data-urlencode "q=how should we design the agent routing layer?" ; echo

echo "== on-chain getMembers() =="
"$CAST" call "$ADDR" "getMembers()(bytes32[])" --rpc-url "$RPC"

echo "== node count check =="
N=$(curl -s http://localhost:8081/peers | "$DENO" eval 'console.log(JSON.parse(await new Response(Deno.stdin.readable).text()).length)')
echo "  Albi sees $N nodes (expect 3)"
test "$N" = "3" && echo "PASS" || { echo "FAIL"; exit 1; }
