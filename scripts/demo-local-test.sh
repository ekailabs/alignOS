#!/usr/bin/env bash
# One-command local check for the demo (docs/DEMO.md).
#   Beat 1 (voice): boot a codex-backed node, seed it, ask grounded vs base vs ablated, eyeball voice.
#   Beat 2 (mesh):  run the canonical 3-node routing test.
# Asserts PLUMBING only: a real (non-placeholder) answer comes back and routing resolves correctly.
# It does NOT assert "grounded beats base on facts" — grounding shapes voice/style, not recall.
#   bash scripts/demo-local-test.sh ["a question in your domain"]
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
Q="${1:-What is the single most important thing to get right when building a privacy-first personal AI assistant? Answer in 3-4 sentences.}"
PORT=8787
NODE_LOG="/tmp/align-demo-node.log"
OUT_BASE="/tmp/align-demo-base.txt"
OUT_GROUNDED="/tmp/align-demo-grounded.txt"
OUT_ABLATED="/tmp/align-demo-ablated.txt"
KNOW="/tmp/align-dev-knowledge.json"
TO="$(command -v timeout || command -v gtimeout || true)"
run_to() { if [ -n "$TO" ]; then "$TO" "$1" "${@:2}"; else "${@:2}"; fi; }

beat1_ok=0; beat2_ok=0
NODE_PID=""
node_down() { [ -n "$NODE_PID" ] && kill "$NODE_PID" 2>/dev/null; lsof -ti :$PORT 2>/dev/null | xargs kill 2>/dev/null; NODE_PID=""; }
cleanup() { node_down; }
trap cleanup EXIT

say() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "MISSING: $1"; return 1; }; }

node_up() {
  rm -f "$KNOW" /tmp/align-dev-tasks.json
  lsof -ti :$PORT 2>/dev/null | xargs kill 2>/dev/null; sleep 1
  ALIGN_DRAFT_BACKEND=codex bash "$ROOT/tee-mesh/node/scripts/dev-local.sh" >"$NODE_LOG" 2>&1 &
  NODE_PID=$!
  for _ in $(seq 1 40); do
    grep -q "serving on :$PORT" "$NODE_LOG" 2>/dev/null && return 0
    sleep 1
  done
  echo "node did not come up; log tail:"; tail -15 "$NODE_LOG"; return 1
}

ask_grounded() { # outfile -> writes answer text
  run_to 180 curl -sG "http://localhost:$PORT/ask-shashank" \
    --data-urlencode "mode=quick" --data-urlencode "q=$Q" \
    | jq -r '.result.artifacts[0].parts[0].text // ""' > "$1"
}

# ---------- preflight ----------
say "preflight"
miss=0
for c in deno node codex jq curl; do need "$c" || miss=1; done
[ -f "$HOME/.codex/auth.json" ] && echo "codex auth: present" || { echo "codex auth: MISSING (run: codex login)"; miss=1; }
need anvil || echo "  (anvil missing: Beat 2 will be skipped)"
if [ "$miss" = 1 ]; then echo; echo "FAIL: install the missing prerequisites above."; exit 1; fi

# ---------- Beat 1: voice ----------
say "Beat 1: voice (codex backend)"
if node_up; then
  echo "seeding..."
  ( cd "$ROOT/assist-local" && [ -d node_modules ] || npm install >/tmp/align-demo-npm.log 2>&1
    run_to 150 node bin/alignos setup --url "http://localhost:$PORT" ) 2>&1 | sed 's/^/  /'
  seeded=$(curl -s "http://localhost:$PORT/" >/dev/null 2>&1; wc -c < "$KNOW" 2>/dev/null || echo 0)
  echo "corpus file bytes: $seeded"

  echo "asking (grounded, in your voice)..."; ask_grounded "$OUT_GROUNDED"
  echo "asking (base codex)...";              ( cd /tmp && run_to 180 codex exec --skip-git-repo-check "$Q" 2>/dev/null | tail -1 ) > "$OUT_BASE"

  echo "ablating (wipe corpus, restart, ask again)..."
  node_down; sleep 1
  if node_up; then ask_grounded "$OUT_ABLATED"; else echo "  restart failed"; fi

  g=$(wc -c < "$OUT_GROUNDED" 2>/dev/null || echo 0)
  a=$(wc -c < "$OUT_ABLATED" 2>/dev/null || echo 0)
  if [ "${seeded:-0}" -gt 100 ] && [ "$g" -gt 0 ] && ! grep -qi "placeholder draft" "$OUT_GROUNDED" && [ "$a" -gt 0 ]; then
    beat1_ok=1
  fi
  node_down
fi

# ---------- Beat 2: mesh routing ----------
say "Beat 2: mesh routing (3 nodes)"
if command -v anvil >/dev/null 2>&1; then
  if run_to 300 bash "$ROOT/tee-mesh/scripts/local-test.sh" 2>&1 | tail -4; then beat2_ok=1; fi
else
  echo "skipped (no anvil/Foundry)"
fi

# ---------- report ----------
say "RESULTS"
echo "Beat 1 (voice plumbing): $([ $beat1_ok = 1 ] && echo PASS || echo FAIL)"
echo "Beat 2 (mesh routing):   $([ $beat2_ok = 1 ] && echo PASS || echo 'FAIL/SKIP')"
echo
echo "Eyeball the voice contrast (grounding shapes voice, not facts):"
echo "  BASE     -> $OUT_BASE"
echo "  GROUNDED -> $OUT_GROUNDED"
echo "  ABLATED  -> $OUT_ABLATED"
echo
echo "--- GROUNDED (in your voice) ---"; cat "$OUT_GROUNDED" 2>/dev/null; echo
echo "--- BASE (generic) ---";          cat "$OUT_BASE" 2>/dev/null; echo

[ $beat1_ok = 1 ] || exit 1
exit 0
