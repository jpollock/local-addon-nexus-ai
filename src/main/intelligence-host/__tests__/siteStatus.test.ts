/**
 * WP-21 · "Where am I?" — the four-line status (surface contract S3).
 *
 * This is the first surface where the three-layer model is rendered for a human,
 * so the Controlled Vocabulary v1 table is the specification, not a guideline:
 *
 *   > You're in a safe copy of Alpine Outfitters.
 *   > Code: the campaign-acf branch.
 *   > Content: pulled from the live site, 11 days ago.
 *   > Nothing you do here touches the live site.
 *
 * Three states have to stay three sentences — a linked copy, a copy nothing has
 * linked, and a linked copy with no recorded sync are different situations with
 * different remedies, and collapsing any pair of them throws away the only thing
 * the reader could act on (the rule WP-15's comparator was built around).
 *
 * The code line is OMITTED, not faked: nothing in this codebase records a branch
 * yet. When a `code_ref` does appear on an observation the line renders, which is
 * pinned here so the reader cannot rot before the producer arrives.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initIntelligenceCore, IntelligenceCore } from '../bootstrap';
import { provisionalEnvironmentId, provisionalSiteId } from '../provisionalEntity';
import { siteStatus, renderSiteStatus, SiteStatusModel } from '../siteStatus';

/**
 * The oracle lives HERE, deliberately — same ruling as WP-15's suite. A list
 * exported from production and imported by the test enforcing it is not a gate.
 */
const FORBIDDEN_WORDS: readonly string[] = [
  'entity',
  'lineage',
  'divergen',
  'upstream',
  'working copy',
  'sandbox',
  'twin',
  'ledger',
  'slo',
  'frame',
  'drift',
  'production', // the live site — 'production' is settings-surface vocabulary only
  'environment',
];

const LOCAL_SITE = 'local-alpine';
const COPY = provisionalEnvironmentId(LOCAL_SITE);
const SITE = provisionalSiteId(LOCAL_SITE);
const PROD = provisionalEnvironmentId('wpe-row-alpine-prod');
const DEV = provisionalEnvironmentId('wpe-row-alpine-dev');
const DAY = 86_400_000;

const NOW = new Date('2026-08-17T12:00:00.000Z');

let core: IntelligenceCore;
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-status-'));
  const kv = new Map<string, unknown>();
  core = initIntelligenceCore({
    storage: { get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) },
    logger: { info: () => {}, error: () => {} },
    dataDir: dir,
  })!;
});

