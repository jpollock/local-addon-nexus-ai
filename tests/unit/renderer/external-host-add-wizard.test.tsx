import * as React from 'react';
import { ExternalHostAddWizard } from '../../../src/renderer/components/settings/ExternalHostAddWizard';
import { IPC_CHANNELS } from '../../../src/common/constants';

// ---------------------------------------------------------------------------
// Shared test helpers — copied from tests/unit/renderer/SettingsTab.test.tsx's
// convention (findAll/textOf tree-walkers, spySetState work-around for
// setState being a no-op on an unmounted instance, and mocking `global.fetch`
// for rendererGql).
// ---------------------------------------------------------------------------

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

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
  });
}

function mockElectron(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = {
    [IPC_CHANNELS.LIST_SSH_CONFIG_HOSTS]: { success: true, hosts: [] },
  };
  const table = { ...defaults, ...overrides };
  return { ipcRenderer: { invoke: jest.fn((ch: string, ..._args: any[]) => Promise.resolve(table[ch])) } };
}

function gqlResponse(multiIssue: any, extra: Record<string, any> = {}) {
  return {
    json: async () => ({
      data: { nexusHostProbe: { success: true, error: null, report: null, multiIssue, ...extra } },
    }),
  };
}

function checkState(status: 'ok' | 'warn' | 'fail' | 'idle', detail = status) {
  return { status, detail };
}

function baseChecks(overrides: Partial<Record<'connection' | 'hostKey' | 'wpCli' | 'installs', any>> = {}) {
  return {
    connection: checkState('ok'),
    hostKey: checkState('ok'),
    wpCli: checkState('ok'),
    installs: checkState('ok'),
    ...overrides,
  };
}

function noProps(): any {
  return { electron: mockElectron(), onClose: jest.fn(), onCompleted: jest.fn(), onProbeClean: jest.fn() };
}

