/**
 * Streaming parser for a Local mysqldump — `app/sql/local.sql`.
 *
 * MEASURED across 38 real dumps, 8,037,391 INSERT statements (see the fleet survey this is
 * built from): Local's `SiteDatabaseService.dump()` invokes `mysqldump --extended-insert=FALSE`,
 * so every INSERT statement carries exactly one row, is not multi-line (0 of 8,037,391 lacked a
 * terminating `;`), and uses only backslash-escaped single-quoted strings — no `_binary '...'`
 * literals, no `0x...` hex literals, observed anywhere in the fleet. The parser below still
 * declines gracefully on those and on a genuinely truncated line rather than guessing, because
 * "not observed in this fleet" is not "cannot occur in another one".
 */

export type SqlValue = string | null;

export interface ParsedInsert {
  table: string;
  rows: SqlValue[][];
}

const NULL_LITERAL = 'NULL';

/** MySQL's backslash escape table, as mysqldump emits it (never doubled-quote escaping). */
function unescape(code: string): string {
  switch (code) {
    case 'n': return '\n';
    case 'r': return '\r';
    case 't': return '\t';
    case '0': return '\0';
    case 'Z': return '\x1a';
    case 'b': return '\b';
    default: return code; // \\ , \' , \" and anything else pass the literal character through
  }
}

/**
 * Scan a single-quoted string literal starting at `s[i] === "'"`.
 * Returns `null` if the string runs off the end of the line unterminated — a genuinely truncated
 * or corrupted line, which the caller must treat as unparseable, never as an empty value.
 */
function scanString(s: string, i: number): [string, number] | null {
  const out: string[] = [];
  i++; // past the opening quote
  for (;;) {
    const c = s[i];
    if (c === undefined) return null;
    if (c === '\\') {
      const e = s[i + 1];
      if (e === undefined) return null;
      out.push(unescape(e));
      i += 2;
      continue;
    }
    if (c === "'") return [out.join(''), i + 1];
    out.push(c);
    i++;
  }
}

/**
 * Parse one `INSERT INTO \`table\` VALUES (v1,v2,...),(v1,v2,...);` line.
 *
 * Returns `null` for anything that is not a recognizable single-line INSERT of this exact shape
 * — `_binary '...'` and `0x...` literals included, since this parser does not special-case them.
 * A caller must treat `null` as "could not parse this line", never as "zero rows".
 */
export function parseInsertLine(line: string): ParsedInsert | null {
  const head = line.match(/^INSERT INTO `([^`]+)` VALUES /);
  if (!head) return null;
  const table = head[1];
  let i = head[0].length;
  const rows: SqlValue[][] = [];

  while (i < line.length) {
    if (line[i] !== '(') return rows.length ? { table, rows } : null;
    i++;
    const vals: SqlValue[] = [];
    let cur = '';

    for (;;) {
      const c = line[i];
      if (c === undefined) return null; // ran off the end mid-row — truncated, not zero rows

      if (c === "'") {
        if (cur.trim().length) return null; // a quote appearing mid-bare-token is not this grammar
        const scanned = scanString(line, i);
        if (!scanned) return null;
        vals.push(scanned[0]);
        i = scanned[1];
        continue;
      }
      if (c === ',') {
        if (cur.length) { vals.push(cur.trim() === NULL_LITERAL ? null : cur.trim()); cur = ''; }
        i++;
        continue;
      }
      if (c === ')') {
        if (cur.length) { vals.push(cur.trim() === NULL_LITERAL ? null : cur.trim()); cur = ''; }
        i++;
        break;
      }
      cur += c;
      i++;
    }

    rows.push(vals);
    if (line[i] === ',') { i++; continue; }
    if (line[i] === ';') { i++; break; }
    // Anything else here (trailing garbage) means this was not a clean single statement.
    return null;
  }

  // `break` above only exits the row loop, not the function — text after the terminating `;`
  // (or a truncated statement with no `;` at all) must still be rejected here, not accepted as
  // if it belonged to a clean single-line statement.
  return line.slice(i).trim().length === 0 ? { table, rows } : null;
}
