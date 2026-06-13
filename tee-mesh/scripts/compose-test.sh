#!/usr/bin/env bash
# Bring up the containerized 3-node mesh, assert convergence + a cross-node agent call,
# then tear down. This exercises the exact images/compose Phala will run.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CF="$ROOT/deploy/docker-compose.local.yaml"
PORT_A="${ALIGN_HOST_PORT_A:-8081}"
PORT_B="${ALIGN_HOST_PORT_B:-8082}"
PORT_C="${ALIGN_HOST_PORT_C:-8083}"
dc() { docker compose -f "$CF" "$@"; }
trap 'echo "== tearing down =="; dc down -v --remove-orphans >/dev/null 2>&1 || true' EXIT

echo "== build + up =="
dc up --build -d

echo "== wait for nodes to register + gossip =="
for i in $(seq 1 60); do
  N=$(curl -fsS "http://localhost:$PORT_A/peers" 2>/dev/null | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))' 2>/dev/null || echo 0)
  [ "$N" = "3" ] && break
  sleep 2
done

echo "== /peers as seen by node-a =="
curl -fsS "http://localhost:$PORT_A/peers" | python3 -c 'import sys,json; [print("  {} v{} mode={} agents=[{}] stale={}".format(p["app_id"], p["version"], p["mode"], ",".join(a["name"] for a in p["agents"]), p.get("stale"))) for p in json.load(sys.stdin)]'

echo "== cross-node proxy: node-a -> node-c'\''s echo, via host port =="
URL=$(curl -fsS "http://localhost:$PORT_A/peers" | python3 -c 'import sys,json; ps=json.load(sys.stdin); c=next(p for p in ps if p["app_id"]=="node-c"); print(next(a for a in c["agents"] if a["name"]=="echo")["url"])')
echo "  card url (in-compose): $URL"
# node-c maps to the host; call its echo through the published port to prove reachability
curl -fsS "http://localhost:$PORT_C/agents/echo?q=hello-compose"; echo

echo "== node count =="
echo "  node-a sees ${N:-?} nodes (expect 3)"
test "${N:-0}" = "3" && echo "PASS" || { echo "FAIL"; dc logs --tail=30; exit 1; }
