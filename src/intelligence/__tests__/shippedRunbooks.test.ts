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
import { documentHash } from '../law/hash';
import { loadLawDirectory } from '../law/loader';
import { RunbookRegistry, STRICT_RUNBOOK_CEILING_BYTES } from '../law/runbookRegistry';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const LAW_DIR = path.join(REPO_ROOT, 'law');
const AUTHORED_DIR = path.join(REPO_ROOT, 'docs', 'intelligence', 'anchor-slice', 'runbooks');

const RUNBOOK_FILES = [
  'bulk-plugin-update.md',
  'diagnose-site.md',
  'incident-containment.md',
  'incident-remediation.md',
  'promotion-execute.md',
  'promotion-preflight.md',
  'wpe-pull.md',
];

describe('the shipped law/ directory', () => {
  const load = () => {
    const { documents, errors } = loadLawDirectory(LAW_DIR);
    return { documents, loaderErrors: errors, registry: RunbookRegistry.build({ documents }) };
  };

  it('ships all seven runbooks beside the policy set', () => {
    const { documents, loaderErrors } = load();

    expect(loaderErrors).toEqual([]);
    expect(documents.filter((d) => d.kind === 'runbook').map((d) => d.id).sort()).toEqual([
      'rb.bulk-plugin-update',
      'rb.diagnose-site',
      'rb.incident-containment',
      'rb.incident-remediation',
      'rb.promotion-execute',
      'rb.promotion-preflight',
      'rb.wpe-pull',
    ]);
    expect(documents.some((d) => d.id === 'pol.ops-default')).toBe(true);
  });

  it('serves every one of them — WP-20c split the two that did not fit', () => {
    const { registry } = load();

    expect(registry.runbooks().map((r) => r.id)).toEqual([
      'rb.bulk-plugin-update',
      'rb.diagnose-site',
      'rb.incident-containment',
      'rb.incident-remediation',
      'rb.promotion-execute',
      'rb.promotion-preflight',
      'rb.wpe-pull',
    ]);
  });

  it('refuses nothing, and the two documents that were refused are gone by name', () => {
    const { registry } = load();

    // An empty refusal list is a CLAIM about the shipped set, not an absence of
    // machinery: `runbookRegistry.test.ts` pins the refusal paths over fixtures,
    // and this pin is what fails the day an authored edit pushes a strict
    // runbook back over the ceiling.
    expect(registry.errors()).toEqual([]);
    expect(registry.byId('rb.incident-response')).toBeUndefined();
    expect(registry.byId('rb.staging-promotion')).toBeUndefined();
    expect(registry.byCapability('cap.incident_response')).toBeUndefined();
  });

  it('keeps every strict runbook inside the ceiling that the turn carrier delivers', () => {
    const { registry } = load();

    for (const rb of registry.runbooks({ strictness: 'strict' })) {
      expect({ id: rb.id, over: rb.canonicalBytes > STRICT_RUNBOOK_CEILING_BYTES }).toEqual({
        id: rb.id,
        over: false,
      });
    }
  });

  it('carries the canonical text the hash covers — one string for pin, ceiling and delivery', () => {
    const { registry } = load();

    for (const rb of registry.runbooks()) {
      expect(documentHash(rb.canonicalText)).toBe(rb.hash);
      expect(Buffer.byteLength(rb.canonicalText, 'utf8')).toBe(rb.canonicalBytes);
      // The obligations live in the frontmatter, so the delivered text must
      // contain them — a body-only payload would ship prose and drop contract.
      expect(rb.canonicalText).toContain(`capability: ${rb.capability}`);
    }
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
      'rb.diagnose-site': 8970,
      'rb.incident-containment': 8054,
      'rb.incident-remediation': 8104,
      'rb.promotion-execute': 6353,
      'rb.promotion-preflight': 7573,
      'rb.wpe-pull': 8361,
    });
    // diagnose-site and wpe-pull are over 8 KB and load anyway, because they are
    // GUIDED and the ruling scoped the ceiling to strict (WP-20a adjudication,
    // ruling 2 — a registered exception, not a loophole). Every strict document
    // is under it, and the two incident halves clear it by 138 and 88 bytes:
    // recorded because that is the margin a future edit will spend without
    // noticing.
    expect(STRICT_RUNBOOK_CEILING_BYTES).toBe(8192);
  });
});
