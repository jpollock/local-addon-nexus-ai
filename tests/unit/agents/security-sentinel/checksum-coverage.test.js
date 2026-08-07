// tests/unit/agents/security-sentinel/checksum-coverage.test.js
'use strict';

// CHK-01 reported "passed" having verified ZERO files whenever api.wordpress.org had no manifest
// for the running version. The API answers HTTP 200 with {"checksums":false} — not 404, not an
// error — and `$data['checksums'] ?? []` does not rescue `false`, because false is not null. So
// $checksums stayed false, foreach ran zero times, $failures stayed empty, and the check
// concluded the site's core was intact.
//
// Live at the time of writing: version 7.0-RC4-62365 returns exactly that body, and a real site
// on this machine runs it. Any RC, nightly or locally-built core hits the same path.
//
// These are static assertions on the generated PHP because the check runs as a wp_eval string.

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../../../agents/security-sentinel/agent.js'), 'utf8'
);

/**
 * Pull the PHP body of a wp_eval template by a marker unique to it.
 * `global $wp_version;` appears three times (runCoreDiff, CHK-01, Tier 3 step 5a), so each
 * block must be anchored on something only it contains.
 */
function phpBlock(uniqueMarker) {
  const i = src.indexOf(uniqueMarker);
  if (i === -1) throw new Error(`marker not found: ${uniqueMarker}`);
  // The marker may sit anywhere inside the template, so expand backward to the opening
  // `code: \`` and forward to the closing backtick.
  const start = src.lastIndexOf('code: `', i);
  const end = src.indexOf('`,', i);
  if (start === -1 || end === -1) throw new Error(`could not bound template for: ${uniqueMarker}`);
  return src.slice(start, end);
}

const CHK01 = phpBlock("$failures[] = \"Error: File doesn't verify against checksum");
const CHK02 = phpBlock("$active = get_option('active_plugins'");
const STEP5A = phpBlock('$svn_url = "https://core.svn.wordpress.org/tags/');

describe('CHK-01 cannot pass without a manifest', () => {
  it('guards that the manifest is a non-empty array before iterating', () => {
    expect(CHK01).toMatch(/if\s*\(!is_array\(\$checksums\)\s*\|\|\s*count\(\$checksums\)\s*===\s*0\)/);
  });

  it('reports unavailable — not passed — when there is no manifest', () => {
    const guardIdx = CHK01.indexOf('!is_array($checksums)');
    const afterGuard = CHK01.slice(guardIdx, guardIdx + 400);
    expect(afterGuard).toContain("'status' => 'unavailable'");
    expect(afterGuard).toContain('exit;');
  });

  it('counts files actually compared, so a zero count cannot masquerade as a pass', () => {
    expect(CHK01).toContain('$verified++');
    expect(CHK01).toMatch(/if\s*\(\$verified\s*===\s*0\)/);
  });

  it('surfaces the skip as a finding rather than only logging it', () => {
    expect(src).toContain("id: 'CHK-01-SKIPPED'");
    expect(src).toContain("category: 'coverage-gap'");
  });

  it('the skip finding says absence of evidence, not absence of compromise', () => {
    const i = src.indexOf("id: 'CHK-01-SKIPPED'");
    const finding = src.slice(i, i + 900);
    expect(finding).toMatch(/not evidence that core is intact/i);
  });
});

describe('CHK-02 reports its own coverage', () => {
  it('guards the plugin manifest the same way', () => {
    expect(CHK02).toMatch(/if\s*\(!is_array\(\$files\)\s*\|\|\s*count\(\$files\)\s*===\s*0\)/);
  });

  it('counts how many active plugins the 30-plugin cap dropped', () => {
    expect(CHK02).toMatch(/\$capped\s*=\s*max\(0,\s*count\(\$active\)\s*-\s*30\)/);
    expect(CHK02).toContain("'capped' => $capped");
  });

  it('emits unverifiable plugins as a finding, not just an info line', () => {
    expect(src).toContain("id: 'CHK-02-PARTIAL'");
    expect(src).toContain("category: 'coverage-gap'");
  });
});

