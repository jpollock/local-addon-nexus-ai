/**
 * D11 — a null username is one unreadable row, never a dead metadata sync.
 *
 * Measured on qwerky 2026-08-24: `wp user list` returns 5,004 users and
 * 5,003 carry user_login null (the wp_users rows are intact — the seeded
 * users lack capabilities meta, so wp-cli emits ID-only rows). The insert of
 * one null into the NOT NULL username column aborted the entire sync on
 * every sweep. The rule: skip the row, count it, state it — and the site
 * keeps its wp_version, plugins and themes.
 */
import { WPESyncService } from '../../../src/main/events/WPESyncService';

function makeService(userJson: string) {
  const upsertUser = jest.fn(async (u: any) => {
    if (u.username == null) throw new Error('NOT NULL constraint failed: users.username');
  });
  const warn = jest.fn();
  const service = new WPESyncService({
    graphService: {
      getDb: () => null,
      upsertSite: jest.fn(), upsertUser,
      deletePlugins: jest.fn(), upsertPlugin: jest.fn(),
      deleteThemes: jest.fn(), upsertTheme: jest.fn(),
    } as any,
    localServices: {
      remoteWpCliRun: jest.fn(async (_i: string, args: string[]) => {
        if (args.includes('user')) return { stdout: userJson, success: true };
        return { stdout: '[]', success: true };
      }),
    } as any,
    logger: { info: jest.fn(), warn, error: jest.fn(), debug: jest.fn() },
  });
  return { service, upsertUser, warn };
}

async function sync(service: WPESyncService) {
  await (service as any).syncInstallInner(
    { install_id: 'i1', install_name: 'qwerky', environment: 'production', primary_domain: 'q.wpengine.com' },
    'wpe-q1',
  );
}

describe('D11 — the users write is honest per row', () => {
  test('null-username rows are skipped and counted; readable rows still land', async () => {
    const { service, upsertUser, warn } = makeService(JSON.stringify([
      { ID: 1, user_login: 'qwerky', roles: 'administrator' },
      { ID: 11, user_login: null, roles: '' },
      { ID: 101, user_login: null, roles: '' },
    ]));

    await sync(service);

    expect(upsertUser).toHaveBeenCalledTimes(1);                       // only the readable row
    expect(upsertUser.mock.calls[0][0].username).toBe('qwerky');
    const line = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(line).toContain('2 of 3');                                  // counted
    expect(line).toContain('unreadable');                              // stated
  });

  test('an all-null user list no longer kills the sync — the site keeps its metadata', async () => {
    const { service, upsertUser } = makeService(JSON.stringify([
      { ID: 11, user_login: null, roles: '' },
    ]));

    await expect(sync(service)).resolves.not.toThrow();
    expect(upsertUser).not.toHaveBeenCalled();
  });
});

describe('the generalised shield (round: any-other-tables audit)', () => {
  test('a PHP notice ahead of the plugin JSON no longer silently empties the section', async () => {
    const upsertPlugin = jest.fn();
    const warn = jest.fn();
    const service = new WPESyncService({
      graphService: {
        getDb: () => null, upsertSite: jest.fn(), upsertUser: jest.fn(),
        deletePlugins: jest.fn(), upsertPlugin,
      } as any,
      localServices: {
        remoteWpCliRun: jest.fn(async (_i: string, args: string[]) => {
          if (args.includes('plugin')) {
            return { stdout: 'PHP Notice: something deprecated\n[{"name":"akismet","title":"Akismet","status":"active","version":"5.3"}]', success: true };
          }
          return { stdout: '[]', success: true };
        }),
      } as any,
      logger: { info: jest.fn(), warn, error: jest.fn(), debug: jest.fn() },
    });

    await (service as any).syncInstallInner(
      { install_id: 'i1', install_name: 'qwerky', environment: 'production', primary_domain: 'q.wpengine.com' },
      'wpe-q1',
    );

    expect(upsertPlugin).toHaveBeenCalledTimes(1);
    expect(upsertPlugin.mock.calls[0][0].slug).toBe('akismet');
  });

  test('one constraint-violating plugin row no longer kills the section', async () => {
    const upsertPlugin = jest.fn(async (p: any) => {
      if (p.slug == null) throw new Error('NOT NULL constraint failed: plugins.slug');
    });
    const warn = jest.fn();
    const service = new WPESyncService({
      graphService: {
        getDb: () => null, upsertSite: jest.fn(), upsertUser: jest.fn(),
        deletePlugins: jest.fn(), upsertPlugin,
      } as any,
      localServices: {
        remoteWpCliRun: jest.fn(async (_i: string, args: string[]) => {
          if (args.includes('plugin')) {
            return { stdout: JSON.stringify([
              { name: null, title: null, status: 'active', version: '1' },
              { name: 'akismet', title: 'Akismet', status: 'active', version: '5.3' },
            ]), success: true };
          }
          return { stdout: '[]', success: true };
        }),
      } as any,
      logger: { info: jest.fn(), warn, error: jest.fn(), debug: jest.fn() },
    });

    await (service as any).syncInstallInner(
      { install_id: 'i1', install_name: 'qwerky', environment: 'production', primary_domain: 'q.wpengine.com' },
      'wpe-q1',
    );

    expect(upsertPlugin).toHaveBeenCalledTimes(2);                      // both attempted
    const good = upsertPlugin.mock.calls.find((c) => c[0].slug === 'akismet');
    expect(good).toBeTruthy();                                          // the good row landed
    expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('1 of 2');
  });
});
