/**
 * WP-32 · the scope carrier — the eight ratified pins of scope-block draft 2.
 *
 * The subject is a SELECTION becoming a SCOPE: cells (site, place) chosen at a
 * comparator, carried through the task frame into the arming, and equal to the
 * dry-run's target set on the other side. Every assertion below is one of the
 * eight pins or the widening ruling, named in its own `it`.
 *
 * THE RUNBOOK IS LOADED, NEVER AUTHORED (pin 7). `rb.bulk-plugin-update`'s
 * declared environments are read off the shipped document. A checkpoint
 * sequence — or a scope vocabulary — authored in a test is the same defect as
 * one authored in a design fixture, and this suite is where that would start.
 */
import * as path from 'path';
import {
  loadLawDirectory, RunbookRegistry } from '../../../intelligence';
import { CHAT_GRANTEE } from '../capabilityGrants';
import type { Runbook } from '../../../intelligence';
import type { ResolvedGrant } from '../capabilityGrants';
import {
  SCOPE_GROUP_ORDER,
  ScopeCell,
  ScopeSelection,
  checkDryRunTargets,
  deriveScope,
  placeLabel,
  placeToken,
  resolveScopeFrom,
  scopeBlockLines,
  selectedCells,
} from '../procedureScope';

const LAW_DIR = path.join(path.resolve(__dirname, '..', '..', '..', '..'), 'law');

function anchorRunbook(): Runbook {
  const registry = RunbookRegistry.build({ documents: loadLawDirectory(LAW_DIR).documents });
  const rb = registry.byCapability('cap.bulk_plugin_update');
  if (!rb) throw new Error('rb.bulk-plugin-update is not loadable — the fixture premise is gone');
  return rb;
}

function grantFor(rb: Runbook, scope?: ResolvedGrant['scope']): ResolvedGrant {
  const declared = (rb.frontmatter as { scope?: { environments?: string[] } }).scope?.environments;
  return {
    grantee: CHAT_GRANTEE,
    capability: rb.capability,
    runbookId: rb.id,
    runbookHash: rb.hash,
    strictness: rb.strictness,
    scope: scope ?? (declared ? { environments: [...declared] } : {}),
    source: 'shipped',
  };
}

const staging = { host: 'wpe', kind: 'staging' } as const;
const production = { host: 'wpe', kind: 'production' } as const;

const FROM = { surface: 'comparator', comparatorId: 'cmp.fleet-plugins', filter: 'plugin=woocommerce outdated=true' } as const;

/** The designer's draft-2 sheet, as CELLS: three staging, two production, one halted. */
function designerSelection(): ScopeSelection {
  return {
    from: FROM,
    cells: [
      { siteId: 's.alpha', siteName: 'Alpha', place: staging },
      { siteId: 's.bravo', siteName: 'Bravo', place: production },
      { siteId: 's.charlie', siteName: 'Charlie', place: staging },
      { siteId: 's.delta', siteName: 'Delta', place: production },
      { siteId: 's.echo', siteName: 'Echo', place: staging },
      {
        siteId: 's.foxtrot',
        siteName: 'Foxtrot',
        place: staging,
        excluded: {
          reason: 'halted, and said so',
          causedBy: { recordId: 'ev.7f31', topic: 'site.status.observed', observedAt: '2026-08-18T09:04:00.000Z' },
        },
      },
    ],
  };
}

const key = (c: ScopeCell) => `${c.siteId}|${placeToken(c.place)}`;
const keys = (cells: readonly ScopeCell[]) => cells.map(key).sort();

