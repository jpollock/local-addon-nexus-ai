/**
 * WP-34 · the host half of the citation convention (ADR-24 P2 + ADR-20).
 *
 * The core decides WHAT the carrier says about the convention; this seam holds
 * the memory of what each session has already been told, and that memory is the
 * part with the interesting failure modes. Three of them are pinned here:
 *
 *   - a session is taught once and re-asserted thereafter;
 *   - it is remembered ONLY when the section actually rode, so a turn whose
 *     carrier was empty cannot leave the next turn re-asserting a version the
 *     actor has never seen;
 *   - clearing the session forgets it, so a cleared chat is re-taught rather
 *     than assumed to still be carrying an instruction it was never given.
 *
 * Real core, real ledger, real law on a temp dir — the house pattern.
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { setIntelligenceCore } from '../coreRegistry';
import { provisionalEnvironmentId } from '../provisionalEntity';
import { assembleForChatTurn, forgetChatAssemblySession } from '../chatAssembly';
import { syncCapabilityGrants } from '../capabilityGrants';
import {
  CITATION_CONVENTION_BODY,
  CITATION_CONVENTION_VERSION,
} from '../../../intelligence/citation/convention';
import type { NexusServices } from '../../mcp/types';

const SITE_ID = 'local-acme';
const ENV_ID = provisionalEnvironmentId(SITE_ID);
const HOUR = 3600_000;

let core: IntelligenceCore;
let dir: string;

function services(): NexusServices {
  return {
    siteData: {
      getSite: (id: string) =>
        id === SITE_ID ? { id: SITE_ID, name: 'acme-local', path: '/x' } : null,
      getSites: () => ({ [SITE_ID]: { id: SITE_ID, name: 'acme-local', path: '/x' } }),
    },
  } as never;
}

function seedObservation(): void {
  core.emitter.emit({
    observed_at: new Date(Date.now() - 20 * HOUR).toISOString(),
    topic: 'state.plugin.observed',
    schema: 'plugin.observed/1',
    entity: { environment: ENV_ID },
    actor: { id: 'act_seed', kind: 'system' },
    source: { class: 'platform', system: 'wp-cli', trust: 'observed' },
    payload: { slug: 'advanced-custom-fields', version: '6.2.0', active: true },
  });
  core.scheduleFolds();
}

const turn = (sessionId: string, userMessage: string) =>
  assembleForChatTurn({
    services: services(),
    sessionId,
    userMessage,
    siteId: SITE_ID,
    buildingSystemPrompt: false,
  });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-citation-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  forgetChatAssemblySession('s1');
  forgetChatAssemblySession('s2');
  seedObservation();
});

afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('taught once, re-asserted thereafter', () => {
  test('the first turn of a session carries the full block; the second carries one line', async () => {
    const first = await turn('s1', 'any issues with this site?');
    expect(first!.turnBlock).toContain(CITATION_CONVENTION_BODY);

    const second = await turn('s1', 'and now?');
    expect(second!.turnBlock).not.toContain(CITATION_CONVENTION_BODY);
    expect(second!.turnBlock).toContain(
      `Citation convention ${CITATION_CONVENTION_VERSION} remains in effect, unchanged.`
    );
  });

  test('the memory is per session — a second session is taught in full', async () => {
    await turn('s1', 'first');
    const other = await turn('s2', 'first');
    expect(other!.turnBlock).toContain(CITATION_CONVENTION_BODY);
  });

  test('clearing the session forgets it, and the next turn re-teaches in full', async () => {
    await turn('s1', 'first');
    forgetChatAssemblySession('s1');
    const after = await turn('s1', 'again');
    expect(after!.turnBlock).toContain(CITATION_CONVENTION_BODY);
  });
});

describe('the manifest reaches the ledger carrying the convention (owner-ratified)', () => {
  test('task.context.assembled records which convention was in effect, and how it rode', async () => {
    const first = (await turn('s1', 'any issues with this site?'))!;
    const second = (await turn('s1', 'and now?'))!;

    const manifests = core.ledger.query({ topicPrefix: 'task.context.assembled', limit: 50 });
    const byTask = (taskId: string) =>
      manifests.find((e) => e.correlation === taskId)!.payload as {
        citation: { convention: string; asserted: string } | null;
      };

    // The audit claim, end to end: the ledger now answers "which convention
    // governed this reply" without the full text ever being re-shipped — ADR-20's
    // argument, applied to ADR-24.
    expect(byTask(first.taskId).citation).toEqual({
      convention: CITATION_CONVENTION_VERSION,
      asserted: 'full',
    });
    expect(byTask(second.taskId).citation).toEqual({
      convention: CITATION_CONVENTION_VERSION,
      asserted: 'hash',
    });
  });
});

describe('the turn publishes what it made citable', () => {
  test('citationSupply carries the retrieved event ids and the carrier lines that rode', async () => {
    const result = (await turn('s1', 'any issues with this site?'))!;
    const supply = result.citationSupply;

    // The carrier lines are the sections that RENDERED, filtered to the citable
    // set — the instruction block is not evidence of itself.
    expect(supply.carrierLines.map((c) => c.key)).not.toContain('citation-convention');
    expect(supply.carrierLines.length).toBeGreaterThan(0);
    for (const line of supply.carrierLines) {
      expect(['policy', 'procedure', 'routing', 'freshness', 'retrieved']).toContain(line.key);
    }

    // Every event id published is one the model can actually see, because the
    // carrier is the only channel it has for them. A supply naming a record the
    // model was never shown would make an honest omission look like a miss.
    for (const e of supply.events) {
      expect(result.turnBlock).toContain(e.id);
    }

    // EMPTY, and deliberately so: tool calls happen after assembly, so the
    // trace is the caller's to add. Absent would read as "no citation supply
    // at all", which is a different and false statement.
    expect(supply.toolCalls).toEqual([]);
  });
});

describe('remembered only when it actually rode', () => {
  test('a turn with no carrier at all does not mark the session as taught', async () => {
    // The empty carrier is a REACHABLE state, not a contrivance: WP-17's own
    // `law-registry` init stage can fail, and `IntelligenceCore.law` is
    // optional for exactly that reason. With no law registry and no site
    // selected there is no policy set, no targets, no freshness and no
    // retrieval — so no carrier rides, and nothing was taught.
    setIntelligenceCore({ ...core, law: undefined } as never);
    // ...and the grants that follow from it. `syncCapabilityGrants` with no
    // core is the production path for "the law registry did not come up", so
    // the index has nothing to list either — the same degraded state, stated
    // consistently rather than half-applied.
    syncCapabilityGrants({
      core: undefined,
      storage: { get: () => null, set: () => {} },
      logger: { info: () => {}, error: () => {} },
    });
    const empty = await assembleForChatTurn({
      services: services(),
      sessionId: 's2',
      userMessage: 'hello',
      buildingSystemPrompt: false,
    });
    expect(empty!.turnBlock).toBeNull();
    setIntelligenceCore(core);
    syncCapabilityGrants({
      core,
      storage: { get: () => null, set: () => {} },
      logger: { info: () => {}, error: () => {} },
    });

    // The next turn that DOES carry must ship the block in full. If the empty
    // turn had been recorded as taught, this would be a one-line re-assert of
    // an instruction the actor never received.
    const real = await turn('s2', 'any issues with this site?');
    expect(real!.turnBlock).toContain(CITATION_CONVENTION_BODY);
  });
});
