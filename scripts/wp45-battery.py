#!/usr/bin/env python3
"""
WP-45 · the mutation battery — the attestation law review, applied.

Every rule this packet lands, mutated one at a time, with the lie it would ship
named beside it. Three families:

  1. **The law itself.** The review's whole claim is that the surfaces move
     BECAUSE the documents moved. So the documents are mutation targets here:
     flip one `attest:` key and something must go red. A law mutation that
     survived would mean the gates column is decorative.
  2. **The re-pin (P4).** Its danger is not failing to fire — it is firing too
     widely. Most of these mutations LOOSEN the match, because a re-pin that
     matched on capability alone would silently move any grant onto any text,
     which is the integrity rule it is carved out of.
  3. **The reason vocabulary (WP-44's gate finding).** The defect being fixed
     was a word that misdescribed a human act; the mutations put it back, and
     also widen the scoping so one person's act stamps every grant in the sync.

THE HARNESS IS WP-44'S, REUSED RATHER THAN REWRITTEN — which is itself WP-44's
inherited discipline. Its mechanics carry four findings that cost earlier
packets real time:

  - `--no-cache`, always (WP-31: a poisoned ts-jest cache can mask a mutation as
    a FALSE SURVIVAL, so a witness credited from a cached run is not credited).
  - COUNT-FLOORED: a mutant that reduces the executed count is VOID, not green.
  - BOTH summary lines parsed (WP-43: a mutant that breaks compilation
    contributes zero tests, and a battery reading only `Tests:` files the
    clearest kills in the set as unmeasurable).
  - The tree verified PRISTINE before and after, with the untracked SET compared
    rather than required empty (WP-34's kill form, and WP-43's own fix).

ONE NOTE ON ATTRIBUTION, stated rather than left for a reader to infer: a
mutation to a `law/` document is ALSO caught by the derived-fixture check, since
`declared-procedures.json` is a function of those documents. So a law kill may be
credited to the fixture guard rather than to the gates pin. That is a real guard
and a real kill — the fixture check failing closed on a stale artifact is
exactly the property WP-41's ruling gave it — but it means these kills are not
evidence that the GATES column alone would have caught them. The gates column
has its own direct pins in `governMatrix.test.ts`, run above.

Explicit argv throughout; no shell string is ever built from a variable.
"""
import subprocess
import sys
import re

FLOOR = 177

SUITES = [
    # WP-45's own suites first.
    "src/main/intelligence-host/__tests__/lawReviewRePin.test.ts",
    "src/main/intelligence-host/__tests__/governMatrix.test.ts",
    "src/main/intelligence-host/__tests__/toolReach.test.ts",
    "src/intelligence/__tests__/shippedRunbooks.test.ts",
    "tests/unit/renderer/governMatrix.test.tsx",
    # The producer's own owners, because this packet changed its emission path.
    "src/main/intelligence-host/__tests__/capabilityGrants.test.ts",
    "src/main/intelligence-host/__tests__/capabilityDenyFlip.test.ts",
    # The derived fixture, which is a function of the four edited documents.
    "src/main/intelligence-host/__tests__/designFixtures.test.ts",
]

GRANTS = "src/main/intelligence-host/capabilityGrants.ts"
SEAM = "src/main/intelligence-host/governMatrix.ts"
EXECUTE = "law/runbooks/promotion-execute.md"
PREFLIGHT = "law/runbooks/promotion-preflight.md"
CONTAIN = "law/runbooks/incident-containment.md"
REMEDIATE = "law/runbooks/incident-remediation.md"

