import { Ga4PropertyModal } from '../../../src/renderer/components/agents/Ga4PropertyModal';
import { IPC_CHANNELS } from '../../../src/common/constants';

jest.mock('../../../src/renderer/components/agents/openNexusPreferences', () => ({
  // Only the two that leave the app are stubbed. parseDisabledGoogleApi is pure and its real
  // behaviour is what these tests are checking, so it stays genuine — mocking it would have the
  // suite assert against a fixture instead of the parser that runs in production.
  ...jest.requireActual('../../../src/renderer/components/agents/openNexusPreferences'),
  openExternalUrl: jest.fn(() => true),
}));

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, ...args: unknown[]) {
    const [updater, cb] = args as [any, (() => void) | undefined];
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
    cb?.();
  });
}

const PROPS = [
  { property: 'properties/508833219', displayName: 'My Loop', account: 'WPE' },
  { property: 'properties/199204773', displayName: 'My Loop (old, pre-2024)', account: 'WPE' },
  { property: 'properties/288401992', displayName: 'WPE Marketing', account: 'WPE' },
];

const toolResult = (payload: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] });

function makeModal(over: Partial<any> = {}) {
  const onClose = jest.fn();
  const onBound = jest.fn();
  const invoke = jest.fn(async (_ch: string, req: any) => {
    if (req.toolName === 'list_properties') {
      return over.listResult ?? toolResult({ ok: true, properties: over.properties ?? PROPS });
    }
    return over.mapResult ?? toolResult({ ok: true, siteId: req.args.siteId, binding: null });
  });
  // Present unless a case withholds it explicitly — `hasOwnProperty`, so `undefined` is a choice.
  const onOpenConnectedAccounts = Object.prototype.hasOwnProperty.call(over, 'onOpenConnectedAccounts')
    ? over.onOpenConnectedAccounts
    : jest.fn();
  const instance: any = new Ga4PropertyModal({
    electron: { ipcRenderer: { invoke } },
    siteName: over.siteName ?? 'myloop',
    current: over.current,
    onClose,
    onBound,
    onOpenConnectedAccounts,
  });
  spySetState(instance);
  return { instance, onClose, onBound, invoke, onOpenConnectedAccounts };
}

/** Walk the rendered tree for a button whose visible text is exactly `label`. */
function findButton(node: any, label: string): any {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) { const hit = findButton(child, label); if (hit) return hit; }
    return null;
  }
  if (node.type === 'button' && textOf(node.props?.children).trim() === label) return node;
  return findButton(node.props?.children, label);
}

function textOf(node: any): string {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (node.props) return textOf(node.props.children);
  return '';
}

describe('loading properties', () => {
  it('asks the agent for the structured payload', async () => {
    const { instance, invoke } = makeModal();
    await instance['load']();
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.AGENT_TOOL_INVOKE, {
      agentId: 'web-analytics', toolName: 'list_properties', args: { format: 'json' },
    });
    expect(instance.state.properties).toHaveLength(3);
  });

  it('orders by how strongly the name matches the site', async () => {
    const { instance } = makeModal();
    await instance['load']();
    expect(instance['ranked']().map((x: any) => x.p.displayName)).toEqual([
      'My Loop', 'My Loop (old, pre-2024)', 'WPE Marketing',
    ]);
  });

  it('pre-selects the clear leader so the common case is one click', async () => {
    const { instance } = makeModal();
    await instance['load']();
    expect(instance.state.selected).toBe('properties/508833219');
  });

  it('pre-selects nothing when two properties match equally well', async () => {
    // A tie means the evidence is ambiguous. Offering a pre-picked answer would present a coin
    // toss as a recommendation, and a wrong binding puts one client's traffic in another's report.
    const { instance } = makeModal({
      properties: [
        { property: 'properties/1', displayName: 'My Loop', account: 'A' },
        { property: 'properties/2', displayName: 'My Loop', account: 'B' },
      ],
    });
    await instance['load']();
    expect(instance.state.selected).toBeNull();
  });

  it('pre-selects nothing when no name resembles the site', async () => {
    const { instance } = makeModal({
      properties: [{ property: 'properties/9', displayName: 'Totally Unrelated', account: 'A' }],
    });
    await instance['load']();
    expect(instance.state.selected).toBeNull();
  });

  it('keeps the existing binding selected when re-binding', async () => {
    const { instance } = makeModal({ current: { property: 'properties/288401992' } });
    await instance['load']();
    expect(instance.state.selected).toBe('properties/288401992');
  });

  it('says so plainly when no account has properties', async () => {
    const { instance } = makeModal({ properties: [] });
    await instance['load']();
    expect(textOf(instance.render())).toContain('No GA4 properties on any connected Google account');
  });
});

