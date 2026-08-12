/**
 * P0-2: the GraphQL `nexusUpdateSettings` mutation backs the `nexus settings set` CLI, which
 * shares the GraphQL bearer token with the renderer and can be driven by any AI with shell
 * access. It must NOT be able to change the remote write-gate (remoteOperationPermissions /
 * site exceptions) — those are settable only from the human Settings UI (IPC).
 */
import { createResolvers } from '../../../src/main/graphql/resolvers';
import { STORAGE_KEYS } from '../../../src/common/constants';

function makeCtx() {
  const store: Record<string, any> = {};
  let writes = 0;
  const context = {
    services: {
      registryStorage: {
        get: (k: string) => store[k],
        set: (k: string, v: any) => { store[k] = v; writes++; },
      },
      onSettingsUpdated: jest.fn(),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    },
    registry: {},
  } as any;
  return { context, store, writes: () => writes };
}

describe('nexusUpdateSettings GraphQL resolver — permission keys blocked (P0-2)', () => {
  it('refuses to flip remoteOperationPermissions.delete.production and writes nothing', () => {
    const { context, writes } = makeCtx();
    const resolvers: any = createResolvers(context);
    const res = resolvers.Mutation.nexusUpdateSettings(null, {
      key: 'remoteOperationPermissions.delete.production',
      value: 'true',
    });
    expect(res.success).toBe(false);
    expect(writes()).toBe(0);
  });

  it('refuses a permission-key patch and writes nothing', () => {
    const { context, writes } = makeCtx();
    const resolvers: any = createResolvers(context);
    const res = resolvers.Mutation.nexusUpdateSettings(null, {
      patch: JSON.stringify({ wpeOperationPermissions: { push: { production: true } } }),
    });
    expect(res.success).toBe(false);
    expect(writes()).toBe(0);
  });

  it('still applies a benign setting', () => {
    const { context, store, writes } = makeCtx();
    const resolvers: any = createResolvers(context);
    const res = resolvers.Mutation.nexusUpdateSettings(null, { key: 'autoIndex', value: 'true' });
    expect(res.success).toBe(true);
    expect(writes()).toBe(1);
    expect(store[STORAGE_KEYS.SETTINGS].autoIndex).toBe(true);
  });
});
