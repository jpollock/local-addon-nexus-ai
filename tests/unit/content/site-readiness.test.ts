import { isSiteReady } from '../../../src/main/content/site-readiness';
import type { LocalSiteDataAccessor, LocalSite } from '../../../src/main/types/site-data';
import { MySQLExtractor } from '../../../src/main/content/MySQLExtractor';

describe('isSiteReady', () => {
  let mockSiteData: jest.Mocked<LocalSiteDataAccessor>;
  let mockMySQLExtractor: jest.Mocked<MySQLExtractor>;

  beforeEach(() => {
    mockSiteData = {
      getSite: jest.fn(),
      getSites: jest.fn(),
    } as any;

    mockMySQLExtractor = {
      isAvailable: jest.fn(),
      testConnection: jest.fn(),
    } as any;
  });

  it('should return not ready when site not found in GraphQL', async () => {
    mockSiteData.getSite.mockReturnValue(null);

    const result = await isSiteReady('test-site', mockSiteData);

    expect(result).toEqual({
      ready: false,
      reason: 'Site not found in Local state',
    });
  });

  it('should return not ready when site status is provisioning', async () => {
    mockSiteData.getSite.mockReturnValue({
      id: 'test-site',
      name: 'test-site',
      status: 'provisioning',
      path: '/path/to/site',
    });

    const result = await isSiteReady('test-site', mockSiteData);

    expect(result).toEqual({
      ready: false,
      reason: 'Site status: provisioning',
    });
  });

  it('should return not ready when site status is halted', async () => {
    mockSiteData.getSite.mockReturnValue({
      id: 'test-site',
      name: 'test-site',
      status: 'halted',
      path: '/path/to/site',
    });

    const result = await isSiteReady('test-site', mockSiteData);

    expect(result).toEqual({
      ready: false,
      reason: 'Site status: halted',
    });
  });

  it('should return not ready when site path does not exist', async () => {
    mockSiteData.getSite.mockReturnValue({
      id: 'test-site',
      name: 'test-site',
      status: 'running',
      path: '/nonexistent/path',
    });

    const result = await isSiteReady('test-site', mockSiteData);

    expect(result).toEqual({
      ready: false,
      reason: 'Site path does not exist',
    });
  });

  it('should return not ready when MySQL socket is missing', async () => {
    mockSiteData.getSite.mockReturnValue({
      id: 'test-site',
      name: 'test-site',
      status: 'running',
      path: __dirname, // Use test directory as existing path
    });
    mockMySQLExtractor.isAvailable.mockReturnValue(false);

    const result = await isSiteReady('test-site', mockSiteData, mockMySQLExtractor);

    expect(result).toEqual({
      ready: false,
      reason: 'MySQL not accepting connections',
    });
  });

  it('should return not ready when MySQL connection fails', async () => {
    mockSiteData.getSite.mockReturnValue({
      id: 'test-site',
      name: 'test-site',
      status: 'running',
      path: __dirname,
    });
    mockMySQLExtractor.isAvailable.mockReturnValue(true);
    mockMySQLExtractor.testConnection.mockResolvedValue(false);

    const result = await isSiteReady('test-site', mockSiteData, mockMySQLExtractor);

    expect(result).toEqual({
      ready: false,
      reason: 'MySQL not accepting connections',
    });
  });

  it('should return ready when all checks pass', async () => {
    mockSiteData.getSite.mockReturnValue({
      id: 'test-site',
      name: 'test-site',
      status: 'running',
      path: __dirname,
    });
    mockMySQLExtractor.isAvailable.mockReturnValue(true);
    mockMySQLExtractor.testConnection.mockResolvedValue(true);

    const result = await isSiteReady('test-site', mockSiteData, mockMySQLExtractor);

    expect(result).toEqual({
      ready: true,
    });
  });
});
