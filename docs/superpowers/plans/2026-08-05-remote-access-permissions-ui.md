# Remote Access & Permissions UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved "Proposed" design in `docs/mockups/remote-access-permissions.html` — separate the mislabeled account-scope control from operation permissions, surface external SSH hosts in both, and fix the one functional bug (a UI-made exception can never match an `ssh:` target) it exists to catch.

**Architecture:** `SettingsTab.tsx` (class-based, `React.createElement` only, no JSX/hooks) already has three sections: Auto-Indexing, Sync Schedule, WPE Access & Permissions. This plan moves the account-scope bar from the third section into the second (renamed), adds a new IPC channel so the renderer can list registered external hosts (nothing today lets it), and switches the exception picker and its storage from the deprecated `wpe*` setting keys to the already-existing `remote*` ones. No new settings keys, no schema changes — `remoteOperationPermissions`, `remoteSiteExceptions`, `externalRefreshAutoEnabled`, `externalRefreshIntervalHours` all already exist and are already wired end-to-end on the backend.

**Tech Stack:** TypeScript, React (`React.createElement`, no JSX), Electron IPC, better-sqlite3 (graph DB), Jest.

## Global Constraints

- **Class-based components, `React.createElement` only.** No JSX, no hooks — this file and its siblings in `src/renderer/components/` are written this way throughout; do not introduce either.
- **No new settings keys or schema changes.** `remoteOperationPermissions`, `remoteSiteExceptions` (with `targetRef`), `externalRefreshAutoEnabled`, `externalRefreshIntervalHours` are all already in `src/common/types.ts` and `src/common/schemas.ts`, fully wired (scheduler, reactive settings via `onSettingsUpdated`, CLI). This plan only adds UI for what already exists on the backend.
- **A UI-made exception must write `targetRef`, not `installName`.** `RemoteSiteException.targetRef` is `'wpe:<installName>'` or `'ssh:<alias>'`; the permission gate (`operation-permissions.ts:69-71`) already matches on it. The deprecated `WpeSiteException.installName` has no such prefix, so a UI-made exception under the old shape is always treated as `wpe:` and can never match an SSH host — that is the one functional bug this plan exists to fix.
- **Read the new `remote*` keys with a fallback to the deprecated `wpe*` ones**, so an existing user's saved exceptions/permissions still display correctly. `operation-permissions.ts:174-180` already does this fallback on the backend read path (used by the permission gate) — mirror the same fallback shape in the renderer's own state hydration, since the renderer reads settings independently for display.
- **Write only the new `remote*` keys going forward.** Do not write `wpeOperationPermissions` or `wpeSiteExceptions` from any renderer code touched in this plan.
- **Account scope has never controlled permissions — say so, don't imply otherwise.** The existing copy "click to include / exclude accounts from the permissions below" is false (`wpeAccountFilter` has exactly two consumers, both scheduler-related — `WpeRefreshScheduler.getAccountFilter` and the manual sync — and `isOperationAllowed` never reads it). Any copy this plan writes or moves must not repeat that claim.
- **External hosts have no account concept.** Do not add an include/exclude toggle for the external-hosts chip row — it is informational only, listing what's registered. There is nothing to scope; every registered host either exists or doesn't.
- **Dim WPE-only operation rows, never hide them.** Pull, Push, and Delete/Promote are real, functioning settings for WP Engine even though they don't apply to `ssh:` targets. Hiding them would look like the setting no longer exists.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/common/constants.ts` *(modify)* | Add `GET_EXTERNAL_HOSTS` IPC channel constant. |
| `src/main/ipc-handlers.ts` *(modify)* | Add the `GET_EXTERNAL_HOSTS` handler — queries the graph DB, mirrors the existing `GET_WPE_INSTALLS_CACHE` handler's shape. |
| `src/renderer/components/SettingsTab.tsx` *(modify)* | All four UI changes: move the account-scope bar, add the external-hosts card, fix the exception picker, add scope chips. |
| `tests/unit/ipc/get-external-hosts.test.ts` *(create)* | Tests the new IPC handler. |
| `tests/unit/renderer/SettingsTab.test.tsx` *(create)* | Tests the renderer changes — state shape, write targets, picker behavior. |

---

### Task 1: `GET_EXTERNAL_HOSTS` IPC channel

**Files:**
- Modify: `src/common/constants.ts` (add beside `GET_WPE_INSTALLS_CACHE`, `:197`)
- Modify: `src/main/ipc-handlers.ts` (add beside the `GET_WPE_INSTALLS_CACHE` handler, `:953`)
- Test: `tests/unit/ipc/get-external-hosts.test.ts` *(create)*

**Interfaces:**
- Produces: IPC channel `IPC_CHANNELS.GET_EXTERNAL_HOSTS`, handler returns
  `Array<{ alias: string; environment: string; domain: string }>`.

**Why this is needed.** `GET_WPE_INSTALLS_CACHE` reads WPE installs from `registryStorage` — a local cache electron-store maintains. External hosts have no such cache; they live only in the graph `sites` table (`source = 'external'`). Nothing today lets the renderer list them, so Task 2's picker and external-hosts chip row have nothing to read from without this.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/ipc/get-external-hosts.test.ts
class MockIpcMain {
  handlers = new Map<string, Function>();
  handle(channel: string, handler: Function) { this.handlers.set(channel, handler); }
  on() { /* sync channels irrelevant here */ }
  removeHandler(channel: string) { this.handlers.delete(channel); }
  removeAllListeners() { /* no-op in tests */ }
  invoke(channel: string, ...args: any[]) {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    return handler({}, ...args);
  }
}
const mockIpc = new MockIpcMain();
jest.mock('electron', () => ({ ipcMain: mockIpc, shell: { openPath: jest.fn() }, app: { getPath: () => '/tmp' } }));

import { registerIpcHandlers } from '../../../src/main/ipc-handlers';
import { IPC_CHANNELS } from '../../../src/common/constants';

