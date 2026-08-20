/**
 * WP-46 · THE RE-ENTRY (M6 · XD-26 §6b, §6c) — and the promotion that must not
 * lose anything.
 *
 * Four things this file is for, in order of weight:
 *
 *  1. **PROMOTION IDENTITY, DRIVEN END TO END.** The arrival's door hands a
 *     session id to `NexusOverview`'s own promote closure, which fetches THAT
 *     session over `RETURN_SESSION` from the REAL registry folded over the
 *     designer's morning, and the row lands in the re-entry. The test asserts
 *     the three XD-26 names — same session id, same cursor, same pending
 *     approvals — survive the whole path AND appear on screen. A promotion that
 *     loses anything is a defect, not a density.
 *  2. **THE MARKS ARE THE SHIPPED DENSITIES'.** Not "equivalent": the same
 *     function. The case table below drives every status × attest combination
 *     through the rendered rail and compares each mark to `checkpointMark`'s own
 *     answer, and a source pin asserts this sheet holds no second mark table.
 *  3. **THE STANDING APPROVAL IS WRITABLE FROM THE PAYLOAD ALONE**, and is never
 *     re-asked.
 *  4. **§6c** — the ratified strings verbatim, and the negative pin: the phrase
 *     "unknown procedure" appears nowhere in the tree or in the source.
 */
import * as React from 'react';
import * as fs from 'fs';
import * as path from 'path';

import { serializeTree } from './helpers/serializeTree';
import { assertGoldenShape, buildMorning, type Morning } from './helpers/returnMorning';
import { SessionReEntry } from '../../../src/renderer/components/return/SessionReEntry';
import { RETURN_COPY } from '../../../src/renderer/components/return/returnCopy.generated';
import { standingApprovalSentence } from '../../../src/renderer/components/return/arrivalModel';
import {
  ATTEST_WORDS,
  checkpointMark,
} from '../../../src/renderer/components/DockedPanel/procedureModel';
import type { CheckpointState } from '../../../src/main/intelligence-host/procedureView';
import type { PendingApproval, SessionRow, TriageView } from '../../../src/main/intelligence-host/sessionRegistry';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SOURCE = path.join(REPO_ROOT, 'src', 'renderer', 'components', 'return', 'SessionReEntry.tsx');

let morning: Morning;
let triage: TriageView;

beforeEach(() => {
  morning = buildMorning();
  triage = assertGoldenShape(morning);
});

afterEach(() => {
  morning.close();
});

function walk(node: any, out: any[] = []): any[] {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  if (typeof node !== 'object') return out;
  if (node.type !== undefined) out.push(node);
  walk(node.children, out);
  return out;
}

function textOf(node: any, out: string[] = []): string[] {
  if (node === null || node === undefined) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const n of node) textOf(n, out); return out; }
  if (typeof node === 'object') textOf(node.children, out);
  return out;
}

const props = (node: any): Record<string, any> => (node && node.props) || {};
const byAttr = (nodes: any[], attr: string) => nodes.filter((n) => props(n)[attr] !== undefined);

function reentry(session: SessionRow | null, overrides: any = {}): { tree: any; nodes: any[] } {
  const instance = new (SessionReEntry as any)({ session, ...overrides });
  const tree = serializeTree(instance.render());
  return { tree, nodes: walk(tree) };
}

/** The morning's halted run — approval standing, cursor at a later checkpoint. */
function charlieSession(): SessionRow {
  const id = triage.waiting[0].sessionId as string;
  const row = morning.registry().session(id);
  expect(row).toBeDefined();
  return row as SessionRow;
}

// ===========================================================================

