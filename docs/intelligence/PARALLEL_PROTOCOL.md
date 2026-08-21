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

**`pwd` before you commit** (WP-39 incident): the shell's cwd persists
across a session, and a `cd` into the primary checkout hours earlier makes
`git add -A && git commit` land on the base — sweeping in the architect's
uncommitted record and anything else lying in the tree. Before ANY commit:
print the cwd and the branch in the same breath as the command. The same
persistence poisons measurements: a jest run "in the worktree" that was
actually the primary's reports the wrong tree's numbers, and the missing
suite count is how it surfaces. Recovery, when it happens: `git reset
--mixed HEAD~1` restores the working tree byte-for-byte — verify the
restoration, never assume it.

**A lock announced only on a worktree is not visible to the agent it warns**
(the WP-20f/WP-37 crossed claim): WP-37 claimed the intelligence-host lock
while WP-20f held it, because WP-20f's announcement lived on its branch and
the base could not show it. No harm that time — disjoint files — but the
rule is now explicit: the lock-announce commit lands ON THE BASE before the
work starts (WP-32's pattern). When the base is mid-merge and cannot take
it, the announce goes on the branch AND the sequencing comes from the owner,
stated in the launch instruction.

**An anchor that fails to match is a fault in the anchor until the line is
read with a tool that does not transform it** (WP-20f finding, the em-dash
form of the NUL family): a `—` escape in a quoted heredoc reaches Python
as six literal characters, and `cat -A` then renders the file's real em
dash as an escape — confirming the wrong hypothesis with the transforming
tool's own output. Read the disputed line with a byte-honest tool before
repairing the file it "mismatches."

**A timeout under multi-packet load is re-measured alone before it is
believed** (WP-42 finding): a test with 5× headroom timed out at load 6.9
with three packets running `npm test` concurrently, and passed twice at
load 4.6. Parallel waves make the machine itself a shared resource; a
timeout during one is a measurement of the LOAD until a solo re-run says
otherwise. Same family as the skipped-column rule: read the environment
before reading the result.

**A GENERATED ARTIFACT'S MERGE CONFLICT IS RESOLVED BY RE-RUNNING THE
GENERATOR, NEVER BY SPLICING HUNKS** (WP-41/WP-20g collision, ruled). Two
packets touched `docs/intelligence/design-fixtures/declared-procedures.json`
from opposite ends and neither touched the other's lines: WP-20g edited an
INPUT (`law/runbooks/promotion-execute.md` — a version bump and a `tools:`
declaration), WP-41 edited the GENERATOR (a new field and a shape-version
bump). Git saw one conflicted file and offered both sides' text; both sides'
text was WRONG, because the correct content is a function of the merged inputs
and neither side had them.

The resolution, in order, and it is mechanical:

1. Confirm the INPUTS merged cleanly — `git status --porcelain` over `law/` and
   the generator itself. A conflict there is a real conflict and this rule does
   not apply to it.
2. Re-run the generator. It overwrites the conflict markers wholesale; there is
   nothing to hand-merge because nothing in the file was hand-written.
3. Run the `:check` script. It fails closed on a stale artifact, so a green
   `:check` is PROOF the committed file is exactly what the merged inputs
   produce — which is the property a spliced resolution cannot have and cannot
   be talked into having.
4. Verify BOTH sides' contributions are present in the result, by reading the
   fields each side moved. WP-41's merge was checked this way: WP-20g's
   `version 1.2.0` and its new hash came through from the merged `law/`, and
   WP-41's `$shapeVersion 2` and `planCheckpoint` came through from the merged
   generator. A regeneration that silently dropped one side would still pass
   `:check` — `:check` proves the file matches the generator, not that the
   merge was complete — so this step is not redundant with step 3.

Why splicing is not merely worse but WRONG: the artifact carries a content
`hash` per runbook. A hand-merged file can hold WP-20g's checkpoint list beside
WP-41's shape version beside a hash computed over neither, and every consumer
that trusts the hash — which is what hash-pinning a run MEANS — then pins to a
document that never existed. The generator's header already says editing it by
hand is the defect pin 7 names; a merge is editing it by hand.

This generalises to every generated artifact under version control here
(`declared-procedures.json`, `citation-spans.json`, and anything a future
`fixtures:*` script emits). If you add one, give it a `:check` script in the
same commit — the check is what makes this rule enforceable rather than
advisory.

**An interrupted git writer leaves partial output on disk, and a
subsequent `M` is damage, not an edit** (WP-20g merge incident — the git
form of the poisoned-artifact family, beside WP-32's generator and
WP-34's battery forms): a checkout that dies on a stale index.lock can
die AFTER partially rewriting a working file — the file then matches no
commit, and `git status` reports a plain `M` that reads exactly like
someone's edit. Recovery, in order: confirm the lock is stale (zero
bytes, no git process owning THIS repo), remove it, force-checkout,
verify the file byte-for-byte against the blob it should be, `git fsck`,
and RE-MEASURE the full suite — a repaired tree is not verified until it
is re-measured.

**The pwd rule's edit-tool form** (WP-43 near-miss — worse than the
documented one): an editor that takes ABSOLUTE paths is not governed by
your cwd at all, and an edit to a TRACKED file in the wrong checkout
leaves nothing your own worktree's `git status` can show. Verify the path
prefix of every edit against your worktree root before editing; the tell,
when it slips, is tsc failing on symbols you just wrote — they landed
somewhere else. The recovery is the primary-restoration drill, verified
not assumed.

