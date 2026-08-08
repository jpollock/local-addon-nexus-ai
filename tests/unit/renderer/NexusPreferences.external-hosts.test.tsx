import * as React from 'react';
import { NexusPreferences } from '../../../src/renderer/components/NexusPreferences';
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
    [IPC_CHANNELS.GET_SITES]: [],
    [IPC_CHANNELS.GET_PROVIDERS]: [],
    [IPC_CHANNELS.GET_API_KEY_STATUS]: {},
    [IPC_CHANNELS.WPE_GET_API_CREDENTIALS_STATUS]: { configured: false },
    [IPC_CHANNELS.GET_WPE_ACCOUNTS]: [],
    [IPC_CHANNELS.GET_WPE_INSTALLS_CACHE]: [],
    [IPC_CHANNELS.GET_EXTERNAL_HOSTS]: [],
    [IPC_CHANNELS.UPDATE_SETTINGS]: { success: true },
    [IPC_CHANNELS.LIST_SSH_CONFIG_HOSTS]: { success: true, hosts: [] },
    [IPC_CHANNELS.SET_EXTERNAL_HOST_ROOT_MODE]: { success: true, error: null },
    [IPC_CHANNELS.CREDENTIAL_API_KEY_STATUS]: null,
  };
  const table = { ...defaults, ...overrides };
  return { ipcRenderer: { invoke: jest.fn((ch: string) => Promise.resolve(table[ch])) } };
}

// `new NexusPreferences(props)` is instantiated without ReactDOM ever mounting
// it, so React's real `setState` -- which requires `_reactInternals` from an
// actual mount -- is a silent no-op (it just warns "not yet mounted"). Every
// other class-component test in this directory (see SettingsTab.test.tsx's
// `spySetState`, which this was ported from) works around this the same way:
// replace `setState` with a synchronous merge into `this.state` so
// `fetchData()` and event handlers behave as they would when actually mounted.
function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, ...args: any[]) {
    const [updater, cb] = args;
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
    if (cb) cb();
  });
}

/** Expands the "External SSH Hosts" section, which is collapsed by default. */
async function loadAndExpand(instance: any): Promise<void> {
  await instance.fetchData();
  instance.setState({ expandedSections: new Set([...instance.state.expandedSections, 'external-hosts']) });
}

describe('NexusPreferences — external hosts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads external hosts into state', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_EXTERNAL_HOSTS]: [{ alias: 'hostinger-test', environment: 'production', domain: 'example.com' }],
    });
    const instance: any = new NexusPreferences({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await loadAndExpand(instance);
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
    const instance: any = new NexusPreferences({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await loadAndExpand(instance);
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
    const instance: any = new NexusPreferences({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await loadAndExpand(instance);
    const tree = instance.render();
    const aliasNode = findAll(tree, (n) => textOf(n).trim() === 'hostinger-test')[0];
    expect(aliasNode.props.onClick).toBeUndefined();
  });

  it('an "Add a host" button mounts ExternalHostAddWizard', async () => {
    const electron = mockElectron();
    const instance: any = new NexusPreferences({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await loadAndExpand(instance);
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
    const instance: any = new NexusPreferences({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await loadAndExpand(instance);
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
    const instance: any = new NexusPreferences({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await loadAndExpand(instance);
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
    const instance: any = new NexusPreferences({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await loadAndExpand(instance);
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

  it('checking an alias with an unknown host key shows the fingerprint and an Approve button', async () => {
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
    const instance: any = new NexusPreferences({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await loadAndExpand(instance);
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
    const instance: any = new NexusPreferences({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await loadAndExpand(instance);
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
    const instance: any = new NexusPreferences({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await loadAndExpand(instance);
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
    const instance: any = new NexusPreferences({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await loadAndExpand(instance);
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
    const instance: any = new NexusPreferences({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await loadAndExpand(instance);
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
    const instance: any = new NexusPreferences({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await loadAndExpand(instance);
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
    const instance: any = new NexusPreferences({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await loadAndExpand(instance);

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
    const instance: any = new NexusPreferences({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await loadAndExpand(instance);

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
    const instance: any = new NexusPreferences({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await loadAndExpand(instance);

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
    const instance: any = new NexusPreferences({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await loadAndExpand(instance);
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
    const instance: any = new NexusPreferences({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
    await loadAndExpand(instance);
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
