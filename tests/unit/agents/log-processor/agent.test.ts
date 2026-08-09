import { mockContext, testTool } from '../../../../src/main/agent-sdk/testing';
import {
  initSchema, setBucketConfig, getBucketConfig, saveInstallScan, listInstallScans,
  saveAggregate, getAggregate, markLedger, getLedger,
} from '../../../../agents/log-processor/db';
import { emptyAggregate } from '../../../../agents/log-processor/access-logs';
import type { AgentDefinition, AgentDatabase } from '../../../../src/main/agent-sdk/types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const agent: AgentDefinition = require('../../../../agents/log-processor/agent').default;

const BUCKET = { bucket: 'wpejpp', region: 'us-east-1', prefix: 'wpe_logs/nginx/' };

function seedBucket(db: AgentDatabase, installs: Array<[string, number]> = []) {
  setBucketConfig(db, BUCKET);
  for (const [site, objects] of installs) {
    saveInstallScan(db, {
      site, object_count: objects, bytes: objects * 1000,
      oldest_object_at: '2026-07-01', newest_object_at: '2026-08-01',
      sample_key: `20260801-0016-${site}.apachestyle.log.gz`,
    });
  }
}

describe('agent identity', () => {
  it('has correct name and version', () => {
    expect(agent.name).toBe('log-processor');
    expect(agent.version).toBe('2.0.0');
  });

  it('has a cron trigger', () => {
    expect(agent.triggers.some(t => t.type === 'cron')).toBe(true);
  });

  it('declares effect: readonly — it never writes to the WP site itself', () => {
    expect((agent as unknown as { effect?: string }).effect).toBe('readonly');
  });

  it('leaves producesApprovals/producesReports undeclared — both default false, and that is correct here', () => {
    const a = agent as unknown as { producesApprovals?: boolean; producesReports?: boolean };
    expect(a.producesApprovals).toBeUndefined();
    expect(a.producesReports).toBeUndefined();
  });

  it('no longer exposes the per-site connect tools the account-level model replaced', () => {
    const tools = agent.contributes?.tools ?? {};
    expect(tools.connect_log_source).toBeUndefined();
    expect(tools.disconnect_log_source).toBeUndefined();
    expect(tools.set_log_processing).toBeUndefined();
    expect(tools.set_log_bucket).toBeDefined();
    expect(tools.rescan_log_bucket).toBeDefined();
  });
});

