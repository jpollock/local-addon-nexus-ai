/**
 * WP-47 · the DOM-reach inventory matches the code — in both directions.
 *
 * This is the test that turns the designer's phase-6 gate ("the inventory is empty") into a
 * number that can be counted rather than asserted, and phase 0's checklist into something a
 * later packet cannot silently invalidate.
 *
 * The two directions, and why both are needed:
 *   - a DECLARED reach with no marker in the code is a stale checklist entry;
 *   - a MARKED or TOKEN-BEARING line with no declaration is an unrecorded reach, which is
 *     the failure that matters — it is how the inventory would quietly stop being the
 *     honest measure of exposure the plan says it is.
 *
 * Every guard here is exercised against a synthetic tree that MUST fail it. A guard that has
 * never been seen to fire is decoration (PARALLEL_PROTOCOL, vacuous-guard shapes).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  REACHES,
  REPO_ROOT,
  SCAN_ROOT,
  MARKER_WINDOW,
  InventoryError,
  buildInventory,
  render,
  scanTree,
  scanVersionPins,
} from '../../../scripts/generate-dom-reach-inventory';

const TRACKED = path.join(REPO_ROOT, 'docs', 'intelligence', 'dom-reach-inventory.json');

function tmpTree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp47-reach-'));
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(root, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
  return root;
}

describe('the tracked inventory is what the generator produces', () => {
  it('is byte-identical to a fresh render — never hand-edited', () => {
    expect(fs.readFileSync(TRACKED, 'utf8')).toBe(render());
  });

  it('is deterministic: two renders over an unchanged tree agree', () => {
    expect(render()).toBe(render());
  });
});

describe('the inventory matches the code', () => {
  const scan = scanTree(SCAN_ROOT);

  it('finds at least one marked line for every declared reach', () => {
    for (const reach of REACHES) {
      const hits = scan.markers.filter((m) => m.id === reach.id);
      expect(`${reach.id}:${hits.length > 0}`).toBe(`${reach.id}:true`);
    }
  });

  it('declares every marker id found in the code', () => {
    const declared = new Set(REACHES.map((r) => r.id));
    const undeclared = [...new Set(scan.markers.map((m) => m.id))].filter((id) => !declared.has(id));
    expect(undeclared).toEqual([]);
  });

  it('finds no unrecorded reach anywhere under src/renderer', () => {
    expect(scan.unmarked.map((u) => `${u.file}:${u.line} [${u.token}]`)).toEqual([]);
  });

  it('scanned a real tree, not an empty one', () => {
    // A scan that silently found nothing would satisfy every assertion above.
    expect(scan.filesScanned).toBeGreaterThan(50);
    expect(scan.markers.length).toBeGreaterThanOrEqual(REACHES.length);
  });
});

describe('the phase-6 number is derived, and cannot be flattered', () => {
  const built = buildInventory() as {
    totals: { declared: number; open: number; accepted: number; markedLines: number };
    reaches: Array<{ id: string; status: string; contractItem: string | null; markedLines: number }>;
  };

  it('counts open reaches from their status rather than from an authored total', () => {
    expect(built.totals.open).toBe(built.reaches.filter((r) => r.status === 'open').length);
    expect(built.totals.accepted).toBe(built.reaches.filter((r) => r.status === 'accepted').length);
    expect(built.totals.declared).toBe(built.totals.open + built.totals.accepted);
  });

  it('gives every OPEN reach a contract item — an open reach with no replacement is not a plan', () => {
    for (const r of built.reaches.filter((x) => x.status === 'open')) {
      expect(`${r.id}:${r.contractItem ?? 'NONE'}`).not.toBe(`${r.id}:NONE`);
    }
  });

  it('requires an ACCEPTED reach to be permanent guest behaviour, not a deferred one', () => {
    // The one exemption from the phase-6 count is exactly that: an exemption. It carries no
    // contract item, because a reach that a contract item would retire belongs in `open`.
    for (const r of built.reaches.filter((x) => x.status === 'accepted')) {
      expect(r.contractItem).toBeNull();
    }
  });

  it('cites the recon for every reach, or says plainly that the recon did not assess it', () => {
    for (const r of REACHES) {
      const cited = r.reconCitation.includes('recon-01') || r.reconCitation.startsWith('not covered by recon-01');
      expect(`${r.id}:${cited}`).toBe(`${r.id}:true`);
    }
  });
});

describe('the guard fires — each failure mode reproduced against a synthetic tree', () => {
  it('fails on a reach token in code that no marker covers', () => {
    const root = tmpTree({
      'sneaky.ts': ['export function grab() {', "  return document.querySelector('.Window');", '}'].join('\n'),
    });
    const scan = scanTree(root);
    expect(scan.unmarked).toHaveLength(1);
    expect(scan.unmarked[0].token).toBe('.Window');
    expect(scan.unmarked[0].line).toBe(2);
    expect(() => buildInventory(scan)).toThrow(InventoryError);
    expect(() => buildInventory(scan)).toThrow(/UNRECORDED DOM REACH/);
  });

  it('fails on a marker whose id is not declared', () => {
    const root = tmpTree({
      'new.ts': ['// NEXUS-DOM-REACH: some-brand-new-reach', "const x = document.getElementById('Sidebar');", 'export default x;'].join('\n'),
    });
    const scan = scanTree(root);
    expect(scan.unmarked).toEqual([]);
    expect(() => buildInventory(scan)).toThrow(/MARKED BUT UNDECLARED — some-brand-new-reach/);
  });

  it('fails when a declaration has no marker left in the code', () => {
    // This is phase 6 working: when a reach is genuinely deleted, its declaration must go
    // too, and the build says so rather than leaving a checklist entry for absent code.
    const root = tmpTree({ 'clean.ts': 'export const nothing = 1;\n' });
    expect(() => buildInventory(scanTree(root))).toThrow(/DECLARED BUT UNMARKED/);
  });

  it('does not accept a marker further above than the declared window', () => {
    const filler = Array.from({ length: MARKER_WINDOW }, (_, i) => `// filler ${i}`);
    const root = tmpTree({
      'far.ts': ['// NEXUS-DOM-REACH: theme-class-read', ...filler, "const dark = el.classList.contains('Theme__Dark');", 'export default dark;'].join('\n'),
    });
    const scan = scanTree(root);
    expect(scan.unmarked).toHaveLength(1);
    expect(scan.unmarked[0].token).toBe('Theme__');
  });

  it('accepts a marker exactly at the edge of the window', () => {
    const filler = Array.from({ length: MARKER_WINDOW - 1 }, (_, i) => `// filler ${i}`);
    const root = tmpTree({
      'near.ts': ['// NEXUS-DOM-REACH: theme-class-read', ...filler, "const dark = el.classList.contains('Theme__Dark');", 'export default dark;'].join('\n'),
    });
    expect(scanTree(root).unmarked).toEqual([]);
  });
});

describe('the scan\'s stated limit is the one it actually has', () => {
  it('ignores comment lines, in all three comment shapes', () => {
    // Documented in the generator: this codebase discusses `.Window` and `Theme__Dark` at
    // length in prose, and a guard that fired on prose would be switched off. The limit is
    // pinned here so it stays a decision rather than becoming a surprise.
    const root = tmpTree({
      'prose.ts': [
        '// NEXUS-DOM-REACH: theme-class-read',
        "const dark = el.classList.contains('Theme__Dark');",
        '// we used to read .Window here',
        '/* and data-site-id here */',
        ' * and TID_SiteListSite_Span_SiteName here',
        'export default dark;',
      ].join('\n'),
    });
    expect(scanTree(root).unmarked).toEqual([]);
  });

  it('does NOT ignore a reach on a line that merely ends with a comment', () => {
    const root = tmpTree({
      'trailing.ts': ["const shell = document.querySelector('.Window'); // still a reach", 'export default shell;'].join('\n'),
    });
    expect(scanTree(root).unmarked).toHaveLength(1);
  });

  it('skips __tests__ directories, which reference these selectors as fixtures', () => {
    const root = tmpTree({
      '__tests__/fixture.ts': "export const html = '<div class=\"Window\" data-location=\"/main\"></div>';\n",
      'real.ts': 'export const n = 1;\n',
    });
    expect(scanTree(root).unmarked).toEqual([]);
  });
});

