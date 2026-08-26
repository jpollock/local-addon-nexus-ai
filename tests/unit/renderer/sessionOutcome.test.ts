/**
 * fixes-082526 · board D — a session's title is derived from what it DID.
 *
 * The pin, verbatim: "the runbook it armed, what it verified, whether it was
 * refused. The first message is what a person meant to do, and nine sessions
 * that meant the same thing are indistinguishable by it." Five sessions,
 * three titles, no way to tell which one halted — that list is the defect.
 *
 * The deriver reads ONLY the procedure stream state the panel already folds
 * (ProcedureStreamState), so every word it emits traces to a recorded fact:
 * the armed declaration, the verified counts, the abort's own groups, the
 * refusal's own code. A session that armed nothing keeps its typed title —
 * what a person meant IS the honest name for a session that only asked —
 * and says 'no run armed' in its meta.
 */
import {
  deriveSessionOutcome,
  humanizeDocId,
} from '../../../src/renderer/components/DockedPanel/sessionOutcome';
import { emptyProcedureState } from '../../../src/renderer/components/DockedPanel/procedureModel';

const cp = (id: string, status: string, verified: boolean) => ({
  id, status, attest: 'platform', verified, reason: null, source: 'runbook', unrequested: false,
});

function armed(over: Record<string, unknown> = {}) {
  return {
    procedure: {
      capability: 'cap.bulk_plugin_update',
      runbookId: 'rb.bulk-plugin-update',
      version: '1.2.0',
      strictness: 'strict',
      hash: 'sha256:abc',
      armedBy: 'predicate',
      checkpoints: [cp('cp.a', 'attested', true), cp('cp.b', 'attested', true), cp('cp.c', 'pending', false)],
      verifiableCount: 2,
      communication: [],
      ...over,
    },
    abort: null,
  } as never;
}

describe('humanizeDocId', () => {
  it('strips the registry prefix and reads as words', () => {
    expect(humanizeDocId('rb.bulk-plugin-update')).toBe('bulk plugin update');
    expect(humanizeDocId('cap.incident_containment')).toBe('incident containment');
  });
});

describe('deriveSessionOutcome', () => {
  it('nothing armed → typed title stands, meta says so', () => {
    const out = deriveSessionOutcome(emptyProcedureState());
    expect(out.title).toBeNull();
    expect(out.meta).toBe('no run armed');
  });

  it('a run that armed and verified → titled by the runbook, meta carries the honest counts', () => {
    const out = deriveSessionOutcome(armed());
    expect(out.title).toBe('Ran bulk plugin update');
    expect(out.meta).toBe('rb.bulk-plugin-update · 2 of 2 verified');
  });

  it('a halt → titled Halted with the abort\'s own reason, meta from its groups', () => {
    const state = armed();
    (state as any).abort = {
      type: 'procedure_aborted',
      abortId: 'ab_1',
      checkpointId: 'cp.b',
      reason: 'a verify failed',
      groups: { done: [{}], failed: [{}], skipped: [], untouched: [{}], unavailable: [], headline: '' },
      restore: { perSite: [], note: '' },
    };
    const out = deriveSessionOutcome(state);
    expect(out.title).toBe('Halted bulk plugin update — a verify failed');
    expect(out.meta).toBe('rb.bulk-plugin-update · 1 done, 1 untouched');
  });

  it('a refusal → titled Refused, meta names the reason class, never a fabricated grant story', () => {
    const state = armed({
      runbookId: null,
      checkpoints: [],
      verifiableCount: 0,
      unavailable: { code: 'hash-mismatch', reason: 'the reviewed document changed' },
    });
    const out = deriveSessionOutcome(state);
    expect(out.title).toBe('Refused: bulk plugin update');
    expect(out.meta).toBe('document changed since review');
  });

  it('an aborted session with zero done reports zero honestly, not a blank', () => {
    const state = armed();
    (state as any).abort = {
      type: 'procedure_aborted', abortId: 'ab_2', checkpointId: 'cp.a', reason: 'halted by you',
      groups: { done: [], failed: [{}], skipped: [], untouched: [{}, {}], unavailable: [], headline: '' },
      restore: { perSite: [], note: '' },
    };
    expect(deriveSessionOutcome(state).meta).toBe('rb.bulk-plugin-update · 0 done, 2 untouched');
  });
});