describe('run (nightly cron)', () => {
  it('does nothing at all when no bucket is connected', async () => {
    const ctx = mockContext({ settings: { scope: { siteIds: ['site1'] } } });
    const info = jest.spyOn(ctx.log, 'info');
    initSchema(ctx.db.open('logs'));
    await agent.run(ctx);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('No log bucket connected'));
  });

  it('processes nothing when scope is absent, and says so', async () => {
    const ctx = mockContext();
    const info = jest.spyOn(ctx.log, 'info');
    const db = ctx.db.open('logs');
    initSchema(db);
    seedBucket(db, [['site1', 10]]);
    await agent.run(ctx);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('No sites in scope'));
  });

  it('processes nothing when scope is an empty list', async () => {
    const ctx = mockContext({ settings: { scope: { siteIds: [] } } });
    const info = jest.spyOn(ctx.log, 'info');
    const db = ctx.db.open('logs');
    initSchema(db);
    seedBucket(db, [['site1', 10]]);
    await agent.run(ctx);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('No sites in scope'));
  });

  it('skips a scoped install with no objects in the bucket, and warns', async () => {
    const ctx = mockContext({ settings: { scope: { siteIds: ['not-in-bucket'] } } });
    const info = jest.spyOn(ctx.log, 'info');
    const warn = jest.spyOn(ctx.log, 'warn');
    const db = ctx.db.open('logs');
    initSchema(db);
    seedBucket(db, [['site1', 10]]);
    await agent.run(ctx);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not-in-bucket'));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('No scoped installs have logs'));
  });

  it('ignores an install that has logs but is not switched on', async () => {
    const ctx = mockContext({ settings: { scope: { siteIds: [] } } });
    const info = jest.spyOn(ctx.log, 'info');
    const db = ctx.db.open('logs');
    initSchema(db);
    seedBucket(db, [['site1', 10]]);
    await agent.run(ctx);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('No sites in scope'));
  });

  it('an event naming one install processes only that site, ignoring the rest of scope — the Run Now duplication fix', async () => {
    // Reproduces the real bug: AGENT_RUN_NOW calls run() once per selected site, each with a
    // scoped event. Before this fix, run() ignored the event and reprocessed the FULL scope on
    // every one of those calls — selecting N sites in Run Now ran the entire sync N times.
    const ctx = mockContext({
      settings: { scope: { siteIds: ['site1', 'site2'] } },
      event: { namespace: 'wpe', type: 'sync.completed', key: 'wpe:sync.completed', payload: { installName: 'site1' }, createdAt: Date.now() },
    });
    const info = jest.spyOn(ctx.log, 'info');
    const db = ctx.db.open('logs');
    initSchema(db);
    seedBucket(db, [['site1', 10], ['site2', 10]]);
    await agent.run(ctx);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('Processing 1 install(s): site1'));
  });

  it('an event-targeted site is processed even when it is not in the saved scope at all', async () => {
    const ctx = mockContext({
      settings: { scope: { siteIds: [] } },
      event: { namespace: 'wpe', type: 'sync.completed', key: 'wpe:sync.completed', payload: { installName: 'site1' }, createdAt: Date.now() },
    });
    const info = jest.spyOn(ctx.log, 'info');
    const db = ctx.db.open('logs');
    initSchema(db);
    seedBucket(db, [['site1', 10]]);
    await agent.run(ctx);
    expect(info).not.toHaveBeenCalledWith(expect.stringContaining('No sites in scope'));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('Processing 1 install(s): site1'));
  });

  it('batches every scoped install into ONE sync pass, not one pass per site', async () => {
    // The whole point of the account-level model: one listing per date covers every install.
    // A per-site loop here would re-download the same objects once per site in scope.
    const ctx = mockContext({ settings: { scope: { siteIds: ['site1', 'site2'] } } });
    const info = jest.spyOn(ctx.log, 'info');
    const db = ctx.db.open('logs');
    initSchema(db);
    seedBucket(db, [['site1', 10], ['site2', 10]]);
    await agent.run(ctx);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('Processing 2 install(s): site1, site2'));
  });

  it('migrates a pre-v3 per-site database on first open, and wipes its cross-contaminated data', async () => {
    const ctx = mockContext({ settings: { scope: { siteIds: [] } } });
    const warn = jest.spyOn(ctx.log, 'warn');
    const db = ctx.db.open('logs');
    initSchema(db);
    db.prepare('INSERT INTO sources (site, provider, bucket, region, prefix, enabled, created_at) VALUES (?,?,?,?,?,?,?)')
      .run('legacy', 's3', 'wpejpp', 'us-east-1', 'wpe_logs/nginx/', 1, 1);
    saveAggregate(db, emptyAggregate('legacy', '2026-08-01'));

    await agent.run(ctx);

    expect(getBucketConfig(db)?.bucket).toBe('wpejpp');
    expect(getAggregate(db, 'legacy', '2026-08-01')).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Migrated 1 per-site log source row'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cross-contaminated'));
  });
});

/** Connects a mockContext's credentials to a stubbed AWS secret — mockContext() itself has no
 * override for this (its default is deliberately 'not_connected', see testing.ts), so tests that
 * exercise the connected path build the object directly. */
