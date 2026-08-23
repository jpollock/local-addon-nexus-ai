/**
 * D15 — an account with no SSH gateway is a stated fact, not 73 recurring
 * failures.
 *
 * Measured 2026-08-23: all 73 installs of one account (esm5z2bl7u8vqk,
 * "AutoscaleAlpha") return NXDOMAIN for <install>.ssh.wpengine.net — the
 * Autoscale platform does not provision the classic per-install SSH gateway.
 * CAPI lists every install as live, so they are not stale rows (the
 * reconciliation correctly retired zero). This module records the fact once
 * per account and lets every SSH consumer skip with a reason instead of
 * rediscovering the absence as a pile of red rows every sweep.
 */
import Database from 'better-sqlite3';
import {
  refreshSshGatewayStatus,
  accountsWithoutSshGateway,
  sshGatewayUnavailableReason,
  SSH_GATEWAY_RECHECK_MS,
} from '../../../src/main/transport/wpeGatewayStatus';

const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE wpe_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, nickname TEXT);`);
  db.prepare("INSERT INTO wpe_accounts VALUES ('acct-auto','esm5z2bl7u8vqk','AutoscaleAlpha')").run();
  db.prepare("INSERT INTO wpe_accounts VALUES ('acct-ok','normalacct',NULL)").run();
  return db;
}

const nxdomain = () => Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
const timeout = () => Object.assign(new Error('queryA ETIMEOUT'), { code: 'ETIMEOUT' });

describe('refreshSshGatewayStatus', () => {
  test('NXDOMAIN marks the account unavailable; a resolving host marks it available', async () => {
    const db = makeDb();
    const resolver = jest.fn(async (host: string) => {
      if (host.startsWith('jpmeautoscale.')) throw nxdomain();
    });

    await refreshSshGatewayStatus(
      db,
      new Map([['acct-auto', 'jpmeautoscale'], ['acct-ok', 'cedarvalehealt']]),
      silent,
      resolver,
    );

    const missing = accountsWithoutSshGateway(db);
    expect([...missing.keys()]).toEqual(['acct-auto']);
    expect(missing.get('acct-auto')).toBe('AutoscaleAlpha'); // nickname preferred
    expect(sshGatewayUnavailableReason(db, 'acct-ok')).toBeNull();
  });

  test('a transient resolver error changes NOTHING — absence needs proof, not a hiccup', async () => {
    const db = makeDb();
    await refreshSshGatewayStatus(db, new Map([['acct-ok', 'cedarvalehealt']]), silent,
      async () => { throw timeout(); });

    expect(accountsWithoutSshGateway(db).size).toBe(0);
    expect(sshGatewayUnavailableReason(db, 'acct-ok')).toBeNull();
  });

  test('a fresh verdict is not re-probed; a stale one is', async () => {
    const db = makeDb();
    const resolver = jest.fn(async () => { throw nxdomain(); });
    const t0 = 1_000_000_000_000;

    await refreshSshGatewayStatus(db, new Map([['acct-auto', 'jpmeautoscale']]), silent, resolver, t0);
    await refreshSshGatewayStatus(db, new Map([['acct-auto', 'jpmeautoscale']]), silent, resolver, t0 + 60_000);
    expect(resolver).toHaveBeenCalledTimes(1); // fresh — no second probe

    await refreshSshGatewayStatus(
      db, new Map([['acct-auto', 'jpmeautoscale']]), silent, resolver,
      t0 + SSH_GATEWAY_RECHECK_MS + 1,
    );
    expect(resolver).toHaveBeenCalledTimes(2); // stale — re-probed
  });

  test('a gateway that appears later flips the account back to available', async () => {
    const db = makeDb();
    const t0 = 1_000_000_000_000;
    await refreshSshGatewayStatus(db, new Map([['acct-auto', 'jpmeautoscale']]), silent,
      async () => { throw nxdomain(); }, t0);
    expect(accountsWithoutSshGateway(db).size).toBe(1);

    await refreshSshGatewayStatus(db, new Map([['acct-auto', 'jpmeautoscale']]), silent,
      async () => undefined, t0 + SSH_GATEWAY_RECHECK_MS + 1);
    expect(accountsWithoutSshGateway(db).size).toBe(0);
  });

  test('the reason names the account in the user words, with the D15 shape', async () => {
    const db = makeDb();
    await refreshSshGatewayStatus(db, new Map([['acct-auto', 'jpmeautoscale']]), silent,
      async () => { throw nxdomain(); });

    const reason = sshGatewayUnavailableReason(db, 'acct-auto')!;
    expect(reason).toContain('AutoscaleAlpha');
    expect(reason).toMatch(/no SSH gateway/i);
  });

  test('a null db, a missing table, and a throwing resolver are all non-fatal', async () => {
    await expect(refreshSshGatewayStatus(null as never, new Map([['a', 'b']]), silent, async () => undefined))
      .resolves.toBeUndefined();
    const bare = new Database(':memory:'); // no wpe_accounts table at all
    await expect(refreshSshGatewayStatus(bare, new Map([['a', 'b']]), silent, async () => undefined))
      .resolves.toBeUndefined();
    expect(accountsWithoutSshGateway(bare).size).toBe(0);
    expect(sshGatewayUnavailableReason(null as never, 'x')).toBeNull();
  });
});
