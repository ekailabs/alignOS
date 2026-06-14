# Design specs & history

This folder is the **design rationale and build history** behind AlignOS — the docs we wrote
*before* and *while* shipping. It is intentionally separate from the published documentation in
[`../`](../): those docs explain the product; these explain *why it is the way it is*.

If you're a judge or a new contributor trying to understand a decision ("why does drafting run on
the laptop and not in the TEE?", "why is Quick Mode a refinement loop?"), start here.

## Design specs

| Spec | What it enables | Status |
|---|---|---|
| [assist-remote-design.md](assist-remote-design.md) | The whole product surface — the `assist-local` desktop app + CLI and the `assist-remote` TEE runtime: Inbox, the Approve · Follow up · Decline loop, Preferences, onboarding, and A2A between assistants. | Shipped |
| [local-agent-drafting-design.md](local-agent-drafting-design.md) | **Deep Mode** — every incoming request is drafted by the owner's *own* local `claude`/`codex`, read-only, in their real workspace; raw files never leave, only the reviewed reply does. | Shipped |
| [quick-mode-style-loop-design.md](quick-mode-style-loop-design.md) | **Quick Mode in the owner's voice** — a real model answers inside the TEE via the Codex-backed CLI path and a refinement loop that replays the owner's distilled prompting style. | Shipped |

## Implementation plans

Task-by-task build plans that turned the specs above into code.

- [plans/2026-06-14-assist-local-agent-drafting.md](plans/2026-06-14-assist-local-agent-drafting.md)
- [plans/2026-06-14-tee-quick-mode-owner-style-loop.md](plans/2026-06-14-tee-quick-mode-owner-style-loop.md)

## Verification notes

- [notes/2026-06-14-loop-local-verification.md](notes/2026-06-14-loop-local-verification.md) — the
  M0–M2 checks proving Quick Mode returns a real, looped, owner-styled answer (the basis of the
  grounded-vs-base demo in [../DEMO.md](../DEMO.md)).

## UI mockups

[mockups/](mockups/) holds the "Quiet" design-system mockups (PNG + source HTML) that the shipped
Electron renderer is built from. The README and other docs reuse `1-quiet.png`,
`5-quiet-complete.png`, and `6-quiet-preferences.png` as product screenshots.

---

**Canonical vocabulary** for everything here lives in [../taxonomy.md](../taxonomy.md).
