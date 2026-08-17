/**
 * WP-17 · Degradation (chaos) tests — TESTING_STRATEGY.md layer 7.
 *
 * The layer's non-fatality has always been a claim in comments. Here it
 * becomes a pin, in BOTH halves — because they are different obligations and
 * only the first was ever built:
 *
 *   1. the addon is unaffected when the intelligence layer fails, AND
 *   2. the failure is REPORTED, with its reason, from a later session.
 *
 * Testing graceful degradation without testing its visibility is how silent
 * failure gets certified: the M1 ABI incident ran for hours with green tests,
 * a working app and a dark ledger. Each test below reproduces a real outage
 * shape and asserts both halves.
 *
 * The event-pipeline closure used throughout is the shape `src/main/index.ts`
 * actually wires into `HttpEventInterface.onEvent`: the legacy bridge first,
 * the intelligence tap second, behind `?.`.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IntelligenceCore } from '../bootstrap';

/** The real NODE_MODULE_VERSION text better-sqlite3 throws on an ABI mismatch. */
const ABI_ERROR =
  "The module '/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node' was compiled " +
  'against a different Node.js version using NODE_MODULE_VERSION 146. This version of Node.js ' +
  'requires NODE_MODULE_VERSION 141. Please try re-compiling or re-installing the module';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'intel-chaos-'));
}

function makeStorage() {
  const kv = new Map<string, unknown>();
  return {
    kv,
    storage: { get: (k: string) => kv.get(k) ?? null, set: (k: string, v: unknown) => kv.set(k, v) },
  };
}

function silentLogger() {
  const errors: string[] = [];
  return { errors, logger: { info: () => {}, error: (m: string) => errors.push(m) } };
}

/**
 * The addon's own event path, exactly as index.ts composes it. `delivered`
 * proves the legacy pipeline still ran — the half that must never break.
 */
function eventPipeline(core: IntelligenceCore | undefined) {
  const delivered: string[] = [];
  return {
    delivered,
    onEvent: (siteId: string, eventType: string, payload: Record<string, unknown>) => {
      delivered.push(eventType); // _wpEventsBridgeCallback stand-in
      core?.tap(siteId, eventType, payload);
    },
  };
}

describe('a corrupt ledger file', () => {
  test('leaves the addon untouched AND is reported, with the reason, as not reporting', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'ledger.db'), 'not a database, just bytes');
    const { storage, kv } = makeStorage();
    const { logger, errors } = silentLogger();

    const { initIntelligenceCore, getIntelligenceInitState } = require('../bootstrap');
    const { collectIntelligenceHealth } = require('../health');

    // Half 1 — the addon is unaffected.
    const core = initIntelligenceCore({ storage, logger, dataDir: dir });
    expect(core).toBeUndefined();
    const pipeline = eventPipeline(core);
    expect(() => pipeline.onEvent('site-a', 'plugin_updated', { slug: 'woo' })).not.toThrow();
    expect(pipeline.delivered).toEqual(['plugin_updated']);
    expect(errors.join(' ')).toMatch(/init failed \(non-fatal\)/);

    // Half 2 — and it SAYS so, with the reason, persisted where a later
    // session can read it (the M1 gap: a log line is not a record).
    const persisted = kv.get('intelligence_init_state') as { last_failure?: { message: string } };
    expect(persisted.last_failure?.message).toMatch(/not a database/);

    const report = collectIntelligenceHealth({
      core,
      initState: getIntelligenceInitState(),
      now: new Date(),
    });
    expect(report.coreUp).toBe(false);
    expect(report.worst).toBe('DARK');
    const line = report.lines.find((l: { key: string }) => l.key === 'core')!;
    expect(line.verdict).toBe('DARK');
    expect(line.detail).toMatch(/not a database/);
  });

  test("a FAILED boot's reason survives into the next, successful boot", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'ledger.db'), 'not a database, just bytes');
    const { storage, kv } = makeStorage();
    const { logger } = silentLogger();

    jest.isolateModules(() => {
      const { initIntelligenceCore } = require('../bootstrap');
      expect(initIntelligenceCore({ storage, logger, dataDir: dir })).toBeUndefined();
    });

    // Next session: fresh module registry (a restarted process), repaired file.
    fs.unlinkSync(path.join(dir, 'ledger.db'));
    jest.isolateModules(() => {
      const { initIntelligenceCore, getIntelligenceInitState } = require('../bootstrap');
      const { collectIntelligenceHealth } = require('../health');
      const core = initIntelligenceCore({ storage, logger, dataDir: dir });
      expect(core).toBeDefined();

      const state = getIntelligenceInitState();
      expect(state.last_failure?.message).toMatch(/not a database/);
      expect(state.last_success_at).toBeTruthy();

      const report = collectIntelligenceHealth({ core, initState: state, now: new Date() });
      const line = report.lines.find((l: { key: string }) => l.key === 'core')!;
      // Up now, so OK — but the earlier failure is on the record, dated.
      expect(line.verdict).toBe('OK');
      expect(line.detail).toMatch(/last recorded start-up failure/);
      expect(line.detail).toMatch(/not a database/);
      core.close();
    });

    expect(kv.get('intelligence_init_state')).toBeTruthy();
  });
});

