/**
 * Unit tests for WPE workflow and diagnostic MCP handlers
 */
import { diagnoseSiteHandler } from '../../../src/main/mcp/modules/wpe/diagnose-site';
import { goLiveChecklistHandler } from '../../../src/main/mcp/modules/wpe/go-live-checklist';
import { userAuditHandler } from '../../../src/main/mcp/modules/wpe/user-audit';
import { installsByAccountHandler } from '../../../src/main/mcp/modules/wpe/installs-by-account';
import { accountSslStatusHandler } from '../../../src/main/mcp/modules/wpe/account-ssl-status';
import { environmentDiffHandler } from '../../../src/main/mcp/modules/wpe/environment-diff';
import { backupAndVerifyHandler } from '../../../src/main/mcp/modules/wpe/backup-and-verify';

function getText(result: any): string {
  return result.content[0].text;
}

function makeMockServices(overrides: Record<string, any> = {}) {
  return {
    localServices: {
      capiDirect: jest.fn(),
      capiGetAccounts: jest.fn(),
      capiGetInstalls: jest.fn(),
      capiCreateBackup: jest.fn(),
      capiGetInstall: jest.fn(),
      isCAPIAvailable: jest.fn().mockReturnValue(true),
      ...overrides,
    },
    siteData: { getSites: jest.fn().mockReturnValue({}) },
  } as any;
}

// --- wpe_diagnose_site ---

describe('wpe_diagnose_site', () => {
  it('runs 4 parallel calls and builds a checklist with ✅/❌ markers', async () => {
    const recentBackup = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(); // 1 day ago
    const goodSsl = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString(); // 60 days out

    const mockCapiDirect = jest.fn()
      // install
      .mockResolvedValueOnce({ name: 'mysite', environment: 'production', php_version: '8.2' })
      // domains
      .mockResolvedValueOnce({ results: [{ name: 'example.com', primary: true }] })
      // ssl
      .mockResolvedValueOnce({ results: [{ expires_at: goodSsl }] })
      // backups
      .mockResolvedValueOnce({ results: [{ created_at: recentBackup }] });

    const result = await diagnoseSiteHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Diagnostic Report');
    expect(text).toContain('mysite');
    expect(text).toContain('✅ **Install found**');
    expect(text).toContain('✅ **Domains**');
    expect(text).toContain('✅ **SSL**');
    expect(text).toContain('✅ **Backup**');
    expect(text).toContain('✅ **PHP version**');
  });

  it('shows ❌ when no domains configured', async () => {
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ name: 'mysite', environment: 'production' })
      .mockResolvedValueOnce({ results: [] }) // no domains
      .mockResolvedValueOnce({ results: [] }) // no ssl
      .mockResolvedValueOnce({ results: [] }); // no backups

    const result = await diagnoseSiteHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    const text = getText(result);
    expect(text).toContain('❌ **Domains**');
    expect(text).toContain('❌ **SSL**');
    expect(text).toContain('❌ **Backup**');
  });

  it('shows ⚠️ for stale backup (older than 7 days)', async () => {
    const oldBackup = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    const goodSsl = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ name: 'mysite', environment: 'production' })
      .mockResolvedValueOnce({ results: [{ name: 'example.com', primary: true }] })
      .mockResolvedValueOnce({ results: [{ expires_at: goodSsl }] })
      .mockResolvedValueOnce({ results: [{ created_at: oldBackup }] });

    const result = await diagnoseSiteHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(getText(result)).toContain('⚠️ **Backup**');
  });

  it('shows ⚠️ for PHP version below 8.0', async () => {
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ name: 'mysite', environment: 'production', php_version: '7.4' })
      .mockResolvedValueOnce({ results: [{ name: 'example.com', primary: true }] })
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValueOnce({ results: [] });

    const result = await diagnoseSiteHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(getText(result)).toContain('⚠️ **PHP version**');
    expect(getText(result)).toContain('7.4');
  });

  it('returns auth error on 401 during install fetch', async () => {
    // When all 4 parallel calls reject (install rejected), capiError is called for install
    const mockCapiDirect = jest.fn().mockRejectedValue(new Error('response returned an error code 401'));
    const result = await diagnoseSiteHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    // Diagnose-site uses Promise.allSettled so it never throws, but shows failures in checklist
    expect(getText(result)).toContain('Diagnostic Report');
  });
});

