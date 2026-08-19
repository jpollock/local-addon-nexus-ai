/**
 * WP-27 · the renderer's procedure modules must not drag the intelligence core
 * — and its native sqlite — into the renderer process.
 * WP-38 · and the blanket ban becomes an ALLOWLIST of provably-pure leaves,
 * because ADR-24 P5 requires the renderer to import one specific core module.
 *
 * MEASURED, not assumed. On this branch `require('src/main/intelligence-host/
 * procedureView')` loads 77 modules, thirteen of them `better-sqlite3`. In jest
 * that is harmless: better-sqlite3 is built for the shell's Node and the pretest
 * hook keeps it that way. In Local it is not — the renderer runs under Electron,
 * where the same binary is the wrong ABI, and a module-scope require would throw
 * NODE_MODULE_VERSION while the Docked Panel loads. An intelligence-layer failure
 * that breaks a panel predating the intelligence layer is the one thing this seam
 * may never do, so the shapes cross as `import type` and the values are mirrored.
 *
 * WHY THE BAN IS NO LONGER BLANKET, and why that is not a weakening.
 *
 * WP-34 registered this decision for the M5 surface packet rather than
 * pre-deciding it: "when M5 imports it, that blanket assertion needs to become
 * one that admits provably-pure leaves; this packet supplies the measurement
 * that makes the decision cheap." The measurement, re-taken here on every run:
 *
 *   require('…/DockedPanel/citationModel')  → 2 files of src/, one of them
 *                                             src/intelligence/citation/resolve.ts
 *   require('…/DockedPanel/PanelChat')      → 11 files of src/, the SAME one leaf
 *   better-sqlite3 / intelligence-host / electron: ZERO in every case
 *
 * The alternative was the mirror `procedureModel.ts` uses for `procedureView` —
 * and a mirror is precisely what ADR-24 P5 forbids here: the judge and the user
 * must resolve through ONE join, so that "the eval says it resolves" and "the
 * surface drew a quiet link" cannot come apart. A second implementation would
 * drift on the first edit and the drift would be invisible, because both halves
 * would still look right. The two seams differ in KIND, not in rigour: one
 * reaches a native module and must be mirrored, the other is a leaf with no
 * runtime imports at all and must not be.
 *
 * THE ALLOWLIST IS OF ONE, and it is a whitelist rather than a denylist: a new
 * intelligence import of ANY kind fails here and has to be argued for, which is
 * the same discipline `citationJoin.isolation.test.ts` applies inside the join.
 * The second describe below re-measures the leaf's own purity from THIS side,
 * rather than trusting the neighbouring suite — `require.cache` cannot see node
 * builtins, so a graph walk alone would let `import { createHash } from 'crypto'`
 * through, and a builtin in a renderer bundle is a polyfill, i.e. the second
 * implementation P5 forbids. That miss was WP-34's own M19 finding.
 *
 * THIS FILE IMPORTS NOTHING FROM THE SEAM, deliberately. An earlier version of
 * this pin lived beside the mirror tests, which import `procedureView` themselves
 * — so `require.cache` was already poisoned before the assertion ran and the pin
 * measured its own imports. A graph assertion is only worth the isolation it has.
 */
const RENDERER_MODULES = [
  '../../../src/renderer/components/DockedPanel/procedureModel',
  '../../../src/renderer/components/DockedPanel/procedureStream.fake',
  '../../../src/renderer/components/DockedPanel/ProcedureSurfaces',
  // WP-32. `procedureScope.ts` is pure TODAY — every one of its imports is
  // `import type` — which is exactly why its mirror is pinned here too: purity
  // is one careless value-import away from being false, and nothing would fail
  // until a user opened the panel.
  '../../../src/renderer/components/DockedPanel/scopeModel',
  '../../../src/renderer/components/DockedPanel/ScopeBlock',
  // WP-41. Same reasoning one step further out: `src/main/comparator/
  // siteAtPlaces.ts` imports `divergence`, `TwinStore`, `EntityService` and
  // `Ledger` as VALUES — it reaches the core and, through it, better-sqlite3.
  // The comparator's renderer half therefore crosses `import type` only, and a
  // single careless value import here would throw NODE_MODULE_VERSION at panel
  // load. This is the pin that catches it in jest instead.
  '../../../src/renderer/components/DockedPanel/comparatorModel',
  '../../../src/renderer/components/DockedPanel/SiteAtPlaces',
  '../../../src/renderer/components/DockedPanel/ComparatorPanel',
  // WP-38. These three are the ones that DO import the core, by design.
  '../../../src/renderer/components/DockedPanel/citationModel',
  '../../../src/renderer/components/DockedPanel/CitationSpans',
  // And the real consumer: the panel a user actually opens. Its whole graph is
  // measured, not just the new leaf's, because the ABI failure this file exists
  // to prevent happens at panel load and not at module load.
  '../../../src/renderer/components/DockedPanel/PanelChat',
];

