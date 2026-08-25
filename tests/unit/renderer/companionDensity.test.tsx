/**
 * @jest-environment jsdom
 */
/**
 * WP-35 · the companion density — the fold's nine pins, at the shipped 380px.
 *
 * `docs/intelligence/from-designer/from-designer-05-companion-density-final.md`
 * is ratified whole (`for-designer-fold-response.md` §1), and its nine pins ARE
 * this packet's acceptance criteria. Each `describe` below names the pin it
 * enforces; a pin without a test here is an untested acceptance criterion,
 * which the DoD forbids.
 *
 * EVERY FACT IN THIS FILE COMES FROM THE GENERATED FIXTURE.
 * `docs/intelligence/design-fixtures/declared-procedures.json` is
 * `deriveDeclaredProcedure` run over the reviewed documents by
 * `scripts/generate-procedure-fixtures.ts` — the artifact that ended
 * hand-built design fixtures (WP-32). Pin 7 is the reason: transcription is
 * authoring by another name, so a checkpoint list written into a test would be
 * authored procedure just as surely as one written into a sheet. The stage
 * surface does not exist yet, so the cross-density identity pins bind against
 * this file rather than against a second rendering, and they move to the
 * two-rendering form the day stage rank is built.
 *
 * WHAT THIS FILE DOES NOT IMPORT: `procedureView.ts`. The fixture is read as
 * JSON. `procedureModel.isolation.test.ts` pins the renderer modules' require
 * graph, and a value import of the seam here would poison `require.cache` for
 * nothing — the fixture is the seam's own output, already derived.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as React from 'react';

import { serializeTree } from './helpers/serializeTree';
import { ProcedureSurfaces } from '../../../src/renderer/components/DockedPanel/ProcedureSurfaces';
import { ProcedureApprovalCard } from '../../../src/renderer/components/DockedPanel/ProcedureApprovalCard';
import { PanelChat } from '../../../src/renderer/components/DockedPanel/PanelChat';
import {
  ATTEST_WORDS,
  BADGE_LABEL,
  CHECKPOINT_WINDOW,
  checkpointMark,
  checkpointWindow,
  denominatorLine,
  derivedPlanLine,
  opensContainer,
  referenceLine,
  windowRangeLine,
  type CheckpointState,
  type DeclaredProcedure,
} from '../../../src/renderer/components/DockedPanel/procedureModel';
import { armedFixture } from '../../../src/renderer/components/DockedPanel/procedureStream.fake';

// ---------------------------------------------------------------------------
// The generated fixture, read as data
// ---------------------------------------------------------------------------

const FIXTURE_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'intelligence',
  'design-fixtures',
  'declared-procedures.json',
);

interface FixtureCheckpoint {
  id: string;
  attest: CheckpointState['attest'];
  attestWords: string;
  badge: { label: string; reason: string | null } | null;
  reason: string | null;
  status: string;
  unrequested: boolean;
  verified: boolean;
}

interface FixtureRunbook {
  armedBy: DeclaredProcedure['armedBy'];
  capability: string;
  checkpointCount: number;
  checkpoints: FixtureCheckpoint[];
  communication: string[];
  hash: string;
  /** WP-41 · null when the document declares no consent gate, or nothing narrative before it. */
  planCheckpoint: { checkpointId: string; reason: string | null } | null;
  runbookId: string;
  strictness: DeclaredProcedure['strictness'];
  verifiableCount: number;
  version: string;
}

const GENERATED: Record<string, FixtureRunbook> = JSON.parse(
  fs.readFileSync(FIXTURE_PATH, 'utf8'),
).runbooks;

const ANCHOR = GENERATED['rb.bulk-plugin-update'];

/** The generated document as the `DeclaredProcedure` a stream event carries. */
function declared(over: Partial<DeclaredProcedure> = {}): DeclaredProcedure {
  return {
    capability: ANCHOR.capability,
    runbookId: ANCHOR.runbookId,
    version: ANCHOR.version,
    strictness: ANCHOR.strictness,
    hash: ANCHOR.hash,
    armedBy: ANCHOR.armedBy,
    checkpoints: ANCHOR.checkpoints.map((c) => ({
      id: c.id,
      status: 'pending' as const,
      attest: c.attest,
      verified: false,
      reason: c.reason,
      source: 'runbook' as const,
      unrequested: c.unrequested,
      evidence: { summary: c.attestWords },
    })),
    verifiableCount: ANCHOR.verifiableCount,
    communication: ANCHOR.communication.slice(),
    // Absent, never present-undefined: the emission's rule 1, and `derivedPlanLine`
    // reads the difference. `toEqual` cannot see it, which is why it is spread.
    ...(ANCHOR.planCheckpoint ? { planCheckpoint: ANCHOR.planCheckpoint } : {}),
    ...over,
  };
}

