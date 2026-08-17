/**
 * WP-15 · `wpe_detect_drift` gains the comparator, additively.
 *
 * Audit A5: this tool performs exactly the right measurement on the wrong
 * substrate — it joins graph caches by `hostConnections` install NAME, which
 * bypasses `site_links` precedence, entity ids, freshness and any notion of
 * which flow a difference belongs to. The enrichment does not repair the
 * legacy join; it APPENDS the same question answered from the links, so the
 * two answers are visible side by side and a disagreement between them is
 * information rather than a silent overwrite.
 *
 * The load-bearing pins here:
 *   - **additive parity** — the legacy report survives character for character
 *     (the pattern's ab.no-legacy-parity abort, turned into a test);
 *   - **the pair comes from the links** — a copy whose recorded pull points at
 *     a DIFFERENT install than its `hostConnections` entry is compared against
 *     the one it actually pulled from;
 *   - **the population disagreement** — copies the links know about that this
 *     tool's own `hostConnections` population never counted are named, not
 *     folded in.
 */
import Database from 'better-sqlite3';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore } from '../../../../intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../../intelligence-host/coreRegistry';
import { runGraphBackfill } from '../../../../intelligence-host/graphBackfill';
import { provisionalEnvironmentId } from '../../../../intelligence-host/provisionalEntity';
import { detectDriftHandler } from '../detect-drift';

const SILENT = { info: () => {}, error: () => {} };
const HOUR = 3600_000;