afterEach(() => {
  core.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function describer() {
  return (id: string) =>
    id === PROD
      ? { name: 'alpine-prod', kind: 'production' as const, host: 'wpe' as const }
      : id === DEV
        ? { name: 'alpine-dev', kind: 'development' as const, host: 'wpe' as const }
        : undefined;
}

/** The Site containing this copy and one WP Engine install. */
function seedSite(installEntity = PROD): void {
  const e = core.entities!;
  e.ensure('env', 'local.site_id', LOCAL_SITE);
  e.ensure('site', 'local.site_id.logical', LOCAL_SITE);
  e.link(SITE, COPY, 'has_working_copy', 1.0, 'user_link');
  e.link(SITE, COPY, 'has_environment', 1.0, 'user_link');
  e.link(SITE, installEntity, 'has_environment', 0.95, 'host_connection');
}

/** A pull that carried a database — the only thing that resets content age. */
function seedPull(daysAgo: number, from = PROD): void {
  core.emitter.emit({
    observed_at: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    topic: 'episodic.sync.pulled',
    schema: 'sync.observed/1',
    entity: { site: SITE, environment: from, working_copy: COPY },
    actor: { id: 'act_seed', kind: 'system' },
    source: { class: 'work', system: 'local:sync', trust: 'observed' },
    payload: { flow: 'full', direction: 'down', includes_db: true },
  });
}

function status(over: Partial<Parameters<typeof siteStatus>[0]> = {}) {
  return siteStatus({
    core,
    localSiteId: LOCAL_SITE,
    siteName: 'Alpine Outfitters',
    describeEnvironment: describer(),
    now: NOW,
    ...over,
  });
}

// ---------------------------------------------------------------------------
// The three honest states
// ---------------------------------------------------------------------------

describe('siteStatus — a linked copy that has pulled', () => {
  test('renders the four-line answer in the vocabulary, exactly', () => {
    seedSite();
    seedPull(11);

    expect(status().lines).toEqual([
      "You're in a safe copy of Alpine Outfitters.",
      'Content: pulled from the live site, 11 days ago.',
      'Nothing you do here touches the live site.',
    ]);
  });

  test('the code line renders when a branch is on record, and only then', () => {
    seedSite();
    seedPull(11);

    expect(status().lines.some((l) => l.startsWith('Code:'))).toBe(false);

    core.emitter.emit({
      observed_at: new Date(NOW.getTime() - 1 * DAY).toISOString(),
      topic: 'state.site.observed',
      schema: 'site.observed/1',
      entity: { site: SITE, environment: COPY },
      actor: { id: 'act_seed', kind: 'system' },
      source: { class: 'platform', system: 'wp-cli', trust: 'observed' },
      payload: { name: 'Alpine Outfitters', code_ref: { branch: 'campaign-acf', sha: 'abc1234' } },
    });

    expect(status().lines).toEqual([
      "You're in a safe copy of Alpine Outfitters.",
      'Code: the campaign-acf branch.',
      'Content: pulled from the live site, 11 days ago.',
      'Nothing you do here touches the live site.',
    ]);
  });

  test('the newest recorded branch wins, and a malformed one is never guessed at', () => {
    seedSite();
    seedPull(2);
    for (const [daysAgo, code_ref] of [
      [5, { branch: 'old-branch' }],
      [1, { branch: 'campaign-acf' }],
      [0, { sha: 'deadbeef' }], // no branch: says nothing about a branch
    ] as Array<[number, Record<string, unknown>]>) {
      core.emitter.emit({
        observed_at: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
        topic: 'state.site.observed',
        schema: 'site.observed/1',
        entity: { environment: COPY },
        actor: { id: 'act_seed', kind: 'system' },
        source: { class: 'platform', system: 'wp-cli', trust: 'observed' },
        payload: { code_ref },
      });
    }

    expect(status().lines).toContain('Code: the campaign-acf branch.');
    expect(status().lines).not.toContain('Code: the old-branch branch.');
  });

  test('a WP Engine development source is always named "development (at WP Engine)"', () => {
    seedSite(DEV);
    seedPull(3, DEV);

    // Docs finding №6: users call both their own copy and WP Engine's
    // development environment "dev". The status must never leave that ambiguous.
    expect(status().lines).toContain('Content: pulled from development (at WP Engine), 3 days ago.');
  });

  test('a single day is singular, and a fresh pull is not rounded to zero', () => {
    seedSite();
    seedPull(1);
    expect(status().lines).toContain('Content: pulled from the live site, 1 day ago.');

    const fresh = siteStatus({
      core,
      localSiteId: LOCAL_SITE,
      siteName: 'Alpine Outfitters',
      describeEnvironment: describer(),
      now: new Date(NOW.getTime() - 1 * DAY + 90 * 60_000),
    });
    expect(fresh.lines).toContain('Content: pulled from the live site, 2 hours ago.');
  });
});

describe('siteStatus — a copy nothing has linked', () => {
  test('says what is not on record, and keeps the guarantee true', () => {
    expect(status().lines).toEqual([
      "You're in a safe copy of Alpine Outfitters.",
      "Content: nothing on record says where this copy's content came from.",
      'Nothing you do here touches anything outside this computer.',
    ]);
  });
});

describe('siteStatus — a linked copy with no recorded sync', () => {
  test('is its own sentence: the connection is known, the content age is not', () => {
    seedSite();

    expect(status().lines).toEqual([
      "You're in a safe copy of Alpine Outfitters.",
      "Content: no recorded sync with the live site, so how old this copy's content is isn't known.",
      'Nothing you do here touches the live site.',
    ]);
  });

  test('a push does NOT reset content age — content only ever comes down', () => {
    seedSite();
    core.emitter.emit({
      observed_at: new Date(NOW.getTime() - 1 * DAY).toISOString(),
      topic: 'episodic.sync.pushed',
      schema: 'sync.observed/1',
      entity: { site: SITE, environment: PROD, working_copy: COPY },
      actor: { id: 'act_seed', kind: 'system' },
      source: { class: 'work', system: 'local:sync', trust: 'observed' },
      payload: { flow: 'full', direction: 'up', includes_db: true },
    });

    expect(status().lines).toContain(
      "Content: no recorded sync with the live site, so how old this copy's content is isn't known."
    );
  });
});

describe('siteStatus — nothing says which place this copy follows', () => {
  test('two equally-backed candidates produce a fourth honest sentence, not a guess', () => {
    const e = core.entities!;
    e.ensure('env', 'local.site_id', LOCAL_SITE);
    e.ensure('site', 'local.site_id.logical', LOCAL_SITE);
    e.link(SITE, COPY, 'has_working_copy', 1.0, 'user_link');
    e.link(SITE, PROD, 'has_environment', 0.95, 'host_connection');
    e.link(SITE, DEV, 'has_environment', 0.95, 'host_connection');

    const lines = status().lines;
    expect(lines[1]).toBe(
      "Content: this site has 2 places this copy could have taken content from, and nothing on " +
        "record says which — so how old this copy's content is isn't known."
    );
    expect(lines[2]).toBe('Nothing you do here touches the live site.');
  });
});

// ---------------------------------------------------------------------------
// The vocabulary, and the read discipline
// ---------------------------------------------------------------------------

describe('siteStatus — the vocabulary is a gate', () => {
  test('no rendered line, in any branch, uses a reserved or internal word', () => {
    const branches: SiteStatusModel[] = [
      { siteName: 'Alpine Outfitters', linked: false, content: { state: 'unlinked' } },
      {
        siteName: 'Alpine Outfitters',
        linked: true,
        branch: 'campaign-acf',
        content: { state: 'pulled', sourceName: 'the live site', behindSeconds: 11 * 86_400 },
      },
      {
        siteName: 'Alpine Outfitters',
        linked: true,
        content: { state: 'no-sync', sourceName: 'staging' },
      },
      {
        siteName: 'Alpine Outfitters',
        linked: true,
        content: { state: 'ambiguous', candidateCount: 3 },
      },
    ];

    for (const model of branches) {
      const text = renderSiteStatus(model).join('\n');
      for (const word of FORBIDDEN_WORDS) {
        expect(text.toLowerCase()).not.toContain(word);
      }
      expect(text).not.toMatch(/ent_[a-z]+_/);
    }
  });
});

describe('siteStatus — it reads, and only reads', () => {
  test('answering "where am I?" writes nothing anywhere', () => {
    seedSite();
    seedPull(11);
    const db = core.ledger.raw();
    const count = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
    const before = {
      entities: count('entities'),
      aliases: count('entity_aliases'),
      links: count('entity_links'),
      events: count('events'),
      twins: count('twin_facts'),
    };

    status();
    status({ localSiteId: 'never-registered-anywhere' });

    expect({
      entities: count('entities'),
      aliases: count('entity_aliases'),
      links: count('entity_links'),
      events: count('events'),
      twins: count('twin_facts'),
    }).toEqual(before);
  });

  test('a broken core costs the detail, never the answer', () => {
    const broken = {
      ...core,
      ledger: {
        query: () => {
          throw new Error('ledger down');
        },
        raw: () => core.ledger.raw(),
      },
      entities: undefined,
    } as unknown as IntelligenceCore;

    const lines = siteStatus({
      core: broken,
      localSiteId: LOCAL_SITE,
      siteName: 'Alpine Outfitters',
      now: NOW,
    }).lines;

    expect(lines[0]).toBe("You're in a safe copy of Alpine Outfitters.");
    expect(lines[lines.length - 1]).toBe(
      'Nothing you do here touches anything outside this computer.'
    );
  });
});
