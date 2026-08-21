#!/usr/bin/env python3
"""
WP-50 · the mutation battery — the producers' debts and the amended strip,
mutated one at a time, with the lie each mutation would ship named beside it.

Four families:

  1. **WP-48b · the arming records its scope.** The half that lights the screen
     is the EMPTY SET: an arming that selected nothing must record `0`, because
     "a predicate armed this and nobody chose targets" is a fact and not an
     absence. Every mutation here ships a different way of losing that, and the
     one that matters most (`from: 'selection'` on a scope nobody selected) is a
     provenance lie that no count would catch.
  2. **WP-49a · the two contract additions.** `TriageView.working` carries
     WP-49's own measured regression as a guard — a 6c row filed under "nothing
     needed of you" is the platform deciding a run it cannot place needs no one
     — and `Situation.capability` is the join two escalations were waiting on.
  3. **The renderer.** Field finding 2's dedup, pinned so an index rule cannot
     pass for a comparison, and XD-27's amended strip: first position, selected
     on arrival, the divider.
  4. **The retirement.** The run-noun asks, and the one mechanical transform
     that is allowed to touch ratified vocabulary.

THE HARNESS IS WP-45/46/47/49'S, REUSED RATHER THAN REWRITTEN, carrying the
findings that cost earlier packets real time — `--no-cache` always (WP-31's
false-survival form), COUNT-FLOORED, both summary lines parsed (WP-43), the tree
verified PRISTINE before and after with the untracked SET compared (WP-34/43),
a byte-level non-printing sweep (WP-30), and **the ABI pinned before AND after**
(WP-49's own new protocol rule: a battery that measured two ABIs measured
nothing, and `node -p process.versions.modules` cannot see the flip — only
LOADING the module can).

Explicit argv throughout; no shell string is ever built from a variable.
"""
import subprocess
import sys
import re

SUITES = [
    # WP-48b · producer + fold
    "src/main/intelligence-host/__tests__/manifestScope.test.ts",
    "src/main/intelligence-host/__tests__/procedureTurnCarrier.test.ts",
    # WP-49a · the contract additions
    "src/main/intelligence-host/__tests__/workingRuns.test.ts",
    # WP-48a · the escalation's own pins
    "src/main/intelligence-host/__tests__/sentinelCausation.test.ts",
    # the fold's standing pins, so a change here cannot quietly move the morning
    "src/main/intelligence-host/__tests__/sessionRegistry.test.ts",
    # the renderer
    "tests/unit/renderer/nowRowDedup.test.tsx",
    "tests/unit/renderer/nowScreen.test.tsx",
    "tests/unit/renderer/openingAsks.test.ts",
    "tests/unit/renderer/needsNothingOfYou.test.ts",
    "tests/unit/renderer/returnArrival.test.tsx",
]

CHAT = "src/main/intelligence-host/chatAssembly.ts"
REGISTRY = "src/main/intelligence-host/sessionRegistry.ts"
ARRIVAL = "src/renderer/components/return/Arrival.tsx"
OVERVIEW = "src/renderer/components/NexusOverview.tsx"
ASKS = "src/renderer/components/DockedPanel/openingAsksModel.ts"

SWEPT = [CHAT, REGISTRY, ARRIVAL, OVERVIEW, ASKS,
         "scripts/generate-opening-copy.ts",
         "src/renderer/components/DockedPanel/openingCopy.generated.ts",
         "src/main/intelligence-host/situationCopy.generated.ts",
         *SUITES]

# Measured pristine 2026-08-20 across the ten suites; floored just under so a
# mutant that quietly executes fewer is VOID rather than green.
FLOOR = 0  # set by the pristine baseline below, then enforced

