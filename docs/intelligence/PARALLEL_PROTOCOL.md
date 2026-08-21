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

## Hashes are piped, never typed (WP-51)

The receipts family gains its sharpest form. WP-51's merge-report
commit message carried a fabricated md5 — invented minutes after the
receipts rule was ruled, in the report that carries it — and the
analysis is why it survived long enough to commit: the byte figures in
the same message were genuine, and **the invented number was the only
figure nothing else on screen could contradict.** A byte count has
`wc -c` beside it; an opaque hash has no neighbour. Fabrication
survives precisely where nothing local can disagree. Pipe every hash
from the command that computes it; never transcribe one, and never
type one from memory of what it looked like.

## A watch item belongs at the code it warns about (WP-51)

Recording a watch item in WORK_PACKETS makes it findable by whoever
looks. Writing it at the rule it supersedes — in the source, beside
the decision it will overturn — makes it findable by whoever must.
WP-51 put the phase-1 heartbeat warning in `incidentProducer.ts` at
the rule phase 1 will supersede, so that packet's author meets it
where the decision lives rather than where it was filed.

## The base is measured by the packet that created it (2026-08-21, owner-directed)

A merged tree BECOMES the next packet's base, so the packet that
merged it has already measured exactly the tree the next packet would
re-measure. Re-running that suite is a second measurement of one
commit — ten minutes of wall clock for a number that already exists,
and a second chance to disagree with itself. WP-51's merge spent a
full scratch-worktree suite deriving 623/8,581, a figure WP-54a's
merge had already produced on the same tree.

