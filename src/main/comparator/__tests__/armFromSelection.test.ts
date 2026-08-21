/**
 * WP-41 · THE WALK — a selection becoming an arming, end to end.
 *
 * This is the packet's central claim and the hole WP-37 measured:
 *
 *     deriveScope(          production callers: ZERO
 *     recordArmingRequest(  production callers: ONE — with no scope argument
 *
 * So the pins below are deliberately NOT unit tests of a mock. The real `law/`
 * directory supplies the document (`bulk-plugin-update` declares `[local,
 * wpe_staging, wpe_development]`, with production needing its own runbook
 * version — the designer's split sheet is that fact), the real `deriveScope`
 * splits it, and the real `procedureArming` queue is read back. Only the core
 * registry and the live grant set are injected, because those are process
 * state rather than logic.
 *
 * The two rules that carry the acceptance:
 *
 *  - **A zero-runnable scope STILL ARMS** (WP-37's rule 3). The plausible wrong
 *    implementation is "record it only when something runs", and it deletes the
 *    ratified empty-run state from the product entirely.
 *  - **`previewScope` records NOTHING.** It runs on every click; an arming per
 *    keystroke would be delivered to whatever turn came next.
 */
import * as path from 'path';
import { loadLawDirectory, RunbookRegistry } from '../../../intelligence';
import { clearArmingRequests, peekArmingRequests } from '../../intelligence-host/procedureArming';
import { setIntelligenceCore } from '../../intelligence-host/coreRegistry';
import * as grants from '../../intelligence-host/capabilityGrants';
import { armFromSelection, previewScope } from '../armFromSelection';
import type { ScopeSelection } from '../../intelligence-host/procedureScope';

const CAPABILITY = 'cap.bulk_plugin_update';
const LAW_DIR = path.join(__dirname, '..', '..', '..', '..', 'law');

/** The from-line a real matrix render stamps — comparatorId and filter, verbatim. */
const FROM = {
  surface: 'comparator' as const,
  comparatorId: 'cmp.plugin-woocommerce',
  filter: 'plugin=woocommerce',
};

const cell = (id: string, name: string, place: ScopeSelection['cells'][number]['place']) => ({
  siteId: id,
  siteName: name,
  place,
});

const STAGING = { host: 'wpe' as const, kind: 'staging' as const };
const PRODUCTION = { host: 'wpe' as const, kind: 'production' as const };

function useRealLaw(): void {
  const { documents } = loadLawDirectory(LAW_DIR);
  const runbooks = RunbookRegistry.build({ documents });
  setIntelligenceCore({ law: { runbooks } } as never);
}

function grantAllDeclared(): void {
  const runbook = { id: 'rb.bulk-plugin-update' };
  jest.spyOn(grants, 'getCapabilityGrants').mockReturnValue([
    {
      capability: CAPABILITY,
      runbookId: runbook.id,
      runbookHash: 'sha256:x',
      strictness: 'strict',
      // The grant's scope IS the runbook's own here — settings did not widen it.
      scope: { environments: ['local', 'wpe_staging', 'wpe_development'] },
      source: 'shipped',
    } as never,
  ]);
}

beforeEach(() => {
  clearArmingRequests();
  useRealLaw();
  grantAllDeclared();
});

afterEach(() => {
  jest.restoreAllMocks();
  clearArmingRequests();
});

describe('the selection reaches the carrier', () => {
  it('records the arming WITH the derived scope — deriveScope’s first production caller', () => {
    const selection: ScopeSelection = {
      from: FROM,
      cells: [cell('e.alpha', 'Alpha', STAGING), cell('e.echo', 'Echo', STAGING)],
    };
    const at = new Date('2026-08-19T12:04:00.000Z');
    const outcome = armFromSelection(CAPABILITY, selection, at);

    const [request] = peekArmingRequests();
    expect(request.capability).toBe(CAPABILITY);
    expect(request.at).toBe(at.toISOString());
    // HANDED ON UNCHANGED. `toBe`, not `toEqual`: an equal-but-rebuilt scope is
    // the re-derivation the whole seam exists to catch, and it would satisfy
    // every equality assertion ever written.
    expect(request.scope).toBe(outcome.scope);
    expect(request.scope!.runnable.map((c) => c.siteName)).toEqual(['Alpha', 'Echo']);
  });

  it('resolves the from-line to the matrix render that produced the selection', () => {
    // XD-15 pin 5 and the WP-37 ruling's whole point: candidate A is the scope's
    // ratified provenance, so `surface` is 'comparator' and the id and filter
    // are the render's own, not composed at the arming.
    const selection: ScopeSelection = { from: FROM, cells: [cell('e.alpha', 'Alpha', STAGING)] };
    armFromSelection(CAPABILITY, selection);
    expect(peekArmingRequests()[0].scope!.from).toBe(FROM);
    expect(peekArmingRequests()[0].scope!.from.surface).toBe('comparator');
  });

  it('leaves the key ABSENT, never present-undefined, when nothing armed', () => {
    // The parity floor: every turn predating WP-32 is byte-identical, and
    // `toEqual` cannot see the difference.
    const outcome = armFromSelection(CAPABILITY, { from: FROM, cells: [] });
    expect(outcome.refused).toBe('empty-selection');
    expect(peekArmingRequests()).toHaveLength(0);
  });
});

