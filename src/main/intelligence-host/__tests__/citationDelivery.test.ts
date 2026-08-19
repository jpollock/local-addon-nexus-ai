/**
 * WP-43 · the citation delivery seam, measured through the WIRED path.
 *
 * WP-38 built the render and pinned it against a fixture turn. This suite pins
 * the thing a fixture cannot show: that what the platform actually hands the
 * panel, out of a real assembly over a real ledger, is a payload that render
 * can draw. The defect it exists to end is not hypothetical — it was measured
 * live on 2026-08-19: raw `[[cite:…]]` markers as literal text in every citing
 * reply, because `msg.citation` was never set by anything.
 *
 * Real core, real ledger, real `assembleForChatTurn` — the house pattern, and
 * the same reason `procedureStreamWiring.test.ts` uses it: an emitter that is
 * correct in isolation and never called is the failure this shape catches.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { assembleForChatTurn, forgetChatAssemblySession } from '../chatAssembly';
import { CHAT_CITATION_MOMENT, citationDeliveryFor } from '../citationDelivery';
import { provisionalEnvironmentId } from '../provisionalEntity';
import { resolveCitations } from '../../../intelligence/citation/resolve';
import {
  CITATION_MOMENTS,
  conventionState,
  STRICTNESS_BY_MOMENT,
} from '../../../renderer/components/DockedPanel/citationModel';
import type { NexusServices } from '../../mcp/types';

const SITE = { id: 'site_alpha', name: 'alpha', domain: 'alpha.local', path: '/x' };
const ENV_ID = provisionalEnvironmentId(SITE.id);
const HOUR = 3600_000;

/** The event this suite cites. Its time is REAL and in the past, on purpose. */
const INCIDENT_OBSERVED_AT = new Date(Date.now() - 6 * HOUR).toISOString();

let core: IntelligenceCore;
let dir: string;

const services = () =>
  ({
    siteData: {
      getSite: (id: string) => (id === SITE.id ? SITE : null),
      getSites: () => ({ [SITE.id]: SITE }),
    },
  }) as never as NexusServices;

/**
 * One episodic incident, six hours old, with a payload the summariser reads.
 *
 * The age matters twice over: it is what makes `observedAt` distinguishable
 * from "now", and a resolver that stamped the delivery time instead would pass
 * every other assertion in this file.
 */
function seedIncident(): void {
  core.emitter.emit({
    observed_at: INCIDENT_OBSERVED_AT,
    topic: 'episodic.incident.opened',
    schema: 'incident.opened/1',
    entity: { environment: ENV_ID },
    actor: { id: 'act_seed', kind: 'system' },
    source: { class: 'platform', system: 'sentinel', trust: 'emitted' },
    // The fields `episodicSummary` actually reads — a payload of arbitrary keys
    // yields no summary at all, which would make the summary assertions below
    // pass against a delivery that carried nothing.
    payload: {
      fact: 'checkout-500',
      component: 'woocommerce',
      symptom: 'checkout returning 500s',
      resolved: false,
    },
  });
  core.scheduleFolds();
}

const turn = (userMessage: string, sessionId = 's1') =>
  assembleForChatTurn({
    services: services(),
    sessionId,
    siteId: SITE.id,
    userMessage,
    buildingSystemPrompt: false,
  });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-cite-deliver-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  forgetChatAssemblySession('s1');
  forgetChatAssemblySession('s2');
});

afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The moment — pin 4, and the duplicated-rule pin that keeps it honest
// ---------------------------------------------------------------------------

describe('the moment the host supplies', () => {
  it('is a member of the renderer’s own ruled union, not a string this side invented', () => {
    // Main and renderer cannot share a bundle, so the union lives in the
    // renderer and the value lives in the host. A test can import both, which
    // is the only place the two halves ever meet — the `localDay` /
    // `resolveAgentCron` shape. Without this, a typo or a widening on either
    // side ships a moment the render has no strictness for.
    expect(CITATION_MOMENTS).toContain(CHAT_CITATION_MOMENT);
  });

  it('is investigate — the moment whose strictness actually renders citations', () => {
    expect(CHAT_CITATION_MOMENT).toBe('investigate');
    // And the consequence, asserted rather than assumed: the other ruled moment
    // would strip every chip off the surface this packet exists to light up.
    expect(STRICTNESS_BY_MOMENT[CHAT_CITATION_MOMENT]).toBe('renders-all');
    expect(STRICTNESS_BY_MOMENT.glance).toBe('renders-none');
  });

  it('is a constant of the SURFACE, never read off the ask', async () => {
    // Two asks a classifier would put in different moments — one is an
    // act-shaped instruction, one is an investigation. The delivery must not
    // care. A host that varied the moment by message would be deciding how
    // strictly a reply's evidence renders from the words the user typed, which
    // is pin 4's prohibition performed one layer down where it is harder to see.
    seedIncident();
    const act = citationDeliveryFor(await turn('Update plugins on goldenecomm'), []);
    const investigate = citationDeliveryFor(await turn('Why is checkout returning 500s?', 's2'), []);
    expect(act!.moment).toBe(investigate!.moment);
    expect(act!.moment).toBe(CHAT_CITATION_MOMENT);
  });
});

