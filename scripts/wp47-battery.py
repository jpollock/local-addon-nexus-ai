#!/usr/bin/env python3
"""
WP-47 · the mutation battery — the capability probe, the theme resolution, and
the DOM-reach inventory's guard, mutated one pin at a time, with the lie each
mutation would ship named beside it.

Three families:

  1. **The capability probe** (`hostCapabilities.ts`). Its whole job is to be
     WRONG IN ONE DIRECTION ONLY: an absent or unreadable capability must select
     the guest path. Every mutation here makes it optimistic — a version read as
     evidence, an unusable level treated as support, a hostile context throwing
     instead of degrading. Each one ships a surface built against a host contract
     that host does not have.
  2. **The theme resolution** (`theme.ts`). Two sources with a stated order and a
     stated default. The mutations invert the order, guess at an unrecognised
     value, and make the fallback throw.
  3. **The inventory's guard** (`generate-dom-reach-inventory.ts`). Its only
     property is that it CANNOT BE SATISFIED BY AN INCOMPLETE INVENTORY. Every
     mutation here makes it satisfiable: a scan that skips code, a check that
     accepts an undeclared marker, a total that counts an accepted reach as
     retired. The designer's phase-6 gate is "the inventory is empty"; a guard
     that can be talked into that number is worse than no guard.

THE HARNESS IS WP-45/46'S, REUSED RATHER THAN REWRITTEN, carrying the five
findings that cost earlier packets real time:

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

ON MUTATING A GENERATOR (PARALLEL_PROTOCOL, WP-32's poisoned-fixture form): the
inventory generator is mutated here, and it is safe by construction — the suite
never invokes it as a CLI, only imports its pure functions, and the one test that
reads the tracked artifact reads it, never writes it. The pristine report after
the run is what proves that rather than this paragraph.

Explicit argv throughout; no shell string is ever built from a variable.
"""
import subprocess
import sys
import re

# 51 tests pristine across the three suites; floored just under so a mutant that
# quietly executes fewer is VOID rather than green.
FLOOR = 48

SUITES = [
    "tests/unit/renderer/hostCapabilities.probe.test.ts",
    "tests/unit/renderer/hostTheme.test.ts",
    "tests/unit/renderer/domReachInventory.test.ts",
]

PROBE = "src/renderer/hostCapabilities.ts"
THEME = "src/renderer/utils/theme.ts"
GEN = "scripts/generate-dom-reach-inventory.ts"

SWEPT = [PROBE, THEME, GEN, "docs/intelligence/dom-reach-inventory.json", *SUITES]

