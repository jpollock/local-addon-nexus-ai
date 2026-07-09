import Database from 'better-sqlite3';
import { fleetSqlHandler } from '../../../src/main/mcp/modules/fleet-intelligence/fleet-sql';

function makeDb(setup: (db: InstanceType<typeof Database>) => void): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, source TEXT, wp_version TEXT, post_count INTEGER, user_count INTEGER, last_post_at INTEGER, is_active INTEGER DEFAULT 1);
    CREATE TABLE plugins (id INTEGER PRIMARY KEY, site_id TEXT, slug TEXT, name TEXT, version TEXT, is_active INTEGER);
  `);
  setup(db);
  return db;
}

function makeServices(db: InstanceType<typeof Database> | null) {
  return { graphService: { getDb: () => db } } as any;
}

function getText(result: any): string {
  return result.content[0].text;
}

describe('fleet_sql MCP tool', () => {
  test('returns error when graphService unavailable', async () => {
    const result = await fleetSqlHandler.execute({ query: 'SELECT 1' }, makeServices(null));
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('not available');
  });

  test('executes a valid SELECT and returns markdown table', async () => {
    const db = makeDb((db) => {
      db.prepare("INSERT INTO sites VALUES ('s1','mysite','local','7.0',42,3,1716000000,1)").run();
    });
    const result = await fleetSqlHandler.execute(
      { query: 'SELECT name, post_count FROM sites' },
      makeServices(db),
    );
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('mysite');
    expect(text).toContain('42');
    expect(text).toContain('|');
  });

  test('rejects DROP TABLE', async () => {
    const db = makeDb(() => {});
    const result = await fleetSqlHandler.execute({ query: 'DROP TABLE sites' }, makeServices(db));
    expect(result.isError).toBe(true);
    expect(getText(result)).toMatch(/only select|disallowed/i);
  });

  test('rejects INSERT', async () => {
    const db = makeDb(() => {});
    const result = await fleetSqlHandler.execute(
      { query: "INSERT INTO sites VALUES ('x','y','local','7.0',0,0,0,1)" },
      makeServices(db),
    );
    expect(result.isError).toBe(true);
  });

  test('rejects semicolons (injection guard)', async () => {
    const db = makeDb(() => {});
    const result = await fleetSqlHandler.execute(
      { query: 'SELECT 1; DROP TABLE sites' },
      makeServices(db),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Semicolons');
  });

  test('returns no-rows message when nothing matches', async () => {
    const db = makeDb(() => {});
    const result = await fleetSqlHandler.execute(
      { query: "SELECT * FROM sites WHERE source = 'wpe'" },
      makeServices(db),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('No rows');
  });

  test('aggregation: SUM post_count across sites', async () => {
    const db = makeDb((db) => {
      db.prepare("INSERT INTO sites VALUES ('s1','a','local','7.0',10,1,0,1)").run();
      db.prepare("INSERT INTO sites VALUES ('s2','b','local','7.0',30,2,0,1)").run();
    });
    const result = await fleetSqlHandler.execute(
      { query: 'SELECT SUM(post_count) as total FROM sites' },
      makeServices(db),
    );
    expect(result.isError).toBeFalsy();
    expect(getText(result)).toContain('40');
  });

  test('SQL error returns error result not exception', async () => {
    const db = makeDb(() => {});
    const result = await fleetSqlHandler.execute(
      { query: 'SELECT * FROM nonexistent_table' },
      makeServices(db),
    );
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('SQL error');
  });

  test('returns error for empty query', async () => {
    const db = makeDb(() => {});
    const result = await fleetSqlHandler.execute({ query: '' }, makeServices(db));
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('required');
  });

  test('returns error when getDb returns null', async () => {
    const services = { graphService: { getDb: () => null } } as any;
    const result = await fleetSqlHandler.execute({ query: 'SELECT 1' }, services);
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('not available');
  });
});
