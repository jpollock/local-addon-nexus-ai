import * as React from 'react';
import { NexusPreferences } from '../../../src/renderer/components/NexusPreferences';
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
    [IPC_CHANNELS.UPDATE_SETTINGS]: { success: true },
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

async function renderPrefs(): Promise<string> {
  const electron = mockElectron();
  const instance: any = new NexusPreferences({ electron });
  (instance as any).mounted = true;
  spySetState(instance);
  await loadAndExpand(instance);
  const tree = instance.render();
  return textOf(tree);
}

describe('NexusPreferences — external hosts (reduced surface, post-migration)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('still offers first-time host-key approval — the one thing that stays in Preferences', async () => {
    const t = await renderPrefs();
    expect(t).toContain('Check');
  });

  it('no longer lists hosts or offers to add one — those moved to Settings', async () => {
    const t = await renderPrefs();
    expect(t).not.toContain('Add a host');
    expect(t).not.toContain('Manage');
  });

  it('approving a key still goes over IPC, never GraphQL', () => {
    const { execSync } = require('child_process');
    const hits = execSync(
      'grep -rl "TRUST_EXTERNAL_HOST_KEY" src/main/graphql src/cli 2>/dev/null || true',
      { cwd: require('path').resolve(__dirname, '../../..') },
    ).toString().trim();
    expect(hits).toBe('');
  });
});
