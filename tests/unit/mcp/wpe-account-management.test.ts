/**
 * Unit tests for WPE account management MCP handlers
 */
import { getAccountHandler } from '../../../src/main/mcp/modules/wpe/get-account';
import { getAccountLimitsHandler } from '../../../src/main/mcp/modules/wpe/get-account-limits';
import { getAccountUsageSummaryHandler } from '../../../src/main/mcp/modules/wpe/get-account-usage-summary';
import { getAccountUsageInsightsHandler } from '../../../src/main/mcp/modules/wpe/get-account-usage-insights';
import { getAccountUsersHandler } from '../../../src/main/mcp/modules/wpe/get-account-users';
import { getAccountUserHandler } from '../../../src/main/mcp/modules/wpe/get-account-user';
import { createAccountUserHandler } from '../../../src/main/mcp/modules/wpe/create-account-user';
import { updateAccountUserHandler } from '../../../src/main/mcp/modules/wpe/update-account-user';
import { deleteAccountUserHandler } from '../../../src/main/mcp/modules/wpe/delete-account-user';

function getText(result: any): string {
  return result.content[0].text;
}

function makeMockServices(capiDirect: jest.Mock) {
  return {
    localServices: {
      capiDirect,
      capiGetAccounts: jest.fn(),
      capiGetInstalls: jest.fn(),
      capiCreateBackup: jest.fn(),
      isCAPIAvailable: jest.fn().mockReturnValue(true),
    },
    siteData: { getSites: jest.fn().mockReturnValue({}) },
  } as any;
}

describe('wpe_get_account', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('returns formatted account details on success', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      id: 'acct-123',
      name: 'Acme Corp',
      created_at: '2022-03-15T00:00:00Z',
    });
    const result = await getAccountHandler.execute(
      { account_id: 'acct-123' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('WP Engine Account');
    expect(text).toContain('Acme Corp');
    expect(text).toContain('acct-123');
  });

  it('returns auth error guidance on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await getAccountHandler.execute(
      { account_id: 'acct-123' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });

  it('returns generic error message on failure', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('network timeout'));
    const result = await getAccountHandler.execute(
      { account_id: 'acct-123' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('network timeout');
  });
});

