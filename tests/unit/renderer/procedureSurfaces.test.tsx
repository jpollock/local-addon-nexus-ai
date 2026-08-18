/**
 * @jest-environment jsdom
 */
/**
 * WP-27 · what the Docked Panel shows while a named procedure is running.
 *
 * Every assertion here is one direction the surface could claim something the
 * platform did not observe:
 *
 *  - a uniform rail (the P7 ruling, in its most literal form: eight rows, one tick)
 *  - a narrative checkpoint dressed as proof
 *  - an authored reason under a badge the runbook did not write
 *  - "0 skipped" for a group whose reason no producer records
 *  - a version pair on a site outcome that carries no version
 *  - a Restore button that looks like it restores
 *
 * The component takes the three event shapes' payloads and NOTHING else — no
 * source, no IPC, no derivation. `procedureModel.test.ts` pins the arithmetic and
 * the copy rules; this file pins what reaches the screen.
 */
import * as React from 'react';
import { ProcedureSurfaces } from '../../../src/renderer/components/DockedPanel/ProcedureSurfaces';
import {
  applyProcedureEvent,
  emptyProcedureState,
  BADGE_LABEL,
  ATTEST_WORDS,
} from '../../../src/renderer/components/DockedPanel/procedureModel';
import {
  abortedFixture,
  armedFixture,
  checkpointChangedFixtures,
  fakeProcedureStream,
} from '../../../src/renderer/components/DockedPanel/procedureStream.fake';
import { serializeTree } from './helpers/serializeTree';

function surfaces(props: any): any {
  return new (ProcedureSurfaces as any)({ procedure: null, abort: null, ...props });
}

/** Every node in a serialized tree, in document order. */
function walk(node: any, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  const children = node.children ?? node.props?.children;
  const kids = Array.isArray(children) ? children : [children];
  for (const k of kids) walk(k, out);
  return out;
}

/** All the text a tree would put on screen, joined. */
function text(node: any): string {
  const bits: string[] = [];
  const visit = (n: any) => {
    if (n === null || n === undefined) return;
    if (typeof n === 'string' || typeof n === 'number') { bits.push(String(n)); return; }
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (typeof n === 'object') visit(n.children ?? n.props?.children);
  };
  visit(node);
  return bits.join(' ');
}

function render(props: any): any {
  return serializeTree(surfaces(props).render());
}

/** The run, folded through the reducer exactly as the panel folds it. */
function afterEvents(...events: any[]): any {
  return events.reduce(applyProcedureEvent, emptyProcedureState());
}

const MID_RUN = () => afterEvents(armedFixture(), ...checkpointChangedFixtures().slice(0, 2));

// ---------------------------------------------------------------------------
// Nothing armed
// ---------------------------------------------------------------------------

