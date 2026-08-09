import { AnalyticsSitesTab } from '../../../src/renderer/components/agents/AnalyticsSitesTab';
import { Ga4PropertyModal } from '../../../src/renderer/components/agents/Ga4PropertyModal';
import { AnalyticsState } from '../../../src/renderer/components/agents/analyticsSitesModel';

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, ...args: unknown[]) {
    const [updater, cb] = args as [any, (() => void) | undefined];
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
    cb?.();
  });
}

const site = (name: string, environment: any = 'local', platform: any = 'Local') => ({
  id: name, name, environment, platform,
});

const CONNECTED: AnalyticsState = {
  google: { connected: true, accountExists: true, label: 'jeremy@wpengine.com' },
  fleet: [site('alpineoutfitters'), site('jeremypollock2', 'production', 'WP Engine'), site('myloop')],
  bindings: {
    alpineoutfitters: { property: 'properties/447120388', displayName: 'Alpine Outfitters — GA4' },
    jeremypollock2: { property: 'properties/312998104', displayName: 'jeremypollock.com' },
  },
};

function makeTab(over: Partial<any> = {}) {
  const onReload = jest.fn();
  const invoke = jest.fn(async () => ({ content: [{ type: 'text', text: '{"ok":true}' }] }));
  const instance: any = new AnalyticsSitesTab({
    electron: { ipcRenderer: { invoke } },
    state: over.state ?? CONNECTED,
    loading: over.loading ?? false,
    cadenceLabel: over.cadenceLabel ?? 'every Monday',
    onReload,
  });
  spySetState(instance);
  return { instance, onReload, invoke };
}

function textOf(node: any): string {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (node.props) return textOf(node.props.children);
  return '';
}

function findAll(node: any, type: any, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach(n => findAll(n, type, out)); return out; }
  if (node.type === type) out.push(node);
  if (node.props?.children) findAll(node.props.children, type, out);
  return out;
}

describe('account card', () => {
  it('shows the account, coverage and how many distinct properties are in use', () => {
    const text = textOf(makeTab().instance.render());
    expect(text).toContain('jeremy@wpengine.com');
    expect(text).toContain('Analytics read-only');
    expect(text).toContain('2 of 3 sites bound');
    expect(text).toContain('2 properties in use');
  });

  it('counts a property shared by two sites once', () => {
    // Two sites legitimately reporting from one property is not two properties.
    const shared: AnalyticsState = {
      ...CONNECTED,
      bindings: {
        alpineoutfitters: { property: 'properties/1' },
        jeremypollock2: { property: 'properties/1' },
      },
    };
    expect(textOf(makeTab({ state: shared }).instance.render())).toContain('1 property in use');
  });
});

describe('default view', () => {
  it('lists bound sites and hides the rest until asked', () => {
    const { instance } = makeTab();
    const byDefault = textOf(instance.render());
    expect(byDefault).toContain('alpineoutfitters');
    expect(byDefault).toContain('Alpine Outfitters — GA4');
    expect(byDefault).not.toContain('myloop');

    instance.setState({ filter: 'all' });
    const all = textOf(instance.render());
    expect(all).toContain('myloop');
    expect(all).toContain('None bound');
  });

  it('carries the three live counts', () => {
    const text = textOf(makeTab().instance.render());
    expect(text).toContain('With a property 2');
    expect(text).toContain('Unbound 1');
    expect(text).toContain('All sites 3');
  });

  it('states the ratio and that binding changes nothing in Google', () => {
    const text = textOf(makeTab().instance.render());
    expect(text).toContain('2 of 3 sites on this account have a GA4 property bound');
    expect(text).toContain('2 run every Monday');
    expect(text).toContain('changes nothing in Google Analytics');
  });

  it('shows a bound row as running and an unbound row as skipped', () => {
    const { instance } = makeTab();
    instance.setState({ filter: 'all' });
    const text = textOf(instance.render());
    expect(text).toContain('runs every Monday');
    expect(text).toContain('no property bound');
  });

  it('falls back to the property id when an old binding has no stored name', () => {
    // Bindings written before the agent stored displayName have only the id. Showing the id is
    // honest; inventing a name would not be.
    const legacy: AnalyticsState = { ...CONNECTED, bindings: { myloop: { property: 'properties/508833219' } } };
    const text = textOf(makeTab({ state: legacy }).instance.render());
    expect(text).toContain('properties/508833219');
    expect(text).toContain('Bound property');
  });
});

