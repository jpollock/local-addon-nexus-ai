#!/usr/bin/env python3
"""
WP-30 · the mutation battery — the session registry, one rule at a time.

Every rule this packet lands is mutated in the PRODUCTION file, with the lie it
would ship named beside it. The subject is `sessionRegistry.ts` and nothing
else: the pins live in one unit suite and one eval probe, and a mutation that
neither notices is a pin that is decorative.

Six families, matching the fold's own structure:

  1. **Session identity** — the run key, the derived id, what counts as a turn.
     These decide WHICH session a fact belongs to, and getting them wrong is how
     one run's approval becomes another's (WP-36, one level up).
  2. **The terminal cut** — the rule the EVAL found, not this file. Without the
     denial cut a freshly-armed run folded into an unrelated denied one and its
     pending gate vanished out of the waiting column. Both cut arms and the
     deliberate NON-cut (a halt is recoverable) are mutated here.
  3. **The gate** — J-Return's WHERE. Which checkpoint, at which position,
     awaiting what.
  4. **The consequence order** (moments-model 1.3 §4a) — both T1 arms, the
     column split, and all three comparator keys.
  5. **The reserved slot** (tear 3) — one folded row, and what may be in it.
  6. **Places, parts and the cursor** — the derivations a surface renders.

HARNESS INHERITED FROM WP-44/WP-45, not rewritten, because its mechanics carry
four findings that cost earlier packets real time:

  - `--no-cache`, always (WP-31: a poisoned ts-jest cache can mask a mutation as
    a FALSE SURVIVAL, so a witness credited from a cached run is not credited).
  - COUNT-FLOORED: a mutant that reduces the executed count is VOID, not green.
  - BOTH summary lines parsed (WP-43: a mutant that breaks compilation
    contributes zero tests, and a battery reading only `Tests:` files the
    clearest kills in the set as unmeasurable).
  - The tree verified PRISTINE before and after, with the untracked SET compared
    rather than required empty (WP-34's kill form, and WP-43's own fix).

Explicit argv throughout; no shell string is ever built from a variable.
"""
import subprocess
import sys
import re

# Measured from the pristine baseline this battery prints before it runs, not
# guessed. A mutant that executes fewer than this many tests is VOID.
FLOOR = 400

SUITES = [
    # WP-30's own unit suite — the fold, the query surface, the golden fixture.
    "src/main/intelligence-host/__tests__/sessionRegistry.test.ts",
    # The eval harness, because three J-Return criteria and one J-Refusal
    # must-not are now DRIVEN off this fold rather than statically BLOCKED.
    "tests/intelligence-evals/checks.test.ts",
    "tests/intelligence-evals/probes.test.ts",
    "tests/intelligence-evals/runner.test.ts",
    # The two folds this one reuses rather than re-implements. A mutation here
    # that changed their behaviour instead of the registry's would show up as a
    # kill in the WRONG suite, and this is how that stays visible.
    "src/main/intelligence-host/__tests__/procedureCursor.test.ts",
    "src/main/intelligence-host/__tests__/procedureView.test.ts",
]

REG = "src/main/intelligence-host/sessionRegistry.ts"

