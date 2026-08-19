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

**New files go where your `pwd` is, not where your packet is** (WP-20b
near-miss): an absolute path anchored at the repo root lands the file in
the PRIMARY checkout, not your worktree — and jest there will run it
against a tree you aren't editing. Before your first commit, run
`git status` in the primary checkout too; anything of yours appearing
there is in the wrong tree.

**Baseline your test counts in the worktree, not from memory** (WP-04
finding): some suites gate on untracked artifacts — e.g.
`tests/main/embedding-service.test.ts` `describe.skip`s without the local
model files — so a fresh worktree runs FEWER tests and still reports green.
When comparing runs, diff the **skipped** count as well as failures; a
skipped-count change explains a test-count delta that would otherwise read
as a regression or a phantom gain. **This cuts BOTH ways** (WP-20c merge
finding): the primary checkout can also gate-in tests the worktree skips —
it holds both embedding model files where a worktree has one, so ten
embedding tests move from skipped to passed across that boundary, and a
comparison that reads only the passed column sees a phantom regression of
exactly ten. Same total, different split; read the skipped column first.

**A worktree test result that the primary checkout cannot reproduce is
suspect in BOTH directions** (WP-15 finding): a poisoned ts-jest cache
reported a failure that did not exist. Before diagnosing a
worktree-only failure as real, re-run the suite with `--no-cache`; before
trusting a worktree-only green, likewise.

**THE POISONED ts-jest CACHE IS NOT A PARENTHETICAL — four packets, four
occurrences** (WP-15, WP-20a, WP-20c ×2). The signature is always the same:
EXACTLY ONE unrelated suite fails to parse (its own shebang, its own first
line) while everything else is green, reproducibly with the cache and never
without it. The move is `npx jest --clearCache`, THEN re-measure — before
believing the red, before filing a finding, before touching the code it
points at. A parse failure in one suite you did not edit is the cache until
proven otherwise. **Fifth occurrence added a new form** (WP-31): the
poisoned cache can mask a MUTATION — a false SURVIVAL, not just a false
red — so mutation-battery runs are ALWAYS `--no-cache`, no exceptions;
a witness credited from a cached run is not credited. And a shell trap
in the same silently-measures-nothing family: `npx jest $var` does NOT
word-split under zsh — the command runs, exits green, and tested
nothing. Quote-and-splat explicitly, or echo the resolved command
before trusting its result.

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

**An uncompiled worktree used to fail exactly four AgentRegistry tests**
(root cause found at WP-20 phase 1: the fixture `path.resolve`d into
`lib/main/agent-sdk`) — it burned three packets reading as a phantom
agent-runtime regression. **Resolved by WP-23:** the fixture now requires
the SDK source, `__dirname`-relative, and those four pass with `lib/`
absent. The compile step remains non-optional for everything else, which
is why this paragraph stays. If you now see four AgentRegistry reds, it
is not this. Two other signatures to tell apart first: a suite that fails
to import with 0 tests run is a wrong ABI, and native-module suites
failing unevenly within one run is the tree flipping mid-run — see the
mid-session flip paragraph in the Test environment section.

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

**The tree can flip under you MID-SESSION** (WP-20d finding): `node_modules`
is SHARED across every worktree via the symlink, so any `npm test` or
`npm run rebuild` elsewhere on this machine rebuilds better-sqlite3 to a
different ABI while your suite is running. A NODE_MODULE_VERSION failure on
a suite that just passed is the environment, not your change — re-run
`npm test` (the pretest hook re-flips it) and re-measure before believing
the red. Same family as the poisoned cache: check the environment before
diagnosing the code. During multi-agent operation, expect this whenever
another session touches the repo. **The flip can wear a mask** (WP-20e):
a fixture that catches its own init failure surfaces the flip as
`Cannot read properties of undefined`, not a NODE_MODULE_VERSION stack —
if a native-module suite fails with a nonsense undefined-read it did not
fail with yesterday, suspect the ABI before the code.

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
   cp.test). **A mutation witness must recreate the real pre-fix shape, not a
   syntactic shadow of it** (WP-24 finding): flipping `import type` → `import`
   left a pin green because TypeScript ELIDES an import used only in type
   position — the "mutation" compiled to nothing and the witness was invalid.
   Before crediting a kill, confirm the mutation actually changes emitted
   behavior; the honest witness restores the whole pre-fix construct (value
   import AND the runtime use) and goes RED against that. **Second trap in
   the same family** (WP-26): jest's `toEqual` treats an `undefined` array
   element as equal to an absent one — a handler that ALWAYS pushed its
   argument passed a test whose entire subject was absent-vs-present. When
   presence itself is the assertion, assert length or use `toStrictEqual`.
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

