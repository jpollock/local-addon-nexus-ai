/**
 * Unit tests for Tier 3 destructive operations — token flows and extra guards.
 *
 * Tier 3 tools all share the same pattern:
 *   1. First call (no _confirmationToken): fetch context, show warning, ask for token
 *   2. Second call (with _confirmationToken): validate inputs, execute destructive action
 *
 * These tests exercise every step of those flows including edge cases.
 */
import { deleteInstallHandler } from '../../../src/main/mcp/modules/wpe/delete-install';
import { deleteSiteHandler } from '../../../src/main/mcp/modules/wpe/delete-site';
import { promoteEnvironmentHandler } from '../../../src/main/mcp/modules/wpe/promote-environment';
import { deleteAccountUserHandler } from '../../../src/main/mcp/modules/wpe/delete-account-user';
import { deleteDomainHandler } from '../../../src/main/mcp/modules/wpe/delete-domain';
import { deleteSshKeyHandler } from '../../../src/main/mcp/modules/wpe/delete-ssh-key';

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

// ============================================================
// wpe_delete_install — complete Tier 3 flow
// ============================================================

describe('wpe_delete_install — Tier 3 flow', () => {
  it('without token: returns pre-confirmation with install details', async () => {
    const recentBackup = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString();
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ name: 'mysite', environment: 'staging', cname: 'mysite.wpengine.com' })
      .mockResolvedValueOnce({ results: [{ created_at: recentBackup }] });

    const result = await deleteInstallHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('⚠️ Confirm Deletion of Install');
    expect(text).toContain('**Name:** mysite');
    expect(text).toContain('**Environment:** staging');
    expect(text).toContain('confirm_install_name: "mysite"');
    expect(text).toContain('_confirmationToken: "confirm"');
  });

  it('without token, no recent backup: includes backup warning in pre-confirmation', async () => {
    // Backup is 15 days old
    const oldBackup = new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString();
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ name: 'mysite', environment: 'staging', cname: 'mysite.wpengine.com' })
      .mockResolvedValueOnce({ results: [{ created_at: oldBackup }] });

    const result = await deleteInstallHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('⚠️ **No recent backup**');
    expect(text).toContain('wpe_create_backup');
    expect(text).toContain('15 days ago');
  });

  it('without token, zero backups: includes no-backup warning', async () => {
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ name: 'mysite', environment: 'staging', cname: 'mysite.wpengine.com' })
      .mockResolvedValueOnce({ results: [] });

    const result = await deleteInstallHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('⚠️ **No backup found**');
  });

  it('with token but no confirm_install_name: returns error', async () => {
    const result = await deleteInstallHandler.execute(
      { install_id: 'inst-1', _confirmationToken: 'confirm' },
      makeMockServices({}),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('confirm_install_name');
  });

  it('with token and wrong confirm_install_name: returns mismatch error', async () => {
    const mockCapiDirect = jest.fn().mockResolvedValueOnce({ name: 'mysite', environment: 'staging' });
    const result = await deleteInstallHandler.execute(
      { install_id: 'inst-1', confirm_install_name: 'wrong-name', _confirmationToken: 'confirm' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain('mismatch');
    expect(text).toContain('"wrong-name"');
    expect(text).toContain('"mysite"');
  });

  it('with token and correct confirm_install_name: proceeds with DELETE and returns success', async () => {
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ name: 'mysite', environment: 'staging' }) // name-verify fetch
      .mockResolvedValueOnce({ name: 'mysite', environment: 'staging' }) // env re-check fetch
      .mockResolvedValueOnce({}); // DELETE response

    const result = await deleteInstallHandler.execute(
      { install_id: 'inst-1', confirm_install_name: 'mysite', _confirmationToken: 'confirm' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('permanently deleted');
    expect(text).toContain('"mysite"');
    // Verify DELETE was called with the right path
    expect(mockCapiDirect).toHaveBeenCalledWith('/installs/inst-1', 'DELETE');
  });
});

// ============================================================
// wpe_delete_site — complete Tier 3 flow
// ============================================================

describe('wpe_delete_site — Tier 3 flow', () => {
  it('without token: returns pre-confirmation listing all installs', async () => {
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ id: 'site-1', name: 'My Store' })
      .mockResolvedValueOnce({ results: [{ id: 'i1', environment: 'staging' }, { id: 'i2', environment: 'development' }] });

    const result = await deleteSiteHandler.execute(
      { site_id: 'site-1' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('⚠️ Confirm Deletion of Site');
    expect(text).toContain('**Name:** My Store');
    expect(text).toContain('2 install(s)');
    expect(text).toContain('production, staging, development');
    expect(text).toContain('confirm_site_name: "My Store"');
    expect(text).toContain('_confirmationToken: "confirm"');
  });

  it('with token and correct confirm_site_name: calls DELETE and returns success', async () => {
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ id: 'site-1', name: 'My Store' })
      .mockResolvedValueOnce({}); // DELETE response

    const result = await deleteSiteHandler.execute(
      { site_id: 'site-1', confirm_site_name: 'My Store', _confirmationToken: 'confirm' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('permanently deleted');
    expect(text).toContain('My Store');
    expect(mockCapiDirect).toHaveBeenCalledWith('/sites/site-1', 'DELETE');
  });

  it('with token but no confirm_site_name: returns error', async () => {
    const result = await deleteSiteHandler.execute(
      { site_id: 'site-1', _confirmationToken: 'confirm' },
      makeMockServices({}),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('confirm_site_name');
  });

  it('with token and wrong confirm_site_name: returns mismatch error', async () => {
    const mockCapiDirect = jest.fn().mockResolvedValueOnce({ id: 'site-1', name: 'My Store' });
    const result = await deleteSiteHandler.execute(
      { site_id: 'site-1', confirm_site_name: 'Wrong Store', _confirmationToken: 'confirm' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('mismatch');
    expect(getText(result)).toContain('My Store');
  });
});

// ============================================================
// wpe_promote_environment — complete Tier 3 flow
// ============================================================

describe('wpe_promote_environment — Tier 3 flow', () => {
  // Note: wpe_promote_environment runs directly via McpSafetyWrapper's Tier 3 token flow.
  // The handler itself always executes the copy — pre-confirmation is handled at the MCP layer.

  it('fetches both installs and runs copy (staging → staging)', async () => {
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ id: 'inst-src', name: 'staging-site', environment: 'staging' })
      .mockResolvedValueOnce({ id: 'inst-dst', name: 'prod-site', environment: 'staging' })
      .mockResolvedValueOnce({ id: 'op-abc', status: 'pending' }); // POST /install_copy

    const result = await promoteEnvironmentHandler.execute(
      { source_install_id: 'inst-src', destination_install_id: 'inst-dst' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Environment Copy Started');
    expect(text).toContain('op-abc');
  });

  it('blocks copy to production destination when production is not allowed', async () => {
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ id: 'inst-src', name: 'staging-site', environment: 'staging' })
      .mockResolvedValueOnce({ id: 'inst-dst', name: 'prod-site', environment: 'production' });

    const result = await promoteEnvironmentHandler.execute(
      { source_install_id: 'inst-src', destination_install_id: 'inst-dst' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Cannot promote to destination install');
  });

  it('returns CAPI error when source install fetch fails', async () => {
    const mockCapiDirect = jest.fn()
      .mockRejectedValueOnce(new Error('response returned an error code 401'));

    const result = await promoteEnvironmentHandler.execute(
      { source_install_id: 'inst-src', destination_install_id: 'inst-dst' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });

  it('with token: calls POST /install_copy and returns success', async () => {
    const mockCapiDirect = jest.fn()
      .mockResolvedValueOnce({ id: 'inst-src', environment: 'staging' }) // src install fetch
      .mockResolvedValueOnce({ id: 'inst-dst', environment: 'staging' }) // dst install fetch (env check)
      .mockResolvedValueOnce({ id: 'op-xyz', status: 'pending' }); // POST /install_copy

    const result = await promoteEnvironmentHandler.execute(
      {
        source_install_id: 'inst-src',
        destination_install_id: 'inst-dst',
        include_database: true,
        _confirmationToken: 'confirm',
      },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Environment Copy Started');
    expect(text).toContain('op-xyz');
    expect(mockCapiDirect).toHaveBeenCalledWith('/install_copy', 'POST', {
      source_environment_id: 'inst-src',
      destination_environment_id: 'inst-dst',
      custom_options: { include_files: true, include_db: true },
    });
  });

  it('with token: returns auth error on 401 from POST', async () => {
    const mockCapiDirect = jest.fn().mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await promoteEnvironmentHandler.execute(
      { source_install_id: 'src', destination_install_id: 'dst', _confirmationToken: 'confirm' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });

});

// ============================================================
// wpe_delete_account_user — complete Tier 3 flow
// ============================================================

describe('wpe_delete_account_user — Tier 3 flow', () => {
  it('without token: fetches user, shows name and email in confirmation', async () => {
    const mockCapiDirect = jest.fn().mockResolvedValueOnce({
      id: 'user-abc',
      first_name: 'Jane',
      last_name: 'Smith',
      user: { email: 'jane@example.com' },
      roles: ['full'],
    });

    const result = await deleteAccountUserHandler.execute(
      { account_id: 'acct-123', user_id: 'user-abc' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('⚠️ Confirm User Removal');
    expect(text).toContain('**Name:** Jane Smith');
    expect(text).toContain('**Email:** jane@example.com');
    expect(text).toContain('**Roles:** full');
    expect(text).toContain('**User ID:** user-abc');
    expect(text).toContain('_confirmationToken: "confirm"');
  });

  it('with token: calls DELETE on the correct endpoint and returns success', async () => {
    const mockCapiDirect = jest.fn().mockResolvedValueOnce({});

    const result = await deleteAccountUserHandler.execute(
      { account_id: 'acct-123', user_id: 'user-abc', _confirmationToken: 'confirm' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('removed');
    expect(text).toContain('user-abc');
    expect(mockCapiDirect).toHaveBeenCalledWith(
      '/accounts/acct-123/account_users/user-abc',
      'DELETE',
    );
  });

  it('without token: returns auth error when user fetch returns 401', async () => {
    const mockCapiDirect = jest.fn().mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await deleteAccountUserHandler.execute(
      { account_id: 'acct-123', user_id: 'user-abc' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });

  it('with token: returns auth error when DELETE returns 401', async () => {
    const mockCapiDirect = jest.fn().mockRejectedValueOnce(new Error('401'));
    const result = await deleteAccountUserHandler.execute(
      { account_id: 'acct-123', user_id: 'user-abc', _confirmationToken: 'confirm' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// ============================================================
// wpe_delete_domain — Tier 3: primary domain extra guard
// ============================================================

describe('wpe_delete_domain — Tier 3 primary domain guard', () => {
  it('pre-confirmation where domain is primary: shows primary domain warning in big bold', async () => {
    const mockCapiDirect = jest.fn().mockResolvedValueOnce({
      id: 'd1',
      name: 'example.com',
      primary: true,
    });
    const result = await deleteDomainHandler.execute(
      { install_id: 'inst-1', domain_id: 'd1' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('PRIMARY domain');
    expect(text).toContain('break the primary site URL');
  });

  it('pre-confirmation where domain is NOT primary: no primary warning', async () => {
    const mockCapiDirect = jest.fn().mockResolvedValueOnce({
      id: 'd2',
      name: 'www.example.com',
      primary: false,
    });
    const result = await deleteDomainHandler.execute(
      { install_id: 'inst-1', domain_id: 'd2' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).not.toContain('PRIMARY domain');
    expect(text).toContain('Confirm Deletion');
  });

  it('confirmed: issues DELETE to the correct endpoint', async () => {
    const mockCapiDirect = jest.fn().mockResolvedValueOnce({});
    const result = await deleteDomainHandler.execute(
      { install_id: 'inst-1', domain_id: 'd1', _confirmationToken: 'confirm' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('removed');
    expect(mockCapiDirect).toHaveBeenCalledWith('/installs/inst-1/domains/d1', 'DELETE');
  });
});

// ============================================================
// wpe_delete_ssh_key — Tier 3 flow
// ============================================================

describe('wpe_delete_ssh_key — Tier 3 flow', () => {
  it('without token: shows key label in pre-confirmation', async () => {
    const mockCapiDirect = jest.fn().mockResolvedValueOnce({
      results: [
        { id: 'key-1', label: 'Production Deploy Key', fingerprint: 'aa:bb:cc' },
        { id: 'key-2', label: 'Laptop', fingerprint: 'dd:ee:ff' },
      ],
    });
    const result = await deleteSshKeyHandler.execute(
      { ssh_key_id: 'key-1' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('⚠️ Confirm Deletion');
    expect(text).toContain('Production Deploy Key');
    expect(text).toContain('key-1');
    expect(text).toContain('SSH/SFTP access');
    expect(text).toContain('_confirmationToken: "confirm"');
  });

  it('without token: shows "Unknown" label when key not in list', async () => {
    const mockCapiDirect = jest.fn().mockResolvedValueOnce({
      results: [{ id: 'key-other', label: 'Other Key' }],
    });
    const result = await deleteSshKeyHandler.execute(
      { ssh_key_id: 'key-missing' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('Unknown');
    expect(getText(result)).toContain('key-missing');
  });

  it('with token: calls DELETE and returns success', async () => {
    const mockCapiDirect = jest.fn().mockResolvedValueOnce({});
    const result = await deleteSshKeyHandler.execute(
      { ssh_key_id: 'key-1', _confirmationToken: 'confirm' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('removed');
    expect(mockCapiDirect).toHaveBeenCalledWith('/ssh_keys/key-1', 'DELETE');
  });

  it('with token: returns auth error on 401', async () => {
    const mockCapiDirect = jest.fn().mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await deleteSshKeyHandler.execute(
      { ssh_key_id: 'key-1', _confirmationToken: 'confirm' },
      makeMockServices({ capiDirect: mockCapiDirect }),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});