function register(rows: Array<{ id: string; name: string; environment: string | null; domain: string | null; is_active: number }>) {
  const noop = () => {};
  const db = {
    prepare: (sql: string) => ({
      all: () => sql.includes("source = 'external'") ? rows.filter(r => r.is_active === 1) : [],
    }),
  };
  const deps: any = {
    siteData: { getSite: () => null, getSites: () => ({}) },
    localServicesBridge: {},
    indexRegistry: { listAll: () => [], get: () => null, update: noop },
    embeddingService: {},
    contentPipeline: {},
    vectorStore: {},
    registryStorage: { get: () => null, set: noop },
    localLogger: { info: noop, warn: noop, error: noop, debug: noop },
    getMcpServer: () => null,
    getStartupStatus: () => ({ ready: true, phase: 'ready' }),
    graphService: { getDb: () => db },
    eventProcessor: {},
    vectorDbPath: '/tmp/nexus-test-vectors.db',
    nexusServices: {},
  };
  registerIpcHandlers(deps);
}

describe('GET_EXTERNAL_HOSTS', () => {
  it('returns registered active external hosts', () => {
    register([
      { id: 'ssh:myhost', name: 'myhost', environment: 'production', domain: 'example.com', is_active: 1 },
    ]);
    const result = mockIpc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS);
    expect(result).toEqual([{ alias: 'myhost', environment: 'production', domain: 'example.com' }]);
  });

  it('excludes a removed (inactive) host', () => {
    register([
      { id: 'ssh:gone', name: 'gone', environment: 'production', domain: 'x.com', is_active: 0 },
    ]);
    expect(mockIpc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS)).toEqual([]);
  });

  it('defaults a missing environment to production and a missing domain to empty string', () => {
    register([
      { id: 'ssh:bare', name: 'bare', environment: null, domain: null, is_active: 1 },
    ]);
    expect(mockIpc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS)).toEqual([
      { alias: 'bare', environment: 'production', domain: '' },
    ]);
  });

  it('returns an empty array when the graph is not ready', () => {
    const deps: any = {
      siteData: { getSite: () => null, getSites: () => ({}) },
      localServicesBridge: {},
      indexRegistry: { listAll: () => [], get: () => null, update: () => {} },
      embeddingService: {}, contentPipeline: {}, vectorStore: {},
      registryStorage: { get: () => null, set: () => {} },
      localLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getMcpServer: () => null,
      getStartupStatus: () => ({ ready: true, phase: 'ready' }),
      graphService: { getDb: () => null },
      eventProcessor: {},
      vectorDbPath: '/tmp/nexus-test-vectors.db',
      nexusServices: {},
    };
    registerIpcHandlers(deps);
    expect(mockIpc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest tests/unit/ipc/get-external-hosts.test.ts`
Expected: FAIL — `IPC_CHANNELS.GET_EXTERNAL_HOSTS` is `undefined`, so `mockIpc.invoke(undefined)` throws
"No handler registered for undefined".

- [ ] **Step 3: Add the constant**

In `src/common/constants.ts`, immediately after `GET_WPE_INSTALLS_CACHE` (`:197`):

```ts
  GET_EXTERNAL_HOSTS: `${ADDON_PREFIX}:get-external-hosts`,
```

- [ ] **Step 4: Add the handler**

In `src/main/ipc-handlers.ts`, immediately after the `GET_WPE_INSTALLS_CACHE` handler (`:953-964`):

```ts
  safeHandle(IPC_CHANNELS.GET_EXTERNAL_HOSTS, () => {
    try {
      const db = graphService?.getDb?.();
      if (!db) return [];
      const rows = db.prepare(
        "SELECT name, environment, domain FROM sites WHERE source = 'external' AND is_active = 1"
      ).all() as Array<{ name: string; environment: string | null; domain: string | null }>;
      return rows.map((r) => ({
        alias: r.name,
        environment: r.environment ?? 'production',
        domain: r.domain ?? '',
      }));
    } catch {
      return [];
    }
  });
```

- [ ] **Step 5: Run tests**

Run: `npx jest tests/unit/ipc/get-external-hosts.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/common/constants.ts src/main/ipc-handlers.ts tests/unit/ipc/get-external-hosts.test.ts
git commit -m "feat(ipc): add GET_EXTERNAL_HOSTS channel for the settings UI"
```

---

### Task 2: Move account scope, add the external-hosts card

**Files:**
- Modify: `src/renderer/components/SettingsTab.tsx`
- Test: `tests/unit/renderer/SettingsTab.test.tsx` *(create)*

**Interfaces:**
- Consumes: `IPC_CHANNELS.GET_EXTERNAL_HOSTS` from Task 1, returning
  `Array<{ alias: string; environment: string; domain: string }>`.
- Produces: `SettingsTabState.externalHosts: Array<{ alias: string; environment: string; domain: string }>`,
  populated in `loadAll()`. Later tasks (3, 4) read this field.

**What moves, and why.** The account-scope chip bar (`accountsBar`, currently built and
rendered inside `renderWpeAccessSection`, `:633-658`, gated behind the `accessExpanded`
accordion) has never controlled permissions — it only feeds `WpeRefreshScheduler`'s account
filter. It belongs beside the other sync/refresh controls, not behind an "Access &
Permissions" accordion implying it gates access. Move it into `renderSyncScheduleSection`,
always visible (not accordion-gated), with corrected copy.

**What's added.** A new "External SSH Hosts" card, structurally parallel to the existing
"WP Engine Installs" card in the same section: a chip row listing registered aliases
(informational — no click handler, no include/exclude, per the Global Constraints), and one
schedule row wired to the settings Task 5 of the prior plan already fully implemented —
`externalRefreshAutoEnabled` / `externalRefreshIntervalHours`.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/unit/renderer/SettingsTab.test.tsx
import * as React from 'react';
import { SettingsTab } from '../../../src/renderer/components/SettingsTab';
import { IPC_CHANNELS } from '../../../src/common/constants';

function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  const children = node.props?.children;
  const kids = Array.isArray(children) ? children : [children];
  for (const k of kids) findAll(k, pred, out);
  return out;
}
function textOf(node: any): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object') return '';
  const children = node.props?.children;
  const kids = Array.isArray(children) ? children : [children];
  return kids.map(textOf).join('');
}

function mockElectron(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = {
    [IPC_CHANNELS.GET_SETTINGS]: { autoIndex: true, excludedSiteIds: [] },
    [IPC_CHANNELS.GET_SITES]: { sites: [] },
    [IPC_CHANNELS.GET_WPE_ACCOUNTS]: [],
    [IPC_CHANNELS.GET_WPE_INSTALLS_CACHE]: [],
    [IPC_CHANNELS.GET_EXTERNAL_HOSTS]: [],
    [IPC_CHANNELS.UPDATE_SETTINGS]: { success: true },
  };
  const table = { ...defaults, ...overrides };
  return { ipcRenderer: { invoke: jest.fn((ch: string) => Promise.resolve(table[ch])) } };
}

describe('SettingsTab — external hosts', () => {
  it('loads external hosts into state', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_EXTERNAL_HOSTS]: [{ alias: 'hostinger-test', environment: 'production', domain: 'example.com' }],
    });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    await instance.loadAll();
    expect(instance.state.externalHosts).toEqual([
      { alias: 'hostinger-test', environment: 'production', domain: 'example.com' },
    ]);
  });

  it('renders a chip for each registered external host', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_EXTERNAL_HOSTS]: [{ alias: 'hostinger-test', environment: 'production', domain: 'example.com' }],
    });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    await instance.loadAll();
    const tree = instance.render();
    const chips = findAll(tree, (n) => textOf(n).trim() === 'hostinger-test');
    expect(chips.length).toBeGreaterThan(0);
  });

  it('external host chips are not clickable — no onClick handler', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_EXTERNAL_HOSTS]: [{ alias: 'hostinger-test', environment: 'production', domain: 'example.com' }],
    });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    await instance.loadAll();
    const tree = instance.render();
    const chip = findAll(tree, (n) => textOf(n).trim() === 'hostinger-test')[0];
    expect(chip.props.onClick).toBeUndefined();
  });

  it('the external refresh schedule row reads and writes externalRefreshAutoEnabled/IntervalHours', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_SETTINGS]: {
        autoIndex: true, excludedSiteIds: [],
        externalRefreshAutoEnabled: true, externalRefreshIntervalHours: 12,
      },
    });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    await instance.loadAll();
    const tree = instance.render();
    const checkbox = findAll(tree, (n) => n.type === 'input' && n.props.type === 'checkbox'
      && n.props.checked === true && n.props.onChange === instance.handleExternalRefreshAutoEnabledChange);
    expect(checkbox.length).toBe(1);
    const numberInput = findAll(tree, (n) => n.type === 'input' && n.props.type === 'number' && n.props.value === 12);
    expect(numberInput.length).toBe(1);
  });

  it('the account-scope bar no longer claims to control permissions below it', async () => {
    const electron = mockElectron({ [IPC_CHANNELS.GET_WPE_ACCOUNTS]: [{ id: 'a1', name: 'Acme' }] });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    await instance.loadAll();
    const tree = instance.render();
    const wholeText = textOf(tree);
    expect(wholeText).not.toContain('from the permissions below');
  });

  it('the account-scope bar renders outside the Access & Permissions accordion (always visible)', async () => {
    const electron = mockElectron({ [IPC_CHANNELS.GET_WPE_ACCOUNTS]: [{ id: 'a1', name: 'Acme' }] });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    (instance as any).setState = function (updater: any) {
      const patch = typeof updater === 'function' ? updater(this.state) : updater;
      Object.assign(this.state, patch);
    };
    await instance.loadAll();
    // accessExpanded is false by default — Access & Permissions content is collapsed.
    expect(instance.state.accessExpanded).toBe(false);
    const tree = instance.render();
    // The account chip must still be present even though the accordion is collapsed.
    const chip = findAll(tree, (n) => textOf(n).trim().includes('Acme'));
    expect(chip.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/renderer/SettingsTab.test.tsx`
Expected: FAIL — `instance.state.externalHosts` is `undefined`; `handleExternalRefreshAutoEnabledChange`
doesn't exist; the account-scope bar is still inside the collapsed accordion so the last test's
chip lookup finds nothing; the "from the permissions below" text is still present.

- [ ] **Step 3: Implement**

**3a. State and loading.** In `SettingsTabState` (`:43-54`), add:

```ts
  externalHosts: Array<{ alias: string; environment: string; domain: string }>;
```

In the initial `state` object (`:92-103`), add:

```ts
    externalHosts: [],
```

In `loadAll()` (`:115-131`), add a fifth parallel fetch and read it into state:

```ts
  async loadAll(): Promise<void> {
    const ipc = this.props.electron.ipcRenderer;
    const [settings, sitesResult, accounts, installs, externalHosts] = await Promise.all([
      ipc.invoke(IPC_CHANNELS.GET_SETTINGS).catch(() => null),
      ipc.invoke(IPC_CHANNELS.GET_SITES).catch(() => ({ sites: [] })),
      ipc.invoke(IPC_CHANNELS.GET_WPE_ACCOUNTS).catch(() => []),
      ipc.invoke(IPC_CHANNELS.GET_WPE_INSTALLS_CACHE).catch(() => []),
      ipc.invoke(IPC_CHANNELS.GET_EXTERNAL_HOSTS).catch(() => []),
    ]);
    if (!this.mounted) return;
    this.setState({
      settings: settings ?? { autoIndex: true, excludedSiteIds: [] } as any,
      sites: sitesResult?.sites ?? [],
      wpeAccounts: Array.isArray(accounts) ? accounts : [],
      wpeInstalls: Array.isArray(installs) ? installs : [],
      externalHosts: Array.isArray(externalHosts) ? externalHosts : [],
      loading: false,
    });
  }
```

**3b. New handlers.** Beside `handleWpeContentIndexIntervalChange` (`:199-203`):

```ts
  handleExternalRefreshAutoEnabledChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    this.saveSetting({ externalRefreshAutoEnabled: e.target.checked });
  };

  handleExternalRefreshIntervalChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = parseInt(e.target.value, 10);
    const hours = isNaN(val) || val < 1 ? 1 : val > 168 ? 168 : val;
    this.saveSetting({ externalRefreshIntervalHours: hours });
  };
```

**3c. Move the account bar.** In `renderWpeAccessSection` (`:439`), delete the `accountsBar`
definition (`:633-658`) and its reference in the returned tree (`accountsBar,` at `:679`). Also
delete `allAccountIds`/`includedIds`/`allIncluded` (`:446-448`) from this method — they now live
in `renderSyncScheduleSection`. Update `summaryParts` (`:476-477`) to remove the account-count
line entirely, since the header no longer shows it (matches the mockup's `.summary.only-new`,
which drops the account count):

```ts
    const summaryParts: string[] = [];
    const blockedItems: string[] = [];
    if (blockedForWrite) blockedItems.push('SSH write');
    if (blockedForPush) blockedItems.push('push');
    if (blockedForDelete) blockedItems.push('delete');
    if (blockedItems.length > 0) summaryParts.push(`production blocked for ${blockedItems.join(' & ')}`);
    const headerSummary = summaryParts.join(' · ');
```

`renderWpeAccessSection`'s signature and remaining behavior (operation cards, exceptions —
Tasks 3 and 4 touch these) are otherwise unchanged in this task.

**3d. Add the account bar and the external-hosts card to `renderSyncScheduleSection`**
(`:316-437`). Insert this block immediately before the existing `sublabel('WP Engine Installs')`
line (`:367`), and add the external-hosts card immediately after the WP Engine Installs
`cardStyle` block closes (`:435`, right before the final `);` that closes the method's returned
`React.createElement('div', null, ...)`):

```ts
      (() => {
        const { wpeAccounts } = this.state;
        if (wpeAccounts.length === 0) return null;
        const accountFilter = settings.wpeAccountFilter;
        const allAccountIds = wpeAccounts.map(a => a.id);
        const includedIds: string[] = accountFilter ?? allAccountIds;
        const allIncluded = !accountFilter || includedIds.length === allAccountIds.length;
        return React.createElement('div', { style: { marginBottom: 14 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 } },
            React.createElement('span', { style: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--nxai-card-sub, #6b7280)' } }, 'WP Engine accounts'),
            React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)' } }, '— included accounts are synced and refreshed on the schedule below'),
          ),
          React.createElement('div', {
            style: { display: 'flex', flexWrap: 'wrap' as const, gap: 5, padding: '9px 12px', background: 'var(--nxai-card-bg, #21262d)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 7, maxHeight: 110, overflowY: 'auto' as const },
          },
            ...wpeAccounts.map(a => {
              const on = allIncluded || includedIds.includes(a.id);
              return React.createElement('span', {
                key: a.id,
                title: on ? 'Click to exclude this account' : 'Click to include this account',
                style: { fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, userSelect: 'none' as const, background: on ? 'rgba(81,187,123,0.12)' : 'rgba(128,128,128,0.06)', color: on ? '#51BB7B' : 'var(--nxai-status-neutral, #9ca3af)', border: on ? '1px solid rgba(81,187,123,0.3)' : '1px dashed var(--nxai-card-border, #30363d)', opacity: on ? 1 : 0.6 },
                onClick: (e: React.MouseEvent) => { e.stopPropagation(); this.handleAccountScopeToggle(a.id, !on); },
              },
                React.createElement('span', { style: { fontSize: 9 } }, on ? '✓' : '✗'),
                a.nickname ?? a.name ?? a.id,
              );
            }),
          ),
        );
      })(),
```

And after the WP Engine Installs card:

```tsx
      sublabel('External SSH Hosts'),
      React.createElement('div', { style: { marginBottom: 6 } },
        this.state.externalHosts.length === 0
          ? React.createElement('div', { style: { fontSize: 12, color: 'var(--nxai-card-sub, #6b7280)', padding: '4px 0 10px' } },
              'No external hosts registered. Run `nexus host add <alias>` from the CLI.')
          : React.createElement('div', {
              style: { display: 'flex', flexWrap: 'wrap' as const, gap: 5, padding: '9px 12px', background: 'var(--nxai-card-bg, #21262d)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: '7px 7px 0 0', borderBottom: 'none' },
            },
              ...this.state.externalHosts.map(h =>
                React.createElement('span', {
                  key: h.alias,
                  title: `${h.domain || h.alias} — ${h.environment}`,
                  style: { fontSize: 11, padding: '3px 8px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(128,128,128,0.06)', color: 'var(--nxai-status-neutral, #9ca3af)', border: '1px dashed var(--nxai-card-border, #30363d)' },
                }, h.alias),
              ),
            ),
      ),
      React.createElement('div', { style: { ...cardStyle, borderTopLeftRadius: this.state.externalHosts.length ? 0 : 8, borderTopRightRadius: this.state.externalHosts.length ? 0 : 8 } },
        React.createElement('div', { style: { ...rowStyle, borderBottom: 'none' } },
          React.createElement('div', { style: rowLabelStyle },
            React.createElement('div', { style: rowTitleStyle }, 'Metadata refresh for external hosts'),
            React.createElement('div', { style: rowSubStyle }, 'Off by default. Nexus does not SSH into a third-party host on a timer unless you ask it to.'),
          ),
          React.createElement('div', { style: rowControlStyle },
            React.createElement('input', {
              type: 'checkbox',
              checked: settings.externalRefreshAutoEnabled ?? false,
              onChange: this.handleExternalRefreshAutoEnabledChange,
              title: 'Enable automatic external host metadata refresh',
            }),
            React.createElement('input', {
              type: 'number', min: 1, max: 168,
              value: settings.externalRefreshIntervalHours ?? 24,
              onChange: this.handleExternalRefreshIntervalChange,
              disabled: !(settings.externalRefreshAutoEnabled ?? false),
              style: { ...numInputStyle, opacity: (settings.externalRefreshAutoEnabled ?? false) ? 1 : 0.4 },
            }),
            React.createElement('span', { style: unitStyle }, 'hrs'),
          ),
        ),
      ),
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/renderer/SettingsTab.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SettingsTab.tsx tests/unit/renderer/SettingsTab.test.tsx
git commit -m "feat(settings-ui): move account scope out of Access & Permissions, add external hosts card"
```

---

### Task 3: Exception picker writes `targetRef`, lists both WPE and external targets

**Files:**
- Modify: `src/renderer/components/SettingsTab.tsx`
- Test: `tests/unit/renderer/SettingsTab.test.tsx` *(extend)*

**Interfaces:**
- Consumes: `this.state.externalHosts` from Task 2.
- Produces: nothing new consumed by later tasks — this is a leaf change to the picker and its
  storage.

**The bug this fixes.** `handleSiteExceptionToggle` (`:225-234`) takes `installName` and builds
`{ installName, environment, overrides }` — the deprecated `WpeSiteException` shape, which has
no `targetRef`. The permission gate's matcher (`operation-permissions.ts:71`) computes
`e.targetRef ?? \`wpe:${e.installName}\`` for a legacy record, so **every UI-made exception is
permanently `wpe:`-prefixed** and can never match an `ssh:<alias>` target, no matter what the
picker shows.

**The fix.** Switch state fields, handlers, and storage key from the `wpe*` shape to
`RemoteSiteException`/`RemoteOperationPermissions`, keyed on `targetRef`. Read with a fallback
to the deprecated keys (matching `operation-permissions.ts`'s own fallback), write only the new
keys.

- [ ] **Step 1: Write the failing tests**

```tsx
// append to tests/unit/renderer/SettingsTab.test.tsx

describe('SettingsTab — exception picker writes targetRef', () => {
  it('writes remoteSiteExceptions with a wpe: prefix for a WPE install', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_WPE_INSTALLS_CACHE]: [{ installName: 'mystore', environment: 'production', primaryDomain: 'mystore.wpengine.com' }],
    });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    (instance as any).setState = function (updater: any) {
      const patch = typeof updater === 'function' ? updater(this.state) : updater;
      Object.assign(this.state, patch);
    };
    await instance.loadAll();
    instance.handleSiteExceptionToggle('wpe:mystore', 'production', 'wpcli', false);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.UPDATE_SETTINGS,
      { remoteSiteExceptions: [{ targetRef: 'wpe:mystore', environment: 'production', overrides: { wpcli: false } }] },
    );
  });

  it('writes remoteSiteExceptions with an ssh: prefix for an external host', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_EXTERNAL_HOSTS]: [{ alias: 'hostinger-test', environment: 'production', domain: 'example.com' }],
    });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    (instance as any).setState = function (updater: any) {
      const patch = typeof updater === 'function' ? updater(this.state) : updater;
      Object.assign(this.state, patch);
    };
    await instance.loadAll();
    instance.handleSiteExceptionToggle('ssh:hostinger-test', 'production', 'wpcli_read', true);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.UPDATE_SETTINGS,
      { remoteSiteExceptions: [{ targetRef: 'ssh:hostinger-test', environment: 'production', overrides: { wpcli_read: true } }] },
    );
  });

  it('falls back to the deprecated wpeSiteExceptions for display when remoteSiteExceptions is absent', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_SETTINGS]: {
        autoIndex: true, excludedSiteIds: [],
        wpeSiteExceptions: [{ installName: 'legacy-store', environment: 'production', overrides: { wpcli: false } }],
      },
    });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    await instance.loadAll();
    const tree = instance.render();
    // Expand the WP-CLI over SSH (Write) card so its exceptions list renders.
    instance.handleOpCardToggle('wpcli');
    const tree2 = instance.render();
    expect(textOf(tree2)).toContain('legacy-store');
  });

  it('prefers remoteSiteExceptions over the deprecated key when both are present', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_SETTINGS]: {
        autoIndex: true, excludedSiteIds: [],
        wpeSiteExceptions: [{ installName: 'old', environment: 'production', overrides: { wpcli: false } }],
        remoteSiteExceptions: [{ targetRef: 'wpe:new', environment: 'production', overrides: { wpcli: false } }],
      },
    });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    await instance.loadAll();
    instance.handleOpCardToggle('wpcli');
    const tree = instance.render();
    expect(textOf(tree)).toContain('new');
    expect(textOf(tree)).not.toContain('old');
  });

  it('the exception picker lists external hosts in a separate group from WPE installs', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_WPE_INSTALLS_CACHE]: [{ installName: 'mystore', environment: 'production', primaryDomain: 'mystore.wpengine.com' }],
      [IPC_CHANNELS.GET_EXTERNAL_HOSTS]: [{ alias: 'hostinger-test', environment: 'production', domain: 'example.com' }],
    });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    (instance as any).setState = function (updater: any) {
      const patch = typeof updater === 'function' ? updater(this.state) : updater;
      Object.assign(this.state, patch);
    };
    await instance.loadAll();
    instance.handleOpCardToggle('wpcli');
    instance.setState({ addingException: { op: 'wpcli', targetRef: '', environment: 'production', allowing: true } });
    const tree = instance.render();
    const text = textOf(tree);
    expect(text).toContain('mystore');
    expect(text).toContain('hostinger-test');
    // Both a WPE group heading and an SSH group heading must be present.
    expect(text).toContain('WP Engine installs');
    expect(text).toContain('External SSH hosts');
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/renderer/SettingsTab.test.tsx`
Expected: FAIL — `handleSiteExceptionToggle` still writes `wpeSiteExceptions`/`installName`;
the picker has no external-hosts group; no fallback exists.

- [ ] **Step 3: Implement**

**3a. State shape.** In `SettingsTabState` (`:39-54`), change:

```ts
  addingException: { op: string; installName: string; environment: string; allowing: boolean } | null;
```
to
```ts
  addingException: { op: string; targetRef: string; environment: string; allowing: boolean } | null;
```

**3b. A shared read helper.** Add near the top of the class, beside `saveSetting` (`:135-142`):

```ts
  /** remoteSiteExceptions if present, else the deprecated wpeSiteExceptions — same fallback
   *  order operation-permissions.ts's own read path already uses on the backend. */
  private getEffectiveExceptions(): import('../../common/types').RemoteSiteException[] {
    const s = this.state.settings;
    if (!s) return [];
    if (s.remoteSiteExceptions?.length) return s.remoteSiteExceptions;
    if (s.wpeSiteExceptions?.length) {
      return s.wpeSiteExceptions.map(e => ({ targetRef: `wpe:${e.installName}`, environment: e.environment, overrides: e.overrides }));
    }
    return [];
  }

  private getEffectivePermissions(): import('../../common/types').RemoteOperationPermissions {
    const s = this.state.settings;
    if (!s) return {};
    if (s.remoteOperationPermissions && Object.keys(s.remoteOperationPermissions).length) {
      return s.remoteOperationPermissions;
    }
    return s.wpeOperationPermissions ?? {};
  }
```

**3c. Rewrite the handlers** (`:215-241`), keyed on `targetRef`, writing only the new keys:

```ts
  handleOperationToggle = (operation: WpeOperation, env: WpeEnv, value: boolean): void => {
    const perms = { ...this.getEffectivePermissions() };
    perms[operation] = {
      ...WPE_OPERATION_DEFAULTS[operation],
      ...(perms[operation] ?? {}),
      [env]: value,
    };
    this.saveSetting({ remoteOperationPermissions: perms });
  };

  handleSiteExceptionToggle = (targetRef: string, environment: string, operation: WpeOperation, value: boolean): void => {
    const exceptions = [...this.getEffectiveExceptions()];
    const idx = exceptions.findIndex(e => e.targetRef === targetRef && e.environment === environment);
    if (idx >= 0) {
      exceptions[idx] = { ...exceptions[idx], overrides: { ...exceptions[idx].overrides, [operation]: value } };
    } else {
      exceptions.push({ targetRef, environment, overrides: { [operation]: value } });
    }
    this.saveSetting({ remoteSiteExceptions: exceptions });
  };

  handleSiteExceptionRemove = (targetRef: string, environment: string): void => {
    const exceptions = this.getEffectiveExceptions().filter(
      e => !(e.targetRef === targetRef && e.environment === environment),
    );
    this.saveSetting({ remoteSiteExceptions: exceptions });
  };
```

**3d. Update `renderWpeAccessSection`** (`:439-693`) to read via the new helpers and render
`targetRef` instead of `installName`:

Replace (`:443-444`):
```ts
    const perms = settings.wpeOperationPermissions ?? {};
    const exceptions = settings.wpeSiteExceptions ?? [];
```
with:
```ts
    const perms = this.getEffectivePermissions();
    const exceptions = this.getEffectiveExceptions();
```

In the exceptions-list rendering inside `renderOpCard` (`:544-560`), change every
`exc.installName` reference to `exc.targetRef`, and the `key` from
`` `${exc.installName}-${exc.environment}` `` to `` `${exc.targetRef}-${exc.environment}` ``, and
the removal call from `this.handleSiteExceptionRemove(exc.installName, exc.environment)` to
`this.handleSiteExceptionRemove(exc.targetRef, exc.environment)`.

**3e. Rebuild the picker** (`:561-628`) to group WPE installs and external hosts, and to carry
`targetRef` through `addingException` instead of `installName`:

```tsx
          addingException?.op === op.id
            ? React.createElement('div', {
                style: { background: 'var(--nxai-card-bg, #21262d)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: 6, padding: '10px 12px' },
                onClick: (e: React.MouseEvent) => e.stopPropagation(),
              },
                React.createElement('input', {
                  type: 'text', placeholder: 'Search installs and SSH hosts…', value: installSearch, autoFocus: true,
                  onChange: (e: any) => this.setState({ installSearch: e.target.value }),
                  style: { width: '100%', fontSize: 12, padding: '6px 8px', background: 'var(--nxai-code-bg, #1f1f1f)', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 4, color: 'var(--nxai-card-text, #e6edf3)', fontFamily: 'inherit', marginBottom: 6 },
                }),
                React.createElement('div', { style: { maxHeight: 180, overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 2, marginBottom: 8 } },
                  (() => {
                    const q = installSearch.toLowerCase();
                    const wpeMatches = wpeInstalls.filter(i => !q || i.installName.toLowerCase().includes(q) || i.primaryDomain.toLowerCase().includes(q)).slice(0, 30);
                    const externalMatches = this.state.externalHosts.filter(h => !q || h.alias.toLowerCase().includes(q) || h.domain.toLowerCase().includes(q)).slice(0, 30);

                    const renderPick = (targetRef: string, label: string, environment: string, kind: 'wpe' | 'ssh') => {
                      const isSelected = addingException?.targetRef === targetRef;
                      const envColor = environment === 'production' ? '#f87171' : environment === 'staging' ? '#fbbf24' : '#51BB7B';
                      return React.createElement('div', {
                        key: targetRef,
                        style: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 4, cursor: 'pointer', background: isSelected ? 'rgba(59,130,246,0.15)' : 'transparent', border: isSelected ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent' },
                        onClick: () => this.setState(prev => ({ addingException: prev.addingException ? { ...prev.addingException, targetRef, environment } : null })),
                      },
                        React.createElement('div', { style: { width: 6, height: 6, borderRadius: '50%', background: envColor, flexShrink: 0 } }),
                        React.createElement('span', { style: { flex: 1, fontSize: 12, fontWeight: 500 } }, label),
                        React.createElement('span', {
                          style: { fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', padding: '1px 5px', borderRadius: 3, textTransform: 'uppercase' as const, background: kind === 'wpe' ? 'rgba(224,164,88,0.14)' : 'rgba(90,169,230,0.16)', color: kind === 'wpe' ? '#e0a458' : '#5aa9e6' },
                        }, kind),
                        React.createElement('span', { style: { fontSize: 10, color: 'var(--nxai-card-sub, #6b7280)' } }, environment),
                        isSelected ? React.createElement('span', { style: { fontSize: 10, color: '#3b82f6' } }, '✓') : null,
                      );
                    };
                    const groupLabel = (text: string) => React.createElement('div', {
                      key: `grp-${text}`,
                      style: { fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--nxai-card-sub, #6b7280)', padding: '6px 4px 2px' },
                    }, text);

                    if (wpeMatches.length === 0 && externalMatches.length === 0) {
                      return [React.createElement('div', { key: 'empty', style: { fontSize: 11, color: 'var(--nxai-status-neutral, #9ca3af)', padding: '6px 4px', fontStyle: 'italic' as const } }, 'No installs or hosts found')];
                    }
                    const out: React.ReactNode[] = [];
                    if (wpeMatches.length > 0) {
                      out.push(groupLabel('WP Engine installs'));
                      out.push(...wpeMatches.map(i => renderPick(`wpe:${i.installName}`, i.installName, i.environment, 'wpe')));
                    }
                    if (externalMatches.length > 0) {
                      out.push(groupLabel('External SSH hosts'));
                      out.push(...externalMatches.map(h => renderPick(`ssh:${h.alias}`, h.alias, h.environment, 'ssh')));
                    }
                    return out;
                  })(),
                ),
                React.createElement('div', { style: { borderTop: '1px solid var(--nxai-card-border, #30363d)', paddingTop: 8, display: 'flex', alignItems: 'center', gap: 8 } },
                  addingException?.targetRef
                    ? React.createElement('span', { style: { fontSize: 11, flex: 1 } },
                        React.createElement('strong', null, addingException.targetRef),
                        ' · ',
                        React.createElement('span', { style: { color: 'var(--nxai-card-sub, #6b7280)' } }, addingException.environment),
                      )
                    : React.createElement('span', { style: { fontSize: 11, color: 'var(--nxai-status-neutral, #9ca3af)', flex: 1, fontStyle: 'italic' as const } }, 'Select an install or host above'),
                  React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer' } },
                    React.createElement('input', {
                      type: 'checkbox', checked: addingException?.allowing ?? true,
                      onChange: (e: any) => { const v = e.target.checked; this.setState(prev => ({ addingException: prev.addingException ? { ...prev.addingException, allowing: v } : null })); },
                    }),
                    React.createElement('span', { style: { color: (addingException?.allowing ?? true) ? '#51BB7B' : '#f87171' } }, (addingException?.allowing ?? true) ? 'Allow' : 'Block'),
                  ),
                  React.createElement('button', {
                    style: { fontSize: 11, padding: '4px 10px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: addingException?.targetRef ? 'pointer' : 'not-allowed', opacity: addingException?.targetRef ? 1 : 0.5, fontFamily: 'inherit' },
                    disabled: !addingException?.targetRef,
                    onClick: (e: React.MouseEvent) => {
                      e.stopPropagation();
                      if (!addingException?.targetRef) return;
                      this.handleSiteExceptionToggle(addingException.targetRef, addingException.environment, op.id as WpeOperation, addingException.allowing);
                      this.setState({ addingException: null, installSearch: '' });
                    },
                  }, 'Save'),
                  React.createElement('button', {
                    style: { fontSize: 11, padding: '4px 10px', background: 'none', border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 4, cursor: 'pointer', color: 'var(--nxai-card-sub, #6b7280)', fontFamily: 'inherit' },
                    onClick: (e: React.MouseEvent) => { e.stopPropagation(); this.setState({ addingException: null, installSearch: '' }); },
                  }, 'Cancel'),
                ),
              )
            : React.createElement('button', {
                style: { background: 'none', border: 'none', fontSize: 12, color: '#0ECAD4', cursor: 'pointer', padding: '3px 0', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5 },
                onClick: (e: React.MouseEvent) => { e.stopPropagation(); this.setState({ addingException: { op: op.id, targetRef: '', environment: 'production', allowing: true } }); },
              }, '+ Add site exception'),
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/renderer/SettingsTab.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SettingsTab.tsx tests/unit/renderer/SettingsTab.test.tsx
git commit -m "fix(settings-ui): exceptions write targetRef, so an SSH-host exception can actually match"
```

---

### Task 4: Scope chips per operation row

**Files:**
- Modify: `src/renderer/components/SettingsTab.tsx`
- Test: `tests/unit/renderer/SettingsTab.test.tsx` *(extend)*

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — leaf visual change.

**What this adds.** Per the mockup's summary table: `wpcli_read` and `wpcli` apply to both WPE
and external targets; `pull`, `push`, and `delete` are WP-Engine-platform operations with no
external equivalent. Add a small scope label to each operation row, and dim the three
WPE-only rows — per Global Constraints, dim, never hide.

- [ ] **Step 1: Write the failing tests**

```tsx
// append to tests/unit/renderer/SettingsTab.test.tsx

describe('SettingsTab — operation scope chips', () => {
  it('labels wpcli_read and wpcli as WPE + SSH', async () => {
    const electron = mockElectron();
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    await instance.loadAll();
    instance.setState({ accessExpanded: true });
    const tree = instance.render();
    const text = textOf(tree);
    expect(text).toContain('WPE + SSH');
  });

  it('labels pull, push and delete as WPE only, and dims those rows', async () => {
    const electron = mockElectron();
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    (instance as any).setState = function (updater: any) {
      const patch = typeof updater === 'function' ? updater(this.state) : updater;
      Object.assign(this.state, patch);
    };
    await instance.loadAll();
    instance.setState({ accessExpanded: true });
    const tree = instance.render();
    const wpeOnlyLabels = findAll(tree, (n) => textOf(n).trim() === 'WPE only');
    expect(wpeOnlyLabels.length).toBe(3);
    // At least one WPE-only row's container carries reduced opacity.
    const dimmed = findAll(tree, (n) => n.props?.style?.opacity !== undefined && n.props.style.opacity < 1);
    expect(dimmed.length).toBeGreaterThan(0);
  });

  it('does not hide WPE-only rows — pull, push and delete labels are all present', async () => {
    const electron = mockElectron();
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    await instance.loadAll();
    instance.setState({ accessExpanded: true });
    const tree = instance.render();
    const text = textOf(tree);
    expect(text).toContain('Pull to local');
    expect(text).toContain('Push to WPE');
    expect(text).toContain('Delete / Promote');
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/renderer/SettingsTab.test.tsx`
Expected: FAIL — no "WPE only" or "WPE + SSH" text exists yet; no dimmed rows.

- [ ] **Step 3: Implement**

In `renderWpeAccessSection`, add a `scope` field to the `OPERATIONS` array (`:455-461`):

```ts
    const OPERATIONS: Array<{ id: WpeOperation; label: string; sub: string; icon: string; scope: 'wpe' | 'both' }> = [
      { id: 'pull',       label: 'Pull to local',              sub: 'Download files + database from WPE',                              icon: '⬇', scope: 'wpe' },
      { id: 'wpcli_read', label: 'WP-CLI over SSH (Read)',     sub: 'plugin list, core version, user list — read-only SSH commands',   icon: '⌨', scope: 'both' },
      { id: 'wpcli',      label: 'WP-CLI over SSH (Write)',    sub: 'plugin install/update, core update — modifying SSH commands',     icon: '⌨', scope: 'both' },
      { id: 'push',       label: 'Push to WPE',                sub: 'Overwrite remote with local files and DB',                        icon: '⬆', scope: 'wpe' },
      { id: 'delete',     label: 'Delete / Promote',           sub: 'Irreversible CAPI operations',                                    icon: '🗑', scope: 'wpe' },
    ];
```

In `renderOpCard` (`:490-520`), add a scope chip beside the icon and dim the row's outer
container when `scope === 'wpe'`:

```ts
    const renderOpCard = (op: typeof OPERATIONS[number]): React.ReactNode => {
      const expanded = expandedOps.has(op.id);
      const devOn = getPermVal(op.id, 'development');
      const stgOn = getPermVal(op.id, 'staging');
      const prdOn = getPermVal(op.id, 'production');
      const opExceptions = exceptions.filter(e => op.id in e.overrides);
      const scopeChip = React.createElement('span', {
        style: {
          fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase' as const, flexShrink: 0,
          background: op.scope === 'both' ? 'rgba(90,169,230,0.14)' : 'rgba(224,164,88,0.14)',
          color: op.scope === 'both' ? '#5aa9e6' : '#e0a458',
        },
      }, op.scope === 'both' ? 'WPE + SSH' : 'WPE only');

      return React.createElement('div', {
        key: op.id,
        style: { border: '1px solid var(--nxai-card-border, #30363d)', borderRadius: 7, overflow: 'hidden', marginBottom: 5, opacity: op.scope === 'wpe' ? 0.6 : 1 },
      },
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 11, padding: '10px 13px', background: 'var(--nxai-card-bg, #21262d)', cursor: 'pointer' },
          onClick: () => this.handleOpCardToggle(op.id),
        },
          React.createElement('div', { style: { width: 28, height: 28, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, background: 'rgba(128,128,128,0.08)' } }, op.icon),
          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
            React.createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, op.label),
            React.createElement('div', { style: { fontSize: 11, color: 'var(--nxai-card-sub, #6b7280)', marginTop: 1 } }, op.sub),
          ),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 } },
            scopeChip,
            envPill('Dev', devOn),
            envPill('Stg', stgOn),
            envPill('Prd', prdOn),
            opExceptions.length > 0
              ? React.createElement('span', { style: { fontSize: 10, color: '#0ECAD4', background: 'rgba(14,202,212,0.08)', border: '1px solid rgba(14,202,212,0.18)', borderRadius: 10, padding: '2px 7px' } },
                  `${opExceptions.length} exception${opExceptions.length !== 1 ? 's' : ''}`)
              : null,
            React.createElement('span', { style: { color: 'var(--nxai-status-neutral, #9ca3af)', fontSize: 9, display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' } }, '▶'),
          ),
        ),
        // ...expanded panel unchanged from Task 3's version...
      );
    };
```

The `expanded` panel body (everything after the header row — default-by-environment toggles,
site exceptions list, the picker) is unchanged from what Task 3 left it; only the outer
container's `opacity` and the header row's new `scopeChip` are added here.

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/renderer/SettingsTab.test.tsx && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SettingsTab.tsx tests/unit/renderer/SettingsTab.test.tsx
git commit -m "feat(settings-ui): scope chips on each operation row, dim WPE-only ones"
```

---

### Task 5: Documentation and full-suite verification

**Files:**
- Modify: `docs/user-guide.md` (the external-host section, `:427` area, added by the prior plan)

**No behavior changes in this task.**

- [ ] **Step 1: Update the user guide**

`docs/user-guide.md`'s external-host section currently says (added by the immediately
preceding metadata-refresh plan): *"until a UI exists, `nexus settings set
externalRefreshAutoEnabled true` is the only way to enable the scheduler."* That is no longer
true. Replace it with a note that the toggle is now in Settings → Nexus AI → Sync Schedule →
External SSH Hosts, and that the CLI command still works identically for scripting.

Also add one line under the CLI's `host add`/`list`/`remove` documentation noting that
registered hosts and their exception overrides are now visible in the same settings screen's
Access & Permissions picker.

- [ ] **Step 2: Full suite**

```bash
npx jest tests/unit/ipc/ tests/unit/renderer/SettingsTab.test.tsx && npx tsc --noEmit && npm run build
npm test 2>&1 | grep -E "^(FAIL|Tests:|Test Suites:)" | sort | uniq
```

Compare failing suite **names** against the project's existing baseline (12 pre-existing
failing suites, unrelated to this branch) — this plan must not add to that list.

- [ ] **Step 3: Manual visual check**

This plan cannot be fully verified by a headless test run — it changes what a human sees.
Rebuild for Electron and open the app:

```bash
npm run rebuild && ./dev-reload.sh
```

Open Local → the addon's Nexus AI tab → Settings, and confirm by eye:

- The account-scope chip bar appears above "WP Engine Installs", not hidden behind
  "Access & Permissions".
- An "External SSH Hosts" card appears with a chip for each host `nexus host list` shows, and
  a working enable/interval row for the refresh schedule.
- Toggling that row and reloading the tab shows the change persisted (confirms the settings
  round-trip, not just local component state).
- Expanding "WP-CLI over SSH (Read)" or "(Write)" in Access & Permissions shows a "WPE + SSH"
  chip; expanding "Pull to local" shows "WPE only" and the row appears visually dimmed.
- Adding a site exception's picker shows two grouped sections when at least one external host
  is registered — "WP Engine installs" and "External SSH hosts".

This step cannot be automated by an agent without a display — if you are executing this plan
as a subagent, report the code-level verification (Steps 1-2) as complete and explicitly flag
Step 3 as requiring the human developer's own visual confirmation, rather than claiming it
succeeded.

- [ ] **Step 4: Commit**

```bash
git add docs/user-guide.md
git commit -m "docs(settings-ui): point external-host docs at the new UI, not just the CLI"
```

---

## Self-Review

**Spec coverage.** Mockup's four numbered callouts, each mapped: #1 (account scope
mislabeled/misplaced) → Task 2. #2 (target exceptions can't name an SSH host — "the only
functional bug in Axis B") → Task 3. #3 (scope-chip operation rows, dim not hide) → Task 4.
#4 (write `remote*` keys) → Task 3 (`saveSetting` calls). The summary table's six rows: Sync
scope → Task 2; Schedules → Task 2; Operation rows → Task 4; Env defaults → unchanged, already
correct per the mockup's own "None — already works" entry; Target exceptions → Task 3; Setting
keys → Task 3.

**Adaptation from the mockup, disclosed rather than silent.** The mockup shows WPE and
external-host content merged into one card under "Remote sync & refresh". This plan keeps them
as two visually distinct cards (matching the existing code's one-card-per-source-type
structure, e.g. "Local Sites" / "WP Engine Installs" are already separate cards) rather than
merging markup into a single card. The information shown is identical; only the visual
grouping differs slightly from the mockup's exact HTML structure.

**Placeholders.** None. Every code step contains complete `React.createElement` trees, not
descriptions of them.

**Type consistency.** `externalHosts: Array<{alias, environment, domain}>` is defined in Task
2 and consumed identically in Tasks 3 and 4's tests. `targetRef` matches
`RemoteSiteException.targetRef` from `src/common/types.ts` exactly (no new type introduced).
`addingException`'s `targetRef` field (Task 3) is consistently named across the handler
signature, the picker, and the save button's guard clause. `WpeOperation`/`WpeEnv` are reused
unchanged from the top of the file throughout.
