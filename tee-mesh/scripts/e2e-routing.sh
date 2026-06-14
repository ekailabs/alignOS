#!/usr/bin/env bash
# E2E: send sample questions to a node's /route and assert each is routed to the right persona skill.
# Works against any node URL — local or a live prod7 gateway.
#   bash scripts/e2e-routing.sh [BASE_URL]
set -uo pipefail
BASE="${1:-http://localhost:8081}"
PY=python3
pass=0; fail=0

check() { # question  expected_agent  expected_substring
  local q="$1" agent="$2" want="$3"
  local r; r=$(curl -fsS --max-time 15 -X POST "$BASE/route" -H 'content-type: application/json' \
    -d "$($PY -c "import json,sys;print(json.dumps({'question':sys.argv[1]}))" "$q")" 2>/dev/null)
  local got ans node
  got=$(echo "$r" | $PY -c "import json,sys;d=json.load(sys.stdin);print((d.get('routed_to') or {}).get('agent',''))" 2>/dev/null)
  ans=$(echo "$r" | $PY -c "import json,sys;print(json.dumps(json.load(sys.stdin).get('answer')))" 2>/dev/null)
  node=$(echo "$r" | $PY -c "import json,sys;d=json.load(sys.stdin);print((d.get('routed_to') or {}).get('app_id','?')[:10])" 2>/dev/null)
  if [ "$got" = "$agent" ] && echo "$ans" | grep -qi "$want"; then
    echo "  PASS  \"$q\" -> $got @ $node  answer=$ans"; pass=$((pass+1))
  else
    echo "  FAIL  \"$q\" -> agent=$got (want $agent)  answer=$ans"; fail=$((fail+1))
  fi
}

echo "== e2e routing against $BASE =="
check "how should we find PMF?"                         albi     "PMF"
check "what GTM motion should we use?"                  albi     "GTM"
check "how does remote attestation work in a TEE?"      andrew   "Confidential Compute"
check "what privacy guarantees do enclaves provide?"    andrew   "Privacy"
check "how should we design the agent routing layer?"   shashank "Agent Infra"
check "what system design scales this architecture?"    shashank "System Design"
echo "== $pass passed, $fail failed =="
[ "$fail" = "0" ] && echo "E2E PASS" || { echo "E2E FAIL"; exit 1; }