describe('the version-suffix sweep — permanent, not a one-off cleanup', () => {
  it('leaves no version-pinned local-components selector anywhere in the renderer', () => {
    expect(scanVersionPins(SCAN_ROOT).map((h) => `${h.file}:${h.line}`)).toEqual([]);
  });

  it('would have caught the selector WP-47 deleted', () => {
    // The exact string that shipped: pinned to v17.8.1 while Local ships local-components
    // 17.8.2 (recon-01 §7), so it had already stopped matching and nothing said so.
    const root = tmpTree({
      'pinned.ts': [
        'export const css = `',
        '  .TabNav_Items_ad_cY_v17-8-1 { white-space: nowrap !important; }',
        '`;',
      ].join('\n'),
    });
    const hits = scanVersionPins(root);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
  });

  it('leaves the pinned string alone where it now lives — in prose explaining its deletion', () => {
    const root = tmpTree({
      'prose.ts': ['// this used to carry `.TabNav_Items_ad_cY_v17-8-1`, deleted in WP-47', 'export const n = 1;'].join('\n'),
    });
    expect(scanVersionPins(root)).toEqual([]);
  });

  it('fails the build, not just the test', () => {
    const root = tmpTree({ 'pinned.ts': 'export const c = ".Foo_Bar_ab_cd_v17-8-1";\n' });
    expect(() => buildInventory(scanTree(SCAN_ROOT), scanVersionPins(root))).toThrow(
      /VERSION-PINNED SELECTOR/,
    );
  });
});
