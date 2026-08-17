/**
 * WP-14 · the PUSH handler's sync detail.
 *
 * Its sibling assertions live in `BackupGateHandlers.test.ts`, but the push
 * success path is unreachable there: `BackupGate` polls CAPI on a wall-clock
 * timer, which is why that file's own success-path test is `it.skip`ped. The
 * gate is stubbed here so the handler's post-gate behaviour is actually
 * executed rather than assumed — an unpinned `register()` call is exactly how
 * the detail would rot back to the inference-only path.
 */
jest.mock('../../../src/main/safety/BackupGate', () => ({
  BackupGate: class {
    async requireBackup() {
      return { success: true, backup: { type: 'remote', backupId: 'b-1', installId: 'i-1', createdAt: 0 } };
    }
  },
}));

import { wpePushHandler } from '../../../src/main/mcp/modules/wpe/wpe-push';

function services() {
  return {
    logger: { info: jest.fn(), error: jest.fn() },
    siteData: {
      getSite: jest.fn((id: string) => ({ id, name: 'Test Site', domain: 'test.local' })),
      getSites: jest.fn(() => []),
    },
    localServices: {
      getSiteStatus: jest.fn(() => 'running'),
      resolveSiteObject: jest.fn(() => ({
        hostConnections: {
          wpe: { hostId: 'wpe', remoteSiteId: 'remote-uuid', remoteSiteEnv: 'staging' },
        },
      })),
      capiGetInstalls: jest.fn(async () => [
        {
          id: 'install-uuid',
          name: 'testsitestg',
          environment: 'staging',
          site: { id: 'remote-uuid' },
          primaryDomain: 'testsitestg.wpengine.com',
        },
      ]),
      wpePush: { push: jest.fn(() => Promise.resolve()) },
    },
    operationTracker: { register: jest.fn() },
    registryStorage: {
      get: jest.fn(() => ({
        remoteOperationPermissions: {
          staging: { read: true, wpcli: true, pull: true, push: true, delete: true },
        },
        remoteSiteExceptions: [],
      })),
    },
  } as any;
}

test('a push declares its install, its environment and whether the database went with it', async () => {
  const svc = services();
  const result = await wpePushHandler.execute({ site: 'test-site', include_database: true }, svc);

  expect(result.isError).not.toBeTruthy();
  expect(svc.localServices.wpePush.push).toHaveBeenCalled();
  expect(svc.operationTracker.register).toHaveBeenCalledWith('test-site', 'Test Site', 'push', {
    installName: 'testsitestg',
    installId: 'install-uuid',
    wpeSiteId: 'remote-uuid',
    // The environment PUSHED TO — not the copy's own. The lineage reader has
    // no other way to know which upstream this sync moved against.
    environment: 'staging',
    includesDb: true,
  });
});

test('a files-only push declares includesDb false', async () => {
  const svc = services();
  await wpePushHandler.execute({ site: 'test-site' }, svc);
  expect(svc.operationTracker.register.mock.calls[0][3].includesDb).toBe(false);
});
