// tests/unit/sentinel/sqlDump.test.ts
//
// Slice 3: parsing `mysqldump --extended-insert=FALSE` output without a database.
//
// Ground-truth verified separately: the real parser was run against a real 8.4.0 mysqld loaded
// with a live specimen's dump (a private throwaway instance, torn down after) and every count
// and every flagged row ID matched exactly. These tests pin the character-level parsing rules
// that made that possible.

import { parseInsertLine } from '../../../src/main/sentinel/scanner/db/sqlDump';

describe('parseInsertLine — must-parse corpus', () => {
  it('parses a simple row', () => {
    const r = parseInsertLine("INSERT INTO `wp_options` VALUES (1,'siteurl','http://x','yes');");
    expect(r).toEqual({ table: 'wp_options', rows: [['1', 'siteurl', 'http://x', 'yes']] });
  });

  it('parses NULL as null, not the string "NULL"', () => {
    const r = parseInsertLine("INSERT INTO `t` VALUES (1,NULL,'x');");
    expect(r!.rows[0]).toEqual(['1', null, 'x']);
  });

  it('parses multiple rows in one statement', () => {
    const r = parseInsertLine("INSERT INTO `t` VALUES (1,'a'),(2,'b'),(3,'c');");
    expect(r!.rows).toEqual([['1', 'a'], ['2', 'b'], ['3', 'c']]);
  });

  it('unescapes \\n \\r \\t \\0 \\\\ \\\' \\"', () => {
    const r = parseInsertLine("INSERT INTO `t` VALUES ('a\\nb\\rc\\td\\0e\\\\f\\'g\\\"h');");
    expect(r!.rows[0][0]).toBe('a\nb\rc\td\0e\\f\'g"h');
  });

  it("a literal single quote inside content, escaped, does not terminate the string", () => {
    const r = parseInsertLine("INSERT INTO `t` VALUES (1,'It\\'s different');");
    expect(r!.rows[0][1]).toBe("It's different");
  });

  it('preserves an embedded literal comma inside a quoted value', () => {
    const r = parseInsertLine("INSERT INTO `t` VALUES (1,'a,b,c',2);");
    expect(r!.rows[0]).toEqual(['1', 'a,b,c', '2']);
  });

  it('preserves an embedded literal close-paren inside a quoted value', () => {
    const r = parseInsertLine("INSERT INTO `t` VALUES (1,'a)b',2);");
    expect(r!.rows[0]).toEqual(['1', 'a)b', '2']);
  });

  it('handles a long serialized-PHP-shaped value untouched', () => {
    const serialized = 'a:2:{i:0;s:5:"hello";i:1;b:1;}';
    const r = parseInsertLine(`INSERT INTO \`t\` VALUES (1,'${serialized}');`);
    expect(r!.rows[0][1]).toBe(serialized);
  });

  it('reads a negative number and a decimal as bare tokens', () => {
    const r = parseInsertLine("INSERT INTO `t` VALUES (-5,3.14,'x');");
    expect(r!.rows[0]).toEqual(['-5', '3.14', 'x']);
  });

  it('extracts the table name from a backtick-quoted identifier', () => {
    const r = parseInsertLine("INSERT INTO `wp_usermeta` VALUES (1,1,'nickname','admin');");
    expect(r!.table).toBe('wp_usermeta');
  });
});

describe('parseInsertLine — must-decline corpus', () => {
  it('returns null for a non-INSERT line', () => {
    expect(parseInsertLine('-- comment')).toBeNull();
    expect(parseInsertLine('CREATE TABLE `t` (`a` int);')).toBeNull();
  });

  it('returns null for a line truncated mid-string (never invents an empty value)', () => {
    const r = parseInsertLine("INSERT INTO `t` VALUES (1,'unterminated");
    expect(r).toBeNull();
  });

  it('returns null for a line truncated mid-row (no closing paren or semicolon)', () => {
    const r = parseInsertLine("INSERT INTO `t` VALUES (1,'a'");
    expect(r).toBeNull();
  });

  it('returns null when a quote appears where a bare token was being built', () => {
    // Not valid SQL-literal grammar for this parser's scope — decline rather than guess.
    const r = parseInsertLine("INSERT INTO `t` VALUES (1a'b',2);");
    expect(r).toBeNull();
  });

  it('returns null for trailing content after the terminating semicolon', () => {
    const r = parseInsertLine("INSERT INTO `t` VALUES (1,'a'); garbage");
    expect(r).toBeNull();
  });
});
