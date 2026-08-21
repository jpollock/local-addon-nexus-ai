/**
 * WP-54a · THE FOLD EMITS `agent.stuck` — the architect's own finding 4, closed.
 *
 * "`agent.stuck` is a ratified class with no producer. auth-probe appears only
 * as an old inbox card, never as a situation — WP-52's own pin calls the class
 * 'unreachable' and pinned it anyway. **When the dedup lands, auth-probe
 * disappears from Now entirely unless the fold learns to emit it.**"
 *
 * Everything here is driven from the LEDGER through the real producer and the
 * real fold — not by handing `situationOfAgentFailure` a shape. The unreachable
 * corners of the selector are pinned directly in `situationHeadlines.test.ts`
 * (WP-46's rule); this file's job is the opposite one, and it is the half that
 * was missing: **that a real event becomes a real row.**
 *
 * THE LIVE VALUES ARE THE FIXTURE. `graph.db`'s one `kind: 'problem'` inbox row,
 * read 2026-08-21: `source: 'auth-probe'`, `detail: 'Agent "auth-probe" timed
 * out after 300000ms'`. If the row this fold produces reads differently from
 * the card the owner photographed, the difference is visible here.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { initIntelligenceCore, type IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { recordAgentRunOutcome } from '../agentFailureProducer';
import { INCIDENT_SCHEMA, INCIDENT_TOPIC } from '../incidentProducer';
import { createSessionRegistry, type Situation } from '../sessionRegistry';
import { SITUATION_TEMPLATES } from '../situationCopy.generated';

let core: IntelligenceCore;
let dir: string;

const AGENT_ID = 'auth-probe';
const TIMEOUT_MS = 300_000;
/** The live inbox row's `first_seen_at`. */
const FAILED_AT = 1_786_982_447_204;
const NOW = new Date(FAILED_AT + 82 * 3_600_000);

const SITE = 'ent_site_Y64Y113T3AQXYGGSAPXMQKMQHA';
const ENV = 'ent_env_2TH5EJB62XMHN2YRX5V0JTHWMA';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-wp54a-fold-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
});

afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function waiting(): Situation[] {
  return createSessionRegistry({ core, now: NOW }).triage().waiting;
}

/** One open sentinel finding, so the ordering tests have a real T1 row beside it. */
function emitIncident(observedAt: string): string {
  return core.emitter.emit({
    observed_at: observedAt,
    topic: INCIDENT_TOPIC,
    schema: INCIDENT_SCHEMA,
    entity: { site: SITE, environment: ENV },
    actor: { id: 'act_security_sentinel', kind: 'agent' },
    source: { class: 'work', system: 'sentinel:scan', trust: 'emitted' },
    payload: {
      fact: 'ABS-05',
      symptom: 'Known backdoor plugin detected: wp-compat',
      severity: 'critical',
      resolved: false,
    },
  }).id;
}

describe('WP-54a · a timed-out agent run becomes a situation', () => {
  test('the fold produces ONE row, and it is the ratified `agent.stuck` class', () => {
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core });

    const rows = waiting();
    expect(rows).toHaveLength(1);
    expect(rows[0].headlineTemplate).toBe('agent.stuck');
    expect(rows[0].kind).toBe('agentFailure');
  });

  test('the headline is the designer\'s sentence with the agent id in it', () => {
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core });
    const [row] = waiting();
    expect(row.headline).toBe('auth-probe could not finish a run');
    // …and it IS the extracted template, not a coincidence of wording.
    expect(SITUATION_TEMPLATES.find((t) => t.id === 'agent.stuck')?.headline)
      .toBe('{agentId} could not finish a run');
  });

  test('THE ASK CARRIES THE TIMEOUT FROM THE RECORD — never composed, never guessed', () => {
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core });
    const [row] = waiting();
    expect(row.ask).toBe('It timed out after 300s. Retry it, or leave it stopped.');

    // The number is the LEDGER's, and the proof is that a different recorded
    // timeout produces a different sentence. A hardcoded 300s would pass the
    // assertion above and fail this one.
    core.ledger.query({ topicPrefix: 'episodic.agent_run.failed', limit: 10 });
    recordAgentRunOutcome({ agentId: AGENT_ID, status: 'success', finishedAt: FAILED_AT + 1 }, { core });
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: 90_000, finishedAt: FAILED_AT + 2,
    }, { core });
    expect(waiting()[0].ask).toBe('It timed out after 90s. Retry it, or leave it stopped.');
  });

  test('the chip, the state and the meta line are the class\'s own fields', () => {
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core });
    const [row] = waiting();
    expect(row.chip).toBe('Stuck');
    expect(row.state).toBe('');
    expect(row.meta).toBe(AGENT_ID);
  });

  test('`since` is the run\'s own moment, so the row ages from the failure', () => {
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core });
    expect(waiting()[0].since).toBe(new Date(FAILED_AT).toISOString());
  });

  test('the row has no place set and does not pretend to — an agent did not fail AT a site', () => {
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core });
    const [row] = waiting();
    expect(row.places.total).toBe(0);
    expect(row.places.highest).toBeNull();
    expect(row.places.summary).toBe('');
    // …and it was never armed under a capability, so it names none.
    expect(row.capability).toBeUndefined();
    expect(row.written).toEqual({ done: 0, failed: 0, total: null });
  });

  test('the row expands to the event it is — a verdict with its part', () => {
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core });
    const [row] = waiting();
    expect(row.parts).toHaveLength(1);
    expect(row.parts[0].kind).toBe('agentFailure');
    expect(row.parts[0].topic).toBe('episodic.agent_run.failed');
    expect(row.parts[0].eventId).toBe(row.id);
  });
});

