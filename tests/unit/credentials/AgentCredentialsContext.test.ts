import { AgentCredentialsContext } from '../../../src/main/credentials/AgentCredentialsContext';
import type { ICredentialManager } from '../../../src/main/credentials/AgentCredentialsContext';
import type { CredentialDeclaration, AccessToken } from '../../../src/main/credentials/types';
import { NotConnectedError } from '../../../src/main/credentials/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeManager(): any {
  return {
    getTokenForGrant: jest.fn() as any,
    getStatusForAgent: jest.fn() as any,
    requestConnectionForAgent: jest.fn() as any,
  };
}

function makeToken(overrides: Partial<AccessToken> = {}): AccessToken {
  return {
    token: 'access-token-123',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    scopes: [
      'https://www.googleapis.com/auth/webmasters.readonly',
      'https://www.googleapis.com/auth/analytics.readonly',
    ],
    ...overrides,
  };
}

describe('AgentCredentialsContext', () => {
  describe('getToken', () => {
    it('throws NotConnectedError if provider not in manifest', async () => {
      const manager = makeManager();
      const credentials: CredentialDeclaration[] = [
        {
          provider: 'google',
          scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
          reason: 'Access Search Console data',
        },
      ];
      const ctx = new AgentCredentialsContext(manager, credentials, 'seo-agent', 'site-1');

      await expect(ctx.getToken('github')).rejects.toThrow(NotConnectedError);
      expect(manager.getTokenForGrant).not.toHaveBeenCalled();
    });

    it('filters token scopes to only declared scopes', async () => {
      const manager = makeManager();
      const credentials: CredentialDeclaration[] = [
        {
          provider: 'google',
          scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
          reason: 'Access Search Console data',
        },
      ];
      const ctx = new AgentCredentialsContext(manager, credentials, 'seo-agent', 'site-1');

      const fullToken = makeToken({
        scopes: [
          'https://www.googleapis.com/auth/webmasters.readonly',
          'https://www.googleapis.com/auth/analytics.readonly',
        ],
      });
      manager.getTokenForGrant.mockResolvedValue(fullToken);

      const result = await ctx.getToken('google');

      expect(result.token).toBe('access-token-123');
      expect(result.expiresAt).toBe(fullToken.expiresAt);
      expect(result.scopes).toEqual(['https://www.googleapis.com/auth/webmasters.readonly']);
      expect(manager.getTokenForGrant).toHaveBeenCalledWith('google', 'seo-agent', 'site-1');
    });

    it('preserves token and expiresAt unchanged', async () => {
      const manager = makeManager();
      const credentials: CredentialDeclaration[] = [
        {
          provider: 'google',
          scopes: [
            'https://www.googleapis.com/auth/webmasters.readonly',
            'https://www.googleapis.com/auth/analytics.readonly',
          ],
          reason: 'Access both Search Console and Analytics',
        },
      ];
      const ctx = new AgentCredentialsContext(manager, credentials, 'seo-agent', 'site-1');

      const token = makeToken();
      manager.getTokenForGrant.mockResolvedValue(token);

      const result = await ctx.getToken('google');

      expect(result.token).toBe(token.token);
      expect(result.expiresAt).toBe(token.expiresAt);
    });

    it('returns empty scopes if no declared scopes match token scopes', async () => {
      const manager = makeManager();
      const credentials: CredentialDeclaration[] = [
        {
          provider: 'google',
          scopes: ['https://www.googleapis.com/auth/some-other-scope'],
          reason: 'Other scope',
        },
      ];
      const ctx = new AgentCredentialsContext(manager, credentials, 'seo-agent', 'site-1');

      const token = makeToken({
        scopes: [
          'https://www.googleapis.com/auth/webmasters.readonly',
          'https://www.googleapis.com/auth/analytics.readonly',
        ],
      });
      manager.getTokenForGrant.mockResolvedValue(token);

      const result = await ctx.getToken('google');

      expect(result.scopes).toEqual([]);
    });

    it('delegates to manager.getTokenForGrant with correct params', async () => {
      const manager = makeManager();
      const credentials: CredentialDeclaration[] = [
        {
          provider: 'google',
          scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
          reason: 'Access Search Console',
        },
      ];
      const ctx = new AgentCredentialsContext(manager, credentials, 'my-agent', 'my-site');

      manager.getTokenForGrant.mockResolvedValue(makeToken());

      await ctx.getToken('google');

      expect(manager.getTokenForGrant).toHaveBeenCalledWith(
        'google',
        'my-agent',
        'my-site',
      );
    });
  });

  describe('getStatus', () => {
    it('throws NotConnectedError if provider not in manifest', async () => {
      const manager = makeManager();
      const credentials: CredentialDeclaration[] = [];
      const ctx = new AgentCredentialsContext(manager, credentials, 'seo-agent', 'site-1');

      await expect(ctx.getStatus('google')).rejects.toThrow(NotConnectedError);
      expect(manager.getStatusForAgent).not.toHaveBeenCalled();
    });

    it('returns status from manager', async () => {
      const manager = makeManager();
      const credentials: CredentialDeclaration[] = [
        {
          provider: 'google',
          scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
          reason: 'Access Search Console',
        },
      ];
      const ctx = new AgentCredentialsContext(manager, credentials, 'seo-agent', 'site-1');

      manager.getStatusForAgent.mockResolvedValue('active');

      const result = await ctx.getStatus('google');

      expect(result).toBe('active');
      expect(manager.getStatusForAgent).toHaveBeenCalledWith('google', 'seo-agent', 'site-1');
    });

    it('returns revoked status', async () => {
      const manager = makeManager();
      const credentials: CredentialDeclaration[] = [
        {
          provider: 'google',
          scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
          reason: 'Access Search Console',
        },
      ];
      const ctx = new AgentCredentialsContext(manager, credentials, 'seo-agent', 'site-1');

      manager.getStatusForAgent.mockResolvedValue('revoked');

      const result = await ctx.getStatus('google');

      expect(result).toBe('revoked');
    });

    it('returns error status', async () => {
      const manager = makeManager();
      const credentials: CredentialDeclaration[] = [
        {
          provider: 'google',
          scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
          reason: 'Access Search Console',
        },
      ];
      const ctx = new AgentCredentialsContext(manager, credentials, 'seo-agent', 'site-1');

      manager.getStatusForAgent.mockResolvedValue('error');

      const result = await ctx.getStatus('google');

      expect(result).toBe('error');
    });
  });

  describe('requestConnection', () => {
    it('throws NotConnectedError if provider not in manifest', async () => {
      const manager = makeManager();
      const credentials: CredentialDeclaration[] = [];
      const ctx = new AgentCredentialsContext(manager, credentials, 'seo-agent', 'site-1');

      await expect(ctx.requestConnection('google')).rejects.toThrow(NotConnectedError);
      expect(manager.requestConnectionForAgent).not.toHaveBeenCalled();
    });

    it('delegates to manager.requestConnectionForAgent', async () => {
      const manager = makeManager();
      const credentials: CredentialDeclaration[] = [
        {
          provider: 'google',
          scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
          reason: 'Access Search Console',
        },
      ];
      const ctx = new AgentCredentialsContext(manager, credentials, 'seo-agent', 'site-1');

      manager.requestConnectionForAgent.mockResolvedValue(undefined);

      await ctx.requestConnection('google');

      expect(manager.requestConnectionForAgent).toHaveBeenCalledWith(
        'google',
        'seo-agent',
        'site-1',
      );
    });
  });

  describe('multiple credentials', () => {
    it('supports multiple declared providers', async () => {
      const manager = makeManager();
      const credentials: CredentialDeclaration[] = [
        {
          provider: 'google',
          scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
          reason: 'Access Search Console',
        },
      ];
      const ctx = new AgentCredentialsContext(manager, credentials, 'seo-agent', 'site-1');

      manager.getTokenForGrant.mockResolvedValue(makeToken());

      await ctx.getToken('google');

      expect(manager.getTokenForGrant).toHaveBeenCalledWith('google', 'seo-agent', 'site-1');
    });

    it('throws for non-declared provider even with multiple declarations', async () => {
      const manager = makeManager();
      const credentials: CredentialDeclaration[] = [
        {
          provider: 'google',
          scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
          reason: 'Access Search Console',
        },
      ];
      const ctx = new AgentCredentialsContext(manager, credentials, 'seo-agent', 'site-1');

      await expect(ctx.getToken('github')).rejects.toThrow(NotConnectedError);
    });
  });
});
