import { registerLifecycleHooks, LifecycleContext, Logger } from '../../src/main/content/lifecycle-hooks';
import { ContentPipeline } from '../../src/main/content/ContentPipeline';
import { IndexRegistry, RegistryStorage } from '../../src/main/content/IndexRegistry';

function createMockStorage(): RegistryStorage {
  const store = new Map<string, any>();
  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, value: any) => store.set(key, value),
  };
}

describe('registerLifecycleHooks', () => {
  let hooks: Record<string, Function>;
  let context: LifecycleContext;
  let pipeline: jest.Mocked<ContentPipeline>;
  let indexRegistry: IndexRegistry;
  let logger: jest.Mocked<Logger>;

  beforeEach(() => {
    hooks = {};
    context = {
      hooks: {
        addAction: (name: string, cb: Function) => {
          hooks[name] = cb;
        },
      },
    };

    pipeline = {
      indexSite: jest.fn().mockResolvedValue({
        siteId: 'site1',
        documentsIndexed: 5,
        chunksIndexed: 8,
        durationMs: 200,
        errors: [],
      }),
      removeSite: jest.fn().mockResolvedValue(undefined),
      cancelSite: jest.fn().mockResolvedValue(undefined),
    } as any;

    indexRegistry = new IndexRegistry(createMockStorage());

    logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };

    registerLifecycleHooks(context, pipeline, indexRegistry, logger);
  });

  test('registers siteStarted, siteStopped, and siteRemoved hooks', () => {
    expect(hooks.siteStarted).toBeDefined();
    expect(hooks.siteStopped).toBeDefined();
    expect(hooks.siteRemoved).toBeDefined();
  });

  test('siteStarted triggers indexSite', async () => {
    await hooks.siteStarted({ id: 'site1', name: 'My Site', path: '/tmp/site' });

    expect(pipeline.indexSite).toHaveBeenCalledWith({
      siteId: 'site1',
      siteName: 'My Site',
      sitePath: '/tmp/site',
    });
    expect(logger.info).toHaveBeenCalled();
  });

  test('siteStarted logs errors without throwing', async () => {
    pipeline.indexSite.mockRejectedValue(new Error('boom'));

    await hooks.siteStarted({ id: 'site1', name: 'My Site', path: '/tmp/site' });

    expect(logger.error).toHaveBeenCalled();
  });

  test('siteStopped does not change index state', async () => {
    // siteStopped no longer marks indexes stale — stopping a site doesn't invalidate
    // its content; the index remains valid until content actually changes.
    indexRegistry.update('site1', { state: 'indexed', siteName: 'My Site' });

    await hooks.siteStopped({ id: 'site1', name: 'My Site', path: '/tmp/site' });

    const entry = indexRegistry.get('site1');
    expect(entry!.state).toBe('indexed');
  });

  test('siteRemoved calls removeSite', async () => {
    await hooks.siteRemoved({ id: 'site1', name: 'My Site', path: '/tmp/site' });

    expect(pipeline.removeSite).toHaveBeenCalledWith('site1');
  });

  test('siteRemoved logs cleanup errors without throwing', async () => {
    pipeline.removeSite.mockRejectedValue(new Error('cleanup failed'));

    await hooks.siteRemoved({ id: 'site1', name: 'My Site', path: '/tmp/site' });

    expect(logger.error).toHaveBeenCalled();
  });

  test('registers siteDeleted hook', () => {
    expect(hooks.siteDeleted).toBeDefined();
  });

  test('siteDeleted calls cancelSite on pipeline', async () => {
    (pipeline as any).cancelSite = jest.fn().mockResolvedValue(undefined);

    await hooks.siteDeleted({ id: 'site1', name: 'My Site', path: '/tmp/site' });

    expect((pipeline as any).cancelSite).toHaveBeenCalledWith('site1');
  });

  test('siteDeleted calls removeSite on pipeline', async () => {
    (pipeline as any).cancelSite = jest.fn().mockResolvedValue(undefined);

    await hooks.siteDeleted({ id: 'site1', name: 'My Site', path: '/tmp/site' });

    expect(pipeline.removeSite).toHaveBeenCalledWith('site1');
  });

  test('siteDeleted invalidates metadata cache', async () => {
    (pipeline as any).cancelSite = jest.fn().mockResolvedValue(undefined);
    const metadataCache = {
      invalidate: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
    } as any;

    registerLifecycleHooks(context, pipeline, indexRegistry, logger, undefined, undefined, undefined, metadataCache);

    await hooks.siteDeleted({ id: 'site1', name: 'My Site', path: '/tmp/site' });

    expect(metadataCache.invalidate).toHaveBeenCalledWith('site1');
  });

  test('siteDeleted logs cancellation message', async () => {
    (pipeline as any).cancelSite = jest.fn().mockResolvedValue(undefined);

    await hooks.siteDeleted({ id: 'site1', name: 'My Site', path: '/tmp/site' });

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Site being deleted'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Cleanup complete'),
    );
  });

  test('siteDeleted logs errors without throwing', async () => {
    (pipeline as any).cancelSite = jest.fn().mockRejectedValue(new Error('cancel failed'));

    await hooks.siteDeleted({ id: 'site1', name: 'My Site', path: '/tmp/site' });

    expect(logger.error).toHaveBeenCalled();
  });
});

