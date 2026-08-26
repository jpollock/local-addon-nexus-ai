# Agent-addressed grants + the account write bound

*The permissions-pane prerequisite packet. Rulings 2026-08-26, all owner-issued:*

- **Ruling 1 (B):** the grant model widens to **(grantee, capability)**.
- **Ruling 1a:** migration is **FAIL-CLOSED** — at the flip, every existing
  platform-wide grant is revoked with an honest recorded reason (the WP-20f
  precedent); every grantee needs an explicit re-grant. No fan-out, no
  grandfathering.
- **Ruling 1b:** three first-class grantee classes: **named agents**,
  **`chat`** (the docked panel), **`mcp-client`** (every external MCP caller
  AND the CLI/GraphQL surface — the machine-interface class; do not invent a
  fourth identity for the CLI).
- **Ruling 2 (B):** the account scope becomes a **real write bound** wired
  into `isOperationAllowed` — never a relabeled scan scope on a permissions
  surface.

## Why (one paragraph)

The ratified permissions-pane sheet (docs/handoff/settings-permissions/) was
drawn on two asserted platform facts that were false: grants are
capability-wide (no grantee anywhere in `ResolvedGrant`/`sequenceGuard`), and
the only account scope (`wpeAccountFilter`) scopes *syncing*, not writes.
The owner ruled both models widen to match the drawing rather than the
drawing shrinking to match the models. The pane build (the original items
7/8) is the LAST phase of this packet, unblocked by the earlier ones.

## Measured seams (2026-08-26, this worktree)

- `MarkerEntry` (`capabilityGrants.ts`): { capability, runbookId, runbookHash,
  eventId, issuedAt } — no grantee. `MarkerState.version: 1`.
- `ResolvedGrant`: no grantee. `DisarmReason` includes WP-20f's
  `requires-explicit-grant` (the precedent flip: mandated capabilities were
  revoked on upgrade with the reason recorded, never silently).
- The gate: `checkCheckpointSequence(toolName, taskId)` — NO caller identity.
  Its `reachRefusal` is the grant check ("a grant is prior to a run").
- Call sites: `AgentDispatcher.dispatch` (has the agent name in hand),
  `ChatService` (is chat), `ToolRegistry.call` (already carries
  `accessMethod?: 'mcp' | 'cli' | 'agent'`).
- Grant issuance: `governMatrix.ts` (`granted-at-control`), grants stored via
  `intelligence_grants_state` marker. Revocations are separate records —
  "two facts, two records".
- `isOperationAllowed(operation, environment, target?)` — no account
  dimension. Install→account resolution exists in the WPE install cache.
- `wpeAccountFilter` = scan scope. It is NOT this packet's bound and is not
  renamed, repurposed, or read by the gate.

## Status — EXECUTED 2026-08-26, phases 1–5 (one commit each, full gate between)

79860f87 (1: model + fail-closed flip), 49425503 (2: per-caller gate),
aa389a7d (3: granting surfaces), f1227ea6 (4: account write bound),
abda4ed7 (5: the pane; original Workstream-1 items 7/8 close). Residuals,
recorded not hidden: no direct door from a pane grant-row into a specific
agent's workspace yet (the row names holders; the Agents tab is one click);
refusal copy at call sites doesn't yet name an excluded ACCOUNT as the
reason (the gate refuses correctly; the message enrichment can ride a later
pass); `readGrantIssuance` stays capability-keyed first-wins for the
one-row-per-capability matrix (per-pair accessor exists and the pane uses it).

## Phases

### Phase 1 — the grant model (marker v2, fail-closed flip)

- `MarkerEntry` gains `grantee: string` (agent id, `'chat'`, `'mcp-client'`).
  `MarkerState.version: 2`.
- Loading a v1 marker performs the flip ONCE: every v1 entry is revoked —
  one `control.grant.revoked` event per entry, `causation` chained to the
  original issue event, with a NEW recorded reason naming this flip (not
  WP-20f's) — and an empty v2 state is written. The revocations are the
  compliance record of the flip; silence is forbidden.
- `DisarmReason` gains `'requires-agent-grant'` — distinct from
  `requires-explicit-grant` so the two flips stay distinguishable in every
  surface that renders reasons.
- `ResolvedGrant` gains `grantee`; resolution returns the grant set keyed
  (grantee, capability). `getCapabilityGrants()` consumers audit: every
  `grants.find((g) => g.capability === …)` becomes grantee-aware or is
  proven read-only-rendering.
- Issuance at the control names the grantee; `control.grant.issued` payload
  gains `grantee` (schema `grant.issued/2`; the envelope schema regex allows
  the version bump).

### Phase 2 — the gate learns who is asking

- `checkCheckpointSequence(toolName, taskId, grantee)` — explicit third
  parameter, threaded from: AgentDispatcher (its agent name), ChatService
  (`'chat'`), ToolRegistry (`accessMethod 'mcp' | 'cli'` → `'mcp-client'`;
  `'agent'` → the task frame's agent, falling back to refusal-with-reason if
  unattributable — an unattributable caller holds nothing, fail closed).
- `reachRefusal` keys on (grantee, capability). The refusal names the holder
  set and the asker: "held by security-sentinel; this caller (chat) does not
  hold it" — and doors to the granting surface.
- Parity: read paths keep their current behavior (the gate governs
  capability-armed writes exactly as today; no new read gating).

### Phase 3 — the granting surfaces

- GovernSection gains grantee addressing: a grant is made TO a grantee.
  `chat` and `mcp-client` grants live here (they have no workspace).
- AgentWorkspace gains its grants section — the door target the pane ruling
  requires ("the decision can actually be changed inside that agent").
- Every grant row renders its act (event id + moment) per grantee, as the
  matrix already does per capability.

### Phase 4 — the account write bound (independent; may land before 1–3)

- New setting `wpeWriteExcludedAccounts: string[]` (default `[]` = no
  exclusions; upgrades change nothing). Added to `NexusSettings` AND
  `UpdateSettingsSchema` (`.strict()` eats unlisted keys — the known trap).
- `isOperationAllowed` gains the account dimension: a WPE target whose
  account is excluded refuses every WRITE operation (`wpcli`, `push`,
  `delete`, `pull`? — pull READS production and writes locally; ruled here
  as a write for scope purposes since the sheet's own example is "Copy a
  site down") with a refusal naming the account and the setting.
  `wpcli_read` stays allowed — reading is stated once, not a decision.
- Resolution: install → account via the install cache at the existing gate
  call sites; an unresolvable account on an excluded-list-nonempty machine
  fails closed with its own reason (an unknown account is not a permitted
  one when exclusions exist; when the list is empty the dimension is inert).
- External hosts: out of scope for the account dimension — their per-alias
  and per-site exceptions already exist; the pane states this.

### Phase 5 — the pane (the original items 7/8)

Build the reissued sheet as drawn — now true: bound above (operation ×
place, account exclusions at its foot as a REAL bound), grants below
(grantee sets honest from the v2 marker, acts, docs+hashes, derived clipped
lines and gates), read-only, doors to Govern/agent workspaces. Retire
PermissionsSection + GovernSection as separate top-level surfaces per the
sheet's "no second permissions pane".

### Phase 6 — record

CLAUDE.md (grants + audit sections), architecture doc ADR note, the
designer sheet gets a confirmation stamp that both asserted facts are now
platform facts, WORK_PACKETS entry.

## Rules

- TDD per phase; mutation-witness every guard; full `npm test` between
  phases; one commit per coherent step.
- Never write `events`/`twin_facts` directly; grants flip through the
  emitter with real provenance.
- No push/tag/version bump without the owner's explicit word.