/**
 * The `src/intelligence/` modules a renderer module may load.
 *
 * Membership is earned by MEASUREMENT, not by argument: the second describe
 * below reads each entry's source and requires every import in it to be a type
 * import. Adding a name here without that property passing is a red test, which
 * is the point — this list cannot be widened by assertion.
 */
const PROVABLY_PURE_LEAVES = ['src/intelligence/citation/resolve.ts'];

function normalize(cacheKey: string): string {
  return cacheKey.replace(/\\/g, '/').replace(/^.*\/src\//, 'src/');
}

describe.each(RENDERER_MODULES)('%s', (modulePath) => {
  it('loads without pulling better-sqlite3 or the intelligence host into the graph', () => {
    require(modulePath);
    const loaded = Object.keys(require.cache);
    expect(loaded.filter((k) => k.includes('better-sqlite3'))).toEqual([]);
    expect(loaded.filter((k) => k.includes('intelligence-host'))).toEqual([]);
    expect(loaded.filter((k) => k.includes('/electron/'))).toEqual([]);
  });

  it('loads no intelligence module outside the provably-pure allowlist', () => {
    require(modulePath);
    const intelligence = Object.keys(require.cache)
      .map(normalize)
      .filter((k) => k.startsWith('src/intelligence/'));
    // Subset, not equality: most of these modules load NONE, and requiring them
    // to load the leaf would make the allowlist a floor as well as a ceiling.
    for (const module of intelligence) {
      expect(PROVABLY_PURE_LEAVES).toContain(module);
    }
  });
});

describe('the allowlist is not vacuous', () => {
  it('the citation model really does load the leaf — the subset check has a subject', () => {
    // Without this, every "no intelligence module outside the allowlist"
    // assertion above would pass just as well against a renderer that imported
    // nothing at all, and the packet's whole isolation decision would be an
    // assertion about an empty set.
    require('../../../src/renderer/components/DockedPanel/citationModel');
    const intelligence = Object.keys(require.cache)
      .map(normalize)
      .filter((k) => k.startsWith('src/intelligence/'));
    expect(intelligence).toEqual(['src/intelligence/citation/resolve.ts']);
  });
});

describe('the allowlist is earned, not asserted', () => {
  const fs = require('fs');
  const path = require('path');

  it.each(PROVABLY_PURE_LEAVES)('%s imports NOTHING at runtime', (leaf: string) => {
    // The half a module graph cannot measure. `require.cache` never shows a node
    // builtin, so `crypto` would slip through the assertions above untouched —
    // and a builtin in a renderer bundle is a polyfill, which is a second
    // implementation of the one thing ADR-24 P5 says there must be one of.
    const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', leaf), 'utf8');
    const imports = source
      .split('\n')
      .filter((l: string) => /^\s*(import|const .*= require\()/.test(l));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) {
      expect(line).toMatch(/^import type /);
    }
  });

  it('names every allowlisted leaf as a file that exists', () => {
    // A stale entry would silently widen nothing and quietly stop measuring
    // anything, which is the failure mode of every allowlist.
    for (const leaf of PROVABLY_PURE_LEAVES) {
      expect(fs.existsSync(path.join(__dirname, '..', '..', '..', leaf))).toBe(true);
    }
  });
});
