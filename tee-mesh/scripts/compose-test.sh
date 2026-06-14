#!/usr/bin/env bash
# Bring up the containerized 3-node mesh, assert convergence + cross-mesh skill routing,
# then tear down. Exercises the exact images/compose Phala will run.
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

echo "== /peers as seen by Albi (each user's isolated skills) =="
curl -fsS "http://localhost:$PORT_A/peers" | python3 -c 'import sys,json; [print("  {} v{} mode={} agents=[{}] stale={}".format(p["app_id"], p["version"], p["mode"], ",".join(a["name"] for a in p["agents"]), p.get("stale"))) for p in json.load(sys.stdin)]'

echo "== /services as seen by Albi (owner assistant discovery) =="
curl -fsS "http://localhost:$PORT_A/services" | python3 -c 'import sys,json; d=json.load(sys.stdin); [print("  {} ({}) -> {} mode=quick|deep".format(s["owner"].get("display_name") or s["owner"]["handle"], s["owner"]["handle"], s["endpoints"]["ask"])) for s in d["services"]]'

echo "== node count =="
echo "  Albi sees ${N:-?} nodes (expect 3)"
test "${N:-0}" = "3" || { echo "FAIL: mesh did not converge"; dc logs --tail=40; exit 1; }

# Routing fans across the mesh: calc@Albi, weather@Andrew, define@Shashank — all asked at Albi.
bash "$ROOT/scripts/e2e-routing.sh" "http://localhost:$PORT_A" || { echo "FAIL: e2e routing"; dc logs --tail=40; exit 1; }
echo "ALL PASS"