# (id, file, find, replace, the lie it would ship)
MUTATIONS = [
    # --- family 1: WP-48b, the arming's scope on the record ------------------
    ("M01", CHAT,
     "  if (!armed) return { runnable: [], from: 'no-selection' };",
     "  if (!armed) return { runnable: [], from: 'selection' };",
     "a scope NOBODY SELECTED is stamped with comparator provenance — the record says a human chose an empty target list where a predicate chose nothing, and no count anywhere would catch it"),
    ("M02", CHAT,
     "  return { runnable: armed.runnable.map((cell) => cell.siteId), from: 'selection' };",
     "  return { runnable: [], from: 'selection' };",
     "a real comparator selection reaches the record as EMPTY — the run says it was given no targets while five sites sit under it, and guard 1's 'it never received a target list' fires on a run that did"),
    ("M03", CHAT,
     "      bundle.procedure?.status === 'delivered'\n        ? manifestScopeFor(turnProcedure?.scope)\n        : undefined,",
     "      manifestScopeFor(turnProcedure?.scope),",
     "an UNARMED turn's manifest grows a scope key — every chat turn in the product starts claiming an empty target set, and the parity floor that keeps a turn identical to its pre-WP-20 shape is gone"),
    ("M04", CHAT,
     "      payload: {\n        ...(bundle.manifest as unknown as Record<string, unknown>),\n        ...(scope ? { scope } : {}),\n      },",
     "      payload: {\n        ...(bundle.manifest as unknown as Record<string, unknown>),\n        scope,\n      },",
     "the manifest carries `scope: undefined` where it carried no key — a present-undefined reads as a value the producer chose to send, which is the distinction the arming carrier itself is built on"),

    # --- family 2: WP-49a, the two contract additions ------------------------
    ("M05", REGISTRY,
     "    if (row.documentUnavailable) continue;",
     "    // the 6c guard, removed",
     "a run the platform CANNOT PLACE is filed under 'nothing needed of you' — XD-26's 6c row declared to need nobody, which is the exact regression WP-49 measured before building anything"),
    ("M06", REGISTRY,
     "    if (row.gate) continue;\n    if (row.documentUnavailable) continue;",
     "    if (row.documentUnavailable) continue;",
     "a run STANDING AT A GATE leaves the needs-you list for the quiet section — the rider's promotion running backwards, and the one row that is genuinely waiting on a person disappears from the list about people"),
    ("M07", REGISTRY,
     "    if (row.status !== 'running') continue;",
     "    if (row.status === 'complete') continue;",
     "a HALTED run reads as in-flight-and-fine — a stopped run in the section for things that need nobody, which is the worst thing this surface can say"),
    ("M08", REGISTRY,
     "      const waiting = snapshot.situations.filter(\n        (s) => s.column === 'waiting' && !(s.sessionId !== undefined && workingIds.has(s.sessionId)),\n      );",
     "      const waiting = snapshot.situations.filter((s) => s.column === 'waiting');",
     "a working run is counted TWICE — once as a thing needing you and once as a thing needing nobody — so the badge, the verdict and the two lists stop agreeing about one fleet"),
    ("M09", REGISTRY,
     "      line: `${RUN_NOUN[row.capability] ?? row.capability} is ${row.status}`,",
     "      line: `${RUN_NOUN[row.capability] ?? 'A run'} is ${row.status}`,",
     "a capability the ratified vocabulary does not name is given a GUESSED noun instead of its own id — copy invented at the exact point the platform does not know what to call something"),
    ("M10", REGISTRY,
     "    capability: row.capability,\n    ...(row.gate ? { gate: row.gate } : {}),",
     "    capability: row.runbookId ?? row.capability,\n    ...(row.gate ? { gate: row.gate } : {}),",
     "the situation's capability is filled from the RUNBOOK ID — the name collision that cost WP-48 a gate round, re-created on the field the run-noun asks read, so every ask silently withholds"),

    # --- family 3: the renderer ----------------------------------------------
    ("M11", ARRIVAL,
     "      ...situation.parts\n        .filter((part) => part.summary !== situation.headline)",
     "      ...situation.parts\n        .filter((part) => part.summary === situation.headline)",
     "the dedup runs INVERTED — only the duplicate renders and every distinct part vanishes, so tear 2's expansion is deleted while the row still looks right on the one class the owner photographed"),
    ("M12", ARRIVAL,
     "        .filter((part) => part.summary !== situation.headline)",
     "        .filter(() => true)",
     "field finding 2 comes straight back — every derived run row says its own sentence twice, which is what the owner saw on the live screen"),
    ("M13", ARRIVAL,
     "      ...situation.parts\n        .filter((part) => part.summary !== situation.headline)\n        .map((part, i) =>",
     "      ...situation.parts\n        .filter((part, idx) => idx !== 0)\n        .map((part, i) =>",
     "the dedup becomes an INDEX RULE — parts[0] dropped whether or not it duplicates anything, so a ratified headline above a distinct first part silently loses that part"),
    ("M14", OVERVIEW,
     "  { key: 'now',        label: 'Now', divider: true },\n  { key: 'sites',      label: 'Sites' },",
     "  { key: 'sites',      label: 'Sites' },\n  { key: 'now',        label: 'Now', divider: true },",
     "Now stops heading the strip — the amendment's first property gone, and the front door becomes one of six peers, which is the reading XD-27 was withdrawn FOR, not against"),
    ("M15", OVERVIEW,
     "  { key: 'now',        label: 'Now', divider: true },",
     "  { key: 'now',        label: 'Now' },",
     "the hairline after Now disappears — the strip reads as a row of peers again, and 'home then destinations' is a claim nothing on screen makes"),
    ("M16", OVERVIEW,
     "    activeTab: 'now',",
     "    activeTab: 'sites',",
     "the addon opens somewhere other than Now, and with the strip now carrying a Now tab the front door is a place you navigate TO — the half of XD-27 that was NOT withdrawn"),
    ("M17", ARRIVAL,
     "          ...(triage.working ?? []).map((w) =>",
     "          ...[].map((w: any) =>",
     "rider 1's rows render nowhere — the contract carries the fact and the screen drops it, which is the silent-consumer failure the whole 'read, never recompose' rule exists to prevent"),

    # --- family 4: the retirement --------------------------------------------
    ("M18", ASKS,
     "  return noun.charAt(0).toLowerCase() + noun.slice(1);",
     "  return noun;",
     "the ratified noun is dropped into mid-sentence with its heading capital — 'Why has A plugin update run changed nothing?' — the rendering artifact the one mechanical transform exists to remove"),
    ("M19", ASKS,
     "  if (!noun) return undefined;",
     "  if (!noun) return capability;",
     "a capability the vocabulary cannot name is spelled into the designer's sentence as an ID — 'Why has cap.wpe_pull changed nothing?' — where the rule is to WITHHOLD the ask entirely"),
    ("M20", ASKS,
     "    runNoun: runNounInSentence(situation.capability),",
     "    runNoun: runNounInSentence(situation.gate?.capability),",
     "the run noun is read off the GATE instead of the row, so a row with no gate silently loses its ask — the retired sentence retires again, invisibly, on exactly the class it was built for"),
    ("M21", ASKS,
     "  'run.waiting.part-changed': 'What has {runNoun} already changed?',",
     "  'run.waiting.part-changed': 'What has {runbookId} already changed?',",
     "the second interim form comes back — a PROCEDURE identifier standing where a run noun belongs, on the class whose row matters most when it appears"),
]

