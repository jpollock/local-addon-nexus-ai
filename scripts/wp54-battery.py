#!/usr/bin/env python3
"""
WP-54 · the mutation battery.

Every rule this packet lands, mutated one at a time, with the lie it would ship
named beside it.

THE HARNESS IS WP-43/WP-44's, REUSED RATHER THAN REWRITTEN, and carries their
findings whole:

  - `--no-cache`, always (WP-31: a poisoned ts-jest cache can mask a mutation as
    a FALSE SURVIVAL, so a witness credited from a cached run is not credited).
  - COUNT-FLOORED: a mutant that reduces the executed count is VOID, not green.
  - BOTH summary lines parsed (WP-43: a mutant that breaks compilation
    contributes zero tests, and a battery reading only `Tests:` files the
    clearest kills in the set as unmeasurable).
  - The tree verified PRISTINE before and after, with the untracked SET compared
    rather than required empty (WP-34's kill form, WP-43's fix).

TWO ADDITIONS THIS RUN, both from rules the protocol carries and neither
harness had:

  - **THE ABI IS PINNED AT BOTH ENDS** (WP-49). A mid-run rebuild of
    better-sqlite3 — jest's own `pretest` in a sibling worktree, an
    `npm run rebuild` on this machine — VOIDS the whole run: a battery that
    measured two ABIs measured nothing, and the recorded evidence is 24 false
    VOIDs that read as mutation outcomes. The probe CONSTRUCTS a Database
    (WP-50): `require` alone resolves the module without loading the binding and
    passes against a tree built for the other ABI.
  - **NON-PRINTING CHARACTERS REFUSE THE RUN** (WP-30). A mutation battery over
    sources containing invisible bytes measures nothing trustworthy, and the
    tool that would show you the offending line is the one such a character
    disables.

Explicit argv throughout; no shell string is ever built from a variable.
"""
import subprocess
import sys
import re

FLOOR = 190

SUITES = [
    "src/main/intelligence-host/__tests__/sessionRegistry.test.ts",
    "src/main/intelligence-host/__tests__/situationHeadlines.test.ts",
    "src/main/intelligence-host/__tests__/tierAgreement.test.ts",
    "src/main/intelligence-host/__tests__/incidentTarget.test.ts",
    "src/main/intelligence-host/__tests__/placeSummary.test.ts",
    "tests/unit/renderer/returnArrival.test.tsx",
    "tests/unit/renderer/nowScreen.test.tsx",
    "tests/unit/renderer/nowList.test.tsx",
    "tests/unit/renderer/returnRailBadge.test.ts",
]

SEAM = "src/main/intelligence-host/sessionRegistry.ts"
MODEL = "src/renderer/components/return/arrivalModel.ts"
VIEW = "src/renderer/components/return/Arrival.tsx"
REENTRY = "src/renderer/components/return/SessionReEntry.tsx"
LABEL = "scripts/control-label.ts"
DS = "src/renderer/components/designSystem.ts"