**A speculative cause and a measured observation must not share a
paragraph** (WP-23 finding, and it cost a packet number): WP-19b recorded a
real failure and a guess about why in one finding; downstream, the guess
inherited the observation's authority and became "the outlier WP-23 must
explain." Separate them typographically — observation first, then
"UNVERIFIED HYPOTHESIS:" on its own line — so no later reader can cite the
guess as a measurement. The check that dissolved this one was one `ls`.

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

**A pass-condition substring must not be a substring of a failure** (WP-32
finding): a harness that greps battery output for `0 total` also matches
`Snapshots: 0 total` and `20 total`, and reported two lies the same way
before it was caught. Anchor the match — full token, line-anchored, or
parse the count — so the assertion cannot be satisfied by a string that
contains it. A green that can be produced by the wrong line is not a green.

**A generator under mutation writes to a temp path, never the working
tree** (WP-32 finding — the poisoned-fixture form): a mutation to a
generator script ran, wrote the TRACKED fixture it generates, and the
revert of the script left the poisoned output on disk — the next full run
failed on a file nobody edited, which is the poisoned-cache rule's sixth
form. Determinism and battery runs of any file-emitting tool take
`--out <tmp>`; the tracked artifact is only ever written by the real
invocation, and a `:check` script that fails closed on a stale file is the
guard that makes the tracked copy trustworthy.

**Source files carry no invisible characters** (WP-25 finding — the NUL
form): a literal NUL committed inside a string constant passed every test,
tsc and eslint, and made `grep` answer `Binary file matches` — the tool
that would show you the offending line is the one the character disables,
so the defect is invisible to review by construction. A grep that calls a
source file binary is a FINDING, not an inconvenience: sweep for the
character, don't add `-a` and move on. Non-printing characters in source
belong only in explicit escapes (`'\0'` says what it is; a pasted NUL
says nothing to anyone).

**The mid-session ABI flip's second mask, and the unmasking probe**
(WP-33b, seventh occurrence): the flip can surface as "intelligence
core failed to initialise" across dozens of suites while
`node -p process.versions.modules` still prints your own ABI — the
version check tells you about YOUR node, not about what the shared
`node_modules` was last rebuilt for. The unmasking probe: call
`initIntelligenceCore` directly with a printing logger; the real
`NODE_MODULE_VERSION <n>` line names the mismatch. `npm rebuild
better-sqlite3` recovers, as documented.

**A battery killed mid-mutation leaves the mutation on disk** (WP-34
finding — the kill form of the poisoned-artifact rule): a stopped run
skips its `finally: restore()`, and the next baseline goes red on a file
nobody edited. Batteries verify the tree PRISTINE before and after and
refuse to run otherwise; after any interrupted battery, take a fresh
baseline rather than trusting the tree. Corollary from the same packet:
"a baseline is only a baseline if the tree held still" applies to the
battery itself — editing any file, including a test file, during a
battery invalidates that battery's run.

**An investigation reads every channel a decision can land in** (WP-36
finding — the phantom incident): the ledger records ACTS; the
operation-audit log records REFUSALS. Reconstructing an event from the
ledger alone produced a phantom incident — a tool that "executed" had in
fact been refused 2ms after the approval, and the panel's own defect
(painting ✓ on a refusal) made the phantom look photographed. Before
classifying anything as an incident, enumerate the channels a decision
could have landed in and read all of them; a UI state is not a channel,
it is a rendering of one, and it can lie.