function withConnectedAws(ctx: ReturnType<typeof mockContext>, revokeCredential = jest.fn().mockResolvedValue(undefined)) {
  (ctx as any).credentials = {
    getStatus: async () => 'connected' as const,
    getSecret: async () => ({ accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret' }),
    requestConnection: async () => {},
    revokeCredential,
  };
  return ctx;
}

function mockFetchSequence(...responses: Array<{ ok?: boolean; status?: number; text?: () => Promise<string>; headerRegion?: string }>) {
  const fn = jest.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok ?? true, status: r.status ?? 200,
      text: r.text ?? (async () => ''),
      headers: { get: (k: string) => (k === 'x-amz-bucket-region' ? (r.headerRegion ?? null) : null) },
    });
  }
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

const contents = (key: string, size = 100) => `<Contents><Key>${key}</Key><Size>${size}</Size></Contents>`;

describe('set_log_bucket', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('returns AWS error message when credentials not connected', async () => {
    const ctx = mockContext();
    initSchema(ctx.db.open('logs'));
    const result = await testTool(agent, 'set_log_bucket', { bucket: 'wpejpp' }, ctx);
    expect(result.content[0].text).toMatch(/AWS/);
  });

  it('saves the bucket and caches every install found in it', async () => {
    const ctx = withConnectedAws(mockContext());
    const db = ctx.db.open('logs');
    initSchema(db);
    mockFetchSequence({
      text: async () =>
        contents('wpe_logs/nginx/20260801-0017-jeremypollock2.apachestyle.log.gz', 300) +
        contents('wpe_logs/nginx/20260801-0017-acfprod.apachestyle.log.gz', 200) +
        // Same folder, never ingested — must not reach the install cache or any count.
        contents('wpe_logs/nginx/20260801-0017-acfprod.access.log.gz', 500),
    });
    const result = await testTool(agent, 'set_log_bucket', { bucket: 'wpejpp', prefix: 'wpe_logs/nginx/' }, ctx);
    expect(result.content[0].text).toContain('✓ Log bucket connected');
    expect(getBucketConfig(db)).toMatchObject({ bucket: 'wpejpp', region: 'us-east-1', prefix: 'wpe_logs/nginx/' });
    expect(listInstallScans(db).map(r => r.site)).toEqual(['acfprod', 'jeremypollock2']);
    expect(listInstallScans(db).find(r => r.site === 'acfprod')?.object_count).toBe(1);
  });

  it('writes nothing when the prefix holds no apache-style objects', async () => {
    const ctx = withConnectedAws(mockContext());
    const db = ctx.db.open('logs');
    initSchema(db);
    mockFetchSequence(
      { text: async () => '' },                                                        // empty listing
      { text: async () => '<CommonPrefixes><Prefix>wpe_logs/other/</Prefix></CommonPrefixes>' }, // sibling probe
      { text: async () => '' },                                                        // sibling has nothing either
    );
    const result = await testTool(agent, 'set_log_bucket', { bucket: 'wpejpp', prefix: 'wpe_logs/empty/' }, ctx);
    expect(result.content[0].text).toMatch(/⚠/);
    expect(getBucketConfig(db)).toBeUndefined();
  });

  it('revokes the credential and writes nothing on a bad-credential failure', async () => {
    const revoke = jest.fn().mockResolvedValue(undefined);
    const ctx = withConnectedAws(mockContext(), revoke);
    const db = ctx.db.open('logs');
    initSchema(db);
    mockFetchSequence({ ok: false, status: 403, text: async () => '<Error><Code>InvalidAccessKeyId</Code><Message>bad key</Message></Error>' });
    const result = await testTool(agent, 'set_log_bucket', { bucket: 'wpejpp' }, ctx);
    expect(result.content[0].text).toMatch(/no longer valid/);
    expect(revoke).toHaveBeenCalledWith('aws');
    expect(getBucketConfig(db)).toBeUndefined();
  });

  it('offers the probed region when the bucket is not found', async () => {
    const ctx = withConnectedAws(mockContext());
    initSchema(ctx.db.open('logs'));
    mockFetchSequence(
      { ok: false, status: 404, text: async () => '<Error><Code>NoSuchBucket</Code><Message>no such bucket</Message></Error>' },
      { headerRegion: 'us-west-2' }, // probeBucketRegion's unsigned HEAD
    );
    const result = await testTool(agent, 'set_log_bucket', { bucket: 'wpejpp' }, ctx);
    expect(result.content[0].text).toContain('us-west-2');
  });

  it('clears the ledger when re-pointed at a different bucket', async () => {
    // The ledger records which file-dates were processed, which is only meaningful against the
    // bucket they came from. Carrying it across would make every already-ledgered date
    // unreachable in the new bucket — which reads as "the new bucket has no data".
    const ctx = withConnectedAws(mockContext());
    const db = ctx.db.open('logs');
    initSchema(db);
    setBucketConfig(db, BUCKET);
    saveAggregate(db, emptyAggregate('site1', '2026-08-01'));
    markLedger(db, { site: 'site1', file_date: '2026-08-01', files: 1, bytes: 1, lines: 1, processed_at: 1 });

    mockFetchSequence({ text: async () => contents('20260801-0017-site1.apachestyle.log.gz') });
    await testTool(agent, 'set_log_bucket', { bucket: 'a-different-bucket' }, ctx);

    expect(getBucketConfig(db)?.bucket).toBe('a-different-bucket');
    expect(getLedger(db, 'site1')).toEqual({});
    expect(getAggregate(db, 'site1', '2026-08-01')).toBeUndefined();
  });

  it('keeps processed data when re-scanning the same location', async () => {
    const ctx = withConnectedAws(mockContext());
    const db = ctx.db.open('logs');
    initSchema(db);
    setBucketConfig(db, BUCKET);
    saveAggregate(db, emptyAggregate('site1', '2026-08-01'));

    mockFetchSequence({ text: async () => contents('wpe_logs/nginx/20260801-0017-site1.apachestyle.log.gz') });
    await testTool(agent, 'set_log_bucket', { bucket: BUCKET.bucket, region: BUCKET.region, prefix: BUCKET.prefix }, ctx);

    expect(getAggregate(db, 'site1', '2026-08-01')).toBeDefined();
  });

  describe('format: json', () => {
    it('returns the structured scan payload on success', async () => {
      const ctx = withConnectedAws(mockContext());
      initSchema(ctx.db.open('logs'));
      mockFetchSequence({ text: async () => contents('20260801-0017-mysite.apachestyle.log.gz') });
      const result = await testTool(agent, 'set_log_bucket', { bucket: 'wpejpp', format: 'json' }, ctx);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toMatchObject({ ok: true, bucket: 'wpejpp', region: 'us-east-1' });
      expect(parsed.scan.apacheStyleObjects).toBe(1);
      expect(parsed.scan.installs[0].installId).toBe('mysite');
    });

    it('returns a structured error the UI can pick a fix from', async () => {
      const ctx = withConnectedAws(mockContext());
      initSchema(ctx.db.open('logs'));
      mockFetchSequence({ ok: false, status: 403, text: async () => '<Error><Code>AccessDenied</Code><Message>denied</Message></Error>' });
      const result = await testTool(agent, 'set_log_bucket', { bucket: 'wpejpp', format: 'json' }, ctx);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toMatchObject({ ok: false, errorCode: 'AccessDenied' });
    });
  });

  describe('dryRun', () => {
    it('reports what it found without saving anything', async () => {
      const ctx = withConnectedAws(mockContext());
      const db = ctx.db.open('logs');
      initSchema(db);
      mockFetchSequence({ text: async () => contents('20260801-0017-mysite.apachestyle.log.gz') });
      const result = await testTool(agent, 'set_log_bucket', { bucket: 'wpejpp', dryRun: true, format: 'json' }, ctx);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toMatchObject({ ok: true, dryRun: true });
      expect(getBucketConfig(db)).toBeUndefined();
    });
  });
});