describe('promotion identity — same session id, same cursor, same pending approvals', () => {
  test('the three survive the whole path: a row\'s door, the fetch, the re-entry', async () => {
    // The REAL container's promote closure, not a re-implementation of it.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NexusOverview } = require('../../../src/renderer/components/NexusOverview');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { IPC_CHANNELS } = require('../../../src/common/constants');

    const registry = morning.registry();
    const sessionId = triage.waiting[0].sessionId as string;
    const expected = registry.session(sessionId) as SessionRow;
    expect(expected).toBeDefined();
    expect(expected.gate).toBeDefined();
    expect(expected.approvals.some((a) => a.state === 'approved')).toBe(true);

    const invoke = jest.fn((channel: string, arg: unknown) => {
      if (channel === IPC_CHANNELS.RETURN_SESSION) {
        // The IPC bridge is a PASS-THROUGH: whatever id arrives is the id asked
        // of the registry, and the row is returned untouched.
        return Promise.resolve(registry.session(String(arg)));
      }
      return Promise.resolve(undefined);
    });

    const shell = new NexusOverview({ NavLink: () => null, electron: { ipcRenderer: { invoke, on: () => {}, removeListener: () => {} } } });
    shell.state = { ...shell.state, activeTab: 'now', loading: false, stats: { localSites: { total: 0, running: 0, halted: 0 } } };
    (shell as any).mounted = true;
    shell.setState = (patch: any) => { shell.state = { ...shell.state, ...patch }; };

    // 1 · the arrival is what Home renders, and its door carries the session id.
    const arrivalEl: any = shell.renderActiveTab();
    expect(arrivalEl.props.onPromote).toBeInstanceOf(Function);
    arrivalEl.props.onPromote(sessionId);
    await Promise.resolve();
    await Promise.resolve();

    // 2 · the fetch asked for THAT id, and nothing between rewrote it.
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.RETURN_SESSION, sessionId);

    // 3 · the row that came back IS the registry's, field for field.
    const carried = shell.state.returnSession as SessionRow;
    expect(carried).toEqual(expected);
    expect(carried.id).toBe(expected.id);
    expect(carried.gate).toEqual(expected.gate);
    expect(carried.approvals).toEqual(expected.approvals);

    // 4 · and it reaches the re-entry, on screen, still itself.
    const reentryEl: any = shell.renderActiveTab();
    expect(reentryEl.props.session).toBe(carried);

    const { nodes } = reentry(carried);
    const surface = byAttr(nodes, 'data-session')[0];
    expect(props(surface)['data-session']).toBe(expected.id);
    expect(props(surface)['data-arm']).toBe('established');

    // THE CURSOR — the gate the fold reported, rendered as its own block.
    const gateBlock = byAttr(nodes, 'data-gate')[0];
    expect(props(gateBlock)['data-gate']).toBe(expected.gate!.checkpointId);

    // THE PENDING APPROVALS — the SET, not a count, and each one still standing.
    const standing = byAttr(nodes, 'data-standing-checkpoint').map((n) => props(n)['data-standing-checkpoint']);
    expect(standing).toEqual(expected.approvals.filter((a) => a.state === 'approved').map((a) => a.checkpointId));
    expect(standing.length).toBeGreaterThan(0);
  });

  test('a session id that resolves to nothing lands on 6c, never on a blank re-entry', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NexusOverview } = require('../../../src/renderer/components/NexusOverview');
    const invoke = jest.fn().mockResolvedValue(undefined);
    const shell = new NexusOverview({ NavLink: () => null, electron: { ipcRenderer: { invoke, on: () => {}, removeListener: () => {} } } });
    shell.state = { ...shell.state, activeTab: 'now', loading: false, stats: { localSites: { total: 0, running: 0, halted: 0 } } };
    (shell as any).mounted = true;
    shell.setState = (patch: any) => { shell.state = { ...shell.state, ...patch }; };

    shell.renderActiveTab().props.onPromote('sess_gone');
    await Promise.resolve();
    await Promise.resolve();

    expect(shell.state.returnSessionId).toBe('sess_gone');
    expect(shell.state.returnSession).toBeNull();

    const { nodes } = reentry(shell.state.returnSession);
    expect(props(byAttr(nodes, 'data-arm')[0])['data-arm']).toBe('unestablished');
  });
});