describe('the split, by authority, from the real document', () => {
  it('bars production and runs staging, from the same selection', () => {
    const selection: ScopeSelection = {
      from: FROM,
      cells: [
        cell('e.alpha', 'Alpha', STAGING),
        cell('e.bravo', 'Bravo', PRODUCTION),
        cell('e.charlie', 'Charlie', PRODUCTION),
      ],
    };
    const { scope } = previewScope(CAPABILITY, selection);
    expect(scope!.runnable.map((c) => c.siteName)).toEqual(['Alpha']);
    expect(scope!.barred.map((c) => c.siteName)).toEqual(['Bravo', 'Charlie']);
    // Pin 6: the barred group renders the capability id the Settings matrix
    // uses, and its door resolves to that grant.
    expect(scope!.barred[0].capability).toBe(CAPABILITY);
    expect(scope!.barred[0].governDoor).toMatchObject({ surface: 'settings', section: 'capabilities' });
    // Pin 8: the runnable subset arms whether or not a barred subset exists.
    expect(scope!.opensRun).toBe(true);
  });

  it('THE EMPTY RUN — a wholly barred selection still arms, and opens no container', () => {
    // The state WP-37 measured unreachable, reached. Zero runnable, the plan
    // still attaches, the door is on the barred group, and the arming happened.
    const selection: ScopeSelection = {
      from: FROM,
      cells: [cell('e.bravo', 'Bravo', PRODUCTION), cell('e.charlie', 'Charlie', PRODUCTION)],
    };
    const { scope } = armFromSelection(CAPABILITY, selection);

    expect(scope!.runnable).toEqual([]);
    expect(scope!.opensRun).toBe(false);
    expect(scope!.barred).toHaveLength(2);
    // The arming is on the queue. Gating it on `opensRun` is the plausible
    // wrong implementation, and it would delete this state from the product.
    expect(peekArmingRequests()).toHaveLength(1);
    expect(peekArmingRequests()[0].scope!.opensRun).toBe(false);
  });
});

describe('preview is pure', () => {
  it('records nothing, however many times it runs', () => {
    const selection: ScopeSelection = { from: FROM, cells: [cell('e.alpha', 'Alpha', STAGING)] };
    for (let i = 0; i < 5; i++) previewScope(CAPABILITY, selection);
    expect(peekArmingRequests()).toHaveLength(0);
  });

  it('derives the SAME split the arming records — one function, two callers', () => {
    const selection: ScopeSelection = {
      from: FROM,
      cells: [cell('e.alpha', 'Alpha', STAGING), cell('e.bravo', 'Bravo', PRODUCTION)],
    };
    const preview = previewScope(CAPABILITY, selection).scope!;
    const armed = armFromSelection(CAPABILITY, selection).scope!;
    // Equal, not identical: they are two calls. What matters is that the block
    // a user approved and the scope that armed cannot disagree.
    expect(armed).toEqual(preview);
  });
});

describe('refusals are answers, each with its own remedy', () => {
  it('names a dark core rather than throwing', () => {
    setIntelligenceCore(undefined as never);
    expect(previewScope(CAPABILITY, { from: FROM, cells: [cell('e.a', 'A', STAGING)] })).toEqual({
      refused: 'core-dark',
    });
  });

  it('names a missing document rather than arming on nothing', () => {
    const outcome = previewScope('cap.not.a.capability', {
      from: FROM,
      cells: [cell('e.a', 'A', STAGING)],
    });
    expect(outcome).toEqual({ refused: 'no-document' });
    expect(peekArmingRequests()).toHaveLength(0);
  });

  it('admits NOTHING when the capability is not granted — a queue is not an authority', () => {
    jest.spyOn(grants, 'getCapabilityGrants').mockReturnValue([]);
    const { scope } = previewScope(CAPABILITY, {
      from: FROM,
      cells: [cell('e.alpha', 'Alpha', STAGING)],
    });
    expect(scope!.runnable).toEqual([]);
    expect(scope!.barred).toHaveLength(1);
    expect(scope!.opensRun).toBe(false);
  });
});

/**
 * WP-51 · the arming's CAUSE reaches the queue through the same walk its scope
 * does. The join is only ever recorded where the armer named it — see
 * `armingCause.test.ts` for the format gate, the manifest and the fold.
 */
describe('the walk carries what the arming answers', () => {
  const INCIDENT = 'evt_01M0BFNDD6XS21X8HTEMGY4NQV';

  it('hands the incidents through to the request, beside the scope', () => {
    armFromSelection(
      CAPABILITY,
      { from: FROM, cells: [cell('e.alpha', 'Alpha', STAGING)] },
      new Date('2026-08-21T12:00:00.000Z'),
      [INCIDENT],
    );
    const [request] = peekArmingRequests();
    expect(request).toBeDefined();
    expect(request.answers).toEqual([INCIDENT]);
    // The scope still rides, unchanged — the cause is additive to WP-37's carrier.
    expect(request.scope?.runnable).toHaveLength(1);
  });

  it('an arming made from a comparator alone answers nothing, and says so by omission', () => {
    armFromSelection(CAPABILITY, { from: FROM, cells: [cell('e.alpha', 'Alpha', STAGING)] });
    const [request] = peekArmingRequests();
    expect(Object.prototype.hasOwnProperty.call(request, 'answers')).toBe(false);
  });

  it('previewScope still records NOTHING, cause or no cause', () => {
    previewScope(CAPABILITY, { from: FROM, cells: [cell('e.alpha', 'Alpha', STAGING)] });
    expect(peekArmingRequests()).toHaveLength(0);
  });
});