describe('rescan_log_bucket', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('errors when no bucket is connected', async () => {
    const ctx = withConnectedAws(mockContext());
    initSchema(ctx.db.open('logs'));
    const result = await testTool(agent, 'rescan_log_bucket', {}, ctx);
    expect(result.content[0].text).toMatch(/No log bucket connected/);
  });

  it('refreshes the install cache without touching processed data', async () => {
    const ctx = withConnectedAws(mockContext());
    const db = ctx.db.open('logs');
    initSchema(db);
    seedBucket(db, [['stale-install', 5]]);
    saveAggregate(db, emptyAggregate('stale-install', '2026-08-01'));
    markLedger(db, { site: 'stale-install', file_date: '2026-08-01', files: 1, bytes: 1, lines: 1, processed_at: 1 });

    mockFetchSequence({ text: async () => contents('wpe_logs/nginx/20260801-0017-fresh-install.apachestyle.log.gz') });
    const result = await testTool(agent, 'rescan_log_bucket', {}, ctx);

    expect(result.content[0].text).toContain('✓ Rescanned');
    expect(listInstallScans(db).map(r => r.site)).toEqual(['fresh-install']);
    expect(getAggregate(db, 'stale-install', '2026-08-01')).toBeDefined();
    expect(getLedger(db, 'stale-install')['2026-08-01']).toBeDefined();
  });
});

