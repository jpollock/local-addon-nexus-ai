#!/usr/bin/env python3
"""
WP-51 · the mutation battery — the scan's TaskId, the orphan-grouping rule and
the arming's cause, mutated one at a time with the lie each would ship named
beside it.

Three families, one per ruled item:

  1. **The scan is an act (item 1).** The mutations here are the two ways the
     ruling's own sentence can be broken — an id written for an act that was
     never recorded (a join that names nothing, which is what WP-48a refused to
     do with `causation`), and an act recorded where the ruling says nothing
     happened (the heartbeat P4 forbids).
  2. **The orphan-grouping rule (item 2).** Every mutation is a different way of
     coalescing something the record does not link, or of failing to coalesce
     something it does. M07 is the doctrine one: group by the payload origin the
     four historical incidents share, which is exactly the reversal the
     architect's ruling refused.
  3. **The arming's cause (item 3).** The format gate, the absent-key floor, and
     the two directions the fold's join can be got wrong — not reading it, and
     letting it outrank the link that says which run PRODUCED an incident.

THE HARNESS IS WP-45/46/47/49/50/52'S, REUSED RATHER THAN REWRITTEN —
`--no-cache` throughout (WP-31's false-survival form), count-floored, both
summary lines parsed, byte sweep first, tree verified pristine before and after,
and the ABI pinned at both ends (WP-49) with the probe that CONSTRUCTS rather
than requires (WP-50).

Explicit argv throughout; no shell string is ever built from a variable.
"""
import subprocess
import sys
import re

SUITES = [
    "src/main/intelligence-host/__tests__/incidentProducer.test.ts",
    "src/main/intelligence-host/__tests__/sentinelCausation.test.ts",
    "src/main/intelligence-host/__tests__/armingCause.test.ts",
    "src/main/intelligence-host/__tests__/procedureTurnCarrier.test.ts",
    "src/main/intelligence-host/__tests__/manifestScope.test.ts",
    "src/main/intelligence-host/__tests__/sessionRegistry.test.ts",
    "src/main/comparator/__tests__/armFromSelection.test.ts",
]

PRODUCER = "src/main/intelligence-host/incidentProducer.ts"
REGISTRY = "src/main/intelligence-host/sessionRegistry.ts"
ARMING = "src/main/intelligence-host/procedureArming.ts"
ASSEMBLY = "src/main/intelligence-host/chatAssembly.ts"

SWEPT = [PRODUCER, REGISTRY, ARMING, ASSEMBLY,
         "src/main/comparator/armFromSelection.ts", *SUITES]

FLOOR = 0  # set from the pristine baseline

