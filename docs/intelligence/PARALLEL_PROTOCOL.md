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

**A worktree test result that the primary checkout cannot reproduce is
suspect in BOTH directions** (WP-15 finding): a poisoned ts-jest cache
reported a failure that did not exist. Before diagnosing a
worktree-only failure as real, re-run the suite with `--no-cache`; before
trusting a worktree-only green, likewise.

**A "dormant" branch may have already shipped** (WP-22 finding): before
treating branch work as stalled prior art, run
`git merge-base --is-ancestor <branch> poc/nexintelligence` — the
agent-site-picker branch's content was live in the tree while its branch
name sat in the worktree list looking abandoned.

**`git stash` is ONE STACK shared by every worktree** (WP-19b incident:
a `stash pop` applied a sibling packet's stash and dropped its entry —
recovered by SHA). During multi-agent operation, never use bare
`git stash`/`pop` for baselines: take the baseline BEFORE editing, or
save your delta with `git diff > /tmp/<packet>.patch` + `git checkout`.

**A baseline is only a baseline if the tree held still** (WP-21b): jest
reads each suite as it reaches it, so a run spanning your own edits is
part-pre, part-post, with nothing saying which. And `npm test | tail`
reports TAIL's exit code — a 4-failure run can print exit 0; capture the
exit code before the pipe (`npm test > log; echo $?`) or use pipefail.

**An uncompiled worktree fails exactly four AgentRegistry tests** (root
cause found at WP-20 phase 1: the fixture `path.resolve`s into
`lib/main/agent-sdk`) — the protocol's compile step is not optional, and
this is what skipping it costs. If those four are red, compile first;
if still red after compiling (WP-19b observed this), see WP-23.

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
needed — **but ONLY via `npm test`; bare `npx jest` skips the hook** and a
wrong-ABI tree reports a mass NODE_MODULE_VERSION failure that looks like
hundreds of real reds (WP-22 finding: 82 suites "failed" this way). Second
trap in the same family: `--testPathIgnorePatterns` REPLACES jest.config's
ignore list rather than extending it, silently re-enabling `/e2e/`.
Baseline with `npm test`, or run the pretest guard first. If your session ran jest, say so in your report: the owner must
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

**Uncommitted architect work in the primary checkout** (now standard, after
three exercises of the WP-02 precedent — 4dc50b21, 699a8121): an agent that
finds uncommitted `docs/intelligence/` changes blocking its merge commits
them VERBATIM in a separate, clearly-attributed commit ("commit architect
session's … (found uncommitted in primary checkout)") before merging. Never
fold them into your own commits, never edit them, and flag the commit in
your report so the architect can verify fidelity.
