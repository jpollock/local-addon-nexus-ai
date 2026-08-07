import { WPESyncService } from '../../../src/main/events/WPESyncService';

/**
 * Regression test for the confirmed environment write-path gap found during the
 * site.environment audit: syncContent()'s "piggyback metadata sync" (which reuses the still-warm
 * SSH ControlMaster after a content extraction) used to build its WPEInstallData with a
 * hardcoded `environment: 'production'` literal, regardless of the install's real environment.
 * Because GraphService.upsertSite()'s ON CONFLICT clause applies any non-null `environment` via
 * COALESCE, this silently overwrote a correct 'staging'/'development' value with 'production' on
 * every content re-sync — and the site scope picker now treats `environment === 'production'` as
 * a safety boundary (locks/escalates), so a mislabeled site is a real safety gap, not cosmetic.
 */
describe('WPESyncService — piggyback metadata sync preserves the real environment', () => {
  function makeService(storedEnvironment: string | null) {
    const row = {
      name: 'a-staging-site',
      php_version: '8.2',
      domain: 'a-staging-site.wpengine.com',
      account_id: 'acct-1',
      remote_install_id: 'install-1',
      environment: storedEnvironment,
    };
    const db = { prepare: jest.fn(() => ({ get: jest.fn(() => row) })) };
    const upsertSite = jest.fn().mockResolvedValue(undefined);
    const graphService: any = {
      getDb: () => db,
      upsertContent: jest.fn().mockResolvedValue(undefined),
      upsertSite,
    };

    const remoteContentExtractor: any = {
      extract: jest.fn().mockResolvedValue({
        posts: [{
          id: 1, postType: 'post', title: 'Hello', postStatus: 'publish',
          author: 'admin', date: '2026-01-01T00:00:00Z', cleanedContent: 'body text', excerpt: '',
        }],
      }),
    };
    const embeddingService: any = { embedBatch: jest.fn().mockResolvedValue([[0.1, 0.2]]) };
    const vectorStore: any = { upsert: jest.fn().mockResolvedValue(undefined) };
    const localServices: any = {
      remoteWpCliRun: jest.fn().mockResolvedValue({ stdout: '', success: true }),
    };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

    const service = new WPESyncService({
      graphService, localServices, remoteContentExtractor, embeddingService, vectorStore, logger,
    });
    return { service, upsertSite, logger };
  }

  it('reuses the site\'s real stored environment instead of hardcoding "production"', async () => {
    const { service, upsertSite } = makeService('staging');
    await (service as any).syncContent('wpe-install-1', 'a-staging-site');

    // First call is the content-indexing path's own upsertSite (none here — syncContent doesn't
    // call it directly), so the piggyback's syncInstall() call is upsertSite's only invocation.
    expect(upsertSite).toHaveBeenCalledWith(expect.objectContaining({ environment: 'staging' }));
    expect(upsertSite).not.toHaveBeenCalledWith(expect.objectContaining({ environment: 'production' }));
  });

  it('falls back to "production" only when the row genuinely has no environment on record', async () => {
    const { service, upsertSite } = makeService(null);
    await (service as any).syncContent('wpe-install-2', 'no-env-site');

    expect(upsertSite).toHaveBeenCalledWith(expect.objectContaining({ environment: 'production' }));
  });
});
