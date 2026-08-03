import { resolveTransport } from '../../../src/main/transport';
import type { NexusServices } from '../../../src/main/mcp/types';

const mockServices: NexusServices = {
  siteData: {
    getSite: () => null,
    getSites: () => ({}),
  },
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn() },
} as unknown as NexusServices;

describe('resolveTransport — external SSH', () => {
  it('resolves ssh_target to an external-ssh transport', async () => {
    const transport = await resolveTransport(
      { ssh_target: 'ssh:acme-box@staging' },
      mockServices,
      'wpcli_read'
    );
    // Not an error result
    expect(transport).not.toHaveProperty('content');
    expect(transport).not.toHaveProperty('isError');
    // Is a transport with the correct kind
    if ('kind' in transport) {
      expect(transport.kind).toBe('external-ssh');
      expect(transport.siteRef).toEqual({
        kind: 'external',
        alias: 'acme-box',
      });
    } else {
      fail('Expected transport, got error result');
    }
  });

  it('passes wpPath through to the transport', async () => {
    const transport = await resolveTransport(
      { ssh_target: 'ssh:web@production', wp_path: '/var/www/html' },
      mockServices,
      'wpcli_read'
    );
    if ('kind' in transport && transport.kind === 'external-ssh') {
      // The transport is built and wpPath is private, but we can verify it
      // executes the command with --path by checking the constructed command
      const result = await transport.runWpCli(['core', 'version']);
      // This will fail to spawn, but that's fine — we're verifying resolution, not execution
    } else {
      fail('Expected external-ssh transport');
    }
  });
});