describe('a throwing entity service', () => {
  test('the core stays up, the ledger keeps recording, and health degrades exactly one line', () => {
    const dir = tempDir();
    const { storage } = makeStorage();
    const { logger, errors } = silentLogger();

    jest.isolateModules(() => {
      jest.doMock('../../../intelligence', () => ({
        ...jest.requireActual('../../../intelligence'),
        EntityService: class {
          constructor() {
            throw new Error('entity tables missing');
          }
        },
      }));
      const { initIntelligenceCore, getIntelligenceInitState } = require('../bootstrap');
      const { collectIntelligenceHealth } = require('../health');

      const core = initIntelligenceCore({ storage, logger, dataDir: dir });
      // Core UP — an entity-service fault must not take the ledger down.
      expect(core).toBeDefined();
      expect(core.entities).toBeUndefined();
      expect(errors.join(' ')).toMatch(/entity service init failed \(non-fatal\)/);

      // Still recording: the pipeline works without identity.
      const pipeline = eventPipeline(core);
      pipeline.onEvent('site-a', 'plugin_updated', {
        slug: 'woocommerce',
        name: 'WooCommerce',
        version: '9.9.1',
        is_active: true,
      });
      expect(pipeline.delivered).toEqual(['plugin_updated']);
      expect(core.ledger.count()).toBe(1);

      const report = collectIntelligenceHealth({
        core,
        initState: getIntelligenceInitState(),
        now: new Date(),
      });
      const entities = report.lines.find((l: { key: string }) => l.key === 'entities')!;
      expect(entities.verdict).toBe('DARK');
      expect(entities.detail).toMatch(/entity tables missing/);
      // Degraded, not down: the core line is still OK and so is recording.
      expect(report.lines.find((l: { key: string }) => l.key === 'core')!.verdict).toBe('OK');
      expect(report.lines.find((l: { key: string }) => l.key === 'ledger')!.verdict).toBe('OK');
      expect(report.worst).toBe('DARK');

      core.close();
    });
  });
});

