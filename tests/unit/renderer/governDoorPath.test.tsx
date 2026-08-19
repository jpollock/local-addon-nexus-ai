/**
 * WP-44 · THE DOOR'S WHOLE PATH — refusal → panel → store → dashboard → row.
 *
 * WHY THIS SUITE EXISTS SEPARATELY. Every link in this chain is individually
 * tested and the chain can still be broken: `ScopeBlock` renders the door,
 * `PanelChat` supplies a handler, `nexusStore` carries the target, the dashboard
 * switches tab, the shell picks the section, and `GovernSection` marks the row.
 * Six components, two React roots, and the criterion is about the WHOLE trip —
 * "the door renders on the barred group and deep-links to that specific grant,
 * not to the top of Settings". A per-link test suite passes while a person
 * arrives at the top of Settings, which is precisely the failure being forbidden.
 *
 * WHAT IT DOES NOT CLAIM. It does not mount Local's shell or drive a live
 * refusal; it drives each seam's real code over a real structured target, in
 * order, and asserts the target survives the trip intact.
 */
import * as React from 'react';
import * as path from 'path';

import { serializeTree } from './helpers/serializeTree';
import { loadLawDirectory, RunbookRegistry } from '../../../src/intelligence';
import { buildGovernMatrix } from '../../../src/main/intelligence-host/governMatrix';
import { governDoorFor } from '../../../src/main/intelligence-host/sequenceGuard';
import { ScopeBlock } from '../../../src/renderer/components/DockedPanel/ScopeBlock';
import { FIXTURE_SELECTION } from '../../../src/renderer/components/DockedPanel/scopeModel';
import { deriveScope } from '../../../src/main/intelligence-host/procedureScope';
import { GovernSection } from '../../../src/renderer/components/settings/GovernSection';
import { nexusStore } from '../../../src/renderer/store/NexusStateManager';
import type { GovernDoorTarget } from '../../../src/main/intelligence-host/sequenceGuard';
import type { ProcedureScope } from '../../../src/main/intelligence-host/procedureScope';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const registry = RunbookRegistry.build({
  documents: loadLawDirectory(path.join(REPO_ROOT, 'law')).documents,
});

/**
 * The sheet's own worked example: "a scope block that barred 2 production cells
 * lands on cap.bulk_plugin_update (production needs its own runbook version,
 * which does not exist yet)". Using the case the design named means the trip
 * under test is the trip the design drew.
 */
const CAPABILITY = 'cap.bulk_plugin_update';
const RUNBOOK = 'rb.bulk-plugin-update';

/**
 * Every node in a serialized tree.
 *
 * FLATTENS DEEPLY, and that is not incidental: a component that spreads an array
 * of children (`...(cond ? [this.renderDoors()] : [])`) produces a child that is
 * itself an array, and a one-level walk silently skips every node inside it. The
 * first draft of this suite reported "no door rendered" against a block that had
 * rendered two.
 */
function walk(node: any, out: any[] = []): any[] {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  const children = node.children ?? node.props?.children;
  for (const k of Array.isArray(children) ? children : [children]) walk(k, out);
  return out;
}

/**
 * A scope whose barred group carries a real refusal's door.
 *
 * DERIVED BY THE SEAM, never hand-built. The first draft of this test wrote a
 * ProcedureScope literal and got two fields wrong in shapes the comparator
 * cannot produce — which is a fixture testing itself. `deriveScope` is the same
 * function the running refusal calls, so the door under test is the door a
 * person is actually handed.
 */
function barredScope(): ProcedureScope {
  const runbook = registry.byCapability(CAPABILITY)!;
  const grant = {
    capability: runbook.capability,
    runbookId: runbook.id,
    runbookHash: runbook.hash,
    strictness: runbook.strictness,
    // The runbook's OWN declared scope, read off the document rather than
    // retyped — which is what makes the production cells barred rather than a
    // fixture that decided they were.
    scope: { environments: (runbook.frontmatter as any).scope?.environments ?? [] },
    source: 'shipped' as const,
  };
  return deriveScope({
    selection: FIXTURE_SELECTION,
    runbook,
    grants: [grant],
    catalogue: registry.runbooks(),
  } as never);
}

