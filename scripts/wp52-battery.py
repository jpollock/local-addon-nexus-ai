#!/usr/bin/env python3
"""
WP-52 · the mutation battery — the card's ownership, the rule line, and the
wording the measurement condemned, mutated one at a time with the lie each
would ship named beside it.

Three families:

  1. **The template owns the card (item 1).** The defect was a card that said
     its ask once and its gate three times. Every mutation here is a different
     way of putting a line back — or of taking too many away, which is the
     failure mode a "no old lines survive" pin invites and which the
     three-lines-present assertion is there to catch.
  2. **The rule line (item 3).** Which field it reads, and the treatment the
     designer withdrew.
  3. **The wording the measurement named (item 4).** `summarisePlaces` no longer
     asserts about targets — and the branches that DO have members still speak,
     because a summary that returned '' for everything would satisfy the fix and
     delete the field.

THE HARNESS IS WP-45/46/47/49/50'S, REUSED RATHER THAN REWRITTEN — `--no-cache`
throughout (WP-31's false-survival form, and this packet met the poisoned cache
again in a NEW shape: TWO suites failing to parse, not one), count-floored, both
summary lines parsed, byte sweep first, tree verified pristine before and after,
and **the ABI pinned at both ends** (WP-49) with the probe that CONSTRUCTS
rather than requires (WP-50).

Explicit argv throughout; no shell string is ever built from a variable.
"""
import subprocess
import sys
import re

SUITES = [
    "tests/unit/renderer/cardIsTemplate.test.tsx",
    "tests/unit/renderer/nowRowDedup.test.tsx",
    "tests/unit/renderer/returnArrival.test.tsx",
    "tests/unit/renderer/nowScreen.test.tsx",
    "src/main/intelligence-host/__tests__/placeSummary.test.ts",
    "src/main/intelligence-host/__tests__/sessionRegistry.test.ts",
    "src/main/intelligence-host/__tests__/situationHeadlines.test.ts",
]

ARRIVAL = "src/renderer/components/return/Arrival.tsx"
REGISTRY = "src/main/intelligence-host/sessionRegistry.ts"
MODEL = "src/renderer/components/return/arrivalModel.ts"

SWEPT = [ARRIVAL, REGISTRY, MODEL,
         "src/main/intelligence-host/situationCopy.generated.ts", *SUITES]

FLOOR = 0  # set from the pristine baseline

# (id, file, find, replace, the lie it would ship)
MUTATIONS = [
    # --- family 1: the template owns the card -------------------------------
    ("M01", ARRIVAL, "    const ratified = situation.headlineTemplate !== null;",
     "    const ratified = false;",
     "every card goes back to PREPENDING — the gate stated three times and the finding twice, which is the screen the owner photographed"),
    ("M02", ARRIVAL, "    const ratified = situation.headlineTemplate !== null;",
     "    const ratified = true;",
     "a DERIVED card loses its parts, its gate line and what the gate needs — and a derived card has no ask, so the row now knows THAT and not WHERE, which is J-Return's sharpest must-not"),
    ("M03", ARRIVAL,
     "      ...(!ratified && situation.gate\n        ? [",
     "      ...(situation.gate\n        ? [",
     "the mono gate line comes back on a ratified card, so the ask and the line state one fact twice — half the defect, restored, and the half that is hardest to see in a screenshot"),
    ("M04", ARRIVAL,
     "      ...(ratified\n        ? []\n        : situation.parts",
     "      ...(situation.parts.length >= 0\n        ? situation.parts\n        : situation.parts",
     "the parts print beneath every ratified verdict again — '0 done and standing, 0 failed' under the sentence that replaced it"),

    # --- family 2: the rule line --------------------------------------------
    ("M05", ARRIVAL, "'data-rule': ratified ? 'template' : 'derived' }, situation.rule),",
     "'data-rule': ratified ? 'template' : 'derived' }, situation.tierReason),",
     "the rule line goes back to the lowercase fragment the designer withdrew — 'waiting, and nothing has been written in scope', which reads like an apology for the row"),
    ("M06", REGISTRY, "    rule: template.rule,\n    headlineTemplate: template.id,\n  };\n}\n\n/** An orphan incident's verdict",
     "    rule: template.state,\n    headlineTemplate: template.id,\n  };\n}\n\n/** An orphan incident's verdict",
     "the rule line renders the STATUS PHRASE where the tier belongs — 'nothing written yet' as the rule that placed the row, a fact in the wrong slot"),
    ("M07", REGISTRY,
     "function derivedCopy(headline: string, meta: string, state: string, rule: string): SituationCopy {\n  return { headline, ask: '', chip: '', state, meta, rule, headlineTemplate: null };",
     "function derivedCopy(headline: string, meta: string, state: string, rule: string): SituationCopy {\n  return { headline, ask: '', chip: '', state, meta, rule: '', headlineTemplate: null };",
     "a derived card shows NO rule at all — XD-23's 'every row shows the rule that placed it' silently deleted on exactly the rows that most need explaining"),

    # --- family 3: the wording the measurement named -------------------------
    ("M08", REGISTRY, "  if (total === 0) return '';",
     "  if (total === 0) return 'no targets on record';",
     "card 1's contradiction comes straight back — a KNOWN-EMPTY claim about the target set on a row whose guard declined because the set is UNKNOWN"),
    ("M09", REGISTRY, "  if (total === 0) return '';",
     "  return '';",
     "the place set stops speaking even when it HAS members — 'touches production on 2 of 5' deleted, which is the fix over-applied and the field destroyed"),
    ("M10", REGISTRY,
     "  if (!highest) return `nothing on record names where ${total === 1 ? 'the target is' : `the ${total} targets are`}`;",
     "  if (!highest) return '';",
     "a target the record cannot place says NOTHING instead of saying so — the honest-absence rule applied where a fact exists, which is the opposite of honest"),

    # --- family 4: the meta line still carries what it should ----------------
    ("M11", MODEL, "    situation.places.summary,\n    ageLabel(situation.since, now),",
     "    ageLabel(situation.since, now),",
     "the place clause leaves the meta line for good, so a run that HAS written somewhere stops saying where — the fix mistaken for a deletion"),
]

