#!/usr/bin/env python3
"""
WP-49 · the mutation battery — the front door's pins, mutated one at a time,
with the lie each mutation would ship named beside it.

Four families:

  1. **The chrome (XD-27).** The two pins that make "a future destination must
     argue for being a destination" enforceable: the addon opens on Now, and Now
     is not in the strip. A pin that survives its own inversion is a comment.
  2. **The collapse (item 5).** The structural distinction position 11 §3 asks
     for — an answerable row has buttons and no door; a row needing the session
     has a door and no buttons — plus the inbox behaviours that had to survive
     the move: a failed read is never an all-clear, the paused banner comes from
     `pausedSources` and not from the rows, the true total is reported.
  3. **The opening state (item 4).** The verdict is READ, the asks are drawn from
     the visible rows by class, and a slot the record cannot fill WITHHOLDS the
     ask rather than shortening it.
  4. **The copy route.** The generator's refusals. Each one exists so a designer
     edit that moves a ratified line fails the build instead of shipping a blank;
     a refusal that can be deleted without a red is not a refusal.

THE HARNESS IS WP-45/46/47'S, REUSED RATHER THAN REWRITTEN, carrying the findings
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
    extension of the NUL rule). Checked byte-level, never with a shell-argument
    pattern — argv cannot carry NUL, and `grep -c $'\\x00'` passes an EMPTY
    pattern and matches every line.

ON MUTATING A GENERATOR (PARALLEL_PROTOCOL, WP-32's poisoned-fixture form):
`generate-opening-copy.ts` IS mutated here, and its suite drives it as a CLI. Every
one of those invocations passes `--out <tmp>` and `--sheet <tmp>`, so a mutant can
only ever write into a temp directory the test made and removes. The pristine
report after the run is what proves that rather than this paragraph.

Explicit argv throughout; no shell string is ever built from a variable.
"""
import subprocess
import sys
import re

SUITES = [
    "tests/unit/renderer/nowScreen.test.tsx",
    "tests/unit/renderer/openingAsks.test.ts",
    "tests/unit/renderer/panelOpening.test.tsx",
    "tests/unit/renderer/needsNothingOfYou.test.ts",
    "tests/unit/renderer/returnArrival.test.tsx",
    "tests/unit/renderer/panelChat-procedure-parity.test.tsx",
]

ARRIVAL = "src/renderer/components/return/Arrival.tsx"
MODEL = "src/renderer/components/return/arrivalModel.ts"
OVERVIEW = "src/renderer/components/NexusOverview.tsx"
ASKS = "src/renderer/components/DockedPanel/openingAsksModel.ts"
PANEL = "src/renderer/components/DockedPanel/PanelChat.tsx"
GEN = "scripts/generate-opening-copy.ts"
STRIP = "src/renderer/components/DockedPanel/siteContextModel.ts"

SWEPT = [ARRIVAL, MODEL, OVERVIEW, ASKS, PANEL, GEN, STRIP,
         "src/renderer/components/DockedPanel/openingCopy.generated.ts", *SUITES]

# 80 tests pristine across the six suites, measured 2026-08-20; floored just
# under so a mutant that quietly executes fewer is VOID rather than green.
FLOOR = 76

