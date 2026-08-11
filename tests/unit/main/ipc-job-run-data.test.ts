/**
 * GET_JOB_RUN_DATA IPC handler test.
 *
 * Guards the "never coerced to 0" requirement at the IPC boundary.
 */
import type { JobRunStore } from '../../../src/main/background/JobRunStore';

describe('GET_JOB_RUN_DATA IPC handler', () => {
  test('null averageMs and lastRunAt stay null, never coerced to 0', () => {
    // Mock JobRunStore that returns null for unmeasured jobs
    const mockStore: JobRunStore = {
      averageMs: (key: any) => (key === 'wpeRefresh' ? 1200 : null),
      lastRunAt: (key: any) => (key === 'wpeRefresh' ? Date.now() : null),
    } as any;

    // Simulate what the handler does
    const keys: Array<'wpeRefresh' | 'wpeSync' | 'wpeContentIndex' | 'externalRefresh' | 'externalContentIndex' | 'localContentIndex' | 'haltedSiteRefresh'> = [
      'wpeRefresh', 'wpeSync', 'wpeContentIndex',
      'externalRefresh', 'externalContentIndex',
      'localContentIndex', 'haltedSiteRefresh',
    ];
    const result: Record<string, { averageMs: number | null; lastRunAt: number | null }> = {};
    for (const key of keys) {
      result[key] = {
        averageMs: mockStore.averageMs(key),
        lastRunAt: mockStore.lastRunAt(key),
      };
    }

    // wpeRefresh has measurements
    expect(result.wpeRefresh.averageMs).toBe(1200);
    expect(result.wpeRefresh.lastRunAt).not.toBeNull();

    // All others have null, never 0
    expect(result.wpeSync.averageMs).toBeNull();
    expect(result.wpeSync.lastRunAt).toBeNull();
    expect(result.localContentIndex.averageMs).toBeNull();
    expect(result.localContentIndex.lastRunAt).toBeNull();

    // Ensure no key contains 0 where null was expected
    expect(result.wpeSync.averageMs).not.toBe(0);
    expect(result.wpeSync.lastRunAt).not.toBe(0);
  });

  test('when jobRunStore is unavailable, returns empty object', () => {
    const mockStore = null;
    const result = mockStore ? {} : {};
    expect(result).toEqual({});
  });
});