# The control: a comment-only edit to a mutated file. It MUST survive — a battery
# whose control dies is measuring the harness, not the code.
CONTROL = (REGISTRY, " * ## Three rules, and everything below follows from them",
           " * ## Three rules, and everything below follows from them (control)")


def run(argv):
    return subprocess.run(argv, capture_output=True, text=True)


def abi_report():
    """
    WP-49's protocol rule, enforced: a battery pins its ABI before AND after.

    `node -p process.versions.modules` reports YOUR node's ABI, not what the
    SHARED `node_modules` was last rebuilt for (WP-33b). Loading the module is
    the only probe that sees the flip, and `npx jest` skips the `pretest` hook
    that would have re-flipped it.
    """
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
        appeared = [f for f in now if f not in before]
        vanished = [f for f in before if f not in now]
        return False, f"the untracked set moved — appeared {appeared}, vanished {vanished}"
    if now:
        print(f"  (ignoring {len(now)} untracked file(s), unchanged across the run: "
              + ", ".join(f.removeprefix('?? ') for f in now) + ")")
    return True, ""


def jest():
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
              "better-sqlite3`, then re-drive (WP-20d/WP-33b/WP-49).")
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
    # The floor is the pristine count less a small margin, so a mutant that
    # quietly executes fewer tests is VOID rather than green.
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
        print("ALARM: the ABI FLIPPED DURING THIS RUN — every verdict after the flip is a "
              "measurement of the environment. Recover and re-drive; do not credit this run "
              "(WP-49's rule: a battery that measured two ABIs measured nothing).")
        return 2

    killed = sum(1 for r in results if r[1] == "KILLED")
    survived = sum(1 for r in results if r[1] == "SURVIVED")
    missed = sum(1 for r in results if r[1] == "ANCHOR-MISS")
    print(f"\n=== WP-50 BATTERY: {killed} killed / {survived} survived / {missed} anchor-miss, "
          f"of {len(results)} ===")
    print("TREE PRISTINE AFTER.")
    for mid, verdict, detail, lie in results:
        if verdict != "KILLED":
            print(f"  !! {mid} {verdict} ({detail}) — would ship: {lie}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
