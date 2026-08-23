/**
 * D15 — per-account SSH gateway availability, established once and stated,
 * not rediscovered as failures every sweep.
 *
 * Measured 2026-08-23: all 73 installs of one account (esm5z2bl7u8vqk,
 * "AutoscaleAlpha") return NXDOMAIN for `<install>.ssh.wpengine.net` — the
 * Autoscale platform does not provision the classic per-install SSH gateway.
 * CAPI lists every one of those installs as live (the reconciliation correctly
 * retired zero), so this is a platform fact about the account, not stale data
 * — and before this module every fleet sweep re-learned it as 73 red rows.
 *
 * The verdict is DNS, probed on ONE install per account and cached on
 * `wpe_accounts` with a recheck interval, because gateway provisioning is an
 * account-level property (verified: 73/73 on the one account, 0 anywhere
 * else). Three rules:
 *
 *  - **Absence needs proof.** Only a definitive NXDOMAIN/ENODATA marks an
 *    account unavailable; a timeout or resolver hiccup changes nothing —
 *    marking a live account gateway-less would silently stop indexing it,
 *    which is the D15 problem inverted.
 *  - **The verdict expires.** Re-probed after SSH_GATEWAY_RECHECK_MS, so a
 *    gateway WP Engine provisions later is noticed within a day, not never.
 *  - **Everything is non-fatal.** A missing table, a null db, a throwing
 *    resolver — consumers proceed as if every gateway exists, which is
 *    exactly the pre-D15 behaviour.
 */
import { lookup } from 'dns/promises';

interface MinimalLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

interface DbLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
}

export const SSH_GATEWAY_RECHECK_MS = 24 * 3600_000;

/** Definitive "this name does not exist" — the only codes that prove absence. */
const ABSENCE_CODES = new Set(['ENOTFOUND', 'ENODATA']);

const defaultResolver = async (hostname: string): Promise<unknown> => lookup(hostname);

function ensureColumns(db: DbLike): boolean {
  try {
    for (const col of ['ssh_gateway TEXT', 'ssh_gateway_checked_at INTEGER']) {
      const name = col.split(' ')[0];
      const exists = db
        .prepare("SELECT COUNT(*) AS c FROM pragma_table_info('wpe_accounts') WHERE name = ?")
        .get(name) as { c: number } | undefined;
      if (!exists?.c) db.exec(`ALTER TABLE wpe_accounts ADD COLUMN ${col}`);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe one install per account and record the verdict. `installsByAccount`
 * maps account id -> any one of its install names; the caller (the CAPI sync)
 * already holds that list.
 */
export async function refreshSshGatewayStatus(
  db: DbLike | null | undefined,
  installsByAccount: Map<string, string>,
  logger: MinimalLogger,
  resolver: (hostname: string) => Promise<unknown> = defaultResolver,
  now: number = Date.now(),
): Promise<void> {
  try {
    if (!db || installsByAccount.size === 0) return;
    if (!ensureColumns(db)) return;

    await Promise.all(
      [...installsByAccount.entries()].map(async ([accountId, installName]) => {
        try {
          const row = db
            .prepare('SELECT ssh_gateway, ssh_gateway_checked_at FROM wpe_accounts WHERE id = ?')
            .get(accountId) as { ssh_gateway?: string | null; ssh_gateway_checked_at?: number | null } | undefined;
          if (!row) return; // account not mirrored yet — next sync will carry it
          const fresh = row.ssh_gateway && row.ssh_gateway_checked_at
            && now - row.ssh_gateway_checked_at < SSH_GATEWAY_RECHECK_MS;
          if (fresh) return;

          let verdict: 'available' | 'unavailable' | undefined;
          try {
            await resolver(`${installName}.ssh.wpengine.net`);
            verdict = 'available';
          } catch (err) {
            const code = (err as { code?: string })?.code;
            if (code && ABSENCE_CODES.has(code)) verdict = 'unavailable';
            // Anything else is a hiccup, not evidence — leave the verdict alone.
          }
          if (!verdict) return;

          if (verdict === 'unavailable' && row.ssh_gateway !== 'unavailable') {
            logger.warn(
              `[wpeGatewayStatus] Account ${accountId} has no SSH gateway `
              + `(${installName}.ssh.wpengine.net is NXDOMAIN) — its installs will be `
              + 'reported as not indexable rather than failed (D15).',
            );
          }
          db.prepare(
            'UPDATE wpe_accounts SET ssh_gateway = ?, ssh_gateway_checked_at = ? WHERE id = ?',
          ).run(verdict, now, accountId);
        } catch {
          /* one account's probe must not affect another's */
        }
      }),
    );
  } catch (err) {
    logger.error(`[wpeGatewayStatus] refresh failed (non-fatal): ${(err as Error).message}`);
  }
}

/** Accounts confirmed gateway-less: id -> display name (nickname preferred). */
export function accountsWithoutSshGateway(db: DbLike | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  try {
    if (!db) return out;
    const rows = db
      .prepare("SELECT id, name, nickname FROM wpe_accounts WHERE ssh_gateway = 'unavailable'")
      .all() as Array<{ id: string; name: string; nickname?: string | null }>;
    for (const r of rows) out.set(r.id, r.nickname || r.name);
  } catch {
    /* no table / no columns — nothing is confirmed absent */
  }
  return out;
}

/**
 * The per-site skip reason, or null when SSH should be attempted. Null covers
 * available AND unknown — only a confirmed absence suppresses work.
 */
export function sshGatewayUnavailableReason(
  db: DbLike | null | undefined,
  accountId: string | null | undefined,
): string | null {
  try {
    if (!db || !accountId) return null;
    const row = db
      .prepare("SELECT name, nickname FROM wpe_accounts WHERE id = ? AND ssh_gateway = 'unavailable'")
      .get(accountId) as { name: string; nickname?: string | null } | undefined;
    if (!row) return null;
    const label = row.nickname || row.name;
    return `no SSH gateway on account "${label}" — SSH indexing is unavailable for its installs (D15)`;
  } catch {
    return null;
  }
}