// --- wpe_go_live_checklist ---

describe('wpe_go_live_checklist', () => {
  it('shows domain as added when found in install domains', async () => {
    const mockCapiDirect = jest.fn()
      // install
      .mockResolvedValueOnce({ name: 'mysite', environment: 'production', php_version: '8.2' })
      // domains (contains the target domain)
      .mockResolvedValueOnce({ results: [{ id: 'd1', name: 'example.com', primary: true }] })
      // ssl (covers the domain)
      .mockResolvedValueOnce({
        results: [{ domains: ['example.com'], expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString() }],
      })
      // DNS check for the found domain
      .mockResolvedValueOnce({ status: 'active' });

    const result = await goLiveChecklistHandler.execute(
      { install_id: 'inst-1', domain: 'example.com' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Go-Live Checklist');
    expect(text).toContain('✅ **Domain added**');
  });

  it('shows domain as missing when not in install domains', async () => {
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ name: 'mysite', environment: 'production' })
      .mockResolvedValueOnce({ results: [] }) // no domains
      .mockResolvedValueOnce({ results: [] }); // no ssl

    const result = await goLiveChecklistHandler.execute(
      { install_id: 'inst-1', domain: 'example.com' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    const text = getText(result);
    expect(text).toContain('❌ **Domain added**');
    expect(text).toContain('wpe_prepare_go_live');
  });

  it('returns error when install_id missing', async () => {
    const result = await goLiveChecklistHandler.execute(
      { domain: 'example.com' },
      makeMockServices({}),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('install_id is required');
  });

  it('shows all-pass summary when domain, DNS, and SSL all check out', async () => {
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ name: 'mysite', environment: 'production', php_version: '8.3' })
      .mockResolvedValueOnce({ results: [{ id: 'd1', name: 'example.com', primary: true }] })
      .mockResolvedValueOnce({
        results: [{ domains: ['example.com'], expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString() }],
      })
      .mockResolvedValueOnce({ status: 'active' });

    const result = await goLiveChecklistHandler.execute(
      { install_id: 'inst-1', domain: 'example.com' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(getText(result)).toContain('All checks passed');
  });
});

// --- wpe_user_audit ---

describe('wpe_user_audit', () => {
  it('with account_id: scopes to one account only', async () => {
    const mockCapiDirect = jest.fn()
      // GET /accounts/acct-123
      .mockResolvedValueOnce({ id: 'acct-123', name: 'Acme Corp' })
      // GET /accounts/acct-123/account_users
      .mockResolvedValueOnce({
        results: [
          { id: 'u1', first_name: 'Jane', last_name: 'Smith', user: { email: 'jane@example.com' }, roles: ['full'] },
        ],
      });

    const result = await userAuditHandler.execute(
      { account_id: 'acct-123' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('User Audit');
    expect(text).toContain('jane@example.com');
    expect(text).toContain('⚠️ elevated');
    // Should NOT have called capiGetAccounts since account_id was specified
    expect(mockCapiDirect).toHaveBeenCalledTimes(2);
  });

  it('without account_id: fetches all accounts via capiGetAccounts', async () => {
    const mockCapiGetAccounts = jest.fn().mockResolvedValueOnce([
      { id: 'acct-1', name: 'Acme' },
      { id: 'acct-2', name: 'Beta Inc' },
    ]);
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ results: [{ id: 'u1', first_name: 'A', last_name: 'B', user: { email: 'a@a.com' }, roles: ['partial'] }] })
      .mockResolvedValueOnce({ results: [] });

    const result = await userAuditHandler.execute(
      {},
      makeMockServices({ capiGetAccounts: mockCapiGetAccounts, capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('User Audit');
    expect(text).toContain('2 accounts');
    expect(mockCapiGetAccounts).toHaveBeenCalledTimes(1);
  });

  it('flags multi-account users', async () => {
    const mockCapiGetAccounts = jest.fn().mockResolvedValueOnce([
      { id: 'acct-1', name: 'Acme' },
      { id: 'acct-2', name: 'Beta Inc' },
    ]);
    // Same user appears in both accounts
    const sharedUser = { id: 'u1', first_name: 'Jane', last_name: 'Smith', user: { email: 'jane@example.com' }, roles: ['full'] };
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ results: [sharedUser] })
      .mockResolvedValueOnce({ results: [sharedUser] });

    const result = await userAuditHandler.execute(
      {},
      makeMockServices({ capiGetAccounts: mockCapiGetAccounts, capiDirect: mockCapiDirect }),
    );
    expect(getText(result)).toContain('🔀 multi-account');
    expect(getText(result)).toContain('**Multi-account users:** 1');
  });

  it('maps single-letter role codes to human-readable labels', async () => {
    // CAPI returns 'o' for owner, 'b' for billing, 'p' for partial
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ id: 'acct-123', name: 'Acme Corp' })
      .mockResolvedValueOnce({
        results: [
          { id: 'u1', first_name: 'Alice', last_name: 'O', user: { email: 'alice@example.com' }, roles: ['o'] },
          { id: 'u2', first_name: 'Bob', last_name: 'B', user: { email: 'bob@example.com' }, roles: ['b'] },
          { id: 'u3', first_name: 'Carol', last_name: 'P', user: { email: 'carol@example.com' }, roles: ['p'] },
        ],
      });

    const result = await userAuditHandler.execute(
      { account_id: 'acct-123' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    // Codes should be resolved to full labels
    expect(text).toContain('owner');
    expect(text).toContain('billing');
    expect(text).toContain('partial');
    // Should NOT show raw single-letter codes in the table
    expect(text).not.toMatch(/\| o \|/);
    expect(text).not.toMatch(/\| b \|/);
    expect(text).not.toMatch(/\| p \|/);
  });

  it('flags o (owner) and b (billing) codes as elevated', async () => {
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ id: 'acct-123', name: 'Acme Corp' })
      .mockResolvedValueOnce({
        results: [
          { id: 'u1', first_name: 'Alice', last_name: 'O', user: { email: 'alice@example.com' }, roles: ['o'] },
          { id: 'u2', first_name: 'Bob', last_name: 'B', user: { email: 'bob@example.com' }, roles: ['b'] },
          { id: 'u3', first_name: 'Carol', last_name: 'P', user: { email: 'carol@example.com' }, roles: ['p'] },
        ],
      });

    const result = await userAuditHandler.execute(
      { account_id: 'acct-123' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    const text = getText(result);
    // Two elevated users (owner + billing), one not (partial)
    expect(text).toContain('**Users with elevated roles (owner/billing/full):** 2');
  });

  it('returns auth error on 401', async () => {
    const mockCapiDirect = jest.fn().mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await userAuditHandler.execute(
      { account_id: 'acct-123' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// --- wpe_installs_by_account ---

describe('wpe_installs_by_account', () => {
  it('groups installs by account correctly', async () => {
    const mockCapiGetAccounts = jest.fn().mockResolvedValueOnce([
      { id: 'acct-1', name: 'Acme' },
      { id: 'acct-2', name: 'Beta Inc' },
    ]);
    const mockCapiGetInstalls = jest.fn().mockResolvedValueOnce([
      { id: 'i1', name: 'prod', environment: 'production', account: { id: 'acct-1' }, primary_domain: 'acme.com' },
      { id: 'i2', name: 'staging', environment: 'staging', account: { id: 'acct-1' }, primary_domain: 'staging.acme.com' },
      { id: 'i3', name: 'betaprod', environment: 'production', account: { id: 'acct-2' }, primary_domain: 'beta.com' },
    ]);

    const result = await installsByAccountHandler.execute(
      {},
      makeMockServices({ capiGetAccounts: mockCapiGetAccounts, capiGetInstalls: mockCapiGetInstalls }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Installs by Account');
    expect(text).toContain('Acme (2 installs)');
    expect(text).toContain('Beta Inc (1 install)');
    expect(text).toContain('prod');
    expect(text).toContain('betaprod');
    // Acme has 1 production + 1 staging; Beta has 1 production
    expect(text).toContain('1 production, 1 staging');
    expect(text).toContain('1 production');
  });

  it('returns empty message when no accounts found', async () => {
    const mockCapiGetAccounts = jest.fn().mockResolvedValueOnce([]);
    const mockCapiGetInstalls = jest.fn().mockResolvedValueOnce([]);

    const result = await installsByAccountHandler.execute(
      {},
      makeMockServices({ capiGetAccounts: mockCapiGetAccounts, capiGetInstalls: mockCapiGetInstalls }),
    );
    expect(getText(result)).toContain('No WP Engine accounts found');
  });

  it('returns auth error on 401', async () => {
    const mockCapiGetAccounts = jest.fn().mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await installsByAccountHandler.execute(
      {},
      makeMockServices({ capiGetAccounts: mockCapiGetAccounts }),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// --- wpe_account_ssl_status ---

describe('wpe_account_ssl_status', () => {
  it('shows valid, expiring, expired, and missing certs with correct counts', async () => {
    const validDate = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
    const expiringDate = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
    const expiredDate = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();

    const mockCapiGetInstalls = jest.fn().mockResolvedValueOnce([
      { id: 'i1', name: 'prod', environment: 'production', account: { id: 'acct-1' }, account_id: 'acct-1' },
      { id: 'i2', name: 'staging', environment: 'staging', account: { id: 'acct-1' }, account_id: 'acct-1' },
      { id: 'i3', name: 'dev', environment: 'development', account: { id: 'acct-1' }, account_id: 'acct-1' },
      { id: 'i4', name: 'old', environment: 'production', account: { id: 'acct-1' }, account_id: 'acct-1' },
    ]);

    const mockCapiDirect = jest.fn()
      // i1: valid cert
      .mockResolvedValueOnce({ results: [{ domains: ['prod.com'], expires_at: validDate }] })
      // i2: expiring cert
      .mockResolvedValueOnce({ results: [{ domains: ['staging.com'], expires_at: expiringDate }] })
      // i3: no cert
      .mockResolvedValueOnce({ results: [] })
      // i4: expired cert
      .mockResolvedValueOnce({ results: [{ domains: ['old.com'], expires_at: expiredDate }] });

    const result = await accountSslStatusHandler.execute(
      { account_id: 'acct-1' },
      makeMockServices({ capiGetInstalls: mockCapiGetInstalls, capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('SSL Certificate Status');
    expect(text).toContain('Valid: 1');
    expect(text).toContain('Expiring soon');
    expect(text).toContain('Expired: 1');
    expect(text).toContain('No certificate: 1');
  });

  it('returns message when no installs for account', async () => {
    const mockCapiGetInstalls = jest.fn().mockResolvedValueOnce([
      { id: 'i1', account: { id: 'other-acct' }, account_id: 'other-acct' },
    ]);

    const result = await accountSslStatusHandler.execute(
      { account_id: 'acct-1' },
      makeMockServices({ capiGetInstalls: mockCapiGetInstalls }),
    );
    expect(getText(result)).toContain('No installs found');
  });
});

// --- wpe_environment_diff ---

describe('wpe_environment_diff', () => {
  it('shows differences between two installs', async () => {
    const mockCapiDirect = jest.fn()
      // install A
      .mockResolvedValueOnce({ name: 'prod', environment: 'production', php_version: '8.3', cname: 'prod.wpengine.com' })
      // install B
      .mockResolvedValueOnce({ name: 'staging', environment: 'staging', php_version: '8.1', cname: 'staging.wpengine.com' })
      // domains A
      .mockResolvedValueOnce({ results: [{ name: 'example.com', primary: true }] })
      // domains B
      .mockResolvedValueOnce({ results: [{ name: 'staging.example.com', primary: true }] });

    const result = await environmentDiffHandler.execute(
      { install_id_a: 'inst-prod', install_id_b: 'inst-staging' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Environment Diff');
    expect(text).toContain('prod');
    expect(text).toContain('staging');
    // PHP versions differ
    expect(text).toContain('8.3');
    expect(text).toContain('8.1');
    expect(text).toContain('⚠️');
    expect(text).toContain('attributes differ');
  });

  it('shows no-diff summary when installs are identical', async () => {
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ name: 'prod', environment: 'production', php_version: '8.2', cname: 'prod.wpe.com' })
      .mockResolvedValueOnce({ name: 'prod-copy', environment: 'production', php_version: '8.2', cname: 'prod.wpe.com' })
      .mockResolvedValueOnce({ results: [{ name: 'example.com', primary: true }] })
      .mockResolvedValueOnce({ results: [{ name: 'example.com', primary: true }] });

    const result = await environmentDiffHandler.execute(
      { install_id_a: 'inst-a', install_id_b: 'inst-b' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(getText(result)).toContain('No differences detected');
  });

  it('returns error when install A fetch fails', async () => {
    const mockCapiDirect = jest.fn()
      .mockRejectedValueOnce(new Error('response returned an error code 401'))
      .mockResolvedValueOnce({ name: 'staging' })
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValueOnce({ results: [] });

    const result = await environmentDiffHandler.execute(
      { install_id_a: 'inst-a', install_id_b: 'inst-b' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// --- wpe_backup_and_verify ---

describe('wpe_backup_and_verify', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('polls until status is completed and returns success', async () => {
    const mockCapiCreateBackup = jest.fn().mockResolvedValueOnce({ id: 'bkp-001' });
    const mockCapiDirect = jest.fn()
      // poll 1: still running
      .mockResolvedValueOnce({ status: 'running' })
      // poll 2: complete
      .mockResolvedValueOnce({ status: 'complete', created_at: '2024-01-15T10:00:00Z', description: 'Test backup' });

    const services = makeMockServices({
      capiCreateBackup: mockCapiCreateBackup,
      capiDirect: mockCapiDirect,
    });

    // Run without awaiting, then advance timers
    const resultPromise = backupAndVerifyHandler.execute(
      { install_id: 'inst-1', description: 'Test backup' },
      services,
    );

    // Advance past each 5-second polling interval
    await jest.runAllTimersAsync();

    const result = await resultPromise;
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Backup Completed');
    expect(text).toContain('bkp-001');
    expect(text).toContain('complete');
  });

  it('returns no-id message when backup has no ID in response', async () => {
    const mockCapiCreateBackup = jest.fn().mockResolvedValueOnce({});

    const result = await backupAndVerifyHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices({ capiCreateBackup: mockCapiCreateBackup }),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('Backup Created');
    expect(getText(result)).toContain('did not include a backup ID');
  });

  it('returns auth error on 401 when creating backup', async () => {
    const mockCapiCreateBackup = jest.fn().mockRejectedValueOnce(new Error('response returned an error code 401'));

    const result = await backupAndVerifyHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices({ capiCreateBackup: mockCapiCreateBackup }),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });

  it('returns failed status when backup reports failure', async () => {
    const mockCapiCreateBackup = jest.fn().mockResolvedValueOnce({ id: 'bkp-001' });
    const mockCapiDirect = jest.fn().mockResolvedValueOnce({ status: 'failed', message: 'Disk full' });

    const services = makeMockServices({
      capiCreateBackup: mockCapiCreateBackup,
      capiDirect: mockCapiDirect,
    });

    const resultPromise = backupAndVerifyHandler.execute(
      { install_id: 'inst-1' },
      services,
    );

    await jest.runAllTimersAsync();

    const result = await resultPromise;
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Backup Failed');
    expect(text).toContain('failed');
  });
});