describe('WP-54a · tier 3, and the sort consequence the template states', () => {
  test('the ranked tier is 3, and the rule line it renders says the same number', () => {
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core });
    const [row] = waiting();
    // The agreement the architect's finding 1 is about: the card's number and
    // the ranker's number are ONE fact, not two.
    expect(row.tier).toBe(3);
    expect(row.rule).toBe('Tier 3 · the agent is asking, not the fleet');
    expect(row.rule.startsWith(`Tier ${row.tier} ·`)).toBe(true);
  });

  test('IT SORTS BELOW BOTH WAITING CLASSES HOWEVER OLD IT IS — the template\'s own note', () => {
    // The agent failure is the OLDEST thing in the record by three days, so a
    // list that degenerated to age order would put it first. Tier is what keeps
    // it last.
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core });
    emitIncident(new Date(FAILED_AT + 72 * 3_600_000).toISOString());

    const rows = waiting();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.headlineTemplate)).toEqual(['incident.no-run', 'agent.stuck']);
    // THE INCIDENT'S 2 IS NOT A TYPO AND IS NOT THIS PACKET'S TO FIX. Its
    // ratified rule line reads "Tier 1 · nothing is holding it back but you"
    // while `situationOfIncident` ranks it `resolved ? 4 : 2` — the architect's
    // finding 1, registered as WP-54's item. Asserting the shipped value here
    // keeps this file a measurement rather than a second, quieter fix; the
    // ordering claim under test holds either way, because 1 and 2 both sort
    // above 3.
    expect(rows.map((r) => r.tier)).toEqual([2, 3]);
    // …and the agent row really is the older one, so age did not produce this.
    expect(rows[1].since < rows[0].since).toBe(true);
  });

  test('it is counted among the things that need you — the ask is a real ask', () => {
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core });
    expect(createSessionRegistry({ core, now: NOW }).triage().verdict)
      .toBe('1 things need you, and none of them has changed anything yet');
  });
});

describe('WP-54a · what the record does not say, the row does not claim', () => {
  test('a failure with no recorded timeout does NOT render the timeout ask', () => {
    // `error`, not `timeout`: the ratified ask asserts "It timed out after …",
    // which is false about this row twice over — no timeout happened and no
    // duration is on record. A withheld sentence is the honest outcome; a
    // shortened one ("It timed out after .") would be a hole AND a falsehood.
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'error', error: 'provider refused the request', finishedAt: FAILED_AT,
    }, { core });

    const rows = waiting();
    expect(rows).toHaveLength(1);
    expect(rows[0].headlineTemplate).toBeNull();
    expect(rows[0].ask).toBe('');
    expect(rows[0].headline).not.toContain('timed out');
  });

  test('the derived row still says who and what, from the record\'s own words', () => {
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'error', error: 'provider refused the request', finishedAt: FAILED_AT,
    }, { core });
    const [row] = waiting();
    expect(row.headline).toBe('auth-probe: provider refused the request');
    expect(row.tier).toBe(3);
    // No ratified class composed it, so the rule line carries the derived
    // reason — the placement WP-52 ruled for exactly this case.
    expect(row.rule).toBe(row.tierReason);
    expect(row.rule).toBe('the run ended in error and the agent has not succeeded since');
  });

  test('a failure with no message names the status rather than inventing one', () => {
    recordAgentRunOutcome({ agentId: AGENT_ID, status: 'error', finishedAt: FAILED_AT }, { core });
    expect(waiting()[0].headline).toBe('auth-probe: a run ended in error');
  });
});

describe('WP-54a · a resolved failure is not a row', () => {
  test('a later successful run takes it off the list', () => {
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core });
    expect(waiting()).toHaveLength(1);

    recordAgentRunOutcome({ agentId: AGENT_ID, status: 'success', finishedAt: FAILED_AT + 1_000 }, { core });
    expect(waiting()).toHaveLength(0);
  });

  test('two agents stuck are two rows, and closing one leaves the other', () => {
    recordAgentRunOutcome({ agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT }, { core });
    recordAgentRunOutcome({ agentId: 'seo-insights', status: 'timeout', timeoutMs: 60_000, finishedAt: FAILED_AT + 1 }, { core });
    expect(waiting().map((r) => r.meta).sort()).toEqual([AGENT_ID, 'seo-insights']);

    recordAgentRunOutcome({ agentId: AGENT_ID, status: 'success', finishedAt: FAILED_AT + 2 }, { core });
    expect(waiting().map((r) => r.meta)).toEqual(['seo-insights']);
  });
});

describe('WP-54a · nothing else in the fold moved', () => {
  test('an empty ledger still produces an empty list, not a phantom agent row', () => {
    expect(waiting()).toEqual([]);
  });

  test('an incident row is untouched by the new query — same class, same tier', () => {
    emitIncident(new Date(FAILED_AT).toISOString());
    const [row] = waiting();
    expect(row.kind).toBe('incident');
    expect(row.headlineTemplate).toBe('incident.no-run');
    // The shipped value, unchanged by this packet — see the ordering test above
    // for why it is 2 and whose finding that is.
    expect(row.tier).toBe(2);
  });
});