**Record merges are rebuilt from the three blobs, never hunk-edited — and
a zero-deletion diffstat is not proof of a pure append** (two WP-43
findings, one rule): diff3 matched both appends' leading blank line and
rule as common context, so hunk-level surgery silently dropped the `---`
separator — six characters the diff view showed as fine and only the
substring check caught. Concatenation-from-blobs with the four-way
verification (ancestor as exact prefix, each half as exact substring,
chronological order, arithmetic in one named unit) is the STANDARD, not
one resolution style among several. And before invoking the pure-append
fidelity form, READ the diff: an insertion mid-file also shows zero
deletions.

## Vacuous-guard shape #15 — the non-fatal producer behind a validating emitter (WP-45)

`Emitter.emit` validates causation and the producer is non-fatal: a test
that hands the producer a fabricated prior event id "passes" while no
event is emitted at all — the assertion never ran against an event
because there wasn't one. Any test of a non-fatal producer must FIRST
assert the event exists (count or id read-back) before asserting
anything about its content. A green test over an empty emission is shape
#15's tell.

## Receipts are pasted, never pre-written (WP-45 merge)

Every receipt in a report or commit message — md5, byte total, suite
count, diffstat line — is COPIED from the command's actual printed
output, after it runs. A receipt authored in anticipation is a
fabricated receipt even if the value later matches: the record's purpose
is checkable fidelity, and a pre-written value checks nothing. The
WP-45 merge caught its own (an md5 written before the print, amended en
route); the amendment is the standard, and so is the catch.

## NUL/invisible-character rule, extended (WP-30)

The family's first occurrence in FRESHLY AUTHORED source (not a
generator artifact): a literal NUL in a run-key separator passed tsc,
eslint and 48 tests; only `grep` answering "Binary file matches"
caught it. Two additions now standing: (1) batteries REFUSE to run
over sources containing non-printing characters — a mutation battery
over invisible bytes measures nothing trustworthy; (2) after any NUL
finding, every touched file is swept by byte scan, not by eye. Note
the architect's own first check of this finding also failed silently
(`grep -c $'\x00'` passes an empty pattern — argv cannot carry NUL —
and matches every line): verify NUL absence with a byte-level tool
(python/od), never a shell-argument pattern.

## A render test cannot pin a guard the render never reaches (WP-46)

Series guards: when an inner guard sits behind a caller that already
filters (the render path reached `standingApprovalSentence` only
through a list pre-filtered to `approved`), no render test exercises
the inner guard, and a mutation to it survives while every screen
draws correctly. Pins on guarded builders must drive the builder
DIRECTLY across its full input domain — including the states the
current callers cannot supply — or the inner guard is decoration. The
tell at battery time: a survivor whose mutation sits inside a function
every render test "covers."