# (id, file, find, replace, the lie it would ship)
MUTATIONS = [
    # --- family 1: the capability probe ------------------------------------
    ("M01", PROBE, "  return typeof version === 'string' ? version : null;",
     "  return version === undefined ? null : String(version);",
     "a numeric or object version is coerced to a string, so `host=[object Object]` reaches a support log as though it were read"),
    ("M02", PROBE, "  return typeof value === 'number' && Number.isInteger(value) && value >= 1;",
     "  return value !== undefined && value !== null;",
     "presence is treated as support — `themeTokens: 0` and `regionProviders: '1'` light up contract paths the host cannot serve"),
    ("M03", PROBE, "  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return Object.freeze({});",
     "  if (raw === null || typeof raw !== 'object') return Object.freeze({});",
     "an ARRAY is read as a capability namespace, so its indices become capability names"),
    ("M04", PROBE, "      const found = level(name);\n      return found !== undefined && found >= atLeast;",
     "      const found = level(name);\n      return found !== undefined;",
     "a v1 host satisfies a v2 requirement — the integer versioning that makes each item independently rollable stops meaning anything"),
    ("M05", PROBE, "  const capabilities = readCapabilities(context);\n  const version = readVersion(context);",
     "  const capabilities = readCapabilities(context);\n  const version = readVersion(context);\n  const newer = version !== null && version >= '10.2';",
     "a VERSION SNIFF re-enters the probe — the exact thing the capability member replaces, and the thing the designer's plan forbids by name"),
    ("M06", PROBE, "  if (target === null || typeof target !== 'object') return undefined;\n  try {",
     "  if (target === null || typeof target !== 'object') return undefined;\n  if (true) {",
     "a context whose property access throws takes the addon down at boot, while asking what the host supports"),
    ("M07", PROBE, "  return Object.freeze(out);\n}\n\nfunction readVersion", "  return out;\n}\n\nfunction readVersion",
     "the capability map is writable, so any caller can grant itself a path the host never offered"),
    ("M08", PROBE, "    if (isUsableLevel(value)) out[key] = value;", "    out[key] = value as number;",
     "unusable members survive into the map, and `summary()` reports capabilities that do not exist"),

    # --- family 2: the theme resolution -------------------------------------
    ("M09", THEME, "      if (name === 'theme--dark') return 'dark';\n      if (name === 'theme--light') return 'light';",
     "      if (name === 'theme--dark') return 'dark';\n      return 'light';",
     "an unrecognised `currentThemeName` is GUESSED as light instead of falling through — a host that renames its values silently flips every Nexus surface to the wrong palette"),
    ("M10", THEME, "    return doc?.documentElement?.classList?.contains('Theme__Dark') ? 'dark' : 'light';",
     "    return doc!.documentElement.classList.contains('Theme__Dark') ? 'dark' : 'light';",
     "a document that cannot be read throws out of a theme resolution instead of answering light"),
    ("M11", THEME, "    const prefs = (scope as Record<string, unknown> | null | undefined)?.localPreferences;\n    if (prefs !== null && typeof prefs === 'object') {",
     "    const prefs = (scope as Record<string, unknown> | null | undefined)?.localPreferences;\n    if (false) {",
     "the published value is ignored and the class read becomes the source again — the micro reverted while every screen still renders correctly"),

    # --- family 3: the inventory's guard ------------------------------------
    ("M12", GEN, "      if (isCommentLine(text)) return;\n      const hit = REACH_TOKENS.find((t) => t.re.test(text));",
     "      if (true) return;\n      const hit = REACH_TOKENS.find((t) => t.re.test(text));",
     "the unrecorded-reach scan inspects NOTHING and reports a clean tree — the inventory becomes a document again"),
    ("M13", GEN, "      const covered = markerLines.some((ml) => ml <= lineNo && lineNo - ml <= MARKER_WINDOW);",
     "      const covered = markerLines.length > 0;",
     "one marker anywhere in a file covers every reach in it, however far away — a new reach added beneath an old marker is never recorded"),
    ("M14", GEN, "  if (orphans.length > 0) {\n    throw new InventoryError(", "  if (false) {\n    throw new InventoryError(",
     "a marker with no declaration passes, so a reach can be marked-but-undescribed and still counted as inventoried"),
    ("M15", GEN, "  if (undeclaredInCode.length > 0) {\n    throw new InventoryError(",
     "  if (false) {\n    throw new InventoryError(",
     "a declaration whose code is gone survives, so the phase-6 number can never reach zero honestly — and nobody is told why"),
    ("M16", GEN, "      open: open.length,", "      open: open.length - accepted.length,",
     "the phase-6 count is flattered by subtracting the exemptions from it — the one number the designer's plan says cannot be declared by narrative, declared by arithmetic"),
    ("M17", GEN, "  const open = reaches.filter((r) => r.status === 'open');",
     "  const open = reaches.filter((r) => r.status === 'open' && r.markedLines > 1);",
     "single-site reaches vanish from the open count while remaining in the tree"),
    ("M18", GEN, "  if (versionPins.length > 0) {\n    throw new InventoryError(",
     "  if (false) {\n    throw new InventoryError(",
     "the version-suffix sweep stops being a gate, and the next pinned selector ships and silently stops matching, exactly as v17-8-1 did"),
    ("M19", GEN, "        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;",
     "        if (entry.name === 'node_modules') continue;",
     "test fixtures are scanned as production reaches, so the guard cries wolf until someone turns it off — the failure mode that ends with the gate deleted"),
    ("M20", GEN, "  { token: '.Window', re: /\\.Window\\b/ },", "  { token: '.Window', re: /\\.WindowNeverMatches\\b/ },",
     "the single most consequential selector we depend on drops out of the scan, and a new `.Window` reach is never recorded"),
]

# A comment-only edit. It must SURVIVE — a battery that kills this is measuring
# the file's bytes rather than its behaviour.
CONTROL = (PROBE, " * ## Rules this module enforces", " * ## Rules this module enforces (control)")


def run(argv):
    return subprocess.run(argv, capture_output=True, text=True)


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

    killed = sum(1 for r in results if r[1] == "KILLED")
    print(f"\nTREE PRISTINE AFTER. {killed}/{len(results)} killed.")
    for mid, verdict, detail, lie in results:
        if verdict != "KILLED":
            print(f"  !! {mid} {verdict} ({detail}) — would ship: {lie}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
