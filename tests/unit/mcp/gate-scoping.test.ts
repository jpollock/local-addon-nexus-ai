import { isGatedHost } from '../../../src/main/mcp/utils/operation-permissions';

describe('isGatedHost', () => {
  it('gates remote hosts', () => {
    expect(isGatedHost('wpe')).toBe(true);
    expect(isGatedHost('external')).toBe(true);
  });

  it('never gates local', () => {
    expect(isGatedHost('local')).toBe(false);
  });

  it('gates an unknown host — fails closed', () => {
    expect(isGatedHost('something-new')).toBe(true);
    expect(isGatedHost(undefined)).toBe(true);
  });
});

describe('local sites are never subject to remote permission settings', () => {
  it('a permissive-to-nobody config still cannot block a local site', () => {
    // The user has locked down every environment, including development.
    const lockedDown = {
      remoteOperationPermissions: {
        wpcli: { development: false, staging: false, production: false },
      },
    } as any;

    // A local site must not consult these settings at all.
    expect(isGatedHost('local')).toBe(false);

    // Guard the reasoning too: were a local site ever routed through the gate
    // with environment='development', this is what would happen to it.
    const { isOperationAllowed } = require('../../../src/main/mcp/utils/operation-permissions');
    expect(isOperationAllowed('wpcli', 'development', lockedDown, 'local:site-1')).toBe(false);
  });
});
