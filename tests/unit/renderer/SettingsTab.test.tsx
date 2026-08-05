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

  it('renders a chip for each registered external host', async () => {
    const electron = mockElectron({
      [IPC_CHANNELS.GET_EXTERNAL_HOSTS]: [{ alias: 'hostinger-test', environment: 'production', domain: 'example.com' }],
    });
    const instance: any = new SettingsTab({ electron });
    (instance as any).mounted = true;
    spySetState(instance);
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
    spySetState(instance);
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
