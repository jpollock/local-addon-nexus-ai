#!/usr/bin/env python3
"""
WP-58 · the mutation battery — the collision decline, one ruled clause at a
time, with the wrong answer each mutation would ship named beside it.

The packet's one-line ruling is the organising principle, not the code's
structure: **a resolver may narrow its scope; it may not narrow its scope
silently and then answer as if it had searched everything.** Every family below
is one way to break that sentence.

  1. **BOTH STORES, BEFORE ANY ANSWER.** The probe runs, its result is read,
     and `resolveAnySite` does not short-circuit on local. Three separate
     mutations because they fail in three different places and a battery that
     could not tell them apart would credit one guard three times.
  2. **THE SCOPE OF THE DECLINE.** Names collide; ids and domains do not. Both
     directions — declining too little and declining too much — because
     "refuses everything" passes a test suite that only checks refusals.
  3. **THE PROBE IS CASE-GENEROUS, THE RESOLVER IS EXACT.** They ask different
     questions. Making the probe exact is the coin toss one casing away, and it
     looks like a consistency improvement.
  4. **THE ESCAPE HATCH.** A decline is only cheap because `<name>@local`
     answers it. Break the pin and the refusal becomes a dead end.
  5. **THE MECHANISM, NOT THE FIX.** The floor that stops the collision set
     going vacuously empty, and the rename that stops the two-argument form
     existing. These are the parts of the packet that are *supposed* to fail
     when someone forgets.
  6. **THE CALLERS.** Five tools ran local-then-graph. A ruling is a claim
     about the world and a test is a claim about a function; only driving the
     handler says whether the caller can honour it (WP-56).

THE HARNESS IS WP-45/46/47/49/50/52/56'S, REUSED RATHER THAN REWRITTEN —
`--no-cache` throughout, count-floored, both summary lines parsed, byte sweep
first, tree verified pristine before and after, and the ABI pinned at BOTH ENDS
(WP-49) with the probe that CONSTRUCTS rather than requires (WP-50).

Explicit argv throughout; no shell string is ever built from a variable.
"""
import subprocess
import sys
import re

SUITES = [
    "tests/unit/mcp/collision-decline.test.ts",
    "tests/unit/mcp/site-resolver.test.ts",
    "tests/main/site-resolver.test.ts",
    "tests/main/site-resolver-edge-cases.test.ts",
    "tests/unit/transport/resolve-target-args.test.ts",
    "tests/unit/graphql/resolvers.test.ts",
    "tests/unit/mcp/compare-sites.test.ts",
    "tests/unit/mcp/detect-drift.test.ts",
    "tests/unit/mcp/get-all-documents.test.ts",
    "tests/unit/mcp/get-site-twin.test.ts",
    "tests/unit/fleet/fleet-visibility.test.ts",
    "src/main/mcp/modules/fleet/__tests__/compareSites.test.ts",
]

RESOLVER = "src/main/mcp/site-resolver.ts"
TARGETARGS = "src/main/transport/resolveTargetArgs.ts"
STRUCTURE = "src/main/mcp/modules/site-context/get-site-structure.ts"
UTILS = "src/main/graphql/resolver-utils.ts"

SWEPT = [RESOLVER, TARGETARGS, STRUCTURE, UTILS, *SUITES]

FLOOR = 0  # set from the pristine baseline