// ---------------------------------------------------------------------------
// Nothing delivered when the layer contributed nothing
// ---------------------------------------------------------------------------

describe('a degraded or absent layer', () => {
  it('delivers NOTHING rather than an empty universe', () => {
    // `null` here is what keeps `msg.citation` absent, which is what keeps the
    // bubble byte-identical to the pre-WP-38 build. An empty-supply payload
    // would instead route every reply through the corroboration render and
    // report each of the model's markers as unresolvable — announcing that the
    // records were not supplied, when the truth is that nobody looked.
    expect(citationDeliveryFor(null, [])).toBeNull();
    expect(citationDeliveryFor(undefined, ['wp_plugin_list'])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The supply — all three kinds of ADR-24 P1's universe
// ---------------------------------------------------------------------------

describe('the supply that crosses the seam', () => {
  it('carries the turn’s tool calls, numbered per tool from 1', async () => {
    const delivery = citationDeliveryFor(await turn('update plugins'), [
      'wp_plugin_list',
      'wpe_backup_and_verify',
      'wp_plugin_list',
    ]);
    expect(delivery!.supply.toolCalls).toEqual([
      { name: 'wp_plugin_list', index: 1 },
      { name: 'wpe_backup_and_verify', index: 1 },
      { name: 'wp_plugin_list', index: 2 },
    ]);
  });

  it('REPLACES the assembler’s empty tool list rather than appending to it', async () => {
    // `ChatAssemblyResult.citationSupply.toolCalls` is `[]` by contract — a true
    // statement about the assembly moment. If delivery concatenated instead of
    // replacing, the count would still be right today and would silently double
    // the day the assembler ever populates it.
    const assembly = await turn('update plugins');
    expect(assembly!.citationSupply.toolCalls).toEqual([]);
    const delivery = citationDeliveryFor(assembly, ['wp_core_version']);
    expect(delivery!.supply.toolCalls).toHaveLength(1);
  });

  it('resolves a tool citation the model wrote against the call it names', async () => {
    const delivery = citationDeliveryFor(await turn('update plugins'), [
      'wpe_backup_and_verify',
      'wpe_backup_and_verify',
    ]);
    const [first] = resolveCitations(
      'The backup is verified. [[cite:tool:wpe_backup_and_verify#2]]',
      delivery!.supply
    );
    expect(first.state).toBe('cited-and-resolves');
    expect(first.state === 'cited-and-resolves' && first.record.id).toBe('wpe_backup_and_verify#2');
  });

  it('leaves a tool call the task never made UNRESOLVABLE, not quietly renumbered', async () => {
    const delivery = citationDeliveryFor(await turn('update plugins'), ['wpe_backup_and_verify']);
    const [first] = resolveCitations('[[cite:tool:wpe_backup_and_verify#2]]', delivery!.supply);
    expect(first.state).toBe('cited-but-unresolvable');
    expect(first.state === 'cited-but-unresolvable' && first.reason).toBe('not-in-supply');
  });

  it('carries the ledger events the turn actually retrieved', async () => {
    seedIncident();
    const delivery = citationDeliveryFor(await turn('why is checkout failing?'), []);
    expect(delivery!.supply.events.length).toBeGreaterThan(0);
    const cited = delivery!.supply.events[0];
    const [first] = resolveCitations(`A claim. [[cite:${cited.id}]]`, delivery!.supply);
    expect(first.state).toBe('cited-and-resolves');
  });
});

// ---------------------------------------------------------------------------
// WP-38's owed peek fields — the SuppliedEvent widening, end to end
// ---------------------------------------------------------------------------

describe('the peek’s time and machine summary (WP-38’s owed item)', () => {
  it('carries the event’s OBSERVED time, not the time of delivery', async () => {
    seedIncident();
    const delivery = citationDeliveryFor(await turn('why is checkout failing?'), []);
    const cited = delivery!.supply.events.find((e) => e.id.startsWith('evt_'))!;
    // The layer invariant, at the one place a widening could break it: a
    // resolver that stamped "now" would be laundering a six-hour-old fact as
    // current, and the peek would date the evidence to the ledger's clock.
    expect(cited.observedAt).toBe(INCIDENT_OBSERVED_AT);
    expect(new Date(cited.observedAt!).getTime()).toBeLessThan(Date.now() - 5 * HOUR);
  });

  it('carries the one-line machine summary through to the resolved record', async () => {
    seedIncident();
    const delivery = citationDeliveryFor(await turn('why is checkout failing?'), []);
    const cited = delivery!.supply.events.find((e) => e.summary !== undefined);
    expect(cited).toBeDefined();
    const [first] = resolveCitations(`A claim. [[cite:${cited!.id}]]`, delivery!.supply);
    expect(first.state === 'cited-and-resolves' && first.record.summary).toBe(cited!.summary);
    expect(first.state === 'cited-and-resolves' && first.record.observedAt).toBe(cited!.observedAt);
  });

  it('leaves both ABSENT on a tool record rather than inventing them', () => {
    // Only `SuppliedEvent` carries them, and a tool call has no observation
    // time of its own in this task's supply. Absent is the honest answer; a
    // plausible one would be the render authoring evidence.
    const [first] = resolveCitations('[[cite:tool:wp_core_version#1]]', {
      events: [],
      toolCalls: [{ name: 'wp_core_version', index: 1 }],
      carrierLines: [],
    });
    expect(first.state).toBe('cited-and-resolves');
    if (first.state !== 'cited-and-resolves') throw new Error('unreachable');
    expect(first.record).not.toHaveProperty('observedAt');
    expect(first.record).not.toHaveProperty('summary');
  });

  it('omits the KEY on an event whose supply carried neither', () => {
    // Presence itself is the assertion here, so it is asserted with
    // `toHaveProperty` rather than an equality against `undefined` — WP-26's
    // finding: `toEqual` treats an absent key and an `undefined` one as equal.
    const [first] = resolveCitations('[[cite:evt_bare]]', {
      events: [{ id: 'evt_bare' }],
      toolCalls: [],
      carrierLines: [],
    });
    if (first.state !== 'cited-and-resolves') throw new Error('unreachable');
    expect(first.record).not.toHaveProperty('observedAt');
    expect(first.record).not.toHaveProperty('summary');
  });
});

// ---------------------------------------------------------------------------
// The manifest half — and the legacy-card trap
// ---------------------------------------------------------------------------

describe('the manifest that crosses the seam', () => {
  it('always carries the citation KEY, so a live turn can never print the legacy card', async () => {
    const delivery = citationDeliveryFor(await turn('update plugins'), []);
    // `hasOwnProperty`, because that is exactly what `conventionState` reads.
    // A conditional spread on this field would make a quiet turn announce that
    // the session predates a convention it is currently under.
    expect(Object.prototype.hasOwnProperty.call(delivery!.manifest, 'citation')).toBe(true);
    expect(conventionState(delivery!.manifest)).not.toBe('predates-convention');
    expect(['in-effect', 'did-not-ride']).toContain(conventionState(delivery!.manifest));
  });

  it('reports the convention as in effect on a turn whose carrier taught it', async () => {
    seedIncident();
    const delivery = citationDeliveryFor(await turn('why is checkout failing?'), []);
    expect(conventionState(delivery!.manifest)).toBe('in-effect');
    expect(delivery!.manifest.citation!.convention).toMatch(/^cnv_[0-9a-f]{12}$/);
  });

  it('hands across the manifest’s own value, not a re-derivation of it', async () => {
    const assembly = await turn('update plugins');
    const delivery = citationDeliveryFor(assembly, []);
    // `toBe`, not `toEqual`: the same object, read once. Two derivations of
    // "was this turn under the convention" is the drift ADR-24 P5 forbids.
    expect(delivery!.manifest.citation).toBe(assembly!.citationManifest);
  });
});
