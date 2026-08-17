/**
 * WP-20a · the five shipped runbooks, read from the law/ directory that
 * actually ships (`package.json` `files[]` carries `law`).
 *
 * Two things this suite exists to prevent:
 *
 *  1. **A silent drop.** Two of the five are over the strict ceiling ruled at
 *     WP-20 phase 1. They must be REFUSED with a reason naming the ceiling and
 *     the remedy, not quietly missing from the registry — a registry that
 *     drops them looks identical to one that never saw them, and the grant
 *     surface would then offer a capability with no procedure behind it.
 *  2. **Copy drift.** `law/runbooks/` is a verbatim copy of the authored
 *     originals under `docs/intelligence/anchor-slice/runbooks/` (the same
 *     duplication `law/policy/ops-default.md` already carries). §9-20a says
 *     that duplication wants a build step or a lint rather than a third copy;
 *     until it has one, this suite IS the lint.
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadLawDirectory } from '../law/loader';
import { RunbookRegistry, STRICT_RUNBOOK_CEILING_BYTES } from '../law/runbookRegistry';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const LAW_DIR = path.join(REPO_ROOT, 'law');
const AUTHORED_DIR = path.join(REPO_ROOT, 'docs', 'intelligence', 'anchor-slice', 'runbooks');

const RUNBOOK_FILES = [
  'bulk-plugin-update.md',
  'diagnose-site.md',
  'incident-response.md',
  'staging-promotion.md',
  'wpe-pull.md',
];

describe('the shipped law/ directory', () => {
  const load = () => {
    const { documents, errors } = loadLawDirectory(LAW_DIR);
    return { documents, loaderErrors: errors, registry: RunbookRegistry.build({ documents }) };
  };

  it('ships all five runbooks beside the policy set', () => {
    const { documents, loaderErrors } = load();

    expect(loaderErrors).toEqual([]);
    expect(documents.filter((d) => d.kind === 'runbook').map((d) => d.id).sort()).toEqual([
      'rb.bulk-plugin-update',
      'rb.diagnose-site',
      'rb.incident-response',
      'rb.staging-promotion',
      'rb.wpe-pull',
    ]);
    expect(documents.some((d) => d.id === 'pol.ops-default')).toBe(true);
  });

  it('loads the three runbooks within the ceiling', () => {
    const { registry } = load();

    expect(registry.runbooks().map((r) => r.id)).toEqual([
      'rb.bulk-plugin-update',
      'rb.diagnose-site',
      'rb.wpe-pull',
    ]);
  });

  it('refuses the two over-ceiling runbooks, naming the ceiling and the split remedy', () => {
    const { registry } = load();

    const refusals = registry.errors();
    expect(refusals.map((e) => e.runbookId).sort()).toEqual(['rb.incident-response', 'rb.staging-promotion']);
    for (const refusal of refusals) {
      expect(refusal.code).toBe('over-ceiling');
      expect(refusal.reason).toContain(String(STRICT_RUNBOOK_CEILING_BYTES));
      expect(refusal.reason).toMatch(/split/i);
    }
    // …and they are genuinely absent from the lookup surface, so nothing can
    // deliver half of one.
    expect(registry.byId('rb.incident-response')).toBeUndefined();
    expect(registry.byCapability('cap.incident_response')).toBeUndefined();
  });

  it('serves the anchor capability B-03 grants', () => {
    const rb = load().registry.byCapability('cap.bulk_plugin_update');

    expect(rb?.id).toBe('rb.bulk-plugin-update');
    expect(rb?.version).toBe('1.0.0');
    expect(rb?.strictness).toBe('strict');
    expect(rb?.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('carries the anchor runbook’s eight checkpoints in authored order', () => {
    const rb = load().registry.byCapability('cap.bulk_plugin_update')!;

    expect(rb.checkpoints.map((c) => c.id)).toEqual([
      'cp.consult-history',
      'cp.dry-run',
      'cp.approval',
      'cp.backup',
      'cp.canary',
      'cp.verify-canary',
      'cp.roll-fleet',
      'cp.report',
    ]);
  });

  it('reports every one of those checkpoints as narrative, because none declares attest yet', () => {
    // The four event/manifest attestations of design note §4 are AUTHORING that
    // 20b/20c own. Until they are declared, the honest answer for all eight is
    // "the platform heard about it" — and this is the pin that stops a UI from
    // ticking them as verified in the meantime.
    const rb = load().registry.byCapability('cap.bulk_plugin_update')!;

    expect(rb.checkpoints.every((c) => c.attest === 'narrative')).toBe(true);
    expect(rb.checkpoints.every((c) => c.evidence === undefined)).toBe(true);
  });

  it('keeps the guided runbooks’ steps as steps, with no checkpoints', () => {
    const { registry } = load();

    for (const id of ['rb.diagnose-site', 'rb.wpe-pull']) {
      const rb = registry.byId(id)!;
      expect(rb.strictness).toBe('guided');
      expect(rb.checkpoints).toEqual([]);
      expect(rb.steps.length).toBeGreaterThan(0);
    }
  });

  it('keeps each shipped runbook byte-identical to the authored original', () => {
    for (const file of RUNBOOK_FILES) {
      expect(fs.readFileSync(path.join(LAW_DIR, 'runbooks', file))).toEqual(
        fs.readFileSync(path.join(AUTHORED_DIR, file))
      );
    }
  });

  it('measures each runbook against the ceiling, and the measurements are the ruled ones', () => {
    // Recorded because the ceiling's whole value is that its boundary is a
    // known number rather than a feeling. Measured 2026-08-17.
    const { documents } = load();
    const bytes = Object.fromEntries(
      documents.filter((d) => d.kind === 'runbook').map((d) => [d.id, d.canonicalBytes])
    );

    expect(bytes).toEqual({
      'rb.bulk-plugin-update': 4858,
      'rb.diagnose-site': 8967,
      'rb.incident-response': 15853,
      'rb.staging-promotion': 10453,
      'rb.wpe-pull': 8359,
    });
    // The two refused are the two strict ones over 8 KB. diagnose-site and
    // wpe-pull are ALSO over it and load anyway, because they are guided and
    // the ruling scoped the ceiling to strict — see the note in
    // runbookRegistry.ts.
    expect(STRICT_RUNBOOK_CEILING_BYTES).toBe(8192);
  });
});