describe('Tier 3 step 5a cannot claim to have restored core it never read', () => {
  it('guards the manifest before the restore loop', () => {
    expect(STEP5A).toMatch(/if\s*\(!is_array\(\$checksums\)\s*\|\|\s*count\(\$checksums\)\s*===\s*0\)/);
  });

  it('returns an explicit error rather than an empty still_failing', () => {
    const i = STEP5A.indexOf('!is_array($checksums)');
    const after = STEP5A.slice(i, i + 400);
    expect(after).toContain('could NOT be restored or verified');
  });
});

describe('A step that could not run does not score as passed', () => {
  // Every verification mode infers success from absence, so a step that bailed out early looks
  // identical to one that finished cleanly. step 5a returns `still_failing: []` in both cases.
  it('executeChecklist reads an error field out of the payload', () => {
    expect(src).toContain('let payloadError = null;');
    expect(src).toMatch(/if\s*\(p && typeof p === 'object' && p\.error\)\s*payloadError/);
  });

  it('the error branch is checked BEFORE verifyKey, so it cannot be outvoted', () => {
    const errIdx = src.indexOf('if (payloadError) {');
    const keyIdx = src.indexOf('} else if (item.verifyKey) {');
    expect(errIdx).toBeGreaterThan(-1);
    expect(keyIdx).toBeGreaterThan(errIdx);
  });

  it('the error branch fails the step', () => {
    const i = src.indexOf('if (payloadError) {');
    const branch = src.slice(i, i + 200);
    expect(branch).toContain('stepPassed = false');
    expect(branch).toContain('could not run');
  });
});

describe('The PHP null-coalescing trap does not recur', () => {
  // `?? []` is correct only when the absent case is null/undefined. Every checksum endpoint here
  // returns `false` instead, so `??` must always be paired with a shape check.
  it('every `?? []` on a checksums/files variable is guarded before it is iterated', () => {
    const coalesces = [...src.matchAll(/\$(checksums|files)\s*=\s*[^;]*\?\?\s*\[\];/g)];
    expect(coalesces.length).toBeGreaterThan(0);

    for (const m of coalesces) {
      const varName = m[1];
      // The guard must land between the assignment and the loop that consumes the value —
      // measuring by character distance breaks the moment a comment is added.
      const rest = src.slice(m.index + m[0].length);
      const loopIdx = rest.search(/foreach\s*\(\s*\$(checksums|files)\b/);
      expect(loopIdx).toBeGreaterThan(-1);

      const between = rest.slice(0, loopIdx);
      const line = src.slice(0, m.index).split('\n').length;
      expect(
        new RegExp(`is_array\\(\\$${varName}\\)`).test(between),
      ).toBe(true /* unguarded coalesce at agent.js line ${line} */);
    }
  });
});

describe('The real API bodies that caused this are pinned', () => {
  // Recorded from api.wordpress.org. If these ever change shape the guard needs revisiting;
  // no network call is made here.
  const NO_MANIFEST = JSON.parse('{"checksums":false}');

  it('an unpublished version yields false, which `?? []` does not rescue', () => {
    const coalesced = NO_MANIFEST.checksums ?? [];
    expect(coalesced).toBe(false);          // the bug, in one line
    expect(Array.isArray(coalesced)).toBe(false);
  });

  it('the guard condition rejects it', () => {
    const c = NO_MANIFEST.checksums ?? [];
    const rejected = !Array.isArray(c) || Object.keys(c).length === 0;
    expect(rejected).toBe(true);
  });

  it('the guard condition accepts a real manifest', () => {
    const real = { 'wp-admin/about.php': 'abc123', 'wp-load.php': 'def456' };
    const rejected = !Array.isArray(Object.keys(real)) || Object.keys(real).length === 0;
    expect(rejected).toBe(false);
  });
});
