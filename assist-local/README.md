# assist-local — the AlignOS edge app

The local half of AlignOS: the app (and CLI) that runs on **your** machine. It ingests your
agent logs, **redacts them locally**, uploads only scoped slices to your private space, and is
where you review and approve everything your assistant does. Raw logs and files never leave the
device — only reviewed, redacted slices do.

For the big picture see the [project README](../README.md); for the precise privacy model see
[docs/PRIVACY.md](../docs/PRIVACY.md). This is `assist-local` in the
[taxonomy](../docs/taxonomy.md); its TEE counterpart is `assist-remote` in
[`tee-mesh/node`](../tee-mesh/node).

## Install

```bash
cd assist-local
npm install
```

## Run

**Desktop app** (full onboarding: Welcome → Connect → Consent → Seed → Folders → Inbox):

```bash
npm start          # electron .
```

**CLI** — the same logic core, headless:

```bash
node bin/alignos <command>      # or: npm run cli -- <command>
```

| Command | What it does |
|---|---|
| `setup --url <gateway>` | Connect to your private space, claim it, and seed it from your logs. |
| `status` | Show the connected space. |
| `seed [--days N \| --all]` | Re-ingest redacted logs and upload (default: last 7 days). |
| `watch` | Run the drafting loop headless — draft every incoming request locally, read-only. |
| `inbox` | List requests that need you. |
| `show <id>` | One request + its drafted reply. |
| `draft <id>` | Draft a reply locally with `claude`/`codex` and print it. |
| `approve <id>` | Send the (possibly edited) reply. |
| `followup <id> --msg <t>` | Revise the draft (`--msg -` reads stdin). |
| `decline <id> [--note <t>]` | Refuse. |
| `ask --owner <handle> [--mode quick\|deep] <q>` | Ask another owner's assistant. |
| `mcp` | Expose the inbox to other agents over a stdio MCP bridge. |

IDs accept a short prefix (as shown by `inbox`). Need a local space to point at? Run
[`tee-mesh/node/scripts/dev-local.sh`](../tee-mesh/node/scripts/dev-local.sh) and
`setup --url http://localhost:8787`.

## What it reads, and what leaves

- **Reads** (last 7 days, deny-by-default): agent logs under `~/.claude`, `~/.codex`,
  `~/.openclaw`, `~/.pi`, `~/.opencode`, `~/.hermes`, plus folders you explicitly grant.
  ([`src/agent-logs.js`](src/agent-logs.js), [`src/scope.js`](src/scope.js))
- **Uploads**: only redacted `{prompt, output}` pairs and prompt chains — secrets masked first.
  ([`src/redact.js`](src/redact.js), [`src/mesh-client.js`](src/mesh-client.js))
- **Never leaves**: raw logs, file contents, or secrets. Deep Mode runs **read-only** and only
  the reviewed reply is sent.

## Storage (`~/.alignos/`)

| File | Contents |
|---|---|
| `config.json` | Space URL + agent prefs (`cli: auto\|claude\|codex`, `workspace`, `timeoutMs`, `concurrency`, `autoDraft`). |
| `scope.json` | Granted folders + onboarding flag (deny-by-default). |
| `owner.key` | Your Ed25519 private key (mode `0600`). |
| `drafts.json` | Local draft overlay per task. |
| `decisions.jsonl` | Append-only audit of every Approve / Follow up / Decline. |
| `personas.json` | Optional expertise/avatar overrides per space (see [`personas.example.json`](personas.example.json)). |

Override the home dir with `ALIGN_HOME`. Provider selection and drafting internals live in
[`src/agent-runner.js`](src/agent-runner.js) and [`src/draft-loop.js`](src/draft-loop.js);
design rationale in [docs/specs/local-agent-drafting-design.md](../docs/specs/local-agent-drafting-design.md).
