#!/usr/bin/env python3
"""
WP-46 · the mutation battery — the arrival and the re-entry, mutated one pin at
a time, with the lie each mutation would ship named beside it.

Four families:

  1. **The display model** (`arrivalModel.ts`). This is the only place M6 shapes
     anything, so it is the only place M6 can lie by arithmetic: a count taken
     off the wrong column, a gate line missing its checkpoint id, a denial
     rendered as consent standing, an unprovable checkpoint counted into the
     denominator.
  2. **The two surfaces** (`Arrival.tsx`, `SessionReEntry.tsx`). XD-26's
     absences are structural, so the mutations put the forbidden structure BACK:
     a badge on the changed column, a door on a finished run, a reserved row
     that scrolls away, a second mark table, the standing approval below the
     gate rather than above it.
  3. **The bridge** (`ipc-handlers.ts`, `DockedPanelContainer.tsx`). Its one
     property is thinness. Every mutation here puts a decision into it.
  4. **The generator** (`generate-return-copy.ts`). Its one property is that the
     ratified copy is extracted rather than typed. The mutations make it type.

THE HARNESS IS WP-45'S, REUSED RATHER THAN REWRITTEN, carrying the five findings
that cost earlier packets real time:

  - `--no-cache`, always (WP-31: a poisoned ts-jest cache can mask a mutation as
    a FALSE SURVIVAL, so a witness credited from a cached run is not credited).
  - COUNT-FLOORED: a mutant that reduces the executed count is VOID, not green.
  - BOTH summary lines parsed (WP-43: a mutant that breaks compilation
    contributes zero tests, and a battery reading only `Tests:` files the
    clearest kills in the set as unmeasurable).
  - The tree verified PRISTINE before and after, with the untracked SET compared
    rather than required empty (WP-34's kill form, WP-43's fix).
  - REFUSES TO RUN over a source carrying non-printing characters (WP-30's
    extension of the NUL rule: a battery over invisible bytes measures nothing
    trustworthy). Checked byte-level, never with a shell-argument pattern —
    argv cannot carry NUL, and `grep -c $'\\x00'` passes an EMPTY pattern and
    matches every line, which is how the architect's own first check of that
    finding failed silently.

ONE NOTE ON THE GENERATOR MUTATIONS, stated rather than left to be discovered.
PARALLEL_PROTOCOL forbids a generator under mutation from writing the working
tree (WP-32's poisoned-fixture form). These are safe by construction: the only
executions of the generator inside these suites are `--check` (which never
writes) and `--out <tmpdir>` (which writes elsewhere), and the pristine report
after the run is what proves it rather than this paragraph.

Explicit argv throughout; no shell string is ever built from a variable.
"""
import subprocess
import sys
import re

# 51 tests pristine across the four suites; floored just under it so a mutant
# that quietly executes fewer is VOID rather than green. (Was 46/44 on the
# first drive — the four survivors' fixes added five pins.)
FLOOR = 48

SUITES = [
    "tests/unit/renderer/returnArrival.test.tsx",
    "tests/unit/renderer/returnReEntry.test.tsx",
    "tests/unit/renderer/returnBridge.test.ts",
    "tests/unit/renderer/returnRailBadge.test.ts",
]

MODEL = "src/renderer/components/return/arrivalModel.ts"
ARRIVAL = "src/renderer/components/return/Arrival.tsx"
REENTRY = "src/renderer/components/return/SessionReEntry.tsx"
IPC = "src/main/ipc-handlers.ts"
RAIL = "src/renderer/components/DockedPanel/DockedPanelContainer.tsx"
GENERATOR = "scripts/generate-return-copy.ts"

# Every file a mutation touches, plus the generated artifact — swept for
# non-printing characters before anything runs.
SWEPT = [MODEL, ARRIVAL, REENTRY, IPC, RAIL, GENERATOR,
         "src/renderer/components/return/returnCopy.generated.ts",
         "src/common/constants.ts", *SUITES,
         "tests/unit/renderer/helpers/returnMorning.ts"]

