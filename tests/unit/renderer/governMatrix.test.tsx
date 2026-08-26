/**
 * WP-44 · the Govern matrix's RENDER, and the must-nots at the surface.
 *
 * The seam's own suite pins the derivation. This one pins the four things a
 * correct derivation can still be drawn wrongly:
 *
 *  1. The disarmed row — switch ON, chip loud, band with reason and door, never
 *     drawn as denied. Ruling 3 is a render ruling, so it is tested at the render.
 *  2. The id kept in mono BESIDE the label, never replaced by it.
 *  3. The door landing on the ROW, not on the top of the page.
 *  4. The absences: no grant-all control, no count, no score, no severity paint
 *     on the production rows, and no route in or out through a conversation.
 *
 * IT RENDERS AGAINST THE REAL SEAM. The matrix under test is built by
 * `buildGovernMatrix` over the real `law/` directory — not a hand-written
 * fixture. A fixture would be a second transcription of the documents, and the
 * one property this surface exists to have is that it says what the documents
 * say.
 */
import * as React from 'react';
import * as path from 'path';

import { serializeTree } from './helpers/serializeTree';
import { loadLawDirectory, RunbookRegistry } from '../../../src/intelligence';
import { buildGovernMatrix } from '../../../src/main/intelligence-host/governMatrix';
import { MANDATED_EXPLICIT_CAPABILITIES } from '../../../src/main/intelligence-host/capabilityGrants';
import { governDoorFor } from '../../../src/main/intelligence-host/sequenceGuard';
import { GovernSection } from '../../../src/renderer/components/settings/GovernSection';
import type { GovernMatrix } from '../../../src/main/intelligence-host/governMatrix';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const registry = RunbookRegistry.build({
  documents: loadLawDirectory(path.join(REPO_ROOT, 'law')).documents,
});

// Pairs since the agent-addressing flip; the matrix renders per capability,
// so one grantee suffices.
const materializedSet = registry
  .runbooks({ strictness: 'strict' })
  .map((rb) => rb.capability)
  .filter((c) => !MANDATED_EXPLICIT_CAPABILITIES.includes(c))
  .map((capability) => ({ grantee: 'chat', capability }));

/** The shipped tree as a migrated machine sees it, plus one disarmed row. */
function realMatrix(): GovernMatrix {
  return buildGovernMatrix({
    runbooks: registry,
    materialized: materializedSet,
    settings: {
      capabilityGrants: [
        // A grant made against text that is not what is on disk — pinned for
        // the one grantee this fixture materializes ('chat'), so the row's
        // every holder is disarmed and the capability-level row reads Disarmed.
        { grantee: 'chat', capability: 'cap.promotion_preflight', enabled: true, runbookHash: 'sha256:deadbeefdeadbeef' },
      ],
    },
    issuance: new Map([
      ['cap.bulk_plugin_update', { eventId: 'evt_7a02', issuedAt: '2026-08-18T09:12:00' }],
      ['cap.incident_containment', { eventId: 'evt_7a03', issuedAt: '2026-08-18T09:12:00' }],
      ['cap.promotion_preflight', { eventId: 'evt_7a04', issuedAt: '2026-08-18T09:12:00' }],
    ]),
  });
}

const electron = { ipcRenderer: { invoke: jest.fn() } };

function section(overrides: any = {}): any {
  const instance = new (GovernSection as any)({ electron, ...overrides });
  instance.state = { matrix: realMatrix(), loading: false, pending: null, error: null, landedOn: null, ...(overrides.state ?? {}) };
  return instance;
}

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

const nodes = (instance: any): any[] => walk(serializeTree(instance.render()));

function allText(instance: any): string {
  return nodes(instance)
    .flatMap((n) => {
      const kids = n.children ?? [];
      return (Array.isArray(kids) ? kids : [kids]).filter((k: any) => typeof k === 'string');
    })
    .join(' ');
}

const byProp = (instance: any, prop: string, value?: string): any[] =>
  nodes(instance).filter((n) => n.props && n.props[prop] !== undefined && (value === undefined || n.props[prop] === value));

// ───────────────────────────────────────────────────────────────────────────

describe('WP-44 render · every row is drawn, and none is hidden', () => {
  test('one row per capability the registry serves', () => {
    const rows = byProp(section(), 'data-govern-row');
    expect(rows).toHaveLength(registry.runbooks().length);
    expect(rows.map((r) => r.props['data-govern-row']).sort()).toEqual(
      registry.runbooks().map((rb) => rb.capability).sort()
    );
  });

  test('the chrome above the table is the ratified sentence', () => {
    expect(allText(section())).toContain(
      'Nothing here is granted because a document exists. A capability arrives denied, and ' +
        'becomes granted only by an act recorded on this list.'
    );
  });

  test('an unreadable register says so — it does not draw seven denials', () => {
    const s = section({ state: { matrix: null } });
    const text = allText(s);
    expect(text).toContain('could not read the capability register');
    expect(byProp(s, 'data-govern-row')).toHaveLength(0);
  });
});

