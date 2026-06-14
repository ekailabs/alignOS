# Ask Mode Picker (Quick / Deep): Design

Date: 2026-06-14
Component: `assist-local` (Electron renderer)
Status: Approved for planning

## Problem

The Electron client lets you ask questions in two places, but both always send
`mode: 'quick'`. There is no way for the user to choose Deep Mode at ask time,
even though the rest of the stack already understands and routes Deep requests.

The two ask surfaces:

1. **Ask a known agent** (`#ask` view): already shows a static `quick mode`
   chip next to the agent's name (`renderer/index.html:151`).
2. **Inbox "Ask anyone in the mesh"** box (`#inbox-ask`,
   `renderer/index.html:125`).

Both call `api.askProvider(...)` with a hardcoded `mode: 'quick'`
(`renderer/app.js:581` and `:605`).

## What already works (no changes needed)

The mode is forwarded all the way to the gateway:

`askProvider({ mode })` (renderer)
→ IPC `ask-provider` (`src/preload.js:18`)
→ main process handler
→ `requestProvider({ mode })` (`src/mesh-client.js:68`)
→ `POST /owner/request` with `{ question, mode, owner, url }`.

All demo providers advertise `capabilities: { modes: ['quick', 'deep'] }`
(`renderer/app.js:71,76,80`). So this is purely a renderer UI gap.

## Goal

Add a Quick/Deep picker to both ask surfaces so the chosen mode flows through
the existing plumbing. Default to Quick. Respect each provider's advertised
capabilities where the provider is known.

Non-goals: no backend or gateway changes; no change to how Deep Mode itself
behaves once a request is sent; no new persisted preference store.

## Design

### 1. Control: segmented toggle

A two-segment pill, `Quick` | `Deep`, with one segment active. Quick is active
by default. The active segment reuses the existing color language from
`.mode-tag` (`renderer/styles.css:192-194`):

- Quick active: green (`--green` on `--green-soft`)
- Deep active: indigo (`--accent` on `--accent-soft`)
- Inactive segment: muted text, transparent background
- Disabled segment: faint text, `not-allowed` cursor, tooltip

New CSS classes in `renderer/styles.css`:

- `.mode-toggle`: inline-flex group, rounded, thin border, matches chip scale
- `.mode-seg`: segment button; `.on` state carries the active color
- `.mode-seg[disabled]`: muted, non-interactive

The mode lives in the DOM: the segment carrying `.on` is the current mode.
There is no parallel JS state variable to keep in sync.

### 2. Known-agent ask view (`#ask`)

- Replace the static `<span class="chip" id="ask-mode">quick mode</span>` with
  the toggle markup (two `.mode-seg` buttons inside `#ask-mode-toggle`).
- `openAsk(...)` resets the toggle to Quick every time the view opens.
- Capability-aware: when the selected provider's `capabilities.modes` does not
  include `deep`, the Deep segment is rendered `disabled` with a tooltip
  ("Deep mode not supported by this assistant") and the toggle stays on Quick.
  The agent card is rendered from a service object that already has `modes`
  (`renderer/app.js:494`). Thread it through by adding a `data-modes` attribute
  to the card and reading it in the click handler that calls `openAsk`
  (`renderer/app.js:714`), passing the modes array into `openAsk`.

### 3. Inbox "Ask anyone" box (`#inbox-ask`)

- Add the same toggle into `.inbox-ask-row`, between the author input
  (`#inbox-ask-author`) and the `Ask →` button (`#inbox-ask-send`).
- Default Quick. Both segments always enabled, because the recipient is
  free-form and may be unknown at ask time, so there is no capability list to
  check against.

### 4. Wiring (`renderer/app.js`)

- `wireModeToggle(el)`: attaches a click handler to a `.mode-toggle` that, on
  click of an enabled `.mode-seg`, moves `.on` to the clicked segment.
- `readMode(el)`: returns the `data-mode` of the `.on` segment (falls back to
  `'quick'`).
- `sendAsk()`: read mode via `readMode($('ask-mode-toggle'))` instead of the
  hardcoded `'quick'`; pass it to `askProvider`; the provenance line reflects
  the chosen mode ("Answered by NAME's assistant in deep mode, ...").
- `sendInboxAsk()`: read mode via `readMode($('inbox-ask-mode'))` into
  `payload.mode`.
- Reset helper for the known-agent toggle, plus capability gating, invoked from
  `openAsk(handle, name, desc, modes)`.

## Files touched

- `renderer/index.html`: toggle markup on both surfaces
- `renderer/styles.css`: `.mode-toggle`, `.mode-seg`, disabled state
- `renderer/app.js`: `wireModeToggle`, `readMode`, `openAsk` signature +
  capability gating, `sendAsk`, `sendInboxAsk`, agent-card `data-modes`

## Testing

The renderer has no DOM test harness today (existing tests are `src/*.test.js`
for node modules, and this logic is DOM-bound). Verification is manual in the
running app:

1. `npm start` in `assist-local`.
2. Open a known agent: toggle defaults to Quick; clicking Deep highlights it;
   `Ask →` produces a provenance line reading "in deep mode".
3. A provider that advertises only `quick` shows Deep disabled with a tooltip.
4. Inbox box: toggle defaults to Quick; choosing Deep sends `mode: 'deep'`.

## Risks and edge cases

- A provider with no `capabilities.modes` field: treat as quick-only (Deep
  disabled) so we never offer a mode the provider never claimed.
- Resetting on `openAsk` avoids a stale Deep selection leaking from a previous
  agent into a quick-only one.
- Inbox box keeps both modes enabled by design; a Deep ask to a quick-only
  recipient is the gateway's concern, consistent with current behavior.