# (id, file, find, replace, the lie it would ship)
MUTATIONS = [
    # --- item 2 · one tier, one source -------------------------------------
    ("M01", SEAM,
     "  return declared === 1 || declared === 2 || declared === 3 || declared === 4\n"
     "    ? (declared as ConsequenceTier)\n    : derived;",
     "  return derived;",
     "THE SHIPPED DEFECT, RESTORED: the class's tier is ignored and every open finding ranks at 2 again — the list back to age order"),
    ("M02", SEAM,
     "  return template !== null && derived < template.tier;",
     "  return false;",
     "a row the record ranks MORE urgent keeps its class's sentence — 'Tier 1 · the world is untouched'"),
    ("M03", SEAM,
     "    rule: fillSituationSentence(template.rule, { ...bag, tier }),\n"
     "    headlineTemplate: template.id,\n    tier,\n    door,\n    signature: null,",
     "    rule: template.rule,\n    headlineTemplate: template.id,\n    tier,\n    door,\n    signature: null,",
     "the rule line renders the six literal characters `{tier}` where the tier belongs"),
    ("M04", SEAM,
     "  const derivedTier: ConsequenceTier = resolved ? 4 : 2;",
     "  const derivedTier: ConsequenceTier = 2;",
     "a CLOSED incident ranks with the things that need you"),

    # --- item 4 · the target, named ----------------------------------------
    ("M05", SEAM,
     "  const target = targetName ?? anchor;",
     "  const target = targetName;",
     "an entity the twin cannot name leaves a HOLE where the site belongs — the substitution defect"),
    ("M06", SEAM,
     "      const fact = core?.twins?.get(entityId, 'site.core');",
     "      const fact = core?.twins?.get(entityId, 'site.name');",
     "the name is never found, and every finding is headlined with an entity id again"),
    ("M07", SEAM,
     "  let targetName: string | undefined;\n  try {\n    targetName = anchor ? nameOf?.(anchor) : undefined;\n  } catch {\n    targetName = undefined;\n  }",
     "  const targetName = anchor ? nameOf?.(anchor) : undefined;",
     "a faulty resolver takes the whole fold down — the seam's non-fatal rule broken"),
    ("M08", SEAM,
     "  if (!highest) return '';\n  const label = readablePlace(highest);",
     "  if (!highest) return `nothing on record names where ${total === 1 ? 'the target is' : `the ${total} targets are`}`;\n  const label = readablePlace(highest);",
     "the meta line contradicts the headline above it again — the platform claiming it cannot name what it just named"),

    # --- item 1 · the identity, and the dedup ------------------------------
    ("M09", SEAM,
     "    producer && fact && target\n      ? { producer: normalizeProducerId(producer), fact, target }\n      : null;",
     "    producer && fact\n      ? { producer: normalizeProducerId(producer), fact, target: target ?? '' }\n      : null;",
     "a partial signature: two findings with the same code on DIFFERENT sites fold into one row"),
    ("M10", SEAM,
     "  return value.replace(/^act_/, '').replace(/_/g, '-').toLowerCase();",
     "  return value.replace(/^act_/, '').toLowerCase();",
     "the ledger's actor and the Inbox's agent never compare equal — nothing ever deduplicates"),
    ("M11", MODEL,
     "  if (signature.fact !== item.code) return false;\n"
     "  if (signature.producer !== normalizeProducerId(item.source)) return false;",
     "  if (signature.fact !== item.code) return false;",
     "the producer stops counting: two agents raising the same code become one row"),
    ("M12", MODEL,
     "  return signature.target === scoped || signature.target === item.scopeLabel;",
     "  return true;",
     "the target stops counting: every site's copy of a finding folds onto one row"),
    ("M13", MODEL,
     "  for (const item of items) {\n    if (matched.has(item.id)) continue;",
     "  for (const item of items) {\n    if (true) continue;",
     "AN INBOX ITEM THE FOLD DOES NOT HOLD DISAPPEARS — auth-probe leaves Now entirely"),
    ("M14", MODEL,
     "    needsYou: nowRows(triage, inbox).length,",
     "    needsYou: triage.waiting.length,",
     "THE SHIPPED DEFECT, RESTORED: the badge counts one population and the screen draws another"),
    ("M15", MODEL,
     "  const unheld = nowRows(triage, inbox).filter((row) => row.situation === null).length;\n"
     "  return listVerdict(triage.waiting, unheld);",
     "  return listVerdict(triage.waiting, 0);",
     "the verdict heads eight rows with the word 'seven'"),
    ("M16", SEAM,
     "  const needsYou = waiting.length + alsoWaiting;",
     "  const needsYou = waiting.length;",
     "the host's own composer ignores the count it was handed — the same lie, one layer down"),

    # --- item 3 · the stripe -----------------------------------------------
    ("M17", MODEL,
     "  if (tier === 1) return COLOURS.tier1;\n  if (tier === 2) return COLOURS.tier2;",
     "  if (tier === 1) return COLOURS.tier2;\n  if (tier === 2) return COLOURS.tier1;",
     "the severity encoding is INVERTED: the most consequential row wears the calmer edge"),
    ("M18", MODEL,
     "  if (tier === 3) return COLOURS.tier3;\n  return null;",
     "  if (tier === 3) return COLOURS.tier3;\n  return COLOURS.tier3;",
     "tier 4 grows a stripe — the encoding stops meaning 'this needs you'"),
    ("M19", VIEW,
     "        style: stripe\n          ? { ...styles.row, borderLeft: `${styles.stripeWidth}px solid ${stripe}` }\n          : styles.row,",
     "        style: styles.row,",
     "THE RATIFIED STRIPE IS DROPPED IN BUILD AGAIN — the tier becomes invisible at a glance, which is how the tier drift hid"),

    # --- items 6 and 7 · the doors -----------------------------------------
    ("M20", SEAM,
     "    label: gate\n      ? fillSituationSentence(DOORS.runAtGate, { checkpoint: gate.checkpointId })\n      : DOORS.run,",
     "    label: DOORS.run,",
     "the door stops naming where it goes — two runs on one runbook get identical doors"),
    ("M21", SEAM,
     "  const door: RowDoor | null =\n    column === 'waiting' && target",
     "  const door: RowDoor | null =\n    target",
     "a CLOSED incident gets a door, in the section for things that need nobody"),
    ("M22", LABEL,
     "  if (value.endsWith('...') || value.endsWith('…')) return value;\n  return value.replace(/\\.$/, '');",
     "  return value;",
     "THE APPENDER IS BACK: every control extracted from prose ships with the sentence's full stop"),
    ("M23", REENTRY,
     "      ...(this.props.onBackToNow\n        ? [React.createElement(",
     "      ...(false\n        ? [React.createElement(",
     "the re-entry becomes a page with no way back to Now — the missing-front-door defect one screen deeper"),

    # --- items 9, 11, 13 · what the header says ----------------------------
    ("M24", MODEL,
     "    counts.changed > 0 ? fillSituationSentence(ACCOUNTING.changed, { count: counts.changed }) : '',",
     "    fillSituationSentence(ACCOUNTING.changed, { count: counts.changed }),",
     "'0 changed overnight' returns — a zero enumerated, contradicted by the rows below"),
    ("M25", MODEL,
     "  if (hours < 1) return '';",
     "  if (hours < 0) return '';",
     "'You were away 0 hours' ships for the third time"),
    ("M26", VIEW,
     "        ...(nothingNeeded > 0",
     "        ...(true",
     "the empty section renders again — a heading over nothing"),
    ("M27", SEAM,
     "  if (darkCount === 0 && staleCount === 0) return RESERVED.quiet;",
     "  if (darkCount === 0 && staleCount === 0) return 'the record is reporting — nothing dark, nothing late';",
     "the reserved row goes back to our nouns"),

    # --- item 14 · the identifier, once ------------------------------------
    ("M28", SEAM,
     "    meta: meta && headline.includes(meta) ? '' : meta,",
     "    meta,",
     "the runbook id prints twice on every derived card"),

    # --- item 8 · the design system ----------------------------------------
    ("M29", DS,
     "export const hasDesignSystem = resolved !== null;",
     "export const hasDesignSystem = true;",
     "the surface claims a design-system control where it renders the platform's own"),
]