describe('wpe_get_account_limits', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('returns limits table on success', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      results: [
        { name: 'monthly_visitors', limit: 100000, current: 45000 },
        { name: 'storage_gb', limit: 50, current: 12 },
      ],
    });
    const result = await getAccountLimitsHandler.execute(
      { account_id: 'acct-123' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Plan Limits');
    expect(text).toContain('monthly_visitors');
    expect(text).toContain('45%');
  });

  it('returns empty message when no limits found', async () => {
    mockCapiDirect.mockResolvedValueOnce({ results: [] });
    const result = await getAccountLimitsHandler.execute(
      { account_id: 'acct-123' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('No limit data found');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('401 Unauthorized'));
    const result = await getAccountLimitsHandler.execute(
      { account_id: 'acct-123' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

describe('wpe_get_account_usage_summary', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('returns usage summary with visits and bandwidth', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      visit_count: 50000,
      network_total_bytes: 5_000_000_000,
      storage_bytes: 2_000_000_000,
    });
    const result = await getAccountUsageSummaryHandler.execute(
      { account_id: 'acct-123' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Usage Summary');
    expect(text).toContain('50,000');
    expect(text).toContain('5 GB');
  });

  it('handles missing fields gracefully with dashes', async () => {
    mockCapiDirect.mockResolvedValueOnce({});
    const result = await getAccountUsageSummaryHandler.execute(
      { account_id: 'acct-123' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('—');
  });

  it('returns auth error on 403', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('403 Forbidden'));
    const result = await getAccountUsageSummaryHandler.execute(
      { account_id: 'acct-123' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

describe('wpe_get_account_usage_insights', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('returns usage breakdown table by environment type', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      results: [
        { environment_type: 'production', visit_count: 40000, network_total_bytes: 4_000_000_000, storage_bytes: 1_500_000_000 },
        { environment_type: 'staging', visit_count: 1000, network_total_bytes: 100_000_000, storage_bytes: 500_000_000 },
      ],
    });
    const result = await getAccountUsageInsightsHandler.execute(
      { account_id: 'acct-123' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Usage Insights');
    expect(text).toContain('production');
    expect(text).toContain('staging');
    expect(text).toContain('40,000');
  });

  it('returns empty message when no insights found', async () => {
    mockCapiDirect.mockResolvedValueOnce({ results: [] });
    const result = await getAccountUsageInsightsHandler.execute(
      { account_id: 'acct-123' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('No usage insight data found');
  });

  it('returns error on generic failure', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('server error'));
    const result = await getAccountUsageInsightsHandler.execute(
      { account_id: 'acct-123' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('server error');
  });
});

describe('wpe_get_account_user', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('returns formatted user details on success', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      id: 'user-abc',
      first_name: 'Jane',
      last_name: 'Smith',
      user: { email: 'jane@example.com' },
      roles: ['full'],
      created_at: '2023-01-10T00:00:00Z',
    });
    const result = await getAccountUserHandler.execute(
      { account_id: 'acct-123', user_id: 'user-abc' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Jane Smith');
    expect(text).toContain('jane@example.com');
    expect(text).toContain('full');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await getAccountUserHandler.execute(
      { account_id: 'acct-123', user_id: 'user-abc' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });

  it('returns generic error on failure', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('not found'));
    const result = await getAccountUserHandler.execute(
      { account_id: 'acct-123', user_id: 'user-abc' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('not found');
  });
});

describe('wpe_create_account_user', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('returns success message after adding user', async () => {
    mockCapiDirect.mockResolvedValueOnce({});
    const result = await createAccountUserHandler.execute(
      {
        account_id: 'acct-123',
        email: 'newuser@example.com',
        first_name: 'John',
        last_name: 'Doe',
        roles: ['partial'],
      },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('John Doe');
    expect(text).toContain('newuser@example.com');
    expect(text).toContain('partial');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('401'));
    const result = await createAccountUserHandler.execute(
      { account_id: 'acct-123', email: 'x@x.com', first_name: 'A', last_name: 'B', roles: ['full'] },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

describe('wpe_update_account_user', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('returns success message after updating role', async () => {
    mockCapiDirect.mockResolvedValueOnce({});
    const result = await updateAccountUserHandler.execute(
      { account_id: 'acct-123', user_id: 'user-abc', roles: ['billing'] },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Role Updated');
    expect(text).toContain('user-abc');
    expect(text).toContain('billing');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await updateAccountUserHandler.execute(
      { account_id: 'acct-123', user_id: 'user-abc', roles: ['full'] },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

describe('wpe_delete_account_user', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('pre-confirmation: fetches user and returns confirmation prompt with email', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      id: 'user-abc',
      first_name: 'Jane',
      last_name: 'Smith',
      user: { email: 'jane@example.com' },
      roles: ['full'],
    });
    const result = await deleteAccountUserHandler.execute(
      { account_id: 'acct-123', user_id: 'user-abc' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Confirm User Removal');
    expect(text).toContain('jane@example.com');
    expect(text).toContain('_confirmationToken');
    expect(text).toContain('Jane Smith');
  });

  it('pre-confirmation: returns auth error on 401 during user fetch', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await deleteAccountUserHandler.execute(
      { account_id: 'acct-123', user_id: 'user-abc' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });

  it('confirmed call: calls DELETE and returns success', async () => {
    mockCapiDirect.mockResolvedValueOnce({});
    const result = await deleteAccountUserHandler.execute(
      { account_id: 'acct-123', user_id: 'user-abc', _confirmationToken: 'confirm' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('removed');
    expect(mockCapiDirect).toHaveBeenCalledWith(
      '/accounts/acct-123/account_users/user-abc',
      'DELETE',
    );
  });

  it('confirmed call: returns auth error on 401 during DELETE', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('401'));
    const result = await deleteAccountUserHandler.execute(
      { account_id: 'acct-123', user_id: 'user-abc', _confirmationToken: 'confirm' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// --- wpe_get_account_users (role code mapping) ---

describe('wpe_get_account_users role code mapping', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('maps single-letter role codes to human-readable labels in group headers', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      results: [
        { id: 'u1', first_name: 'Alice', last_name: 'A', user: { email: 'alice@example.com' }, roles: ['o'] },
        { id: 'u2', first_name: 'Bob', last_name: 'B', user: { email: 'bob@example.com' }, roles: ['b'] },
        { id: 'u3', first_name: 'Carol', last_name: 'C', user: { email: 'carol@example.com' }, roles: ['p'] },
      ],
    });

    const result = await getAccountUsersHandler.execute(
      { account_id: 'acct-123' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    // Group headers should show full names, not raw codes
    expect(text).toContain('**owner**');
    expect(text).toContain('**billing**');
    expect(text).toContain('**partial**');
    // Should NOT show raw single-letter codes as group headings
    expect(text).not.toContain('**o**');
    expect(text).not.toContain('**b**');
    expect(text).not.toContain('**p**');
  });

  it('handles mixed abbreviated and full-name role codes correctly', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      results: [
        { id: 'u1', first_name: 'Alice', last_name: 'A', user: { email: 'alice@example.com' }, roles: ['o'] },
        { id: 'u2', first_name: 'Bob', last_name: 'B', user: { email: 'bob@example.com' }, roles: ['full'] },
      ],
    });

    const result = await getAccountUsersHandler.execute(
      { account_id: 'acct-123' },
      makeMockServices(mockCapiDirect),
    );
    const text = getText(result);
    expect(text).toContain('**owner**');
    expect(text).toContain('**full**');
  });
});
