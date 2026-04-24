import { withQueue } from '../../../src/main/graphql/resolver-utils';

describe('withQueue', () => {
  test('executes the wrapped function and returns its result', async () => {
    const result = await withQueue(async () => 42);
    expect(result).toBe(42);
  });

  test('returns object results unchanged', async () => {
    const result = await withQueue(async () => ({ success: true, data: 'hello' }));
    expect(result).toEqual({ success: true, data: 'hello' });
  });

  test('propagates rejection from wrapped function', async () => {
    await expect(
      withQueue(async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
  });

  test('limits concurrency to 3', async () => {
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 6 }, () =>
      withQueue(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
      })
    );
    await Promise.all(tasks);
    expect(maxActive).toBe(3);
  });
});
