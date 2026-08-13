/**
 * Renderer call site ⇄ main-process handler, for every channel the Settings
 * home touches.
 *
 * WHY THIS FILE EXISTS. Twelve tasks built five settings sections; four of them
 * call the main process. Every section had tests, and every one of those tests
 * asserted a single half of the contract: the renderer suites mocked `invoke`
 * and checked what the renderer sent, the main suites called handlers directly
 * and checked what they accepted. Nobody compared the two. Three contracts were
 * wrong and one channel had no handler at all:
 *
 *   - CREDENTIAL_API_KEY_STATUS returns `{ connections: [...] }`; the renderer
 *     read `.status` / `.label` / `.connectionId` off the envelope, so the AWS
 *     panel was permanently "Not connected" and Disconnect was dead.
 *   - WPE_DIAGNOSE takes one object; the renderer passed two positional args,
 *     so every SSH diagnostic returned "installName and args required" — and
 *     the renderer test asserted the broken signature.
 *   - AI_GATEWAY_GET_STATS has no `providers` key; destructuring one threw a
 *     TypeError inside an unguarded async onClick.
 *   - CLEANUP_GHOST_INSTALLS had no handler anywhere in src/main.
 *
 * HOW IT WORKS. `helpers/ipcContracts` indexes every real registration under
 * `src/main` and hands back the verbatim parameter list each handler declares.
 * The table below pins its expectations to that text, so it cannot drift from
 * the code silently. The drivers then run the REAL renderer methods against a
 * spying `invoke` and compare what they actually send.
 */
import { IPC_CHANNELS } from '../../../src/common/constants';
import { SettingsShell } from '../../../src/renderer/components/settings/SettingsShell';
import { ConnectionsSection } from '../../../src/renderer/components/settings/ConnectionsSection';
import { ChatSection } from '../../../src/renderer/components/settings/ChatSection';
import { AdvancedSection } from '../../../src/renderer/components/settings/AdvancedSection';
import {
  allHandlerRegistrations,
  declaredArity,
  handlerFor,
} from './helpers/ipcContracts';

jest.mock('../../../src/renderer/utils/theme', () => ({ injectThemeVars: jest.fn() }));

const C = IPC_CHANNELS;

