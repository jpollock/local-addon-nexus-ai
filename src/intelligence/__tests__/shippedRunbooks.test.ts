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
import {
  RunbookRegistry,
  RUNBOOK_NEAR_CEILING_BYTES,
  STRICT_RUNBOOK_CEILING_BYTES,
} from '../law/runbookRegistry';

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

  it('warns about nothing today — every shipped runbook is clear of the 90% line', () => {
    // A claim, not an absence. The WARN exists so an author learns the margin
    // while authoring; an empty list here means the shipped set has room, and
    // this is the pin that notices the day one of them stops having it.
    const { registry } = load();

    expect(registry.warnings()).toEqual([]);
    for (const rb of registry.runbooks({ strictness: 'strict' })) {
      expect({ id: rb.id, near: rb.canonicalBytes > RUNBOOK_NEAR_CEILING_BYTES }).toEqual({
        id: rb.id,
        near: false,
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
    // 1.2.0 at WP-31: cp.verify-canary gains a declared instrument
    // (`verify_site_live`) so the checkpoint the runbook asks for is one the
    // gate can permit. Additive, like WP-28's marks before it.
    // to a reviewed document, so the version moves and the hash with it.
    expect(rb?.version).toBe('1.2.0');
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

  it('declares FOUR attestable checkpoints and FOUR narrative ones — the §4 ratio, authored', () => {
    // WP-20d authored these. The ratio is the single most important fact about
    // this runbook: half of it is provable and half of it is not, and a surface
    // that ticked all eight the same way would be claiming verification the
    // platform does not have.
    const rb = load().registry.byCapability('cap.bulk_plugin_update')!;

    expect(rb.checkpoints.map((c) => `${c.id}:${c.attest}`)).toEqual([
      'cp.consult-history:manifest',
      'cp.dry-run:narrative',
      'cp.approval:event',
      'cp.backup:event',
      'cp.canary:narrative',
      'cp.verify-canary:narrative',
      'cp.roll-fleet:event',
      'cp.report:narrative',
    ]);
  });

  it('marks exactly the ruled set as unrequested — the badge is not on every step', () => {
    // WP-28 · the phase-1 smoke's finding 1. Every checkpoint rendered "runbook
    // added this", cp.approval and cp.backup included, because v0 derived the
    // badge from "is declared". The designer's ruled set is history-check,
    // dry-run and the canary pair; approval, backup, roll-fleet and report are
    // NOT badged — the user asked for the roll-out, and consent, a backup and a
    // report are what the platform does about any write.
    const rb = load().registry.byCapability('cap.bulk_plugin_update')!;

    expect(rb.checkpoints.filter((c) => c.unrequested).map((c) => c.id)).toEqual([
      'cp.consult-history',
      'cp.dry-run',
      'cp.canary',
      'cp.verify-canary',
    ]);
    // Stated in the other direction too: the exclusions are a ruling, so a
    // future edit that marks one of them fails here rather than quietly
    // restoring the uniform badge.
    for (const id of ['cp.approval', 'cp.backup', 'cp.roll-fleet', 'cp.report']) {
      expect({ id, marked: !!rb.checkpoints.find((c) => c.id === id)!.unrequested }).toEqual({
        id,
        marked: false,
      });
    }
  });

  it('marks SOME but never ALL of every strict runbook’s checkpoints', () => {
    // The property the badge has to keep to mean anything, held across the
    // shipped set rather than only on the anchor: a document that badges
    // everything has said nothing, and one that badges nothing has an
    // authoring gap rather than a procedure with no additions.
    const { registry } = load();

    for (const rb of registry.runbooks({ strictness: 'strict' })) {
      const marked = rb.checkpoints.filter((c) => c.unrequested).length;
      expect({ id: rb.id, some: marked > 0, all: marked === rb.checkpoints.length }).toEqual({
        id: rb.id,
        some: true,
        all: false,
      });
    }
  });

  it('gives every event-attested checkpoint a ledger selector, and every narrative one none', () => {
    const rb = load().registry.byCapability('cap.bulk_plugin_update')!;

    // The registry already refuses `attest: event` with no topic (WP-20a); this
    // pins the authored selectors themselves, because a wrong topic is a
    // checkpoint that can never attest and a gate that never opens.
    expect(rb.checkpoints.find((c) => c.id === 'cp.approval')!.evidence).toEqual({
      topic: 'task.rationale.recorded',
      decision: 'approved',
    });
    expect(rb.checkpoints.find((c) => c.id === 'cp.backup')!.evidence).toEqual({
      topic: 'task.action.executed',
      tool: 'wpe_backup_and_verify',
      perTarget: true,
    });
    expect(rb.checkpoints.find((c) => c.id === 'cp.roll-fleet')!.evidence).toEqual({
      topic: 'task.action.executed',
      tool: 'bulk_plugin_update',
    });
    for (const c of rb.checkpoints.filter((x) => x.attest === 'narrative')) {
      expect({ id: c.id, evidence: c.evidence }).toEqual({ id: c.id, evidence: undefined });
    }
  });

  it('names bulk_plugin_update as the update tool — never wp_plugin_update, which auto-starts', () => {
    // §5's finding, authored: wp_plugin_update is in NEEDS_RUNNING_SITE, so the
    // platform would start a halted site without the model ever choosing to —
    // violating B-03's must_not #3 on the model's behalf.
    const rb = load().registry.byCapability('cap.bulk_plugin_update')!;
    const claimed = rb.checkpoints.flatMap((c) => c.tools.map((t) => t.name));

    expect(claimed).toContain('bulk_plugin_update');
    expect(claimed).not.toContain('wp_plugin_update');
    expect(rb.checkpoints.find((c) => c.id === 'cp.backup')!.tools.map((t) => t.name)).toEqual([
      'wpe_backup_and_verify',
    ]);
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

    // Re-measured 2026-08-18 after WP-28's `unrequested:` authoring: the five
    // strict documents grew by 549–633 bytes each (the marks plus the comment
    // that explains what a reader is looking at). The two guided ones are
    // untouched and their numbers are the WP-20c ones, unchanged.
    //
    // The anchor moved again the same day (WP-31, 7,002 → 7,463): cp.verify-canary
    // gains `tools: [verify_site_live]` and the body names the instrument and
    // restates what the gateway still cannot see. +461 bytes, and the margin to
    // the near-ceiling WARN is 1,753 — the ceiling pins below still hold.
    expect(bytes).toEqual({
      'rb.bulk-plugin-update': 7463,
      'rb.diagnose-site': 8970,
      'rb.incident-containment': 8673,
      'rb.incident-remediation': 8714,
      'rb.promotion-execute': 6902,
      'rb.promotion-preflight': 8184,
      'rb.wpe-pull': 8361,
    });
    // The ceiling was raised 8,192 → 10,240 at the WP-20c gate, on the evidence
    // this table carries: the two incident halves cleared 8,192 by 138 and 88
    // bytes, and what sits at that size is contract, not prose. At 10,240 the
    // margins are 2,186 and 2,136 — and the near-ceiling WARN below is what
    // stops the next author spending them silently.
    expect(STRICT_RUNBOOK_CEILING_BYTES).toBe(10240);
    expect(RUNBOOK_NEAR_CEILING_BYTES).toBe(9216);
    // The guided pair is now UNDER the strict ceiling, so ruling 2's exemption
    // is currently vacuous in fact while still live in rule. Recorded, because
    // "no guided runbook is over ceiling" is not evidence the scoping stopped
    // mattering — it is evidence the ceiling moved.
    for (const id of ['rb.diagnose-site', 'rb.wpe-pull']) {
      expect({ id, over: bytes[id] > STRICT_RUNBOOK_CEILING_BYTES }).toEqual({ id, over: false });
    }
  });
});
