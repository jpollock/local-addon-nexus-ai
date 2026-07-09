/**
 * Tests for the MySQL readiness poll logic added to metadataRefreshPromise.
 *
 * We can't instantiate the full lifecycle hook (it requires Local's service
 * container), so we test the poll logic in isolation by extracting its
 * behavior through a helper that matches what the hook does.
 */

const POLL_TIMEOUT_MS = 30_000;

interface PollResult { success: boolean; stdout?: string | null }

/**
 * Mirrors the poll loop added to metadataRefreshPromise in lifecycle-hooks.ts.
 * Returns true when DB is ready, false if timeout expires.
 */
async function pollUntilDbReady(
  wpCliRun: (args: string[], opts: { timeoutMs: number }) => Promise<PollResult>,
  timeoutMs = POLL_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(deadline - Date.now(), 1000);
    const probe = await wpCliRun(['eval', "echo 'db_ready';"], {
      timeoutMs: Math.min(remaining, 10_000),
    });
    if (probe.success && probe.stdout?.trim() === 'db_ready') return true;
    await new Promise((r) => setTimeout(r, 10)); // short sleep for test speed
  }
  return false;
}

describe('MySQL readiness poll', () => {
  test('returns true immediately when WP-CLI succeeds on first call', async () => {
    const wpCliRun = jest.fn().mockResolvedValue({ success: true, stdout: 'db_ready' });
    const ready = await pollUntilDbReady(wpCliRun, 5_000);
    expect(ready).toBe(true);
    expect(wpCliRun).toHaveBeenCalledTimes(1);
  });

  test('retries and succeeds on third attempt when MySQL is slow', async () => {
    const wpCliRun = jest.fn()
      .mockResolvedValueOnce({ success: false, stdout: '' })
      .mockResolvedValueOnce({ success: false, stdout: '' })
      .mockResolvedValueOnce({ success: true, stdout: 'db_ready' });

    const ready = await pollUntilDbReady(wpCliRun, 5_000);
    expect(ready).toBe(true);
    expect(wpCliRun).toHaveBeenCalledTimes(3);
  });

  test('returns false when timeout expires before DB is ready', async () => {
    const wpCliRun = jest.fn().mockResolvedValue({ success: false, stdout: '' });
    const ready = await pollUntilDbReady(wpCliRun, 50); // 50ms — expires quickly
    expect(ready).toBe(false);
  });

  test('does not proceed if WP-CLI returns success=true but wrong stdout', async () => {
    const wpCliRun = jest.fn()
      .mockResolvedValueOnce({ success: true, stdout: 'something_else' }) // wrong output
      .mockResolvedValueOnce({ success: true, stdout: 'db_ready' });      // correct

    const ready = await pollUntilDbReady(wpCliRun, 5_000);
    expect(ready).toBe(true);
    expect(wpCliRun).toHaveBeenCalledTimes(2);
  });

  test('handles WP-CLI rejection (exception) gracefully and keeps polling', async () => {
    // WP-CLI throws on the first call (e.g. timeout), succeeds on second
    const wpCliRun = jest.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ success: true, stdout: 'db_ready' });

    // Need a wrapper that catches like the hook does
    async function pollWithCatch(
      fn: typeof wpCliRun, timeoutMs: number,
    ): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const remaining = Math.max(deadline - Date.now(), 1000);
        try {
          const probe = await fn(['eval', "echo 'db_ready';"], { timeoutMs: Math.min(remaining, 10_000) });
          if (probe.success && probe.stdout?.trim() === 'db_ready') return true;
        } catch { /* not ready */ }
        await new Promise((r) => setTimeout(r, 10));
      }
      return false;
    }

    const ready = await pollWithCatch(wpCliRun, 5_000);
    expect(ready).toBe(true);
    expect(wpCliRun).toHaveBeenCalledTimes(2);
  });
});
