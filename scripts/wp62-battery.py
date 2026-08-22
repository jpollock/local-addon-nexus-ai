#!/usr/bin/env python3
"""
WP-62 · the mutation battery — three stacked truncations, one clause at a time,
with the wrong answer each mutation would ship named beside it.

The packet's claim is one sentence: **remote content is indexed the way local
content is.** Every family below is one way to break it while every screen
still draws and every count still prints.

  1. **ROWS.** The page-size query, its offset, its total order, and the ONE
     condition under which the end of the population may be declared: a page
     that came back SHORT. Equality with the page size is a boundary.
  2. **TRUNCATION IS STATED.** Avoiding truncation and stating it are
     different deliverables. These mutations avoid it and go quiet — which is
     the pre-fix behaviour with a bigger number.
  3. **DOCUMENTS.** The chunker, its title prefix, and the source label that
     rides on every chunk. A post cut off at the tokenizer still returns
     results, which is why nobody reported it.
  4. **FIELDS.** The bulk meta read, the underscore filter that mirrors the
     local path's SQL, and the CDATA tokenizer that is the only thing standing
     between post content and mis-attributed meta.
  5. **THE STATUS SURFACE.** Absent coverage is not complete; the remedy named
     must be one that can run on that site; the hedge is the whole point.
  6. **THE QUANTITIES.** documentCount counts posts, chunkCount counts chunks.

THE HARNESS IS WP-45/46/47/49/50/52/56/58'S, REUSED RATHER THAN REWRITTEN —
`--no-cache` throughout, count-floored, both summary lines parsed, byte sweep
first, tree verified pristine before and after, and the ABI pinned at BOTH ENDS
(WP-49) with the probe that CONSTRUCTS rather than requires (WP-50).

Explicit argv throughout; no shell string is ever built from a variable.
"""
import subprocess
import sys
import re

SUITES = [
    "tests/unit/content/RemoteContentExtractor.test.ts",
    "tests/unit/content/chunker-parity.test.ts",
    "tests/unit/content/wxr-postmeta.test.ts",
    "tests/unit/mcp/get-index-status-coverage.test.ts",
    "tests/unit/events/ExternalContentIndexService.test.ts",
    "tests/unit/content/content-pipeline-degradation.test.ts",
    "tests/unit/main/wpe-sync-piggyback.test.ts",
    "tests/main/content-pipeline.test.ts",
]

EXTRACTOR = "src/main/content/RemoteContentExtractor.ts"
CHUNKER = "src/main/content/chunker.ts"
WXR = "src/main/content/wxr-postmeta.ts"
WPESYNC = "src/main/events/WPESyncService.ts"
EXTERNAL = "src/main/events/ExternalContentIndexService.ts"
STATUS = "src/main/mcp/modules/site-context/get-index-status.ts"

SWEPT = [EXTRACTOR, CHUNKER, WXR, WPESYNC, EXTERNAL, STATUS, *SUITES]

FLOOR = 0  # set from the pristine baseline

