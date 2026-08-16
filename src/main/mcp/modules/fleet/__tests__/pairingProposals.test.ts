/**
 * `nexus_pairing_proposals` — WP-07's gap-filler surface.
 *
 * Reconciliation note §4: proposePairings() runs ONLY over Track-1's
 * unresolved report, and its proposals FEED the existing nexus_link_site
 * confirmation path — information beside the flow, never a parallel queue,
 * never an automatic link. The tests pin exactly that: proposals appear only
 * for unresolved sites, each accepted by a nexus_link_site call the output
 * spells out, and executing the tool writes nothing.
 */
import Database from 'better-sqlite3';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../../../../intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../../intelligence-host/coreRegistry';
import { provisionalEnvironmentId } from '../../../../intelligence-host/provisionalEntity';
import { pairingProposalsHandler } from '../pairing-proposals';

function makeCore(): IntelligenceCore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-proposals-'));
  const kv = new Map<string, unknown>();
  const core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: (...a) => console.error(a) },
    dataDir: dir,
  })!;
  setIntelligenceCore(core);
  return core;
}

/** Seed a site.core twin fact directly — the pure-read fixture the entity
 *  service's own tests established (proposePairings only ever reads). */
function seedSiteCore(core: IntelligenceCore, siteId: string, name: string, domain: string): void {
  core.ledger
    .raw()
    .prepare(`INSERT INTO twin_facts VALUES (?, 'site.core', ?, ?, 'observed', 'evt_seed')`)
    .run(provisionalEnvironmentId(siteId), JSON.stringify({ name, domain }), new Date().toISOString());
}

function fakeGraphDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, source TEXT,
    remote_install_id TEXT, wpe_site_id TEXT, is_active INTEGER)`);
  db.prepare(`INSERT INTO sites VALUES ('row-acme', 'acmeprod', 'wpe', 'inst-acme', NULL, 1)`).run();
  db.prepare(`INSERT INTO sites VALUES ('row-blog', 'blogprod', 'wpe', 'inst-blog', NULL, 1)`).run();
  return db;
}

function servicesWith(unresolved: Array<{ localSiteId: string; localSiteName: string }>, db?: Database.Database) {
  return {
    siteLinkResolver: { getLastReport: () => ({ linked: [], unresolved }) },
    graphService: db ? { getDb: () => db } : undefined,
  } as never;
}

// Runs FIRST, before any makeCore(): the registry is still empty, which is
// exactly the state after a failed core init.
test('without an intelligence core the tool degrades honestly', async () => {
  const res = await pairingProposalsHandler.execute({}, servicesWith([{ localSiteId: 'x', localSiteName: 'x' }]));
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toMatch(/unavailable/i);
});

test('proposals appear ONLY for unresolved sites, each routed to nexus_link_site; nothing is written', async () => {
  const core = makeCore();
  const graphDb = fakeGraphDb();

  // Unresolved local site + its WPE counterpart share a domain (strong evidence).
  seedSiteCore(core, 'local-acme', 'acme-local', 'acme.com');
  seedSiteCore(core, 'row-acme', 'acmeprod', 'www.acme.com');
  // A second matching pair whose local side is RESOLVED — must not appear.
  seedSiteCore(core, 'local-blog', 'blog-local', 'blog.com');
  seedSiteCore(core, 'row-blog', 'blogprod', 'www.blog.com');

  const services = servicesWith([{ localSiteId: 'local-acme', localSiteName: 'acme-local' }], graphDb);
  const before = (core.ledger.raw().prepare('SELECT COUNT(*) c FROM entity_links').get() as { c: number }).c;

  const res = await pairingProposalsHandler.execute({}, services);
  const text = res.content[0].text;

  expect(res.isError).toBeUndefined();
  expect(text).toContain('acme-local');
  expect(text).toContain('acmeprod');
  expect(text).toMatch(/domain_match/);
  // The acceptance path is Track-1's surface, spelled out verbatim.
  expect(text).toMatch(/nexus_link_site.*"site":\s*"local-acme".*"install_id":\s*"inst-acme"/s);
  // The resolved pair is out of scope entirely.
  expect(text).not.toContain('blog');

  // A proposal is information: executing the tool links NOTHING.
  const after = (core.ledger.raw().prepare('SELECT COUNT(*) c FROM entity_links').get() as { c: number }).c;
  expect(after).toBe(before);

  graphDb.close();
  core.close();
});

test('nothing unresolved means nothing proposed', async () => {
  const core = makeCore();
  seedSiteCore(core, 'local-acme', 'acme-local', 'acme.com');
  seedSiteCore(core, 'row-acme', 'acmeprod', 'www.acme.com');

  const res = await pairingProposalsHandler.execute({}, servicesWith([]));
  expect(res.isError).toBeUndefined();
  expect(res.content[0].text).toMatch(/no unresolved local sites/i);
  expect(res.content[0].text).not.toMatch(/domain_match/);
  core.close();
});