## The battery pins its ABI (WP-49)

A mutation battery run records the ABI it starts on and verifies the
same ABI at its end; a mid-run rebuild (jest flipping better-sqlite3,
an npm run rebuild in a sibling) VOIDS the run — re-run whole, never
splice. Evidence: a mid-battery ABI flip produced 24 false VOIDs that
read as mutation outcomes. A battery that measured two ABIs measured
nothing.

## The ABI probe constructs, it does not require (WP-50)

`require('better-sqlite3')` resolves the module without loading the
native binding: a probe built on the require alone PASSES against a
tree built for the other ABI, and the mismatch surfaces on the next
call as WP-33b's mask. The probe must CONSTRUCT a Database. Sharpens
the WP-33b rule rather than replacing it.

## A guard conditions only on what its sentence claims (WP-50)

A template's guard may test only facts the sentence's own claim
depends on. WP-50 measured the cost: guard 2 carried `total > 0` while
neither class-2 sentence reads `{total}`, so a true sentence was
withheld from a real row on a fact it never states — and a withheld
sentence is invisible, which makes it worse than a false one, which
at least argues with the reader.

## Receipts are measured in the unit they name (WP-50)

`String.length` is UTF-16 code units; a "bytes" receipt taken that way
is wrong wherever the text carries em dashes, §, or any non-ASCII —
and the copy modules are full of them. Measure with `Buffer.byteLength`
or `wc -c`, and make the GENERATOR do it: WP-50 found three generators
printing character counts as bytes, and one of those figures had
already reached the record (WP-48's 6,168 for a 6,155-byte file).
Third member of the receipts family — pre-written, stale, wrong-unit —
and the only one that survives a re-paste, because re-pasting a wrong
unit reproduces it exactly.

## An announce is amended when the need is measured (WP-52)

A lock announce that turns out to be too narrow is amended ON THE BASE
at the moment the need is discovered, never corrected retroactively in
the merge report. A lock claimed at merge time is a claim no sibling
could have acted on, which is the whole purpose of announcing.

## pwd: the hazard is a compound command, not an hour (WP-52)

The documented form of the wrong-tree hazard is a `cd` from hours
earlier. WP-52's was FOUR COMMANDS earlier, inside a compound command
whose stated purpose was something else entirely — and it silently
substituted the primary's baseline for the worktree's. Re-anchor at
every measurement, not at every session. The tell remains the skipped
column: primary and worktree disagree by exactly ten in the
documented direction, so a baseline whose skipped count belongs to the
other tree is announcing itself.

## The poisoned cache has no fixed count (WP-52)

The recorded signature — exactly one unrelated suite failing to parse
— is not a rule about the number. WP-52's ninth occurrence broke TWO
suites because both import a file the packet had edited: the poisoned
entry was a shared dependency rather than a suite's own first line.
Read the shape (unrelated suites, parse-level failure, cleared by the
documented move), never the count.

## The wrong-unit rule binds the VERIFIER too (WP-52)

WP-50 fixed three copy generators printing characters as bytes; WP-52's
record verifier was still doing it one packet later, and its four
figures reproduced exactly as UTF-16 character counts. Note the shape:
a wrong-unit proof is INTERNALLY CONSISTENT — same unit throughout,
residual zero, every conclusion true — so nothing inside the proof can
reveal it. Only measuring the same objects with a second tool does.
Every harness that prints "bytes" measures bytes: `Buffer.byteLength`,
`wc -c`, `len(bytes)`. A verification script is a tool.

## Four-way verification guards the ancestor, not only the output (WP-52)

The check that the ancestor is an exact PREFIX of the merged blob is
not ceremony around the arithmetic — it is the only thing standing
between the operator and a wrong assumption about which blob the
ancestor IS. WP-52's rebuild took the amended lock announce as the
ancestor (the obvious choice; the branch was cut before the amendment
landed, so it is not a superset of it). The prefix check refused, and
`git merge-base` named the true one. A splice would have duplicated or
dropped the amendment silently, and `--stat` would have shown nothing.
When the prefix check refuses, the assumption is wrong — re-derive the
base, never adjust the arithmetic to fit.

## Cite the cause, not the precedent (WP-52)

The worktree↔primary skipped-column boundary was cited as "documented"
across three crossings before anyone measured WHY: `models/` carries
only the tracked `bge-small-en-v1.5` in a fresh worktree, while
`all-MiniLM-L6-v2-quantized` is untracked and exists in the primary
alone. A fact re-cited three times without a cause is a habit, not a
measurement — and habits are how a real regression gets waved through
as a known boundary.

## Derived is not the same as legible (owner's review, 2026-08-21)

Derived-never-authored stops the platform inventing facts. It does not
stop the platform speaking its own vocabulary at a person: "checks
dark", "the record's own health", "nothing written in scope" are all
true, all derived, and all unreadable by the user they address. Every
derived sentence must ALSO be sayable to someone who has never read
the record — where the internal noun has no plain equivalent, name the
thing the user recognises, not the structure that stores it. A
surface that is honest and incomprehensible has failed the same test
as one that lies, one step later.

## An agreement pin needs an anchor outside both derivations (WP-54)

An agreement pin asserts that two derivations of one fact match. It
cannot see an error that moves BOTH of them: WP-54's battery mutated
the ranker into ignoring the ratified class, display and rank agreed on
the same wrong number, and the mutant SURVIVED. Pair every agreement
pin with a companion that anchors the agreed value to a source outside
both — the ratified fixture, the law document, the record. Two things
agreeing is not evidence; two things agreeing WITH A THIRD is.

## A verbatim commit proves fidelity, not consistency (WP-51)

Committing a counterpart's artifact byte-perfect and verifying its md5
proves it matches what the SENDER sent. It says nothing about whether
it still honours what the RECORD has ruled. WP-51 found the ratified
fixture had silently reverted two amendments — WP-48's `gate === null`
and WP-50's dropped `total > 0` — in a file whose hash verified
perfectly, and the architect had committed it without noticing. Follow
every verbatim commit of a SHARED artifact with a ruled-content check:
every amendment the record has made to that file must still be
present, asserted mechanically, in the file's own `:check`.

## A pasted receipt is also a wrong-tree detector (WP-51)

The receipts rule is usually argued from fidelity. WP-51 shows the
second use: an addendum landed in the wrong checkout, and the commit
message carried a HAND-COMPUTED byte figure while the terminal's print
said something else. A pasted receipt puts the true number and the
wrong tree on the same screen; a hand-computed one hides the
discrepancy that would have named the mistake.

## An anticipatory pin is a hypothesis, not a guard (WP-51)

A pin written to catch a ruling that has not happened yet encodes an
assumption about the SHAPE that ruling will take. WP-48a's escalation
pin watched `causation`; the ruling produced a `correlation`, so the
pin never fired and its silence meant nothing. Keep the cases, amend
the header when the shape is known, and never read a quiet
anticipatory pin as confirmation that the thing it watches for did not
happen.

## Locks partition files; they do not partition types (WP-54)

WP-54 and WP-54a held provably disjoint file locks and collided anyway:
`SituationCopy` gained three required fields in one while a function in
the other predated them, and the merged tree would not compile. No
announce discipline could have seen it, because the announce names
paths. **Declare the SHAPES a packet changes — types, contract fields,
generated artifacts — in the lock announce alongside the paths.** And
note the good news in the failure: a type collision fails loudly at
compile time and cannot be shipped past, which is the best failure
mode available to a two-agent merge.

## Printing the cwd is not the control; branching on it is (WP-54)

The pwd rule's sharpest form, and it generalizes past pwd: a command
that PRINTS its working directory produces a receipt of the mistake,
readable after the commit has already run. A command that BRANCHES on
it refuses to run in the wrong tree. **A check that only prints is a
log; a check that can refuse is a guard** — the same family as the
battery's ANCHOR-MISS and the agreement pin's outside anchor. An
instrument that cannot fail is not an instrument.