describe('ExternalHostAddWizard', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts on step 1 in pick mode, calling LIST_SSH_CONFIG_HOSTS on mount', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.LIST_SSH_CONFIG_HOSTS]: {
        success: true,
        hosts: [{ alias: 'a', hostname: 'h', user: 'u', port: 22, alreadyRegistered: false }],
      },
    });
    const props = { electron, onClose: jest.fn(), onCompleted: jest.fn(), onProbeClean: jest.fn() };
    const instance: any = new ExternalHostAddWizard(props);
    spySetState(instance);
    instance.mounted = true;
    await instance.componentDidMount();
    expect(instance.state.step).toBe(1);
    expect(instance.state.step1Mode).toBe('pick');
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.LIST_SSH_CONFIG_HOSTS);
    const tree = instance.render();
    expect(textOf(tree)).toContain('a');
  });

  it('an alreadyRegistered host in the picker is dimmed and clicking it does not advance the step', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.LIST_SSH_CONFIG_HOSTS]: {
        success: true,
        hosts: [{ alias: 'reg-host', hostname: 'h', user: 'u', port: 22, alreadyRegistered: true }],
      },
    });
    const props = { electron, onClose: jest.fn(), onCompleted: jest.fn(), onProbeClean: jest.fn() };
    const instance: any = new ExternalHostAddWizard(props);
    spySetState(instance);
    instance.mounted = true;
    await instance.componentDidMount();
    const tree = instance.render();
    const row = findAll(tree, (n) => textOf(n).includes('reg-host') && n.props?.style?.opacity !== undefined)[0];
    expect(row).toBeDefined();
    expect(row.props.style.opacity).toBeLessThan(1);
    // Clicking must not advance the step -- and there must be no onClick handler at all.
    const clickable = findAll(tree, (n) => textOf(n).includes('reg-host') && typeof n.props?.onClick === 'function');
    expect(clickable).toHaveLength(0);
    expect(instance.state.step).toBe(1);
  });

  it('selecting an unregistered host calls nexusHostProbe and advances to step 2 on response', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(gqlResponse({ checks: baseChecks(), issues: [], wpCliVersion: '2.9', installs: ['/var/www/html'] }));
    const electron = mockElectron({
      [IPC_CHANNELS.LIST_SSH_CONFIG_HOSTS]: {
        success: true,
        hosts: [{ alias: 'newbox', hostname: 'h', user: 'u', port: 22, alreadyRegistered: false }],
      },
    });
    const props = { electron, onClose: jest.fn(), onCompleted: jest.fn(), onProbeClean: jest.fn() };
    const instance: any = new ExternalHostAddWizard(props);
    spySetState(instance);
    instance.mounted = true;
    await instance.componentDidMount();
    await instance.selectAlias('newbox');
    expect((global as any).fetch).toHaveBeenCalled();
    expect(instance.state.step).toBe(2);
    expect(instance.state.alias).toBe('newbox');
  });

  it('switching to "create a new SSH config entry" shows the alias/hostname/user/port/key form (step 1b)', async () => {
    const props = noProps();
    const instance: any = new ExternalHostAddWizard(props);
    spySetState(instance);
    instance.mounted = true;
    await instance.componentDidMount();
    instance.setState({ step1Mode: 'new' });
    const tree = instance.render();
    const inputs = findAll(tree, (n) => n.type === 'input');
    const names = inputs.map((n) => `${n.props.name ?? ''} ${n.props.placeholder ?? ''}`).join(',');
    expect(names.toLowerCase()).toEqual(expect.stringContaining('alias'));
    expect(names.toLowerCase()).toEqual(expect.stringContaining('hostname'));
    expect(names.toLowerCase()).toEqual(expect.stringContaining('user'));
    expect(names.toLowerCase()).toEqual(expect.stringContaining('port'));
  });

  it('the Write entry & probe button is disabled while PREVIEW_SSH_HOST_ENTRY reports an exact collision', async () => {
    const electron = mockElectron();
    const props = { electron, onClose: jest.fn(), onCompleted: jest.fn(), onProbeClean: jest.fn() };
    const instance: any = new ExternalHostAddWizard(props);
    spySetState(instance);
    instance.mounted = true;
    await instance.componentDidMount();
    instance.setState({
      step1Mode: 'new',
      preview: { block: '', collision: { kind: 'exact', file: '~/.ssh/config', line: 3 } },
    });
    const tree = instance.render();
    const btn = findAll(tree, (n) => n.type === 'button' && /write entry/i.test(textOf(n)))[0];
    expect(btn.props.disabled).toBe(true);
  });

  it('the Write entry & probe button remains enabled on a pattern-kind collision, and the warning is shown', async () => {
    const props = noProps();
    const instance: any = new ExternalHostAddWizard(props);
    spySetState(instance);
    instance.mounted = true;
    await instance.componentDidMount();
    instance.setState({
      step1Mode: 'new',
      newEntry: { alias: 'x', hostname: 'h', user: 'u', port: '22', identityFile: '' },
      preview: { block: 'Host x', collision: { kind: 'pattern', pattern: '*.example.com', file: '~/.ssh/config' } },
    });
    const tree = instance.render();
    const btn = findAll(tree, (n) => n.type === 'button' && /write entry/i.test(textOf(n)))[0];
    expect(btn.props.disabled).toBeFalsy();
    expect(textOf(tree)).toContain('*.example.com');
  });

  it('submitting step 1b calls WRITE_SSH_HOST_ENTRY then probes the new alias and advances to step 2', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(gqlResponse({ checks: baseChecks(), issues: [], wpCliVersion: '2.9', installs: [] }));
    const electron = mockElectron({
      [IPC_CHANNELS.WRITE_SSH_HOST_ENTRY]: { success: true, error: null },
    });
    const props = { electron, onClose: jest.fn(), onCompleted: jest.fn(), onProbeClean: jest.fn() };
    const instance: any = new ExternalHostAddWizard(props);
    spySetState(instance);
    instance.mounted = true;
    await instance.componentDidMount();
    instance.setState({
      step1Mode: 'new',
      newEntry: { alias: 'newbox', hostname: 'h', user: 'u', port: '22', identityFile: '' },
      preview: { block: 'Host newbox', collision: { kind: 'none' } },
    });
    await instance.writeEntryAndProbe();
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.WRITE_SSH_HOST_ENTRY, {
      alias: 'newbox', hostname: 'h', user: 'u', port: '22', identityFile: '',
    });
    expect(instance.state.step).toBe(2);
    expect(instance.state.alias).toBe('newbox');
  });

  it('step 2 renders all four check rows regardless of status', async () => {
    const props = noProps();
    const instance: any = new ExternalHostAddWizard(props);
    spySetState(instance);
    instance.mounted = true;
    await instance.componentDidMount();
    instance.setState({
      step: 2,
      alias: 'a',
      multiIssue: {
        checks: baseChecks({ hostKey: checkState('fail'), wpCli: checkState('warn'), installs: checkState('idle') }),
        issues: [],
        wpCliVersion: null,
        installs: null,
      },
    });
    const tree = instance.render();
    const text = textOf(tree);
    expect(text).toContain('connection');
    expect(text.toLowerCase()).toContain('host key');
    expect(text.toLowerCase()).toContain('wp-cli');
    expect(text.toLowerCase()).toContain('installs');
  });

  it('step 2 renders one resolution card per issue, and never more than one card for the same issue kind', async () => {
    const props = noProps();
    const instance: any = new ExternalHostAddWizard(props);
    spySetState(instance);
    instance.mounted = true;
    await instance.componentDidMount();
    instance.setState({
      step: 2,
      alias: 'a',
      multiIssue: {
        checks: baseChecks({ wpCli: checkState('warn') }),
        issues: [
          { kind: 'wpCliMissing', title: 'WP-CLI not found', detail: 'd1', remedy: 'r1' },
          { kind: 'wpCliMissing', title: 'WP-CLI not found (dup)', detail: 'd2', remedy: 'r2' },
        ],
        wpCliVersion: null,
        installs: null,
      },
    });
    const tree = instance.render();
    expect(textOf(tree)).toContain('r1');
    expect(textOf(tree)).not.toContain('r2');
  });

  it('a remedy string is rendered exactly as received from the backend, never re-templated', async () => {
    const props = noProps();
    const instance: any = new ExternalHostAddWizard(props);
    spySetState(instance);
    instance.mounted = true;
    await instance.componentDidMount();
    const remedy = 'ssh-add /custom/path/to/key-that-is-not-the-default';
    instance.setState({
      step: 2,
      alias: 'a',
      multiIssue: {
        checks: baseChecks({ connection: checkState('fail') }),
        issues: [{ kind: 'authKeyNotLoaded', title: "Your SSH key isn't loaded", detail: 'd', remedy }],
        wpCliVersion: null,
        installs: null,
      },
    });
    const tree = instance.render();
    expect(textOf(tree)).toContain(remedy);
  });

  it("an unknownHostKey card's Approve button calls TRUST_EXTERNAL_HOST_KEY with the alias and captured fingerprint, then re-probes on success", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(gqlResponse({ checks: baseChecks(), issues: [], wpCliVersion: '2.9', installs: [] }));
    const electron = mockElectron({
      [IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY]: { success: true, error: null },
    });
    const props = { electron, onClose: jest.fn(), onCompleted: jest.fn(), onProbeClean: jest.fn() };
    const instance: any = new ExternalHostAddWizard(props);
    spySetState(instance);
    instance.mounted = true;
    await instance.componentDidMount();
    instance.setState({
      step: 2,
      alias: 'newbox',
      multiIssue: {
        checks: baseChecks({ hostKey: checkState('fail') }),
        issues: [{ kind: 'unknownHostKey', title: 't', detail: 'd', remedy: 'r', fingerprint: 'SHA256:abc', keyType: 'ED25519' }],
        wpCliVersion: null,
        installs: null,
      },
    });
    await instance.approveHostKey({ kind: 'unknownHostKey', fingerprint: 'SHA256:abc' });
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, 'newbox', 'SHA256:abc');
    expect((global as any).fetch).toHaveBeenCalled();
  });

  it('a changedHostKey card has no approve action, only Close', async () => {
    const props = noProps();
    const instance: any = new ExternalHostAddWizard(props);
    spySetState(instance);
    instance.mounted = true;
    await instance.componentDidMount();
    instance.setState({
      step: 2,
      alias: 'newbox',
      multiIssue: {
        checks: baseChecks({ hostKey: checkState('fail') }),
        issues: [{ kind: 'changedHostKey', title: 't', detail: 'd', remedy: 'contact your admin' }],
        wpCliVersion: null,
        installs: null,
      },
    });
    const tree = instance.render();
    expect(textOf(tree)).toContain('contact your admin');
    expect(findAll(tree, (n) => n.type === 'button' && /approve/i.test(textOf(n)))).toHaveLength(0);
    const closeButtons = findAll(tree, (n) => n.type === 'button' && /close/i.test(textOf(n)));
    expect(closeButtons.length).toBeGreaterThan(0);
    closeButtons[0].props.onClick();
    expect(props.onClose).toHaveBeenCalled();
  });

  it('wpCliMissing renders with warn styling, not the failure styling used for connection issues', async () => {
    const props = noProps();
    const instance: any = new ExternalHostAddWizard(props);
    spySetState(instance);
    instance.mounted = true;
    await instance.componentDidMount();

    const wpCliMissingProps = { electron: mockElectron(), onClose: jest.fn(), onCompleted: jest.fn(), onProbeClean: jest.fn() };
    const wpCliInstance: any = new ExternalHostAddWizard(wpCliMissingProps);
    spySetState(wpCliInstance);
    wpCliInstance.mounted = true;
    await wpCliInstance.componentDidMount();
    wpCliInstance.setState({
      step: 2, alias: 'a',
      multiIssue: { checks: baseChecks({ wpCli: checkState('warn') }), issues: [{ kind: 'wpCliMissing', title: 't', detail: 'd', remedy: 'r-warn' }], wpCliVersion: null, installs: null },
    });
    const warnTree = wpCliInstance.render();
    const warnCard = findAll(warnTree, (n) => textOf(n).includes('r-warn') && n.props?.style?.borderColor)[0];

    const connProps = { electron: mockElectron(), onClose: jest.fn(), onCompleted: jest.fn(), onProbeClean: jest.fn() };
    const connInstance: any = new ExternalHostAddWizard(connProps);
    spySetState(connInstance);
    connInstance.mounted = true;
    await connInstance.componentDidMount();
    connInstance.setState({
      step: 2, alias: 'a',
      multiIssue: { checks: baseChecks({ connection: checkState('fail') }), issues: [{ kind: 'connRefused', title: 't', detail: 'd', remedy: 'r-fail' }], wpCliVersion: null, installs: null },
    });
    const failTree = connInstance.render();
    const failCard = findAll(failTree, (n) => textOf(n).includes('r-fail') && n.props?.style?.borderColor)[0];

    expect(warnCard).toBeDefined();
    expect(failCard).toBeDefined();
    expect(warnCard.props.style.borderColor).not.toBe(failCard.props.style.borderColor);
  });

  it("the rootUser card's \"Pass --allow-root\" option calls SET_EXTERNAL_HOST_ROOT_MODE and removes the card without a re-probe", async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.SET_EXTERNAL_HOST_ROOT_MODE]: { success: true, error: null },
    });
    (global as any).fetch = jest.fn();
    const props = { electron, onClose: jest.fn(), onCompleted: jest.fn(), onProbeClean: jest.fn() };
    const instance: any = new ExternalHostAddWizard(props);
    spySetState(instance);
    instance.mounted = true;
    await instance.componentDidMount();
    instance.setState({
      step: 2,
      alias: 'rootbox',
      multiIssue: {
        checks: baseChecks(),
        issues: [{ kind: 'rootUser', title: 't', detail: 'd', remedy: 'r' }],
        wpCliVersion: null,
        installs: null,
      },
    });
    await instance.applyRootMode(true);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.SET_EXTERNAL_HOST_ROOT_MODE, 'rootbox', true);
    expect((global as any).fetch).not.toHaveBeenCalled();
    expect(instance.state.multiIssue.issues.find((i: any) => i.kind === 'rootUser')).toBeUndefined();
  });

  it("the rootUser card's \"use a different alias\" option routes back to step 1 pick mode without calling SET_EXTERNAL_HOST_ROOT_MODE", async () => {
    const electron = mockElectron();
    const props = { electron, onClose: jest.fn(), onCompleted: jest.fn(), onProbeClean: jest.fn() };
    const instance: any = new ExternalHostAddWizard(props);
    spySetState(instance);
    instance.mounted = true;
    await instance.componentDidMount();
    instance.setState({
      step: 2,
      alias: 'rootbox',
      multiIssue: {
        checks: baseChecks(),
        issues: [{ kind: 'rootUser', title: 't', detail: 'd', remedy: 'r' }],
        wpCliVersion: null,
        installs: null,
      },
    });
    instance.useDifferentAlias();
    expect(electron.ipcRenderer.invoke).not.toHaveBeenCalledWith(IPC_CHANNELS.SET_EXTERNAL_HOST_ROOT_MODE, expect.anything(), expect.anything());
    expect(instance.state.step).toBe(1);
    expect(instance.state.step1Mode).toBe('pick');
  });

  it('Re-probe everything re-calls nexusHostProbe for the current alias', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(gqlResponse({ checks: baseChecks(), issues: [], wpCliVersion: '2.9', installs: [] }));
    const props = noProps();
    const instance: any = new ExternalHostAddWizard(props);
    spySetState(instance);
    instance.mounted = true;
    await instance.componentDidMount();
    instance.setState({
      step: 2,
      alias: 'a',
      multiIssue: { checks: baseChecks({ connection: checkState('fail') }), issues: [{ kind: 'connRefused', title: 't', detail: 'd', remedy: 'r' }], wpCliVersion: null, installs: null },
    });
    await instance.reProbe();
    expect((global as any).fetch).toHaveBeenCalled();
    const body = JSON.parse(((global as any).fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.variables.alias).toBe('a');
  });

  it('the zero-issue state renders a Continue action calling onProbeClean(alias)', async () => {
    const onProbeClean = jest.fn();
    const props = { electron: mockElectron(), onClose: jest.fn(), onCompleted: jest.fn(), onProbeClean };
    const instance: any = new ExternalHostAddWizard(props);
    spySetState(instance);
    instance.mounted = true;
    await instance.componentDidMount();
    instance.setState({
      step: 2,
      alias: 'cleanbox',
      multiIssue: { checks: baseChecks(), issues: [], wpCliVersion: '2.9', installs: ['/var/www/html'] },
    });
    const tree = instance.render();
    const continueBtn = findAll(tree, (n) => n.type === 'button' && /continue/i.test(textOf(n)))[0];
    expect(continueBtn).toBeDefined();
    continueBtn.props.onClick();
    expect(onProbeClean).toHaveBeenCalledWith('cleanbox');
  });
});