describe('the declared list — marks from the RECORD, and the shipped densities\' own function', () => {
  test('the rail renders every declared checkpoint, in the document\'s order', () => {
    const session = charlieSession();
    const { nodes } = reentry(session);
    const drawn = byAttr(nodes, 'data-checkpoint').map((n) => props(n)['data-checkpoint']);

    expect(session.checkpoints!.length).toBeGreaterThan(0);
    expect(drawn).toEqual(session.checkpoints!.map((c) => c.id));
  });

  test('every mark IS `checkpointMark`\'s answer — one derivation, not two', () => {
    // The full case table: every status × every attest class, plus the
    // verified/unverified split that separates the tick from the neutral dot.
    const statuses: CheckpointState['status'][] = ['pending', 'active', 'attested', 'skipped', 'aborted'];
    const attests: CheckpointState['attest'][] = ['event', 'manifest', 'narrative'];
    const cases: CheckpointState[] = [];
    for (const status of statuses) {
      for (const attest of attests) {
        for (const verified of [true, false]) {
          cases.push({
            id: `cp.${status}-${attest}-${verified}`,
            status,
            attest,
            verified,
            reason: null,
            source: 'runbook',
            unrequested: false,
          });
        }
      }
    }
    expect(cases).toHaveLength(30);

    const session: SessionRow = { ...charlieSession(), checkpoints: cases, gate: undefined };
    const { nodes } = reentry(session);
    const marks = byAttr(nodes, 'data-mark').map((n) => textOf(n).join(''));

    expect(marks).toHaveLength(cases.length);
    expect(marks).toEqual(cases.map((c, i) => checkpointMark(c, i)));

    // And the ticks are exactly the attested-and-provable ones — never a
    // narrative checkpoint, whatever `verified` claims.
    const ticked = cases.filter((c, i) => marks[i] === '✓');
    expect(ticked.every((c) => c.attest !== 'narrative')).toBe(true);
    expect(ticked.every((c) => c.status === 'attested' && c.verified)).toBe(true);
  });

  test('this sheet holds NO second mark table — it imports the one the densities use', () => {
    const source = fs.readFileSync(SOURCE, 'utf-8');
    expect(source).toContain("from '../DockedPanel/procedureModel'");
    expect(source).toContain('checkpointMark');
    // A literal tick anywhere in this file would be a mark decided here.
    expect(source).not.toContain('✓');
    expect(source).not.toContain('MARK_ATTESTED =');
    expect(source).not.toContain('MARK_RECORDED =');
  });

  test('the attest words are the document\'s, verbatim from the seam', () => {
    const session = charlieSession();
    const { nodes } = reentry(session);
    const text = textOf(byAttr(nodes, 'data-declared')[0]).join(' | ');

    for (const state of session.checkpoints!) {
      expect(text).toContain(ATTEST_WORDS[state.attest]);
    }
  });

  test('the denominator is the honest one — provable checkpoints, not all of them', () => {
    const session = charlieSession();
    const { nodes } = reentry(session);
    const denominator = textOf(byAttr(nodes, 'data-denominator')[0]).join('');

    const provable = session.checkpoints!.filter((c) => c.attest !== 'narrative').length;
    const narrative = session.checkpoints!.length - provable;
    expect(denominator).toContain(`of ${provable} provable`);
    if (narrative > 0) expect(denominator).toContain('on the agent’s account only');
  });
});