// ── Realistic handler returns, quoted from the handlers themselves ──────────
// Feeding the renderer the SHAPE the handler really resolves with is the other
// half of the contract: a driver that crashes on a real return value is a
// broken call site, whatever its arguments looked like.
const RESPONSES: Record<string, any> = {
  // ipc-handlers.ts — GET_SETTINGS resolves the settings object itself.
  [C.GET_SETTINGS]: { autoIndex: true, excludedSiteIds: [], aiProvider: 'anthropic' },
  [C.GET_SITES]: [{ id: 's1', name: 'Site One', status: 'running' }],
  [C.GET_WPE_ACCOUNTS]: [{ id: 'a1', name: 'Account' }],
  [C.GET_WPE_INSTALLS_CACHE]: [{ installName: 'i1', environment: 'production', primaryDomain: 'x.com' }],
  [C.GET_EXTERNAL_HOSTS]: [{ alias: 'h1', site: 's1', environment: 'production', domain: 'y.com' }],
  [C.GET_DASHBOARD_STATS]: { counts: { wpe: { count: 3 }, external: { count: 1 }, local: { count: 5 } } },
  // ipc-handlers.ts GET_JOB_RUN_DATA: `{ [key]: { averageMs, lastRunAt } }`
  [C.GET_JOB_RUN_DATA]: { wpeRefresh: { averageMs: 1200, lastRunAt: 1 } },
  // GET_FLEET_STATUS: `return indexRegistry.listAll()`
  [C.GET_FLEET_STATUS]: [{ siteId: 's1', state: 'indexed', documentCount: 4 }],
  // GET_MCP_INFO: `getMcpServer()?.getConnectionInfo() ?? null`
  [C.GET_MCP_INFO]: { port: 10801 },
  // UPDATE_SETTINGS never rejects: `{ ...updated, _providerChanged, _gatewayChanged }`
  // on success, `{ ...current, _error }` on failure.
  [C.UPDATE_SETTINGS]: { autoIndex: false, _providerChanged: false, _gatewayChanged: false },

  // chat-ipc-handlers.ts
  [C.GET_PROVIDERS]: [{ id: 'anthropic', name: 'Anthropic', requiresApiKey: true }],
  [C.GET_MODELS]: ['claude-x'],
  // `return keyVault.getMasked(providerId)` → `{ maskedKey, isSet }`
  [C.GET_API_KEY]: { maskedKey: 'sk-…abcd', isSet: true },
  [C.SAVE_API_KEY]: { success: true },
  [C.VALIDATE_API_KEY]: { valid: true },
  [C.CHAT_CLEAR_ALL]: { success: true },

  // ipc-handlers.ts — `{ connections: mgr.listApiKeyConnections(args?.provider) }`
  [C.CREDENTIAL_API_KEY_STATUS]: {
    connections: [{ id: 'c1', provider: 'aws', label: 'arn:…', status: 'active', createdAt: '' }],
  },
  [C.CREDENTIAL_API_KEY_SET]: { ok: true, connectionId: 'c1', label: 'arn:…' },
  [C.CREDENTIAL_API_KEY_CLEAR]: { ok: true },

  // ipc-handlers.ts maintenance handlers
  'nexus-ai:get-vector-store-size': { success: true, sizeMB: 42 },
  [C.DB_SCAN_ALL]: { success: true, scans: [], scanned: 0 },
  [C.CLEANUP_GHOST_INSTALLS]: { success: true, removed: 2 },
  // `{ success, stdout, durationMs }` — NOT `output`.
  [C.WPE_DIAGNOSE]: { success: true, stdout: 'WordPress 6.7.1', durationMs: 40 },
  [C.RESET_CONTENT_INDEX]: { success: true, siteCount: 1, docCount: 2, dropped: 1 },
  [C.RESET_AND_REFRESH]: {
    success: true, graphCleared: true, vectorTablesDropped: 1,
    capiInstalls: 10, sshSynced: 2, sshFailed: 0,
  },
  [C.FACTORY_RESET]: { success: true, deleted: [] },
  // No `providers` key. This is the exact omission B2 was about.
  [C.AI_GATEWAY_GET_STATS]: {
    success: true,
    stats: {
      totalRequests: 12, totalCost: 0.5, totalTokens: 900,
      lastHour: { requests: 1, cost: 0.01 },
      lastDay: { requests: 4, cost: 0.2 },
      lastWeek: { requests: 12, cost: 0.5 },
      uniqueSites: 3,
      mostActiveSite: { siteId: 'abc', requests: 7 },
    },
  },
};

// ── Driving the real renderer code ──────────────────────────────────────────

type Invoke = jest.Mock;

/** Every arg array a scenario sent on `channel`, from the real call site. */
async function capture(
  scenario: (invoke: Invoke) => Promise<unknown> | unknown,
  channel: string,
): Promise<any[][]> {
  const invoke: Invoke = jest.fn(async (ch: string) => RESPONSES[ch]);
  await scenario(invoke);
  return invoke.mock.calls.filter((c) => c[0] === channel).map((c) => c.slice(1));
}

/** A never-mounted instance whose setState folds into state. */
function foldSetState<T extends { state: any; setState: any }>(inst: T): T {
  inst.setState = (patch: any) => {
    Object.assign(inst.state, typeof patch === 'function' ? patch(inst.state) : patch);
  };
  return inst;
}

const shell = (invoke: Invoke, state: any = {}) => {
  const c: any = foldSetState(new (SettingsShell as any)({ electron: { ipcRenderer: { invoke } } }));
  c.mounted = true;
  c.state = { ...c.state, ...state };
  return c;
};

const connections = (invoke: Invoke, over: any = {}) => {
  const { settings, state, ...rest } = over;
  const c: any = foldSetState(new (ConnectionsSection as any)({
    settings: { aiProvider: 'anthropic', ...settings },
    wpeAccounts: [], externalHosts: [], onSave: jest.fn(),
    electron: { ipcRenderer: { invoke } },
    ...rest,
  }));
  c.mounted = true;
  Object.assign(c.state, state ?? {});
  return c;
};

