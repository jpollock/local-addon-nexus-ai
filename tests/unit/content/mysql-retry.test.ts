import { connectWithRetry } from '../../../src/main/content/MySQLExtractor';

describe('connectWithRetry', () => {
  it('returns connection on first success', async () => {
    const fakeConnect = jest.fn().mockResolvedValue({ end: async () => {} });
    const conn = await connectWithRetry(fakeConnect, 3, 10);
    expect(fakeConnect).toHaveBeenCalledTimes(1);
    expect(conn).toBeDefined();
  });

  it('retries on failure and succeeds on second attempt', async () => {
    let calls = 0;
    const fakeConnect = jest.fn().mockImplementation(async () => {
      calls++;
      if (calls < 2) throw new Error('ENOENT: socket not found');
      return { end: async () => {} };
    });
    const conn = await connectWithRetry(fakeConnect, 3, 10);
    expect(fakeConnect).toHaveBeenCalledTimes(2);
    expect(conn).toBeDefined();
  });

  it('throws after max retries exhausted', async () => {
    const fakeConnect = jest.fn().mockRejectedValue(new Error('ENOENT'));
    await expect(connectWithRetry(fakeConnect, 3, 10)).rejects.toThrow('ENOENT');
    expect(fakeConnect).toHaveBeenCalledTimes(3);
  });
});