# (id, file, find, replace, the wrong answer it would ship)
MUTATIONS = [
    # --- family 1: both stores, before any answer ---------------------------
    ("M01", RESOLVER,
     "  const rows = graphRowsNamed(graphService?.getDb?.(), bare);\n  if (rows.length === 0) return { kind: 'ok', site: match.site };",
     "  const rows = graphRowsNamed(graphService?.getDb?.(), bare);\n  if (rows.length >= 0) return { kind: 'ok', site: match.site };",
     "THE PROBE RUNS AND ITS ANSWER IS THROWN AWAY — the most likely regression of all, because the expensive part still happens and the code still reads as if it checks"),
    ("M02", RESOLVER,
     "  const rows = graphRowsNamed(graphService?.getDb?.(), bare);",
     "  const rows: Array<{ id: string; name: string; source: string; account_id: string }> = [];",
     "THE PRE-FIX SHAPE EXACTLY — Local store only, no source constraint, no decline: `resolveSite` as it stood across 115 call sites, answering 'local' about a production install"),
    ("M03", RESOLVER,
     "  const local = resolveLocalSiteResult(query, siteData, graphService);\n  if (local.kind === 'collision') {\n    return { kind: 'ambiguous', matches: local.matches };\n  }",
     "  const local = resolveLocalSiteResult(query, siteData, graphService);\n  if (local.kind === 'collision') {\n    return { kind: 'ok', id: local.site.id, name: local.site.name, source: 'local' };\n  }",
     "LOCAL-FIRST PRECEDENCE RESTORED in resolveAnySite — the defect its own docblock denied, and the one `compare_sites`, `detect_drift` and `get_all_site_documents` all inherit"),

    # --- family 2: the scope of the decline ---------------------------------
    ("M04", RESOLVER,
     "  if (pinned || match.by !== 'name') return { kind: 'ok', site: match.site };",
     "  if (pinned || match.by === 'name') return { kind: 'ok', site: match.site };",
     "the decline INVERTS — names never collide, ids and domains always do: every colliding name answered silently and every unambiguous id refused"),
    ("M05", RESOLVER,
     "  if (pinned || match.by !== 'name') return { kind: 'ok', site: match.site };",
     "  if (pinned) return { kind: 'ok', site: match.site };",
     "declining on IDs and DOMAINS too — refusing an unambiguous question, which most of the 115 call sites ask (they pass a Local site id). 'Refuses everything' passes any test that only checks refusals"),

    # --- family 3: the probe is generous, the resolver is exact -------------
    ("M06", RESOLVER,
     "      \"SELECT id, name, source, account_id FROM sites WHERE source IN ('wpe','external') AND is_active = 1 AND LOWER(name) = ?\",\n    ).all(name.toLowerCase())",
     "      \"SELECT id, name, source, account_id FROM sites WHERE source IN ('wpe','external') AND is_active = 1 AND name = ?\",\n    ).all(name)",
     "THE COIN TOSS ONE CASING AWAY — a Local site `MyLoop` beside the install `myloop` resolves silently to the copy, and the change looks like a consistency improvement"),
    ("M07", RESOLVER,
     "  const localForm = `${match.site.name}@local`;",
     "  const localForm = `${bare}@local`;",
     "the disambiguated form echoes the CALLER'S casing — `myloop@local` offered for a site stored as `MyLoop`, so the pin the message tells the user to paste fails one step later"),

    # --- family 4: the escape hatch -----------------------------------------
    ("M08", RESOLVER,
     "  const pinned = isLocalPinned(query);",
     "  const pinned = false;",
     "THE DECLINE BECOMES A DEAD END — `<name>@local` stops resolving, so the message names a form that does not work and the caller has no way to answer"),
    ("M09", RESOLVER,
     "  return typeof query === 'string' && query.endsWith('@local');",
     "  return typeof query === 'string' && query.includes('local');",
     "any name containing the substring 'local' is treated as pinned — `mylocalsite` silently exempted from the decline, which is the tokenising mistake the audit redaction rules already record"),

    # --- family 5: the mechanism, not the fix -------------------------------
    ("M10", RESOLVER,
     "export function resolveLocalSite(\n  query: string,\n  siteData: SiteDataAccessor,\n  graphService: GraphHandle,\n): LocalSiteInfo | null {",
     "export const resolveSite = resolveLocalSite;\nexport function resolveLocalSite(\n  query: string,\n  siteData: SiteDataAccessor,\n  graphService: GraphHandle,\n): LocalSiteInfo | null {",
     "THE OLD NAME COMES BACK AS AN ALIAS — the required third parameter stops being a mechanism the moment a two-argument form exists again, and every future call site can narrow its scope by habit"),
    ("M11", UTILS,
     "export function findLocalSiteExact(identifier: string",
     "export const resolveSite = findLocalSiteExact;\nexport function findLocalSiteExact(identifier: string",
     "two exported `resolveSite`s again, in one repo, disagreeing about case-sensitivity — item 3 undone by one line that adds nothing and breaks nothing visible"),

    # --- family 6: the callers ----------------------------------------------
    ("M12", STRUCTURE,
     "    if (resolved.kind === 'collision') {",
     "    if (false) {",
     "get_site_structure says \"not found\" for a name that exists TWICE — the caller concludes the site is absent when the truth is the tool is Local-only and nobody said which one"),
    ("M13", TARGETARGS,
     "  if (localResult.kind === 'collision') {\n    // The WPE-specific message where it applies: it names the install, which\n    // is more useful than the generic form.\n    throw wpeInstallName ? wpeAmbiguity() : new Error(localResult.message);\n  }",
     "  if (localResult.kind === 'collision' && wpeInstallName) {\n    throw wpeAmbiguity();\n  }",
     "THE PRE-FIX GATE RESTORED — a Local/EXTERNAL collision runs `nexus wp` on the copy without a word, which is the same hole one source over and exactly what the old `localSite && wpeInstallName` pair could not see"),
    ("M14", TARGETARGS,
     "  const localResult = resolveLocalSiteResult(target, services.siteData, services.graphService);",
     "  const localResult = resolveLocalSiteResult(name, services.siteData, services.graphService);",
     "`name` instead of `target` — the `@local` suffix has already been stripped, so the pin the CLI's own error message recommends is refused by the CLI: an unanswerable refusal"),
    ("M15", TARGETARGS,
     "  const localPinned = target.endsWith('@local');\n  if (!localPinned && localSite && wpeInstallName) throw wpeAmbiguity();",
     "  const localPinned = target.endsWith('@local');\n  if (false && !localPinned && localSite && wpeInstallName) throw wpeAmbiguity();",
     "THE PARITY BACKSTOP DELETED — a refusal this function has always made becomes conditional on the shared probe succeeding, so a graph read failure turns an ambiguous target into a silent run against the copy. Fail-OPEN, on the one call site that already got this right"),
    ("M16", TARGETARGS,
     "  const localPinned = target.endsWith('@local');\n  if (!localPinned && localSite && wpeInstallName) throw wpeAmbiguity();",
     "  const localPinned = target.endsWith('@local');\n  if (localSite && wpeInstallName) throw wpeAmbiguity();",
     "THE PRE-WP-58 PIN BUG RESTORED — `mysite@local` refused as ambiguous even though the caller already said which source they meant, which makes the error message's own advice unusable"),
]

# The control: a comment-only edit to a mutated file. It MUST survive. Without
# it, a harness that reports every run as a kill (WP-54a's stdout-only capture)
# is indistinguishable from a perfect score read from evidence.
CONTROL = (RESOLVER,
           "/** How a Local site was matched. Only a NAME match can collide across sources. */",
           "/** How a Local site was matched. Only a NAME match can collide across sources. (control) */")


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
    print(f"\n=== WP-58 BATTERY: {killed} killed / {survived} survived / {missed} anchor-miss, "
          f"of {len(results)} ===")
    print("TREE PRISTINE AFTER.")
    for mid, verdict, detail, lie in results:
        if verdict != "KILLED":
            print(f"  !! {mid} {verdict} ({detail}) — would ship: {lie}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
