import { TestHarness } from './helpers/harness';
import { createSiteData } from './helpers/fixtures';
import { parseConfirmation, expectToolError, expectToolSuccess } from './helpers/assertions';

describe('Tier 3 Safety Flow (end-to-end)', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    const siteData = createSiteData({
      'site-abc123': {
        id: 'site-abc123',
        name: 'Dev Blog',
        path: '/tmp/nexus-test/dev-blog',
        domain: 'dev-blog.local',
      },
    });

    harness = await TestHarness.create({
      skipServer: true,
      siteData,
      withLocalServices: true,
    });
  }, 60000);

  afterAll(async () => {
    await harness.cleanup();
  });

  test('Tier 3 tool returns confirmation prompt on first call', async () => {
    const result = await harness.callTool('local_delete_site', {
      site: 'Dev Blog',
    });
    const parsed = parseConfirmation(result);
    expect(parsed.requiresConfirmation).toBe(true);
    expect(parsed.tier).toBe(3);
    expect(parsed.confirmationToken).toBeTruthy();
    expect(parsed.action).toContain('permanently delete');
  });

  test('valid confirmation token executes the tool', async () => {
    // Step 1: Get token
    const r1 = await harness.callTool('local_delete_site', {
      site: 'Dev Blog',
    });
    const token = parseConfirmation(r1).confirmationToken;

    // Step 2: Retry with token
    const r2 = await harness.callTool('local_delete_site', {
      site: 'Dev Blog',
      _confirmationToken: token,
    });
    expectToolSuccess(r2);
  });

  test('invalid confirmation token returns error', async () => {
    const result = await harness.callTool('local_delete_site', {
      site: 'Dev Blog',
      _confirmationToken: 'totally-fake-token',
    });
    expectToolError(result, 'Invalid or expired confirmation token.');
  });

  test('confirmation token for different tool returns error', async () => {
    // Get token for local_delete_site
    const r1 = await harness.callTool('local_delete_site', { site: 'Dev Blog' });
    const token = parseConfirmation(r1).confirmationToken;

    // Try to use it for local_wpe_push
    const r2 = await harness.callTool('local_wpe_push', {
      site: 'Dev Blog',
      _confirmationToken: token,
    });
    expectToolError(r2, 'Confirmation token was issued for a different tool.');
  });

  test('changed parameters after confirmation returns error', async () => {
    // Get token with site: 'Dev Blog'
    const r1 = await harness.callTool('local_delete_site', { site: 'Dev Blog' });
    const token = parseConfirmation(r1).confirmationToken;

    // Retry with different site name
    const r2 = await harness.callTool('local_delete_site', {
      site: 'Other Site',
      _confirmationToken: token,
    });
    expectToolError(r2, 'Parameters changed since confirmation was requested.');
  });

  test('confirmation token is single-use', async () => {
    const r1 = await harness.callTool('local_delete_site', { site: 'Dev Blog' });
    const token = parseConfirmation(r1).confirmationToken;

    // First use — succeeds
    const r2 = await harness.callTool('local_delete_site', {
      site: 'Dev Blog',
      _confirmationToken: token,
    });
    expectToolSuccess(r2);

    // Second use — token consumed, should fail
    const r3 = await harness.callTool('local_delete_site', {
      site: 'Dev Blog',
      _confirmationToken: token,
    });
    expectToolError(r3, 'Invalid or expired confirmation token.');
  });

  test('Tier 1 tool executes immediately (no confirmation)', async () => {
    const result = await harness.callTool('local_list_sites', {});
    expectToolSuccess(result);
    expect(result.content[0].text).not.toContain('requiresConfirmation');
  });

  test('Tier 2 tool executes immediately but is audit-logged', async () => {
    const result = await harness.callTool('local_start_site', { site: 'Dev Blog' });
    expectToolSuccess(result);

    const entries = harness.services.auditLogger!.getEntries();
    expect(entries.length).toBeGreaterThan(0);
    const last = entries[entries.length - 1];
    expect(last.toolName).toBe('local_start_site');
    expect(last.result).toBe('success');
  });
});
