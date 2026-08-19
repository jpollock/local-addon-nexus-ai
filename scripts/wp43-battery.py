#!/usr/bin/env python3
"""
WP-43 · the mutation battery.

Every rule this packet lands, mutated one at a time, with the suite that
should go RED named beside it. The protocol's three hard requirements are
enforced here rather than remembered:

  - `--no-cache`, always. WP-31's finding: a poisoned ts-jest cache can mask a
    mutation as a FALSE SURVIVAL, so a witness credited from a cached run is
    not credited.
  - COUNT-FLOORED. A mutant that reduces the number of executed tests is VOID,
    not green — the run has to reach the floor to count as having measured
    anything.
  - The tree is verified PRISTINE before and after. WP-34's finding: a battery
    killed mid-mutation skips its restore and leaves the mutant on disk, and
    the next baseline goes red on a file nobody edited.

Explicit argv throughout; no shell string ever built from a variable (WP-31's
second trap: `npx jest $var` does not word-split under zsh, so the command runs,
exits green, and tests nothing).
"""
import subprocess
import sys
import re

FLOOR = 105

SUITES = [
    "tests/unit/renderer/panelChat-citation-delivery.test.tsx",
    "tests/unit/chat/chat-citation-delivery.test.ts",
    "src/main/intelligence-host/__tests__/citationDelivery.test.ts",
    "tests/unit/renderer/citationModel.test.ts",
    "tests/unit/renderer/citationSpans.test.tsx",
    "tests/unit/renderer/panelChat-citation.test.tsx",
]

HOST = "src/main/intelligence-host/citationDelivery.ts"
ASSEMBLY = "src/main/intelligence-host/chatAssembly.ts"
RESOLVE = "src/intelligence/citation/resolve.ts"
SERVICE = "src/main/chat/ChatService.ts"
PANEL = "src/renderer/components/DockedPanel/PanelChat.tsx"
MODEL = "src/renderer/components/DockedPanel/citationModel.ts"
SPANS = "src/renderer/components/DockedPanel/CitationSpans.tsx"