# (id, file, find, replace, the wrong answer it would ship)
MUTATIONS = [
    # --- family 1: rows ------------------------------------------------------
    ("M01", EXTRACTOR,
     "      if (page.length < this.pageSize) {",
     "      if (page.length <= this.pageSize) {",
     "A FULL PAGE DECLARED COMPLETE — the D7 defect exactly, one comparison operator wide: 200 of 30,628 posts, marked complete, with nothing anywhere saying otherwise"),
    ("M02", EXTRACTOR,
     "    for (let offset = 0; ; offset += this.pageSize) {",
     "    for (let offset = 0; offset < 1; offset += this.pageSize) {",
     "THE PRE-FIX SHAPE — one query, no loop. Every install over the page size silently truncated, and the result still marked complete because the loop never learns otherwise"),
    ("M03", EXTRACTOR,
     "        `--offset=${offset}`,",
     "        '--offset=0',",
     "EVERY PAGE IS PAGE ONE — the same 200 rows fetched over and over up to the ceiling, so the count looks large and the content is one page repeated"),
    ("M04", EXTRACTOR,
     "        '--orderby=ID',\n        '--order=ASC',",
     "",
     "THE UNSTABLE SORT RESTORED — WP_Query's default `date DESC` with 200+ posts sharing one timestamp (measured on cedarvalehealt), so offset paging drops and duplicates rows while the count still looks plausible"),

    # --- family 2: truncation is STATED --------------------------------------
    ("M05", EXTRACTOR,
     "        truncatedReason = 'max-posts';",
     "        complete = true;\n        truncatedReason = 'max-posts';",
     "THE CEILING GOES QUIET — the stop still happens and the result claims to be whole. This is 'avoid truncation' passing for 'state truncation', which is the distinction the packet exists to make"),
    ("M06", EXTRACTOR,
     "          truncatedReason = 'page-failed';\n          truncatedDetail = `the first page failed:",
     "          complete = true;\n          truncatedDetail = `the first page failed:",
     "AN UNREADABLE SITE LOOKS EMPTY — an SSH failure and a site with no posts become the same record, so 'this install has no content' is indistinguishable from 'nobody could reach it'"),
    ("M07", EXTRACTOR,
     "        this.logger.warn(\n          `[RemoteContentExtractor] ${siteLabel}: extraction INCOMPLETE — `",
     "        this.logger.info(\n          `[RemoteContentExtractor] ${siteLabel}: extraction INCOMPLETE — `",
     "the warning at the seam becomes an info line — honest but invisible, which is exactly what runWpCliBatch's own comment says is not good enough"),
    ("M08", EXTRACTOR,
     "        `[RemoteContentExtractor] ${siteLabel}: ${rawPosts.length} rows read over `",
     "        `[RemoteContentExtractor] ${siteLabel}: ${rawPosts.length} total over `",
     "THE LABEL COMES BACK — a bounded row count called a total, which is the sentence that made two installs on exactly 200 look finished"),

    # --- family 3: documents -------------------------------------------------
    ("M09", CHUNKER,
     "    if (words.length <= CHUNK_MAX_WORDS) {",
     "    if (words.length <= Number.MAX_SAFE_INTEGER) {",
     "NOTHING EVER SPLITS — one document per post again, so every post longer than the model's context window is cut at the tokenizer and returns partial results that look like whole ones"),
    ("M10", CHUNKER,
     "          textForEmbedding: `${post.title}. ${chunkText}`,\n        });\n        chunkIndex++;",
     "          textForEmbedding: chunkText,\n        });\n        chunkIndex++;",
     "a middle chunk loses its post's title, so it embeds with no reference to its own subject — the retrieval quality regression that no count would show"),
    ("M11", EXTERNAL,
     "chunkPosts(siteId, extracted.posts, { source: 'external' })",
     "chunkPosts(siteId, extracted.posts, { source: 'wpe' })",
     "THE HONESTY-RULE REGRESSION this class exists to prevent — every external host's indexed content labelled as WP Engine's"),
    ("M12", CHUNKER,
     "      ...(extraMetadata ?? {}),",
     "",
     "the caller's metadata is dropped on the floor — `source` disappears from every remote document, so nothing downstream can tell an external host's content from a WP Engine install's"),

    # --- family 4: fields ----------------------------------------------------
    ("M13", CHUNKER,
     "  if (post.customFields && Object.keys(post.customFields).length > 0) {",
     "  if (false && post.customFields && Object.keys(post.customFields).length > 0) {",
     "CUSTOM FIELDS LEAVE THE SEARCHABLE TEXT — on the LOCAL path too, silently. The third truncation restored and generalised, and it produces no count to be wrong"),
    ("M14", EXTRACTOR,
     "            customFields: customFields.get(Number(postData.ID)) ?? {},",
     "            customFields: {},",
     "the meta is fetched, parsed, paid for over SSH — and thrown away at the last line. The expensive part still happens, which is why this shape survives review"),
    ("M15", WXR,
     "  return key.length > 0 && !key.startsWith('_');",
     "  return key.length > 0;",
     "ACF's internal field keys (`_tier` -> `field_cedar_post_tier`) indexed as searchable content, which the local path's `NOT LIKE '\\_%'` has always excluded — parity broken in the direction that adds noise rather than removing signal"),
    ("M16", WXR,
     "  const { skeleton, sections } = tokenizeCdata(xml);\n  const items = skeleton.split('<item>').slice(1);",
     "  const sections: string[] = [];\n  const items = xml.split('<item>').slice(1);",
     "THE ATTRIBUTION HAZARD — post CONTENT containing the literal text `<item>` (a post about WordPress exports) splits the document mid-post, so one post's meta lands on another post, or on an id that does not exist"),
    ("M17", EXTRACTOR,
     "        coverage.customFields = 'unavailable';\n        coverage.customFieldsDetail = `wp export failed:",
     "        coverage.customFields = 'collected';\n        coverage.customFieldsDetail = `wp export failed:",
     "A FAILED META READ REPORTS SUCCESS — 'this site has no custom fields' and 'we could not read them' become the same answer, which is the silence the whole third truncation was made of"),

    # --- family 5: the status surface ----------------------------------------
    ("M18", STATUS,
     "  if (!coverage) {\n    return [",
     "  if (false) {\n    return [",
     "ABSENT COVERAGE READS AS COMPLETE — every one of the 313 remote entries indexed before this packet presents its capped count as a total, which is the downstream half of D7"),
    ("M19", STATUS,
     "  wpe: 'bulk_reindex',\n  external: 'bulk_reindex',",
     "  wpe: 'reindex_site',\n  external: 'reindex_site',",
     "THE REMEDY NAMES A TOOL THAT CANNOT SERVE THE SITE — `reindex_site` resolves through `resolveLocalSite`, so it answers 'Site not found' for the exact install the message is about (WP-61's shape)"),
    ("M20", STATUS,
     "      `**Documents:** ${entry.documentCount}${entry.coverage?.complete ? '' : ' (at least)'}`,",
     "      `**Documents:** ${entry.documentCount}`,",
     "the hedge disappears while the coverage line stays — the number a reader acts on says one thing and the paragraph under it says another, and the number is the one that gets quoted"),

    # --- family 6: the quantities --------------------------------------------
    ("M21", EXTERNAL,
     "        lastIndexed: Date.now(), documentCount: uniquePostIds.size, chunkCount: embeddedDocs.length,",
     "        lastIndexed: Date.now(), documentCount: embeddedDocs.length, chunkCount: embeddedDocs.length,",
     "A CHUNK COUNT WEARING A DOCUMENT LABEL — chunking inflates `documentCount`, so a site whose post count did not change appears to have gained content, and every fleet total built on it moves"),
    ("M22", WPESYNC,
     "          documentCount: uniquePostIds.size,\n          chunkCount: embeddedDocs.length,",
     "          documentCount: embeddedDocs.length,\n          chunkCount: embeddedDocs.length,",
     "the same inflation on the WP Engine path, where 313 of the fleet's index entries live"),
]

