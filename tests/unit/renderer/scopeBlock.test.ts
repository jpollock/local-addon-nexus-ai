/**
 * WP-32 · the scope block's two pins — byte-identity, and the mirror.
 *
 * XD-15's headline requirement for the render is that the block's text is
 * BYTE-IDENTICAL in the selection bar, the companion head and the stage head.
 * XD-20 generalises it: density changes rendering, never facts. Both are
 * enforced structurally — one function renders the lines and the three surfaces
 * choose only a frame — and both are pinned here anyway, because "we made it
 * structurally impossible" is a claim a future refactor can quietly falsify.
 *
 * The second pin is the mirror. `scopeModel.ts` restates `scopeBlockLines` and
 * `placeLabel` because a VALUE import from `src/main/intelligence-host/` drags
 * better-sqlite3 into the renderer bundle (measured in `procedureModel.ts`'s
 * header). This suite runs BOTH copies over one shared case table — the standing
 * pattern for `localDay`, `resolveAgentCron`/`effectiveCadenceExpression` and
 * `ATTEST_WORDS`. If the copies drift, one of these cases goes red.
 */
import * as React from 'react';

import { serializeTree } from './helpers/serializeTree';
import * as seam from '../../../src/main/intelligence-host/procedureScope';
import {
  FIXTURE_SELECTION,
  SCOPE_BLOCK_SURFACES,
  hasGovernDoor,
  placeLabel,
  scopeBlockLines,
} from '../../../src/renderer/components/DockedPanel/scopeModel';
import { ScopeBlock } from '../../../src/renderer/components/DockedPanel/ScopeBlock';
import type { ProcedureScope, ScopePlace } from '../../../src/main/intelligence-host/procedureScope';
import type { ScopeBlockSurface } from '../../../src/renderer/components/DockedPanel/scopeModel';

const RUNBOOK = {
  id: 'rb.bulk-plugin-update',
  version: '1.2.0',
  capability: 'cap.bulk_plugin_update',
  frontmatter: { scope: { environments: ['local', 'wpe_staging', 'wpe_development'] } },
};

const GRANT = {
  capability: 'cap.bulk_plugin_update',
  runbookId: 'rb.bulk-plugin-update',
  runbookHash: 'sha256:deadbeef',
  strictness: 'strict' as const,
  scope: { environments: ['local', 'wpe_staging', 'wpe_development'] },
  source: 'shipped' as const,
};

function fixtureScope(): ProcedureScope {
  return seam.deriveScope({
    selection: FIXTURE_SELECTION,
    runbook: RUNBOOK,
    grants: [GRANT],
    catalogue: [RUNBOOK],
  });
}

/**
 * THE SHARED CASE TABLE. Every case runs through both the seam and the mirror.
 * Deliberately spans the branches that differ: the split state, the unsplit
 * state, the zero-run state (XD-21), a local place, an external place, and a
 * scope whose two barred cells share a reason (the group-by-reason branch).
 */
const CASES: Array<{ name: string; scope: () => ProcedureScope }> = [
  { name: 'the designer split state (3 run, 2 barred, 1 excluded)', scope: fixtureScope },
  {
    name: 'unsplit — everything runs',
    scope: () =>
      seam.deriveScope({
        selection: {
          from: FIXTURE_SELECTION.from,
          cells: FIXTURE_SELECTION.cells.filter(
            (c) => seam.placeToken(c.place) === 'wpe_staging' && !c.excluded
          ),
        },
        runbook: RUNBOOK,
        grants: [GRANT],
      }),
  },
  {
    name: 'XD-21 — zero cells run',
    scope: () =>
      seam.deriveScope({
        selection: {
          from: FIXTURE_SELECTION.from,
          cells: FIXTURE_SELECTION.cells.filter((c) => seam.placeToken(c.place) === 'wpe_production'),
        },
        runbook: RUNBOOK,
        grants: [GRANT],
        catalogue: [RUNBOOK],
      }),
  },
  {
    name: 'two barred cells whose reasons DIFFER (two group lines)',
    scope: () =>
      seam.deriveScope({
        selection: {
          from: FIXTURE_SELECTION.from,
          cells: [
            { siteId: 's.bravo', siteName: 'Bravo', place: { host: 'wpe', kind: 'production' } },
            { siteId: 's.india', siteName: 'India', place: { host: 'external', kind: 'production' } },
          ],
        },
        runbook: RUNBOOK,
        grants: [GRANT],
        catalogue: [RUNBOOK],
      }),
  },
  {
    name: 'a local place and an external one',
    scope: () =>
      seam.deriveScope({
        selection: {
          from: FIXTURE_SELECTION.from,
          cells: [
            { siteId: 's.hotel', siteName: 'Hotel', place: { host: 'local' } },
            { siteId: 's.india', siteName: 'India', place: { host: 'external', kind: 'production' } },
          ],
        },
        runbook: RUNBOOK,
        grants: [GRANT],
        catalogue: [RUNBOOK],
      }),
  },
];

