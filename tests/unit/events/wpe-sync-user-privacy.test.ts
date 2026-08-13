import { WPESyncService } from '../../../src/main/events/WPESyncService';

/**
 * P1-6: the WPE metadata sync ran `wp user list` unbounded (all fields) and wrote user_email for
 * every user of the install into graph.db (a 0644 file) — the full customer list of a
 * WooCommerce/membership site, collected under a "sync" the user opted into for a different
 * purpose. Drop the email at BOTH ends: never request it over the wire (--fields), and never
 * store it (email: null).
 */
describe('WPESyncService — user sync does not harvest emails (P1-6)', () => {
  function makeService() {
    const calls: string[][] = [];
    const upsertUser = jest.fn().mockResolvedValue(1);
    const graphService: any = {
      upsertSite: jest.fn().mockResolvedValue(undefined),
      deletePlugins: jest.fn().mockResolvedValue(undefined),
      upsertPlugin: jest.fn().mockResolvedValue(undefined),
      upsertUser,
    };
    const localServices: any = {
      remoteWpCliRun: jest.fn(async (_name: string, args: string[]) => {
        calls.push(args);
        if (args[0] === 'core') return { stdout: '6.5', success: true };
        if (args[0] === 'plugin') return { stdout: '[]', success: true };
        if (args[0] === 'user') {
          return {
            stdout: JSON.stringify([
              { ID: 1, user_login: 'admin', user_email: 'secret@customer.com', roles: 'administrator' },
            ]),
            success: true,
          };
        }
        return { stdout: '', success: true };
      }),
    };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const service = new WPESyncService({
      graphService,
      localServices,
      remoteContentExtractor: { extract: jest.fn() } as any,
      embeddingService: { embedBatch: jest.fn() } as any,
      vectorStore: { upsert: jest.fn() } as any,
      logger,
    });
    return { service, calls, upsertUser };
  }

  const install: any = {
    install_id: 'install-1',
    install_name: 'prod-shop',
    primary_domain: 'shop.example.com',
    php_version: '8.2',
    account_id: 'acct-1',
    environment: 'production',
    wpe_site_id: 'site-1',
  };

  it('requests only ID, login and roles over the wire — never the email', async () => {
    const { service, calls } = makeService();
    await service.syncInstall(install);

    const userCall = calls.find((a) => a[0] === 'user' && a[1] === 'list');
    expect(userCall).toBeDefined();
    expect(userCall).toContain('--fields=ID,user_login,roles');
  });

  it('stores email as null even if a raw email somehow comes back', async () => {
    const { service, upsertUser } = makeService();
    await service.syncInstall(install);

    expect(upsertUser).toHaveBeenCalledWith(expect.objectContaining({ username: 'admin', email: null }));
    expect(upsertUser).not.toHaveBeenCalledWith(
      expect.objectContaining({ email: 'secret@customer.com' }),
    );
  });
});