const advanced = (invoke: Invoke, over: any = {}) => {
  const { state, ...rest } = over;
  const c: any = foldSetState(new (AdvancedSection as any)({
    settings: {}, indexEntries: [], mcpInfo: { port: 1 }, sites: [], fleetCounts: null,
    onSave: jest.fn(), electron: { ipcRenderer: { invoke } },
    ...rest,
  }));
  Object.assign(c.state, state ?? {});
  return c;
};

/** First element in `node` whose only child is exactly `text`. */
function findByText(node: any, text: string): any {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) { const hit = findByText(n, text); if (hit) return hit; }
    return null;
  }
  const kids = node.props?.children;
  const list = Array.isArray(kids) ? kids : [kids];
  if (list.length === 1 && list[0] === text) return node;
  for (const k of list) { const hit = findByText(k, text); if (hit) return hit; }
  return null;
}

// ── The contract table ──────────────────────────────────────────────────────

interface Contract {
  /** Where the call comes from, for failure messages. */
  from: string;
  channel: string;
  /**
   * The handler's REAL declared parameter list must match this. Pinning the
   * table to the source text is what stops it becoming a second copy of the
   * renderer's assumption — the failure mode this whole file exists to catch.
   */
  signature: RegExp;
  /** The exact arguments the renderer must send, after the channel. */
  expected: any[];
  drive: () => Promise<any[][]>;
}

