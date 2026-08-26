/**
 * fixes-082526 · Tier A 8 — the site-link mirror stops being startup-only.
 *
 * `runSiteLinkMirror` ran once, after startup reconciliation. An install
 * discovered by a mid-session CAPI sweep was invisible to the entity service
 * until the next restart — the measured one-restart lag. The fix is a
 * completion hook on `syncAllWPESites`: index.ts wires it to the mirror,
 * which is idempotent, so firing after every completed sweep costs nothing
 * and closes the lag in every case.
 *
 * The contract pinned here: fires after every COMPLETED sweep, never after a
 * failed one, and a throwing hook cannot fail the sweep it observes.
 */
import * as fs from 'fs';
import * as path from 'path';
import { GraphService } from '../../../src/main/events/GraphService';
import { WPESyncService } from '../../../src/main/events/WPESyncService';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

async function makeGraph(): Promise<GraphService> {
  const g = new GraphService(':memory:', silent);
  await g.initialize();
  return g;
}

function makeService(graph: GraphService, opts: {
  onSyncCompleted?: () => void;
  capiGetInstalls?: () => Promise<unknown[]>;
}) {
  const localServices = {
    isCAPIAvailable: () => true,
    capiGetInstalls: opts.capiGetInstalls ?? (async () => []),
    capiGetAccounts: async () => [],
    capiGetSites: async () => [],
  } as never;
  return new WPESyncService({
    graphService: graph,
    localServices,
    logger: silent,
    onSyncCompleted: opts.onSyncCompleted,
  } as never);
}

describe('syncAllWPESites × onSyncCompleted', () => {
  test('fires once after a completed sweep', async () => {
    const hook = jest.fn();
    const svc = makeService(await makeGraph(), { onSyncCompleted: hook });
    const result = await svc.syncAllWPESites();
    expect(result.success).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  test('does NOT fire after a failed sweep — nothing new to mirror', async () => {
    const hook = jest.fn();
    const svc = makeService(await makeGraph(), {
      onSyncCompleted: hook,
      capiGetInstalls: async () => { throw new Error('CAPI 502'); },
    });
    const result = await svc.syncAllWPESites();
    expect(result.success).toBe(false);
    expect(hook).not.toHaveBeenCalled();
  });

  test('a throwing hook cannot fail the sweep it observes', async () => {
    const svc = makeService(await makeGraph(), {
      onSyncCompleted: () => { throw new Error('mirror blew up'); },
    });
    const result = await svc.syncAllWPESites();
    expect(result.success).toBe(true);
  });

  test('a service constructed without the hook still completes — the hook is optional', async () => {
    const svc = makeService(await makeGraph(), {});
    const result = await svc.syncAllWPESites();
    expect(result.success).toBe(true);
  });
});

describe('the wiring — index.ts hands the hook to the mirror', () => {
  // Same source-pin idiom as job-instrumentation.test.ts: the hook without
  // its wiring is a callback nobody calls, which is the startup-only lag
  // under a new name.
  test('onSyncCompleted is wired to runSiteLinkMirror at the construction site', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../src/main/index.ts'), 'utf8');
    const hook = src.slice(src.indexOf('onSyncCompleted:'));
    expect(hook.length).toBeGreaterThan(0);
    expect(hook.slice(0, 600)).toContain('runSiteLinkMirror');
  });
});
