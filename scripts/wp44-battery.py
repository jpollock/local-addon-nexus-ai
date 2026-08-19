#!/usr/bin/env python3
"""
WP-44 · the mutation battery.

Every rule the Govern matrix lands, mutated one at a time, with the lie it
would ship named beside it.

THE HARNESS IS WP-43'S, REUSED RATHER THAN REWRITTEN. Its mechanics carry four
findings that cost earlier packets real time, and re-deriving them would be how
one gets dropped:

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

FLOOR = 115

SUITES = [
    "src/main/intelligence-host/__tests__/governMatrix.test.ts",
    "tests/unit/renderer/governMatrix.test.tsx",
    "tests/unit/renderer/governDoorPath.test.tsx",
    # The two suites that own capabilityGrants.ts, because this packet added a
    # reader to it. A mutation there must be caught by ITS owners, not only by
    # the surface that consumes it.
    "src/main/intelligence-host/__tests__/capabilityGrants.test.ts",
    "src/main/intelligence-host/__tests__/capabilityDenyFlip.test.ts",
]

SEAM = "src/main/intelligence-host/governMatrix.ts"
GRANTS = "src/main/intelligence-host/capabilityGrants.ts"
VIEW = "src/renderer/components/settings/GovernSection.tsx"

# (id, file, find, replace, the lie it would ship)
MUTATIONS = [
    # --- the gates column: the ratified property ---------------------------
    ("M01", SEAM, "  return checkpoint.attest === 'event' || checkpoint.attest === 'manifest';",
     "  return checkpoint.attest !== 'narrative';",
     "attestable becomes 'anything not narrative' — a class added tomorrow silently counts as provable"),
    ("M02", SEAM, "    attestable: runbook.checkpoints.filter(isAttestable).length,",
     "    attestable: 0,",
     "EVERY row says the grant gates itself and nothing after it — the anchor's four real attestations erased"),
    ("M03", SEAM, "  if (gates.attestable === 0) {",
     "  if (gates.attestable < 0) {",
     "the four attestation-free runbooks render '0 of 5 checkpoints the platform can verify' — the finding, softened into a statistic"),
    ("M04", SEAM,
     "      `All ${gates.checkpoints} checkpoints are narrative — the platform can verify none of them, ` +\n"
     "        'so nothing downstream of this grant is provable.',",
     "      `All ${gates.checkpoints} checkpoints are narrative.`,",
     "THE SOFTENING THE RULING FORBADE: the consequence is dropped and only the count survives"),
    ("M05", SEAM, "  const narrative = gates.checkpoints - gates.attestable;",
     "  const narrative = 0;",
     "the anchor stops saying that 4 of its 8 checkpoints are on the agent's account only"),
    ("M06", SEAM, "      `${gates.steps} steps, none of them a checkpoint.`,",
     "      `${gates.steps} of ${gates.steps} checkpoints the platform can verify.`,",
     "a GUIDED document claims checkpoints it does not have, and claims they are all verifiable"),

    # --- the row set -------------------------------------------------------
    ("M07", SEAM, "  const rows = runbooks.runbooks().map((rb): GovernRow => {",
     "  const rows = runbooks.runbooks({ strictness: 'strict' }).map((rb): GovernRow => {",
     "THE HIDDEN ROWS: both guided capabilities vanish from the matrix and cannot be granted or seen"),

    # --- the five states ---------------------------------------------------
    ("M08", SEAM, "  if (isGranted) return source === 'settings' ? 'granted-by-you' : 'materialized';",
     "  if (isGranted) return 'materialized';",
     "a grant a PERSON made reads as one the migration made — their act erased from the row"),
    ("M09", SEAM, "  if (disarmReason === 'hash-mismatch' || disarmReason === 'runbook-unavailable') return 'disarmed';",
     "  if (disarmReason) return 'disarmed';",
     "RULING 3 INVERTED: a user's own switch-off renders as disarmed, so the switch stays ON for a capability they just switched off"),
    ("M10", SEAM, "  return requiresExplicitGrant(capability) ? 'never-by-default' : 'denied';",
     "  return 'denied';",
     "the production capabilities read as ordinarily denied — the mandate becomes a quiet absence"),
    ("M11", SEAM, "      consent: state === 'materialized' || state === 'granted-by-you' || state === 'disarmed',",
     "      consent: state === 'materialized' || state === 'granted-by-you',",
     "the disarmed row's switch renders OFF — the platform quietly revoking on the user's behalf"),
    ("M12", SEAM, "      inForce: !!grant,",
     "      inForce: state !== 'denied',",
     "a DISARMED capability reports as in force — the integrity failure rendered as working"),

    # --- the document column -----------------------------------------------
    ("M13", SEAM, "  return doc.mismatch ? `${base} — no longer matches` : base;",
     "  return base;",
     "the document column hides the hash mismatch, where a reader checks it against the file"),
    ("M14", SEAM, "  return `${algo}:${digest.slice(0, 10)}`;",
     "  return `${algo}:${digest.slice(0, 4)}`;",
     "the pin is shortened past the point of identifying a document"),

    # --- the act -----------------------------------------------------------
    ("M15", SEAM, "      ? { capability, enabled: true, runbookId: rb.id, runbookHash: rb.hash }",
     "      ? { capability, enabled: true, runbookId: rb.id }",
     "A GRANT THAT PINS NOTHING: the disarmed state becomes unreachable and a document can change under a standing grant"),
    ("M16", SEAM, "    syncCapabilityGrants({ core, storage, logger: { ...logger, warn: logger.info } });",
     "",
     "the act writes settings and announces NOTHING — a widening with no control event, invisible in the ledger"),
    ("M17", SEAM, "    if (!rb) return { ok: false, reason: 'not-served', matrix: readGovernMatrix({ core, storage }) };",
     "    if (!rb) return { ok: true, reason: 'not-served', matrix: readGovernMatrix({ core, storage }) };",
     "a grant for a capability nothing serves reports SUCCESS"),
    ("M18", SEAM,
     "      logger.error(`[Intelligence] capability grant write failed for ${capability}: ${(err as Error).message}`);\n"
     "      return { ok: false, reason: 'unwritable', matrix: readGovernMatrix({ core, storage }) };",
     "      logger.error(`[Intelligence] capability grant write failed for ${capability}: ${(err as Error).message}`);\n"
     "      return { ok: true, matrix: readGovernMatrix({ core, storage }) };",
     "A FAILED WRITE REPORTS SUCCESS: a person believes they granted something that was never stored"),
    ("M19", SEAM, "    if (raw && Array.isArray(raw.capabilities)) {",
     "    if (false) {",
     "the materialized set is never read, so every migrated machine's grants silently vanish"),

    # --- the door ----------------------------------------------------------
    ("M20", SEAM, "  return matrix.rows.find((r) => r.capability === door.capability) ?? null;",
     "  return matrix.rows.find((r) => r.capability === door.capability) ?? matrix.rows[0] ?? null;",
     "ROW ZERO: a promotion refusal lands on the plugin-update row and looks like it worked"),
    ("M21", SEAM, "  if (!door || door.surface !== 'settings' || door.section !== 'capabilities') return null;",
     "  if (!door) return null;",
     "a door for any other surface resolves here too"),

    # --- the vocabulary ----------------------------------------------------
    ("M22", SEAM, "    label: CAPABILITY_LABELS[capability] ?? capability,",
     "    label: CAPABILITY_LABELS[capability] ?? 'Unknown capability',",
     "AN INVENTED LABEL for a capability the vocabulary has not ratified"),
    ("M23", SEAM, "      id: capability,",
     "      id: '',",
     "the id disappears from beside the label — the refusals cite ids, and the door's vocabulary breaks"),

    # --- the grant's own event (pin 5) -------------------------------------
    ("M24", GRANTS, "      out.set(entry.capability, {",
     "      if (false) out.set(entry.capability, {",
     "no row can state which act made its grant"),

    # --- the render --------------------------------------------------------
    ("M25", VIEW, "      checked: row.consent,",
     "      checked: row.inForce,",
     "THE SWITCH RENDERS FORCE INSTEAD OF CONSENT — the disarmed row's switch flips off"),
    ("M26", VIEW, "      row.disarm ? this.renderBand(row) : null",
     "      null",
     "the disarm band never renders: a disarmed grant shows a loud chip and no reason and no door"),
    ("M27", VIEW, "    if (!row) return;",
     "    if (!row) { this.setState({ landedOn: matrix.rows[0]?.capability ?? null }); return; }",
     "a door for an unserved capability marks the FIRST row instead of none"),
]

# The control: a change that must NOT be detected. If it "kills", the battery is
# measuring something other than what it claims.
CONTROL = (SEAM, " * WP-44 · THE GOVERN MATRIX — M7's derivation",
           " * WP-44 · THE GOVERN MATRIX. M7's derivation")

def run(argv):
    return subprocess.run(argv, capture_output=True, text=True)


def tracked_changes():
    """Modifications to TRACKED files — what a leftover mutation looks like."""
    return [l for l in run(["git", "status", "--porcelain"]).stdout.splitlines()
            if not l.startswith("??")]


def untracked():
    """The untracked set, as a sorted list. Compared before against after."""
    return sorted(l for l in run(["git", "status", "--porcelain"]).stdout.splitlines()
                  if l.startswith("??"))


def pristine_report(before=None):
    """
    Pristine, stated precisely rather than as `git status` being empty.

    The check exists for two things: refuse to run over somebody's edits, and
    prove afterwards that every mutation was restored (WP-34's finding — a
    battery killed mid-mutation skips its `finally` and leaves the mutant on
    disk). Neither concern is about UNTRACKED files: every mutation here is an
    in-place rewrite of a tracked file named in `MUTATIONS`.

    Refusing on untracked files was not merely strict, it was WRONG in the case
    that actually arose — the merge checkout legitimately holds three untracked
    architect design docs, and the battery declined to run at all. Loosening the
    check to ignore them silently would have been the bad fix, so instead the
    untracked SET is captured and compared before against after: a
    generator-style leftover that writes a NEW file is still caught (WP-32's
    poisoned-artifact form), and what is being ignored is printed rather than
    assumed.
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


def jest():
    """
    Returns (testsFailed, suitesFailed, testsTotal, output).

    BOTH lines are parsed, and that is a battery finding rather than a
    precaution. The first run of this battery read only `Tests:` and reported
    M02 and M07 as VOID — "executed 85 < floor 101" — when what had actually
    happened was that a suite FAILED TO COMPILE and therefore contributed zero
    tests. A mutant that breaks the type check is KILLED, loudly; reading only
    the test line turned two of the clearest kills in the set into
    unmeasurables. Same family as WP-32's substring finding: the wrong line
    answered the question.

    Each pattern is line-anchored and parses a NUMBER rather than matching a
    token, so no summary line can satisfy it by containing it.
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