const CONTRACTS: Contract[] = [
  // ── SettingsShell.loadAll — nine reads, all zero-argument ────────────────
  ...([
    [C.GET_SETTINGS, /^\(\)|^async \(\)|^\(_event/],
    [C.GET_SITES, /^\(\)|^async \(\)|^\(_event/],
    [C.GET_WPE_ACCOUNTS, /^\(\)|^async \(\)|^\(_event/],
    [C.GET_WPE_INSTALLS_CACHE, /^\(\)|^async \(\)|^\(_event/],
    [C.GET_EXTERNAL_HOSTS, /^\(\)|^async \(\)|^\(_event/],
    [C.GET_DASHBOARD_STATS, /^\(\)|^async \(\)|^\(_event/],
    [C.GET_JOB_RUN_DATA, /^\(\)/],
    [C.GET_FLEET_STATUS, /^\(\)/],
    [C.GET_MCP_INFO, /^\(\)/],
  ] as Array<[string, RegExp]>).map(([channel, signature]): Contract => ({
    from: 'SettingsShell.loadAll',
    channel,
    signature,
    expected: [],
    drive: () => capture((invoke) => shell(invoke).loadAll(), channel),
  })),

  {
    from: 'SettingsShell.saveSetting',
    channel: C.UPDATE_SETTINGS,
    // `async (_event: any, newSettings: Partial<NexusSettings>)`
    signature: /^async \(_event[^,]*,\s*\w+/,
    expected: [{ autoIndex: false }],
    drive: () => capture(
      (invoke) => { shell(invoke, { settings: { autoIndex: true } }).saveSetting({ autoIndex: false }); },
      C.UPDATE_SETTINGS,
    ),
  },

  // ── ConnectionsSection ───────────────────────────────────────────────────
  {
    from: 'ConnectionsSection.loadConnectionStates',
    channel: C.GET_PROVIDERS,
    signature: /^\(\)/,
    expected: [],
    drive: () => capture((invoke) => connections(invoke).loadConnectionStates(), C.GET_PROVIDERS),
  },
  {
    from: 'ConnectionsSection.loadConnectionStates',
    channel: C.CREDENTIAL_API_KEY_STATUS,
    // `async (_event: any, args?: { provider?: string })`
    signature: /^async \(_event[^,]*,\s*args\?:\s*\{\s*provider\?/,
    expected: [{ provider: 'aws' }],
    drive: () => capture((invoke) => connections(invoke).loadConnectionStates(), C.CREDENTIAL_API_KEY_STATUS),
  },
  {
    from: 'ConnectionsSection.fetchModels',
    channel: C.GET_MODELS,
    // `async (_event: any, providerId: string)`
    signature: /^async \(_event[^,]*,\s*providerId: string\s*\)/,
    expected: ['anthropic'],
    drive: () => capture((invoke) => connections(invoke).loadConnectionStates(), C.GET_MODELS),
  },
  {
    from: 'ConnectionsSection.loadStoredKey',
    channel: C.GET_API_KEY,
    // `(_event: any, providerId: string)`
    signature: /^\(_event[^,]*,\s*providerId: string\s*\)/,
    expected: ['anthropic'],
    drive: () => capture((invoke) => connections(invoke).loadConnectionStates(), C.GET_API_KEY),
  },
  {
    from: 'ConnectionsSection.handleSaveKey',
    channel: C.SAVE_API_KEY,
    // `async (_event: any, providerId: string, apiKey: string)` — two positional
    signature: /^async \(_event[^,]*,\s*providerId: string,\s*apiKey: string\s*\)/,
    expected: ['anthropic', 'sk-secret'],
    drive: () => capture(
      (invoke) => connections(invoke, { state: { keyInput: '  sk-secret  ', keyIsSet: false } }).handleSaveKey(),
      C.SAVE_API_KEY,
    ),
  },
  {
    from: 'ConnectionsSection.handleValidateKey',
    channel: C.VALIDATE_API_KEY,
    signature: /^async \(_event[^,]*,\s*providerId: string,\s*apiKey: string\s*\)/,
    expected: ['anthropic', 'sk-secret'],
    drive: () => capture(
      (invoke) => connections(invoke, { state: { keyInput: 'sk-secret', keyIsSet: false } }).handleValidateKey(),
      C.VALIDATE_API_KEY,
    ),
  },
  {
    from: 'ConnectionsSection.handleAwsSave',
    channel: C.CREDENTIAL_API_KEY_SET,
    // `args: { provider: string; fields: { accessKeyId; secretAccessKey }; label? }`
    signature: /^async \([\s\S]*args:\s*\{\s*provider: string;\s*fields:\s*\{\s*accessKeyId: string;\s*secretAccessKey: string\s*\}/,
    expected: [{ provider: 'aws', fields: { accessKeyId: 'AKIA', secretAccessKey: 'sec' } }],
    drive: () => capture(
      (invoke) => connections(invoke, { state: { awsKeyIdInput: ' AKIA ', awsSecretInput: ' sec ' } }).handleAwsSave(),
      C.CREDENTIAL_API_KEY_SET,
    ),
  },
  {
    from: 'ConnectionsSection.handleAwsDisconnect',
    channel: C.CREDENTIAL_API_KEY_CLEAR,
    // `args: { connectionId: string }`
    signature: /^async \(_event[^,]*,\s*args:\s*\{\s*connectionId: string\s*\}/,
    expected: [{ connectionId: 'c1' }],
    drive: () => capture(
      (invoke) => connections(invoke, { state: { awsConnectionId: 'c1' } }).handleAwsDisconnect(),
      C.CREDENTIAL_API_KEY_CLEAR,
    ),
  },

  // ── ChatSection ──────────────────────────────────────────────────────────
  {
    from: 'ChatSection.handleDeleteConfirm',
    channel: C.CHAT_CLEAR_ALL,
    signature: /^async \(\)/,
    expected: [],
    drive: () => capture((invoke) => {
      const c: any = foldSetState(new (ChatSection as any)({
        settings: {}, onSave: jest.fn(), electron: { ipcRenderer: { invoke } },
      }));
      return c.handleDeleteConfirm();
    }, C.CHAT_CLEAR_ALL),
  },

  // ── AdvancedSection ──────────────────────────────────────────────────────
  {
    from: 'AdvancedSection.loadVectorStoreSize',
    channel: 'nexus-ai:get-vector-store-size',
    signature: /^\(\)/,
    expected: [],
    drive: () => capture((invoke) => advanced(invoke).loadVectorStoreSize(), 'nexus-ai:get-vector-store-size'),
  },
  {
    from: 'AdvancedSection.handleDbScan',
    channel: C.DB_SCAN_ALL,
    signature: /^async \(\)/,
    expected: [],
    drive: () => capture((invoke) => advanced(invoke).handleDbScan(), C.DB_SCAN_ALL),
  },
  {
    from: 'AdvancedSection.handleGhostCleanup',
    channel: C.CLEANUP_GHOST_INSTALLS,
    signature: /^async \(\)/,
    expected: [],
    drive: () => capture((invoke) => advanced(invoke).handleGhostCleanup(), C.CLEANUP_GHOST_INSTALLS),
  },
  {
    from: 'AdvancedSection.handleDiag',
    channel: C.WPE_DIAGNOSE,
    // ONE object: `params: { installName: string; args: string[] }`
    signature: /^async \(_event[^,]*,\s*params:\s*\{\s*installName: string;\s*args: string\[\]\s*\}/,
    expected: [{ installName: 'testsite', args: ['core', 'version'] }],
    drive: () => capture(
      (invoke) => advanced(invoke, { state: { diagInstall: 'testsite' } }).handleDiag(['core', 'version']),
      C.WPE_DIAGNOSE,
    ),
  },
  {
    from: 'AdvancedSection.handleResetIndex',
    channel: C.RESET_CONTENT_INDEX,
    signature: /^async \(\)/,
    expected: [],
    drive: () => capture((invoke) => advanced(invoke).handleResetIndex(), C.RESET_CONTENT_INDEX),
  },
  {
    from: 'AdvancedSection.handleResetAll',
    channel: C.RESET_AND_REFRESH,
    signature: /^async \(\)/,
    expected: [],
    drive: () => capture((invoke) => advanced(invoke).handleResetAll(), C.RESET_AND_REFRESH),
  },
  {
    from: 'AdvancedSection.handleFactoryReset',
    channel: C.FACTORY_RESET,
    signature: /^async \(\)/,
    expected: [],
    drive: () => capture((invoke) => advanced(invoke).handleFactoryReset(), C.FACTORY_RESET),
  },
  {
    from: 'AdvancedSection gateway "View usage"',
    channel: C.AI_GATEWAY_GET_STATS,
    signature: /^async \(_event: any\)/,
    expected: [],
    drive: () => capture((invoke) => {
      const inst = advanced(invoke);
      return findByText(inst.renderGatewayPanel(), 'View usage').props.onClick();
    }, C.AI_GATEWAY_GET_STATS),
  },
];

// ── The tests ───────────────────────────────────────────────────────────────

beforeEach(() => {
  (global as any).window = { showToast: jest.fn() };
  (global as any).alert = jest.fn();
  (global as any).navigator = { clipboard: { writeText: jest.fn() } };
});
afterEach(() => {
  delete (global as any).window;
  delete (global as any).alert;
  delete (global as any).navigator;
});

describe('Settings IPC contracts', () => {
  test('every channel the Settings home uses has a handler in src/main', () => {
    // CLEANUP_GHOST_INSTALLS had none: it shipped in c509c938 and was dropped
    // in the ipc-handlers decomposition without its caller being removed.
    const unhandled = CONTRACTS
      .filter((c) => handlerFor(c.channel) === undefined)
      .map((c) => `${c.channel} (called from ${c.from})`);
    expect(unhandled).toEqual([]);
  });

  test('no channel is registered twice — two handlers means one silently wins', () => {
    const counts = new Map<string, number>();
    for (const r of allHandlerRegistrations()) {
      counts.set(r.channelValue, (counts.get(r.channelValue) ?? 0) + 1);
    }
    const dupes = CONTRACTS
      .map((c) => c.channel)
      .filter((ch, i, all) => all.indexOf(ch) === i)
      .filter((ch) => (counts.get(ch) ?? 0) > 1);
    expect(dupes).toEqual([]);
  });

  describe.each(CONTRACTS.map((c) => [`${c.channel} ← ${c.from}`, c] as const))(
    '%s', (_label, contract) => {
      test('the contract table still describes the real handler signature', () => {
        const reg = handlerFor(contract.channel)!;
        expect(reg).toBeDefined();
        // If this fails, the handler changed: re-derive the row, do not relax
        // the pattern.
        expect(reg.signature).toMatch(contract.signature);
      });

      test('the renderer sends exactly the arguments the handler declares', async () => {
        const reg = handlerFor(contract.channel)!;
        const arity = declaredArity(reg.signature);
        expect(arity).not.toBeNull();
        // The declared arity and the table's own expectation must agree, so a
        // handler that grows a parameter cannot be satisfied by a stale row.
        expect(contract.expected).toHaveLength(arity as number);

        const calls = await contract.drive();
        expect(calls.length).toBeGreaterThan(0);
        for (const args of calls) {
          expect(args).toEqual(contract.expected);
        }
      });
    },
  );
});