/**
 * The run at its approval gate: history consulted, the decision pending. The
 * statuses are SCENARIO — the run's narrative is local, the document is not
 * (the fold's own absence list: "No authored procedure").
 */
function atTheGate(): DeclaredProcedure {
  const base = declared();
  return {
    ...base,
    checkpoints: base.checkpoints.map((c) => {
      if (c.id === 'cp.consult-history') {
        return {
          ...c,
          status: 'attested' as const,
          verified: true,
          evidence: { eventId: 'ev_01hq…a1', topic: 'task.context.assembled', summary: 'attested by ev_01hq…a1 (task.context.assembled)' },
        };
      }
      if (c.id === 'cp.approval') return { ...c, status: 'active' as const };
      return c;
    }),
  };
}

/** Every checkpoint resolved: the run is over and the block folds. */
function finished(): DeclaredProcedure {
  const base = declared();
  return {
    ...base,
    checkpoints: base.checkpoints.map((c) => ({
      ...c,
      status: 'attested' as const,
      verified: c.attest !== 'narrative',
      evidence: { summary: `attested by ev_${c.id} (task.action.executed)` },
    })),
  };
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function surfaces(props: Record<string, unknown>): any {
  return new (ProcedureSurfaces as any)({ procedure: null, abort: null, ...props });
}

function render(instance: any): unknown {
  return serializeTree(instance.render());
}

function walk(node: any, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  const children = Array.isArray(node) ? node : (node.children ?? node.props?.children);
  const kids = Array.isArray(children) ? children : [children];
  for (const k of kids) walk(k, out);
  return out;
}

function text(node: any): string {
  const bits: string[] = [];
  const visit = (n: any) => {
    if (n === null || n === undefined) return;
    if (typeof n === 'string' || typeof n === 'number') {
      bits.push(String(n));
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (typeof n === 'object') visit(n.children ?? n.props?.children);
  };
  visit(node);
  return bits.join(' ');
}

/**
 * The text a tree puts on screen, minus the disclosure CONTROLS. Used by the
 * fold-is-never-rewording pin: the handle is the affordance, the declaration is
 * what it reveals, and comparing the two together would compare the wrong thing.
 */
function textWithoutControls(node: any): string {
  const bits: string[] = [];
  const visit = (n: any) => {
    if (n === null || n === undefined) return;
    if (typeof n === 'string' || typeof n === 'number') {
      bits.push(String(n));
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (typeof n === 'object') {
      if (n.props?.['data-procedure-promote'] !== undefined) return;
      visit(n.children ?? n.props?.children);
    }
  };
  visit(node);
  return bits.join(' ');
}

/**
 * The text the WHOLE panel puts on screen, with the two procedure components
 * rendered rather than left as element stubs.
 *
 * `serializeTree` deliberately stops at a component boundary, and it also
 * serializes PROPS — so counting `rb.bulk-plugin-update` in its JSON counts the
 * declaration travelling down as data, not the reference appearing on screen.
 * Pin 4 is about the screen. Only these two types are rendered, by identity: a
 * blanket "instantiate anything callable" would render `SiteContextStrip` and
 * friends too, and a component that threw would be silently skipped by the
 * try/catch that would then be needed — which is how a pin quietly stops
 * measuring the thing it names.
 */
const DEEP_RENDERED: unknown[] = [ProcedureSurfaces, ProcedureApprovalCard];

function deepText(node: any, seen: unknown[] = []): { text: string; rendered: unknown[] } {
  const bits: string[] = [];
  const visit = (n: any) => {
    if (n === null || n === undefined || typeof n === 'boolean') return;
    if (typeof n === 'string' || typeof n === 'number') {
      bits.push(String(n));
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (typeof n !== 'object') return;
    if (DEEP_RENDERED.includes(n.type)) {
      seen.push(n.type);
      visit(new (n.type as any)(n.props).render());
      return;
    }
    visit(n.props?.children);
  };
  visit(node);
  return { text: bits.join(' '), rendered: seen };
}

/** Every checkpoint row on screen, in document order. */
function rows(tree: any): any[] {
  return walk(tree).filter((n) => n?.props && n.props['data-checkpoint'] !== undefined);
}

const GATE = 'cp.approval';

// ---------------------------------------------------------------------------
// The fixture is the source — the pin under every other pin (pin 7 of §0)
// ---------------------------------------------------------------------------

describe('the fixture, not the transcription', () => {
  it('is the generated file, and it says so', () => {
    const raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
    expect(raw.$generatedBy).toContain('generate-procedure-fixtures');
    expect(ANCHOR.checkpoints).toHaveLength(ANCHOR.checkpointCount);
    expect(ANCHOR.checkpointCount).toBe(8);
  });

  it('agrees with the renderer mirror about what each attest class means', () => {
    // The mirrored ATTEST_WORDS and the generated fixture's attestWords are two
    // copies of one sentence. If they drift, the model is told one thing about a
    // checkpoint and the human is shown another.
    for (const c of ANCHOR.checkpoints) {
      expect(c.attestWords).toBe(ATTEST_WORDS[c.attest]);
    }
  });

  it('agrees with the fake emitter about the DOCUMENT (the run stays local)', () => {
    // The designer's cycle-one hold: "the day WP-32's generated file lands we
    // diff the two. Byte-match lifts the hold; a divergence is a defect in one
    // of them." Statuses and evidence are the scenario and stay local; every
    // fact that comes out of the reviewed document is compared here.
    const fake = armedFixture().procedure;
    expect(fake.runbookId).toBe(ANCHOR.runbookId);
    expect(fake.version).toBe(ANCHOR.version);
    expect(fake.hash).toBe(ANCHOR.hash);
    expect(fake.strictness).toBe(ANCHOR.strictness);
    expect(fake.capability).toBe(ANCHOR.capability);
    expect(fake.verifiableCount).toBe(ANCHOR.verifiableCount);
    expect(fake.communication).toEqual(ANCHOR.communication);
    // WP-41 · the field WP-37 began serving and WP-35's fake lacked. Compared as
    // a whole object: the id alone would let the reason drift, and the reason is
    // the author's own heading rather than a label this surface may reword.
    expect(fake.planCheckpoint).toEqual(ANCHOR.planCheckpoint ?? undefined);
    expect(fake.checkpoints.map((c) => [c.id, c.attest, c.reason, c.unrequested])).toEqual(
      ANCHOR.checkpoints.map((c) => [c.id, c.attest, c.reason, c.unrequested]),
    );
  });
});

// ---------------------------------------------------------------------------
// Pin 1 · the block yields to the card, never the reverse
// ---------------------------------------------------------------------------

describe('pin 1 · the block yields to the card, never the reverse', () => {
  it('renders the digest, not the full rail, while a decision is pending', () => {
    const digest = render(surfaces({ procedure: atTheGate(), approvalPending: true, gateCheckpointId: GATE }));
    const full = render(surfaces({ procedure: atTheGate() }));
    expect(rows(digest).length).toBe(CHECKPOINT_WINDOW);
    expect(rows(full).length).toBe(ANCHOR.checkpointCount);
    expect(rows(digest).length).toBeLessThan(rows(full).length);
  });

  it('never draws the card itself — the card sits in the flow, where she is reading', () => {
    const digest = render(surfaces({ procedure: atTheGate(), approvalPending: true, gateCheckpointId: GATE }));
    expect(JSON.stringify(digest)).not.toContain('ProcedureApprovalCard');
    expect(JSON.stringify(digest)).not.toContain('Approve');
  });

  it('and the reverse is refused: the card is never squeezed to make room for the block', () => {
    // The card renders identically whether or not a block is pinned above it —
    // there is no prop by which the block could take space from it.
    const card = new (ProcedureApprovalCard as any)({
      title: 'Bulk Plugin Update',
      effect: 'Updates plugins on the sites in the plan.',
      warning: 'Approve this step to let the runbook continue.',
      procedure: {
        runbookId: ANCHOR.runbookId,
        version: ANCHOR.version,
        strictness: 'strict' as const,
        checkpointId: GATE,
        offersCanaryPolicy: true,
      },
      onApprove: jest.fn(),
      onDeny: jest.fn(),
    });
    expect(Object.keys(card.props)).not.toContain('density');
    expect(Object.keys(card.props)).not.toContain('collapsed');
  });
});

// ---------------------------------------------------------------------------
// Pin 2 · the digest carries every fact and no scrollbar
// ---------------------------------------------------------------------------

describe('pin 2 · the digest carries every fact and no scrollbar', () => {
  const digest = () => render(surfaces({ procedure: atTheGate(), approvalPending: true, gateCheckpointId: GATE }));

  it('carries the runbook reference, exactly once', () => {
    const t = text(digest());
    expect(t).toContain(ANCHOR.runbookId);
    expect(t.split(ANCHOR.runbookId).length - 1).toBe(1);
    expect(t).toContain(`v${ANCHOR.version}`);
    expect(t).toMatch(/marked strict/);
  });

  it('carries the provable denominator', () => {
    const t = text(digest());
    // Read, never recomputed: 4 of the 8 are provable, and the fixture says so.
    expect(t).toContain(`of ${ANCHOR.verifiableCount} provable`);
    expect(t).toContain(`${ANCHOR.checkpointCount - ANCHOR.verifiableCount} on the agent’s account only`);
  });

  it('states the window range — a window that does not declare itself is a truncation pretending to be the whole', () => {
    expect(text(digest())).toContain('Checkpoints 2 to 4 of 8');
  });

  it('centres the window on the gate being decided', () => {
    const ids = rows(digest()).map((r) => r.props['data-checkpoint']);
    const declaredIds = ANCHOR.checkpoints.map((c) => c.id);
    const gateAt = declaredIds.indexOf(GATE);
    expect(ids).toEqual(declaredIds.slice(gateAt - 1, gateAt + 2));
    expect(ids).toContain(GATE);
  });

  it('renders ATTEST_WORDS in full — no shortform set at 380px', () => {
    const t = text(digest());
    for (const id of rows(digest()).map((r) => r.props['data-checkpoint'])) {
      const c = ANCHOR.checkpoints.find((x) => x.id === id)!;
      expect(t).toContain(ATTEST_WORDS[c.attest]);
    }
  });

  it('opens no inner scrollbar', () => {
    for (const node of walk(digest())) {
      const style = node?.props?.style ?? {};
      expect(style.overflowY).not.toBe('auto');
      expect(style.overflowY).not.toBe('scroll');
      expect(style.overflow).not.toBe('auto');
      expect(style.maxHeight).toBeUndefined();
    }
  });

  it('offers the full declaration one promotion away', () => {
    const handle = walk(digest()).find((n) => n?.props?.['data-procedure-promote'] !== undefined);
    expect(handle).toBeDefined();
    expect(text(handle)).toMatch(/full declaration/i);
  });
});

// ---------------------------------------------------------------------------
// Pin 3 · the run folds in place on finish
// ---------------------------------------------------------------------------

describe('pin 3 · the run folds in place on finish', () => {
  it('folds to ONE row, and the row draws no checkpoint list', () => {
    const tree = render(surfaces({ procedure: finished() }));
    expect(rows(tree)).toHaveLength(0);
    const handle = walk(tree).find((n) => n?.props?.['data-run-folded'] !== undefined);
    expect(handle).toBeDefined();
    expect(handle.props['data-run-folded']).toBe(true);
  });

  it('is a handle, not a summary — the row carries the reference and nothing it would have to recount', () => {
    const t = text(render(surfaces({ procedure: finished() })));
    expect(t).toContain(referenceLine(finished()));
    // No progress arithmetic on the folded row: the record answers that, in place.
    expect(t).not.toContain('provable');
  });

  it('opens the record IN PLACE — the reference stays first and nothing moves above it', () => {
    const instance = surfaces({ procedure: finished() });
    const foldedFirst = text(walk(render(instance))[0]);
    instance.state = { ...instance.state, expanded: true };
    const openedTree = render(instance);
    expect(rows(openedTree)).toHaveLength(ANCHOR.checkpointCount);
    expect(text(walk(openedTree)[0]).indexOf(ANCHOR.runbookId)).toBe(
      foldedFirst.indexOf(ANCHOR.runbookId),
    );
  });
});

// ---------------------------------------------------------------------------
// Pin 4 · the runbook reference appears exactly once
// ---------------------------------------------------------------------------

describe('pin 4 · the runbook reference appears exactly once, in the declared block’s header', () => {
  it('is absent from the approval card', () => {
    const card = new (ProcedureApprovalCard as any)({
      title: 'Bulk Plugin Update',
      effect: 'Updates plugins on the sites in the plan.',
      warning: 'Approve this step to let the runbook continue.',
      procedure: {
        runbookId: ANCHOR.runbookId,
        version: ANCHOR.version,
        strictness: 'strict' as const,
        checkpointId: GATE,
        offersCanaryPolicy: true,
      },
      onApprove: jest.fn(),
      onDeny: jest.fn(),
    });
    const t = text(render(card));
    expect(t).not.toContain(ANCHOR.runbookId);
    expect(t).not.toMatch(/marked strict/);
    // The checkpoint is NOT the reference: the card must still say which step
    // of the document this decision stands on.
    expect(t).toContain(GATE);
  });

  it('appears once across the whole panel while a decision is pending', () => {
    const instance = new (PanelChat as any)({
      electron: { ipcRenderer: { invoke: jest.fn().mockResolvedValue(null), on: jest.fn(), removeListener: jest.fn() } },
      sessionId: null,
      selectedSiteIds: [],
      siteContext: { mode: 'none', siteName: null, viewedSiteName: null, sites: [], onPick: jest.fn(), onClear: jest.fn() },
      visible: true,
      onSessionCreated: jest.fn(),
      onSessionSaved: jest.fn(),
      onStreamingStatusChange: jest.fn(),
    });
    instance.state = {
      ...instance.state,
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'Ready to update the plugins.',
          toolCalls: [
            {
              id: 't1',
              name: 'wpe_bulk_plugin_update',
              args: '{}',
              status: 'awaiting_approval',
              warning: 'Approve this step to let the runbook continue.',
              procedure: {
                runbookId: ANCHOR.runbookId,
                version: ANCHOR.version,
                strictness: 'strict',
                checkpointId: GATE,
                offersCanaryPolicy: true,
              },
            },
          ],
        },
      ],
      procedure: { procedure: atTheGate(), abort: null },
    };

    const { text: onScreen, rendered } = deepText(instance.render());
    // Not vacuous: both surfaces really were rendered into that string.
    expect(rendered).toContain(ProcedureSurfaces);
    expect(rendered).toContain(ProcedureApprovalCard);
    expect(onScreen).toContain('Approve');

    expect(onScreen.split(ANCHOR.runbookId).length - 1).toBe(1);
    expect(onScreen.split('marked strict').length - 1).toBe(1);
    expect(onScreen.split(`v${ANCHOR.version}`).length - 1).toBe(1);
  });

  it('is carried by the block, and the block is pinned above the turns', () => {
    const instance = new (PanelChat as any)({
      electron: { ipcRenderer: { invoke: jest.fn().mockResolvedValue(null), on: jest.fn(), removeListener: jest.fn() } },
      sessionId: null,
      selectedSiteIds: [],
      siteContext: { mode: 'none', siteName: null, viewedSiteName: null, sites: [], onPick: jest.fn(), onClear: jest.fn() },
      visible: true,
      onSessionCreated: jest.fn(),
      onSessionSaved: jest.fn(),
      onStreamingStatusChange: jest.fn(),
    });
    instance.state = { ...instance.state, procedure: { procedure: atTheGate(), abort: null } };
    const tree: any = render(instance);
    const kinds = tree.children.map((c: any) => c?.type);
    // XD-3 as geometry: the procedure outranks the transcript, so it holds the
    // top and the turns move beneath it.
    expect(kinds.indexOf('ProcedureSurfaces')).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf('ProcedureSurfaces')).toBeLessThan(
      tree.children.findIndex((c: any) => c?.props?.['data-nexus-chat']),
    );
  });
});

// ---------------------------------------------------------------------------
// Pin 5 · the badge appears only on the runbook-contributed checkpoints
// ---------------------------------------------------------------------------

describe('pin 5 · the badge appears only on the checkpoints the runbook contributed', () => {
  const badgedIn = (tree: any) =>
    rows(tree)
      .filter((r) => text(r).includes(BADGE_LABEL))
      .map((r) => r.props['data-checkpoint']);

  it('badges exactly the set the reviewed document marked, and no other', () => {
    const expected = ANCHOR.checkpoints.filter((c) => c.unrequested).map((c) => c.id);
    expect(badgedIn(render(surfaces({ procedure: declared() })))).toEqual(expected);
    // Not vacuous: the document marks some and not others, and cp.approval and
    // cp.backup — the two a v0 badge-everything rail wrongly badged — are out.
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(ANCHOR.checkpointCount);
    expect(expected).not.toContain('cp.approval');
    expect(expected).not.toContain('cp.backup');
  });

  it('badges the same set in the digest, on the checkpoints the window shows', () => {
    const tree = render(surfaces({ procedure: atTheGate(), approvalPending: true, gateCheckpointId: GATE }));
    const shown = rows(tree).map((r) => r.props['data-checkpoint']);
    const expected = ANCHOR.checkpoints
      .filter((c) => c.unrequested && shown.includes(c.id))
      .map((c) => c.id);
    expect(badgedIn(tree)).toEqual(expected);
    expect(expected).toContain('cp.dry-run');
  });
});

// ---------------------------------------------------------------------------
// Pin 6 · the scope block's facts
// ---------------------------------------------------------------------------

describe('pin 6 · the scope block’s facts are byte-invariant across densities', () => {
  it('mounts no scope block for a procedure that carries no scope', () => {
    // WP-32's ratified condition, and it is UNCHANGED rather than relaxed. The
    // judgment was "no comparator selection exists to carry one"; WP-41 built
    // the comparator, so selections now exist — but a procedure without one
    // still mounts nothing, because absent scope means there is no selection to
    // render, not an empty selection to render emptily. Every armed run in the
    // product today is this case. `scopeBlock.test.ts` holds byte-identity.
    for (const tree of [
      render(surfaces({ procedure: declared() })),
      render(surfaces({ procedure: atTheGate(), approvalPending: true, gateCheckpointId: GATE })),
      render(surfaces({ procedure: finished() })),
    ]) {
      expect(JSON.stringify(tree)).not.toContain('ScopeBlock');
      expect(walk(tree).filter((n) => n?.props?.['aria-label'] === 'Scope')).toEqual([]);
    }
  });

  it('WP-41 · mounts the block at the declaration head once a selection HAS armed', () => {
    // The other half of the same rule, and the reason the condition above could
    // be satisfied rather than waived: a scope that arrived on the arming is a
    // selection a human made, so the declaration opens with the block she made.
    const tree = render(surfaces({ procedure: declared({ scope: SCOPED.scope }) }));
    const blocks = walk(tree).filter((n) => String(n?.type).includes('ScopeBlock'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].props.surface).toBe('companion-head');
    expect(blocks[0].props.scope).toBe(SCOPED.scope);
  });

});

/** A declaration carrying a scope — one runnable staging cell. */
const SCOPED = {
  scope: {
    capability: 'cap.bulk_plugin_update',
    runbookId: 'rb.bulk-plugin-update',
    runnable: [{ siteId: 's.alpha', siteName: 'Alpha', place: { host: 'wpe', kind: 'staging' } }],
    barred: [],
    excluded: [],
    places: ['wpe_staging'],
    from: { surface: 'comparator', comparatorId: 'cmp.x', filter: 'plugin=woocommerce' },
    opensRun: true,
  } as DeclaredProcedure['scope'],
};

// ---------------------------------------------------------------------------
// Pin 7 · defer explanation, never a fact — and folding is never rewording
// ---------------------------------------------------------------------------

describe('pin 7 · a density may defer explanation; it may never defer a fact', () => {
  it('defers the badge reasons, the communication list and the out-of-window rows', () => {
    const digest = text(render(surfaces({ procedure: atTheGate(), approvalPending: true, gateCheckpointId: GATE })));
    // Explanation, deferred — `cp.dry-run` is IN the window and badged, so its
    // absent reason line is the deferral itself and not an accident of framing.
    expect(digest).toContain('cp.dry-run');
    expect(digest).not.toContain('show what would change');
    expect(digest).not.toContain(ANCHOR.communication[0]);
    // Facts, present: the badge itself, the marks, the denominator, the range.
    expect(digest).toContain(BADGE_LABEL);
  });

  it('promotes to text BYTE-IDENTICAL to the undeferred rendering — folding is a rendering act', () => {
    // The guard the fold's restatement 2 was adopted with: collapsed = facts
    // equal, disclosed = bytes equal. Rewording on promotion would be authoring.
    //
    // The disclosure CONTROL is not the disclosed text: `data-procedure-promote`
    // is the handle, and comparing it would be comparing the affordance rather
    // than the declaration it reveals.
    const promoted = surfaces({ procedure: atTheGate(), approvalPending: true, gateCheckpointId: GATE });
    promoted.state = { ...promoted.state, promoted: true };
    expect(textWithoutControls(render(promoted))).toBe(
      textWithoutControls(render(surfaces({ procedure: atTheGate() }))),
    );
    // Not vacuous: the promoted rendering is the whole document, the digest is not.
    expect(rows(render(promoted))).toHaveLength(ANCHOR.checkpointCount);
  });
});

// ---------------------------------------------------------------------------
// Pin 8 · a plan of zero cells opens no container
// ---------------------------------------------------------------------------

describe('pin 8 · a plan of zero cells opens no container', () => {
  const emptyRun = (): DeclaredProcedure =>
    declared({
      scope: {
        capability: ANCHOR.capability,
        runbookId: ANCHOR.runbookId,
        runnable: [],
        barred: [],
        excluded: [],
        places: ['wpe_staging'],
        from: { surface: 'comparator', comparatorId: 'cmp.fleet-plugins', filter: 'plugin=woocommerce outdated=true' },
        opensRun: false,
      } as DeclaredProcedure['scope'],
    });

  it('answers false to opensContainer, and true when the plan has cells', () => {
    expect(opensContainer(emptyRun())).toBe(false);
    expect(opensContainer(declared())).toBe(true);
  });

  it('draws no block and no checkpoint list', () => {
    const tree = render(surfaces({ procedure: emptyRun() }));
    expect(rows(tree)).toHaveLength(0);
    expect(walk(tree).filter((n) => n?.props?.['aria-label'] === 'Procedure')).toEqual([]);
  });

  it('WP-41 · still mounts the scope block, where the refusal\'s whole content lives', () => {
    // XD-21 refuses the CONTAINER, not the block. The `Excludes:` lines and the
    // barred group's door ARE the refusal's content — the fold's own pin says
    // that pair never defers. A plan line alone would state a count and
    // withhold the reason, which is the opposite of "inspectable, not asserted".
    const tree = render(surfaces({ procedure: emptyRun() }));
    const blocks = walk(tree).filter((n) => String(n?.type).includes('ScopeBlock'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].props.surface).toBe('companion-head');
    // ...and the container still does not open.
    expect(rows(tree)).toHaveLength(0);
  });

  it('attaches the derived plan verbatim, in the sheet\'s four-segment form', () => {
    expect(text(render(surfaces({ procedure: emptyRun() })))).toContain(derivedPlanLine(emptyRun()));
    // WP-41 · the fourth segment. WP-35 shipped this line one segment short of
    // the sheet because no served fact identified the checkpoint that produced
    // the plan; WP-37 derived it and this consumes it. The id comes from the
    // GENERATED fixture, so a document whose consent gate moves moves this line.
    expect(ANCHOR.planCheckpoint).not.toBeNull();
    expect(derivedPlanLine(emptyRun())).toBe(
      `${ANCHOR.runbookId} · v${ANCHOR.version} · marked strict · ${ANCHOR.planCheckpoint!.checkpointId} — 0 cells eligible`,
    );
  });

  it('renders the THREE-segment form when the document identifies no plan checkpoint', () => {
    // Absent stays absent. Six of the seven shipped runbooks derive `null` here,
    // and the line must not borrow a plausible id to keep its shape — the guard
    // against the fourth segment becoming decoration rather than a fact.
    const { planCheckpoint: _dropped, ...noGate } = emptyRun() as DeclaredProcedure & {
      planCheckpoint?: unknown;
    };
    expect('planCheckpoint' in noGate).toBe(false);
    expect(derivedPlanLine(noGate as DeclaredProcedure)).toBe(
      `${ANCHOR.runbookId} · v${ANCHOR.version} · marked strict — 0 cells eligible`,
    );
  });

  it('stays in the flow — the panel does not pin it above the turns', () => {
    const instance = new (PanelChat as any)({
      electron: { ipcRenderer: { invoke: jest.fn().mockResolvedValue(null), on: jest.fn(), removeListener: jest.fn() } },
      sessionId: null,
      selectedSiteIds: [],
      siteContext: { mode: 'none', siteName: null, viewedSiteName: null, sites: [], onPick: jest.fn(), onClear: jest.fn() },
      visible: true,
      onSessionCreated: jest.fn(),
      onSessionSaved: jest.fn(),
      onStreamingStatusChange: jest.fn(),
    });
    instance.state = { ...instance.state, procedure: { procedure: emptyRun(), abort: null } };
    const tree: any = render(instance);
    // fixes-082526: on an EMPTY session the composer block moved inside the
    // centred column, so the panel can now have a single top-level child and
    // React hands back that child rather than an array. Normalise before
    // reading — the assertion below is unchanged, and it is about WHERE the
    // procedure node is, not how many siblings it happens to have.
    const topLevel: any[] = Array.isArray(tree.children) ? tree.children : [tree.children];
    // Not pinned: no procedure node among the panel's own top-level children…
    expect(topLevel.map((c: any) => c?.type)).not.toContain('ProcedureSurfaces');
    // …and present inside the transcript, where the turns are.
    const transcript = topLevel.find((c: any) => c?.props?.['data-nexus-chat']);
    const inFlow = walk(transcript).filter((n: any) => n?.type === 'ProcedureSurfaces');
    expect(inFlow).toHaveLength(1);
    expect(inFlow[0].key).toBe('procedure-plan');
    expect(deepText(instance.render()).text).toContain(derivedPlanLine(emptyRun()));
  });
});

// ---------------------------------------------------------------------------
// Pin 9 · three marks only, and the tick never grows a "verified"
// ---------------------------------------------------------------------------

describe('pin 9 · three marks only — attested, recorded-not-proved, not-yet', () => {
  const midRun = (): DeclaredProcedure => {
    const base = declared();
    return {
      ...base,
      checkpoints: base.checkpoints.map((c, i) => {
        if (i === 0) return { ...c, status: 'attested' as const, verified: true };
        if (i === 1) return { ...c, status: 'attested' as const, verified: false }; // narrative
        return c;
      }),
    };
  };

  it('uses the tick, the dot and the position numeral, and nothing else', () => {
    const marks = midRun().checkpoints.map((c, i) => checkpointMark(c, i));
    expect(marks[0]).toBe('✓');
    expect(marks[1]).toBe('·');
    expect(marks.slice(2)).toEqual(['3', '4', '5', '6', '7', '8']);
  });

  it('refuses the tick to a narrative checkpoint even when the event claims verified', () => {
    const hostile: CheckpointState = {
      id: 'cp.canary',
      status: 'attested',
      attest: 'narrative',
      verified: true,
      reason: null,
      source: 'runbook',
      unrequested: false,
    };
    expect(checkpointMark(hostile, 4)).toBe('·');
  });

  it('never grows a "verified" — not in a caption, not in a tooltip, not on hover', () => {
    for (const tree of [
      render(surfaces({ procedure: midRun() })),
      render(surfaces({ procedure: atTheGate(), approvalPending: true, gateCheckpointId: GATE })),
      render(surfaces({ procedure: finished() })),
    ]) {
      expect(text(tree)).not.toMatch(/verified/i);
      expect(walk(tree).filter((n) => n?.props?.title !== undefined)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// The copy rules, directly
// ---------------------------------------------------------------------------

describe('the derived lines', () => {
  it('states the window range only when the window is narrower than the list', () => {
    const w = checkpointWindow(atTheGate(), GATE)!;
    expect(windowRangeLine(atTheGate(), w)).toBe('Checkpoints 2 to 4 of 8');

    const short = declared({ checkpoints: declared().checkpoints.slice(0, 2) });
    const shortWindow = checkpointWindow(short, short.checkpoints[0].id)!;
    expect(windowRangeLine(short, shortWindow)).toBeNull();
  });

  it('clamps the window at the ends rather than shrinking it', () => {
    const first = checkpointWindow(atTheGate(), 'cp.consult-history')!;
    expect(first.states.map((s) => s.id)).toEqual(['cp.consult-history', 'cp.dry-run', 'cp.approval']);
    const last = checkpointWindow(atTheGate(), 'cp.report')!;
    expect(last.states.map((s) => s.id)).toEqual(['cp.canary', 'cp.verify-canary', 'cp.roll-fleet', 'cp.report'].slice(1));
  });

  it('falls back to the active checkpoint when no gate was named', () => {
    expect(checkpointWindow(atTheGate(), null)!.states.map((s) => s.id)).toEqual(
      checkpointWindow(atTheGate(), GATE)!.states.map((s) => s.id),
    );
  });

  it('composes the reference from the declaration and nothing else', () => {
    expect(referenceLine(declared())).toBe(`${ANCHOR.runbookId} · v${ANCHOR.version} · marked strict`);
  });

  it('keeps the denominator read, never recomputed', () => {
    expect(denominatorLine(declared())).toContain(`0 of ${ANCHOR.verifiableCount} provable checkpoints attested`);
  });
});