const PLACES: ScopePlace[] = [
  { host: 'local' },
  { host: 'wpe', kind: 'staging' },
  { host: 'wpe', kind: 'production' },
  { host: 'wpe', kind: 'development' },
  { host: 'external', kind: 'production' },
  { host: 'external', kind: 'staging' },
];

/**
 * Render the component's own output, not an element referencing it — the
 * `serializeTree` helper's own documented limitation, and the house pattern
 * (`procedureSurfaces.test.tsx` does the same). No react-dom, which this repo
 * carries only as a peer dependency resolved from Local's runtime.
 */
function render(props: { scope: ProcedureScope; surface: ScopeBlockSurface; onGovern?: (d: unknown) => void }): unknown {
  return serializeTree(new (ScopeBlock as any)(props).render());
}

/** Every string in a rendered tree, in document order. */
function textsOf(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => textsOf(n, out));
    return out;
  }
  if (node && typeof node === 'object') {
    textsOf((node as { children?: unknown }).children, out);
  }
  return out;
}

/** Every element's props, flattened — for the door's data attributes. */
function propsOf(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    node.forEach((n) => propsOf(n, out));
    return out;
  }
  if (node && typeof node === 'object') {
    const el = node as { props?: Record<string, unknown>; children?: unknown };
    if (el.props) out.push(el.props);
    propsOf(el.children, out);
  }
  return out;
}

