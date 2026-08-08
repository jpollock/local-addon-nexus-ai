import * as React from 'react';
import { SettingsTab } from '../../../src/renderer/components/SettingsTab';
import { ExternalHostAddWizard } from '../../../src/renderer/components/settings/ExternalHostAddWizard';
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
    [IPC_CHANNELS.LIST_SSH_CONFIG_HOSTS]: { success: true, hosts: [] },
    [IPC_CHANNELS.SET_EXTERNAL_HOST_ROOT_MODE]: { success: true, error: null },
  };
  const table = { ...defaults, ...overrides };
  return { ipcRenderer: { invoke: jest.fn((ch: string) => Promise.resolve(table[ch])) } };
}

// `new SettingsTab(props)` is instantiated without ReactDOM ever mounting it,
// so React's real `setState` — which requires `_reactInternals` from an
// actual mount — is a silent no-op (it just warns "not yet mounted"). Every
// other class-component test in this directory (see BulkOperationsPanel.test.tsx's
// `spySetState`) works around this the same way: replace `setState` with a
// synchronous merge into `this.state` so `loadAll()` and event handlers behave
// as they would when actually mounted.
function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
  });
}

describe('SettingsTab — external hosts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads external hosts into state', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_EXTERNAL_HOSTS]: [{ alias: 'hostinger-test', environment: 'production', domain: 'example.com' }],
    });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    expect(instance.state.externalHosts).toEqual([
      { alias: 'hostinger-test', environment: 'production', domain: 'example.com' },
    ]);
  });

  it('renders a host list row per registered external host with alias, resolved connection info, and a status dot', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_EXTERNAL_HOSTS]: [{ alias: 'hostinger-test', site: 'site-a', environment: 'production', domain: 'example.com' }],
      [IPC_CHANNELS.LIST_SSH_CONFIG_HOSTS]: {
        success: true,
        hosts: [{ alias: 'hostinger-test', hostname: 'box.example.com', user: 'deploy', port: 22, alreadyRegistered: true }],
      },
    });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    const tree = instance.render();
    const text = textOf(tree);
    expect(text).toContain('hostinger-test');
    expect(text).toContain('deploy@box.example.com:22');
    expect(text).toContain('~/.ssh/config');
    expect(text).toContain('1 site');
    // A status dot (a small round div) is rendered alongside the row.
    const dots = findAll(tree, (n) => n.type === 'div' && n.props?.style?.borderRadius === '50%');
    expect(dots.length).toBeGreaterThan(0);
  });

  it('external host rows are not clickable — no onClick handler on the alias/connection info', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_EXTERNAL_HOSTS]: [{ alias: 'hostinger-test', site: 'site-a', environment: 'production', domain: 'example.com' }],
    });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    const tree = instance.render();
    const aliasNode = findAll(tree, (n) => textOf(n).trim() === 'hostinger-test')[0];
    expect(aliasNode.props.onClick).toBeUndefined();
  });

  it('an "Add a host" button mounts ExternalHostAddWizard', async () => {
    const electron = mockElectron();
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    let tree = instance.render();
    const addButton = findAll(tree, (n) => n.type === 'button' && /add a host/i.test(textOf(n)))[0];
    expect(addButton).toBeDefined();
    expect(instance.state.showAddHostWizard).toBe(false);
    addButton.props.onClick();
    expect(instance.state.showAddHostWizard).toBe(true);
    tree = instance.render();
    const wizardNodes = findAll(tree, (n) => n.type === ExternalHostAddWizard);
    expect(wizardNodes.length).toBe(1);
  });

  it('closing the wizard (onClose) unmounts it and reloads the host list', async () => {
    const electron = mockElectron();
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    instance.setState({ showAddHostWizard: true });
    let tree = instance.render();
    const wizard = findAll(tree, (n) => n.type === ExternalHostAddWizard)[0];
    electron.ipcRenderer.invoke.mockClear();
    await wizard.props.onClose();
    expect(instance.state.showAddHostWizard).toBe(false);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.GET_EXTERNAL_HOSTS);
    tree = instance.render();
    expect(findAll(tree, (n) => n.type === ExternalHostAddWizard)).toHaveLength(0);
  });

  it('completing the wizard (onCompleted) unmounts it and reloads the host list', async () => {
    const electron = mockElectron();
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    instance.setState({ showAddHostWizard: true });
    const tree = instance.render();
    const wizard = findAll(tree, (n) => n.type === ExternalHostAddWizard)[0];
    electron.ipcRenderer.invoke.mockClear();
    await wizard.props.onCompleted('newbox');
    expect(instance.state.showAddHostWizard).toBe(false);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.GET_EXTERNAL_HOSTS);
  });

  it('Manage exposes a root-mode toggle that calls SET_EXTERNAL_HOST_ROOT_MODE for that alias', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_EXTERNAL_HOSTS]: [{ alias: 'hostinger-test', site: 'site-a', environment: 'production', domain: 'example.com' }],
    });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    let tree = instance.render();
    const manageButton = findAll(tree, (n) => n.type === 'button' && /manage/i.test(textOf(n)))[0];
    expect(manageButton).toBeDefined();
    manageButton.props.onClick();
    tree = instance.render();
    const rootButton = findAll(tree, (n) => n.type === 'button' && /allow root/i.test(textOf(n)))[0];
    expect(rootButton).toBeDefined();
    await rootButton.props.onClick();
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.SET_EXTERNAL_HOST_ROOT_MODE, 'hostinger-test', true);
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
    spySetState(instance);
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
    spySetState(instance);
    await instance.loadAll();
    const tree = instance.render();
    const wholeText = textOf(tree);
    expect(wholeText).not.toContain('from the permissions below');
  });

  it('the account-scope bar renders outside the Access & Permissions accordion (always visible)', async () => {
    const electron = mockElectron({ [IPC_CHANNELS.GET_WPE_ACCOUNTS]: [{ id: 'a1', name: 'Acme' }] });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    // accessExpanded is false by default — Access & Permissions content is collapsed.
    expect(instance.state.accessExpanded).toBe(false);
    const tree = instance.render();
    // The account chip must still be present even though the accordion is collapsed.
    const chip = findAll(tree, (n) => textOf(n).trim().includes('Acme'));
    expect(chip.length).toBeGreaterThan(0);
  });

  it('checking an alias with an unknown host key shows the fingerprint and an Approve button', async () => {
    const mutateMock = jest.fn().mockResolvedValue({
      data: {
        nexusHostProbe: {
          success: true, error: null,
          report: { ok: false, alias: 'newbox', failure: {
            kind: 'host-key-unknown', detail: 'x', remedy: 'y',
            fingerprint: 'SHA256:abc123', keyType: 'ED25519',
          } },
        },
      },
    });
    jest.spyOn(global as any, 'fetch').mockImplementation(() => Promise.resolve({
      json: () => Promise.resolve((mutateMock() as any).then ? undefined : undefined),
    } as any));
    // rendererGql posts to fetch and reads response.json() -- simulate that shape directly:
    (global as any).fetch = jest.fn().mockResolvedValue({
      json: async () => ({ data: { nexusHostProbe: {
        success: true, error: null,
        report: { ok: false, alias: 'newbox', failure: {
          kind: 'host-key-unknown', detail: 'x', remedy: 'y',
          fingerprint: 'SHA256:abc123', keyType: 'ED25519',
        } },
      } } }),
    });

    const electron = mockElectron({});
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    instance.setState({ hostKeyCheckAlias: 'newbox' });
    await instance.checkHostKey();
    const tree = instance.render();
    expect(textOf(tree)).toContain('SHA256:abc123');
    expect(textOf(tree)).toContain('ED25519');
    const approveButtons = findAll(tree, (n) => n.type === 'button' && textOf(n).includes('Approve'));
    expect(approveButtons.length).toBeGreaterThan(0);
  });

  it('approving calls the TRUST_EXTERNAL_HOST_KEY IPC channel, not GraphQL', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      json: async () => ({ data: { nexusHostProbe: {
        success: true, error: null,
        report: { ok: false, alias: 'newbox', failure: {
          kind: 'host-key-unknown', detail: 'x', remedy: 'y',
          fingerprint: 'SHA256:abc123', keyType: 'ED25519',
        } },
      } } }),
    });
    const invokeMock = jest.fn().mockResolvedValue({ success: true, error: null, fingerprint: 'SHA256:abc123' });
    const electron = mockElectron({});
    electron.ipcRenderer.invoke = invokeMock;
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    instance.setState({ hostKeyCheckAlias: 'newbox' });
    await instance.checkHostKey();
    await instance.approveHostKey();
    expect(invokeMock).toHaveBeenCalledWith(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, 'newbox', 'SHA256:abc123');
  });

  it('approveHostKey sends the fingerprint that was actually displayed to the human, not a hardcoded or empty value', async () => {
    // Use a fingerprint that no other test in this file happens to use, so a
    // hardcoded/copy-pasted literal in the implementation would fail this test.
    const displayedFingerprint = 'SHA256:uniquely-displayed-999';
    (global as any).fetch = jest.fn().mockResolvedValue({
      json: async () => ({ data: { nexusHostProbe: {
        success: true, error: null,
        report: { ok: false, alias: 'newbox', failure: {
          kind: 'host-key-unknown', detail: 'x', remedy: 'y',
          fingerprint: displayedFingerprint, keyType: 'ED25519',
        } },
      } } }),
    });
    const invokeMock = jest.fn().mockResolvedValue({ success: true, error: null, fingerprint: displayedFingerprint });
    const electron = mockElectron({});
    electron.ipcRenderer.invoke = invokeMock;
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    instance.setState({ hostKeyCheckAlias: 'newbox' });
    await instance.checkHostKey();
    expect(instance.state.hostKeyCheckResult.fingerprint).toBe(displayedFingerprint);
    await instance.approveHostKey();
    expect(invokeMock).toHaveBeenCalledWith(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, 'newbox', displayedFingerprint);
  });

  it('a changed host key shows no Approve button', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      json: async () => ({ data: { nexusHostProbe: {
        success: true, error: null,
        report: { ok: false, alias: 'newbox', failure: {
          kind: 'host-key-changed', detail: 'REMOTE HOST IDENTIFICATION HAS CHANGED', remedy: 'contact your admin',
        } },
      } } }),
    });
    const electron = mockElectron({});
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    instance.setState({ hostKeyCheckAlias: 'newbox' });
    await instance.checkHostKey();
    const tree = instance.render();
    expect(textOf(tree)).toContain('contact your admin');
    expect(findAll(tree, (n) => n.type === 'button' && textOf(n).includes('Approve'))).toHaveLength(0);
  });

  it('editing the alias after a check hides the Approve button for the stale result', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      json: async () => ({ data: { nexusHostProbe: {
        success: true, error: null,
        report: { ok: false, alias: 'alias-a', failure: {
          kind: 'host-key-unknown', detail: 'x', remedy: 'y',
          fingerprint: 'SHA256:abc123', keyType: 'ED25519',
        } },
      } } }),
    });
    const electron = mockElectron({});
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    instance.setState({ hostKeyCheckAlias: 'alias-a' });
    await instance.checkHostKey();
    // User edits the input to a different alias WITHOUT re-checking.
    instance.setState({ hostKeyCheckAlias: 'alias-b' });
    const tree = instance.render();
    // The stale fingerprint may still be shown, but there must be no live
    // Approve button hanging off it — that would let alias-b get trusted
    // using a fingerprint the human verified for alias-a.
    expect(findAll(tree, (n) => n.type === 'button' && textOf(n).includes('Approve'))).toHaveLength(0);
  });

  it('approving targets the alias that was actually checked, not a since-edited input', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      json: async () => ({ data: { nexusHostProbe: {
        success: true, error: null,
        report: { ok: false, alias: 'alias-a', failure: {
          kind: 'host-key-unknown', detail: 'x', remedy: 'y',
          fingerprint: 'SHA256:abc123', keyType: 'ED25519',
        } },
      } } }),
    });
    const invokeMock = jest.fn().mockResolvedValue({ success: true, error: null, fingerprint: 'SHA256:abc123' });
    const electron = mockElectron({});
    electron.ipcRenderer.invoke = invokeMock;
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    instance.setState({ hostKeyCheckAlias: 'alias-a' });
    await instance.checkHostKey();
    // Simulate the input having changed, then reverted — approveHostKey must
    // still use the stored checked-alias, never a live re-read.
    instance.setState({ hostKeyCheckAlias: 'alias-a' });
    await instance.approveHostKey();
    expect(invokeMock).toHaveBeenCalledWith(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, 'alias-a', 'SHA256:abc123');
  });

  it('a stale out-of-order response for an old alias does not overwrite a newer check', async () => {
    let resolveFirst: (v: any) => void;
    const firstResponse = new Promise((resolve) => { resolveFirst = resolve; });
    const fetchMock = jest.fn()
      .mockImplementationOnce(() => firstResponse)
      .mockImplementationOnce(() => Promise.resolve({
        json: async () => ({ data: { nexusHostProbe: {
          success: true, error: null,
          report: { ok: false, alias: 'alias-b', failure: {
            kind: 'host-key-unknown', detail: 'x', remedy: 'y',
            fingerprint: 'SHA256:newer', keyType: 'ED25519',
          } },
        } } }),
      }));
    (global as any).fetch = fetchMock;
    const electron = mockElectron({});
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();

    // Kick off a check for alias-a; its response has not resolved yet.
    instance.setState({ hostKeyCheckAlias: 'alias-a' });
    const firstCheck = instance.checkHostKey();
    // Before it resolves, the user edits the input and checks alias-b, which
    // resolves immediately.
    instance.setState({ hostKeyCheckAlias: 'alias-b' });
    await instance.checkHostKey();
    // Now the first (older) response for alias-a finally resolves.
    resolveFirst!({
      json: async () => ({ data: { nexusHostProbe: {
        success: true, error: null,
        report: { ok: false, alias: 'alias-a', failure: {
          kind: 'host-key-unknown', detail: 'x', remedy: 'y',
          fingerprint: 'SHA256:stale', keyType: 'ED25519',
        } },
      } } }),
    });
    await firstCheck;

    const tree = instance.render();
    // The newer alias-b result must still be displayed; the stale alias-a
    // response must have been discarded, not applied on top.
    expect(textOf(tree)).toContain('SHA256:newer');
    expect(textOf(tree)).not.toContain('SHA256:stale');
    expect(instance.state.hostKeyCheckedAlias).toBe('alias-b');
  });

  it('a stale/discarded response clears hostKeyChecking so the Check button does not stay disabled forever', async () => {
    // Regression test: click Check, edit the alias before the (now up-to-210s)
    // probe resolves, so the response is discarded as stale -- but no NEW check
    // is kicked off. hostKeyChecking must still be cleared, or the Check button
    // stays disabled/stuck on "Checking…" until the component remounts.
    let resolveFetch: (v: any) => void;
    const pending = new Promise((resolve) => { resolveFetch = resolve; });
    (global as any).fetch = jest.fn().mockReturnValue(pending);
    const electron = mockElectron({});
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();

    instance.setState({ hostKeyCheckAlias: 'alias-a' });
    const checkPromise = instance.checkHostKey();
    expect(instance.state.hostKeyChecking).toBe(true);

    // User edits the alias while the probe is still in flight, WITHOUT
    // kicking off a new check.
    instance.setState({ hostKeyCheckAlias: 'alias-b' });

    resolveFetch!({
      json: async () => ({ data: { nexusHostProbe: {
        success: true, error: null,
        report: { ok: false, alias: 'alias-a', failure: {
          kind: 'host-key-unknown', detail: 'x', remedy: 'y',
          fingerprint: 'SHA256:stale', keyType: 'ED25519',
        } },
      } } }),
    });
    await checkPromise;

    expect(instance.state.hostKeyChecking).toBe(false);
    const tree = instance.render();
    const checkButton = findAll(tree, (n) => n.type === 'button' && /check/i.test(textOf(n)))[0];
    expect(checkButton.props.disabled).toBe(false);
  });

  it('a stale response does NOT clear hostKeyChecking out from under a newer check that is still in flight', async () => {
    // If a second checkHostKey() genuinely started before the first (stale)
    // one resolves, the first must not clear hostKeyChecking -- the second
    // call owns it until it finishes.
    let resolveFirst: (v: any) => void;
    let resolveSecond: (v: any) => void;
    const firstResponse = new Promise((resolve) => { resolveFirst = resolve; });
    const secondResponse = new Promise((resolve) => { resolveSecond = resolve; });
    const fetchMock = jest.fn()
      .mockImplementationOnce(() => firstResponse)
      .mockImplementationOnce(() => secondResponse);
    (global as any).fetch = fetchMock;
    const electron = mockElectron({});
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();

    instance.setState({ hostKeyCheckAlias: 'alias-a' });
    const firstCheck = instance.checkHostKey();
    instance.setState({ hostKeyCheckAlias: 'alias-b' });
    const secondCheck = instance.checkHostKey();
    expect(instance.state.hostKeyChecking).toBe(true);

    // The stale first response resolves while the second is still pending.
    resolveFirst!({
      json: async () => ({ data: { nexusHostProbe: {
        success: true, error: null,
        report: { ok: false, alias: 'alias-a', failure: {
          kind: 'host-key-unknown', detail: 'x', remedy: 'y',
          fingerprint: 'SHA256:stale', keyType: 'ED25519',
        } },
      } } }),
    });
    await firstCheck;
    // The second check is still in flight -- its hostKeyChecking must survive.
    expect(instance.state.hostKeyChecking).toBe(true);

    resolveSecond!({
      json: async () => ({ data: { nexusHostProbe: {
        success: true, error: null,
        report: { ok: false, alias: 'alias-b', failure: {
          kind: 'host-key-unknown', detail: 'x', remedy: 'y',
          fingerprint: 'SHA256:newer', keyType: 'ED25519',
        } },
      } } }),
    });
    await secondCheck;
    expect(instance.state.hostKeyChecking).toBe(false);
  });

  it('checkHostKey passes the 210s host-probe timeout to rendererGql, not the 10s default', async () => {
    // probeExternalHost's documented sequential worst case is ~155s; the CLI's
    // HOST_PROBE_CLIENT_TIMEOUT_MS (src/cli/commands/host.ts) is 210000 for the
    // same reason. rendererGql's own default (10s) would abort a slow-but-working
    // probe long before it finishes.
    (global as any).fetch = jest.fn().mockResolvedValue({
      json: async () => ({ data: { nexusHostProbe: { success: true, error: null, report: { ok: true, alias: 'newbox' } } } }),
    });
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const electron = mockElectron({});
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    instance.setState({ hostKeyCheckAlias: 'newbox' });
    await instance.checkHostKey();
    const timeoutCall = setTimeoutSpy.mock.calls.find((c) => c[1] === 210000);
    expect(timeoutCall).toBeDefined();
    setTimeoutSpy.mockRestore();
  });

  it('disables the Check button and shows a pending indicator while a check is in flight', async () => {
    let resolveFetch: (v: any) => void;
    const pending = new Promise((resolve) => { resolveFetch = resolve; });
    (global as any).fetch = jest.fn().mockReturnValue(pending);
    const electron = mockElectron({});
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    instance.setState({ hostKeyCheckAlias: 'newbox' });

    const checkPromise = instance.checkHostKey();
    const treeDuring = instance.render();
    const checkButtonDuring = findAll(treeDuring, (n) => n.type === 'button' && /check/i.test(textOf(n)))[0];
    expect(checkButtonDuring.props.disabled).toBe(true);
    expect(textOf(checkButtonDuring)).toMatch(/checking/i);

    resolveFetch!({
      json: async () => ({ data: { nexusHostProbe: { success: true, error: null, report: { ok: true, alias: 'newbox' } } } }),
    });
    await checkPromise;

    const treeAfter = instance.render();
    const checkButtonAfter = findAll(treeAfter, (n) => n.type === 'button' && /check/i.test(textOf(n)))[0];
    expect(checkButtonAfter.props.disabled).toBe(false);
  });
});

