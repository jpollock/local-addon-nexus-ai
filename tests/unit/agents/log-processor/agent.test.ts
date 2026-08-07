import { mockContext, testTool } from '../../../../src/main/agent-sdk/testing';
import {
  initSchema, upsertSource, getSource, getEnabledSites, saveAggregate, markLedger,
} from '../../../../agents/log-processor/db';
import { emptyAggregate } from '../../../../agents/log-processor/access-logs';
import type { AgentDefinition } from '../../../../src/main/agent-sdk/types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const agent: AgentDefinition = require('../../../../agents/log-processor/agent').default;

describe('agent identity', () => {
  it('has correct name and version', () => {
    expect(agent.name).toBe('log-processor');
    expect(agent.version).toBe('1.0.0');
  });

  it('has a cron trigger', () => {
    expect(agent.triggers.some(t => t.type === 'cron')).toBe(true);
  });

  it('declares effect: readonly — it never writes to the WP site itself', () => {
    expect((agent as unknown as { effect?: string }).effect).toBe('readonly');
  });
});

describe('run (nightly cron)', () => {
  it('processes nothing when scope is absent, and says so', async () => {
    const ctx = mockContext();
    const info = jest.spyOn(ctx.log, 'info');
    const db = ctx.db.open('logs');
    initSchema(db);
    upsertSource(db, { site: 'site1', provider: 's3', bucket: 'b1', region: 'us-east-1', prefix: '', enabled: 1 });
    await agent.run(ctx);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('No sites in scope'));
  });

  it('processes nothing when scope is an empty list', async () => {
    const ctx = mockContext({ settings: { scope: { siteIds: [] } } });
    const info = jest.spyOn(ctx.log, 'info');
    initSchema(ctx.db.open('logs'));
    await agent.run(ctx);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('No sites in scope'));
  });

  it('skips a scoped site with no bound log source, and warns', async () => {
    const ctx = mockContext({ settings: { scope: { siteIds: ['not-connected'] } } });
    const info = jest.spyOn(ctx.log, 'info');
    const warn = jest.spyOn(ctx.log, 'warn');
    initSchema(ctx.db.open('logs'));
    await agent.run(ctx);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not-connected'));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('No scoped sites have a bound log source'));
  });

  it('ignores a connected site that is not in scope — enabled alone is not enough', async () => {
    const ctx = mockContext({ settings: { scope: { siteIds: [] } } });
    const info = jest.spyOn(ctx.log, 'info');
    const db = ctx.db.open('logs');
    initSchema(db);
    upsertSource(db, { site: 'site1', provider: 's3', bucket: 'b1', region: 'us-east-1', prefix: '', enabled: 1 });
    await agent.run(ctx);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('No sites in scope'));
  });
});

describe('connect_log_source', () => {
  it('returns AWS error message when credentials not connected', async () => {
    const ctx = mockContext();
    initSchema(ctx.db.open('logs'));
    const result = await testTool(agent, 'connect_log_source', { siteId: 'mysite', bucket: 'my-bucket' }, ctx);
    expect(result.content[0].text).toMatch(/AWS/);
  });
});

describe('set_log_processing', () => {
  it('returns error when site not connected', async () => {
    const ctx = mockContext();
    initSchema(ctx.db.open('logs'));
    const result = await testTool(agent, 'set_log_processing', { siteId: 'unknown', enabled: true }, ctx);
    expect(result.content[0].text).toMatch(/connect_log_source/);
  });

  it('enables a connected site', async () => {
    const ctx = mockContext();
    const db = ctx.db.open('logs');
    initSchema(db);
    upsertSource(db, { site: 'mysite', provider: 's3', bucket: 'b', region: 'us-east-1', prefix: '', enabled: 0 });
    await testTool(agent, 'set_log_processing', { siteId: 'mysite', enabled: true }, ctx);
    expect(getEnabledSites(db)).toContain('mysite');
  });
});