# The control: a comment-only edit to a mutated file. It MUST survive.
CONTROL = (ARRIVAL, "  /**\n   * One waiting or changed row.",
           "  /**\n   * One waiting or changed row. (control)")


def run(argv):
    return subprocess.run(argv, capture_output=True, text=True)


def abi_report():
    """WP-49's rule with WP-50's probe: CONSTRUCT a Database, never `require`."""
    r = run(["node", "-e", "new (require('better-sqlite3'))(':memory:').close()"])
    if r.returncode != 0:
        first = (r.stderr or r.stdout).strip().splitlines()
        return False, (first[0] if first else "better-sqlite3 failed to load")
    return True, "better-sqlite3 loads — the shared node_modules matches this node"


def tracked_changes():
    return [l for l in run(["git", "status", "--porcelain"]).stdout.splitlines()
            if not l.startswith("??")]


def untracked():
    return sorted(l for l in run(["git", "status", "--porcelain"]).stdout.splitlines()
                  if l.startswith("??"))


def nonprinting_report():
    allowed = {0x09, 0x0a}
    invisible = {0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00a0}
    hits = []
    for path in SWEPT:
        try:
            data = open(path, "rb").read()
        except OSError as e:
            return False, f"{path} could not be read for the sweep: {e}"
        for i, b in enumerate(data):
            if (b < 0x20 and b not in allowed) or b == 0x7f:
                hits.append(f"{path}:{data[:i].count(chr(10).encode())+1} byte {hex(b)}")
        text = data.decode("utf-8")
        for i, ch in enumerate(text):
            if ord(ch) in invisible:
                hits.append(f"{path}:{text[:i].count(chr(10))+1} char {hex(ord(ch))}")
    if hits:
        return False, "non-printing characters in source:\n  " + "\n  ".join(hits[:20])
    return True, f"{len(SWEPT)} file(s) swept byte-by-byte, no non-printing characters"


def pristine_report(before=None):
    changed = tracked_changes()
    now = untracked()
    if changed:
        return False, "tracked files are modified:\n" + "\n".join(changed)
    if before is not None and now != before:
        return False, f"the untracked set moved — before {before}, now {now}"
    if now:
        print(f"  (ignoring {len(now)} untracked file(s), unchanged across the run)")
    return True, ""


def jest():
    r = run(["npx", "jest", "--no-cache", *SUITES])
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
    global FLOOR

    ok, why = nonprinting_report()
    print(f"NON-PRINTING SWEEP: {why}")
    if not ok:
        print("REFUSING: a battery over invisible bytes measures nothing trustworthy (WP-30).")
        return 2

    ok, why = abi_report()
    print(f"ABI PROBE (before): {why}")
    if not ok:
        print("REFUSING: the shared node_modules is built for another ABI — `npm rebuild "
              "better-sqlite3`, then re-drive (WP-20d/WP-33b/WP-49/WP-50).")
        return 2

    before_untracked = untracked()
    ok, why = pristine_report()
    if not ok:
        print(f"REFUSING: tree is not pristine before the battery — {why}")
        return 2

    failed, suitesFailed, total, _ = jest()
    if total is None or failed != 0 or suitesFailed != 0:
        print(f"REFUSING: baseline is not green ({failed} failed / {total} total).")
        return 2
    FLOOR = total - 4
    print(f"PRISTINE BASELINE: {failed} failed / {total} total, {suitesFailed} suites failed (floor {FLOOR})")

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
        if t is None:
            verdict, detail = "KILLED", "no test summary — the mutant does not compile"
        elif (f and f > 0) or (sf and sf > 0):
            verdict, detail = "KILLED", f"{f} tests / {sf} suites failed"
        elif t < FLOOR:
            verdict, detail = "VOID", f"green but executed {t} < floor {FLOOR}"
        else:
            verdict, detail = "SURVIVED", f"{t} passed"
        results.append((mid, verdict, detail, lie))
        print(f"{mid}  {verdict:<11} {detail:<44} {lie}")

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

    ok, why = abi_report()
    print(f"ABI PROBE (after): {why}")
    if not ok:
        print("ALARM: the ABI FLIPPED DURING THIS RUN — every verdict after the flip measures the "
              "environment. Recover and re-drive whole; do not credit this run (WP-49).")
        return 2

    killed = sum(1 for r in results if r[1] == "KILLED")
    survived = sum(1 for r in results if r[1] == "SURVIVED")
    missed = sum(1 for r in results if r[1] == "ANCHOR-MISS")
    print(f"\n=== WP-52 BATTERY: {killed} killed / {survived} survived / {missed} anchor-miss, "
          f"of {len(results)} ===")
    print("TREE PRISTINE AFTER.")
    for mid, verdict, detail, lie in results:
        if verdict != "KILLED":
            print(f"  !! {mid} {verdict} ({detail}) — would ship: {lie}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
