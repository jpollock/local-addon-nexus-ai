# Parallel Protocol — intelligence-layer work, multiple AI agents

*Branch `poc/nexintelligence`. Read this + `CLAUDE.md` (intelligence-layer
section) before picking up any packet from `WORK_PACKETS.md`.*

## Isolation

One agent = one git worktree with its own branch (the base branch is checked
out in the primary worktree, so `-b` is required):

    git worktree add -b <packet-id> .worktrees/<packet-id> poc/nexintelligence

Never two agents in one checkout. Merge back per-packet, smallest possible
diffs. A fresh worktree has neither `node_modules` nor `lib/` — set both up
before diagnosing anything as a branch regression (WP-05 finding):

    ln -s ../../node_modules node_modules
    npm run compile

(`.gitignore` now uses `node_modules` without a trailing slash so this
symlink is ignored — it wasn't, and `git add -A` tracked it in WP-04.
If you see the symlink in `git status`, do not commit it.)

**Baseline your test counts in the worktree, not from memory** (WP-04
finding): some suites gate on untracked artifacts — e.g.
`tests/main/embedding-service.test.ts` `describe.skip`s without the local
model files — so a fresh worktree runs FEWER tests and still reports green.
When comparing runs, diff the **skipped** count as well as failures; a
skipped-count change explains a test-count delta that would otherwise read
as a regression or a phantom gain.

**Before creating the worktree, confirm the intelligence layer is
actually tracked**: `git status` in the primary checkout must not show
`src/intelligence/` or `docs/intelligence/` as untracked — if it does, stop
and escalate; a worktree cut from that state won't contain the layer or your
pattern's exemplars. *(Calibration finding WP-02.3 — this exact failure
happened on the first run.)*

## Test environment (native modules)

better-sqlite3 is built for EITHER Electron (Local can load the addon) OR
system Node (jest can run) — never both at once (see CLAUDE.md "Native
Modules"). The repo's `pretest` hook rebuilds for Node automatically when
needed. If your session ran jest, say so in your report: the owner must
`npm run rebuild` before loading Local again. Never leave the ABI state
undisclosed.

## Ownership map (contention control)

| Surface | Rule |
|---|---|
| `src/main/mcp/modules/fleet/<one-tool>.ts` + its test | **Parallel-safe** — one packet per file, no coordination needed |
| `src/intelligence/` (the core) | **Serialized** — one packet holding core changes at a time; announce in the packet thread before starting |
| `src/main/intelligence-host/` | Serialized with the core (same owner-lock) |
| `src/main/index.ts` | **The integration lock.** Wiring edits only, done as a packet's final step by whoever holds the lock, kept to the minimal import + call. Never refactor index.ts opportunistically |
| `src/main/mcp/modules/fleet/index.ts` | Same lock as index.ts (registration edits) |
| `src/main/ipc-handlers.ts` | Same lock as index.ts (WP-04 ruling: it hosts the inlined SITE_FINDER_APPLY filter engine). Wiring/enrichment call sites only — logic lives in a separate module; never refactor the handler chains opportunistically |
| `CLAUDE.md`, `INTELLIGENCE_ROADMAP.md`, `docs/intelligence/` | Human-owner approval before edits |

## House rules (inherited, non-negotiable)

- No version bumps, no releases, no `git push`, no publishing — ever
  (CLAUDE.md top section governs).
- After any `npm install`: `npm run rebuild` before assuming native modules
  work (better-sqlite3/Electron ABI — CLAUDE.md "Native Modules").
- New dependencies: none without owner approval. The intelligence layer has
  deliberately added zero.
- Legacy behavior parity is a hard requirement: enrichment is additive; a
  reader migration that changes existing output semantics is a defect.
- The nested eslint seam rule (`src/intelligence/.eslintrc.json`) is never
  weakened. **Know its failure mode** (WP-06): enforcement rides on eslint 8's
  `.eslintrc` cascade — a migration to flat config silently kills the rule
  while lint still exits 0. Any flat-config migration must port the seam rule
  and re-verify it fires (probe: import `electron` from `src/intelligence/`
  and confirm the `no-restricted-imports` error appears).

## Definition of done, per packet

1. `npx tsc -p . --noEmit` clean (`npm run typecheck`).
2. The full intelligence set green. **WP-05 landed: `jest.config.js` roots now
   cover `src` as well as `tests`, so no flag is needed —** `npm test` runs
   every intelligence suite (they all live under `src/**/__tests__/`) alongside
   the legacy ones, and `npm run test:ci` gates them too. To run only the
   intelligence set while iterating: `npx jest src/`.
3. Any LEGACY suites covering files you touched also green — find them with
   `grep -rl <your-file's-basename> tests/` and run those via plain `npx jest <path>`.
4. New behavior has a test that pins it (no untested acceptance criteria) —
   including the additive-parity pin for reader migrations (see the pattern's
   cp.test).
5. Diff reviewed against the pattern's exemplar for structural drift.
6. Packet checklist updated in `WORK_PACKETS.md` (checkbox + one-line outcome
   note + anything learned that should amend a pattern), and the ABI state
   disclosed per the Test environment section.

## Escalation triggers — stop and ask, don't improvise

- A pattern's abort condition fires (see each pattern's `aborts` block).
- The change wants a new event topic, payload schema version, envelope field,
  or storage marker.
- Legacy parity can't be preserved additively.
- Anything touching `wpeOperationPermissions` semantics (the M4 eval family
  is its regression harness — if those would change, a human decides).
- Two packets turn out to need the same file.

## Communication

Each packet's work happens on its worktree; questions/decisions land as notes
in the packet's section of `WORK_PACKETS.md` (append-only — it doubles as the
episodic record of this project's engineering, which is fitting). Do not leave
decisions only in chat transcripts.

**Integration reports carry receipts:** any report of a merge into
`poc/nexintelligence` must include `git diff --stat <merge>^1 <merge>` (the
merge against its first parent), so the owner sees exactly which files
changed without having to ask. An integration report without its stat block
is incomplete.