describe('WP-44 render · the disarmed row, as ruled', () => {
  const disarmedRow = () =>
    byProp(section(), 'data-govern-row', 'cap.promotion_preflight')[0];

  test('the SWITCH is ON — it renders consent, and nothing withdrew it', () => {
    const s = section();
    const sw = byProp(s, 'data-govern-switch', 'cap.promotion_preflight')[0];
    expect(sw.props.checked).toBe(true);
  });

  test('the CHIP is loud, and says Disarmed rather than Denied', () => {
    const s = section();
    const chip = byProp(s, 'data-govern-chip').find(
      (n) => n.props['data-govern-chip'] === 'disarmed'
    );
    expect(chip).toBeDefined();
    expect(chip.children).toContain('Disarmed');
    expect(disarmedRow().props['data-govern-state']).toBe('disarmed');
    expect(disarmedRow().props['data-govern-state']).not.toBe('denied');
  });

  test('the band renders with its reason and its door', () => {
    const s = section();
    const band = byProp(s, 'data-govern-band', 'cap.promotion_preflight')[0];
    expect(band).toBeDefined();
    const text = allText(s);
    expect(text).toContain('Granted, and disarmed on an integrity failure.');
    expect(text).toContain('Not staleness');
    expect(byProp(s, 'data-govern-band-door', 'cap.promotion_preflight')).toHaveLength(1);
    expect(text).toContain('Re-grant against the current document.');
  });

  /**
   * THE INVERSION THIS FORBIDS, driven rather than described.
   *
   * A surface that read "not in force" and drew the switch off would look
   * plausible and would be the platform revoking on the user's behalf. The
   * disarmed row's switch must differ from a DENIED row's switch — so the test
   * compares them rather than asserting one in isolation.
   */
  test('a disarmed switch and a denied switch are NOT drawn the same', () => {
    const s = section();
    const disarmed = byProp(s, 'data-govern-switch', 'cap.promotion_preflight')[0];
    const denied = byProp(s, 'data-govern-switch', 'cap.wpe_pull')[0];
    expect(disarmed.props.checked).toBe(true);
    expect(denied.props.checked).toBe(false);
  });
});

describe('WP-44 render · the id stays beside the label', () => {
  test('every row draws its ratified label AND its id in mono', () => {
    const s = section();
    const text = allText(s);
    expect(text).toContain('Update plugins across sites');
    expect(text).toContain('Promote one environment to another');
    for (const rb of registry.runbooks()) {
      const idNode = byProp(s, 'data-govern-id', rb.capability)[0];
      expect(idNode).toBeDefined();
      expect(idNode.children).toContain(rb.capability);
      // In mono, because it is an identifier the refusals quote verbatim.
      expect(String(idNode.props.style.fontFamily)).toMatch(/mono/i);
    }
  });

  test('the label never REPLACES the id anywhere on the row', () => {
    const text = allText(section());
    for (const rb of registry.runbooks()) expect(text).toContain(rb.capability);
  });
});

describe('WP-44 render · the door lands on the row', () => {
  test('a door marks its own row and no other', () => {
    const s = section({ door: governDoorFor('cap.promote_environment', 'rb.promotion-execute') });
    (global as any).document = { querySelector: () => null };
    s.setState = (patch: any, cb?: () => void) => {
      Object.assign(s.state, typeof patch === 'function' ? patch(s.state) : patch);
      cb?.();
    };
    s.applyDoor();
    expect(s.state.landedOn).toBe('cap.promote_environment');

    const marked = byProp(s, 'data-govern-row').filter(
      (n) => JSON.stringify(n.props.style).includes('inset 3px')
    );
    expect(marked).toHaveLength(1);
    expect(marked[0].props['data-govern-row']).toBe('cap.promote_environment');
  });

  test('a door for a capability nothing serves marks NOTHING — never row zero', () => {
    const s = section({ door: governDoorFor('cap.not_a_thing', 'rb.nope') });
    s.setState = (patch: any, cb?: () => void) => {
      Object.assign(s.state, typeof patch === 'function' ? patch(s.state) : patch);
      cb?.();
    };
    s.applyDoor();
    expect(s.state.landedOn).toBeNull();
    expect(byProp(s, 'data-govern-row').filter((n) => JSON.stringify(n.props.style).includes('inset 3px'))).toHaveLength(0);
  });
});

