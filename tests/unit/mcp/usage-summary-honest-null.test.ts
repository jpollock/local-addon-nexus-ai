/**
 * fixes-082526 · Tier A 6 (O3) — the usage summary never prints NaN.
 *
 * Observed live: the tool rendered "Visits: NaN" / "Bandwidth: NaN GB" when
 * CAPI returned a value the ?? chain found but Number() could not read. NaN
 * is the one output worse than nothing — it looks like a number the user
 * should worry about. The rule everywhere else in this codebase: a value
 * that cannot be determined is withheld ('—'), never fabricated.
 */
import { getAccountUsageSummaryHandler } from '../../../src/main/mcp/modules/wpe/get-account-usage-summary';

function servicesReturning(payload: unknown) {
  return {
    localServices: { capiDirect: jest.fn(async () => payload) },
  } as never;
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => c.text ?? '').join('\n');
}

const run = async (payload: unknown) =>
  textOf(await getAccountUsageSummaryHandler.execute({ account_id: 'acc-1' }, servicesReturning(payload)));

describe('wpe_get_account_usage_summary — honest NULL at the formatting site', () => {
  it('renders real numbers as numbers', async () => {
    const out = await run({ visit_count: 12345, network_total_bytes: 2.5e9, storage_bytes: 1e9 });
    expect(out).toContain('12,345');
    expect(out).toContain('2.5 GB');
    expect(out).toContain('1 GB');
    expect(out).not.toContain('NaN');
  });

  it('withholds a value Number() cannot read — never NaN', async () => {
    const out = await run({
      visit_count: 'unavailable',
      network_total_bytes: { total: 5e9 }, // nested where a scalar was expected
      storage_bytes: 'abc',
    });
    expect(out).not.toContain('NaN');
    expect(out).toContain('**Visits:** —');
    expect(out).toContain('**Bandwidth:** —');
    expect(out).toContain('**Storage:** —');
  });

  it('withholds absent fields as before', async () => {
    const out = await run({});
    expect(out).toContain('**Visits:** —');
    expect(out).toContain('**Bandwidth:** —');
    expect(out).not.toContain('NaN');
  });
});
