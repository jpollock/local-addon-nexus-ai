/**
 * WP-32 · the CARRY — renderer selection → task frame → arming → dry-run.
 *
 * `procedureScope.test.ts` pins what a scope IS. This pins that it TRAVELS: the
 * arming request holds it, the declared procedure hands it on, and the dry-run
 * is measured against the thing that was carried rather than against a fresh
 * derivation. Pin 2's headline — "a run that re-derives its own targets fails" —
 * only means anything if there is something carried to disagree with.
 *
 * PARITY IS PINNED HERE TOO, and it is the reason for the `Object.keys` style
 * below rather than `toEqual`: WP-26's finding is that `toEqual` cannot tell an
 * absent key from a present-and-undefined one, and "no selection ⇒ byte-identical
 * everything" is exactly an absent-vs-present assertion. A `scope: undefined`
 * field would satisfy `toEqual` and break the parity it claims to prove.
 */
import type { ProcedureDelivery } from '../../../intelligence';
import {
  clearArmingRequests,
  peekArmingRequests,
  recordArmingRequest,
  takeArmingRequests,
} from '../procedureArming';
import { checkDryRunTargets, deriveScope, ProcedureScope, ScopeSelection } from '../procedureScope';
import { deriveDeclaredProcedure } from '../procedureView';

const staging = { host: 'wpe', kind: 'staging' } as const;
const production = { host: 'wpe', kind: 'production' } as const;

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

const SELECTION: ScopeSelection = {
  from: { surface: 'comparator', comparatorId: 'cmp.fleet-plugins', filter: 'outdated=true' },
  cells: [
    { siteId: 's.alpha', siteName: 'Alpha', place: staging },
    { siteId: 's.bravo', siteName: 'Bravo', place: production },
  ],
};

function scope(): ProcedureScope {
  return deriveScope({ selection: SELECTION, runbook: RUNBOOK, grants: [GRANT] });
}

const DELIVERY: ProcedureDelivery = {
  status: 'delivered',
  capability: 'cap.bulk_plugin_update',
  runbookId: 'rb.bulk-plugin-update',
  version: '1.2.0',
  hash: 'sha256:deadbeef',
  strictness: 'strict',
  armedBy: 'model-request',
  assertFull: true,
  bodyDelivered: true,
  checkpoints: [],
  steps: [],
  tokens: 0,
};