describe('WP-44 render · the gates column, unsoftened', () => {
  test('the zero-attestable rows say it, granted and ungranted alike', () => {
    const s = section();
    const text = allText(s);
    const occurrences = text.split('The grant itself, and nothing after it.').length - 1;
    // WP-45 · THIS COUNT IS DERIVED FROM THE DOCUMENTS, NOT TYPED BESIDE THEM.
    // It was 4 when four strict runbooks had no attestable checkpoint; the
    // ratified law review left exactly one (`rb.incident-containment`, whose
    // cp.snapshot and cp.isolate were verified against its body and fall to
    // narrative). Computing the expectation from the registry is what makes
    // this render test move WITH the law instead of having to be re-typed
    // after it — the designer's ratified property, applied to the surface.
    const zeroAttestable = registry
      .runbooks({ strictness: 'strict' })
      .filter((rb) => rb.checkpoints.every((c) => c.attest === 'narrative'));
    expect(zeroAttestable.map((rb) => rb.id)).toEqual(['rb.incident-containment']);
    expect(occurrences).toBe(zeroAttestable.length);
    for (const rb of zeroAttestable) {
      expect(text).toContain(`All ${rb.checkpoints.length} checkpoints are narrative`);
    }
  });

  test('the anchor row renders the split the document declares', () => {
    expect(allText(section())).toContain('4 of 8 checkpoints the platform can verify.');
  });

  /**
   * WP-45 · the law review reaching the SURFACE, which is the half a gates
   * column cannot prove on its own.
   *
   * The three documents that gained attestable checkpoints must render their
   * new denominators here, with nothing in the renderer edited. The numbers are
   * derived from the registry for the same reason as above.
   */
  test('the three reviewed documents render their new denominators', () => {
    const text = allText(section());
    for (const cap of ['cap.promote_environment', 'cap.promotion_preflight', 'cap.incident_remediation']) {
      const rb = registry.byCapability(cap)!;
      const attestable = rb.checkpoints.filter((c) => c.attest !== 'narrative').length;
      expect(attestable).toBeGreaterThan(0);
      expect(text).toContain(`${attestable} of ${rb.checkpoints.length} checkpoints the platform can verify.`);
    }
  });
});

describe('WP-44 render · what this surface must NOT draw', () => {
  const SRC = require('fs').readFileSync(
    path.join(REPO_ROOT, 'src', 'renderer', 'components', 'settings', 'GovernSection.tsx'),
    'utf-8'
  );
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  test('the comment stripper fired', () => {
    // A phrase that exists ONLY in this component's prose. Without this guard a
    // stripper that matched nothing would make every absence test below vacuous.
    expect(SRC).toMatch(/quietly revoking on the user's behalf/);
    expect(CODE).not.toMatch(/quietly revoking on the user's behalf/);
    expect(CODE).toContain('export class GovernSection');
  });

  test('NO grant-all, no bulk enable, no recommended set', () => {
    const s = section();
    // One switch per row and nothing else that could widen more than one.
    expect(byProp(s, 'data-govern-switch')).toHaveLength(registry.runbooks().length);
    expect(CODE).not.toMatch(/grantAll|enableAll|selectAll|bulk/i);
    // Every act call names exactly one capability.
    for (const m of CODE.matchAll(/setGrant\(([^)]*)\)/g)) {
      expect(m[1]).not.toContain('[');
    }
  });

  test('NO count of grants, and no score', () => {
    const text = allText(section());
    expect(text).not.toMatch(/\d+\s+of\s+7/);
    expect(text).not.toMatch(/\bgranted\b.*\bof\b.*\btotal\b/i);
    expect(CODE).not.toMatch(/\bscore\b|\bposture\b|\.length\s*\}\s*(granted|of)/i);
  });

  test('NO severity theatre on the production rows', () => {
    const s = section();
    for (const capability of MANDATED_EXPLICIT_CAPABILITIES) {
      const row = byProp(s, 'data-govern-row', capability)[0];
      expect(row.props['data-govern-state']).toBe('never-by-default');
      const rowText = walk(row)
        .flatMap((n) => {
          const kids = n.children ?? [];
          return (Array.isArray(kids) ? kids : [kids]).filter((k: any) => typeof k === 'string');
        })
        .join(' ');
      expect(rowText).not.toMatch(/danger|critical|severe|blocked|!/i);
      // The rule is stated once, in words, not dressed in red.
      expect(rowText).toContain('Production consequence is not a default');
      const chip = walk(row).find((n) => n.props && n.props['data-govern-chip']);
      expect(String(chip.props.style.background)).not.toMatch(/#c0392b|red/i);
    }
  });

  test('NO conversational route — the section never invokes a chat channel', () => {
    expect(CODE).not.toMatch(/CHAT_|chatSend|sendMessage|assistant|prompt/i);
    // The only two channels it speaks are its own.
    const channels = [...CODE.matchAll(/IPC_CHANNELS\.([A-Z_]+)/g)].map((m) => m[1]);
    expect([...new Set(channels)].sort()).toEqual(['GOVERN_MATRIX', 'GOVERN_SET_GRANT']);
  });

  test('NO copy of the runbook body reaches the page', () => {
    const text = allText(section());
    for (const rb of registry.runbooks()) {
      expect(text).not.toContain(rb.body.slice(0, 120));
      // Named and hashed is exactly what it does carry.
      expect(text).toContain(rb.id);
    }
  });
});
