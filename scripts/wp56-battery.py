#!/usr/bin/env python3
"""
WP-56 · the mutation battery — the deferral affordance, one ruled clause at a
time, with the lie each mutation would ship named beside it.

Five families, and they are the ruling's own clauses rather than the code's
structure:

  1. **THE TWO HALVES.** A deferred situation is PRESENT IN WAITING and ABSENT
     FROM `counts.needsYou`. Either half alone is the ruling half-built:
     dropping it from the list is the dismissal cycle two refused, and leaving
     it in the count is a deferral that quiets nothing.
  2. **ONLY THE USER DEFERS.** The fold's actor gate and the producer's, which
     fail differently and are therefore mutated separately.
  3. **THE SITUATION, NEVER ITS PARTS** (XD-28). The lookup is by situation id,
     and the mutation widens it to part ids — which is exactly what "deferring
     one member while its siblings escalate" would take.
  4. **THE THREE ENDS.** Wake fired, ended early, answered.
  5. **A DEFERRAL IS NOT A CONSENT DECISION.** The payload's absent `decision`
     key, mutated back in — in both the shapes MEASURED to be hostile.

THE HARNESS IS WP-45/46/47/49/50/52'S, REUSED RATHER THAN REWRITTEN —
`--no-cache` throughout, count-floored, both summary lines parsed, byte sweep
first, tree verified pristine before and after, and the ABI pinned at BOTH ENDS
(WP-49) with the probe that CONSTRUCTS rather than requires (WP-50).

Explicit argv throughout; no shell string is ever built from a variable.
"""
import subprocess
import sys
import re

SUITES = [
    "src/main/intelligence-host/__tests__/deferral.test.ts",
    "src/main/intelligence-host/__tests__/deferralIsNotConsent.test.ts",
    "src/main/intelligence-host/__tests__/sessionRegistry.test.ts",
    "src/main/intelligence-host/__tests__/workingRuns.test.ts",
    "src/main/intelligence-host/__tests__/situationHeadlines.test.ts",
    "src/main/intelligence-host/__tests__/actionProducer.test.ts",
    "src/main/intelligence-host/__tests__/procedureCursor.test.ts",
    "tests/unit/renderer/returnRailBadge.test.ts",
]

REGISTRY = "src/main/intelligence-host/sessionRegistry.ts"
PRODUCER = "src/main/intelligence-host/actionProducer.ts"

SWEPT = [REGISTRY, PRODUCER, "src/common/constants.ts", "src/main/ipc-handlers.ts", *SUITES]

FLOOR = 0  # set from the pristine baseline

