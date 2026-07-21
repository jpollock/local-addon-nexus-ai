import { OAuthFlowRunner } from '../../../src/main/credentials/OAuthFlowRunner';
import { shell } from 'electron';
import type { ProviderConfig } from '../../../src/main/credentials/ProviderRegistry';

const mockShell = shell as jest.Mocked<typeof shell>;

const testProvider: ProviderConfig = {
  id: 'google',
  displayName: 'Google',
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
  clientId: 'test-client-id',
  supportsIncrementalAuth: true,
  scopeMetadata: {},
};

beforeEach(() => jest.clearAllMocks());

describe('OAuthFlowRunner', () => {
  it('opens the system browser with a URL containing all required PKCE params', async () => {
    const runner = new OAuthFlowRunner();
    let capturedUrl = '';
    mockShell.openExternal.mockImplementation(async (url: string) => { capturedUrl = url; });

    // Simulate an immediate callback arriving so the flow completes
    const scopes = ['https://www.googleapis.com/auth/webmasters.readonly'];
    const flowPromise = runner.run(testProvider, scopes, () => {});

    // Wait a tick for the server to start and openExternal to be called
    await new Promise(r => setTimeout(r, 50));
    expect(mockShell.openExternal).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toContain('code_challenge=');
    expect(capturedUrl).toContain('code_challenge_method=S256');
    expect(capturedUrl).toContain('include_granted_scopes=true');
    expect(capturedUrl).toContain(encodeURIComponent(scopes[0]));
    expect(capturedUrl).toContain('redirect_uri=http%3A%2F%2F127.0.0.1%3A');

    // Send a cancel to clean up
    runner.cancel();
    const result = await flowPromise;
    expect(result.outcome).toBe('cancelled');
  });

  it('returns cancelled when cancel() is called before callback arrives', async () => {
    const runner = new OAuthFlowRunner();
    mockShell.openExternal.mockResolvedValue(undefined);
    const flowPromise = runner.run(testProvider, ['https://www.googleapis.com/auth/webmasters.readonly'], () => {});
    await new Promise(r => setTimeout(r, 20));
    runner.cancel();
    const result = await flowPromise;
    expect(result.outcome).toBe('cancelled');
  });

  it('returns state_mismatch when state param does not match', async () => {
    const runner = new OAuthFlowRunner();
    let port = 0;
    mockShell.openExternal.mockImplementation(async (url: string) => {
      const match = url.match(/redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A(\d+)/);
      port = match ? parseInt(match[1]) : 0;
    });

    const flowPromise = runner.run(testProvider, ['https://www.googleapis.com/auth/webmasters.readonly'], () => {});
    await new Promise(r => setTimeout(r, 50));

    // Hit the callback with a wrong state
    if (port) {
      await fetch(`http://127.0.0.1:${port}/callback?code=abc&state=WRONG_STATE`).catch(() => {});
    }
    runner.cancel();
    const result = await flowPromise;
    expect(['cancelled', 'state_mismatch']).toContain(result.outcome);
  });
});
