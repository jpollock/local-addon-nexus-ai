import { maybeUpsertExternalSite } from '../../../src/main/mcp/tool-registry';

function fakeStorage() {
  const data = new Map<string, unknown>();
  return { get: (k: string) => data.get(k) ?? null, set: (k: string, v: unknown) => { data.set(k, v); } };
}

function fakeGraph() {
  const rows: any[] = [];
  return { rows, upsertSite: jest.fn(async (s: any) => { rows.push(s); }) };
}

describe('maybeUpsertExternalSite', () => {
  it('does nothing when there is no ssh_target', async () => {
    const g = fakeGraph();
    await maybeUpsertExternalSite({ site: 'mysite' }, true, fakeStorage() as any, g as any);
    expect(g.upsertSite).not.toHaveBeenCalled();
  });

  it('does nothing when the call failed', async () => {
    // Only a working host earns a fleet entry — a typo'd alias must not
    // litter the fleet with hosts that were never reachable.
    const g = fakeGraph();
    await maybeUpsertExternalSite(
      { ssh_target: 'ssh:acme@production' }, false, fakeStorage() as any, g as any);
    expect(g.upsertSite).not.toHaveBeenCalled();
  });

  it('upserts a site row with source and host set to external', async () => {
    const g = fakeGraph();
    await maybeUpsertExternalSite(
      { ssh_target: 'ssh:acme@production', wp_path: '/var/www/html' },
      true, fakeStorage() as any, g as any);
    expect(g.upsertSite).toHaveBeenCalledTimes(1);
    const row = g.rows[0];
    expect(row.id).toBe('ssh:acme');
    expect(row.name).toBe('acme');
    expect(row.source).toBe('external');
    expect(row.host).toBe('external');
    expect(row.environment).toBe('production');
    expect(row.is_active).toBe(true);
  });

  it('stores the connection profile alongside the row', async () => {
    const s = fakeStorage() as any;
    await maybeUpsertExternalSite(
      { ssh_target: 'ssh:acme@staging', wp_path: '/srv/wp' }, true, s, fakeGraph() as any);
    const { getExternalProfile } = require('../../../src/main/external/externalSiteStore');
    const p = getExternalProfile(s, 'acme');
    expect(p.wpPath).toBe('/srv/wp');
    expect(p.environment).toBe('staging');
  });

  it('never throws on a malformed target — persistence must not break a working command', async () => {
    const g = fakeGraph();
    await expect(
      maybeUpsertExternalSite({ ssh_target: 'not-a-valid-target' }, true, fakeStorage() as any, g as any),
    ).resolves.toBeUndefined();
    expect(g.upsertSite).not.toHaveBeenCalled();
  });

  it('never relabels a registered host from the target suffix', async () => {
    // `nexus wp core version ssh:prod-box@development` is a permitted read on
    // every environment, so it succeeds — and used to permanently relabel the
    // host as development in BOTH the profile and the sites row.
    const s = fakeStorage() as any;
    const g = fakeGraph();
    const { getExternalProfile, upsertExternalProfile } =
      require('../../../src/main/external/externalSiteStore');
    upsertExternalProfile(s, {
      alias: 'prod-box', environment: 'production', firstSeenAt: 1, lastSeenAt: 1,
    }, 'registration');

    await maybeUpsertExternalSite(
      { ssh_target: 'ssh:prod-box@development' }, true, s, g as any);

    expect(getExternalProfile(s, 'prod-box').environment).toBe('production');
    expect(g.rows[0].environment).toBe('production');
  });

  it('does not upsert when succeeded=false even with valid ssh_target', async () => {
    // Regression test for Finding 1: a handler returning { isError: true } must not
    // write a fleet row. Previously the hardcoded `true` in tool-registry.ts:177 did.
    const g = fakeGraph();
    await maybeUpsertExternalSite(
      { ssh_target: 'ssh:acme@production', wp_path: '/var/www/html' },
      false,
      fakeStorage() as any,
      g as any
    );
    expect(g.upsertSite).not.toHaveBeenCalled();
  });
});