# (id, file, find, replace, the lie it would ship)
MUTATIONS = [
    # --- family 1: the display model ---------------------------------------
    ("M01", MODEL, "    needsYou: triage.waiting.length,", "    needsYou: triage.changed.length,",
     "the badge and the accounting line count the column that needs NOBODY — the ambient instrument reports a number nothing is escalating"),
    ("M02", MODEL, "    `${counts.dark} ${RETURN_COPY.ACCOUNTING_DARK}`,\n",
     "",
     "the record's own blindness leaves the one breath — three dark producers and the accounting line never says so"),
    ("M03", MODEL, "  if (awayMs === null || !Number.isFinite(awayMs) || awayMs < 0) return AUTHORED.AWAY_UNKNOWN;",
     "  if (awayMs !== null && awayMs < 0) return AUTHORED.AWAY_UNKNOWN;",
     "a first ever open claims 'You were away 0 hours' — a statement about a person's morning the surface cannot make"),
    ("M04", MODEL, "  const head = count === null\n    ? AUTHORED.DRIFT_NO_COUNT\n    : `${count} ${RETURN_COPY.DRIFT_COUNTED}`;",
     "  const head = count === null\n    ? ''\n    : `${count} ${RETURN_COPY.DRIFT_COUNTED}`;",
     "the drift line drops the half that says what it cannot say, so 'nothing is in this list' reads as 'nothing is stale'"),
    ("M05", MODEL, "    `${RETURN_COPY.GATE_PREFIX}${gate.checkpointId}` +",
     "    `${RETURN_COPY.GATE_PREFIX}` +",
     "J-Return's sharpest must-not, restored: a needs-you row that knows THAT but not WHERE"),
    ("M06", MODEL, "${gate.index}${RETURN_COPY.GATE_OF}${gate.of}", "${gate.of}${RETURN_COPY.GATE_OF}${gate.index}",
     "the position lies about where in the document the run stands — '8 of 3 in rb.remediate'"),
    ("M07", MODEL, "  if (approval.state !== 'approved') return null;", "  if (approval.state === 'pending') return null;",
     "a DENIED consent gate renders as an approval that still stands — the user is told they agreed to something they refused"),
    ("M08", MODEL, "  if (!approval.decidedAt) return null;", "  if (approval.decidedAt === 'never') return null;",
     "the standing sentence renders 'You approved this plan undefined' — the moment XD-26 requires, absent and unnoticed"),
    ("M09", MODEL, "    verifiableCount: checkpoints.filter((c) => c.attest !== 'narrative').length,",
     "    verifiableCount: checkpoints.length,",
     "the honest denominator counts steps nobody can prove as provable — the half-adherence lie wearing a progress bar"),
    ("M10", MODEL, "  if (!row) return true;", "  if (!row) return false;",
     "a session id that resolves to NOTHING renders as an established arm with an empty rail, instead of 6c"),
    ("M11", MODEL, "  return row.documentUnavailable === true;", "  return false;",
     "a run whose pinned document the registry does not hold renders checkpoints from a document it was never run under"),
    ("M12", MODEL, "  return row.gate?.checkpointId ?? null;", "  return (row.checkpoints ?? [])[0]?.id ?? null;",
     "the cursor is GUESSED from position rather than read from the record — the inference the marks discipline exists to replace"),
    ("M13", MODEL, "  return situation.kind === 'session' ? (situation.sessionId ?? null) : null;",
     "  return situation.sessionId ?? situation.id;",
     "an incident's own event id is handed to the promotion as though it were a session id"),

    # --- family 2: the two surfaces ----------------------------------------
    ("M14", ARRIVAL, "          React.createElement('div', { style: styles.columnHead }, RETURN_COPY.CHANGED_HEAD),",
     "          React.createElement('div', { style: styles.columnHead }, RETURN_COPY.CHANGED_HEAD, React.createElement('span', { key: 'badge', style: styles.badge, 'data-badge': 'needsYou' }, String(counts.changed))),",
     "a badge on the changed column — something that needs nobody escalates, which is XD-26's named absence put back"),
    ("M15", ARRIVAL, "      ...(situation.column === 'waiting' && sessionId", "      ...(sessionId",
     "a finished run offers 'Open where you are needed.' — a door on a row that needs no one"),
    ("M16", ARRIVAL, "      const at = previous ? Date.parse(previous) : NaN;", "      const at = now.getTime();",
     "the stamp is read AFTER it is written, so every arrival reports an absence of zero however long you were gone"),
    ("M17", ARRIVAL, "    position: 'sticky' as const,", "    position: 'static' as const,",
     "the record's own health can be scrolled away — the one row §4a tear 3 says cannot be"),
    ("M18", ARRIVAL, "  private driftCount(): number | null {\n    return null;\n  }",
     "  private driftCount(): number | null {\n    return this.state.triage?.reserved.staleCount ?? null;\n  }",
     "a PRODUCER-LIVENESS number is rendered under a FACT-FRESHNESS sentence — '0 facts are past their freshness window' on a morning with 41"),
    ("M19", REENTRY, "React.createElement('span', { key: 'mark', style: styles.mark, 'data-mark': 'true' }, checkpointMark(state, index)),",
     "React.createElement('span', { key: 'mark', style: styles.mark, 'data-mark': 'true' }, state.status === 'attested' ? '\\u2713' : String(index + 1)),",
     "a SECOND mark table on this sheet, ticking a narrative checkpoint the platform cannot prove — the defect XD-26 names by name"),
    ("M20", REENTRY, "    if (armUnestablished(row)) return this.renderUnknownArm();", "    if (row === null) return this.renderUnknownArm();",
     "a session whose document is unavailable draws a rail and attest words for a procedure the platform cannot establish"),
    ("M21", REENTRY, "      this.renderStanding(standingApprovals(session)),\n      this.renderGate(session, cursorId),",
     "      this.renderGate(session, cursorId),\n      this.renderStanding(standingApprovals(session)),",
     "the standing approval falls BELOW the gate, so the user reads the question before reading that it was already answered"),
    ("M22", REENTRY, "    const state = (row.checkpoints ?? []).find((c) => c.id === cursorId);",
     "    const state = (row.checkpoints ?? [])[0];",
     "the gate card carries the FIRST checkpoint's attest words instead of the cursor's — the wrong sentence about what can be proved"),

    # --- family 3: the bridge ----------------------------------------------
    ("M23", IPC, "  safeHandle(IPC_CHANNELS.RETURN_TRIAGE, () => createSessionRegistry().triage());",
     "  safeHandle(IPC_CHANNELS.RETURN_TRIAGE, () => createSessionRegistry().snapshot());",
     "the channel named for the triage returns the whole fold — the bridge answering a different question than its name"),
    ("M24", IPC, "    createSessionRegistry().session(String(id ?? '')));", "    createSessionRegistry().sessions()[0]);",
     "the bridge PICKS a session instead of passing the id through — every promotion opens whichever run sorted first"),
    ("M25", RAIL, "      badgeCount: needsYou,", "      badgeCount: unreadChats,",
     "the rail escalates conversations again rather than situations — an inventory where XD-23 requires an instrument"),
    ("M26", RAIL, "        this.setState({ needsYou: triage ? arrivalCounts(triage).needsYou : null });",
     "        this.setState({ needsYou: triage ? triage.changed.length : null });",
     "the badge is served by its own arithmetic and can disagree with the column beneath it"),

    # --- family 4: the generator -------------------------------------------
    ("M27", GENERATOR, "  const m = sentence.match(/^\\S+\\s+([\\s\\S]*)$/);\n  if (!m) throw new Error(`\"${what}\" has no count token to drop`);\n  return m[1];",
     "  const m = sentence.match(/^\\S+\\s+([\\s\\S]*)$/);\n  if (!m) throw new Error(`\"${what}\" has no count token to drop`);\n  return sentence;",
     "the scenario's own count stays inside the extracted phrase — the accounting line renders '2 2 need you'"),
    ("M28", GENERATOR, "  if (!m || !m[1]) throw new Error(`anchor for \"${what}\" no longer matches ${sheetPath}`);\n  return m[1].trim();",
     "  if (!m || !m[1]) return '';\n  return m[1].trim();",
     "a ratified line the designer moved becomes a BLANK on screen instead of a loud failure at generation time"),
]

