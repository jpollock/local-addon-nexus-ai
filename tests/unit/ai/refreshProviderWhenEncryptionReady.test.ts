import { refreshProviderWhenEncryptionReady } from '../../../src/main/ai/refreshProviderWhenEncryptionReady';

describe('refreshProviderWhenEncryptionReady', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does nothing when encryption is already available at call time', () => {
    const resolveProvider = jest.fn().mockReturnValue({ apiKey: 'wpe_real' });
    const setProviders = jest.fn();

    const cancel = refreshProviderWhenEncryptionReady({
      isEncryptionAvailable: () => true,
      resolveProvider,
      setProviders,
    });

    jest.advanceTimersByTime(60_000);
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(setProviders).not.toHaveBeenCalled();
    cancel();
  });

  it('polls until encryption becomes available, then re-resolves and pushes the corrected provider exactly once', () => {
    let available = false;
    const resolveProvider = jest.fn().mockReturnValue({ apiKey: 'wpe_real_decrypted' });
    const setProviders = jest.fn();

    refreshProviderWhenEncryptionReady({
      isEncryptionAvailable: () => available,
      resolveProvider,
      setProviders,
      intervalMs: 1000,
    });

    // Not available for the first 3 ticks — no resolution yet.
    jest.advanceTimersByTime(3000);
    expect(setProviders).not.toHaveBeenCalled();

    // Becomes available on the 4th tick.
    available = true;
    jest.advanceTimersByTime(1000);

    expect(resolveProvider).toHaveBeenCalledTimes(1);
    expect(setProviders).toHaveBeenCalledTimes(1);
    expect(setProviders).toHaveBeenCalledWith({ apiKey: 'wpe_real_decrypted' });

    // Stops polling after success — no further calls even much later.
    jest.advanceTimersByTime(60_000);
    expect(setProviders).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts and calls onGiveUp, without ever calling setProviders', () => {
    const resolveProvider = jest.fn();
    const setProviders = jest.fn();
    const onGiveUp = jest.fn();

    refreshProviderWhenEncryptionReady({
      isEncryptionAvailable: () => false,
      resolveProvider,
      setProviders,
      onGiveUp,
      intervalMs: 1000,
      maxAttempts: 5,
    });

    jest.advanceTimersByTime(5000);

    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(setProviders).not.toHaveBeenCalled();

    // No further ticks after giving up.
    jest.advanceTimersByTime(60_000);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it('the returned canceller stops polling before it would otherwise succeed', () => {
    const resolveProvider = jest.fn().mockReturnValue({ apiKey: 'x' });
    const setProviders = jest.fn();

    const cancel = refreshProviderWhenEncryptionReady({
      isEncryptionAvailable: () => false,
      resolveProvider,
      setProviders,
      intervalMs: 1000,
    });

    jest.advanceTimersByTime(2000);
    cancel();
    jest.advanceTimersByTime(60_000);

    expect(setProviders).not.toHaveBeenCalled();
  });
});
