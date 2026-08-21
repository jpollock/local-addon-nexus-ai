/**
 * WP-54a · THE TAP — the runner hands the producer the number it already has.
 *
 * `AgentRunner.run` computes `timeoutMs = agent.timeoutMs ?? DEFAULT_TIMEOUT_MS`
 * and, on a timeout, interpolates it into a message string that reaches the
 * inbox as `detail: 'Agent "auth-probe" timed out after 300000ms'` and nowhere
 * else. **The number is known at the moment of failure and thrown away.** These
 * tests drive the real runner and read the real ledger, so what they pin is
 * that the tap exists, that it carries the timeout as a FIELD, and that it
 * cannot cost a run.
 *
 * The tap sits beside `recordSentinelIncidents` at the run-completion
 * chokepoint, in its OWN try block for the reason that one has its own: an
 * inbox fault must not also cost the ledger record, and neither must cost the
 * run.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { AgentRunner } from '../../../src/main/agent-runtime/AgentRunner';
import type { AgentDefinition } from '../../../src/main/agent-sdk/types';
import { initIntelligenceCore, type IntelligenceCore } from '../../../src/main/intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../src/main/intelligence-host/coreRegistry';
import { AGENT_FAILURE_TOPIC } from '../../../src/main/intelligence-host/agentFailureProducer';

const services = { contributedRegistry: { list: () => [] } } as never;
const registry = {
  call: async () => ({ isError: false, content: [{ type: 'text', text: '{}' }] }),
  list: () => [],
} as never;

const stateStore = {
  buildHandle: () => ({
    get: () => undefined, set: () => {}, delete: () => {}, scratch: {},
    isCoolingDown: () => false, setCooldown: () => {},
  }),
  recordRun: () => {},
  getRunHistory: () => [],
} as never;

let core: IntelligenceCore;
let dir: string;

function runner(): AgentRunner {
  return new AgentRunner(
    stateStore,
    registry,
    services,
    { provider: 'anthropic', apiKey: 'sk-test', modelName: 'claude-sonnet-4' } as never,
  );
}

/** An agent that never returns, raced against a timeout short enough to test. */
const STALLS: AgentDefinition = {
  name: 'auth-probe',
  version: '1.0.0',
  timeoutMs: 50,
  triggers: [{ type: 'cron', expression: '0 0 * * *' }],
  run: () => new Promise<void>(() => {}),
};

const FINISHES: AgentDefinition = {
  name: 'auth-probe',
  version: '1.0.0',
  timeoutMs: 50,
  triggers: [{ type: 'cron', expression: '0 0 * * *' }],
  run: async () => {},
};

function failures() {
  return core.ledger.query({ topicPrefix: AGENT_FAILURE_TOPIC, order: 'asc', limit: 100 });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-wp54a-tap-'));
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

describe('WP-54a · the run-completion tap', () => {
  test('a timed-out run records the agent id and the runner\'s OWN timeout', async () => {
    const result = await runner().run(STALLS);
    expect(result.status).toBe('timeout');

    const events = failures();
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      agent_id: 'auth-probe',
      status: 'timeout',
      timeout_ms: 50,
      resolved: false,
    });
  });

  test('the timeout is the RUNNER\'s local, not a number parsed back out of its message', async () => {
    await runner().run({ ...STALLS, timeoutMs: 120 });
    const [event] = failures();
    // The message is prose and stays prose; the field is the measurement.
    expect(event.payload.timeout_ms).toBe(120);
    expect(typeof event.payload.timeout_ms).toBe('number');
    expect(String(event.payload.message)).toContain('timed out after 120ms');
  });

  test('`observed_at` IS `result.finishedAt`, to the millisecond', async () => {
    // THE BATTERY CAUGHT THIS ASSERTION BEING VACUOUS. It used to check only
    // that `observed_at` fell between a `before` and an `after` taken around
    // the call — a window that a `Date.now()` at the TAP also falls inside, so
    // the mutation replacing the run's own moment with the fold's SURVIVED.
    // The window was the assertion's whole content and it could not tell the
    // two apart. Equality can: `finishedAt` is stamped when the run ends and
    // the tap runs strictly after it.
    const result = await runner().run(STALLS);
    expect(failures()[0].observed_at).toBe(new Date(result.finishedAt).toISOString());
  });

  test('an ERRORED run carries its message but not a timeout — the runner hands over both', async () => {
    // The runner passes `timeoutMs` on every run, errored ones included, so
    // this is the production path for the producer's status clause rather than
    // a corner. Driven here as well as at the producer because the tap is what
    // supplies the number that would otherwise be written.
    const explodes: AgentDefinition = {
      ...STALLS, run: async () => { throw new Error('provider refused'); },
    };
    const result = await runner().run(explodes);
    expect(result.status).toBe('error');
    const [event] = failures();
    expect(event.payload.status).toBe('error');
    expect(event.payload.message).toBe('provider refused');
    expect(event.payload).not.toHaveProperty('timeout_ms');
  });

  test('a later successful run closes it — the row leaves the record\'s open set', async () => {
    await runner().run(STALLS);
    expect(failures()).toHaveLength(1);

    await runner().run(FINISHES);
    const events = failures();
    expect(events).toHaveLength(2);
    expect(events[1].payload).toMatchObject({ agent_id: 'auth-probe', resolved: true });
    expect(events[1].causation).toBe(events[0].id);
  });

  test('a successful run with nothing open writes nothing', async () => {
    const result = await runner().run(FINISHES);
    expect(result.status).toBe('success');
    expect(failures()).toHaveLength(0);
  });

  test('A PRODUCER FAULT COSTS THE RECORD, NEVER THE RUN', async () => {
    // The ledger is gone; the tap must swallow it and the run must still
    // return its result. This is the seam's own invariant — an
    // intelligence-layer failure never breaks a caller that predates it.
    core.close();
    const result = await runner().run(STALLS);
    expect(result.status).toBe('timeout');
    expect(result.agentName).toBe('auth-probe');
  });
});