# The control: a change that must NOT be detected. If it "kills", the battery is
# measuring something other than what it claims.
CONTROL = (SEAM, " * Tiers 1 to 4.", " * Tiers 1 to 4 (see below).")

NON_PRINTING = set(range(0, 9)) | {11, 12} | set(range(14, 32))


def run(argv):
    return subprocess.run(argv, capture_output=True, text=True)


def abi():
    """
    The ABI the shared better-sqlite3 binding is actually built for.

    CONSTRUCTS a Database rather than requiring the module (WP-50): `require`
    resolves without loading the native binding, so a probe built on it passes
    against a tree built for the other ABI and the mismatch surfaces later as
    WP-33b's mask. Returns the process ABI when the construction succeeds, and a
    marker naming the failure when it does not — either way the value is
    comparable across the run, which is what the pin needs.
    """
    r = run(["node", "-e",
             "const D=require('better-sqlite3');const db=new D(':memory:');db.close();"
             "process.stdout.write(process.versions.modules)"])
    return r.stdout.strip() if r.returncode == 0 else f"UNLOADABLE({r.stderr.strip()[:120]})"


def invisible_characters():
    """Every source this battery touches, swept by BYTE (WP-30)."""
    found = []
    for path in {m[1] for m in MUTATIONS} | {CONTROL[0]}:
        data = open(path, "rb").read()
        for i, b in enumerate(data):
            if b in NON_PRINTING:
                found.append(f"{path}: byte {i} is 0x{b:02x}")
                break
    return found


def tracked_changes():
    return [l for l in run(["git", "status", "--porcelain"]).stdout.splitlines()
            if not l.startswith("??")]


def untracked():
    return sorted(l for l in run(["git", "status", "--porcelain"]).stdout.splitlines()
                  if l.startswith("??"))


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
    invisible = invisible_characters()
    if invisible:
        print("REFUSING: non-printing characters in the sources under test (WP-30):")
        for line in invisible:
            print("  " + line)
        return 2

    abi_before = abi()
    print(f"ABI AT START: {abi_before}")
    if not abi_before.isdigit():
        print("REFUSING: the native binding did not load — a battery over a wrong-ABI tree measures nothing.")
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

    abi_after = abi()
    print(f"ABI AT END: {abi_after}")
    if abi_after != abi_before:
        print(f"VOID: the ABI moved mid-run ({abi_before} → {abi_after}). "
              "A battery that measured two ABIs measured nothing — re-run whole (WP-49).")
        return 2

    killed = sum(1 for r in results if r[1] == "KILLED")
    print(f"\nTREE PRISTINE AFTER, ABI UNCHANGED. {killed}/{len(results)} killed.")
    for mid, verdict, detail, lie in results:
        if verdict != "KILLED":
            print(f"  !! {mid} {verdict} ({detail}) — would ship: {lie}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