# (id, file, find, replace, the lie it would ship)
MUTATIONS = [
    # --- the moment (pin 4) ------------------------------------------------
    ("M01", HOST, "export const CHAT_CITATION_MOMENT = 'investigate';",
     "export const CHAT_CITATION_MOMENT = 'glance';",
     "chat renders NO citations: every chip disappears and the markers are silently stripped"),
    ("M02", HOST, "export const CHAT_CITATION_MOMENT = 'investigate';",
     "export const CHAT_CITATION_MOMENT = 'inspect';",
     "a moment the renderer has no ruled strictness for — undefined behaviour on the surface"),

    # --- nothing delivered when the layer contributed nothing --------------
    ("M03", HOST, "  if (!assembly) return null;",
     "  if (!assembly) return { supply: { events: [], toolCalls: [], carrierLines: [] },\n"
     "    manifest: { citation: null }, moment: CHAT_CITATION_MOMENT };",
     "a degraded layer delivers an EMPTY universe, so every marker reports as unresolvable"),

    # --- the supply --------------------------------------------------------
    ("M04", HOST, "  const toolCalls: SuppliedToolCall[] = numberToolCalls(toolCallNames);",
     "  const toolCalls: SuppliedToolCall[] = [];",
     "no tool call is ever citable: every [[cite:tool:...]] renders as the loudest state"),
    ("M05", HOST, "    supply: { ...assembly.citationSupply, toolCalls },",
     "    supply: { ...assembly.citationSupply, toolCalls: [...assembly.citationSupply.toolCalls, ...toolCalls] },",
     "the assembler's list is appended to rather than replaced — silently doubles the day it populates"),
    ("M06", HOST, "    supply: { ...assembly.citationSupply, toolCalls },",
     "    supply: { events: [], toolCalls, carrierLines: [] },",
     "the ledger events and carrier lines are dropped from the universe"),

    # --- the manifest key (WP-38's G1 split) -------------------------------
    ("M07", HOST, "    manifest: { citation: assembly.citationManifest },",
     "    manifest: { ...(assembly.citationManifest ? { citation: assembly.citationManifest } : {}) },",
     "a quiet turn prints 'this session predates the citation convention'"),
    ("M08", ASSEMBLY, "      citationManifest: bundle.manifest.citation,",
     "      citationManifest: null,",
     "no live turn is ever under the convention; nothing renders"),

    # --- the widened SuppliedEvent (WP-38's owed item) ---------------------
    ("M09", RESOLVE, "        ...(i.observedAt !== undefined ? { observedAt: i.observedAt } : {}),",
     "",
     "the peek's time is never carried — WP-38's owed item silently un-delivered"),
    ("M10", RESOLVE, "        ...(i.summary !== undefined ? { summary: i.summary } : {}),",
     "",
     "the peek's machine summary is never carried"),
    ("M11", RESOLVE, "        ...(hit.observedAt !== undefined ? { observedAt: hit.observedAt } : {}),",
     "        observedAt: hit.observedAt ?? new Date().toISOString(),",
     "AN INVENTED TIMESTAMP: the record peek dates six-hour-old evidence to now"),
    ("M12", RESOLVE, "        ...(hit.summary !== undefined ? { summary: hit.summary } : {}),",
     "        summary: hit.summary ?? hit.topic ?? '',",
     "the topic is passed off as a machine summary when none was supplied"),

    # --- the ChatService chokepoint ----------------------------------------
    ("M13", SERVICE, "      if (delivery) this.emit(sessionId(session), { type: 'citation_supply', ...delivery });",
     "",
     "nothing is ever delivered: the packet's whole subject, reverted"),
    ("M14", SERVICE,
     "      if (delivery) this.emit(sessionId(session), { type: 'citation_supply', ...delivery });\n"
     "    } catch { /* the citation seam never costs a turn its ending */ }\n"
     "    this.emit(sessionId(session), { type: 'done', stopReason });",
     "    } catch { /* the citation seam never costs a turn its ending */ }\n"
     "    this.emit(sessionId(session), { type: 'done', stopReason });\n"
     "    const d2 = citationDeliveryFor(assembly, turnToolCalls);\n"
     "    if (d2) this.emit(sessionId(session), { type: 'citation_supply', ...d2 });",
     "the supply arrives AFTER done — the panel has already finished with the message"),
    ("M15", SERVICE, "          turnToolCalls.push(tc.name);",
     "",
     "tool calls are never recorded, so no tool citation can resolve"),
    ("M16", SERVICE,
     "          turnToolCalls.push(tc.name);\n\n          const result = await this.executeToolCall(session, tc, taskId);",
     "          const result = await this.executeToolCall(session, tc, taskId);\n"
     "          if (!result.isError) turnToolCalls.push(tc.name);",
     "a refused call is not counted, so every later call of that tool renumbers to the WRONG record"),

    # --- the renderer wiring ------------------------------------------------
    # The anchor is TWO LINES, because `m.id === streamingId` occurs three
    # times in this file and a one-line anchor mutated a different branch.
    # WP-24's rule, met: an anchor that matches more than once is not an anchor.
    ("M17", PANEL,
     "          m.id === streamingId\n"
     "            ? { ...m, citation: { supply: event.supply, manifest: event.manifest, moment: event.moment } }",
     "          true\n"
     "            ? { ...m, citation: { supply: event.supply, manifest: event.manifest, moment: event.moment } }",
     "RETROACTIVE CITATION: every earlier reply in the session is re-linked against this turn's supply"),
    ("M18", PANEL,
     "            ? { ...m, citation: { supply: event.supply, manifest: event.manifest, moment: event.moment } }",
     "            ? { ...m, citation: { supply: event.supply, moment: event.moment } }",
     "the manifest is dropped, so every delivered turn reads as 'no record in hand' and renders plain"),

    # --- the peek's honest absence ------------------------------------------
    ("M19", MODEL, "    observedAt: record.observedAt ?? null,",
     "    observedAt: record.observedAt ?? new Date().toISOString(),",
     "the peek invents a time for a record whose supply carried none"),
    ("M20", MODEL, "  if (Number.isNaN(when.getTime())) return null;",
     "  if (false) return null;",
     "an unreadable timestamp prints as 'Invalid Date' beside a claim"),
    ("M21", MODEL, "  return when.toLocaleString(undefined, {",
     "  return when.toISOString().slice(0, 16).replace('T', ' ') || when.toLocaleString(undefined, {",
     "UTC, not local: the peek dates evidence to the previous day for seven hours each day"),
    ("M22", SPANS, "      peek.summary\n        ? React.createElement('div', { style: styles.panelSummary, 'data-peek-field': 'summary' }, peek.summary)\n        : null,",
     "      React.createElement('div', { style: styles.panelSummary, 'data-peek-field': 'summary' }, peek.summary ?? '—'),",
     "a dash stands in for a summary nobody supplied"),
    ("M23", SPANS, "      time\n        ? React.createElement('div', { style: styles.panelMeta, 'data-peek-field': 'time' }, time)\n        : null,",
     "      React.createElement('div', { style: styles.panelMeta, 'data-peek-field': 'time' }, time ?? 'unknown'),",
     "'unknown' stands in for a time — a word standing in for a fact"),

    # --- the doors (ratified law: a door that opens nothing) ----------------
    ("M24", PANEL, "                React.createElement(CitationSpans, {\n                  turn: { ...msg.citation, reply: msg.content },\n                  renderMarkdown,",
     "                React.createElement(CitationSpans, {\n                  turn: { ...msg.citation, reply: msg.content },\n                  renderMarkdown,\n                  onOpenRecord: () => {},\n                  onSearchLedger: () => {},",
     "A FAKED HANDLER: both doors render and open nothing"),
]

# The control: a change that should NOT be detected by these suites. If it
# "kills", the battery is measuring something other than what it claims.
CONTROL = (HOST, " * WHAT THIS FILE DOES: assemble the exact payload",
           " * WHAT THIS MODULE DOES: assemble the exact payload")


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
