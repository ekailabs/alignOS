# alignOS Taxonomy

This document keeps product, implementation, and user-facing terms from drifting across
specs.

## Assistant Surfaces

| Term | Meaning | Runs where | User-facing? |
|---|---|---|---|
| `assist-client` | Local app, CLI, owner-auth client, inbox cache, and future edge execution path. | User's laptop / edge device | No. Users see "your assistant" and "Inbox". |
| `assist-remote` | TEE-hosted assistant runtime: A2A server, task store, drafting, identity, registry, gossip, human-review queue, and push. | Owner's private space / TEE CVM, implemented in `tee-mesh/node` | No. Users see "your assistant's private space" only when needed. |
| assistant | The user-facing entity represented by the `assist-client` + `assist-remote` pair. | Both local and remote surfaces | Yes: "your assistant". |
| private space | Plain-language phrase for the owner's TEE/CVM. | Remote confidential compute | Yes, sparingly. |
| agent logs | Local assistant/session logs from `~/.claude`, `~/.codex`, `~/.openclaw`, `~/.pi`, `~/.opencode`, and `~/.hermes`. | Edge device first; only redacted/compacted slices may be sent to the private space. | Yes, as "local assistant logs". |
| operator | The party that provisions and maintains TEE/CVM instances before or after user claim. | Phala/workspace/deployment layer | No. Use only in operator/developer docs. |
| owner | The human who claims one private space with their local owner key and controls that assistant's inbox and preferences. | User identity/control layer | Yes, as "you" in product copy. |

Operator and owner are intentionally separate roles. An operator may pre-provision many
TEE instances, but each instance becomes controlled by exactly one owner after the setup
token claim.

## Runtime Rule

Use `assist-client` when discussing code that runs locally, stores local state, renders UI,
or touches raw local data.

Use `assist-remote` when discussing code that runs in the TEE, participates in A2A, holds
the durable task source of truth, or signs/serves as the mesh identity.

The user-facing product should avoid implementation names unless the audience is a
developer. The product language is still "set up your assistant" and "review your inbox."

## Execution Names

| Execution mode | Component | Default posture |
|---|---|---|
| Quick Mode / TEE mode | `assist-remote` | Runs in the owner's TEE using synced notes and onboarding log memory; no live folder access. Can auto-handle only pre-approved, TEE-safe work. |
| Deep Mode / local mode | `assist-client` | Runs on the user's machine for tasks that need local folders/files/tools. Always requires explicit scoped approval because it can touch local data. |
| Local / edge reads | `assist-client` | The read path used by Deep Mode: reads approved local agent-log roots or folders, redacts locally, and sends only scoped slices after approval. |

## A2A Request Names

An inbox item is an A2A `Task` in an interrupted state, wrapped in a thin local envelope
for read state and decision capture.

| User action | A2A operation |
|---|---|
| Approve | Finalizing `Message` on the same `taskId` / `contextId`; task becomes `completed`. |
| Follow up | User `Message` on the same `contextId`; `assist-remote` re-drafts and returns the task to the inbox. |
| Decline | `tasks/cancel` or refusal `Message`; task becomes `canceled` / `rejected`. |
