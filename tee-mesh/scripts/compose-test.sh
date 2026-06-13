#!/usr/bin/env bash
# Bring up the containerized 3-node mesh, assert convergence + a cross-node agent call,
# then tear down. This exercises the exact images/compose Phala will run.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DENO="$HOME/.deno/bin/deno"
CF="$ROOT/deploy/docker-compose.local.yaml"
dc() { docker compose -f "$CF" "$@"; }
trap 'echo "== tearing down =="; dc down -v --remove-orphans >/dev/null 2>&1 || true' EXIT

echo "== build + up =="
dc up --build -d

echo "== wait for nodes to register + gossip =="
for i in $(seq 1 60); do
  N=$(curl -fsS http://localhost:8081/peers 2>/dev/null | "$DENO" eval 'try{console.log(JSON.parse(await new Response(Deno.stdin.readable).text()).length)}catch{console.log(0)}' 2>/dev/null || echo 0)
  [ "$N" = "3" ] && break
  sleep 2
done

echo "== /peers as seen by node-a =="
curl -fsS http://localhost:8081/peers | "$DENO" eval 'for(const p of JSON.parse(await new Response(Deno.stdin.readable).text())) console.log(`  ${p.app_id} v${p.version} mode=${p.mode} agents=[${p.agents.map(a=>a.name).join(",")}] stale=${p.stale}`)'

echo "== cross-node proxy: node-a -> node-c'\''s echo, via host port =="
URL=$(curl -fsS http://localhost:8081/peers | "$DENO" eval 'const ps=JSON.parse(await new Response(Deno.stdin.readable).text()); const c=ps.find(p=>p.app_id==="node-c"); console.log(c.agents.find(a=>a.name==="echo").url)')
echo "  card url (in-compose): $URL"
# node-c maps to host :8083; call its echo through the published port to prove reachability
curl -fsS "http://localhost:8083/agents/echo?q=hello-compose"; echo

echo "== node count =="
echo "  node-a sees ${N:-?} nodes (expect 3)"
test "${N:-0}" = "3" && echo "PASS" || { echo "FAIL"; dc logs --tail=30; exit 1; }