describe('with nothing armed', () => {
  it('renders nothing at all', () => {
    expect(surfaces({}).render()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The declared-procedure block
// ---------------------------------------------------------------------------

describe('the declared procedure', () => {
  it('names the runbook, its version, and that it is marked strict', () => {
    const out = text(render(MID_RUN()));
    expect(out).toContain('rb.bulk-plugin-update');
    expect(out).toContain('1.1.0');
    expect(out).toContain('marked strict');
    expect(out).toContain('cap.bulk_plugin_update');
  });

  it('says why the ceremony appeared', () => {
    expect(text(render(MID_RUN()))).toContain('this kind of request always runs under this runbook');
  });

  it('lists every declared checkpoint, in the declared order', () => {
    const out = text(render(MID_RUN()));
    const ids = armedFixture().procedure.checkpoints.map((c) => c.id);
    const positions = ids.map((id) => out.indexOf(id));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('carries the honest denominator rather than a progress bar', () => {
    expect(text(render(MID_RUN()))).toContain('provable checkpoints attested');
    expect(text(render(MID_RUN()))).toContain('on the agent’s account only');
  });

  it('does not tick every checkpoint — the P7 ruling, literally', () => {
    // Eight rows; two attested at this point in the run; four that can NEVER be
    // ticked. A rail that showed eight ticks is the product lying.
    const ticks = text(render(MID_RUN())).split('✓').length - 1;
    expect(ticks).toBe(2);
  });

  it('gives a narrative checkpoint its ATTEST_WORDS label and no tick', () => {
    const rows = walk(render(MID_RUN())).filter((n) => n?.props?.['data-checkpoint']);
    const canary = rows.find((n) => n.props['data-checkpoint'] === 'cp.canary');
    expect(canary).toBeTruthy();
    expect(text(canary)).toContain(ATTEST_WORDS.narrative);
    expect(text(canary)).not.toContain('✓');
  });

  it('refuses the tick even when the event claims a narrative checkpoint was proved', () => {
    // A stream event is data from elsewhere. The fold cannot produce this; the
    // surface must still not draw it.
    const armed = armedFixture();
    const hostile = {
      ...armed,
      procedure: {
        ...armed.procedure,
        checkpoints: armed.procedure.checkpoints.map((c) =>
          c.attest === 'narrative' ? { ...c, status: 'attested' as const, verified: true } : c,
        ),
      },
    };
    expect(text(render(afterEvents(hostile)))).not.toContain('✓');
  });

  it('renders the communication obligations as told-you lines, never as ticked steps', () => {
    const out = render(MID_RUN());
    const block = walk(out).find((n) => n?.props?.['data-communication']);
    expect(block).toBeTruthy();
    expect(text(block)).toContain('the procedure requires you to be told');
    expect(text(block)).toContain('say what the canary showed before rolling the rest');
    expect(text(block)).not.toContain('✓');
  });
});

// ---------------------------------------------------------------------------
// Badges (RB-A2)
// ---------------------------------------------------------------------------

describe('“runbook added this” badges', () => {
  const rowsOf = (state: any) =>
    walk(render(state)).filter((n) => n?.props?.['data-checkpoint']);
  const row = (state: any, id: string) =>
    rowsOf(state).find((n) => n.props['data-checkpoint'] === id);

  it('badges a step the runbook MARKED unrequested, with the runbook’s own reason', () => {
    const canary = row(MID_RUN(), 'cp.canary');
    expect(text(canary)).toContain(BADGE_LABEL);
    expect(text(canary)).toContain('one low-risk site first');
  });

  it('badges nothing the runbook did not mark — WP-28, the uniform badge', () => {
    // The live defect: every checkpoint said "runbook added this", cp.approval
    // and cp.backup included, so the badge told a reader nothing. cp.roll-fleet
    // is the sharp case — same tool as the badged cp.canary, and unmarked.
    for (const id of ['cp.approval', 'cp.backup', 'cp.roll-fleet', 'cp.report']) {
      const unmarked = row(MID_RUN(), id);
      expect({ id, badged: text(unmarked).includes(BADGE_LABEL) }).toEqual({ id, badged: false });
      expect({ id, reasons: walk(unmarked).filter((n) => n?.props?.['data-badge-reason']).length })
        .toEqual({ id, reasons: 0 });
    }
  });

  it('renders the badge on exactly the marked set, and only while a row is expanded', () => {
    const badged = rowsOf(MID_RUN())
      .filter((n) => text(n).includes(BADGE_LABEL))
      .map((n) => n.props['data-checkpoint']);
    // cp.consult-history is marked AND attested by this point, so it has folded
    // to one line — the RB-A2 rule outranks the badge, which is why it is absent
    // here and its absence is not a badge failure.
    expect(badged).toEqual(['cp.dry-run', 'cp.canary', 'cp.verify-canary']);
  });

  it('shows a marked badge without a reason when the runbook authored none', () => {
    // Marked-but-reasonless is a real authoring state (a checkpoint with no
    // `## cp.x — …` heading). Inventing a reason puts words in an author's mouth
    // on a document whose whole authority is that a human reviewed it.
    const armed = armedFixture();
    const marked = {
      ...armed,
      procedure: {
        ...armed.procedure,
        checkpoints: armed.procedure.checkpoints.map((c) =>
          c.id === 'cp.report' ? { ...c, unrequested: true, reason: null } : c,
        ),
      },
    };
    const report = row(afterEvents(marked), 'cp.report');
    expect(text(report)).toContain(BADGE_LABEL);
    expect(walk(report).filter((n) => n?.props?.['data-badge-reason'])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Collapsing (RB-A2, the ~540px budget)
// ---------------------------------------------------------------------------

describe('the collapsing checklist', () => {
  it('folds an attested checkpoint to one line — no badge, no attest label', () => {
    const rows = walk(render(MID_RUN())).filter((n) => n?.props?.['data-checkpoint']);
    const done = rows.find((n) => n.props['data-checkpoint'] === 'cp.consult-history');
    expect(done.props['data-folded']).toBe(true);
    expect(text(done)).toContain('cp.consult-history');
    expect(text(done)).not.toContain(BADGE_LABEL);
  });

  it('leaves the checkpoint the run is standing on expanded', () => {
    const rows = walk(render(MID_RUN())).filter((n) => n?.props?.['data-checkpoint']);
    const active = rows.find((n) => n.props['data-checkpoint'] === 'cp.backup');
    expect(active.props['data-folded']).toBe(false);
    // Expanded means it still says what would attest it. It carries no badge:
    // cp.backup is not a step the user did not ask for (WP-28).
    expect(text(active)).toContain(ATTEST_WORDS.event);
  });

  it('folds a marked checkpoint too — attested outranks badged', () => {
    const rows = walk(render(MID_RUN())).filter((n) => n?.props?.['data-checkpoint']);
    const done = rows.find((n) => n.props['data-checkpoint'] === 'cp.consult-history');
    expect(done.props['data-folded']).toBe(true);
    expect(text(done)).not.toContain(BADGE_LABEL);
  });

  it('folds a finished run to one row, with the rail still reachable', () => {
    const armed = armedFixture();
    const finished = {
      ...armed,
      procedure: {
        ...armed.procedure,
        checkpoints: armed.procedure.checkpoints.map((c, i) =>
          c.attest === 'narrative'
            ? { ...c, status: 'skipped' as const }
            : { ...c, status: 'attested' as const, verified: true, evidence: { summary: `attested by ev_${i}` } },
        ),
      },
    };
    const instance = surfaces(afterEvents(finished));
    const collapsed = serializeTree(instance.render());
    expect(walk(collapsed).filter((n) => n?.props?.['data-checkpoint'])).toHaveLength(0);
    expect(text(collapsed)).toContain('4 of 4 provable checkpoints attested');

    instance.state = { ...instance.state, expanded: true };
    const opened = serializeTree(instance.render());
    expect(walk(opened).filter((n) => n?.props?.['data-checkpoint'])).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// The disarm
// ---------------------------------------------------------------------------

describe('a capability that is disarmed rather than governed', () => {
  const refused = {
    type: 'procedure_armed' as const,
    procedure: {
      capability: 'cap.bulk_plugin_update',
      runbookId: 'rb.bulk-plugin-update',
      version: null,
      strictness: null,
      hash: null,
      armedBy: null,
      checkpoints: [],
      verifiableCount: 0,
      communication: [],
      unavailable: {
        code: 'hash-mismatch' as never,
        reason: 'the runbook on disk does not match the hash the grant pins',
        expectedHash: 'sha256:aaa',
        actualHash: 'sha256:bbb',
      },
    },
  };

  it('says the capability is not running under a runbook, and why', () => {
    const out = text(render(afterEvents(refused)));
    expect(out).toContain('not running under a runbook');
    expect(out).toContain('the runbook on disk does not match the hash the grant pins');
  });

  it('shows no rail — ceremony for a disarmed procedure is ceremony for nothing', () => {
    expect(walk(render(afterEvents(refused))).filter((n) => n?.props?.['data-checkpoint'])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The abort groups
// ---------------------------------------------------------------------------

describe('the abort groups panel', () => {
  const aborted = () => afterEvents(armedFixture(), ...checkpointChangedFixtures(), abortedFixture());

  it('leads with the counting line the platform derived, verbatim', () => {
    expect(text(render(aborted()))).toContain(abortedFixture().groups.headline);
  });

  it('never authors its own count beside the derived one', () => {
    const out = text(render(aborted()));
    expect(out.split('already updated and standing').length - 1).toBe(1);
  });

  it('lists each site’s recorded fate', () => {
    const rows = walk(render(aborted())).filter((n) => n?.props?.['data-site-outcome']);
    expect(rows.map((n) => n.props['data-site-outcome'])).toEqual([
      'ent_site_goldenecomm_production',
      'ent_site_myloop_production',
      'ent_site_alpine_outfitters_production',
      'ent_site_psbtest2_production',
      'ent_site_testjppstg_production',
    ]);
  });

  it('names the group the ledger cannot populate instead of reporting it empty', () => {
    // "0 skipped" is a claim that nothing was skipped. Nothing recorded that.
    const group = walk(render(aborted())).find((n) => n?.props?.['data-abort-group'] === 'skipped');
    expect(group).toBeTruthy();
    expect(text(group)).toContain('no producer records a skip reason');
    expect(text(group)).not.toMatch(/\b0\b/);
  });

  it('shows no version pair, and says why rather than leaving a dash', () => {
    // `task.outcome.recorded` records no version. A slot filled with a dash reads
    // as "unchanged", which is a different claim from "not recorded".
    const out = text(render(aborted()));
    expect(out).not.toContain('→');
    expect(out).toContain('no producer records');
  });

  it('carries the platform’s own note that aborting undoes nothing', () => {
    expect(text(render(aborted()))).toContain(abortedFixture().restore.note);
  });
});

// ---------------------------------------------------------------------------
// Restore is a launcher, not an actor (v6 Q7)
// ---------------------------------------------------------------------------

describe('“Restore this site”', () => {
  const aborted = () => afterEvents(armedFixture(), ...checkpointChangedFixtures(), abortedFixture());

  it('is offered only for sites with an attested backup behind them', () => {
    const buttons = walk(render(aborted())).filter((n) => n?.props?.['data-restore']);
    expect(buttons.map((n) => n.props['data-restore'])).toEqual([
      'ent_site_goldenecomm_production',
      'ent_site_myloop_production',
    ]);
  });

  it('does not act — it renders the refusal path the request would meet', () => {
    const instance = surfaces(aborted());
    const before = serializeTree(instance.render());
    expect(text(before)).not.toContain('No restore runbook is loaded');

    const button = walk(before).find((n) => n?.props?.['data-restore']);
    expect(button.props.onClick).toBe('[fn]');

    instance.state = { ...instance.state, restoreAsked: 'ent_site_goldenecomm_production' };
    const after = text(serializeTree(instance.render()));
    expect(after).toContain('No restore runbook is loaded');
    expect(after).toContain('separate, gated action');
  });

  it('never claims the site was restored', () => {
    const instance = surfaces(aborted());
    instance.state = { ...instance.state, restoreAsked: 'ent_site_goldenecomm_production' };
    expect(text(serializeTree(instance.render()))).not.toMatch(/restored\b/i);
  });
});

// ---------------------------------------------------------------------------
// Source independence — the swap WP-26 makes
// ---------------------------------------------------------------------------

describe('the components care about the shapes, not the source', () => {
  it('renders identically from the fake emitter and from the same events by hand', async () => {
    const stream = fakeProcedureStream();
    let fromStream = emptyProcedureState();
    stream.subscribe((e) => { fromStream = applyProcedureEvent(fromStream, e); });
    await stream.play();

    const byHand = stream.events().reduce(applyProcedureEvent, emptyProcedureState());
    expect(render(fromStream)).toEqual(render(byHand));

    // Not vacuous: the tree it agrees on is a real one.
    expect(text(render(fromStream))).toContain('rb.bulk-plugin-update');
  });
});
