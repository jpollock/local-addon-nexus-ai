import * as fs from 'fs';
import * as path from 'path';
import {
  detectHubPlugin,
  getConnectionStatus,
  readIwBinding,
  writeIwBinding,
  clearIwBinding,
} from '../../../src/main/mcp/modules/iw/hub-connect';
import { STORAGE_KEYS } from '../../../src/common/constants';

jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('detectHubPlugin', () => {
  it('returns true when wpe-hub directory exists', () => {
    mockFs.existsSync.mockReturnValue(true);
    expect(detectHubPlugin('/var/www/html')).toBe(true);
    expect(mockFs.existsSync).toHaveBeenCalledWith(
      path.join('/var/www/html', 'wp-content', 'plugins', 'wpe-hub'),
    );
  });

  it('returns false when directory is absent', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(detectHubPlugin('/var/www/html')).toBe(false);
  });
});

describe('getConnectionStatus', () => {
  const mockServices = {
    resolveSiteObject: jest.fn().mockReturnValue({ paths: { webRoot: '/webroot' } }),
    wpCliRun: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
  });

  it('returns connected=true when registered and client_id set', async () => {
    mockServices.wpCliRun.mockResolvedValue({
      stdout: JSON.stringify({
        registered: '1', client_id: 'client_abc',
        project_id: 'proj_xyz', account_id: 'acct_111', copy_reset: '',
      }),
      success: true,
    });
    const status = await getConnectionStatus('site_1', mockServices);
    expect(status.connected).toBe(true);
    expect(status.clientId).toBe('client_abc');
    expect(status.projectId).toBe('proj_xyz');
    expect(status.accountId).toBe('acct_111');
    expect(status.copyReset).toBe(false);
  });

  it('returns connected=false when not registered', async () => {
    mockServices.wpCliRun.mockResolvedValue({
      stdout: JSON.stringify({
        registered: '', client_id: '',
        project_id: '', account_id: '', copy_reset: '',
      }),
      success: true,
    });
    const status = await getConnectionStatus('site_1', mockServices);
    expect(status.connected).toBe(false);
    expect(status.clientId).toBeNull();
  });

  it('returns copyReset=true when copy detected', async () => {
    mockServices.wpCliRun.mockResolvedValue({
      stdout: JSON.stringify({
        registered: '', client_id: '',
        project_id: '', account_id: '', copy_reset: 'Connection reset for security.',
      }),
      success: true,
    });
    const status = await getConnectionStatus('site_1', mockServices);
    expect(status.copyReset).toBe(true);
    expect(status.connected).toBe(false);
  });

  it('returns connected=false even if registered when copyReset is set', async () => {
    mockServices.wpCliRun.mockResolvedValue({
      stdout: JSON.stringify({
        registered: '1', client_id: 'client_abc',
        project_id: 'proj_xyz', account_id: 'acct_111',
        copy_reset: 'Connection reset for security.',
      }),
      success: true,
    });
    const status = await getConnectionStatus('site_1', mockServices);
    expect(status.copyReset).toBe(true);
    expect(status.connected).toBe(false);
    expect(status.clientId).toBeNull();
  });

  it('returns hubInstalled=false when directory absent', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const status = await getConnectionStatus('site_1', mockServices);
    expect(status.hubInstalled).toBe(false);
    expect(status.connected).toBe(false);
    expect(mockServices.wpCliRun).not.toHaveBeenCalled();
  });
});

describe('binding persistence', () => {
  const mockStorage = { get: jest.fn(), set: jest.fn() } as any;

  const binding = {
    siteId: 'site_1', clientId: 'c_abc', projectId: 'p_xyz',
    accountId: 'a_111', connectedAt: 1000,
  };

  beforeEach(() => jest.clearAllMocks());

  it('writeIwBinding stores binding under siteId', () => {
    mockStorage.get.mockReturnValue({});
    writeIwBinding(binding, mockStorage);
    expect(mockStorage.set).toHaveBeenCalledWith(
      STORAGE_KEYS.IW_SITE_BINDINGS,
      expect.objectContaining({ site_1: binding }),
    );
  });

  it('readIwBinding returns stored binding', () => {
    mockStorage.get.mockReturnValue({ site_1: binding });
    expect(readIwBinding('site_1', mockStorage)).toEqual(binding);
  });

  it('readIwBinding returns null when absent', () => {
    mockStorage.get.mockReturnValue({});
    expect(readIwBinding('site_1', mockStorage)).toBeNull();
  });

  it('clearIwBinding removes only the target site', () => {
    const other = { ...binding, siteId: 'site_2' };
    mockStorage.get.mockReturnValue({ site_1: binding, site_2: other });
    clearIwBinding('site_1', mockStorage);
    const saved = mockStorage.set.mock.calls[0][1];
    expect(saved).not.toHaveProperty('site_1');
    expect(saved).toHaveProperty('site_2');
  });
});
