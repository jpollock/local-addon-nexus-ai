/**
 * Row-timestamp honesty — an unparseable row time must never become "now".
 *
 * The layer's rule (stated at `incidentProducer.ts` and in the backfill's own
 * header): a record with no usable time emits NOTHING rather than being
 * stamped now — stamping "now" on old data is the data laundering CLAUDE.md
 * forbids. The split that matters, and that this file pins in BOTH directions:
 *
 *   - BACKFILL reads OLD rows. A fabricated "now" claims present-moment
 *     freshness for data of unknown age, so a row whose `updated_at` cannot
 *     be read is SKIPPED, counted, and named in the log.
 *   - The LIVE TAP observes a write that is happening at this moment. When the
 *     row carries no usable time, "now" IS the true observation time — the
 *     fallback there is honest and stays.
 */
import Database from 'better-sqlite3';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { rowTimeToIso } from '../changeGate';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { runGraphBackfill } from '../graphBackfill';
import { tapGraphService } from '../graphServiceTap';

const quiet = { info: () => {}, error: () => {} };

function freshCore(): IntelligenceCore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-rowtime-'));
  const kv = new Map<string, unknown>();
  return initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: (...a) => console.error(a) },
    dataDir: dir,
  })!;
}

describe('rowTimeToIso', () => {
  it('converts ms and s epochs to ISO', () => {
    expect(rowTimeToIso(1723600000000)).toBe(new Date(1723600000000).toISOString());
    expect(rowTimeToIso(1723600000)).toBe(new Date(1723600000 * 1000).toISOString());
    expect(rowTimeToIso('1723600000000')).toBe(new Date(1723600000000).toISOString());
  });

  it('returns null — never "now" — for a time it cannot read', () => {
    for (const bad of [null, undefined, '', 'garbage', 0, NaN, -5, 123, {}]) {
      expect(rowTimeToIso(bad)).toBeNull();
    }
  });
});

describe('backfill skips rows whose time cannot be read', () => {
  it('emits nothing for a NULL/garbage updated_at row, counts the skip, keeps the good rows', async () => {
    const core = freshCore();
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, wp_version TEXT,
        php_version TEXT, source TEXT, updated_at INTEGER, is_active INTEGER);
      CREATE TABLE plugins (site_id TEXT, slug TEXT, version TEXT, is_active INTEGER, updated_at INTEGER);
      CREATE TABLE themes (site_id TEXT, slug TEXT, version TEXT, is_active INTEGER, updated_at INTEGER);
    `);
    const t = Date.now() - 3600_000;
    db.prepare(`INSERT INTO sites VALUES ('goodsite','goodsite','a.com','7.0','8.3','wpe',?,1)`).run(t);
    db.prepare(`INSERT INTO sites VALUES ('badtime','badtime','b.com','6.9',NULL,'wpe',NULL,1)`).run();
    db.prepare(`INSERT INTO plugins VALUES ('goodsite','woocommerce','9.9.1',1,?)`).run(t);
    db.prepare(`INSERT INTO plugins VALUES ('goodsite','akismet','5.0',1,NULL)`).run();
    db.prepare(`INSERT INTO themes VALUES ('goodsite','twentytwentyfive','2.1',1,NULL)`).run();

    const result = runGraphBackfill(core, db, quiet);

    // One site row, one plugin row and one theme row carried no usable time.
    expect(result.skippedNoTime).toBe(3);
    // The good rows still landed.
    expect(result.emitted).toBe(2);

    // Nothing in the ledger claims present-moment freshness for backfilled data.
    const events = core.ledger.query({ topicPrefix: 'state.' });
    expect(events).toHaveLength(2);
    for (const e of events) {
      const ageS = (Date.now() - Date.parse(e.observed_at)) / 1000;
      expect(ageS).toBeGreaterThan(3000);
    }
    // The skipped rows are absent, not stamped: no event names them.
    expect(events.some((e) => JSON.stringify(e.payload).includes('badtime'))).toBe(false);
    expect(events.some((e) => JSON.stringify(e.payload).includes('akismet'))).toBe(false);

    core.close();
    db.close();
  });
});

describe('the live tap keeps its now-fallback — the write is happening now', () => {
  it('a tapped upsert with no usable updated_at still emits, observed at the present moment', async () => {
    const core = freshCore();
    const gs = {
      upsertSite: async (_s: Record<string, unknown>) => {},
      upsertPlugin: async (_p: Record<string, unknown>) => 1,
    };
    tapGraphService(gs, core, quiet);

    const before = Date.now();
    await gs.upsertPlugin({ site_id: 'localwpe', slug: 'woocommerce', name: 'Woo', version: '9.9.1', is_active: true });

    const events = core.ledger.query({ topicPrefix: 'state.plugin.' });
    expect(events).toHaveLength(1);
    const obs = Date.parse(events[0].observed_at);
    expect(obs).toBeGreaterThanOrEqual(before - 1000);
    expect(obs).toBeLessThanOrEqual(Date.now() + 1000);
    core.close();
  });
});