describe('the ABI failure path (M1, reproduced)', () => {
  test('a NODE_MODULE_VERSION mismatch is survivable, and health names the mismatch', () => {
    const dir = tempDir();
    const { storage, kv } = makeStorage();
    const { logger } = silentLogger();

    jest.isolateModules(() => {
      jest.doMock('../../../intelligence', () => ({
        ...jest.requireActual('../../../intelligence'),
        Ledger: class {
          constructor() {
            throw new Error(ABI_ERROR);
          }
        },
      }));
      const { initIntelligenceCore, getIntelligenceInitState } = require('../bootstrap');
      const { collectIntelligenceHealth } = require('../health');

      const core = initIntelligenceCore({ storage, logger, dataDir: dir });
      expect(core).toBeUndefined();

      // The app carries on — this is what made the incident invisible.
      const pipeline = eventPipeline(core);
      expect(() => pipeline.onEvent('site-a', 'plugin_updated', {})).not.toThrow();
      expect(pipeline.delivered).toEqual(['plugin_updated']);

      // What was missing in M1: something, anywhere, saying the ABI is wrong.
      const report = collectIntelligenceHealth({
        core,
        initState: getIntelligenceInitState(),
        now: new Date(),
      });
      expect(report.worst).toBe('DARK');
      const line = report.lines.find((l: { key: string }) => l.key === 'core')!;
      expect(line.detail).toContain('NODE_MODULE_VERSION 146');
      expect(line.detail).toContain('NODE_MODULE_VERSION 141');

      const persisted = kv.get('intelligence_init_state') as {
        last_failure?: { stage: string; message: string };
      };
      expect(persisted.last_failure?.stage).toBe('core');
      expect(persisted.last_failure?.message).toContain('NODE_MODULE_VERSION');
    });
  });

  test('the startup log line reports the outage on the boot it happens', () => {
    const dir = tempDir();
    const { storage } = makeStorage();
    const logged: string[] = [];

    jest.isolateModules(() => {
      jest.doMock('../../../intelligence', () => ({
        ...jest.requireActual('../../../intelligence'),
        Ledger: class {
          constructor() {
            throw new Error(ABI_ERROR);
          }
        },
      }));
      const { initIntelligenceCore, getIntelligenceInitState } = require('../bootstrap');
      const { collectIntelligenceHealth, formatHealthLogLine } = require('../health');

      const core = initIntelligenceCore({
        storage,
        logger: { info: (m: string) => logged.push(m), error: (m: string) => logged.push(m) },
        dataDir: dir,
      });
      logged.push(
        formatHealthLogLine(
          collectIntelligenceHealth({ core, initState: getIntelligenceInitState(), now: new Date() })
        )
      );
    });

    const health = logged.find((l) => l.startsWith('[Intelligence] health:'))!;
    expect(health).toContain('DARK');
    expect(health).toContain('core=DARK(not started)');
  });
});

describe('the health check itself cannot break what it checks', () => {
  test('a core whose every read throws still yields a report, not an exception', () => {
    const { collectIntelligenceHealth } = require('../health');
    const hostile = {
      folds: [{ name: 'x/1', topicPrefix: 'state.', apply: () => {} }],
      ledger: {
        raw: () => {
          throw new Error('I/O error');
        },
      },
      law: {
        verifyMirror: () => {
          throw new Error('mirror exploded');
        },
      },
      entities: undefined,
    } as never;

    const report = collectIntelligenceHealth({ core: hostile, initState: {}, now: new Date() });
    expect(report.errors.length).toBeGreaterThanOrEqual(2);
    expect(report.errors.join(' ')).toMatch(/I\/O error/);
    expect(report.errors.join(' ')).toMatch(/mirror exploded/);
    expect(report.lines.length).toBeGreaterThan(0);
  });

  test('health runs against a real core without emitting, folding or writing anything', async () => {
    const dir = tempDir();
    const { storage, kv } = makeStorage();
    const { logger } = silentLogger();
    const { initIntelligenceCore } = require('../bootstrap');
    const { collectIntelligenceHealth } = require('../health');

    const core = initIntelligenceCore({ storage, logger, dataDir: dir });
    core.tap('site-a', 'plugin_updated', {
      slug: 'woocommerce',
      name: 'WooCommerce',
      version: '9.9.1',
      is_active: true,
    });
    await new Promise((r) => setTimeout(r, 700));

    const db = core.ledger.raw();
    const before = {
      events: core.ledger.count(),
      twins: (db.prepare('SELECT COUNT(*) c FROM twin_facts').get() as { c: number }).c,
      cursors: (db.prepare('SELECT COUNT(*) c FROM fold_cursors').get() as { c: number }).c,
      storage: JSON.stringify([...kv.entries()]),
    };

    collectIntelligenceHealth({ core, now: new Date() });
    collectIntelligenceHealth({ core, now: new Date() });

    expect(core.ledger.count()).toBe(before.events);
    expect((db.prepare('SELECT COUNT(*) c FROM twin_facts').get() as { c: number }).c).toBe(
      before.twins
    );
    expect((db.prepare('SELECT COUNT(*) c FROM fold_cursors').get() as { c: number }).c).toBe(
      before.cursors
    );
    // Including storage: the ONLY write in this feature is bootstrap's.
    expect(JSON.stringify([...kv.entries()])).toBe(before.storage);

    core.close();
  });
});
