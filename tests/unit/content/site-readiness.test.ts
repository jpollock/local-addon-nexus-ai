import { isSiteReady } from '../../../src/main/content/site-readiness';
import { LocalServicesBridge } from '../../../src/main/mcp/local-services-bridge';
import { MySQLExtractor } from '../../../src/main/content/MySQLExtractor';

describe('isSiteReady', () => {
  let mockLocalServices: jest.Mocked<LocalServicesBridge>;
  let mockMySQLExtractor: jest.Mocked<MySQLExtractor>;

  beforeEach(() => {
    mockLocalServices = {
      getSite: jest.fn(),
      getSiteStatus: jest.fn(),
    } as any;

    mockMySQLExtractor = {
      isAvailable: jest.fn(),
      testConnection: jest.fn(),
    } as any;
  });

  it('should return not ready when site not found in Local state', async () => {
    mockLocalServices.getSite.mockReturnValue(null);

    const result = await isSiteReady('test-site', mockLocalServices);

    expect(result).toEqual({
      ready: false,
      reason: 'Site not found in Local state',
    });
  });

  it('should return not ready when site status is provisioning', async () => {
    mockLocalServices.getSite.mockReturnValue({
      id: 'test-site',
      name: 'test-site',
      status: 'provisioning',
      path: '/path/to/site',
    });
    mockLocalServices.getSiteStatus.mockReturnValue('provisioning');

    const result = await isSiteReady('test-site', mockLocalServices);

    expect(result).toEqual({
      ready: false,
      reason: 'Site status: provisioning',
    });
  });

  it('should return not ready when site status is halted', async () => {
    mockLocalServices.getSite.mockReturnValue({
      id: 'test-site',
      name: 'test-site',
      status: 'halted',
      path: '/path/to/site',
    });
    mockLocalServices.getSiteStatus.mockReturnValue('halted');

    const result = await isSiteReady('test-site', mockLocalServices);

    expect(result).toEqual({
      ready: false,
      reason: 'Site status: halted',
    });
  });

  it('should return not ready when site path does not exist', async () => {
    mockLocalServices.getSite.mockReturnValue({
      id: 'test-site',
      name: 'test-site',
      status: 'running',
      path: '/nonexistent/path',
    });
    mockLocalServices.getSiteStatus.mockReturnValue('running');

    const result = await isSiteReady('test-site', mockLocalServices);

    expect(result).toEqual({
      ready: false,
      reason: 'Site path does not exist',
    });
  });

  it('should return not ready when MySQL socket is missing', async () => {
    mockLocalServices.getSite.mockReturnValue({
      id: 'test-site',
      name: 'test-site',
      status: 'running',
      path: __dirname, // Use test directory as existing path
    });
    mockLocalServices.getSiteStatus.mockReturnValue('running');
    mockMySQLExtractor.isAvailable.mockReturnValue(false);

    const result = await isSiteReady('test-site', mockLocalServices, mockMySQLExtractor);

    expect(result).toEqual({
      ready: false,
      reason: 'MySQL socket does not exist',
    });
  });

  it('should return not ready when MySQL connection fails', async () => {
    mockLocalServices.getSite.mockReturnValue({
      id: 'test-site',
      name: 'test-site',
      status: 'running',
      path: __dirname,
    });
    mockLocalServices.getSiteStatus.mockReturnValue('running');
    mockMySQLExtractor.isAvailable.mockReturnValue(true);
    mockMySQLExtractor.testConnection.mockResolvedValue(false);

    const result = await isSiteReady('test-site', mockLocalServices, mockMySQLExtractor);

    expect(result).toEqual({
      ready: false,
      reason: 'MySQL not accepting connections',
    });
  });

  it('should return ready when all checks pass', async () => {
    mockLocalServices.getSite.mockReturnValue({
      id: 'test-site',
      name: 'test-site',
      status: 'running',
      path: __dirname,
    });
    mockLocalServices.getSiteStatus.mockReturnValue('running');
    mockMySQLExtractor.isAvailable.mockReturnValue(true);
    mockMySQLExtractor.testConnection.mockResolvedValue(true);

    const result = await isSiteReady('test-site', mockLocalServices, mockMySQLExtractor);

    expect(result).toEqual({
      ready: true,
    });
  });
});