# (id, file, find, replace, the lie it would ship)
MUTATIONS = [
    # --- family 1: the scan is an act ---------------------------------------
    ("M01", PRODUCER,
     "      scanTask = recorded ? minted : undefined;",
     "      scanTask = minted;",
     "every finding carries a correlation naming an act that was never recorded — a join that passes the "
     "validator's regex and points at nothing, which is precisely what WP-48a refused to fabricate"),
    ("M02", PRODUCER,
     "    return true;\n  } catch {\n    return false; // rule 5, and the correlation falls away with it",
     "    return true;\n  } catch {\n    return true; // rule 5, and the correlation falls away with it",
     "the same lie from the other side: the emitter threw and the producer reports the act as recorded, so "
     "the findings are stamped with an id no event carries"),
    ("M03", PRODUCER,
     "          // WP-51 · the scan that observed this finding, named. Absent when the\n"
     "          // act could not be recorded — see `scanCorrelation`.\n"
     "          correlation: scanCorrelation(),",
     "          correlation: undefined,",
     "the findings go back to carrying no link at all — the four-rows-forever state the ruling exists to "
     "end, with the scan act written and nothing pointing at it"),
    ("M04", PRODUCER,
     "      if (actAttempted) return scanTask;",
     "      if (false) return scanTask;",
     "one act per FINDING instead of one per scan, so the health surface counts scans by fleet size and "
     "each finding gets its own correlation — the coalescing silently stops"),
    ("M05", PRODUCER,
     "      observed_at: args.observedAt,\n      topic: SCAN_TOPIC,",
     "      observed_at: new Date().toISOString(),\n      topic: SCAN_TOPIC,",
     "the act is stamped with the FOLD's clock rather than the scan's — data laundering on the one event "
     "that says when the scan happened"),
    ("M06", PRODUCER,
     "        sites: args.siteCount,",
     "        sites: 1,",
     "the act says every sweep covered one site, whatever it covered"),
    ("M07", PRODUCER,
     "          // amendment is an observation of THIS sweep. `causation` already\n"
     "          // names the incident being closed, which is the other half.\n"
     "          correlation: scanCorrelation(),",
     "          correlation: undefined,",
     "a resolution carries no scan at all, so nothing on the record says which sweep observed the closing"),

    # --- family 2: the orphan-grouping rule ----------------------------------
    ("M08", REGISTRY,
     "    const link = incident.correlation;",
     "    const link = str(payloadOf(incident).source);",
     "THE DOCTRINE, BREACHED: grouping by the PAYLOAD origin the four historical incidents share, which "
     "coalesces them on a fact that is not a record link — the exact reversal the ruling refused"),
    ("M09", REGISTRY,
     "    if (members.length < 2) {",
     "    if (members.length < 1) {",
     "a lone incident with a correlation is reported as a coalesced row of one, so `linkKind` claims a fold "
     "that never happened"),
    ("M10", REGISTRY,
     "    ...coalescedCopy(ordered, open.length, tierReason),",
     "    ...coalescedCopy(ordered.slice(0, 1), open.length, tierReason),",
     "the coalesced row's verdict is composed from ONE member — Q3's guard, broken: a four-part situation "
     "whose sentence is one part's"),
    ("M11", REGISTRY,
     "    memberCount: ordered.length,\n    linkKind: 'correlation',",
     "    memberCount: 1,\n    linkKind: 'correlation',",
     "the row says it folded one event while rendering four parts — and WP-55's ratified guard "
     "(`memberCount > 1`) would then never select the coalesced class"),
    ("M12", REGISTRY,
     "    ...alone.map((incident) => withFoldFacts(situationOfIncident(incident, deps), 1, null)),",
     "    ...alone.map((incident) => withFoldFacts(situationOfIncident(incident, deps), 1, 'correlation')),",
     "every un-coalesced incident claims a link justified its fold — the four honest rows start asserting a "
     "relationship the record does not carry"),
    ("M13", REGISTRY,
     "  return {\n    id: link,\n    kind: 'incident',",
     "  return {\n    id: ordered[0].id,\n    kind: 'incident',",
     "the row is named after one of its four parts, so its identity changes the moment that member resolves"),
    ("M14", REGISTRY,
     "  const open = ordered.filter((event) => payloadOf(event).resolved !== true);",
     "  const open = ordered.filter((event) => payloadOf(event).resolved === true);",
     "open and closed are inverted: a group of four open findings reports itself closed and leaves the "
     "waiting column entirely"),

    # --- family 3: the arming's cause ----------------------------------------
    ("M15", ARMING,
     "  const kept = [...new Set(ids.filter((id) => typeof id === 'string' && INCIDENT_EVENT_ID.test(id)))];",
     "  const kept = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];",
     "a run id, a task id or a typo is written as an incident the run answers — a fabricated join wearing a "
     "real field's name"),
    ("M16", ARMING,
     "  return kept.length > 0 ? kept : undefined;",
     "  return kept;",
     "an arming that answered nothing records `answers: []`, which says it answered and that the answer was "
     "nothing — the absent-vs-empty distinction this layer is built on"),
    ("M17", ASSEMBLY,
     "  return answers && answers.length > 0 ? { answers: [...answers] } : undefined;",
     "  return answers ? { answers: [...answers] } : undefined;",
     "the same empty claim one layer down, on the manifest itself"),
    ("M18", ASSEMBLY,
     "      bundle.procedure?.status === 'delivered'\n        ? manifestCauseFor(turnProcedure?.answers)\n        : undefined,",
     "      undefined,",
     "the cause never reaches the record — WP-48b's defect reproduced exactly: a complete carrier, a "
     "complete reader, and nothing in between"),
    ("M19", REGISTRY,
     "      answersByTask.set(turn.taskId, named);",
     "      answersByTask.set(turn.taskId, turn.answers);",
     "a later turn's arming DROPS what an earlier turn answered, so a part disappears from the row and "
     "nothing says it went"),
    ("M20", REGISTRY,
     "    const owner =\n      (incident.correlation ? sessionByTask.get(incident.correlation) : undefined) ??\n      answeredBy.get(incident.id);",
     "    const owner =\n      answeredBy.get(incident.id) ??\n      (incident.correlation ? sessionByTask.get(incident.correlation) : undefined);",
     "answering outranks producing, so a halt leaves the run that halted and attaches to whichever run was "
     "later pointed at it"),
    ("M21", REGISTRY,
     "  const cause = payload.cause as { answers?: unknown } | null | undefined;",
     "  const cause = payload as { answers?: unknown } | null | undefined;",
     "the fold reads a key the producer does not write, so every join silently fails and the four rows stay "
     "four whatever the arming recorded"),
    ("M22", REGISTRY,
     "        if (!answeredBy.has(incidentId)) answeredBy.set(incidentId, row);",
     "        answeredBy.set(incidentId, row);",
     "the LAST run to claim an incident wins, so a later arming can move an incident off the run that "
     "already answered it"),
]

# The control: a comment-only edit to a mutated file. It MUST survive.
CONTROL = (PRODUCER, "/** A site-level incident, where no component is named. P2's own wording. */",
           "/** A site-level incident, where no component is named. P2's own wording. (control) */")


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
        print(f"{mid}  {verdict:<11} {detail:<44} {lie[:70]}")

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
    print(f"\n=== WP-51 BATTERY: {killed} killed / {survived} survived / {missed} anchor-miss, "
          f"of {len(results)} ===")
    print("TREE PRISTINE AFTER.")
    for mid, verdict, detail, lie in results:
        if verdict != "KILLED":
            print(f"  !! {mid} {verdict} ({detail}) — would ship: {lie}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
