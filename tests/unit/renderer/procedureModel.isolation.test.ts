/**
 * WP-27 · the renderer's procedure modules must not drag the intelligence core
 * — and its native sqlite — into the renderer process.
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
];

describe.each(RENDERER_MODULES)('%s', (modulePath) => {
  it('loads without pulling better-sqlite3 or the intelligence host into the graph', () => {
    require(modulePath);
    const loaded = Object.keys(require.cache);
    expect(loaded.filter((k) => k.includes('better-sqlite3'))).toEqual([]);
    expect(loaded.filter((k) => k.includes('intelligence-host'))).toEqual([]);
    expect(loaded.filter((k) => k.includes('src/intelligence/'))).toEqual([]);
  });
});