# (id, file, find, replace, the lie it would ship)
MUTATIONS = [
    # --- family 1: the chrome (XD-27) ---------------------------------------
    ("M01", OVERVIEW, "    activeTab: 'now',", "    activeTab: 'sites',",
     "the addon opens somewhere other than Now — the front door becomes a place you navigate TO, which is the whole thing XD-27 rules against"),
    ("M02", OVERVIEW, "const TABS = [\n  { key: 'sites',      label: 'Sites' },",
     "const TABS = [\n  { key: 'now',        label: 'Now' },\n  { key: 'sites',      label: 'Sites' },",
     "Now becomes tab one of four — a peer — and the next feature's claim to a tab no longer has to be argued"),
    ("M03", OVERVIEW, "  { key: 'record',     label: 'Record' },", "  { key: 'activity',   label: 'Activity' },",
     "the strip loses Record, so a finished run has nowhere to route and XD-27's second rider has no destination"),
    ("M04", OVERVIEW, "          onClick: () => this.setState({ activeTab: 'now' }),\n          onKeyDown:",
     "          onClick: () => undefined,\n          onKeyDown:",
     "the title/mark stops returning to Now — the logo affordance is decoration, and the front door is reachable only by whatever put you there"),

    # --- family 2: the collapse (item 5) ------------------------------------
    ("M05", ARRIVAL, "      ...(situation.column === 'waiting' && sessionId\n        ? [\n            React.createElement(\n              'button',\n              { key: 'door', style: styles.door, 'data-door': sessionId, onClick: this.promote(sessionId) },\n              RETURN_COPY.ROW_DOOR,\n            ),\n          ]\n        : []),",
     "      ...(sessionId\n        ? [\n            React.createElement(\n              'button',\n              { key: 'door', style: styles.door, 'data-door': sessionId, onClick: this.promote(sessionId) },\n              RETURN_COPY.ROW_DOOR,\n            ),\n          ]\n        : []),",
     "a FINISHED run grows a door on the Now screen — Record duplicated inside the front door, which is the two-homes defect the collapse removed"),
    ("M06", ARRIVAL, "      open\n        ? React.createElement(\n            'div',\n            { key: 'answers', style: styles.answers, 'data-answers': String(item.id) },",
     "      true\n        ? React.createElement(\n            'div',\n            { key: 'answers', style: styles.answers, 'data-answers': String(item.id) },",
     "a DECIDED row is offered Approve and Not now again, so a decision that was made reads as still open"),
    ("M07", ARRIVAL, "'data-answer': 'approve', onClick: () => onDecide && onDecide(item.id, NOW_COPY.APPROVE, 'done')",
     "'data-answer': 'approve', onClick: () => onDecide && onDecide(item.id, NOW_COPY.APPROVE, 'dismissed')",
     "Approve writes the DISMISSED status — the card's behaviour changed while collapsing onto the row, which is a migration wearing a rename"),
    ("M08", ARRIVAL, "    if (inbox.failed) {", "    if (false) {",
     "a failed inbox read falls through to an empty list — 'nothing needs you' when we simply could not look, the worst thing this surface can say"),
    ("M09", ARRIVAL, "      ...inbox.pausedSources.map((agentId) => this.renderPausedBanner(agentId)),",
     "      ...inbox.items.filter((i) => i.kind === 'problem').map((i) => this.renderPausedBanner(i.source)),",
     "the paused banner is derived from the ROWS again, so an agent whose failure item was dismissed stays silently disabled forever with no way to clear it"),
    ("M10", ARRIVAL, "      ...(inbox.items.length < inbox.total\n        ? [React.createElement('div', { key: 'inbox-truncated', style: styles.truncated }, `Showing ${inbox.items.length} of ${inbox.total}`)]\n        : []),",
     "      ...[],",
     "a truncated queue reports its page as the whole of it — the count a user acts on, quietly wrong"),
    ("M11", ARRIVAL, "          ...(inbox && inbox.loaded && !inbox.failed\n            ? inbox.recentlyDecided.map((item) => this.renderInboxRow(item))\n            : []),",
     "          ...[],",
     "recently decided rows vanish with the Inbox tab, and Reopen — the only way to reverse a decision — becomes unreachable"),
    ("M12", ARRIVAL, "React.createElement('div', { style: styles.columnHead }, NOW_COPY.NOTHING_NEEDED_HEAD),",
     "React.createElement('div', { style: styles.columnHead }, RETURN_COPY.CHANGED_HEAD),",
     "the section keeps the arrival's own head instead of the Now screen's, so the one place that says 'nothing is needed of you' says something else"),

    # --- family 3: the opening state (item 4) -------------------------------
    ("M13", ASKS, "    if (asks.length >= MAX_OPENING_ASKS) break;", "    if (false) break;",
     "the panel offers an ask per class without limit — §5's three become as many as the fleet has classes, and the opening state becomes a menu"),
    ("M14", ASKS, "    if (!classId || seen.has(classId)) continue;", "    if (!classId) continue;",
     "three rows of ONE class produce three identical questions — the panel asks the same thing three times instead of three different things"),
    ("M15", ASKS, "    if (slotsOf(template).some((slot) => bag[slot] === undefined)) continue;",
     "    // withholding removed",
     "an unfillable slot renders as a GAP mid-sentence — 'What does  need from me?' — the blank-where-a-sentence-belongs defect in its substitution form"),
    ("M16", ASKS, "    runbookId: situation.kind === 'session' ? situation.meta || undefined : undefined,",
     "    runbookId: situation.meta || undefined,",
     "an incident row fills the runbook slot from its PRODUCER — the name collision that cost WP-48 a gate round, re-created one surface over"),
    ("M17", ASKS, "  if (!triage.verdict && asks.length === 0) return null;",
     "  if (false) return null;",
     "a fleet with nothing waiting is announced an opening state with an empty verdict — the panel opens on a blank wearing furniture"),
    ("M18", ASKS, "  if (Object.prototype.hasOwnProperty.call(OPENING_ASKS, classId)) return OPENING_ASKS[classId];\n  const authored = AUTHORED as Readonly<Record<string, string>>;\n  if (Object.prototype.hasOwnProperty.call(authored, classId)) return authored[classId];",
     "  const authored = AUTHORED as Readonly<Record<string, string>>;\n  if (Object.prototype.hasOwnProperty.call(authored, classId)) return authored[classId];\n  if (Object.prototype.hasOwnProperty.call(OPENING_ASKS, classId)) return OPENING_ASKS[classId];",
     "an authored sentence SHADOWS the designer's own — the ratified copy loses to the packet's, which is the precedence the whole copy route exists to fix"),
    ("M19", PANEL, "    this.setState({ input: text }, () => {", "    this.setState({ input: text }, () => { void this.handleSend();",
     "taking an offered ask SENDS it — three suggestions become three ways to start a turn nobody typed, and an ask the reader wanted to edit is gone"),
    ("M20", PANEL, "      ...(opening.verdict\n        ? [React.createElement(", "      ...(false\n        ? [React.createElement(",
     "the opening line disappears and the panel opens on an invitation with no verdict — item 4's whole point, deleted while the asks still render"),
    ("M21", STRIP, "      primary: `${SCOPE_LINE.LEAD} ${SCOPE_LINE.FLEET}`,",
     "      primary: `${SCOPE_LINE.LEAD} ${SCOPE_LINE.ACTION}`,",
     "the scope line states the CONTROL where the subject belongs — 'Asking about Choose a site' — and the panel's most common failure is back"),

    # --- family 4: the copy route's refusals ---------------------------------
    ("M22", GEN, "  const m = md.match(re);\n  if (!m || !m[1]) throw new Error(`anchor for \"${what}\" no longer matches ${sheetPath}`);\n  return m[1].trim();",
     "  const m = md.match(re);\n  if (!m || !m[1]) return '';\n  return m[1].trim();",
     "a moved ratified line emits an EMPTY STRING instead of failing the build — a blank where a sentence belongs, invisible in review"),
    ("M23", GEN, "  if (asks.length !== 3) {\n    throw new Error(`§5 carries ${asks.length} opening ask(s), expected 3`);\n  }",
     "  if (false) {\n    throw new Error(`§5 carries ${asks.length} opening ask(s), expected 3`);\n  }",
     "§5's ask list can grow or shrink without anyone being told — ratified copy changing shape in silence"),
    ("M24", GEN, "  const at = specimen.indexOf(value);\n  if (at < 0) throw new Error(`\"${what}\" no longer contains the value \"${value}\" it splits on`);",
     "  const at = specimen.indexOf(value);\n  if (at < 0) return specimen;",
     "the ask ships as the SPECIMEN with no slot — 'What does cp.backup need from me?' beside every row, naming a checkpoint that is not on it"),
    ("M25", GEN, "  if (!scopeMatch) throw new Error(`§5's scope line no longer parses in ${sheetPath}`);",
     "  if (!scopeMatch) return { invitation, askTemplates, scope: { lead: 'Asking about', fleet: 'the whole fleet', action: 'Choose a site', separator: ' · ' }, nothingNeededHead: '', approve: '', notNow: '' };",
     "the ratified scope line is RETYPED in the generator when the sheet stops matching — the exact defect extraction exists to prevent, hidden inside the extractor"),
    ("M26", GEN, "  const answers = md.match(/the Inbox's \\*([^*]+)\\* and \\*([^*]+)\\*, in place/);\n  if (!answers) throw new Error(`§3's two in-place answers no longer parse in ${sheetPath}`);",
     "  const answers = md.match(/the Inbox's \\*([^*]+)\\* and \\*([^*]+)\\*, in place/) ?? ['', 'Approve', 'Not now'];",
     "the two button labels are hand-typed into the generator, so the row's answers can drift from the sheet that ratified them"),
    ("M27", GEN, '    const current = fs.existsSync(out) ? fs.readFileSync(out, \'utf-8\') : \'\';\n    if (current !== next) {',
     '    const current = fs.existsSync(out) ? fs.readFileSync(out, \'utf-8\') : \'\';\n    if (false) {',
     "`:check` stops failing closed on a stale artifact, so the generated module and the sheet can disagree indefinitely and CI says nothing"),
]

