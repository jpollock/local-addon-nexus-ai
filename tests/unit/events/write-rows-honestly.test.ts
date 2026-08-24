/**
 * The D11 lesson, generalised: every remote-fed write loop is honest PER ROW.
 * One unwritable row is skipped and counted with its reason — never a dead
 * section, never a fabricated value.
 */
import { writeRowsHonestly } from '../../../src/main/events/writeRowsHonestly';

const ctx = () => {
  const warn = jest.fn();
  return { subject: 'qwerky', label: 'user', logger: { warn }, warn };
};

describe('writeRowsHonestly', () => {
  test('a constraint violation is one skipped row; the rest still land, the reason is stated', async () => {
    const c = ctx();
    const written: number[] = [];
    const result = await writeRowsHonestly(
      [1, 2, 3, 4],
      async (n) => {
        if (n === 2) throw new Error('NOT NULL constraint failed: users.username');
        written.push(n);
      },
      c,
    );
    expect(written).toEqual([1, 3, 4]);
    expect(result).toEqual({ written: 3, skipped: 1, firstError: 'NOT NULL constraint failed: users.username' });
    const line = c.warn.mock.calls[0].join(' ');
    expect(line).toContain('1 of 4');
    expect(line).toContain('users.username');
  });

  test('an all-bad section never throws, and states the full loss', async () => {
    const c = ctx();
    const result = await writeRowsHonestly([1, 2], async () => { throw new Error('boom'); }, c);
    expect(result.written).toBe(0);
    expect(result.skipped).toBe(2);
    expect(c.warn.mock.calls[0].join(' ')).toContain('2 of 2');
  });

  test('a clean section stays silent — no warning for nothing', async () => {
    const c = ctx();
    await writeRowsHonestly([1], async () => {}, c);
    expect(c.warn).not.toHaveBeenCalled();
  });
});