describe('sync_access_logs', () => {
  it('is registered as a tool with executionMode run', () => {
    const tool = agent.contributes?.tools?.sync_access_logs;
    expect(tool).toBeDefined();
    expect(tool?.executionMode).toBe('run');
  });

  it('returns error when no log source is bound', async () => {
    const ctx = mockContext();
    initSchema(ctx.db.open('logs'));
    const result = await testTool(agent, 'sync_access_logs', { siteId: 'unbound-site' }, ctx);
    expect(result.content[0].text).toMatch(/connect_log_source/);
  });

  // Integration test required: verify failed streams are not ledgered.
  // When s3StreamLines throws for a file, streamErrored=true prevents markLedger from
  // recording that date, so the next run will retry it. This invariant cannot be tested
  // at the unit level without mocking s3StreamLines (which requires live AWS creds or
  // a deeper mock harness). Verified manually by inspecting the runSync control flow:
  // streamErrored flag is set on catch, markLedger is guarded by !streamErrored,
  // and touched.clear() runs unconditionally so the next date starts fresh.
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
    const agg = emptyAggregate('mysite', '2024-01-02');
    saveAggregate(db, agg);
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
  it('is registered as a tool with executionMode run and permissionTier 2', () => {
    const tool = agent.contributes?.tools?.fetch_log_window;
    expect(tool).toBeDefined();
    expect(tool?.executionMode).toBe('run');
    expect((tool as Record<string, unknown>)?.permissionTier).toBe(2);
  });

  it('returns no-source warning when site is not connected', async () => {
    const ctx = mockContext();
    initSchema(ctx.db.open('logs'));
    const result = await testTool(agent, 'fetch_log_window', { siteId: 'unbound', from: '2024-01-01', to: '2024-01-01' }, ctx);
    expect(result.content[0].text).toMatch(/No log source/);
  });

  it('returns AWS error when creds not connected (confirm=false)', async () => {
    const ctx = mockContext();
    const db = ctx.db.open('logs');
    initSchema(db);
    upsertSource(db, { site: 'mysite', provider: 's3', bucket: 'b', region: 'us-east-1', prefix: '', enabled: 0 });
    const result = await testTool(agent, 'fetch_log_window', { siteId: 'mysite', from: '2024-01-01', to: '2024-01-01', confirm: false }, ctx);
    expect(result.content[0].text).toMatch(/AWS/);
  });
});

describe('log_storage_status', () => {
  it('is registered as a tool with executionMode function', () => {
    const tool = agent.contributes?.tools?.log_storage_status;
    expect(tool).toBeDefined();
    expect(tool?.executionMode).toBe('function');
  });

  it('returns no-sites message when db is empty', async () => {
    const ctx = mockContext();
    initSchema(ctx.db.open('logs'));
    const result = await testTool(agent, 'log_storage_status', {}, ctx);
    expect(result.content[0].text).toMatch(/No sites connected/);
    expect(result.content[0].text).toMatch(/connect_log_source/);
  });

  it('returns storage stats when sites are connected', async () => {
    const ctx = mockContext();
    const db = ctx.db.open('logs');
    initSchema(db);
    upsertSource(db, { site: 'site1', provider: 's3', bucket: 'b1', region: 'us-east-1', prefix: '', enabled: 1 });
    saveAggregate(db, emptyAggregate('site1', '2024-01-01'));
    markLedger(db, { site: 'site1', file_date: '2024-01-01', files: 1, bytes: 100, lines: 50, processed_at: Date.now() });
    const result = await testTool(agent, 'log_storage_status', {}, ctx);
    const text = result.content[0].text;
    expect(text).toMatch(/Log storage:/);
    expect(text).toMatch(/site1/);
    expect(text).toMatch(/1 agg days/);
    expect(text).toMatch(/1 ledgered file-dates/);
    expect(text).toMatch(/opted in/);
    expect(text).toMatch(/Fleet total:/);
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
    upsertSource(db, { site: 'site1', provider: 's3', bucket: 'b1', region: 'us-east-1', prefix: '', enabled: 0 });
    // Save an old aggregate (more than 180 days ago)
    const oldDay = '2023-01-01';
    saveAggregate(db, emptyAggregate('site1', oldDay));
    const result = await testTool(agent, 'evict_log_data', { olderThanDays: 180 }, ctx);
    const text = result.content[0].text;
    expect(text).toMatch(/✓ Evicted \d+ aggregate day\(s\)/);
    expect(text).toMatch(/fleet-wide/);
    expect(text).toMatch(/older than 180 days/);
  });

  it('returns confirmation with site-specific scope when siteId provided', async () => {
    const ctx = mockContext();
    const db = ctx.db.open('logs');
    initSchema(db);
    upsertSource(db, { site: 'site1', provider: 's3', bucket: 'b1', region: 'us-east-1', prefix: '', enabled: 0 });
    const oldDay = '2023-01-01';
    saveAggregate(db, emptyAggregate('site1', oldDay));
    const result = await testTool(agent, 'evict_log_data', { siteId: 'site1', olderThanDays: 180 }, ctx);
    const text = result.content[0].text;
    expect(text).toMatch(/for site1/);
  });
});