# (id, file, find, replace, the lie it would ship)
MUTATIONS = [
    # --- family 1: session identity ----------------------------------------
    ("M01", REG,
     "    const key = `${turn.capability}@${turn.hash}`;",
     "    const key = `${turn.capability}`;",
     "an EDITED runbook's run folds into the run of the document it replaced, and checkpoints "
     "attested against text nobody is following read as this run's progress"),
    ("M02", REG,
     "      id: `sess_${turn.taskId}`,",
     "      id: `sess_${turn.capability}`,",
     "the session id stops being per-RUN: two sequential runs of one runbook collide on one id, "
     "so a re-entry opens whichever the fold happened to emit last"),
    ("M03", REG,
     "  if (procedure.status !== 'delivered') return undefined;",
     "  if (procedure.status === 'never') return undefined;",
     "a REFUSED delivery counts as a turn of the run — the actor was told to stop following the "
     "document and the registry records them as having followed it"),
    ("M04", REG,
     "    taskIds: [...candidate.taskIds],\n  };\n\n  let events: EventEnvelope[];",
     "    taskIds: candidate.taskIds.slice(-1),\n  };\n\n  let events: EventEnvelope[];",
     "the run loses every turn but its last, so an approval given on turn 1 reads as never given "
     "— the exact defect WP-20d's run-scoped fold exists to prevent"),

    # --- family 2: the terminal cut (the eval's finding) --------------------
    ("M05", REG,
     "    if (!complete && !denied) continue;",
     "    if (!complete) continue;",
     "THE DEFECT THE EVAL FOUND: a denied run absorbs the next run at the same key, the fresh "
     "run inherits the denial, and its pending gate disappears from the waiting column"),
    ("M06", REG,
     "    const denied = state.denied.length > 0;",
     "    const denied = state.denied.length > 99;",
     "same lie as M05, entered through the derivation rather than the branch"),
    ("M07", REG,
     "    if (!complete && !denied) continue;",
     "    if (!denied) continue;",
     "a COMPLETED run absorbs the next run at the same key — run 2's row shows run 1's outcomes "
     "and run 1's consent"),
    ("M08", REG,
     "  if (payload.resolved === true) return false;",
     "  if (payload.resolved === false) return false;",
     "a CLOSED incident holds its run halted forever and an open one is ignored — the retry that "
     "cleared the halt is recorded and then disbelieved"),

    # --- family 3: the gate — J-Return's WHERE ------------------------------
    ("M09", REG,
     "  const activeIndex = states.findIndex((s) => s.status === 'active');",
     "  const activeIndex = states.findIndex((s) => s.status === 'pending');",
     "the row names a step the run has not reached instead of the one it is standing at"),
    ("M10", REG,
     "    index: activeIndex + 1,",
     "    index: activeIndex,",
     "\"approval gate 3 of 8\" is off by one — a position a person holds in their head, wrong"),
    ("M11", REG,
     "      checkpoint.attest === 'event' && checkpoint.evidence?.topic === RATIONALE_RECORDED_TOPIC\n"
     "        ? 'approval'\n        : 'evidence',",
     "      checkpoint.attest === 'event' && checkpoint.evidence?.topic === MANIFEST_TOPIC\n"
     "        ? 'approval'\n        : 'evidence',",
     "a consent gate stops saying it needs a HUMAN — the row says the platform is waiting on "
     "evidence when it is waiting on you"),

    # --- family 4: the consequence order (§4a) ------------------------------
    ("M12", REG,
     "  if (row.outcomes.writeLanded) {",
     "  if (row.outcomes.writeLanded && false) {",
     "T1's write-landed arm dies: a part-changed fleet ranks below an untouched one, which is the "
     "asymmetry the whole order is built on"),
    ("M13", REG,
     "  if (deadline) {",
     "  if (deadline && false) {",
     "§4a's second T1 arm dies — a gate with a derivable deadline sorts as though delay were free"),
    ("M14", REG,
     "    if (a.tier !== b.tier) return a.tier - b.tier;",
     "    if (a.tier !== b.tier) return b.tier - a.tier;",
     "the order inverts: finished work outranks a half-changed production fleet"),
    ("M15", REG,
     "    const place = placeRank(b.places.highest) - placeRank(a.places.highest);",
     "    const place = placeRank(a.places.highest) - placeRank(b.places.highest);",
     "place inverts — a local copy sorts above production inside the same tier"),
    ("M16", REG,
     "    if (a.since !== b.since) return a.since < b.since ? -1 : 1;",
     "    if (a.since !== b.since) return a.since < b.since ? 1 : -1;",
     "newest first: the fourteen-hour halt sinks under the thing that happened a minute ago"),
    ("M17", REG,
     "  const column: TriageColumn = row.status === 'complete' ? 'changed' : 'waiting';",
     "  const column: TriageColumn = row.status === 'complete' ? 'waiting' : 'waiting';",
     "the two columns collapse into one — Return's 'one moment, two columns' ruling, undone"),
    ("M18", REG,
     "      tier: 4,\n      tierReason: `the run is complete under",
     "      tier: 2,\n      tierReason: `the run is complete under",
     "a finished run ranks as though it were awaiting consent, and outranks it on age"),

    # --- family 5: the reserved slot (tear 3) -------------------------------
    ("M19", REG,
     "  const counted = report.lines.filter((line) => line.countsTowardWorst !== false);",
     "  const counted = report.lines;",
     "a source that was NEVER IN USE here reads as going blind — a machine with no WP Engine "
     "account is told the record is failing, forever"),
    ("M20", REG,
     "    .filter((line) => line.verdict === 'DARK')",
     "    .filter((line) => line.verdict !== 'OK')",
     "reporting-late is promoted to going-blind, and the one line a user is guaranteed to see "
     "overstates what it knows"),

    # --- family 6: places, parts, the cursor --------------------------------
    ("M21", REG,
     "  const highest = distinct[0] ?? null;",
     "  const highest = distinct[distinct.length - 1] ?? null;",
     "the LOWEST-consequence place orders the row — 'touches local on 1 of 5' on a run that "
     "touched production"),
    ("M22", REG,
     "  const atHighest = highest ? tokens.filter((t) => t === highest).length : 0;",
     "  const atHighest = highest ? tokens.length : 0;",
     "'touches production on 5 of 5' when two of the five are local — the rendered fact stops "
     "coming from the numbers the sort used"),
    ("M23", REG,
     "  const owner = incident.correlation ? sessionByTask.get(incident.correlation) : undefined;",
     "  const owner = undefined;",
     "causal coalescing dies: the halt, its failing verify and its incident become three adjacent "
     "rows describing one situation from three angles, and the situation appears in none of them"),
    ("M24", REG,
     "  for (const failure of row.outcomes.failed) {",
     "  for (const failure of row.outcomes.failed.slice(0, 0)) {",
     "the failing verify stops being a part of the situation — the row cannot expand to the "
     "record that caused it"),
    ("M25", REG,
     "        sessions: snapshot.sessions.filter((row) => row.lastEventId > cursor),",
     "        sessions: snapshot.sessions.filter((row) => row.lastEventId <= cursor),",
     "changedSince returns exactly what did NOT change — a poller sees stale rows and misses "
     "every live one"),
    ("M26", REG,
     "        cursorUnknown: !!oldest && cursor < oldest && snapshot.horizon.truncated,",
     "        cursorUnknown: false,",
     "a cursor older than the retained ledger poses as a delta, so a full re-read is reported as "
     "'nothing else moved'"),
]

