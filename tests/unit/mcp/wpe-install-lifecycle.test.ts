/**
 * Unit tests for WPE install and site lifecycle MCP handlers
 */
import { getSitesHandler } from '../../../src/main/mcp/modules/wpe/get-sites';
import { getSiteHandler } from '../../../src/main/mcp/modules/wpe/get-site';
import { createSiteHandler } from '../../../src/main/mcp/modules/wpe/create-site';
import { updateSiteHandler } from '../../../src/main/mcp/modules/wpe/update-site';
import { deleteSiteHandler } from '../../../src/main/mcp/modules/wpe/delete-site';
import { createInstallHandler } from '../../../src/main/mcp/modules/wpe/create-install';
import { updateInstallHandler } from '../../../src/main/mcp/modules/wpe/update-install';
import { deleteInstallHandler } from '../../../src/main/mcp/modules/wpe/delete-install';
import { getBackupHandler } from '../../../src/main/mcp/modules/wpe/get-backup';
import { refreshInstallDiskUsageHandler } from '../../../src/main/mcp/modules/wpe/refresh-disk-usage';

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

// --- wpe_get_sites ---

describe('wpe_get_sites', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('returns formatted site list on success', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      results: [
        { id: 'site-1', name: 'My Store', account: { name: 'Acme' } },
        { id: 'site-2', name: 'Blog', account: { name: 'Acme' } },
      ],
    });
    const result = await getSitesHandler.execute({}, makeMockServices(mockCapiDirect));
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('WP Engine Sites');
    expect(text).toContain('My Store');
    expect(text).toContain('Blog');
  });

  it('returns empty message when no sites', async () => {
    mockCapiDirect.mockResolvedValueOnce({ results: [] });
    const result = await getSitesHandler.execute({}, makeMockServices(mockCapiDirect));
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('No WP Engine sites found');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await getSitesHandler.execute({}, makeMockServices(mockCapiDirect));
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// --- wpe_get_site ---

describe('wpe_get_site', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('returns site detail table on success', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      id: 'site-1',
      name: 'My Store',
      account: { name: 'Acme Corp' },
      created_at: '2023-06-01T00:00:00Z',
    });
    const result = await getSiteHandler.execute(
      { site_id: 'site-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Site: My Store');
    expect(text).toContain('Acme Corp');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('401'));
    const result = await getSiteHandler.execute(
      { site_id: 'site-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });

  it('returns generic error on failure', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('not found'));
    const result = await getSiteHandler.execute(
      { site_id: 'site-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('not found');
  });
});

// --- wpe_create_site ---

describe('wpe_create_site', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('creates site and returns ID', async () => {
    mockCapiDirect.mockResolvedValueOnce({ id: 'site-new', name: 'New Site' });
    const result = await createSiteHandler.execute(
      { name: 'New Site', account_id: 'acct-123' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Site Created');
    expect(text).toContain('site-new');
    expect(text).toContain('wpe_create_install');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await createSiteHandler.execute(
      { name: 'New Site', account_id: 'acct-123' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// --- wpe_update_site ---

describe('wpe_update_site', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('renames site and returns confirmation', async () => {
    mockCapiDirect.mockResolvedValueOnce({});
    const result = await updateSiteHandler.execute(
      { site_id: 'site-1', name: 'Renamed Site' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('site-1');
    expect(text).toContain('Renamed Site');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('401'));
    const result = await updateSiteHandler.execute(
      { site_id: 'site-1', name: 'X' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// --- wpe_delete_site ---

describe('wpe_delete_site', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('pre-confirmation: fetches site, shows all installs being deleted', async () => {
    // First call: GET /sites/site-1, second call: GET /installs?site_id=site-1
    mockCapiDirect
      .mockResolvedValueOnce({ id: 'site-1', name: 'My Store' })
      .mockResolvedValueOnce({ results: [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }] });

    const result = await deleteSiteHandler.execute(
      { site_id: 'site-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Confirm Deletion of Site');
    expect(text).toContain('My Store');
    expect(text).toContain('3 install(s)');
    expect(text).toContain('_confirmationToken');
  });

  it('pre-confirmation: shows site name in confirm_site_name instruction', async () => {
    mockCapiDirect
      .mockResolvedValueOnce({ id: 'site-1', name: 'Flagship Store' })
      .mockResolvedValueOnce({ results: [] });

    const result = await deleteSiteHandler.execute(
      { site_id: 'site-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(getText(result)).toContain('confirm_site_name: "Flagship Store"');
  });

  it('confirmed with correct site name: calls DELETE and returns success', async () => {
    // 1. Fetch site to verify name
    mockCapiDirect
      .mockResolvedValueOnce({ id: 'site-1', name: 'My Store' })
      .mockResolvedValueOnce({});

    const result = await deleteSiteHandler.execute(
      { site_id: 'site-1', confirm_site_name: 'My Store', _confirmationToken: 'confirm' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('permanently deleted');
    expect(mockCapiDirect).toHaveBeenCalledWith('/sites/site-1', 'DELETE');
  });

  it('confirmed with wrong site name: returns error', async () => {
    mockCapiDirect.mockResolvedValueOnce({ id: 'site-1', name: 'My Store' });

    const result = await deleteSiteHandler.execute(
      { site_id: 'site-1', confirm_site_name: 'Wrong Name', _confirmationToken: 'confirm' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('mismatch');
    expect(getText(result)).toContain('My Store');
  });
});

// --- wpe_create_install ---

describe('wpe_create_install', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('creates install and returns details', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      id: 'inst-new',
      name: 'mysite',
      environment: 'staging',
      primaryDomain: 'mysite.wpengine.com',
    });
    const result = await createInstallHandler.execute(
      { site_id: 'site-1', name: 'mysite', environment: 'staging', account_id: 'acct-123' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Install Created');
    expect(text).toContain('inst-new');
    expect(text).toContain('staging');
  });

  it('returns validation error for invalid environment', async () => {
    const result = await createInstallHandler.execute(
      { site_id: 'site-1', name: 'mysite', environment: 'invalid', account_id: 'acct-123' },
      makeMockServices(jest.fn()),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Invalid environment');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await createInstallHandler.execute(
      { site_id: 'site-1', name: 'mysite', environment: 'staging', account_id: 'acct-123' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// --- wpe_update_install ---

describe('wpe_update_install', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('updates PHP version and returns confirmation', async () => {
    mockCapiDirect.mockResolvedValueOnce({});
    const result = await updateInstallHandler.execute(
      { install_id: 'inst-1', php_version: '8.2' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('8.2');
  });

  it('returns validation error when no optional fields provided', async () => {
    const result = await updateInstallHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices(jest.fn()),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('At least one');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('401'));
    const result = await updateInstallHandler.execute(
      { install_id: 'inst-1', php_version: '8.3' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});

// --- wpe_delete_install ---

describe('wpe_delete_install', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('pre-confirmation: fetches install and returns warning with details', async () => {
    // First call: GET install, second call: GET backups
    mockCapiDirect
      .mockResolvedValueOnce({ name: 'mysite', environment: 'staging', cname: 'mysite.wpengine.com' })
      .mockResolvedValueOnce({ results: [{ created_at: new Date().toISOString() }] }); // recent backup

    const result = await deleteInstallHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Confirm Deletion of Install');
    expect(text).toContain('mysite');
    expect(text).toContain('staging');
    expect(text).toContain('_confirmationToken');
  });

  it('pre-confirmation: shows backup warning when no recent backup', async () => {
    // Backup is 30 days old
    const oldDate = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    mockCapiDirect
      .mockResolvedValueOnce({ name: 'mysite', environment: 'production', cname: 'mysite.wpengine.com' })
      .mockResolvedValueOnce({ results: [{ created_at: oldDate }] });

    const result = await deleteInstallHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('No recent backup');
    expect(getText(result)).toContain('wpe_create_backup');
  });

  it('pre-confirmation: shows no-backup warning when backup list is empty', async () => {
    mockCapiDirect
      .mockResolvedValueOnce({ name: 'mysite', environment: 'staging', cname: 'mysite.wpengine.com' })
      .mockResolvedValueOnce({ results: [] });

    const result = await deleteInstallHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('No backup found');
  });

  it('confirmed with correct install name: calls DELETE and returns success', async () => {
    mockCapiDirect
      .mockResolvedValueOnce({ name: 'mysite', environment: 'staging' })
      .mockResolvedValueOnce({});

    const result = await deleteInstallHandler.execute(
      { install_id: 'inst-1', confirm_install_name: 'mysite', _confirmationToken: 'confirm' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('permanently deleted');
    expect(mockCapiDirect).toHaveBeenCalledWith('/installs/inst-1', 'DELETE');
  });

  it('confirmed with wrong install name: returns error', async () => {
    mockCapiDirect.mockResolvedValueOnce({ name: 'mysite', environment: 'staging' });

    const result = await deleteInstallHandler.execute(
      { install_id: 'inst-1', confirm_install_name: 'wrong-name', _confirmationToken: 'confirm' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('mismatch');
    expect(getText(result)).toContain('mysite');
  });

  it('confirmed without confirm_install_name: returns error', async () => {
    const result = await deleteInstallHandler.execute(
      { install_id: 'inst-1', _confirmationToken: 'confirm' },
      makeMockServices(jest.fn()),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('confirm_install_name');
  });
});

// --- wpe_get_backup ---

describe('wpe_get_backup', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('returns backup details on success', async () => {
    mockCapiDirect.mockResolvedValueOnce({
      status: 'complete',
      type: 'manual',
      created_at: '2024-01-15T10:00:00Z',
      description: 'Pre-deploy backup',
    });
    const result = await getBackupHandler.execute(
      { install_id: 'inst-1', backup_id: 'bkp-abc' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('bkp-abc');
    expect(text).toContain('complete');
    expect(text).toContain('manual');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('401'));
    const result = await getBackupHandler.execute(
      { install_id: 'inst-1', backup_id: 'bkp-abc' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });

  it('returns generic error on failure', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('backup not found'));
    const result = await getBackupHandler.execute(
      { install_id: 'inst-1', backup_id: 'bkp-abc' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('backup not found');
  });
});

// --- wpe_refresh_install_disk_usage ---

describe('wpe_refresh_install_disk_usage', () => {
  let mockCapiDirect: jest.Mock;

  beforeEach(() => {
    mockCapiDirect = jest.fn();
  });

  it('triggers recalculation and returns confirmation', async () => {
    mockCapiDirect.mockResolvedValueOnce({});
    const result = await refreshInstallDiskUsageHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Disk usage recalculation triggered');
    expect(text).toContain('inst-1');
  });

  it('returns auth error on 401', async () => {
    mockCapiDirect.mockRejectedValueOnce(new Error('response returned an error code 401'));
    const result = await refreshInstallDiskUsageHandler.execute(
      { install_id: 'inst-1' },
      makeMockServices(mockCapiDirect),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('wpe_login');
  });
});