describe('WP-32 · the scope carrier', () => {
  describe('pin 1 · the scope unit is the CELL (site, place)', () => {
    it('tokenises a place into the runbook scope vocabulary, and labels it for a human', () => {
      expect(placeToken({ host: 'local' })).toBe('local');
      expect(placeToken(staging)).toBe('wpe_staging');
      expect(placeToken(production)).toBe('wpe_production');
      expect(placeToken({ host: 'external', kind: 'production' })).toBe('external_production');

      expect(placeLabel({ host: 'local' })).toBe('local');
      expect(placeLabel(staging)).toBe('staging');
      expect(placeLabel({ host: 'external', kind: 'production' })).toBe('external production');
    });

    it('keys two cells of the SAME SITE at different places apart', () => {
      const a: ScopeCell = { siteId: 's.alpha', siteName: 'Alpha', place: staging };
      const b: ScopeCell = { siteId: 's.alpha', siteName: 'Alpha', place: production };
      expect(key(a)).not.toBe(key(b));
    });
  });

  describe('pins 4 + 8 · the split by authority', () => {
    it('splits the designer selection into runs-now / needs-a-grant / excluded-by-world', () => {
      const rb = anchorRunbook();
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [grantFor(rb)] });

      expect(keys(scope.runnable)).toEqual(['s.alpha|wpe_staging', 's.charlie|wpe_staging', 's.echo|wpe_staging']);
      expect(keys(scope.barred)).toEqual(['s.bravo|wpe_production', 's.delta|wpe_production']);
      expect(keys(scope.excluded)).toEqual(['s.foxtrot|wpe_staging']);
    });

    it('orders the groups by AUTHORITY — runs-now, needs-a-grant, excluded-by-world', () => {
      expect(SCOPE_GROUP_ORDER).toEqual(['runnable', 'barred', 'excluded']);
    });

    it('pin 8 · the barred subset never blocks the runnable one — removing it changes nothing', () => {
      const rb = anchorRunbook();
      const full = designerSelection();
      const withoutProduction: ScopeSelection = {
        ...full,
        cells: full.cells.filter((c) => placeToken(c.place) !== 'wpe_production'),
      };

      const a = deriveScope({ selection: full, runbook: rb, grants: [grantFor(rb)] });
      const b = deriveScope({ selection: withoutProduction, runbook: rb, grants: [grantFor(rb)] });

      expect(keys(a.runnable)).toEqual(keys(b.runnable));
      expect(a.runnable).toHaveLength(3);
      expect(b.barred).toHaveLength(0);
    });

    it('pin 8, the other direction · the runnable subset never changes the barred one', () => {
      const rb = anchorRunbook();
      const full = designerSelection();
      const productionOnly: ScopeSelection = {
        ...full,
        cells: full.cells.filter((c) => placeToken(c.place) === 'wpe_production'),
      };

      const a = deriveScope({ selection: full, runbook: rb, grants: [grantFor(rb)] });
      const b = deriveScope({ selection: productionOnly, runbook: rb, grants: [grantFor(rb)] });

      expect(a.barred.map((c) => c.reason)).toEqual(b.barred.map((c) => c.reason));
      expect(keys(a.barred)).toEqual(keys(b.barred));
      expect(b.runnable).toHaveLength(0);
    });

    it('reads the allowed places off the GRANT — a settings override widens the runnable set', () => {
      const rb = anchorRunbook();
      const widened = grantFor(rb, { environments: ['local', 'wpe_staging', 'wpe_development', 'wpe_production'] });
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [widened] });

      expect(scope.barred).toHaveLength(0);
      expect(keys(scope.runnable)).toEqual([
        's.alpha|wpe_staging',
        's.bravo|wpe_production',
        's.charlie|wpe_staging',
        's.delta|wpe_production',
        's.echo|wpe_staging',
      ]);
    });

    it('a grant declaring NO environments bars nothing — absent is not "wrong"', () => {
      const rb = anchorRunbook();
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [grantFor(rb, {})] });
      expect(scope.barred).toHaveLength(0);
      expect(scope.runnable).toHaveLength(5);
    });

    it('no grant for the capability bars EVERY cell — a scope without a grant runs nothing', () => {
      const rb = anchorRunbook();
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [] });
      expect(scope.runnable).toHaveLength(0);
      expect(scope.barred).toHaveLength(5);
      expect(scope.excluded).toHaveLength(1);
    });
  });

  describe('pin 6 · the barred row carries the capability id and a door that resolves to that grant', () => {
    it('names the capability in the grants vocabulary — the key an override matches on', () => {
      const rb = anchorRunbook();
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [grantFor(rb)] });
      for (const cell of scope.barred) {
        expect(cell.capability).toBe(rb.capability);
        expect(cell.capability).toBe(cell.governDoor.capability);
      }
    });

    it('carries WP-31 governDoor SHAPE verbatim — structured target, never a URL', () => {
      const rb = anchorRunbook();
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [grantFor(rb)] });
      expect(scope.barred[0].governDoor).toEqual({
        surface: 'settings',
        section: 'capabilities',
        capability: 'cap.bulk_plugin_update',
        runbookId: 'rb.bulk-plugin-update',
      });
    });

    it('states the MISSING RUNBOOK VERSION honestly when no document declares the place', () => {
      const rb = anchorRunbook();
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [grantFor(rb)], catalogue: [rb] });
      expect(scope.barred[0].declaredIn).toBeNull();
      expect(scope.barred[0].reason).toContain('production');
      expect(scope.barred[0].reason).toContain('no runbook version declares');
    });

    it('names the document instead when one in the catalogue DOES declare the place', () => {
      const rb = anchorRunbook();
      const productionVariant = {
        ...rb,
        id: 'rb.bulk-plugin-update-production',
        version: '0.1.0',
        frontmatter: { ...rb.frontmatter, scope: { environments: ['wpe_production'] } },
      } as Runbook;
      const scope = deriveScope({
        selection: designerSelection(),
        runbook: rb,
        grants: [grantFor(rb)],
        catalogue: [rb, productionVariant],
      });
      expect(scope.barred[0].declaredIn).toEqual({ runbookId: 'rb.bulk-plugin-update-production', version: '0.1.0' });
      expect(scope.barred[0].reason).toContain('rb.bulk-plugin-update-production');
      expect(scope.barred[0].reason).not.toContain('no runbook version declares');
    });
  });

  describe('the excluded group derives from its CAUSING RECORD', () => {
    it('carries the record that removed the cell, not a sentence written beside it', () => {
      const rb = anchorRunbook();
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [grantFor(rb)] });
      expect(scope.excluded[0].causedBy).toEqual({
        recordId: 'ev.7f31',
        topic: 'site.status.observed',
        observedAt: '2026-08-18T09:04:00.000Z',
      });
      expect(scope.excluded[0].reason).toBe('halted, and said so');
    });

    it('an excluded cell is NEVER barred and never runnable — one cell, one group', () => {
      const rb = anchorRunbook();
      const selection = designerSelection();
      // Foxtrot is staging (runnable law) AND halted. The world outranks the grant.
      const scope = deriveScope({ selection, runbook: rb, grants: [grantFor(rb)] });
      const all = [...scope.runnable, ...scope.barred, ...scope.excluded].map(key);
      expect(all.filter((k) => k === 's.foxtrot|wpe_staging')).toHaveLength(1);
      expect(keys(scope.excluded)).toContain('s.foxtrot|wpe_staging');
    });

    it('the world outranks the GRANT — a halted cell at a BARRED place is excluded, not barred', () => {
      const rb = anchorRunbook();
      // The ordering this pins: a cell that is both halted AND at a place the
      // grant refuses must land in `excluded`. Granting the capability would not
      // start a halted site, so offering a Govern door here would promise
      // something the door cannot deliver.
      const selection: ScopeSelection = {
        from: FROM,
        cells: [
          {
            siteId: 's.golf',
            siteName: 'Golf',
            place: production,
            excluded: {
              reason: 'halted, and said so',
              causedBy: { recordId: 'ev.9a02', topic: 'site.status.observed', observedAt: '2026-08-18T09:10:00.000Z' },
            },
          },
        ],
      };
      const scope = deriveScope({ selection, runbook: rb, grants: [grantFor(rb)], catalogue: [rb] });

      expect(scope.excluded.map((c) => c.siteId)).toEqual(['s.golf']);
      expect(scope.barred).toEqual([]);
      expect(scope.runnable).toEqual([]);
    });

    it('every selected cell lands in exactly one group — nothing is dropped', () => {
      const rb = anchorRunbook();
      const selection = designerSelection();
      const scope = deriveScope({ selection, runbook: rb, grants: [grantFor(rb)] });
      const landed = [...scope.runnable, ...scope.barred, ...scope.excluded];
      expect(keys(landed)).toEqual(keys(selectedCells(selection)));
      expect(landed).toHaveLength(selection.cells.length);
    });
  });

  describe('pin 5 · the from-line resolves to the producing selection', () => {
    it('carries the comparator ref and the filter, verbatim', () => {
      const rb = anchorRunbook();
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [grantFor(rb)] });
      expect(scope.from).toEqual(FROM);
    });

    it('RESOLVES through a lookup — the pin tests resolution, not string format (XD-18)', () => {
      const rb = anchorRunbook();
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [grantFor(rb)] });
      const rendered = resolveScopeFrom(scope.from, (id) =>
        id === 'cmp.fleet-plugins' ? { title: 'Fleet · plugins' } : null
      );
      expect(rendered).toEqual({ title: 'Fleet · plugins' });
    });

    it('resolves to null when the comparator render is gone — never to a fabricated one', () => {
      const rb = anchorRunbook();
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [grantFor(rb)] });
      expect(resolveScopeFrom(scope.from, () => null)).toBeNull();
    });
  });

  describe('pin 2 · the dry-run target set equals the selected set minus barred and excluded', () => {
    it('accepts the runnable set, in any order — asserted as a SET', () => {
      const rb = anchorRunbook();
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [grantFor(rb)] });
      const shuffled = [...scope.runnable].reverse();
      const verdict = checkDryRunTargets(scope, shuffled);
      expect(verdict.ok).toBe(true);
      expect(verdict.unexpected).toEqual([]);
      expect(verdict.missing).toEqual([]);
    });

    it('FAILS a run that re-derived its own targets — a barred cell reappearing is the defect', () => {
      const rb = anchorRunbook();
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [grantFor(rb)] });
      const rederived = [...scope.runnable, ...scope.barred.map((b) => ({ siteId: b.siteId, siteName: b.siteName, place: b.place }))];
      const verdict = checkDryRunTargets(scope, rederived);
      expect(verdict.ok).toBe(false);
      expect(keys(verdict.unexpected)).toEqual(['s.bravo|wpe_production', 's.delta|wpe_production']);
      expect(verdict.missing).toEqual([]);
      expect(verdict.reason).toContain('did not come from the selection');
    });

    it('FAILS a run that quietly dropped a selected target', () => {
      const rb = anchorRunbook();
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [grantFor(rb)] });
      const verdict = checkDryRunTargets(scope, scope.runnable.slice(1));
      expect(verdict.ok).toBe(false);
      expect(keys(verdict.missing)).toEqual(['s.alpha|wpe_staging']);
      expect(verdict.unexpected).toEqual([]);
    });

    it('FAILS a run that reached an excluded cell — the world removed it, not the grant', () => {
      const rb = anchorRunbook();
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [grantFor(rb)] });
      const verdict = checkDryRunTargets(scope, [
        ...scope.runnable,
        { siteId: 's.foxtrot', siteName: 'Foxtrot', place: staging },
      ]);
      expect(verdict.ok).toBe(false);
      expect(keys(verdict.unexpected)).toEqual(['s.foxtrot|wpe_staging']);
    });

    it('the SAME SITE at another place is unexpected — the cell is the unit, not the site', () => {
      const rb = anchorRunbook();
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [grantFor(rb)] });
      const verdict = checkDryRunTargets(scope, [
        ...scope.runnable.slice(1),
        { siteId: 's.alpha', siteName: 'Alpha', place: production },
      ]);
      expect(verdict.ok).toBe(false);
      expect(keys(verdict.unexpected)).toEqual(['s.alpha|wpe_production']);
      expect(keys(verdict.missing)).toEqual(['s.alpha|wpe_staging']);
    });
  });

  describe('pin 3 · the scope block is four derived lines, plus the split groups', () => {
    it('renders targets, places-as-set, the barred group, the excludes and the from-line', () => {
      const rb = anchorRunbook();
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [grantFor(rb)], catalogue: [rb] });
      const lines = scopeBlockLines(scope);

      expect(lines).toEqual([
        'Targets: Alpha · staging, Charlie · staging, Echo · staging',
        'Places: production, staging',
        'Needs a grant: Bravo · production, Delta · production — cap.bulk_plugin_update does not run at production, and no runbook version declares it',
        'Excludes: Foxtrot · staging — halted, and said so',
        'From: cmp.fleet-plugins — plugin=woocommerce outdated=true',
      ]);
    });

    it('omits the groups it has nothing to say about — an absence is never rendered as a zero', () => {
      const rb = anchorRunbook();
      const selection: ScopeSelection = {
        from: FROM,
        cells: [{ siteId: 's.alpha', siteName: 'Alpha', place: staging }],
      };
      const lines = scopeBlockLines(deriveScope({ selection, runbook: rb, grants: [grantFor(rb)] }));
      expect(lines).toEqual([
        'Targets: Alpha · staging',
        'Places: staging',
        'From: cmp.fleet-plugins — plugin=woocommerce outdated=true',
      ]);
      expect(lines.join('\n')).not.toContain('Excludes');
      expect(lines.join('\n')).not.toContain('Needs a grant');
    });

    it('XD-21 · a zero-cell plan OPENS NO RUN, and the block still carries the derived plan', () => {
      const rb = anchorRunbook();
      const selection: ScopeSelection = {
        from: FROM,
        cells: [{ siteId: 's.bravo', siteName: 'Bravo', place: production }],
      };
      const scope = deriveScope({ selection, runbook: rb, grants: [grantFor(rb)], catalogue: [rb] });

      // The container rule: no consequence, no rank, no container. The surface
      // reads this flag to decide NOT to draw a run; the plan attaches anyway.
      expect(scope.opensRun).toBe(false);

      const lines = scopeBlockLines(scope);
      expect(lines).toEqual([
        'Targets: none — nothing in this selection runs under this grant',
        'Places: production',
        'Needs a grant: Bravo · production — cap.bulk_plugin_update does not run at production, and no runbook version declares it',
        'From: cmp.fleet-plugins — plugin=woocommerce outdated=true',
      ]);
    });

    it('XD-21 · a scope with runnable cells DOES open a run', () => {
      const rb = anchorRunbook();
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [grantFor(rb)] });
      expect(scope.opensRun).toBe(true);
    });

    it('renders ONE line per distinct barred reason — two reasons are never merged', () => {
      const rb = anchorRunbook();
      // Two barred cells whose reasons DIFFER (different places ⇒ different
      // sentences). Merging them under the first cell's reason would produce a
      // sentence that is true of neither.
      const selection: ScopeSelection = {
        from: FROM,
        cells: [
          { siteId: 's.bravo', siteName: 'Bravo', place: production },
          { siteId: 's.india', siteName: 'India', place: { host: 'external', kind: 'production' } },
        ],
      };
      const lines = scopeBlockLines(deriveScope({ selection, runbook: rb, grants: [grantFor(rb)], catalogue: [rb] }));
      const barredLines = lines.filter((l) => l.startsWith('Needs a grant:'));

      expect(barredLines).toEqual([
        'Needs a grant: Bravo · production — cap.bulk_plugin_update does not run at production, and no runbook version declares it',
        'Needs a grant: India · external production — cap.bulk_plugin_update does not run at external production, and no runbook version declares it',
      ]);
    });

    it('the places line is a SET, deduplicated and in canonical order', () => {
      const rb = anchorRunbook();
      const scope = deriveScope({ selection: designerSelection(), runbook: rb, grants: [grantFor(rb)] });
      expect(scope.places).toEqual(['wpe_production', 'wpe_staging']);
    });
  });
});