# The control: a comment-only edit to a mutated file. It MUST survive. Without
# it, a harness that reports every run as a kill (WP-54a's stdout-only capture)
# is indistinguishable from a perfect score read from evidence.
CONTROL = (EXTRACTOR,
           "export const REMOTE_PAGE_SIZE = 200;",
           "export const REMOTE_PAGE_SIZE = 200; // (control)")


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
        print(f"{mid}  {verdict:<11} {detail:<30} {lie}")

    path, find, replace = CONTROL
    original, n = mutate(path, find, replace)
    if original is None:
        print(f"CONTROL  ANCHOR-MISS ({n} matches)")
        control_ok = False
    else:
        try:
            f, sf, t, _ = jest()
        finally:
            restore(path, original)
        control_ok = (f == 0 and sf == 0 and t is not None and t >= FLOOR)
        print(f"CONTROL  {'SURVIVED (correct)' if control_ok else 'KILLED (BATTERY IS WRONG)'}  {f} failed / {t} total")

    ok, why = pristine_report(before_untracked)
    if not ok:
        print(f"ALARM: tree is NOT pristine after the battery — {why}")
        return 2

    ok, why = abi_report()
    print(f"ABI PROBE (after): {why}")
    if not ok:
        print("VOID: the ABI moved mid-run — a battery that measured two ABIs measured "
              "nothing (WP-49). Re-run whole.")
        return 2

    killed = sum(1 for _, v, _, _ in results if v == "KILLED")
    survived = [r for r in results if r[1] == "SURVIVED"]
    anchor = [r for r in results if r[1] == "ANCHOR-MISS"]
    void = [r for r in results if r[1] == "VOID"]

    print(f"\n=== WP-62 BATTERY: {killed} killed / {len(survived)} survived / "
          f"{len(anchor)} anchor-miss / {len(void)} void, of {len(results)} ===")
    for mid, _, detail, lie in survived:
        print(f"  SURVIVED {mid}: {lie}  [{detail}]")
    for mid, _, detail, _ in anchor:
        print(f"  ANCHOR-MISS {mid}: {detail}")
    if not control_ok:
        print("  CONTROL FAILED — this scoreboard is not evidence.")
    return 0 if (not survived and not anchor and not void and control_ok) else 1


if __name__ == "__main__":
    sys.exit(main())