describe('search', () => {
  it('covers every site regardless of the active filter, and says so', () => {
    const { instance } = makeTab();
    expect(instance.state.filter).toBe('bound');
    instance.setState({ query: 'myloop' });
    const text = textOf(instance.render());
    expect(text).toContain('myloop');
    expect(text).toContain('Search covers all 3 sites on this account, not just this filter.');
  });

  it('names the set it searched when nothing matches', () => {
    const { instance } = makeTab();
    instance.setState({ query: 'nope' });
    const text = textOf(instance.render());
    expect(text).toContain('No site matches “nope”');
    expect(text).toContain('Searching all 3 sites on this account.');
  });
});

describe('empty states', () => {
  it('offers exactly one action when Google is not connected', () => {
    const { instance } = makeTab({
      state: { google: { connected: false, accountExists: false }, fleet: [site('a')], bindings: {} },
    });
    const text = textOf(instance.render());
    expect(text).toContain('No Google account connected');
    expect(text).toContain('Connect Google account');
    // The bind flow is absent rather than disabled — it cannot work without an account.
    expect(text).not.toContain('Choose a property');
  });

  it('distinguishes a revoked account and promises the bindings are kept', () => {
    const { instance } = makeTab({
      state: { google: { connected: false, accountExists: false, status: 'revoked' }, fleet: [site('a')], bindings: {} },
    });
    const text = textOf(instance.render());
    expect(text).toContain('Google access was revoked');
    expect(text).toContain('Reconnect Google account');
    expect(text).toContain('Your bindings are kept');
  });

  it('explains an empty bound view instead of showing a bare table', () => {
    const { instance } = makeTab({
      state: { ...CONNECTED, bindings: {} },
    });
    expect(textOf(instance.render())).toContain('No sites have a property bound yet');
  });
});

describe('the picker', () => {
  it('opens for the row that asked, carrying its existing binding', () => {
    const { instance } = makeTab();
    instance.setState({ picking: 'alpineoutfitters' });
    const modal = findAll(instance.render(), Ga4PropertyModal)[0];
    expect(modal.props.siteName).toBe('alpineoutfitters');
    expect(modal.props.current.property).toBe('properties/447120388');
  });

  it('opens with no current binding for an unbound site', () => {
    const { instance } = makeTab();
    instance.setState({ picking: 'myloop' });
    expect(findAll(instance.render(), Ga4PropertyModal)[0].props.current).toBeUndefined();
  });

  it('is not rendered until a row asks for it', () => {
    expect(findAll(makeTab().instance.render(), Ga4PropertyModal)).toHaveLength(0);
  });
});

describe('the account exists but this agent has no grant', () => {
  const NO_GRANT: AnalyticsState = {
    google: { connected: false, accountExists: true, label: 'jeremy.pollock@wpengine.com' },
    fleet: [site('nitropack-production')],
    bindings: {},
  };

  it('never claims the account is disconnected when the user can see it connected', () => {
    // The reported bug: "Google is not connected" over a visibly connected account. Access is
    // granted per agent, so the honest sentence names the agent, not the account.
    const text = textOf(makeTab({ state: NO_GRANT }).instance.render());
    expect(text).not.toContain('No Google account connected');
    expect(text).toContain('This agent can’t use your Google account yet'.replace('’', "'"));
    expect(text).toContain('jeremy.pollock@wpengine.com');
    expect(text).toContain('each agent is granted access separately');
  });

  it('offers granting rather than connecting', () => {
    const text = textOf(makeTab({ state: NO_GRANT }).instance.render());
    expect(text).toContain('Grant access to web-analytics');
    expect(text).not.toContain('Connect Google account');
  });

  it('requests exactly the scopes the agent declared', () => {
    const { instance } = makeTab({ state: NO_GRANT });
    instance.props.googleScopes = ['https://www.googleapis.com/auth/analytics.readonly'];
    instance['requestAccess']();
    expect(instance.props.electron.ipcRenderer.invoke).toHaveBeenCalledWith('nexus-ai:credential:connect', {
      provider: 'google',
      agentId: 'web-analytics',
      siteId: '',
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    });
  });

  it('does not show the bind table, which could not work yet', () => {
    expect(textOf(makeTab({ state: NO_GRANT }).instance.render())).not.toContain('GA4 property');
  });
});

