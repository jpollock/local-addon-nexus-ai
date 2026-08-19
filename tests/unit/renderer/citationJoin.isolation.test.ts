/**
 * WP-34 · the claim→record join is ONE module with TWO consumers (ADR-24 P5),
 * and the second of them is the renderer. So its purity is not a style claim —
 * it is the precondition for the M5 corroboration render importing the same
 * code the eval sheet judges with, instead of a mirror that can disagree.
 *
 * MEASURED, not asserted, for the reason WP-27's sibling pin states: on this
 * branch `require('src/main/intelligence-host/procedureView')` loads 77 modules,
 * thirteen of them `better-sqlite3`, and under Electron that binary is the wrong
 * ABI. A module-scope require of anything in that neighbourhood would throw
 * NODE_MODULE_VERSION while the Docked Panel loads.
 *
 * The specific trap this file exists to catch is WP-24's: `import type` looks
 * exactly like an import and compiles to NOTHING, so purity that rests on a
 * reviewer noticing the word `type` is purity that lasts until the first edit.
 * `resolve.ts` imports `ContextBundle` that way today. A `require.cache`
 * measurement is indifferent to how the line was written.
 *
 * THIS FILE IMPORTS NOTHING FROM THE SEAM at module scope, deliberately — same
 * reasoning as `procedureModel.isolation.test.ts`: a graph assertion is only
 * worth the isolation it has, and a sibling import would poison the cache
 * before the assertion ran.
 */
const JOIN = '../../../src/intelligence/citation/resolve';

describe('src/intelligence/citation/resolve', () => {
  it('loads exactly one file of this codebase, and none of the heavy neighbourhood', () => {
    const before = new Set(Object.keys(require.cache));
    require(JOIN);
    const added = Object.keys(require.cache).filter((k) => !before.has(k));

    const ours = added.filter((k) => k.includes(`${require('path').sep}src${require('path').sep}`));
    // Exactly itself. Not "no sqlite" — a whitelist of one, so a new import of
    // ANY kind fails here and has to be argued for rather than noticed later.
    expect(ours.map((k) => k.replace(/\\/g, '/').replace(/^.*\/src\//, 'src/'))).toEqual([
      'src/intelligence/citation/resolve.ts',
    ]);

    expect(added.filter((k) => k.includes('better-sqlite3'))).toEqual([]);
    expect(added.filter((k) => k.includes('intelligence-host'))).toEqual([]);
    expect(added.filter((k) => k.includes('electron'))).toEqual([]);
  });

  it('imports NOTHING at runtime — including node builtins, which a graph walk cannot see', () => {
    // The require.cache measurement above is blind to builtins: `crypto` never
    // appears there, so `import { createHash } from 'crypto'` would slip
    // through it untouched — and a node builtin in a renderer bundle is a
    // POLYFILL, which is a second implementation of the one thing ADR-24 P5
    // says there must be exactly one of. So the source is read as well as the
    // graph, and the rule is absolute: every import in this file is a TYPE
    // import, erased at emit.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'intelligence', 'citation', 'resolve.ts'),
      'utf8'
    );
    const imports = src.split('\n').filter((l: string) => /^\s*(import|const .*= require\()/.test(l));
    expect(imports.length).toBeGreaterThan(0); // the type import is there
    for (const line of imports) {
      expect(line).toMatch(/^import type /);
    }
  });

  it('the core-only half stays core-only: convention.ts is NOT reachable from the join', () => {
    // `convention.ts` hashes, so it pulls a node builtin. In a renderer bundle
    // that is a polyfill, and a polyfill is a second implementation of the one
    // thing P5 says there must be one of. The split is only real if the join
    // cannot reach it.
    require(JOIN);
    expect(
      Object.keys(require.cache).filter((k) => k.includes('citation/convention'))
    ).toEqual([]);
  });
});