describe('failures', () => {
  it('branches on the structured code rather than the message text', async () => {
    const { instance } = makeModal({
      listResult: toolResult({ ok: false, errorCode: 'Revoked', message: 'Google access was revoked.' }),
    });
    await instance['load']();
    const text = textOf(instance.render());
    expect(text).toContain('Google access was revoked');
    expect(text).toContain('Nothing has been changed.');
    // A credential problem makes the credential the primary action, not a dead Bind button.
    expect(text).toContain('Open Connected accounts');
  });

  it('the credential button dismisses the modal and asks the caller to show the card', async () => {
    // The half that used to be missing. The button existed and read the same either way, but for
    // `NotConnected` it only closed, and for the rest it fired `goToRoute('/main/nexus')` from
    // inside `/main/nexus` — a no-op. Both are one arrival now, and the modal gets out of the way
    // first, because the card is behind this overlay rather than inside it.
    const { instance, onClose, onOpenConnectedAccounts } = makeModal({
      listResult: toolResult({ ok: false, errorCode: 'Revoked', message: 'Google access was revoked.' }),
    });
    await instance['load']();
    findButton(instance.render(), 'Open Connected accounts').props.onClick();
    expect(onClose).toHaveBeenCalled();
    expect(onOpenConnectedAccounts).toHaveBeenCalled();
  });

  it('offers no credential button when nothing can show the card', async () => {
    // Cancel to its left still dismisses, so the modal is never a trap — but a button promising a
    // destination it cannot reach is not offered at all.
    const { instance } = makeModal({
      onOpenConnectedAccounts: undefined,
      listResult: toolResult({ ok: false, errorCode: 'NotConnected', message: 'No Google account is connected.' }),
    });
    await instance['load']();
    const rendered = instance.render();
    expect(findButton(rendered, 'Open Connected accounts')).toBeNull();
    expect(findButton(rendered, 'Cancel') ?? findButton(rendered, 'Close')).not.toBeNull();
  });

  it('does not offer Preferences for a non-credential failure', async () => {
    const { instance } = makeModal({
      listResult: toolResult({ ok: false, errorCode: 'ListFailed', message: 'GA4 API error: quota' }),
    });
    await instance['load']();
    const text = textOf(instance.render());
    expect(text).toContain('Google would not return your properties');
    expect(text).toContain('GA4 API error: quota');
    expect(text).not.toContain('Open Connected accounts');
  });

  it('keeps the modal open and reports a failed bind', async () => {
    const { instance, onBound, onClose } = makeModal({
      mapResult: toolResult({ ok: false, errorCode: 'NotFound', message: 'Property no longer on this account.' }),
    });
    await instance['load']();
    await instance['commit']();
    expect(instance.state.phase).toBe('choose');
    expect(textOf(instance.render())).toContain('That property is no longer on this account');
    expect(onBound).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('binding', () => {
  it('sends the selected property and closes on success', async () => {
    const { instance, invoke, onBound, onClose } = makeModal();
    await instance['load']();
    await instance['commit']();
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.AGENT_TOOL_INVOKE, {
      agentId: 'web-analytics',
      toolName: 'map_property',
      args: { siteId: 'myloop', propertyId: 'properties/508833219', format: 'json' },
    });
    expect(onBound).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('unbinds without naming a property', async () => {
    const { instance, invoke, onBound } = makeModal({ current: { property: 'properties/1' } });
    await instance['load']();
    await instance['commit'](true);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.AGENT_TOOL_INVOKE, {
      agentId: 'web-analytics',
      toolName: 'map_property',
      args: { siteId: 'myloop', unbind: true, format: 'json' },
    });
    expect(onBound).toHaveBeenCalled();
  });

  it('offers Unbind only for an already-bound site', async () => {
    const bound = makeModal({ current: { property: 'properties/1' } }).instance;
    await bound['load']();
    expect(textOf(bound.render())).toContain('Unbind');

    const fresh = makeModal().instance;
    await fresh['load']();
    expect(textOf(fresh.render())).not.toContain('Unbind');
  });
});

describe('the shortlist', () => {
  const many = Array.from({ length: 14 }, (_, i) => ({
    property: `properties/${i}`, displayName: `Property ${i}`, account: 'WPE',
  }));

  it('shows five and names the rest', async () => {
    const { instance } = makeModal({ properties: many });
    await instance['load']();
    expect(textOf(instance.render())).toContain('Showing 5 of 14 · show the rest');
  });

  it('expands on request', async () => {
    const { instance } = makeModal({ properties: many });
    await instance['load']();
    instance.setState({ showAll: true });
    expect(textOf(instance.render())).not.toContain('show the rest');
  });
});

describe('a Google API that is switched off', () => {
  const REAL = 'Could not list GA4 properties: GA4 API error: Google Analytics Admin API has not been '
    + 'used in project 212814026888 before or it is disabled. Enable it by visiting '
    + 'https://console.developers.google.com/apis/api/analyticsadmin.googleapis.com/overview?project=212814026888 '
    + 'then retry. If you enabled this API recently, wait a few minutes for the action to propagate to our '
    + 'systems and retry.';

  it('names the API and the fix instead of restating "would not return your properties"', async () => {
    const { instance } = makeModal({ listResult: toolResult({ ok: false, errorCode: 'ListFailed', message: REAL }) });
    await instance['load']();
    const text = textOf(instance.render());
    expect(text).toContain('Enable the Google Analytics Admin API on this Google Cloud project');
    expect(text).toContain('one-time setting on the project');
    // A retry is useless for a few minutes, and saying so prevents a pointless loop.
    expect(text).toContain('take a few minutes');
  });

  it('warns about the second API Google has not mentioned yet', async () => {
    // Enabling only Admin gets past the picker, then every report fails identically. Naming both
    // now saves a second round trip to the console.
    const { instance } = makeModal({ listResult: toolResult({ ok: false, errorCode: 'ListFailed', message: REAL }) });
    await instance['load']();
    const text = textOf(instance.render());
    expect(text).toContain('Admin API to list properties');
    expect(text).toContain('Data API for every report');
  });

  it('offers the console URL as an action rather than text to transcribe', async () => {
    const { instance } = makeModal({ listResult: toolResult({ ok: false, errorCode: 'ListFailed', message: REAL }) });
    await instance['load']();
    const text = textOf(instance.render());
    expect(text).toContain('Open Google Cloud Console');
    expect(text).toContain('Try again');
    expect(text).toContain('analyticsadmin.googleapis.com/overview?project=212814026888');
    // Not a credential problem, so it must not send the user to Connected accounts.
    expect(text).not.toContain('Open Connected accounts');
  });

  it('leaves an ordinary list failure on the generic path', async () => {
    const { instance } = makeModal({
      listResult: toolResult({ ok: false, errorCode: 'ListFailed', message: 'GA4 API error: quota exceeded' }),
    });
    await instance['load']();
    const text = textOf(instance.render());
    expect(text).toContain('Google would not return your properties');
    expect(text).not.toContain('Google Cloud project');
  });
});

describe('multiple connected accounts', () => {
  const TWO_ACCOUNT_PROPS = [
    { property: 'properties/1', displayName: 'My Loop', account: 'WPE', accountLabel: 'jeremy@wpengine.com', connectionId: 'c1' },
    { property: 'properties/2', displayName: 'Client Store', account: 'Client', accountLabel: 'client@gmail.com', connectionId: 'c2' },
  ];

  it('labels each option with the Google account it came from when more than one is connected', async () => {
    const { instance } = makeModal({ properties: TWO_ACCOUNT_PROPS });
    await instance['load']();
    const text = textOf(instance.render());
    expect(text).toContain('jeremy@wpengine.com');
    expect(text).toContain('client@gmail.com');
  });

  it('adds no account label noise when every property is from the same account', async () => {
    const { instance } = makeModal({
      properties: [
        { property: 'properties/1', displayName: 'My Loop', account: 'WPE', accountLabel: 'jeremy@wpengine.com', connectionId: 'c1' },
        { property: 'properties/2', displayName: 'WPE Marketing', account: 'WPE', accountLabel: 'jeremy@wpengine.com', connectionId: 'c1' },
      ],
    });
    await instance['load']();
    expect(textOf(instance.render())).not.toContain('jeremy@wpengine.com');
  });

  it('a failed account is a named warning, not a hidden hole — the healthy account\'s properties still render', async () => {
    const { instance } = makeModal({
      listResult: toolResult({
        ok: true,
        properties: [TWO_ACCOUNT_PROPS[1]],
        accountErrors: [{ accountLabel: 'jeremy@wpengine.com', message: 'invalid_grant' }],
      }),
    });
    await instance['load']();
    const text = textOf(instance.render());
    expect(text).toContain('jeremy@wpengine.com');
    expect(text).toContain('Client Store');
    // The remedy, not just the fault.
    expect(text.toLowerCase()).toContain('reconnect');
  });

  it('an empty list with a failed account must not claim there are no properties', async () => {
    const { instance } = makeModal({
      listResult: toolResult({
        ok: true,
        properties: [],
        accountErrors: [{ accountLabel: 'jeremy@wpengine.com', message: 'invalid_grant' }],
      }),
    });
    await instance['load']();
    const text = textOf(instance.render());
    expect(text).not.toContain('No GA4 properties');
    expect(text).toContain('jeremy@wpengine.com');
  });

  it('the truly-empty state speaks of accounts, plural — one connection is no longer an assumption', async () => {
    const { instance } = makeModal({ properties: [] });
    await instance['load']();
    expect(textOf(instance.render())).toContain('any connected Google account');
  });
});
