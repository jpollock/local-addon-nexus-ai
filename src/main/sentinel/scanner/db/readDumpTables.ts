import * as fs from 'fs';
import * as readline from 'readline';
import { parseInsertLine, SqlValue } from './sqlDump';

export interface DumpTableResult {
  /** Rows for each requested table, in dump order (not necessarily post/comment date order). */
  rows: Record<string, SqlValue[][]>;
  /** Rows dropped because their column count did not match what the caller expected for that
   *  table — a WordPress core table with a plugin-added column, or dump corruption. Dropped,
   *  never guessed at: attributing a value to the wrong column is worse than missing the row. */
  malformed: Record<string, number>;
  /** Lines that started `INSERT INTO` for a wanted table but did not parse at all. */
  unparseable: number;
  linesRead: number;
  /** `mysqldump`'s own trailer. Its absence means the file predates a completed run — a crash,
   *  a killed process, disk full — and the dump must not be treated as a complete export. */
  hasCompletionMarker: boolean;
}

/**
 * Stream a Local mysqldump, keeping only rows for the requested tables.
 *
 * `expectedColumns` gates each table's rows against WordPress core's own column count for that
 * table — not a schema the caller invents, but the CREATE TABLE order verified against a real
 * dump when this was built (wp_posts 23, wp_options 4, wp_usermeta 4, wp_users 10, wp_comments
 * 15). A mismatch drops the row into `malformed` rather than misattributing a value to the
 * wrong field.
 */
export async function readDumpTables(
  filePath: string,
  expectedColumns: Record<string, number>,
): Promise<DumpTableResult> {
  const wanted = new Set(Object.keys(expectedColumns));
  const rows: Record<string, SqlValue[][]> = {};
  const malformed: Record<string, number> = {};
  for (const t of wanted) { rows[t] = []; malformed[t] = 0; }

  let linesRead = 0;
  let unparseable = 0;
  let hasCompletionMarker = false;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'latin1' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    linesRead++;
    if (line.startsWith('-- Dump completed on')) { hasCompletionMarker = true; continue; }
    // Cheap prefilter before the regex/table-name check — every table this scanner ever wants
    // is a WordPress core table with a short, fixed name suffix.
    if (line.charCodeAt(0) !== 73 /* 'I' */) continue;
    const tableMatch = line.match(/^INSERT INTO `([a-zA-Z0-9_]+)`/);
    if (!tableMatch) continue;
    if (!wanted.has(tableMatch[1])) continue;

    const parsed = parseInsertLine(line);
    if (!parsed) { unparseable++; continue; }

    const want = expectedColumns[parsed.table];
    for (const row of parsed.rows) {
      if (row.length !== want) { malformed[parsed.table]++; continue; }
      rows[parsed.table].push(row);
    }
  }

  return { rows, malformed, unparseable, linesRead, hasCompletionMarker };
}