**Every merge report publishes its merged-tree figures as the base's
own measurement**, in `docs/intelligence/base-measure.json`,
overwritten rather than appended (so a conflict is "take the newer
commit's", never a rebuild):

```json
{ "commit": "<sha>", "suites": 624, "tests": 8621, "passed": 8613,
  "skipped": 2, "tree": "primary" }
```

Two rules make it sound:

1. **The tree kind is part of the figure.** Primary and worktree
   differ by exactly ten in the skipped column (the untracked
   embedding model). A count without its tree kind is the ambiguity
   that made three packets narrate the boundary instead of asserting
   it.
2. **It is guarded, and it fails closed.** Before trusting it, the
   reading packet runs
   `git diff --name-only <measured-commit> HEAD -- src/ tests/ scripts/`.
   Empty ⇒ the measurement stands. Anything at all ⇒ re-measure. Docs
   commits land between merges constantly and move no test count; a
   code commit does, and this is the one command that tells them
   apart.

The two runs this does NOT remove are the two that earn their place:
the merged tree (a tree neither branch has tested) and the battery
(which has found a real defect in every packet this month).

## A scoring harness needs a control that fails when the harness is blind (WP-54a)

WP-54a's battery captured stdout only; jest writes its summary to
stderr INCLUDING ON SUCCESS. The run would have reported **21/21
killed** while measuring nothing — a perfect score read from silence,
indistinguishable from a perfect score read from evidence. The
green-baseline guard caught it: **the control that must PASS is what
exposes a harness that can only report perfection.** Every scoring
instrument needs one. Same family as ANCHOR-MISS, the agreement pin's
outside anchor, and printing-versus-branching: an instrument that
cannot fail is not an instrument.

## A producer that formats a fact into a sentence has thrown it away (WP-54a)

Fourth occurrence of one shape. The sentinel knew the run id and wrote
it into `payload.source` prose; the arming knew its scope and streamed
it to a renderer; the arming knew what it answered and recorded
nothing; `AgentRunner` computes `timeoutMs` and interpolates it into
"timed out after 300000ms". **A producer holding a fact at the moment
it emits must write the fact as a field, and may then also format it.**
Never the sentence alone — a consumer that must parse prose to recover
a number is a consumer the record has failed.

## When you edit a failing suite, identity is the receipt, not the count (WP-54a)

An unchanged count of inherited failures proves nothing if the packet
touched the suite producing them — the same number can be a different
set. Diff the failing test NAMES against the base and assert identity.

## Vacuous-guard shape #16 — indexing into a heterogeneous list (WP-56)

A pin that reads `parts[0]` asserted something true for one KIND of
member and vacuous for another: for an incident situation `parts[0]` is
a real event; for a session situation it is the synthetic run part,
which carries no `eventId`. The assertion named a string belonging to
nothing and held against the bug as well as the fix. **When a list's
members differ in kind, a pin selects by KIND, never by index** — and
if the kinds cannot be distinguished at the pin, that is the finding.

## A ruling can be unimplementable from the caller's shape (WP-56)

"Recorded on the run" was ratified, correct, and unsatisfiable where it
had to be called: a surface holding a `Situation` has no turn id
because `taskIds` lives on `SessionRow`. Neither the ruling nor the
review could see it; building the driven exhibit did, on its first run.
**A ruling states what must be true; only an exhibit shows whether the
caller can say it.** When a packet's ruling names a fact, the packet
verifies that fact is reachable from the shape that must supply it.

## The record merges by receipt, not by authorship (WP-54)

WP-54's merge conflicted the record where it always will: both halves
appended to the same tail. Theirs held two sections the ux branch had
never seen; ours held eighteen. Strict authorship chronology would have
interleaved them — WP-54's gate report belongs *before* the amended one
already on our side, and WP-54's staleness note belongs *after* it.

**That resolution is unverifiable, and the standard forbids it.** The
four-way check requires each half to appear as an exact substring
exactly once; splitting a half to interleave it destroys the only
property that proves nothing was lost. A merge whose correctness cannot
be demonstrated is not a merge, it is a retype with good intentions.

**So: the record is ordered by RECEIPT. A branch's sections arrive when
the branch merges, appended whole, after everything the base already
held.** Authorship chronology stays readable because every section
carries its own date in its header — which is why the dates are there.
The rebuild is `ancestor + ours_tail + theirs_tail`, in that order,
always, with no judgement exercised at the seam.

Receipts for this one: ancestor 1386076 · ours_tail 126116 (18 headers)
· theirs_tail 25491 (2) · architect appends 9651 (2) · rebuilt 1547334
(112 = 90+18+2+2) · residual 0 · markers 0.

## A resolution that keeps the code can still drop the law (WP-54)

The conflicted fixture was resolved by hand before it reached the
gate, and the resolution was almost right: it restored both ratified
guards — WP-48's `gate === null` and WP-50's dropped `total > 0` — so
every mechanical check on it would have passed. It also silently
deleted the two comment blocks that say WHY those guards read that way,
including a standing rule of the law that lived nowhere else in source:
**a guard may condition only on facts its sentence's claim depends on.**

The rule survived in the record, so nothing was lost outright. But it
stopped sitting at the code it governs, which is the failure the
watch-item rule already names — and the next packet to read that guard
would have found a bare expression with no argument attached, exactly
the condition under which WP-50's clause got added in the first place.

**A merge resolution in ruled territory is verified on the PROSE, not
only on the strings.** The guards are what a test can check; the
provenance is what stops the guard being re-broken. Both halves' unique
comment blocks are enumerated and shown to survive, by exact-substring
count, before the resolution is offered.

Measured here: working 16173 bytes, missing both blocks; restored
18631 with each block an exact substring of the wp-54 blob exactly
once; `node --check` clean; all six guards present and unchanged.

## Declare the SHAPES a packet changes, not only the paths (WP-54)

**Locks partition FILES; they do not partition TYPES.** WP-54 and WP-54a
held provably disjoint file locks and kept them perfectly — WP-54a
edited none of WP-54's eight named functions and WP-54 edited none of
WP-54a's — and the two still collided, because `SituationCopy` gained
three required fields in one packet while a function returning it was
written in the other. No announce discipline could have seen it: both
announces named paths, and paths were not where the collision was.

What saw it was the TYPE SYSTEM, at compile time, loudly, in a form
nothing could ship past, with the badge/row equality pin standing
behind it as the second net. That is the good outcome, and it is worth
naming as one: a merge that will not compile is a merge that cannot
silently lose half a packet.

So a lock announce now declares the shapes as well as the paths — an
interface a packet widens, a union it extends, a required field it
adds. A sibling reading "adds three required fields to `SituationCopy`"
knows to check every function that returns one; a sibling reading
"holds `sessionRegistry.ts`" does not.

## An instrument that cannot fail is not an instrument (WP-54)

WP-52's version of the pwd rule said re-anchor at every measurement.
WP-54's sharpening names why a printed anchor is not an anchor:
**"The command printed `pwd`; I read it after the commit had run.
Printing the cwd isn't the control; branching on it is."**

**A check that only prints is a log; a check that can refuse is a
guard.** The same family runs through this protocol already — the
battery's ANCHOR-MISS, which fails rather than reporting a survivor;
the agreement pin's outside anchor, without which both derivations can
agree on one wrong number (WP-54 measured that: a mutation making the
ranker ignore the ratified class SURVIVED an agreement pin, because
display and rank still agreed); `:check` failing closed on a stale
artifact. Ask of every instrument: what input makes this refuse? If
there isn't one, it is documentation.

**Its first application beyond the pwd case, in the same packet:** two
ruled guard amendments were silently reverted when a designer's new
sheet replaced a fixture wholesale, and nothing caught it — the
generator checked ids, fields and slots and had no opinion about a
guard's CONTENT. A ruling recorded only in `WORK_PACKETS.md` survives
exactly as long as the next person's memory. `RULED_AMENDMENTS` in
`scripts/generate-situation-copy.ts` is the guard that now refuses it,
and its own test drives both directions rather than asserting it exists.

## An append written into a conflicted file is on neither side (WP-54)

Two adjudications, 9,651 bytes, were appended to `WORK_PACKETS.md` while
the file held live conflict markers. The merge was then resolved
correctly — three blobs, receipt order, four-way verified — and the
appends went out with the markers, because a rebuild reads the ANCESTOR,
OURS and THEIRS blobs and the working file is none of those. Every
check passed. The record lost two rulings and the byte arithmetic
reconciled exactly, because it was reconciling the wrong three numbers.

**While a merge is in progress, the record is not writable.** An
adjudication written during a hold goes to a file of its own and is
appended after the merge commits, or it is written to a working file
that the correct resolution is guaranteed to discard.

For the resolver: the rebuild is `ancestor + ours_tail + theirs_tail`,
and if the working file is LARGER than that sum, the excess is somebody's
uncommitted text. Measure the residual before discarding it. A residual
of zero is the proof; a positive residual is a question, not a rounding.

## Vacuous shape #17 — a guard that subtracts its own exception before reading

`RATIFIED_IDS` was compared against the emitted ids with the deferred
class already filtered out, so the guard could not see the class it was
deferring. The deferral's exit condition — "the host fields WP-55 adds"
— lived in a string, was announced once on stdout, and was tested by
nothing. Deleting the deferral is what makes the class ship, and nothing
fails if nobody does.

**Skipping loudly is not failing closed.** A deferral states a condition
under which it ends; the check that reads it PROBES that condition, or
the deferral is permanent by construction and the announcement is a
comment with a stack trace's self-regard.

## An instrument is described by what it measures (WP-54)

`RULED_AMENDMENTS` was reported as failing the build "on any future
reversal". It fails on a reversal that changes a substring of the guard
text — which is the reversal that happened, so the instrument is right.
The claim is wider than the measurement, and a wider claim is how the
next reader stops looking for the gap the instrument leaves.

Same line, same rule as the receipts: **state the measurement, then the
protection it buys, and never the second in place of the first.** A
histogram assembled from two fleets is labelled with both, on the line
that carries the numbers, not in the paragraph after it.

## A battery belongs in a worktree (WP-54 merge)

A mutation battery polls `git status` between every mutation — that is
how its pristine check and its ANCHOR-MISS verdict work. An architect
writing `WORK_PACKETS.md` in the same checkout is therefore racing it.
Measured across WP-54's merge: three stale zero-byte `.git/index.lock`
files and two runs ending `ALARM: tree is NOT pristine after the
battery` on runs whose mutations were all sound.

Both ALARMs were arguable — the modified files were markdown no suite
reads, provably outside the battery's own write set, which its
`MUTATIONS` table names. Neither was argued, because the rule directly
above this one says an instrument that cannot fail is not an
instrument, and the first time the harmless case is exempted is the
last time the check means anything.

**Run the battery in a worktree cut at the commit under test**, where
nothing else writes. Same isolation, and the same reason, as a packet's.

## A mechanism its author carries is still memory (WP-54)

The pwd hazard fired three times in one day, twice after its own rule
was written into this file, once while committing that rule to the wrong
worktree. The packet's answer was right and is ratified: **a rule its
own author cannot follow from memory needs a mechanism, and the third
occurrence is the evidence.**

The mechanism it built was a two-line guard in the prologue of each
writing command — which protects one operator in one session and nobody
else. **A guard that travels with the person is a habit with better
spelling.** A guard in the repository is the mechanism.

The test: could the next agent, starting cold on a fresh clone, violate
this rule? If yes, the rule is still enforced by memory — somebody
else's. `.githooks/pre-commit` is versioned and `core.hooksPath` already
points at it, so this repository's answer to any refusal that can be
mechanised is four lines in a file that already runs everywhere.

And the general form, for every rule in this document: each one is
currently enforced by an agent remembering to read it. That is
acceptable for judgement and unacceptable for venue, identity and
arithmetic — the three kinds of failure that recur, because they are the
kinds a careful reader still commits while reading carefully.

## Locks partition files; they do not partition arithmetic (WP-54 / WP-56)

Both locks were kept perfectly. WP-54 held `sessionRegistry.ts` and
edited `listVerdict` to add a term for rows the fold does not hold.
WP-56 stayed off the file, cut from an earlier base, and rewrote the
same function to subtract deferred rows. Neither branch has a test where
both terms are non-zero, so **every test passes under the resolution
that silently drops one of them.**

A file lock is an exclusion on WRITES. It says nothing about two packets
computing the same quantity, and the merge presents the newer body as
the obvious resolution precisely when the older one carried a term the
newer author never saw.

**A packet that changes the meaning of a shared quantity — a count, a
sum, an identity, a sort key — announces the QUANTITY, not only the
file.** The announce names the expression before and after. Two packets
announcing the same quantity is a sequencing decision for the architect,
and it is cheap; discovering it at the merge is not.

The tell for the resolver: **a signature that differs between the two
branches is a contract change, and a contract change never resolves by
choosing the better-commented body.** Write the merged expression out as
a sentence first, then make both bodies satisfy it.

## Vacuous-guard shape #16 — indexing into a heterogeneous list (WP-56)

A pin that reaches for `list[0]` when the list's members differ IN KIND
selects whichever kind happens to be first, not the kind the assertion
is about. WP-56's XD-28 pin read `situation.parts[0]` to get "a part
with an id a deferral could name" — but `parts[0]` is always the
synthetic `kind: 'run'` part, which carries NO `eventId`. The pin fell
back to a fabricated string belonging to nothing, and the mutation that
widened the deferral lookup to part ids SURVIVED: the assertion was
true against the bug and against the fix, because its subject was
absent from both.

**Where members differ in kind, a pin selects BY KIND, never by index** —
`parts.find(p => p.kind === 'outcome' && p.eventId)` — and then asserts
the subject exists before asserting anything about it. Same family as
shape #15 (a green assertion over an absent subject), reached from the
other direction: #15's subject was never emitted, #16's was never
selected.

The tell at battery time is identical in both: a survivor whose
mutation sits inside a function the tests visibly "cover".

## A ruling states what must be true; only an exhibit shows whether the caller can say it (WP-56)

Cycle two ruled that a deferral is "recorded on the run". The producer
took a `taskId`, the fold read `correlation`, every test passed, and
review found nothing — because every test supplied the taskId it was
testing with. **The first run of the acceptance exhibit printed a
deferral with no correlation**, and the cause was a shape nobody had
looked at from the caller's side: a surface holding a `Situation` has a
situation id and no turn id, because `taskIds` lives on `SessionRow`,
which the triage view does not hand over. The rule was unsatisfiable
from the only shape the caller has.

A ruling is a claim about the world; a test is a claim about a function;
**an exhibit is the only one of the three that has to find the caller.**
Where a rule says a record must carry a fact, the exhibit that drives it
end to end is not decoration on the gate report — it is the only
instrument that asks whether the fact was reachable from where the call
is actually made.

Corollary, and it is why this earns a rule rather than a note: the
defect was invisible to review, to types, and to a full mutation
battery. Nothing that reads the code can see a field the caller never
had.

## A turn that mixes absolute and relative paths is writing to two trees (WP-56)

An absolute-path Edit and a relative-path shell edit ran in the same
turn, with the shell anchored in a different checkout. Both commands
were correct about their own venue. The TURN was not, and one logical
change landed in two trees.

**Printing the cwd cannot catch this** — the cwd was true for the
command that printed it. The rule is upstream of the venue guard: **a
single logical change uses one addressing mode throughout.** Absolute
everywhere, or relative everywhere with the venue asserted once.

The tell, recognised late: a compiler error about a symbol you can see
with your own eyes. `TS2305` on an export that demonstrably exists means
the compiler and the author are reading different trees, and the next
move is `git status` in both, not a rebuild.

## A contract shape can be right and still be the wrong number to read (WP-56)

`TriageView.counts.needsYou` was ratified at the gate and is correct.
Reading it into the rail badge would still have been a regression,
because the badge is about a LONGER list — the unheld Inbox rows exist
only in the renderer, and the host cannot count what it cannot see.

Ratifying a shape ratifies the shape. **It does not rule that every
consumer should read it**, and a consumer whose list differs from the
producer's is the two-sources defect wearing the contract's clothes.

Where two surfaces count overlapping sets, neither reads the other's
total: they are tied by a PINNED IDENTITY stating the difference
exactly — here `arrivalCounts().needsYou === triage.counts.needsYou +
<escalating unheld>`. The identity is the artifact that fails when one
side drifts; a shared number is the artifact that quietly agrees.

## A deferral states a condition; the check that reads it must probe that condition (WP-55)

Vacuous shape #17 — *a guard that subtracts its own exception before
reading* — is closed, and the closing move generalises beyond the one
guard it was found in.

`RATIFIED_IDS` was compared against `ids.filter(id => !(id in
DEFERRED_IDS))`. The deferral was subtracted before the guard read it, so
the guard could not see the class it deferred. The exit condition —
*"host fields nothing derives yet — WP-55 adds them"* — lived in a
string, was announced by one `process.stdout.write`, and was tested by
nothing.

**Skipping loudly is not failing closed.** A `stdout` line is a courtesy
to whoever is watching a build; it is not an instrument, because nothing
reads it and nothing fails on it.

The pattern that fixes it: **a deferral records a condition, and the
check probes that condition.** Here the condition is mechanically
checkable — a class is deferred because it carries a slot the product
cannot fill, and `KNOWN_SLOTS` is the registry of slots it can fill — so
`assertDeferralsStillHold` throws when every slot a deferred class
carries has become fillable. It is driven in BOTH directions by its own
test, because a refusal that only ever passes is not a refusal.

The same mechanism now applies one level down, to a deferred BLOCK KEY
(`DEFERRED_BLOCK_ENTRIES`), which is how `HEALTH.loud` is withheld
without being forgotten.

Generalisation worth keeping: **any exception with a stated end
condition needs a check that can observe that condition.** An exception
whose end is a sentence in a comment ends when someone remembers it.

## A fixture that varies the wrong field is a fixture the producer cannot emit (WP-55)

`sessionRegistry.test.ts` drove "four uncorrelated incidents on one site"
with four events sharing ONE `fact` (`ABS-0x`) and four different
`symptom`s. That shape is unreachable: `recordSentinelIncidents` keys
`history.open` on `incidentKey(component, fact)` and refuses the second,
third and fourth as already open. Measured on the owner's real ledger
the four carry four DISTINCT facts — `ABS-04`, `ABS-05`, `ABS-07`,
`FS-01`.

The fixture passed for months because nothing read `fact`. It failed the
moment the fold adopted the producer's own identity, and the failure
looked like a regression in the change rather than a defect in the
fixture. **Before editing a red fixture, check it against the producer
that would have written it** — the count it asserts can be right for the
wrong reason.

## A threshold expressed as a fraction of the file measures the wrong thing (WP-55)

`situationHeadlines.test.ts` guarded its comment-stripping regex with
`expect(source.length).toBeGreaterThan(raw.length / 3)` — an anti-vacuity
check against an over-greedy strip that had emptied `source`.

It does not measure greediness. It measures COMMENT DENSITY, and it
fails as a file gets better documented. Measured on `sessionRegistry.ts`
2026-08-21: 181,966 raw characters, 60,355 of executable text — **66.8%
comment**, which is what this subsystem's doc discipline produces, and it
tripped the guard.

An absolute floor measures the thing the check is about: a strip that ate
the file leaves nothing, not 60kB. **A threshold relative to a quantity
the change is expected to move is a threshold that fires on the change
rather than on the fault.**

## The venue guard is in the repository now (WP-55)

`.githooks/commit-msg` refuses a commit whose conventional-commit scope
names one packet (`docs(wp-56): …`) inside a worktree checked out for
another (branch `wp-32`) — the observed failure, exactly. It does not
gate the base branch (every packet's merge report is committed there), it
does not read the body (a citation is not a venue claim), and
`--no-verify` is named in its own output.

**It is `commit-msg`, not `pre-commit`, and the correction is disclosed
rather than silent.** The ruling named `pre-commit` because that file is
already wired; `pre-commit` is never handed the message, and the message
is the only place the intended packet is written down. `core.hooksPath`
points at the whole `.githooks` directory, so `commit-msg` is wired by
the same setting at the same cost — and can read the fact it gates on.

Driven by `tests/unit/build/venue-guard.test.ts`, which executes the hook
directly with a branch supplied through the environment. A guard that can
only be exercised by constructing the failure it prevents is a guard
nothing checks.