describe('the standing approval — its own block, above the gate, never re-asked', () => {
  test('the sentence is writable from the PendingApproval alone', () => {
    const session = charlieSession();
    const approved = session.approvals.filter((a) => a.state === 'approved');
    expect(approved.length).toBeGreaterThan(0);
    expect(approved[0].decidedAt).toBeDefined();

    const { nodes } = reentry(session);
    const block = byAttr(nodes, 'data-standing')[0];
    const text = textOf(block).join(' ');

    for (const a of approved) {
      expect(text).toContain(a.checkpointId);
      expect(text).toContain(a.decidedAt as string);
      // The ratified sentence, with the moment substituted and nothing retyped.
      expect(text).toContain(`${RETURN_COPY.STANDING_APPROVAL_PREFIX}${a.decidedAt}${RETURN_COPY.STANDING_APPROVAL_SUFFIX}`);
    }
  });

  test('a DENIED decision never renders as standing', () => {
    const session = charlieSession();
    const denied: SessionRow = {
      ...session,
      approvals: [{ checkpointId: 'cp.approval', state: 'denied' }],
    };
    const { nodes } = reentry(denied);
    expect(byAttr(nodes, 'data-standing')).toHaveLength(0);
  });

  /**
   * THE SENTENCE ITSELF, over the whole state table.
   *
   * Battery finding (M07/M08 survived the first drive): the render path reaches
   * `standingApprovalSentence` only through `standingApprovals`, which already
   * filters to `approved` — so the two guards INSIDE the sentence builder were
   * never exercised by a render test, and a mutation to either survived while
   * the surface it protects was drawn correctly. Two gates in series, and only
   * the outer one was pinned. This drives the inner one directly.
   */
  describe('the sentence builder\'s own guards', () => {
    const at = '2026-08-18T12:11:00.000Z';

    test('ONLY an approved decision yields a sentence — pending and denied yield null', () => {
      const states: Array<PendingApproval['state']> = ['pending', 'approved', 'denied'];
      const built = states.map((state) => standingApprovalSentence({ checkpointId: 'cp.approval', state, decidedAt: at }));

      expect(built[0]).toBeNull(); // pending — the question is asked AT the gate
      expect(built[2]).toBeNull(); // denied  — a refusal is not consent standing
      expect(built[1]).toBe(
        `${RETURN_COPY.STANDING_APPROVAL_PREFIX}${at}${RETURN_COPY.STANDING_APPROVAL_SUFFIX}`,
      );
      // Exactly one of the three states produces the sentence.
      expect(built.filter((b) => b !== null)).toHaveLength(1);
    });

    test('an approved decision with NO moment yields null, never "approved this plan undefined"', () => {
      // `decidedAt` is present for `approved` by the contract's own rule, so
      // this state should be unreachable — which is exactly why the guard has
      // to be pinned rather than trusted: an unreachable state that becomes
      // reachable renders the word `undefined` where the moment belongs, and
      // XD-26's sentence is about WHEN the person approved.
      expect(standingApprovalSentence({ checkpointId: 'cp.approval', state: 'approved' })).toBeNull();
      const good = standingApprovalSentence({ checkpointId: 'cp.approval', state: 'approved', decidedAt: at });
      expect(good).not.toBeNull();
      expect(good).not.toContain('undefined');
    });
  });

  test('the block sits ABOVE the gate, and there is no second approval to give', () => {
    const session = charlieSession();
    const { nodes } = reentry(session);

    const order = nodes
      .map((n, i) => ({ i, standing: props(n)['data-standing'], gate: props(n)['data-gate'] }))
      .filter((x) => x.standing !== undefined || x.gate !== undefined);
    expect(order[0].standing).toBeDefined();
    expect(order[order.length - 1].gate).toBeDefined();

    // XD-26's absences, at the render: no second approval, no confirm-you-are-
    // back, no resume button that re-arms anything. The established-arm re-entry
    // offers NO control at all — acting on the gate is the shipped approval
    // card's job, through the channels it already has.
    expect(nodes.filter((n) => n.type === 'button')).toHaveLength(0);
    for (const tag of ['input', 'select', 'textarea', 'form']) {
      expect(nodes.filter((n) => n.type === tag)).toHaveLength(0);
    }
  });
});