# A comment-only edit. It must SURVIVE — a battery that kills this is measuring
# the file's bytes rather than its behaviour.
CONTROL = (MODEL, "// The counts, and the accounting line generated from them",
           "// The counts, and the accounting line generated from them (control)")


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


def nonprinting_report():
    """
    WP-30's extension of the NUL rule, as a GATE rather than a habit.

    Byte-level, and deliberately not a shell pattern: argv cannot carry a NUL,
    so `grep -c $'\\x00'` passes an EMPTY pattern and matches every line — the
    check that failed silently when this rule was first exercised. Tab and
    newline are the only control bytes source may contain; the zero-width and
    non-breaking characters are included because they are invisible to review
    for the same reason a NUL is.
    """
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
    """
    Pristine, stated precisely rather than as `git status` being empty.

    Refuse to run over somebody's edits, and prove afterwards that every
    mutation was restored (WP-34: a battery killed mid-mutation skips its
    `finally` and leaves the mutant on disk). The untracked SET is captured and
    compared rather than required empty, so a generator-style leftover that
    writes a NEW file is still caught (WP-32's poisoned-artifact form) while a
    legitimately untracked file does not block the run.
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

    BOTH lines are parsed (WP-43): a mutant that breaks the type check
    contributes zero tests, and a battery reading only `Tests:` turns the
    clearest kills in the set into unmeasurables. Each pattern is line-anchored
    and parses a NUMBER rather than matching a token, so no summary line can
    satisfy it merely by containing it (WP-32).
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
    ok, why = nonprinting_report()
    print(f"NON-PRINTING SWEEP: {why}")
    if not ok:
        print("REFUSING: a battery over invisible bytes measures nothing trustworthy (WP-30).")
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