describe('WP-32 · the arming carries the scope', () => {
  beforeEach(() => clearArmingRequests());
  afterEach(() => clearArmingRequests());

  describe('the arming request', () => {
    it('carries the scope it was recorded with, through a PEEK', () => {
      recordArmingRequest('cap.bulk_plugin_update', new Date('2026-08-18T10:00:00Z'), scope());
      const [pending] = peekArmingRequests();
      expect(pending.scope?.runnable.map((c) => c.siteId)).toEqual(['s.alpha']);
      expect(pending.scope?.barred.map((c) => c.siteId)).toEqual(['s.bravo']);
    });

    it('carries it through a DRAIN — the turn that delivers the procedure gets the scope', () => {
      recordArmingRequest('cap.bulk_plugin_update', new Date('2026-08-18T10:00:00Z'), scope());
      const [taken] = takeArmingRequests();
      expect(taken.scope?.from.comparatorId).toBe('cmp.fleet-plugins');
      expect(takeArmingRequests()).toEqual([]);
    });

    it('PARITY · a request recorded without a scope has NO scope key at all', () => {
      recordArmingRequest('cap.bulk_plugin_update', new Date('2026-08-18T10:00:00Z'));
      const [pending] = peekArmingRequests();
      expect(Object.keys(pending).sort()).toEqual(['at', 'capability']);
      expect('scope' in pending).toBe(false);
    });
  });

  describe('the declared procedure', () => {
    it('hands the carried scope on, unchanged', () => {
      const carried = scope();
      const declared = deriveDeclaredProcedure({ outcome: DELIVERY, scope: carried });
      expect(declared!.scope).toBe(carried);
    });

    it('PARITY · no scope carried ⇒ NO scope key on the declared procedure', () => {
      const declared = deriveDeclaredProcedure({ outcome: DELIVERY });
      expect('scope' in declared!).toBe(false);
    });

    it('PARITY · a declared procedure with no scope is byte-identical to the pre-WP-32 build', () => {
      const before = deriveDeclaredProcedure({ outcome: DELIVERY });
      const withScope = deriveDeclaredProcedure({ outcome: DELIVERY, scope: scope() });
      const { scope: _dropped, ...rest } = withScope!;
      expect(JSON.stringify(rest)).toBe(JSON.stringify(before));
    });

    it('a REFUSAL carries no scope even when one was selected — nothing is armed to scope', () => {
      const declared = deriveDeclaredProcedure({
        outcome: {
          status: 'refused',
          capability: 'cap.bulk_plugin_update',
          code: 'hash-mismatch',
          runbookId: 'rb.bulk-plugin-update',
          reason: 'the document on disk is not the reviewed one',
          tokens: 0,
        },
        scope: scope(),
      });
      expect('scope' in declared!).toBe(false);
    });
  });

  describe('the far end · the dry-run is measured against what was CARRIED', () => {
    it('a plan matching the carried runnable set passes', () => {
      recordArmingRequest('cap.bulk_plugin_update', new Date('2026-08-18T10:00:00Z'), scope());
      const [armed] = takeArmingRequests();
      const verdict = checkDryRunTargets(armed.scope!, [
        { siteId: 's.alpha', siteName: 'Alpha', place: staging },
      ]);
      expect(verdict.ok).toBe(true);
    });

    it('a plan that RE-DERIVED its targets from the runbook fails at the far end', () => {
      recordArmingRequest('cap.bulk_plugin_update', new Date('2026-08-18T10:00:00Z'), scope());
      const [armed] = takeArmingRequests();

      // The defect this packet exists to catch: the model reads "bulk plugin
      // update" and works out its own fleet, which happens to include a site
      // the human never selected.
      const rederived = [
        { siteId: 's.alpha', siteName: 'Alpha', place: staging },
        { siteId: 's.golf', siteName: 'Golf', place: staging },
      ];
      const verdict = checkDryRunTargets(armed.scope!, rederived);
      expect(verdict.ok).toBe(false);
      expect(verdict.unexpected.map((c) => c.siteId)).toEqual(['s.golf']);
      expect(verdict.reason).toContain('The arming carried the scope');
    });
  });

  describe('the widening ruling · nothing here extends a run', () => {
    it('exposes no way to add a cell to an existing scope — a widening is a SECOND run', async () => {
      const mod = (await import('../procedureScope')) as Record<string, unknown>;
      const wideners = Object.keys(mod).filter((k) => /widen|extend|addTarget|addCell|merge/i.test(k));
      expect(wideners).toEqual([]);
    });

    it('the second run is born pre-scoped to the barred cells, carrying the SAME from-line', () => {
      const first = scope();
      // What the door promises, built from the first scope's own barred group:
      // the continuity is the shared ancestor, not a resumed session.
      const second = deriveScope({
        selection: {
          from: first.from,
          cells: first.barred.map((c) => ({ siteId: c.siteId, siteName: c.siteName, place: c.place })),
        },
        runbook: { ...RUNBOOK, id: 'rb.bulk-plugin-update-production', frontmatter: { scope: { environments: ['wpe_production'] } } },
        grants: [{ ...GRANT, runbookId: 'rb.bulk-plugin-update-production', scope: { environments: ['wpe_production'] } }],
      });

      expect(second.from).toEqual(first.from);
      expect(second.runnable.map((c) => c.siteId)).toEqual(['s.bravo']);
      // And the first run is untouched by the second existing.
      expect(first.runnable.map((c) => c.siteId)).toEqual(['s.alpha']);
      expect(first.barred.map((c) => c.siteId)).toEqual(['s.bravo']);
    });
  });
});
