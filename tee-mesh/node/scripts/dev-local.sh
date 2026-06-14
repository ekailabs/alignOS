#!/usr/bin/env bash
set -euo pipefail
export ALIGN_PORT="${ALIGN_PORT:-8787}"
export ALIGN_OWNER_HANDLE="${ALIGN_OWNER_HANDLE:-shashank}"
export ALIGN_MANIFEST_JSON="${ALIGN_MANIFEST_JSON:-[]}"
export ALIGN_TASKS="${ALIGN_TASKS:-/tmp/align-dev-tasks.json}"
export ALIGN_KNOWLEDGE="${ALIGN_KNOWLEDGE:-/tmp/align-dev-knowledge.json}"
export ALIGN_DRAFT_BACKEND="${ALIGN_DRAFT_BACKEND:-claude}"
export ALIGN_LOOP="${ALIGN_LOOP:-off}"
export ALIGN_LOOP_PASSES="${ALIGN_LOOP_PASSES:-6}"
export ALIGN_SELF_URL="${ALIGN_SELF_URL:-http://localhost:${ALIGN_PORT}}"
cd "$(dirname "$0")/.."
exec deno task start
