/**
 * `nexus_where_am_i` — the chat-facing half of WP-21.
 *
 * The status is only useful if a model reaches for it when a user asks "where am
 * I?", so the tool is a real registration with a real tier entry, and its output
 * is the four lines verbatim — no framing, no headings, nothing the model has to
 * unwrap before relaying.
 *
 * What these pin beyond "it produces text":
 *   - Tier 1. An absent TIER_OVERRIDES entry silently defaults to Tier 2, which
 *     would write an `operation-audit.log` line every time somebody asked where
 *     they were standing.
 *   - The layer being DOWN and the copy having NO RECORDED SYNC are different
 *     answers. Rendering the second when the first is true is the exact class of
 *     lie this packet's discipline is about.
 *   - It never mints an entity, even for a site nothing has ever recorded.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../../../../intelligence-host/bootstrap';
import { setIntelligenceCore } from '../../../../intelligence-host/coreRegistry';
import {
  provisionalEnvironmentId,
  provisionalSiteId,
} from '../../../../intelligence-host/provisionalEntity';
import { getToolSafety } from '../../../safety';
import { registerFleetTools } from '../index';
import { whereAmIHandler } from '../where-am-i';
import type { NexusServices } from '../../../types';

const LOCAL_SITE = 'local-alpine';
const COPY = provisionalEnvironmentId(LOCAL_SITE);
const SITE = provisionalSiteId(LOCAL_SITE);
const WPE_ROW = 'wpe-row-alpine-prod';
const PROD = provisionalEnvironmentId(WPE_ROW);
const DAY = 86_400_000;

let core: IntelligenceCore;
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-whereami-'));
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

function services(): NexusServices {
  return {
    siteData: {
      getSite: (id: string) =>
        id === LOCAL_SITE ? { id: LOCAL_SITE, name: 'Alpine Outfitters', path: '/x' } : null,
      getSites: () => ({
        [LOCAL_SITE]: { id: LOCAL_SITE, name: 'Alpine Outfitters', path: '/x' },
      }),
    },
    graphService: {
      listSites: async () => [
        { id: WPE_ROW, name: 'alpine-prod', source: 'wpe', environment: 'production' },
        { id: LOCAL_SITE, name: 'Alpine Outfitters', source: 'local', environment: 'development' },
      ],
    },
  } as never;
}

function seedLinkedPull(daysAgo: number): void {
  const e = core.entities!;
  e.ensure('env', 'local.site_id', LOCAL_SITE);
  e.ensure('site', 'local.site_id.logical', LOCAL_SITE);
  e.ensure('env', 'local.site_id', WPE_ROW);
  e.link(SITE, COPY, 'has_working_copy', 1.0, 'user_link');
  e.link(SITE, PROD, 'has_environment', 0.95, 'host_connection');
  e.link(COPY, PROD, 'content_pulled_from', 1.0, 'pull_lineage');
  core.emitter.emit({
    observed_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
    topic: 'episodic.sync.pulled',
    schema: 'sync.observed/1',
    entity: { site: SITE, environment: PROD, working_copy: COPY },
    actor: { id: 'act_seed', kind: 'system' },
    source: { class: 'work', system: 'local:sync', trust: 'observed' },
    payload: { flow: 'full', direction: 'down', includes_db: true },
  });
}

async function run(site = LOCAL_SITE): Promise<string> {
  const res = await whereAmIHandler.execute({ site }, services());
  return res.content[0].text;
}

test('the tool is registered and is Tier 1 — a question about where you are is not a mutation', () => {
  const registered: string[] = [];
  registerFleetTools({
    register: (h: { definition: { name: string } }) => registered.push(h.definition.name),
  } as never);

  expect(registered).toContain('nexus_where_am_i');
  expect(getToolSafety('nexus_where_am_i').tier).toBe(1);
  expect(whereAmIHandler.definition.annotations?.readOnlyHint).toBe(true);
});

test('the description names the questions a model should call it for', () => {
  const d = whereAmIHandler.definition.description.toLowerCase();
  expect(d).toContain('where am i');
  expect(d).toContain('copy');
  expect(d).toContain('live site');
  expect(whereAmIHandler.definition.inputSchema.required).toEqual(['site']);
});

test('a linked copy gets the four lines, and nothing else to unwrap', async () => {
  seedLinkedPull(11);
  const text = await run();

  expect(text).toBe(
    [
      "You're in a safe copy of Alpine Outfitters.",
      'Content: pulled from the live site, 11 days ago.',
      'Nothing you do here touches the live site.',
    ].join('\n')
  );
});

test('an unknown site is an error, not an invented copy', async () => {
  const res = await whereAmIHandler.execute({ site: 'nope' }, services());
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toContain('nope');
});

test('with record-keeping down it says THAT — never "no recorded sync"', async () => {
  setIntelligenceCore(undefined as never);
  const text = await run();

  expect(text).toContain("You're in a safe copy of Alpine Outfitters.");
  expect(text).toContain('Nothing you do here touches the live site');
  // The distinction that matters: nothing is claimed about this copy's content.
  expect(text).not.toContain('no recorded sync');
  expect(text).not.toContain('pulled from');
  expect(text.toLowerCase()).toContain('not recording');
  expect(text).toContain('nexus_intelligence_health');
});

test('asking where you are records nothing', async () => {
  seedLinkedPull(11);
  const db = core.ledger.raw();
  const count = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
  const before = ['entities', 'entity_aliases', 'entity_links', 'events', 'twin_facts'].map(count);

  await run();

  expect(['entities', 'entity_aliases', 'entity_links', 'events', 'twin_facts'].map(count)).toEqual(
    before
  );
});