# A change with no behavioural content. It proves the harness edits, restores,
# and does not manufacture kills from the act of writing the file.
CONTROL = (REG,
           "/** The query surface. M6's IPC handlers call these; nothing else does. */",
           "/** The query surface. M6's IPC handlers call these; nothing else does. (control) */")


def run(argv):
    return subprocess.run(argv, capture_output=True, text=True)


def tracked_changes():
    """Modifications to TRACKED files — what a leftover mutation looks like."""
    return [l for l in run(["git", "status", "--porcelain"]).stdout.splitlines()
            if not l.startswith("??")]


def untracked():
    return sorted(l for l in run(["git", "status", "--porcelain"]).stdout.splitlines()
                  if l.startswith("??"))


def pristine_report(before=None):
    """
    Pristine, stated precisely rather than as `git status` being empty.

    Refuse to run over somebody's edits, and prove afterwards that every
    mutation was restored (WP-34: a battery killed mid-mutation skips its
    `finally` and leaves the mutant on disk). Untracked files are compared as a
    SET rather than required empty — a generator-style leftover that writes a
    NEW file is still caught, and what is being ignored is printed.
    """
    changed = tracked_changes()
    now = untracked()
    if changed:
        return False, "tracked files are modified:\n" + "\n".join(changed)
    if before is not None and now != before:
        appeared = [f for f in now if f not in before]
        vanished = [f for f in before if f not in now]
        return False, f"the untracked set moved — appeared {appeared}, vanished {vanished}"
    if now:
        print(f"  (ignoring {len(now)} untracked file(s), unchanged across the run: "
              + ", ".join(f.removeprefix('?? ') for f in now) + ")")
    return True, ""


def nul_sweep():
    """
    WP-25's non-printing-character rule, run as a gate rather than as advice.

    This packet found a literal NUL in its own freshly authored source — it
    passed tsc, eslint and 48 tests, and announced itself only by making grep
    call the file binary. A battery that mutates a file by byte-replacement is
    the natural place to notice one, so it checks before it starts.
    """
    dirty = []
    for path in {m[1] for m in MUTATIONS}:
        data = open(path, "rb").read()
        bad = sorted({b for b in data if b < 9 or 11 <= b <= 12 or 14 <= b <= 31 or b == 127})
        if bad:
            dirty.append((path, bad))
    return dirty