# The control: a comment-only edit to a mutated file. It MUST survive — a battery
# whose control dies is measuring the harness, not the code.
CONTROL = (ASKS, " * THREE RULES LIVE HERE:", " * THREE RULES LIVE HERE (control):")


def run(argv):
    return subprocess.run(argv, capture_output=True, text=True)


def abi_report():
    """
    THE MID-SESSION FLIP, CAUGHT INSTEAD OF MISREAD (WP-20d, and WP-33b's mask).

    `node_modules` is SHARED across every worktree by symlink, so any `npm test`
    or `npm run rebuild` elsewhere on this machine rebuilds better-sqlite3 to a
    different ABI while this battery is running. It happened on this packet's
    first drive: the flip landed mid-run and every mutant after it reported
    "no test summary parsed" — 24 VOIDs and a DEAD CONTROL, which reads as a
    broken battery and is a broken environment.

    `node -p process.versions.modules` does NOT catch it: that reports YOUR
    node's ABI, not what the shared tree was last built for (WP-33b). The probe
    that does is LOADING the module, which is what this does. `npx jest` skips
    the `pretest` hook that would have re-flipped it, and every battery in this
    family uses `npx jest` — so the guard belongs here.
    """
    r = run(["node", "-e",
             "new (require('better-sqlite3'))(':memory:').close()"])
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
    ok, why = nonprinting_report()
    print(f"NON-PRINTING SWEEP: {why}")
    if not ok:
        print("REFUSING: a battery over invisible bytes measures nothing trustworthy (WP-30).")
        return 2

    ok, why = abi_report()
    print(f"ABI PROBE: {why}")
    if not ok:
        print("REFUSING: the shared node_modules is built for another ABI — `npm rebuild "
              "better-sqlite3`, then re-drive. A battery run across a flip measures the "
              "environment, not the code (WP-20d/WP-33b).")
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

    ok, why = abi_report()
    print(f"ABI PROBE (after): {why}")
    if not ok:
        print("ALARM: the ABI FLIPPED DURING THIS RUN — every verdict after the flip is a "
              "measurement of the environment. Recover and re-drive; do not credit this run.")
        return 2

    killed = sum(1 for r in results if r[1] == "KILLED")
    print(f"\nTREE PRISTINE AFTER. {killed}/{len(results)} killed.")
    for mid, verdict, detail, lie in results:
        if verdict != "KILLED":
            print(f"  !! {mid} {verdict} ({detail}) — would ship: {lie}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
