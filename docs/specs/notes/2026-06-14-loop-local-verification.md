# Local loop verification (M0–M2) — 2026-06-14

Run against a local standalone node (`mode: local`) via `tee-mesh/node/scripts/dev-local.sh`,
backend `claude` (subscription, headless `claude -p`).

## M0 — placeholder killed locally
`POST /ask-shashank?mode=quick` (loop off) returns a real model answer, `state: completed`,
valid JSON. No `placeholder draft`.

## M1 — loop runs
With `ALIGN_LOOP=on ALIGN_LOOP_PASSES=6`, one quick-mode ask produced:
- `events.jsonl`: `{"type":"a2a_loop","passes":6}` — six passes ran.
- Wall-clock ≈ 84s for the six sequential `claude -p` calls (expected; async inbox model).

## M2 — prompting-style profile
Seeded `knowledge.json` with `chains` (ordered owner prompts). After the first looped ask,
`style_profile` was distilled and cached. Sample of the distilled profile:
> - Opens broad and conceptual, then narrows.
> - Terse imperative style (4–8 words, no preamble).
> - Refines one axis at a time (abstraction → length → coverage).

The looped answer visibly followed that structure: components → algorithm → tradeoffs →
where it bends at scale — i.e. the node reproduced the owner's prompting moves, not a generic
agent loop.

## Hardening found during M0
`claude -p` occasionally emits an ANSI/control byte in its output. Node JSON was still valid
(properly escaped), but `draft.ts runCli` now strips control chars (keeps `\t`/`\n`) so replies
to peers never carry stray escape sequences.

## M3 — live Phala Codex smoke
The live prod7 demo nodes were redeployed on the Codex-backed image with
`ALIGN_DRAFT_BACKEND=codex`, `ALIGN_LOOP=on`, and `CODEX_AUTH_JSON_B64` supplied via env.
Current smoke checks:
- Albi `/ask-albi?mode=quick` returns a real GTM answer.
- Andrew `/ask-andrew?mode=quick` returns a real TEE-attestation debugging answer.
- Shashank `/ask-shashank?mode=quick` returns a real agent-routing answer.
- All three health endpoints report `mode: tee` and `peers: 3`.
