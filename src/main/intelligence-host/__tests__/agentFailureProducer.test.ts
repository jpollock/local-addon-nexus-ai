/**
 * WP-54a · THE AGENT-FAILURE PRODUCER — the fact the runtime already knows,
 * written down.
 *
 * MEASURED BEFORE ANYTHING WAS WRITTEN, 2026-08-21, and both halves matter:
 *
 *   - The live ledger holds 13 topics and 11,181 events. **None of them is
 *     about an agent run.** `agent.run.failed` is not merely absent, it is
 *     structurally impossible: `envelope/validate.ts`'s topic regex admits only
 *     `state|semantic|procedure|policy|episodic|task|control` as the type
 *     prefix. `agent.stuck` is a TEMPLATE id, never a topic.
 *   - The failure DOES exist, in `graph.db`'s `inbox_items`:
 *     `source: 'auth-probe'`, `title: 'auth-probe could not finish a run'`,
 *     `detail: 'Agent "auth-probe" timed out after 300000ms'`,
 *     `payload: {"status":"timeout"}`. The agent id is structured; **the
 *     timeout exists only as free text inside an error message**, and the
 *     payload does not carry it at all.
 *
 * `AgentRunner.run` computes `timeoutMs = agent.timeoutMs ?? DEFAULT_TIMEOUT_MS`
 * and interpolates it into that string. So the number is known at the moment of
 * failure and thrown away — a producer debt of exactly the shape WP-51's three
 * are. This producer pays it by taking the number as an argument at the
 * chokepoint where it is already in scope, and writing it as a FIELD.
 *
 * The rules, each pinned below, inherited from `incidentProducer`'s five:
 *
 *  1. **Never fabricate a time.** `observed_at` is the run's own finish time.
 *  2. **Never invent the timeout.** Absent when the caller did not supply one,
 *     and absent means the ask that reads it is withheld, not shortened.
 *  3. **Resolution is observed and supersedes.** A later SUCCESSFUL run of the
 *     same agent closes the failure, `causation` pointing at what it closes.
 *  4. **Dedup is a ledger read**, not the change gate — an episodic occurrence
 *     folds into no twin, so the gate would degrade to a process-lifetime cache
 *     and re-emit after every restart (`incidentProducer` rule 4, same reason).
 *  5. **Non-fatal by construction.** An agent run must never fail because its
 *     failure could not be recorded.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { initIntelligenceCore, type IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import {
  AGENT_FAILURE_SCHEMA,
  AGENT_FAILURE_TOPIC,
  recordAgentRunOutcome,
} from '../agentFailureProducer';

let core: IntelligenceCore;
let dir: string;

/** The owner's real row, in its own values. */
const AGENT_ID = 'auth-probe';
const TIMEOUT_MS = 300_000;
/** 2026-08-17T16:00:47.204Z — `first_seen_at` on the live inbox row. */
const FAILED_AT = 1_786_982_447_204;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-wp54a-'));
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

function failures() {
  return core.ledger.query({ topicPrefix: AGENT_FAILURE_TOPIC, order: 'asc', limit: 100 });
}

describe('WP-54a · what a timed-out run writes down', () => {
  test('a timeout is recorded with the agent id AND the timeout, both as fields', () => {
    expect(recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core })).toBe(1);

    // Shape #15's tell: assert the event EXISTS before asserting anything about
    // it. A non-fatal producer that emitted nothing passes every content
    // assertion vacuously.
    const events = failures();
    expect(events).toHaveLength(1);

    const [event] = events;
    expect(event.topic).toBe(AGENT_FAILURE_TOPIC);
    expect(event.schema).toBe(AGENT_FAILURE_SCHEMA);
    expect(event.payload).toMatchObject({
      agent_id: AGENT_ID,
      status: 'timeout',
      timeout_ms: TIMEOUT_MS,
      resolved: false,
    });
  });

  test('`observed_at` is the run\'s own finish time — never the moment of the fold', () => {
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core });
    const [event] = failures();
    expect(event.observed_at).toBe(new Date(FAILED_AT).toISOString());
    // …and `recorded_at` is genuinely later, so the two are not the same field
    // wearing two names.
    expect(event.recorded_at > event.observed_at).toBe(true);
  });

  test('the timeout is ABSENT when the caller did not supply one — never defaulted', () => {
    // A non-timeout failure has no timeout, and `DEFAULT_TIMEOUT_MS` is a
    // runtime constant, not an observation. Writing it here would be the
    // `|| '8.0'` defect: a plausible number earning the credit of a measured
    // one, on the one field the ratified ask reads aloud.
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'error', error: 'provider refused', finishedAt: FAILED_AT,
    }, { core });
    const [event] = failures();
    expect(event.payload.status).toBe('error');
    expect(event.payload).not.toHaveProperty('timeout_ms');
  });

  test('AN `error` RUN CARRYING A TIMEOUT STILL WRITES NO TIMEOUT — the status decides', () => {
    // FOUND BY THE BATTERY (M03 survived): nothing drove this, and it is not a
    // corner. `AgentRunner` passes `timeoutMs` from its own local on EVERY run,
    // so an errored run reaches this producer with a real number in hand. The
    // `status === 'timeout' &&` clause is the only thing between that number
    // and a row reading "It timed out after 300s" about a run that did not
    // time out — a plausible value earning a measured one's credit, on the one
    // field the ratified ask says aloud.
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'error', error: 'provider refused',
      timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core });
    const [event] = failures();
    expect(event.payload.status).toBe('error');
    expect(event.payload).not.toHaveProperty('timeout_ms');
  });

  test('the failure is stamped on NO entity — an agent run did not fail at a site', () => {
    // FOUND BY THE BATTERY (M10 survived). The inbox reached the same answer
    // independently — `scope: '*'`, `scopeLabel: 'This agent'` — and an entity
    // borrowed from whatever the run touched last would put a platform failure
    // on a site's record, where every entity-scoped reader would find it.
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core });
    expect(failures()[0].entity).toEqual({});
  });

  test('a run with no usable finish time records NOTHING rather than being stamped now', () => {
    expect(recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: 0,
    }, { core })).toBe(0);
    expect(failures()).toHaveLength(0);
  });

  test('a successful run with nothing open writes nothing at all', () => {
    expect(recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'success', finishedAt: FAILED_AT,
    }, { core })).toBe(0);
    expect(failures()).toHaveLength(0);
  });
});