describe('WP-32 · the scope block', () => {
  describe('the mirror is pinned to the seam (shared case table)', () => {
    it.each(PLACES.map((p) => [seam.placeToken(p), p] as const))(
      'placeLabel agrees for %s',
      (_token, place) => {
        expect(placeLabel(place)).toBe(seam.placeLabel(place));
      }
    );

    it.each(CASES.map((c) => [c.name, c] as const))('scopeBlockLines agrees for %s', (_name, testCase) => {
      const scope = testCase.scope();
      const mirrored = scopeBlockLines(scope);
      const original = seam.scopeBlockLines(scope);
      // Length asserted separately: an equal-but-shorter list would pass a naive
      // element-wise comparison against an empty tail (WP-26's absent-vs-present).
      expect(mirrored).toHaveLength(original.length);
      expect(mirrored.join('\n')).toBe(original.join('\n'));
    });

    it('the case table actually exercises the branches it claims to', () => {
      const scopes = CASES.map((c) => c.scope());
      expect(scopes.some((s) => s.barred.length > 0)).toBe(true);
      expect(scopes.some((s) => s.barred.length === 0)).toBe(true);
      expect(scopes.some((s) => s.excluded.length > 0)).toBe(true);
      expect(scopes.some((s) => !s.opensRun)).toBe(true);
      expect(scopes.some((s) => s.opensRun)).toBe(true);
      // The multi-reason branch: without a case where two barred cells carry
      // DIFFERENT reasons, a mirror that flattened the grouping would survive.
      expect(scopes.some((s) => new Set(s.barred.map((c) => c.reason)).size > 1)).toBe(true);
    });
  });

  describe('XD-15 · byte-identical across the three surfaces', () => {
    it('renders the SAME text in the selection bar, the companion head and the stage head', () => {
      const scope = fixtureScope();
      const texts = SCOPE_BLOCK_SURFACES.map((surface) => textsOf(render({ scope, surface })));

      expect(new Set(texts.map((t) => t.join('\n'))).size).toBe(1);
      // And the one text is the derived one, not something the component composed.
      expect(texts[0].slice(0, scopeBlockLines(scope).length)).toEqual(scopeBlockLines(scope));
    });

    it('holds for EVERY case in the table, including the zero-run one', () => {
      for (const testCase of CASES) {
        const scope = testCase.scope();
        const texts = SCOPE_BLOCK_SURFACES.map((surface) =>
          textsOf(render({ scope, surface })).join('\n')
        );
        expect([testCase.name, new Set(texts).size]).toEqual([testCase.name, 1]);
        // The derived lines LEAD the render; the door's label follows them and is
        // a control, not a line. Slicing (rather than comparing whole) keeps this
        // pin about the lines instead of quietly re-asserting the door's copy.
        const lines = scopeBlockLines(scope);
        expect([testCase.name, texts[0].split('\n').slice(0, lines.length).join('\n')]).toEqual([
          testCase.name,
          lines.join('\n'),
        ]);
      }
    });

    it('the three surfaces DO differ in frame — otherwise the pin proves nothing', () => {
      const scope = fixtureScope();
      const frames = SCOPE_BLOCK_SURFACES.map((surface) =>
        JSON.stringify(render({ scope, surface }))
      );
      expect(new Set(frames).size).toBe(SCOPE_BLOCK_SURFACES.length);
    });
  });

  describe('the barred group renders its door', () => {
    it('carries the capability and runbook the door resolves to', () => {
      const doors = propsOf(render({ scope: fixtureScope(), surface: 'companion-head' })).filter(
        (p) => p['data-govern-capability']
      );
      expect(doors).toHaveLength(1);
      expect(doors[0]['data-govern-capability']).toBe('cap.bulk_plugin_update');
      expect(doors[0]['data-govern-runbook']).toBe('rb.bulk-plugin-update');
      expect(hasGovernDoor(fixtureScope())).toBe(true);
    });

    it('renders ONE door for a scope whose barred cells share a grant', () => {
      const scope = fixtureScope();
      expect(scope.barred).toHaveLength(2);
      const doors = propsOf(render({ scope, surface: 'companion-head' })).filter(
        (p) => p['data-govern-capability']
      );
      expect(doors).toHaveLength(1);
    });

    it('renders NO door when nothing is barred', () => {
      const scope = CASES[1].scope();
      expect(scope.barred).toHaveLength(0);
      const doors = propsOf(render({ scope, surface: 'companion-head' })).filter(
        (p) => p['data-govern-capability']
      );
      expect(doors).toEqual([]);
      expect(hasGovernDoor(scope)).toBe(false);
    });

    it('the door is a LAUNCHER — it hands the structured target out and grants nothing', () => {
      const seen: unknown[] = [];
      const scope = fixtureScope();
      const tree = render({ scope, surface: 'stage-head', onGovern: (door) => seen.push(door) });
      // Rendering alone must not fire it: a door that grants on render is not a door.
      expect(seen).toEqual([]);
      // The handler IS wired — a door that renders without one is a dead control.
      const door = propsOf(tree).find((p) => p['data-govern-capability']);
      expect(door!.onClick).toBe('[fn]');
      expect(door!.disabled).toBe(false);
    });
  });

  describe('XD-21 · a zero-cell plan draws no run container', () => {
    it('marks the block as opening no run', () => {
      const scope = CASES[2].scope();
      expect(scope.opensRun).toBe(false);
      const tree = render({ scope, surface: 'companion-head' });
      const all = propsOf(tree);
      expect(all[0]['data-scope-opens-run']).toBe('false');
      // The plan still attaches — the refusal is a turn with the plan, not a silence.
      expect(textsOf(tree).some((t) => t.startsWith('Needs a grant'))).toBe(true);
      expect(all.some((p) => p['data-govern-capability'])).toBe(true);
    });
  });
});