describe('the gate card — at the cursor, with the document\'s own attest words', () => {
  test('the card is the cursor\'s checkpoint, and its attest class is the record\'s', () => {
    const session = charlieSession();
    const cursor = session.gate!.checkpointId;
    const state = session.checkpoints!.find((c) => c.id === cursor)!;

    const { nodes } = reentry(session);
    const card = byAttr(nodes, 'data-gate')[0];

    expect(props(card)['data-gate']).toBe(cursor);
    expect(textOf(card).join(' ')).toContain(ATTEST_WORDS[state.attest]);
    expect(props(byAttr(walk(card), 'data-attest')[0])['data-attest']).toBe(state.attest);
  });

  test('a complete run has no gate, so it draws no gate card', () => {
    const session: SessionRow = { ...charlieSession(), gate: undefined };
    const { nodes } = reentry(session);
    expect(byAttr(nodes, 'data-gate')).toHaveLength(0);
  });
});

describe('§6c — the platform names its own limit', () => {
  test('the four ratified strings, verbatim, when the arm cannot be established', () => {
    const { nodes } = reentry(null);
    const text = textOf(nodes[0]).join('\n');

    expect(text).toContain(RETURN_COPY.UNKNOWN_ARM_LEAD);
    expect(text).toContain(RETURN_COPY.UNKNOWN_ARM_BODY);
    expect(text).toContain(RETURN_COPY.UNKNOWN_ARM_DOOR);
    expect(text).toContain(RETURN_COPY.UNKNOWN_ARM_OFFER);

    // Both doors are present and each is a real control.
    expect(byAttr(nodes, 'data-door').map((n) => props(n)['data-door'])).toEqual(['find-in-record', 'start-new-run']);
  });

  test('a folded session whose document is unavailable is 6c too', () => {
    const session: SessionRow = { ...charlieSession(), documentUnavailable: true };
    const { nodes } = reentry(session);

    expect(props(byAttr(nodes, 'data-arm')[0])['data-arm']).toBe('unestablished');
    // Nothing armed: no checkpoint rail, no attest words, no denominator.
    expect(byAttr(nodes, 'data-checkpoint')).toHaveLength(0);
    expect(byAttr(nodes, 'data-declared')).toHaveLength(0);
    expect(byAttr(nodes, 'data-denominator')).toHaveLength(0);
  });

  test('NO "unknown procedure" — not in the tree, not in the source', () => {
    for (const session of [null, { ...charlieSession(), documentUnavailable: true }] as (SessionRow | null)[]) {
      const { nodes } = reentry(session);
      const text = textOf(nodes[0]).join('\n').toLowerCase();
      expect(text).not.toContain('unknown procedure');
      expect(text).not.toContain('unknown arm');
    }
    // The negative pin the sheet asks for, at the SOURCE, over the whole
    // directory — a label absent from one component and present in its sibling
    // is one refactor away from being on screen. This test file is the only
    // place the phrase may be written, because writing it here is what forbids
    // it everywhere else.
    const dir = path.join(REPO_ROOT, 'src', 'renderer', 'components', 'return');
    const files = fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(2);
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), 'utf-8').toLowerCase();
      expect({ file, hit: source.includes('unknown procedure') }).toEqual({ file, hit: false });
    }
  });

  test('no scrollback, and no everything-since-you-left prose', () => {
    const session = charlieSession();
    const { nodes } = reentry(session);

    // Every text node on this surface traces to a field of the row, a ratified
    // string, or the seam's attest words. A transcript would arrive as turns.
    expect(byAttr(nodes, 'data-turn')).toHaveLength(0);
    expect(nodes.filter((n) => props(n).role === 'log')).toHaveLength(0);

    // The re-entry says it resumed; it does not narrate what happened.
    expect(textOf(byAttr(nodes, 'data-resumed')[0]).join('')).toBe(RETURN_COPY.RESUMED);
  });
});