# (id, file, find, replace, the lie it would ship)
MUTATIONS = [
    # --- family 1: the two halves -------------------------------------------
    ("M01", REGISTRY,
     "        counts: {\n          needsYou: escalating(waiting).length,",
     "        counts: {\n          needsYou: waiting.length,",
     "THE BADGE GOES ON COUNTING A DEFERRED SITUATION — the deferral quiets nothing, which is the whole act undone while every row still renders correctly"),
    ("M02", REGISTRY,
     "          deferred: waiting.length - escalating(waiting).length,",
     "          deferred: 0,",
     "the accounting line can never state the deferral, so `needsYou` reads as the whole truth — XD-23's honesty guarantee deleted, and the badge now undercounts the list with nothing saying by how much"),
    ("M03", REGISTRY,
     "function escalating(situations: readonly Situation[]): Situation[] {\n  return situations.filter((s) => !s.deferral);",
     "function escalating(situations: readonly Situation[]): Situation[] {\n  return situations.filter(() => true);",
     "the badge AND the verdict both count deferred rows — one mutation, both consumers, because they read one derivation"),
    ("M04", REGISTRY,
     "      const waiting = snapshot.situations.filter(\n        (s) => s.column === 'waiting' && !(s.sessionId !== undefined && workingIds.has(s.sessionId)),\n      );",
     "      const waiting = snapshot.situations.filter(\n        (s) => s.column === 'waiting' && !s.deferral && !(s.sessionId !== undefined && workingIds.has(s.sessionId)),\n      );",
     "THE DEFERRED ROW LEAVES THE LIST — a dismissal by another name, which is the ruling's own words for the thing it refused; the badge would look right and the row would be gone"),
    ("M05", REGISTRY,
     "  const escalatingRows = escalating(waiting);\n  if (escalatingRows.length === 0) return '';",
     "  const escalatingRows = [...waiting];\n  if (escalatingRows.length === 0) return '';",
     "the list verdict counts deferred rows while the badge does not — the sentence and the number above it disagree, which is the exact drift the one-composition design removes"),

    # --- family 2: only the user defers --------------------------------------
    ("M06", REGISTRY,
     "  const actor = event.actor as { kind?: unknown } | undefined;\n  if (actor?.kind !== 'human') return undefined;",
     "  const actor = event.actor as { kind?: unknown } | undefined;\n  if (actor?.kind === 'nobody') return undefined;",
     "AN AGENT CAN QUIET ITS OWN GATE — the self-promotion power inverted, at the fold, which is the layer that actually lowers the escalation"),
    ("M07", PRODUCER,
     "    const actor = core.identity?.actor() ?? { id: 'act_local_operator', kind: 'human' as const };\n    if (actor.kind !== 'human') return undefined;",
     "    const actor = core.identity?.actor() ?? { id: 'act_local_operator', kind: 'human' as const };\n    if (actor.kind === 'nobody') return undefined;",
     "the producer writes a deferral for a non-human caller — the fold still refuses it, so this is the defence-in-depth layer, and a battery that could not tell the two apart would credit one gate twice"),
    ("M08", REGISTRY,
     "    if (!record.reason) continue; // a deferral with no reason is a dismissal",
     "    if (false) continue; // a deferral with no reason is a dismissal",
     "a reasonless deferral quiets a row — 'say why, so the record carries it' becomes optional, and the record stops explaining anything"),
    ("M08b", REGISTRY,
     "    reason: (str(payload.reason) ?? '').trim(),",
     "    reason: str(payload.reason) ?? '',",
     "three spaces satisfy 'a reason is recorded' at the AUTHORITATIVE gate — the producer still trims, so this is the fold's own half of the rule, and it was added because M08's first run survived"),
    ("M09", PRODUCER,
     "  const reason = typeof record.reason === 'string' ? record.reason.trim() : '';\n  if (!reason) return undefined;",
     "  const reason = typeof record.reason === 'string' ? record.reason.trim() : '';\n  if (false) return undefined;",
     "the producer records an empty-reason deferral — the write-side half of the same rule"),
    ("M10", PRODUCER,
     "    reason: maskSecretsInString(reason),",
     "    reason: reason,",
     "A CREDENTIAL A USER PASTED INTO THE REASON BOX LANDS VERBATIM in a `task.*` event, which architecture §4.4 says is NEVER DELETED"),

    # --- family 3: the situation, never its parts (XD-28) --------------------
    ("M11", REGISTRY,
     "  const byId = new Map(situations.map((s) => [s.id, s]));",
     "  const byId = new Map<string, Situation>(situations.flatMap((s) => "
     "[[s.id, s] as [string, Situation], "
     "...s.parts.map((p) => [p.eventId ?? s.id, s] as [string, Situation])]));",
     "DEFERRING ONE FINDING QUIETS THE WHOLE SITUATION — splitting, from the other end, a situation the platform just asserted is one thing"),

    # --- family 4: the three ends -------------------------------------------
    ("M12", REGISTRY,
     "    if (wakeHasFired(deferral, situation, deps, now)) continue; // end 1: woken",
     "    if (false) continue; // end 1: woken",
     "A WOKEN DEFERRAL NEVER WAKES — 'not this week' stays quiet in nine days, which is the furniture problem this whole affordance was registered to prevent"),
    ("M13", REGISTRY,
     "  if (wake.kind === 'time') return now.getTime() >= Date.parse(wake.at);",
     "  if (wake.kind === 'time') return now.getTime() > Date.parse(wake.at);",
     "a time wake is silently late by one millisecond at its own boundary — the smallest form of a deadline the platform does not honour when it said it would"),
    ("M14", REGISTRY,
     "  if (!wake) return false; // unconditioned: permitted, and it never wakes",
     "  if (!wake) return true; // unconditioned: permitted, and it never wakes",
     "every UNCONDITIONED deferral wakes instantly — 'stay quiet until I come back' does nothing at all, and the affordance appears to work while changing nothing"),
    ("M15", REGISTRY,
     "  if (!deps.wakeFired) return false;",
     "  if (!deps.wakeFired) return true;",
     "a RECORD wake fires with no producer to say so — the platform inventing that a condition it cannot observe has been met, which is the fabrication this layer forbids outright"),
    ("M16", REGISTRY,
     "    if (record.act === 'end') {\n      standing.delete(record.situation);\n      continue;\n    }",
     "    if (record.act === 'end') {\n      continue;\n    }",
     "ENDING A DEFERRAL EARLY DOES NOTHING — the user's second statement is recorded and ignored, so the row stays quiet and the record says it should not be"),
    ("M17", REGISTRY,
     "    if (situation.column === 'changed') continue; // end 3: answered",
     "    if (situation.column === 'waiting') continue; // end 3: answered",
     "a finished run carries 'deferred by you' into the changed column and a WAITING one never shows its deferral at all — the third end inverted, which quiets nothing and mislabels what is done"),

    # --- family 5: a deferral is not a consent decision ----------------------
    ("M18", PRODUCER,
     "      payload: {\n        source: DEFERRAL_PAYLOAD_SOURCE,\n        act,",
     "      payload: {\n        source: DEFERRAL_PAYLOAD_SOURCE,\n        decision: act === 'defer' ? 'deferred' : 'ended',\n        act,",
     "the payload carries a `decision` again — the key MEASURED to be hostile in both of `foldProcedureCursor`'s lanes, one edit away from a deferral that denies a checkpoint"),
    ("M19", PRODUCER,
     "      payload: {\n        source: DEFERRAL_PAYLOAD_SOURCE,\n        act,",
     "      payload: {\n        source: DEFERRAL_PAYLOAD_SOURCE,\n        decision: 'deferred',\n        tool: 'bulk_plugin_update',\n        act,",
     "the full LEGACY-LANE shape — `decision` plus `tool` with no `checkpoint`, which is the measured path where a deferral SILENTLY REVOKES a standing approval"),
    ("M20", PRODUCER,
     "      ...(taskId ? { correlation: taskId } : {}),\n      ...(causation ? { causation } : {}),",
     "      ...(causation ? { causation } : {}),",
     "the deferral is no longer RECORDED ON THE RUN — cycle two's own placement dropped, and nothing can answer 'what did the user defer during this run'"),
    ("M21b", REGISTRY,
     "    const row = foldSessionRegistry(deps).sessions.find((s) => s.id === situationId);\n    return row?.taskIds[row.taskIds.length - 1];",
     "    const row = foldSessionRegistry(deps).sessions.find((s) => s.id === situationId);\n    return row?.taskIds[0];",
     "the deferral is correlated to the session's IDENTITY turn instead of the moment it was made — a statement about this run at THIS moment, filed against a turn that may be days old"),
    ("M21c", REGISTRY,
     "  try {\n    const row = foldSessionRegistry(deps).sessions.find((s) => s.id === situationId);\n    return row?.taskIds[row.taskIds.length - 1];",
     "  try {\n    const row = foldSessionRegistry(deps).sessions.find((s) => s.id !== situationId);\n    return row?.taskIds[row.taskIds.length - 1];",
     "the correlation resolves to SOME OTHER RUN's turn — a deferral filed against a run the user never looked at, which is worse than no correlation because it reads as a real join"),
    ("M21", PRODUCER,
     "    record.taskId,\n    { supersedes: record.supersedes },\n    record.supersedes\n  );",
     "    record.taskId,\n    { supersedes: record.supersedes },\n    undefined\n  );",
     "an early end loses its causation edge to the deferral it supersedes — superseding becomes an unrelated act, and the lifecycle stops being reconstructable"),
]

# The control: a comment-only edit to a mutated file. It MUST survive.
CONTROL = (REGISTRY,
           "/** Situations currently ESCALATING — the badge's set. See `TriageCounts`. */",
           "/** Situations currently ESCALATING — the badge's set. See `TriageCounts`. (control) */")


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
    print(f"\n=== WP-56 BATTERY: {killed} killed / {survived} survived / {missed} anchor-miss, "
          f"of {len(results)} ===")
    print("TREE PRISTINE AFTER.")
    for mid, verdict, detail, lie in results:
        if verdict != "KILLED":
            print(f"  !! {mid} {verdict} ({detail}) — would ship: {lie}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
