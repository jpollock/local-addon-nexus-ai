/**
 * The D11 lesson, generalised: a per-row write loop fed by remote-derived
 * rows must be honest PER ROW. One unwritable row (a NOT NULL violation, a
 * malformed field, any constraint) is one skipped-and-counted row — never a
 * dead section, and never a fabricated value to force the insert through.
 *
 * The schema constraints stay exactly as they are: they are the tripwire.
 * This helper just stops one trip from killing the whole loop, and states
 * the degradation instead of hiding it (qwerky: 5,003 of 5,004 users
 * unreadable — the metadata sync died on row one, every sweep, forever).
 */

export interface WriteRowsResult {
  written: number;
  skipped: number;
  /** The first failure's message — the register's "carry the reason" rule. */
  firstError: string | null;
}

export async function writeRowsHonestly<T>(
  rows: readonly T[],
  write: (row: T) => Promise<unknown>,
  ctx: { subject: string; label: string; logger: { warn: (msg: string, ...rest: unknown[]) => void } },
): Promise<WriteRowsResult> {
  let written = 0;
  let skipped = 0;
  let firstError: string | null = null;
  for (const row of rows) {
    try {
      await write(row);
      written++;
    } catch (err) {
      skipped++;
      if (firstError === null) firstError = err instanceof Error ? err.message : String(err);
    }
  }
  if (skipped > 0) {
    ctx.logger.warn(
      `[writeRows] ${ctx.subject}: ${skipped} of ${rows.length} ${ctx.label} row(s) unwritable — ` +
      `skipped, stated, never fabricated (first: ${firstError})`,
    );
  }
  return { written, skipped, firstError };
}
