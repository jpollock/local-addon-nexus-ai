/**
 * fixes-082526 · permissions packet, phase 4 — the account write bound
 * (owner ruling 2/B, 2026-08-26).
 *
 * The designer's sheet drew "Accounts this bound covers" as part of the write
 * bound; the only live account scope (`wpeAccountFilter`) scoped SYNCING, and
 * a permissions surface must never display a scope that does not bind. This
 * makes it bind: a WPE install whose account is excluded refuses every WRITE
 * (`pull`, `wpcli`, `push`, `delete` — pull is a write for scope purposes,
 * the sheet's own first example being "Copy a site down"), while
 * `wpcli_read` stays allowed — reading is stated once, not a decision.
 *
 * Rules pinned:
 *  - the exclusion is WHOLE (§6): a per-site ALLOW exception cannot punch
 *    through an excluded account;
 *  - unresolvable-fails-closed, but ONLY while exclusions exist — an empty
 *    list keeps the dimension inert and yesterday's behavior byte-identical;
 *  - the dimension reaches WPE-shaped targets alone; ssh:/local refs are
 *    governed by their own machinery.
 */
import {
  isOperationAllowed,
  setInstallAccountResolver,
  installAccountFromCache,
} from '../../../src/main/mcp/utils/operation-permissions';
import { STORAGE_KEYS } from '../../../src/common/constants';

const EXCLUDED = 'acct-excluded-uuid';
const INCLUDED = 'acct-included-uuid';

const settingsWith = (excluded: string[]) => ({
  remoteOperationPermissions: {},
  remoteSiteExceptions: [] as Array<{ targetRef: string; environment: string; overrides: Record<string, boolean> }>,
  wpeOperationPermissions: undefined,
  wpeSiteExceptions: undefined,
  wpeWriteExcludedAccounts: excluded,
});

afterEach(() => setInstallAccountResolver(undefined));

describe('the account write bound', () => {
  beforeEach(() => {
    setInstallAccountResolver((installName) =>
      installName === 'clientsite' ? EXCLUDED : installName === 'oursite' ? INCLUDED : undefined,
    );
  });

  it('an excluded account refuses every write on every environment', () => {
    for (const op of ['pull', 'wpcli', 'push', 'delete'] as const) {
      for (const env of ['development', 'staging', 'production']) {
        expect(isOperationAllowed(op, env, settingsWith([EXCLUDED]) as never, 'wpe:clientsite')).toBe(false);
      }
    }
  });

  it('reading is not a decision: wpcli_read stays allowed on an excluded account', () => {
    expect(isOperationAllowed('wpcli_read', 'production', settingsWith([EXCLUDED]) as never, 'wpe:clientsite')).toBe(true);
  });

  it('a non-excluded account keeps yesterday\'s behavior exactly', () => {
    expect(isOperationAllowed('wpcli', 'staging', settingsWith([EXCLUDED]) as never, 'wpe:oursite')).toBe(true);
    expect(isOperationAllowed('wpcli', 'production', settingsWith([EXCLUDED]) as never, 'wpe:oursite')).toBe(false);
  });

  it('the exclusion is WHOLE: a per-site ALLOW exception cannot punch through', () => {
    const settings = {
      ...settingsWith([EXCLUDED]),
      remoteSiteExceptions: [
        { targetRef: 'wpe:clientsite', environment: 'staging', overrides: { wpcli: true } },
      ],
    } as never;
    expect(isOperationAllowed('wpcli', 'staging', settings, 'wpe:clientsite')).toBe(false);
  });

  it('an unresolvable install fails CLOSED while exclusions exist', () => {
    expect(isOperationAllowed('wpcli', 'staging', settingsWith([EXCLUDED]) as never, 'wpe:mystery')).toBe(false);
  });

  it('with an EMPTY exclusion list the dimension is inert — even for unresolvable installs', () => {
    expect(isOperationAllowed('wpcli', 'staging', settingsWith([]) as never, 'wpe:mystery')).toBe(true);
  });

  it('ssh targets are outside the account dimension', () => {
    expect(isOperationAllowed('wpcli', 'staging', settingsWith([EXCLUDED]) as never, 'ssh:myhost/site')).toBe(true);
  });

  it('a bare install name is wpe-shaped (the auto-prefix)', () => {
    expect(isOperationAllowed('push', 'staging', settingsWith([EXCLUDED]) as never, 'clientsite')).toBe(false);
  });
});

describe('no resolver registered (startup order)', () => {
  it('exclusions set + no resolver → writes fail closed; empty list stays inert', () => {
    expect(isOperationAllowed('wpcli', 'staging', settingsWith([EXCLUDED]) as never, 'wpe:oursite')).toBe(false);
    expect(isOperationAllowed('wpcli', 'staging', settingsWith([]) as never, 'wpe:oursite')).toBe(true);
  });
});

describe('installAccountFromCache — the resolver index.ts registers', () => {
  it('reads accountId from the install cache; unknown installs and old caches answer undefined', () => {
    const kv = new Map<string, unknown>([
      [STORAGE_KEYS.WPE_INSTALL_CACHE, {
        installs: [
          { installName: 'clientsite', accountId: EXCLUDED },
          { installName: 'legacyentry' }, // pre-phase-4 cache rows carry no accountId
        ],
      }],
    ]);
    const resolve = installAccountFromCache({ get: (k: string) => kv.get(k) ?? null });
    expect(resolve('clientsite')).toBe(EXCLUDED);
    expect(resolve('legacyentry')).toBeUndefined();
    expect(resolve('ghost')).toBeUndefined();
  });
});