describe('WP-54a · dedup, and it is a ledger read', () => {
  test('a second failure while one is open is not news', () => {
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core });
    expect(recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT + 60_000,
    }, { core })).toBe(0);
    expect(failures()).toHaveLength(1);
  });

  test('another agent\'s failure is its own row — the key is the agent, not the topic', () => {
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core });
    expect(recordAgentRunOutcome({
      agentId: 'seo-insights', status: 'error', error: 'boom', finishedAt: FAILED_AT,
    }, { core })).toBe(1);
    expect(failures().map((e) => e.payload.agent_id)).toEqual([AGENT_ID, 'seo-insights']);
  });

  test('the gate survives a restart, because it reads the ledger rather than a cache', () => {
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core });
    // A new core over the SAME ledger file is what a restart looks like here.
    core.close();
    const kv = new Map<string, unknown>();
    core = initIntelligenceCore({
      storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
      logger: { info: () => {}, error: () => {} },
      dataDir: dir,
    })!;
    setIntelligenceCore(core);
    expect(recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT + 60_000,
    }, { core })).toBe(0);
    expect(failures()).toHaveLength(1);
  });
});

describe('WP-54a · resolution is observed, and it supersedes', () => {
  test('a later successful run closes the failure, pointing at what it closed', () => {
    recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core });
    const openId = failures()[0].id;

    expect(recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'success', finishedAt: FAILED_AT + 3_600_000,
    }, { core })).toBe(1);

    const events = failures();
    expect(events).toHaveLength(2);
    const closing = events[1];
    expect(closing.causation).toBe(openId);
    expect(closing.payload).toMatchObject({
      agent_id: AGENT_ID,
      resolved: true,
      resolved_at: new Date(FAILED_AT + 3_600_000).toISOString(),
    });
    // Nothing is mutated: the opening event still says what it said.
    expect(events[0].payload.resolved).toBe(false);
  });

  test('a failure AFTER a resolution opens again — closed is not permanently closed', () => {
    recordAgentRunOutcome({ agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT }, { core });
    recordAgentRunOutcome({ agentId: AGENT_ID, status: 'success', finishedAt: FAILED_AT + 1_000 }, { core });
    expect(recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT + 2_000,
    }, { core })).toBe(1);
    expect(failures()).toHaveLength(3);
    expect(failures()[2].payload.resolved).toBe(false);
  });

  test('a second success does not close what is already closed', () => {
    recordAgentRunOutcome({ agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT }, { core });
    recordAgentRunOutcome({ agentId: AGENT_ID, status: 'success', finishedAt: FAILED_AT + 1_000 }, { core });
    expect(recordAgentRunOutcome({ agentId: AGENT_ID, status: 'success', finishedAt: FAILED_AT + 2_000 }, { core })).toBe(0);
    expect(failures()).toHaveLength(2);
  });
});

describe('WP-54a · non-fatal by construction', () => {
  test('no core, no event, no throw', () => {
    setIntelligenceCore(null as never);
    expect(recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    })).toBe(0);
  });

  test('an unreadable ledger records nothing rather than re-emitting everything', () => {
    // Fail CLOSED, like `incidentHistory`: an empty read must not be mistaken
    // for "nothing is open", which is the one reading that re-opens what is
    // already open on every call.
    const broken = {
      ...core,
      ledger: { query: () => { throw new Error('ledger unreadable'); } },
    } as unknown as IntelligenceCore;
    expect(recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core: broken })).toBe(0);
    expect(failures()).toHaveLength(0);
  });

  test('an emitter that throws costs the record, never the caller', () => {
    const broken = {
      ...core,
      emitter: { emit: () => { throw new Error('envelope refused'); } },
    } as unknown as IntelligenceCore;
    expect(() => recordAgentRunOutcome({
      agentId: AGENT_ID, status: 'timeout', timeoutMs: TIMEOUT_MS, finishedAt: FAILED_AT,
    }, { core: broken })).not.toThrow();
    expect(failures()).toHaveLength(0);
  });
});