def jest():
    """
    Returns (testsFailed, suitesFailed, testsTotal, output).

    BOTH lines are parsed (WP-43): a mutant that breaks the type check
    contributes zero tests, and reading only `Tests:` files the clearest kills
    in the set as unmeasurable. Each pattern is line-anchored and parses a
    NUMBER rather than matching a token, so no summary line can satisfy it by
    containing it (WP-32's substring finding).
    """
    argv = ["npx", "jest", "--no-cache", *SUITES]
    r = run(argv)
    text = r.stdout + r.stderr
    suites = re.search(r"^Test Suites:\s+(?:(\d+) failed, )?", text, re.M)
    tests = re.search(r"^Tests:\s+(?:(\d+) failed, )?(?:(\d+) skipped, )?(\d+) passed, (\d+) total",
                      text, re.M)
    if not tests:
        return None, None, None, text
    return int(tests.group(1) or 0), int(suites.group(1) or 0) if suites else 0, int(tests.group(4)), text


def mutate(path, find, replace):
    src = open(path).read()
    if src.count(find) != 1:
        return None, src.count(find)
    open(path, "w").write(src.replace(find, replace))
    return src, 1


def restore(path, original):
    open(path, "w").write(original)


def main():
    dirty = nul_sweep()
    if dirty:
        print(f"REFUSING: non-printing characters in source — {dirty}")
        return 2

    before_untracked = untracked()
    ok, why = pristine_report()
    if not ok:
        print(f"REFUSING: tree is not pristine before the battery — {why}")
        return 2

    failed, suitesFailed, total, _ = jest()
    print(f"PRISTINE BASELINE: {failed} failed / {total} total, {suitesFailed} suites failed (floor {FLOOR})")
    if failed != 0 or suitesFailed != 0 or total < FLOOR:
        print("REFUSING: baseline is not green at or above the floor.")
        return 2

    results = []
    for mid, path, find, replace, lie in MUTATIONS:
        original, n = mutate(path, find, replace)
        if original is None:
            results.append((mid, "ANCHOR-MISS", f"{n} matches", lie))
            print(f"{mid}  ANCHOR-MISS ({n} matches) — {path}")
            continue
        try:
            f, sf, t, _ = jest()
        finally:
            restore(path, original)
        # Order matters: RED first, then the floor. A suite that failed to
        # compile is a kill, and it also drops the executed count — checking
        # the floor first would file it as unmeasurable.
        if t is None:
            verdict, detail = "VOID", "no test summary parsed"
        elif (f and f > 0) or (sf and sf > 0):
            verdict, detail = "KILLED", f"{f} tests / {sf} suites failed"
        elif t < FLOOR:
            verdict, detail = "VOID", f"green but executed {t} < floor {FLOOR}"
        else:
            verdict, detail = "SURVIVED", f"{t} passed"
        results.append((mid, verdict, detail, lie))
        print(f"{mid}  {verdict:<11} {detail:<22} {lie}")

    path, find, replace = CONTROL
    original, n = mutate(path, find, replace)
    if original is None:
        print(f"CONTROL  ANCHOR-MISS ({n} matches)")
    else:
        try:
            f, sf, t, _ = jest()
        finally:
            restore(path, original)
        ok = (f == 0 and sf == 0 and t is not None and t >= FLOOR)
        print(f"CONTROL  {'SURVIVED (correct)' if ok else 'KILLED (BATTERY IS WRONG)'}  {f} failed / {t} total")

    ok, why = pristine_report(before_untracked)
    if not ok:
        print(f"ALARM: tree is NOT pristine after the battery — {why}")
        return 2

    killed = sum(1 for r in results if r[1] == "KILLED")
    print(f"\nTREE PRISTINE AFTER. {killed}/{len(results)} killed.")
    for mid, verdict, detail, lie in results:
        if verdict != "KILLED":
            print(f"  !! {mid} {verdict} ({detail}) — would ship: {lie}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