# (id, file, find, replace, the lie it would ship)
MUTATIONS = [
    # --- family 1: the law moves the surfaces ------------------------------
    ("M01", EXECUTE, "  - id: cp.backup                # eval 05 (backup the destination before promoting; wait for it or use backup_and_verify)\n    attest: event",
     "  - id: cp.backup                # eval 05 (backup the destination before promoting; wait for it or use backup_and_verify)\n    attest: narrative",
     "the backup that makes a live-environment overwrite recoverable stops being provable, and the column still says so"),
    ("M02", EXECUTE, "    evidence: { topic: task.action.executed, tool: wpe_backup_and_verify }",
     "    evidence: { topic: task.action.executed, tool: wpe_create_backup }",
     "a backup REQUEST attests the checkpoint — the document's own 'a backup request is not a backup' inverted"),
    ("M03", PREFLIGHT, "    attest: manifest             # the assembler's own episodic retrieval — the SUPPLY side only",
     "    attest: narrative            # the assembler's own episodic retrieval — the SUPPLY side only",
     "the preflight's one provable checkpoint is erased and the row returns to 'the grant itself, and nothing after it'"),
    ("M04", REMEDIATE, "  - id: cp.approval\n    attest: event",
     "  - id: cp.approval\n    attest: narrative",
     "consent to a destructive cleanup becomes unprovable — remediation's only attestation, gone"),
    ("M05", CONTAIN, "  - id: cp.snapshot         # evidence before cleanup, always\n    attest: narrative",
     "  - id: cp.snapshot         # evidence before cleanup, always\n    attest: event",
     "a class assigned because we WISH the step were provable: no evidence topic, so the registry refuses the whole runbook"),
    ("M06", EXECUTE, "    tools: [wpe_create_backup, wpe_backup_and_verify]   # both paths this step's body offers",
     "    tools: [wpe_backup_and_verify]   # both paths this step's body offers",
     "wpe_create_backup silently returns to the ungated legacy surface, reachable on a production install with no grant"),
    ("M07", EXECUTE, "  - attestation classes changed\n",
     "",
     "the document loses the trigger that would prompt the next reviewer to re-read its classes"),

    # --- family 2: the re-pin, LOOSENED ------------------------------------
    ("M08", GRANTS, "    (r) => r.capability === capability && r.from === fromHash && r.to === toHash",
     "    (r) => r.capability === capability",
     "ANY hash change on these two capabilities is announced as a reviewed re-pin — the review's signature, forged"),
    ("M09", GRANTS, "    (r) => r.capability === capability && r.from === fromHash && r.to === toHash",
     "    (r) => r.capability === capability && r.from === fromHash",
     "a grant is re-pinned onto text that is not the reviewed text, and the event says a review approved it"),
    ("M10", GRANTS, "        (r) => r.capability === entry.capability && r.from === entry.runbookHash",
     "        (r) => r.capability === entry.capability",
     "hash-mismatch becomes unreachable for these two: any settings pin is silently moved to whatever is on disk"),
    ("M11", GRANTS, "      return { ...entry, runbookId: pin.runbookId, runbookHash: pin.to };",
     "      return entry;",
     "P4's other half fails: a grant made at the control silently DIES of the review's own version bump"),
    ("M12", GRANTS, "    applyLawReviewRePin(storage, logger);\n",
     "",
     "the re-pin never runs at all"),

    # --- family 3: the reason vocabulary -----------------------------------
    ("M13", GRANTS, "      issueReasons?.get(grant.capability) ??\n      (lawReviewRePinFor",
     "      (lawReviewRePinFor",
     "WP-44's finding, reintroduced: a person's act at the control is recorded as `materialized`"),
    ("M14", GRANTS, "      issueReasons?.get(grant.capability) ??",
     "      (issueReasons ? [...issueReasons.values()][0] : undefined) ??",
     "one person's act stamps its reason onto EVERY grant that changed in the same sync"),
    ("M15", GRANTS, "        ? 'law-review re-pin'\n        : repinned",
     "        ? 'repinned'\n        : repinned",
     "the reviewed re-pin is indistinguishable from a mechanical one — the vocabulary's whole point"),
    ("M16", SEAM, "      ...(grant ? { issueReasons: new Map([[capability, 'granted-at-control' as const]]) } : {}),",
     "",
     "the control stops naming its own act, and the producer's default misdescribes it again"),
]

# A change that MUST survive: it alters no rule. If the battery kills this, the
# battery is measuring something other than the rules.
CONTROL = (GRANTS, "/** The re-pin row governing this exact transition, or nothing. */",
           "/** The re-pin row governing this exact transition, or nothing (control). */")


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
