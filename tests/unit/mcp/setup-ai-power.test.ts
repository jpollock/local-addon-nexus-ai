import { setupSiteForAI } from '../../../src/main/mcp/modules/wp-connector/setup-ai';

// Mock KeyVault — no OS keychain under Jest
jest.mock('../../../src/main/security/KeyVault', () => ({ getApiKey: jest.fn(() => null) }));
// Mock hub-connect — control connection status
jest.mock('../../../src/main/mcp/modules/iw/hub-connect', () => ({
  getConnectionStatus: jest.fn(),
}));
import { getConnectionStatus } from '../../../src/main/mcp/modules/iw/hub-connect';
const mockGetConnectionStatus = getConnectionStatus as jest.MockedFunction<typeof getConnectionStatus>;

const connectedStatus = {
  hubInstalled: true, connected: true, copyReset: false,
  clientId: 'client_abc', projectId: 'proj_xyz', accountId: 'acct_111',
  wpEngineConnectorApproved: false,
};

const mockLocalServices = {
  getWpVersion: jest.fn().mockResolvedValue('7.0.2'),
  getPlugins: jest.fn().mockResolvedValue([
    { name: 'ai', status: 'active', version: '1.0.0', title: 'AI' },
    { name: 'nexus-ai-connector', status: 'active', version: '1.0.0', title: 'Nexus AI' },
  ]),
  wpCliRun: jest.fn().mockResolvedValue({ stdout: 'ok', success: true }),
  resolveSiteObject: jest.fn().mockReturnValue({ paths: { webRoot: '/tmp/test-site' } }),
} as any;

const mockStorage = {
  get: jest.fn().mockReturnValue({}),
  set: jest.fn(),
} as any;

const mockLogger = { info: jest.fn(), error: jest.fn() };

describe('setupSiteForAI — power provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnectionStatus.mockResolvedValue(connectedStatus);
  });

  it('skips provider plugin, skips credential sync, approves wpengine connector', async () => {
    const result = await setupSiteForAI('site_1', mockLocalServices, mockStorage, mockLogger, { provider: 'power' });

    expect(result.providerPlugins).toBe('skipped');
    expect(result.gatewayProvider).toBe('skipped');
    expect(result.credentials).toBe('skipped');

    // wpengine approval PHP should have been run
    const evalCalls = mockLocalServices.wpCliRun.mock.calls
      .filter((c: string[]) => c[0] === 'eval' || c[1]?.[0] === 'eval');
    const approvalCall = mockLocalServices.wpCliRun.mock.calls.find(
      (c: any) => Array.isArray(c[1]) && c[1][0] === 'eval' && c[1][1]?.includes('wpengine'),
    );
    expect(approvalCall).toBeDefined();
  });

  it('returns error when Hub is not connected', async () => {
    mockGetConnectionStatus.mockResolvedValue({ ...connectedStatus, connected: false, clientId: null });
    const result = await setupSiteForAI('site_1', mockLocalServices, mockStorage, mockLogger, { provider: 'power' });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Hub Plugin/i);
  });
});
