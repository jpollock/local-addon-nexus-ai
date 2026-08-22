/**
 * WP-58 · THE ACCEPTANCE EXHIBIT — a real colliding name, through two real tools.
 *
 * The gate owes one driven demonstration: a name that exists in BOTH Local's
 * store and the graph, put through `compare_sites` and `get_site_structure`,
 * showing the decline and its message. This is the instrument that produces
 * it, committed so the exhibit is reproducible rather than a paragraph.
 *
 * WHY AN EXHIBIT AND NOT ANOTHER TEST (WP-56's rule): a ruling states what must
 * be true and a test states what a function does; only an exhibit has to FIND
 * THE CALLER. The tests in `tests/unit/mcp/collision-decline.test.ts` drive the
 * resolvers directly, over a fixture the test itself built. This drives the two
 * MCP handlers' own `execute()` — the shape a chat agent actually reaches —
 * over the OWNER'S REAL FLEET, and prints exactly what that agent would read.
 *
 * IT IS READ-ONLY, AND STRUCTURALLY SO. `sites.json` is read with `readFileSync`
 * and `graph.db` is opened `{ readonly: true }`, so the live fleet cannot be
 * mutated even by a mistake in this file. Nothing here writes.
 *
 *   npx ts-node scripts/wp58-collision-exhibit.ts
 *   npx ts-node scripts/wp58-collision-exhibit.ts --name myloop
 *
 * With no `--name` it discovers the collision set the same way the test does
 * and uses the first one. Exits 2 with a clear message when this machine has no
 * fleet, or no colliding name in it — an exhibit that quietly demonstrates
 * nothing is the failure mode the whole packet is about.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getSiteStructureHandler } from '../src/main/mcp/modules/site-context/get-site-structure';
import { compareSitesHandler } from '../src/main/mcp/modules/fleet/compare-sites';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const SUPPORT = path.join(os.homedir(), 'Library', 'Application Support', 'Local');
const SITES_JSON = path.join(SUPPORT, 'sites.json');
const GRAPH_DB = path.join(SUPPORT, 'nexus-ai', 'graph.db');

for (const p of [SITES_JSON, GRAPH_DB]) {
  if (!fs.existsSync(p)) {
    console.error(`REFUSED: ${p} does not exist — this machine has no fleet to exhibit.`);
    process.exit(2);
  }
}

// ── Local's own store, as `SiteDataAccessor` ────────────────────────────────
const rawSites = JSON.parse(fs.readFileSync(SITES_JSON, 'utf8')) as Record<
  string,
  { id?: string; name?: string; path?: string; domain?: string }
>;
const localSites = Object.entries(rawSites).map(([id, s]) => ({
  id: s.id ?? id,
  name: String(s.name ?? ''),
  path: String(s.path ?? ''),
  domain: s.domain,
}));
const siteData = {
  getSite: (id: string) => localSites.find((s) => s.id === id) ?? null,
  getSites: () => Object.fromEntries(localSites.map((s) => [s.id, s])),
};

// ── The graph, READ-ONLY ────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require('better-sqlite3');
const db = new Database(GRAPH_DB, { readonly: true, fileMustExist: true });
const graphService = { getDb: () => db };

// ── Pick the colliding name ─────────────────────────────────────────────────
const localNames = new Set(localSites.map((s) => s.name.toLowerCase()).filter(Boolean));
const graphNames = db
  .prepare("SELECT DISTINCT name FROM sites WHERE source IN ('wpe','external') AND is_active = 1")
  .all()
  .map((r: { name: string }) => String(r.name ?? '').toLowerCase())
  .filter(Boolean);
const collisions: string[] = Array.from(new Set(graphNames.filter((n: string) => localNames.has(n)))).sort() as string[];

console.log(`Local sites: ${localSites.length}   active wpe/external rows: ${graphNames.length}`);
console.log(`Colliding names (${collisions.length}): ${collisions.join(', ') || '(none)'}`);

const name = flag('--name') ?? collisions[0];
if (!name) {
  console.error('\nREFUSED: no colliding name on this fleet — there is nothing to exhibit.');
  process.exit(2);
}
if (!collisions.includes(name.toLowerCase())) {
  console.error(`\nREFUSED: "${name}" is not in the collision set — the exhibit would prove nothing.`);
  process.exit(2);
}

// ── The services bag the two handlers reach for ─────────────────────────────
// Only what each handler touches BEFORE it answers. Both decline during
// resolution, so the stores below are never read — which is itself part of the
// demonstration: the refusal happens before any data is fetched.
const services = {
  siteData,
  graphService,
  twinService: { get: () => null },
  indexRegistry: { get: () => null },
  // Reached ONLY on the third case, and reaching it is the point: getting past
  // resolution to the Local data tiers is what "the pin was accepted" looks
  // like from the caller's side. This exhibit is read-only and does not walk a
  // real site directory, so it says so instead of scanning.
  fileScanner: {
    scan: async () => {
      throw new Error(
        'RESOLUTION SUCCEEDED — the @local pin was accepted and the tool reached Tier 3 ' +
        '(filesystem), which this read-only exhibit does not run.',
      );
    },
  },
} as any;

function show(title: string, result: { content: Array<{ text: string }>; isError?: boolean }) {
  console.log(`\n${'─'.repeat(76)}`);
  console.log(`${title}`);
  console.log(`${'─'.repeat(76)}`);
  console.log(`isError: ${result.isError === true}`);
  console.log(result.content.map((c) => c.text).join('\n'));
}

(async () => {
  console.log(`\nDriving "${name}" through two real handlers.\n`);

  show(
    `get_site_structure({ site: "${name}" })`,
    (await getSiteStructureHandler.execute({ site: name }, services)) as any,
  );

  show(
    `compare_sites({ site_a: "${name}", site_b: "${name}" })`,
    (await compareSitesHandler.execute({ site_a: name, site_b: name }, services)) as any,
  );

  // The escape hatch, driven — a decline is only cheap if the caller can answer
  // it, so the exhibit shows the answer being accepted, not just the refusal.
  show(
    `get_site_structure({ site: "${name}@local" })  — the caller says which one`,
    (await getSiteStructureHandler.execute({ site: `${name}@local` }, services)) as any,
  );

  db.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