describe('readyPromise gate', () => {
  let hooks: Record<string, Function>;
  let context: LifecycleContext;
  let pipeline: jest.Mocked<ContentPipeline>;
  let indexRegistry: IndexRegistry;
  let logger: jest.Mocked<Logger>;

  function createMockStorage(): RegistryStorage {
    const store = new Map<string, any>();
    return {
      get: (key: string) => store.get(key) ?? null,
      set: (key: string, value: any) => store.set(key, value),
    };
  }

  beforeEach(() => {
    hooks = {};
    context = {
      hooks: {
        addAction: (name: string, cb: Function) => {
          hooks[name] = cb;
        },
      },
    };

    pipeline = {
      indexSite: jest.fn().mockResolvedValue({
        siteId: 'site1',
        documentsIndexed: 5,
        chunksIndexed: 8,
        durationMs: 200,
        errors: [],
      }),
      removeSite: jest.fn().mockResolvedValue(undefined),
      cancelSite: jest.fn().mockResolvedValue(undefined),
    } as any;

    indexRegistry = new IndexRegistry(createMockStorage());

    logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
  });

  test('siteStarted waits for readyPromise before indexing', async () => {
    let resolveReady!: () => void;
    const readyPromise = new Promise<void>((resolve) => { resolveReady = resolve; });

    registerLifecycleHooks(context, pipeline, indexRegistry, logger, readyPromise);

    // Start the hook but don't await it yet
    const hookPromise = hooks.siteStarted({ id: 'site1', name: 'My Site', path: '/tmp/site' });

    // Pipeline should NOT have been called yet
    expect(pipeline.indexSite).not.toHaveBeenCalled();

    // Now resolve readiness
    resolveReady();
    await hookPromise;

    // Now it should have been called
    expect(pipeline.indexSite).toHaveBeenCalled();
  });

  test('siteStarted skips indexing if readyPromise rejects', async () => {
    const readyPromise = Promise.reject(new Error('init failed'));

    registerLifecycleHooks(context, pipeline, indexRegistry, logger, readyPromise);

    await hooks.siteStarted({ id: 'site1', name: 'My Site', path: '/tmp/site' });

    expect(pipeline.indexSite).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Services failed to initialize'),
    );
  });

  test('siteStarted works without readyPromise (backward compat)', async () => {
    registerLifecycleHooks(context, pipeline, indexRegistry, logger);

    await hooks.siteStarted({ id: 'site1', name: 'My Site', path: '/tmp/site' });

    expect(pipeline.indexSite).toHaveBeenCalled();
  });
});