describe('SettingsTab — exception picker writes targetRef', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes remoteSiteExceptions with a wpe: prefix for a WPE install', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_WPE_INSTALLS_CACHE]: [{ installName: 'mystore', environment: 'production', primaryDomain: 'mystore.wpengine.com' }],
    });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
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
    spySetState(instance);
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
    spySetState(instance);
    await instance.loadAll();
    // The exceptions list only renders once both the Access & Permissions accordion and the
    // WP-CLI (Write) op card are expanded.
    instance.setState({ accessExpanded: true });
    instance.handleOpCardToggle('wpcli');
    const tree = instance.render();
    expect(textOf(tree)).toContain('legacy-store');
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
    spySetState(instance);
    await instance.loadAll();
    instance.setState({ accessExpanded: true });
    instance.handleOpCardToggle('wpcli');
    const tree = instance.render();
    expect(textOf(tree)).toContain('new');
    expect(textOf(tree)).not.toContain('old');
  });

  it('removing a legacy user\'s last exception clears wpeSiteExceptions too, so the fallback cannot resurrect it', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_SETTINGS]: {
        autoIndex: true, excludedSiteIds: [],
        wpeSiteExceptions: [{ installName: 'legacy-store', environment: 'production', overrides: { wpcli: false } }],
      },
    });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    instance.handleSiteExceptionRemove('wpe:legacy-store', 'production');
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.UPDATE_SETTINGS,
      { remoteSiteExceptions: [], wpeSiteExceptions: [] },
    );
  });

  it('removing one of two legacy exceptions does NOT clear wpeSiteExceptions, since the array is still non-empty', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_SETTINGS]: {
        autoIndex: true, excludedSiteIds: [],
        wpeSiteExceptions: [
          { installName: 'legacy-store', environment: 'production', overrides: { wpcli: false } },
          { installName: 'other-store', environment: 'production', overrides: { wpcli: false } },
        ],
      },
    });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    instance.handleSiteExceptionRemove('wpe:legacy-store', 'production');
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.UPDATE_SETTINGS,
      { remoteSiteExceptions: [{ targetRef: 'wpe:other-store', environment: 'production', overrides: { wpcli: false } }] },
    );
  });

  it('the exception picker lists external hosts in a separate group from WPE installs', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_WPE_INSTALLS_CACHE]: [{ installName: 'mystore', environment: 'production', primaryDomain: 'mystore.wpengine.com' }],
      [IPC_CHANNELS.GET_EXTERNAL_HOSTS]: [{ alias: 'hostinger-test', environment: 'production', domain: 'example.com' }],
    });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await instance.loadAll();
    instance.setState({ accessExpanded: true });
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

describe('SettingsTab — operation scope chips', () => {
  it('labels wpcli_read and wpcli as WPE + SSH', async () => {
    const electron = mockElectron();
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
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
    spySetState(instance);
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
    spySetState(instance);
    await instance.loadAll();
    instance.setState({ accessExpanded: true });
    const tree = instance.render();
    const text = textOf(tree);
    expect(text).toContain('Pull to local');
    expect(text).toContain('Push to WPE');
    expect(text).toContain('Delete / Promote');
  });
});