describe('a sign-in that does not complete', () => {
  const NO_GRANT: AnalyticsState = {
    google: { connected: false, accountExists: true, label: 'jeremy.pollock@wpengine.com' },
    fleet: [site('a')],
    bindings: {},
  };

  const makeGranting = (result: any) => {
    const { instance, onReload } = makeTab({ state: NO_GRANT });
    instance.props.electron.ipcRenderer.invoke = jest.fn(async () => result);
    return { instance, onReload };
  };

  it('reports a failed token exchange instead of showing nothing', async () => {
    // The reported symptom: consent granted in the browser, then no change on screen at all.
    // connect() returned void on failure and the IPC answered {ok:true}, so nothing could tell.
    const { instance } = makeGranting({ ok: false, reason: 'error', message: 'Token exchange failed: 400' });
    await instance['requestAccess']();
    const text = textOf(instance.render());
    expect(text).toContain('Sign-in did not complete');
    expect(text).toContain('Token exchange failed: 400');
    expect(text).toContain('Nothing has been changed.');
  });

  it('stays quiet when the user simply closed the browser', async () => {
    // Backing out is a choice, not a fault — an error box would be scolding.
    const { instance } = makeGranting({ ok: false, reason: 'cancelled' });
    await instance['requestAccess']();
    expect(instance.state.grantError).toBeNull();
    expect(textOf(instance.render())).not.toContain('Sign-in did not complete');
  });

  it('explains a state mismatch in terms the user can act on', async () => {
    const { instance } = makeGranting({ ok: false, reason: 'state_mismatch' });
    await instance['requestAccess']();
    expect(instance.state.grantError).toContain('Close any other Local windows');
  });

  it('reloads on success and reports nothing', async () => {
    const { instance, onReload } = makeGranting({ ok: true });
    await instance['requestAccess']();
    expect(instance.state.grantError).toBeNull();
    expect(onReload).toHaveBeenCalled();
  });

  it('reloads even after a failure, so a partially-completed flow still shows', async () => {
    const { instance, onReload } = makeGranting({ ok: false, reason: 'error', message: 'boom' });
    await instance['requestAccess']();
    expect(onReload).toHaveBeenCalled();
  });
});

describe('a build that cannot sign in at all', () => {
  it('says so instead of telling the user to retry', async () => {
    // Refused before the browser opened, so nothing was spent and "try again" would be false.
    const { instance } = makeTab({
      state: { google: { connected: false, accountExists: true }, fleet: [site('a')], bindings: {} },
    });
    instance.props.electron.ipcRenderer.invoke = jest.fn(async () => ({
      ok: false, reason: 'error',
      message: 'No OAuth client secret — set NEXUS_GOOGLE_CLIENT_SECRET. Google rejects the token exchange without it, even with PKCE.',
    }));
    await instance['requestAccess']();
    const text = textOf(instance.render());
    expect(text).toContain('Google sign-in isn’t configured in this build'.replace('’', "'"));
    expect(text).toContain('Nothing was sent to Google');
    expect(text).toContain('NEXUS_GOOGLE_CLIENT_SECRET');
    expect(text).not.toContain('You can try again');
  });
});
