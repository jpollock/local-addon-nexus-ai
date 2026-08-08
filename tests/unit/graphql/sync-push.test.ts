/**
 * nexusSyncPush is the only GraphQL resolver that calls the Tier-3 tool
 * `local_wpe_push` directly through `registry.call()`. Its only real caller is
 * `nexus sync push` (src/cli/commands/sync.ts), which now always confirms with
 * the user itself before sending this mutation -- so the resolver must always
 * pass `requireConfirmation: false` through to the registry, trusting the CLI
 * prompt to be the one and only confirmation. If a future edit drops that 5th
 * argument, this test catches it: the mutation would start returning
 * `requiresConfirmation` JSON that the CLI (and any other future caller) has
 * no way to act on.
 */

import { createResolvers } from '../../../src/main/graphql/resolvers';
import type { NexusServices } from '../../../src/main/types/nexus-services';
import type { ToolRegistry } from '../../../src/main/mcp/tool-registry';

function makeServices(): NexusServices {
  const site = { id: 'site-1', name: 'mysite', path: '/sites/mysite', domain: 'mysite.local' };

  return {
    vectorStore: {} as any,
    embeddingService: {} as any,
    contentPipeline: {} as any,
    indexRegistry: { get: jest.fn(), listAll: jest.fn().mockReturnValue([]) } as any,
    fileScanner: {} as any,
    siteData: {
      getSites: jest.fn().mockReturnValue({ [site.id]: site }),
      getSite: jest.fn().mockReturnValue(site),
    },
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    localServices: {
      getSiteStatus: jest.fn().mockReturnValue('running'),
      capiGetInstalls: jest.fn().mockResolvedValue([
        { id: 'install-1', name: 'myinstall', environment: 'staging' },
      ]),
    } as any,
  } as unknown as NexusServices;
}

describe('nexusSyncPush resolver', () => {
  it('calls registry.call for local_wpe_push with requireConfirmation: false', async () => {
    const registry = {
      call: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ status: 'queued' }) }],
      }),
    } as unknown as ToolRegistry;

    const services = makeServices();
    const resolvers = createResolvers({ registry, services });

    const result = await (resolvers.Mutation as any).nexusSyncPush(undefined, {
      input: {
        localSite: 'mysite@local',
        wpeTarget: 'wpe:myaccount/myinstall@staging',
        includeDb: false,
        dbOnly: false,
        filesOnly: true,
        create: false,
      },
    });

    expect(registry.call).toHaveBeenCalledTimes(1);
    expect(registry.call).toHaveBeenCalledWith(
      'local_wpe_push',
      expect.objectContaining({ site: 'mysite' }),
      services,
      'cli',
      false,
    );
    expect(result.success).toBe(true);
  });
});