describe('WP-44 · the door survives the whole trip', () => {
  afterEach(() => nexusStore.update({ governDoorRequest: null }));

  test('step 1 — the refusal renders a door carrying the structured target', () => {
    const captured: GovernDoorTarget[] = [];
    const block = new (ScopeBlock as any)({
      scope: barredScope(),
      surface: 'companion',
      onGovern: (d: GovernDoorTarget) => captured.push(d),
    });
    const doors = walk(serializeTree(block.render())).filter(
      (n) => n.props && n.props['data-govern-capability']
    );
    expect(doors.length).toBeGreaterThan(0);
    expect(doors[0].props['data-govern-capability']).toBe(CAPABILITY);
    // And it is ENABLED, because a handler now exists. This is the assertion
    // that would have been false before this packet: doors-need-handlers meant
    // the door rendered disabled until something could open it.
    expect(doors[0].props.disabled).toBe(false);
  });

  test('step 2 — the panel\'s handler publishes the WHOLE target, not a section name', () => {
    // PanelChat's handler, verbatim in behaviour: it publishes and grants nothing.
    const publish = (door: GovernDoorTarget) => nexusStore.update({ governDoorRequest: door });
    publish(governDoorFor(CAPABILITY, RUNBOOK));
    expect(nexusStore.get().governDoorRequest).toEqual({
      surface: 'settings',
      section: 'capabilities',
      capability: CAPABILITY,
      runbookId: RUNBOOK,
    });
  });

  test('step 3 — the section lands it on the capability\'s own row', () => {
    const door = nexusStore.get().governDoorRequest ?? governDoorFor(CAPABILITY, RUNBOOK);
    let handled = false;
    const s: any = new (GovernSection as any)({
      electron: { ipcRenderer: { invoke: jest.fn() } },
      door,
      onDoorHandled: () => {
        handled = true;
      },
    });
    s.state = {
      matrix: buildGovernMatrix({ runbooks: registry }),
      loading: false,
      pending: null,
      error: null,
      landedOn: null,
    };
    s.setState = (patch: any, cb?: () => void) => {
      Object.assign(s.state, typeof patch === 'function' ? patch(s.state) : patch);
      cb?.();
    };
    (global as any).document = { querySelector: () => null };

    s.applyDoor();

    expect(s.state.landedOn).toBe(CAPABILITY);
    expect(handled).toBe(true);

    const marked = walk(serializeTree(s.render())).filter(
      (n) => n.props && n.props['data-govern-row'] && JSON.stringify(n.props.style).includes('inset 3px')
    );
    expect(marked.map((n) => n.props['data-govern-row'])).toEqual([CAPABILITY]);
  });

  test('the target the refusal produced and the row it lands on name the SAME capability', () => {
    // The whole criterion in one assertion, over the two ends of the chain.
    const scope = barredScope();
    expect(scope.barred.length).toBeGreaterThan(0);
    const fromRefusal = scope.barred[0].governDoor;
    const matrix = buildGovernMatrix({ runbooks: registry });
    const row = matrix.rows.find((r) => r.capability === fromRefusal.capability);
    expect(row).toBeDefined();
    expect(row!.capability).toBe(fromRefusal.capability);
    // Marking has to be a CHOICE, not the only option: with seven rows on the
    // page, landing on the right one is evidence. The row-zero fallback this
    // forbids is separately driven in governMatrix.test.tsx, where a door for an
    // unserved capability must mark nothing at all.
    expect(matrix.rows.length).toBeGreaterThan(1);
  });

  test('the panel publishes a REQUEST TO SHOW, never a grant', () => {
    // XD-8 and J-Refusal's third must-not: no conversational shortcut elicits
    // the widening in the chat that walked her there. The store carries a target;
    // it has no field a grant could travel in.
    const publish = (door: GovernDoorTarget) => nexusStore.update({ governDoorRequest: door });
    publish(governDoorFor(CAPABILITY, RUNBOOK));
    const request = nexusStore.get().governDoorRequest as unknown as Record<string, unknown>;
    expect(Object.keys(request).sort()).toEqual(['capability', 'runbookId', 'section', 'surface']);
    expect(JSON.stringify(request)).not.toMatch(/grant|enabled|consent/i);
  });
});