function makeGraph(): any {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, wp_version TEXT,
      php_version TEXT, source TEXT, updated_at INTEGER, is_active INTEGER);
    CREATE TABLE plugins (site_id TEXT, slug TEXT, name TEXT, version TEXT, is_active INTEGER, updated_at INTEGER);
  `);
  const t = Date.now() - 2 * HOUR;
  const site = db.prepare(`INSERT INTO sites VALUES (?,?,?,?,?,?,?,1)`);
  site.run('local-1', 'alpine', 'alpine.local', '6.5', '8.2', 'local', t);
  site.run('wpe-prod', 'alpineprod', 'alpine.com', '6.6', '8.3', 'wpe', t);
  site.run('wpe-stg', 'alpinestg', 'stg.alpine.com', '6.6', '8.3', 'wpe', t);

  const plug = db.prepare(`INSERT INTO plugins VALUES (?,?,?,?,1,?)`);
  plug.run('local-1', 'acf', 'ACF', '6.0.0', t);
  plug.run('local-1', 'campaign', 'Campaign Tools', '1.0.0', t);
  plug.run('wpe-prod', 'acf', 'ACF', '6.1.0', t);
  plug.run('wpe-prod', 'wpe-cache', 'WPE Cache', '2.0.0', t);
  plug.run('wpe-stg', 'acf', 'ACF', '6.0.0', t);
  return db;
}

function makeServices(graphDb: any, installName = 'alpineprod'): never {
  return {
    siteData: {
      getSites: () => ({
        'local-1': {
          id: 'local-1',
          name: 'alpine',
          hostConnections: [{ host: 'wpe', installName }],
        },
      }),
    },
    indexRegistry: { listAll: () => [] },
    graphService: { getDb: () => graphDb },
  } as never;
}

function newCore(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const kv = new Map<string, unknown>();
  return initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: SILENT,
    dataDir: dir,
  })!;
}

/** What the WP-14 producer leaves behind for a real pull: the edge and the event. */
function recordPull(core: any, copyId: string, upstreamId: string, at: Date): void {
  core.entities.linkExclusive(
    copyId,
    upstreamId,
    'content_pulled_from',
    1.0,
    'pull_lineage',
    at.toISOString(),
  );
  core.emitter.emit({
    observed_at: at.toISOString(),
    topic: 'episodic.sync.pulled',
    schema: 'sync.observed/1',
    entity: { environment: upstreamId, working_copy: copyId },
    actor: { id: 'act_local_sync', kind: 'system' },
    source: { class: 'platform', system: 'sync:wpe', trust: 'observed' },
    payload: { flow: 'full', direction: 'down', includes_db: true },
  });
}

async function run(services: never): Promise<string> {
  const result = await detectDriftHandler.execute({}, services);
  return result.content[0].text as string;
}

let graphDb: any;
let core: any;
let legacyText: string;

beforeAll(async () => {
  graphDb = makeGraph();
  const services = makeServices(graphDb);

  // The legacy run happens FIRST, with no core registered — the registry is
  // process-wide and has no reset, so the baseline can only be captured here.
  legacyText = await run(services);

  core = newCore('intel-wpe-drift-');
  setIntelligenceCore(core);
  runGraphBackfill(core, graphDb, SILENT);
  await new Promise((r) => setTimeout(r, 700));
});

afterAll(() => {
  core?.close();
  graphDb?.close();
});

describe('wpe_detect_drift enrichment', () => {
  test('the legacy report is untouched — every character of it survives', async () => {
    recordPull(core, provisionalEnvironmentId('local-1'), provisionalEnvironmentId('wpe-prod'), new Date(Date.now() - 11 * 24 * HOUR));
    const text = await run(makeServices(graphDb));

    expect(legacyText).toContain('## Local ↔ WPE Drift Report');
    expect(legacyText).not.toContain('how far behind or ahead');
    expect(text.startsWith(legacyText)).toBe(true);
  });

  test('content is reported in time and code in items, from the recorded pull', async () => {
    const text = await run(makeServices(graphDb));

    expect(text).toContain('### Behind and ahead');
    expect(text).toMatch(/pulled from alpineprod 11d ago/);
    // Behind: acf is older here, wpe-cache is missing here, WordPress is older
    // here. Ahead: campaign exists only here. WordPress counts as a code item
    // because a core upgrade is a change to files.
    expect(text).toMatch(/3 items behind, 1 ahead/);
    expect(text).toMatch(/\| WordPress \| 6\.5 \| 6\.6 \| behind \|/);
    // The item name is the slug the ledger observed — the display name lives in
    // the graph, and inventing one here would be a second source of truth.
    expect(text).toMatch(/\| acf \(plugin\) \| 6\.0\.0 \| 6\.1\.0 \| behind \|/);
    expect(text).toMatch(/alpine checked .* alpineprod checked/);
  });

  test('the pair comes from the recorded pull, not from hostConnections', async () => {
    // Local's own connection setting still names alpineprod; the copy was
    // actually pulled from alpinestg. The comparison follows the pull.
    recordPull(core, provisionalEnvironmentId('local-1'), provisionalEnvironmentId('wpe-stg'), new Date(Date.now() - 3 * 24 * HOUR));

    const text = await run(makeServices(graphDb));

    expect(text).toMatch(/pulled from alpinestg 3d ago/);
    // Against staging acf MATCHES (6.0.0 both sides), where against production
    // it was behind — the clearest proof the pair moved. What remains: behind
    // on WordPress, ahead on the plugin that exists only here.
    expect(text).toMatch(/1 item behind, 1 ahead/);
    expect(text).not.toMatch(/\| acf \(plugin\) \|/);
    // …while the LEGACY half of the same report still compares with alpineprod.
    expect(text).toContain('### alpine ↔ alpineprod');
  });

  test('copies the links know about but this report never covered are named, not merged', async () => {
    const orphan = provisionalEnvironmentId('some-other-local-site');
    core.entities.ensure('env', 'local.site_id', 'some-other-local-site');
    recordPull(core, orphan, provisionalEnvironmentId('wpe-prod'), new Date(Date.now() - 2 * 24 * HOUR));

    const text = await run(makeServices(graphDb));

    expect(text).toMatch(/Also on record: 1 other copy/);
    // Named where nameable, and never rendered as an id.
    expect(text).not.toMatch(/ent_env_/);
  });

  test('a copy with no recorded pull says so instead of guessing an upstream', async () => {
    // A different local site, linked in Local but with nothing on record.
    const services = {
      siteData: {
        getSites: () => ({
          'local-2': {
            id: 'local-2',
            name: 'unlinked-copy',
            hostConnections: [{ host: 'wpe', installName: 'alpineprod' }],
          },
        }),
      },
      indexRegistry: { listAll: () => [] },
      graphService: { getDb: () => graphDb },
    } as never;

    const text = await run(services);

    expect(text).toMatch(/nothing on record says which site this copy tracks/i);
    expect(text).not.toMatch(/unlinked-copy — how far behind or ahead[\s\S]*items behind/);
  });
});
