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
    } as any;

    indexRegistry = new IndexRegistry(createMockStorage());

    logger = {
      info: jest.fn(),
      error: jest.fn(),
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

  test('siteStopped marks index stale', async () => {
    // Set up some existing data
    indexRegistry.update('site1', { state: 'indexed', siteName: 'My Site' });

    await hooks.siteStopped({ id: 'site1', name: 'My Site', path: '/tmp/site' });

    const entry = indexRegistry.get('site1');
    expect(entry!.state).toBe('stale');
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
});
