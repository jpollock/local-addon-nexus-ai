/**
 * fixes-082526 · permissions packet, phase 5 — the merged pane's derivations.
 *
 * Everything the pane shows is DERIVED here from live inputs; the component
 * places strings. The reissued sheet's pins under test:
 *  - the bound rows come from the shipped operation×place gate (defaults →
 *    per-operation settings), in the customer's words, transports named;
 *  - the account scope is PART OF THE BOUND (ruling 2): included/excluded
 *    from `wpeWriteExcludedAccounts`, names resolved where known, an id kept
 *    verbatim where not — never dropped;
 *  - a grant row states the SET of holders, and its clipped line is derived
 *    from bound × capability, never authored per row;
 *  - the capability → bound-operation `needs` mapping exists ONCE, here.
 */
import {
  deriveBoundView,
  deriveGrantRows,
  holderLine,
} from '../../../src/renderer/components/settings/permissionsPaneModel';

const SETTINGS = {
  remoteOperationPermissions: {},
  remoteSiteExceptions: [],
  wpeWriteExcludedAccounts: ['acct-x'],
} as never;

const ACCOUNTS = [
  { id: 'acct-a', name: 'btwpe' },
  { id: 'acct-x', name: 'dbrains' },
];

const MATRIX_ROWS = [
  {
    capability: 'cap.bulk_plugin_update',
    label: 'Update plugins across sites',
    ceremony: 'strict',
    state: 'materialized', chip: 'Granted', inForce: true,
    holders: ['chat', 'mcp-client', 'security-sentinel'],
    acts: {},
    documentLine: 'rb.bulk-plugin-update · 1.2.0 · 0646cfe11c',
    gatesLines: ['4 of 8 checkpoints the platform can verify.'],
    disarm: null,
  },
  {
    capability: 'cap.promote_environment',
    label: 'Promote one environment to another',
    ceremony: 'strict',
    state: 'never-by-default', chip: 'Never by default', inForce: false,
    holders: [], acts: {},
    documentLine: 'rb.promotion-execute · 1.0.0 · f6da723999',
    gatesLines: [],
    disarm: null,
  },
] as never[];

describe('deriveBoundView', () => {
  it('renders the four write operations in the customer\'s words, defaults applied', () => {
    const bound = deriveBoundView(SETTINGS);
    expect(bound.rows.map((r) => r.op)).toEqual([
      'Copy a site down',
      'Install or update things',
      'Push local changes up',
      'Delete or promote an environment',
    ]);
    const wpcli = bound.rows[1];
    expect(wpcli.transport).toContain('SSH');
    expect(wpcli.states).toEqual(['allowed', 'allowed', 'blocked']); // dev, staging, prod defaults
    expect(bound.rows[3].states).toEqual(['blocked', 'blocked', 'blocked']);
  });

  it('a per-operation setting moves the cell — derived, not restated', () => {
    const bound = deriveBoundView({
      ...(SETTINGS as object),
      remoteOperationPermissions: { push: { staging: false } },
    } as never);
    expect(bound.rows[2].states).toEqual(['allowed', 'blocked', 'blocked']);
  });

  it('reading is stated once, not as a row', () => {
    const bound = deriveBoundView(SETTINGS);
    expect(bound.readingLine).toMatch(/Reading is always allowed/);
    expect(bound.rows.some((r) => /read/i.test(r.op))).toBe(false);
  });
});

describe('the account scope — part of the bound', () => {
  it('splits included/excluded by id, resolving names where known', () => {
    const scope = deriveBoundView(SETTINGS, ACCOUNTS).scope;
    expect(scope.included).toEqual(['btwpe']);
    expect(scope.excluded).toEqual(['dbrains']);
  });

  it('an excluded id with no known name renders the id verbatim — withheld beats dropped', () => {
    const scope = deriveBoundView(
      { ...(SETTINGS as object), wpeWriteExcludedAccounts: ['acct-ghost'] } as never,
      ACCOUNTS,
    ).scope;
    expect(scope.excluded).toEqual(['acct-ghost']);
    expect(scope.included.sort()).toEqual(['btwpe', 'dbrains'].sort());
  });
});

describe('deriveGrantRows — the set, the clipped line, nothing authored per row', () => {
  it('a held row states its holder set and derives its clipped line from the bound', () => {
    const rows = deriveGrantRows(MATRIX_ROWS as never, deriveBoundView(SETTINGS));
    const bulk = rows.find((r) => r.capability === 'cap.bulk_plugin_update')!;
    expect(bulk.holderLine).toBe('granted to 3 grantees');
    // needs 'Install or update things' (blocked on production by default)
    expect(bulk.clippedLine).toMatch(/Blocked on production by the write bound/);
  });

  it('an unheld row has no clipped line — a bound clips only what was granted', () => {
    const rows = deriveGrantRows(MATRIX_ROWS as never, deriveBoundView(SETTINGS));
    const promote = rows.find((r) => r.capability === 'cap.promote_environment')!;
    expect(promote.clippedLine).toBeNull();
    expect(promote.holderLine).toMatch(/no grantee holds/i);
  });
});

describe('holderLine — one names itself, several name the count', () => {
  it('speaks the ruling', () => {
    expect(holderLine([])).toMatch(/no grantee holds/i);
    expect(holderLine(['security-sentinel'])).toBe('held by security-sentinel');
    expect(holderLine(['chat', 'mcp-client'])).toBe('granted to 2 grantees');
  });
});
