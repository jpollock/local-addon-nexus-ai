import { registerLifecycleHooks } from '../../src/main/content/lifecycle-hooks';

describe('Lifecycle Hooks — readyPromise gate', () => {
  test('siteStarted hook waits for readyPromise before indexing', async () => {
    let resolveReady!: () => void;
    const readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    const logger = { info: jest.fn(), error: jest.fn() };
    const mockPipeline = {
      indexSite: jest.fn().mockResolvedValue({
        documentsIndexed: 5,
        chunksIndexed: 8,
        durationMs: 100,
        errors: [],
      }),
      removeSite: jest.fn(),
    } as any;
    const mockRegistry = { update: jest.fn() } as any;

    const context = { hooks: { addAction: jest.fn() } };
    registerLifecycleHooks(context as any, mockPipeline, mockRegistry, logger, readyPromise);

    // Extract the siteStarted callback
    const siteStartedCall = context.hooks.addAction.mock.calls.find(
      (c: any[]) => c[0] === 'siteStarted',
    );
    expect(siteStartedCall).toBeDefined();
    const siteStartedCallback = siteStartedCall![1];

    // Fire siteStarted BEFORE resolving readyPromise
    const callbackPromise = siteStartedCallback({
      id: 'test-site',
      name: 'Test',
      path: '/tmp/test',
    });

    // indexSite should NOT have been called yet
    expect(mockPipeline.indexSite).not.toHaveBeenCalled();

    // Now resolve readyPromise
    resolveReady();

    // Wait for callback to complete
    await callbackPromise;

    // NOW indexSite should have been called
    expect(mockPipeline.indexSite).toHaveBeenCalledTimes(1);
  });

  test('siteStarted hook skips indexing if readyPromise rejects', async () => {
    const readyPromise = Promise.reject(new Error('Init failed'));
    // Prevent unhandled rejection
    readyPromise.catch(() => {});

    const logger = { info: jest.fn(), error: jest.fn() };
    const mockPipeline = { indexSite: jest.fn() } as any;
    const mockRegistry = { update: jest.fn() } as any;

    const context = { hooks: { addAction: jest.fn() } };
    registerLifecycleHooks(context as any, mockPipeline, mockRegistry, logger, readyPromise);

    const siteStartedCallback = context.hooks.addAction.mock.calls.find(
      (c: any[]) => c[0] === 'siteStarted',
    )?.[1];

    await siteStartedCallback({ id: 'test', name: 'Test', path: '/tmp' });

    expect(mockPipeline.indexSite).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Services failed to initialize'),
    );
  });

  test('siteStopped hook marks index as stale', async () => {
    const logger = { info: jest.fn(), error: jest.fn() };
    const mockPipeline = {} as any;
    const mockRegistry = { update: jest.fn() } as any;

    const context = { hooks: { addAction: jest.fn() } };
    registerLifecycleHooks(context as any, mockPipeline, mockRegistry, logger);

    const siteStoppedCallback = context.hooks.addAction.mock.calls.find(
      (c: any[]) => c[0] === 'siteStopped',
    )?.[1];

    await siteStoppedCallback({ id: 'test', name: 'Test', path: '/tmp' });
    expect(mockRegistry.update).toHaveBeenCalledWith('test', { state: 'stale' });
  });

  test('siteRemoved hook calls removeSite for cleanup', async () => {
    const logger = { info: jest.fn(), error: jest.fn() };
    const mockPipeline = { removeSite: jest.fn().mockResolvedValue(undefined) } as any;
    const mockRegistry = { update: jest.fn() } as any;

    const context = { hooks: { addAction: jest.fn() } };
    registerLifecycleHooks(context as any, mockPipeline, mockRegistry, logger);

    const siteRemovedCallback = context.hooks.addAction.mock.calls.find(
      (c: any[]) => c[0] === 'siteRemoved',
    )?.[1];

    await siteRemovedCallback({ id: 'test', name: 'Test', path: '/tmp' });
    expect(mockPipeline.removeSite).toHaveBeenCalledWith('test');
  });
});