describe('sync_access_logs', () => {
  it('is registered as a tool', () => {
    expect(agent.contributes?.tools?.sync_access_logs).toBeDefined();
  });

  it('errors when no bucket is connected', async () => {
    const ctx = mockContext();
    initSchema(ctx.db.open('logs'));
    const result = await testTool(agent, 'sync_access_logs', { siteId: 'mysite' }, ctx);
    expect(result.content[0].text).toMatch(/No log bucket connected/);
  });

  it('errors when neither siteId nor siteIds is given', async () => {
    const ctx = mockContext();
    initSchema(ctx.db.open('logs'));
    const result = await testTool(agent, 'sync_access_logs', {}, ctx);
    expect(result.content[0].text).toMatch(/Pass siteId or siteIds/);
  });

  it('reports up-to-date without any S3 call when every date is already ledgered', async () => {
    const ctx = withConnectedAws(mockContext());
    const db = ctx.db.open('logs');
    initSchema(db);
    seedBucket(db, [['site1', 10]]);
    // fileDatesForRange covers [from, to+1] — ledger both.
    markLedger(db, { site: 'site1', file_date: '2026-08-01', files: 1, bytes: 1, lines: 1, processed_at: 1 });
    markLedger(db, { site: 'site1', file_date: '2026-08-02', files: 1, bytes: 1, lines: 1, processed_at: 1 });

    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const result = await testTool(agent, 'sync_access_logs', { siteId: 'site1', from: '2026-08-01', to: '2026-08-01' }, ctx);
    expect(result.content[0].text).toContain('Up to date');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('routes each object to the install named in its filename — the attribution fix', async () => {
    // The bug this replaces: the old per-site runSync listed the SAME shared date prefix and
    // attributed every apache-style object it found to whichever single site it had been called
    // for, so site-a's aggregates absorbed site-b's traffic. Here both installs are in one batch
    // and each must end up with only its own lines.
    const ctx = withConnectedAws(mockContext());
    const db = ctx.db.open('logs');
    initSchema(db);
    seedBucket(db, [['site-a', 1], ['site-b', 1]]);

    const line = (host: string) =>
      `1.2.3.4 ${host} - [01/Aug/2026:00:18:42 +0000] "GET / HTTP/1.1" 200 100 "-" "Mozilla/5.0"\n`;

    mockFetchSequence(
      // One listing for 2026-08-01, holding both installs' objects.
      { text: async () =>
        contents('wpe_logs/nginx/20260801-0017-site-a.apachestyle.log.gz') +
        contents('wpe_logs/nginx/20260801-0017-site-b.apachestyle.log.gz') },
      // Listing for 2026-08-02 (the rotation-offset day) — empty.
      { text: async () => '' },
    );
    // s3StreamLines needs a body stream, which the plain fetch mock above cannot supply, so this
    // test asserts the ROUTING decision (which files each site is given) via the ledger, not the
    // folded aggregates. The `files` count per ledger row is the routing result.
    const streamed: string[] = [];
    const accessLogs = require('../../../../agents/log-processor/access-logs');
    const realStream = accessLogs.s3StreamLines;
    accessLogs.s3StreamLines = async function* (_c: unknown, _r: string, _b: string, key: string) {
      streamed.push(key);
      const host = key.includes('site-a') ? 'site-a.com' : 'site-b.com';
      yield line(host).trim();
    };
    try {
      await testTool(agent, 'sync_access_logs', { siteIds: ['site-a', 'site-b'], from: '2026-08-01', to: '2026-08-01' }, ctx);
    } finally {
      accessLogs.s3StreamLines = realStream;
    }

    // Each object was fetched exactly once across the whole batch, not once per site in scope.
    expect(streamed.filter(k => k.includes('site-a'))).toHaveLength(1);
    expect(streamed.filter(k => k.includes('site-b'))).toHaveLength(1);

    // And each site was ledgered with only its own file.
    expect(getLedger(db, 'site-a')['2026-08-01'].files).toBe(1);
    expect(getLedger(db, 'site-b')['2026-08-01'].files).toBe(1);
  });
});

describe('get_log_aggregates', () => {
  it('is registered as a tool with executionMode function', () => {
    const tool = agent.contributes?.tools?.get_log_aggregates;
    expect(tool).toBeDefined();
    expect(tool?.executionMode).toBe('function');
  });

  it('returns missingDays for the full range when db is empty', async () => {
    const ctx = mockContext();
    initSchema(ctx.db.open('logs'));
    const result = await testTool(agent, 'get_log_aggregates', { siteId: 'mysite', from: '2024-01-01', to: '2024-01-03' }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.missingDays).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']);
    expect(parsed.missingDaysNote).toMatch(/sync_access_logs/);
    expect(parsed.aggregates).toEqual({});
  });

  it('returns aggregates for present days and missing days for gaps', async () => {
    const ctx = mockContext();
    const db = ctx.db.open('logs');
    initSchema(db);
    saveAggregate(db, emptyAggregate('mysite', '2024-01-02'));
    const result = await testTool(agent, 'get_log_aggregates', { siteId: 'mysite', from: '2024-01-01', to: '2024-01-03' }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.missingDays).toEqual(['2024-01-01', '2024-01-03']);
    expect(parsed.aggregates['2024-01-02']).toBeDefined();
  });

  it('omits missingDays when all days are present', async () => {
    const ctx = mockContext();
    const db = ctx.db.open('logs');
    initSchema(db);
    saveAggregate(db, emptyAggregate('mysite', '2024-01-01'));
    const result = await testTool(agent, 'get_log_aggregates', { siteId: 'mysite', from: '2024-01-01', to: '2024-01-01' }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.missingDays).toBeUndefined();
    expect(parsed.aggregates['2024-01-01']).toBeDefined();
  });
});

describe('fetch_log_window', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('is registered as a tool with permissionTier 2', () => {
    const tool = agent.contributes?.tools?.fetch_log_window;
    expect(tool).toBeDefined();
    expect((tool as Record<string, unknown>)?.permissionTier).toBe(2);
  });

  it('returns the no-bucket warning when nothing is connected', async () => {
    const ctx = mockContext();
    initSchema(ctx.db.open('logs'));
    const result = await testTool(agent, 'fetch_log_window', { siteId: 'unbound', from: '2024-01-01', to: '2024-01-01' }, ctx);
    expect(result.content[0].text).toMatch(/No log bucket connected/);
  });

  it('returns AWS error when creds not connected (confirm=false)', async () => {
    const ctx = mockContext();
    const db = ctx.db.open('logs');
    initSchema(db);
    seedBucket(db, [['mysite', 5]]);
    const result = await testTool(agent, 'fetch_log_window', { siteId: 'mysite', from: '2024-01-01', to: '2024-01-01', confirm: false }, ctx);
    expect(result.content[0].text).toMatch(/AWS/);
  });

  it('estimates over only the requested install\'s objects, not the whole account', async () => {
    // Same attribution bug in the forensic path: listing is account-wide, so without the
    // filename filter a window for one install returned every install's traffic.
    const ctx = withConnectedAws(mockContext());
    const db = ctx.db.open('logs');
    initSchema(db);
    seedBucket(db, [['site-a', 1], ['site-b', 1]]);
    mockFetchSequence(
      { text: async () =>
        contents('wpe_logs/nginx/20260801-0017-site-a.apachestyle.log.gz', 1_048_576) +
        contents('wpe_logs/nginx/20260801-0017-site-b.apachestyle.log.gz', 9_437_184) },
      { text: async () => '' },
    );
    const result = await testTool(agent, 'fetch_log_window', { siteId: 'site-a', from: '2026-08-01', to: '2026-08-01' }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.files).toBe(1);
    expect(parsed.compressedMB).toBe(1);
  });

  it('says so plainly when the install has no objects in the window', async () => {
    const ctx = withConnectedAws(mockContext());
    const db = ctx.db.open('logs');
    initSchema(db);
    seedBucket(db, [['site-a', 1]]);
    mockFetchSequence(
      { text: async () => contents('wpe_logs/nginx/20260801-0017-someone-else.apachestyle.log.gz') },
      { text: async () => '' },
    );
    const result = await testTool(agent, 'fetch_log_window', { siteId: 'site-a', from: '2026-08-01', to: '2026-08-01' }, ctx);
    expect(result.content[0].text).toMatch(/No apache-style objects for "site-a"/);
  });
});

describe('log_storage_status', () => {
  it('is registered as a tool with executionMode function', () => {
    const tool = agent.contributes?.tools?.log_storage_status;
    expect(tool).toBeDefined();
    expect(tool?.executionMode).toBe('function');
  });

  it('points at the connect flow when no bucket is connected', async () => {
    const ctx = mockContext();
    initSchema(ctx.db.open('logs'));
    const result = await testTool(agent, 'log_storage_status', {}, ctx);
    expect(result.content[0].text).toMatch(/No log bucket connected/);
  });

  it('reports the bucket and per-install footprint', async () => {
    const ctx = mockContext();
    const db = ctx.db.open('logs');
    initSchema(db);
    seedBucket(db, [['site1', 312]]);
    saveAggregate(db, emptyAggregate('site1', '2024-01-01'));
    markLedger(db, { site: 'site1', file_date: '2024-01-01', files: 1, bytes: 100, lines: 50, processed_at: Date.now() });
    const text = (await testTool(agent, 'log_storage_status', {}, ctx)).content[0].text;
    expect(text).toMatch(/s3:\/\/wpejpp\/wpe_logs\/nginx\//);
    expect(text).toMatch(/site1/);
    expect(text).toMatch(/312 object\(s\) in bucket/);
    expect(text).toMatch(/1 agg days/);
    expect(text).toMatch(/1 ledgered file-dates/);
    expect(text).toMatch(/Fleet total:/);
  });

  it('returns machine-readable state for the Sites tab', async () => {
    const ctx = mockContext();
    const db = ctx.db.open('logs');
    initSchema(db);
    seedBucket(db, [['site1', 312]]);
    const parsed = JSON.parse((await testTool(agent, 'log_storage_status', { format: 'json' }, ctx)).content[0].text);
    expect(parsed.bucket).toMatchObject({ bucket: 'wpejpp' });
    expect(parsed.installs[0]).toMatchObject({ site: 'site1', object_count: 312 });
  });
});

describe('evict_log_data', () => {
  it('is registered as a tool with executionMode function', () => {
    const tool = agent.contributes?.tools?.evict_log_data;
    expect(tool).toBeDefined();
    expect(tool?.executionMode).toBe('function');
  });

  it('returns confirmation text on eviction', async () => {
    const ctx = mockContext();
    const db = ctx.db.open('logs');
    initSchema(db);
    saveAggregate(db, emptyAggregate('site1', '2023-01-01'));
    const text = (await testTool(agent, 'evict_log_data', { olderThanDays: 180 }, ctx)).content[0].text;
    expect(text).toMatch(/✓ Evicted \d+ aggregate day\(s\)/);
    expect(text).toMatch(/fleet-wide/);
    expect(text).toMatch(/older than 180 days/);
  });

  it('returns confirmation with site-specific scope when siteId provided', async () => {
    const ctx = mockContext();
    const db = ctx.db.open('logs');
    initSchema(db);
    saveAggregate(db, emptyAggregate('site1', '2023-01-01'));
    const text = (await testTool(agent, 'evict_log_data', { siteId: 'site1', olderThanDays: 180 }, ctx)).content[0].text;
    expect(text).toMatch(/for site1/);
  });
});

describe('prefix normalization', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('stores a folder-form prefix whatever the user typed', async () => {
    const ctx = withConnectedAws(mockContext());
    const db = ctx.db.open('logs');
    initSchema(db);
    mockFetchSequence({ text: async () => contents('wpe_logs/nginx/20260801-0017-site1.apachestyle.log.gz') });
    await testTool(agent, 'set_log_bucket', { bucket: 'wpejpp', prefix: '/wpe_logs/nginx' }, ctx);
    expect(getBucketConfig(db)?.prefix).toBe('wpe_logs/nginx/');
  });

  it('lists a day under the prefix folder, not concatenated onto its name', async () => {
    // The failure this guards: a prefix stored as `wpe_logs/nginx` made the daily listing ask S3
    // for `wpe_logs/nginx20260801`, which matches nothing — so the bucket scanned clean and every
    // sync afterwards found zero files.
    const ctx = withConnectedAws(mockContext());
    const db = ctx.db.open('logs');
    initSchema(db);
    setBucketConfig(db, { bucket: 'wpejpp', region: 'us-east-1', prefix: 'wpe_logs/nginx' });
    saveInstallScan(db, {
      site: 'site1', object_count: 1, bytes: 1,
      oldest_object_at: '2026-08-01', newest_object_at: '2026-08-01', sample_key: 'x',
    });

    const fetchSpy = mockFetchSequence({ text: async () => '' }, { text: async () => '' });
    await testTool(agent, 'sync_access_logs', { siteId: 'site1', from: '2026-08-01', to: '2026-08-01' }, ctx);

    const listedUrls = fetchSpy.mock.calls.map((c: any[]) => decodeURIComponent(String(c[0])));
    expect(listedUrls.some(u => u.includes('prefix=wpe_logs/nginx/20260801'))).toBe(true);
    expect(listedUrls.some(u => u.includes('prefix=wpe_logs/nginx20260801'))).toBe(false);
  });

  it('rescan repairs a prefix stored by an earlier build', async () => {
    const ctx = withConnectedAws(mockContext());
    const db = ctx.db.open('logs');
    initSchema(db);
    setBucketConfig(db, { bucket: 'wpejpp', region: 'us-east-1', prefix: 'wpe_logs/nginx' });
    mockFetchSequence({ text: async () => contents('wpe_logs/nginx/20260801-0017-site1.apachestyle.log.gz') });
    await testTool(agent, 'rescan_log_bucket', {}, ctx);
    expect(getBucketConfig(db)?.prefix).toBe('wpe_logs/nginx/');
  });
});
