import { fleetSqlHandler } from '../../../src/main/mcp/modules/fleet-intelligence/fleet-sql';

function servicesWithRows(rows: Record<string, unknown>[]) {
  const db = { prepare: (_sql: string) => ({ all: (..._p: unknown[]) => rows }) };
  return { graphService: { getDb: () => db } } as any;
}

describe('fleet_sql — masks PII in results (P1-6)', () => {
  it('masks admin_email values in the returned table', async () => {
    const services = servicesWithRows([
      { name: 'acme', admin_email: 'owner@acme.com' },
      { name: 'globex', admin_email: 'ceo@globex.io' },
    ]);
    const res = await fleetSqlHandler.execute({ query: 'SELECT name, admin_email FROM sites' }, services);
    const text = res.content[0].text as string;

    expect(text).not.toContain('owner@acme.com');
    expect(text).not.toContain('ceo@globex.io');
    expect(text).toContain('[email redacted]');
    // Non-PII columns survive.
    expect(text).toContain('acme');
    expect(text).toContain('globex');
  });
});
