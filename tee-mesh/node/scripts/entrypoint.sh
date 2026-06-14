#!/bin/sh
set -e
# Materialize the owner's Codex (ChatGPT) credentials from a base64 dstack secret so `codex exec`
# uses the subscription. $HOME=/data is the writable CVM volume, so refreshed tokens persist.
if [ -n "$CODEX_AUTH_JSON_B64" ]; then
  mkdir -p "$HOME/.codex"
  printf '%s' "$CODEX_AUTH_JSON_B64" | base64 -d > "$HOME/.codex/auth.json"
  chmod 600 "$HOME/.codex/auth.json"
fi
exec deno run --allow-net --allow-env --allow-read --allow-write --allow-run=claude,codex,pi main.ts
