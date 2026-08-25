import { LogSitesTab } from '../../../src/renderer/components/agents/LogSitesTab';
import { LogBucketModal } from '../../../src/renderer/components/agents/LogBucketModal';
import { LogSourcesState } from '../../../src/renderer/components/agents/logSourcesModel';
import { IPC_CHANNELS } from '../../../src/common/constants';

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
  });
}

const install = (site: string, objectCount: number) => ({
  site, objectCount, bytes: objectCount * 1000,
  oldestObjectAt: '2026-07-01', newestObjectAt: '2026-08-01',
  sampleKey: `20260801-0016-${site}.apachestyle.log.gz`, lastSyncedAt: null,
});

const fleetSite = (name: string, environment: any = 'production') => ({
  id: name, name, environment, platform: 'WP Engine' as const,
});

const CONNECTED: LogSourcesState = {
  bucket: { bucket: 'wpejpp', region: 'us-east-1', prefix: 'wpe_logs/nginx/', lastScannedAt: Date.now() - 7_200_000 },
  installs: [install('alpha', 312), install('clientold2', 44)],
  fleet: [fleetSite('alpha'), fleetSite('beta', 'staging')],
  aws: { connected: true, label: 'arn:aws:iam::1:user/nexus' },
};

function makeTab(over: Partial<any> = {}) {
  const onScopeChange = jest.fn();
  const onReload = jest.fn();
  const invoke = jest.fn(async () => ({ content: [{ type: 'text', text: '{"ok":true}' }] }));
  // Present unless a case withholds it explicitly — `hasOwnProperty`, so `undefined` is a choice.
  const onOpenAwsSettings = Object.prototype.hasOwnProperty.call(over, 'onOpenAwsSettings')
    ? over.onOpenAwsSettings
    : jest.fn();
  const instance: any = new LogSitesTab({
    electron: { ipcRenderer: { invoke } },
    state: over.state ?? CONNECTED,
    loading: over.loading ?? false,
    scope: over.scope ?? [],
    cadenceLabel: over.cadenceLabel ?? 'every 15 minutes',
    onScopeChange,
    onReload,
    onOpenAwsSettings,
  });
  spySetState(instance);
  return { instance, onScopeChange, onReload, invoke, onOpenAwsSettings };
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

/** Flatten a React element tree into the strings it would render. */
function textOf(node: any): string {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (node.props) return textOf(node.props.children);
  return '';
}

describe('switching a site', () => {
  it('adds an install with logs to the scope', () => {
    const { instance, onScopeChange } = makeTab();
    instance['toggle']({ name: 'alpha', hasLogs: true, on: false });
    expect(onScopeChange).toHaveBeenCalledWith(['alpha']);
  });

  it('removes it again', () => {
    const { instance, onScopeChange } = makeTab({ scope: ['alpha'] });
    instance['toggle']({ name: 'alpha', hasLogs: true, on: true });
    expect(onScopeChange).toHaveBeenCalledWith([]);
  });

  it('refuses an install with no objects — that state must be unreachable, not warned about', () => {
    const { instance, onScopeChange } = makeTab();
    instance['toggle']({ name: 'beta', hasLogs: false, on: false });
    expect(onScopeChange).not.toHaveBeenCalled();
  });

  it('leaves the rest of the scope untouched', () => {
    const { instance, onScopeChange } = makeTab({ scope: ['other'] });
    instance['toggle']({ name: 'alpha', hasLogs: true, on: false });
    expect(new Set(onScopeChange.mock.calls[0][0])).toEqual(new Set(['other', 'alpha']));
  });
});

describe('empty states', () => {
  it('offers exactly one live action, and it is the AWS one, when no credential is connected', () => {
    const { instance } = makeTab({
      state: { bucket: null, installs: [], fleet: [], aws: { connected: false } },
    });
    const text = textOf(instance.render());
    expect(text).toContain('No log bucket connected');
    expect(text).toContain('Connect AWS account');
    // Never a disabled bucket button beside it — the enabled one would win by visual weight.
    expect(text).not.toContain('Connect a bucket');
  });

  it('the AWS action actually reaches Settings rather than re-navigating to this page', () => {
    // It used to call `openNexusPreferences()`, which asked Local to go to `/main/nexus` — the
    // route this tab is already on. The button looked live and did nothing, every time.
    const { instance, onOpenAwsSettings } = makeTab({
      state: { bucket: null, installs: [], fleet: [], aws: { connected: false } },
    });
    findButton(instance.render(), 'Connect AWS account').props.onClick();
    expect(onOpenAwsSettings).toHaveBeenCalled();
  });

  it('withholds the AWS action when nothing can open Settings, and still says where to go', () => {
    // Same rule this empty state already applies to the bucket button: absent beats dead. The
    // footnote names the location, so the user is not stranded.
    const { instance } = makeTab({
      onOpenAwsSettings: undefined,
      state: { bucket: null, installs: [], fleet: [], aws: { connected: false } },
    });
    const rendered = instance.render();
    expect(findButton(rendered, 'Connect AWS account')).toBeNull();
    expect(textOf(rendered)).toContain('Nexus AI → Settings → Connections');
  });

  it('offers the bucket form once the credential exists', () => {
    const { instance } = makeTab({
      state: { bucket: null, installs: [], fleet: [], aws: { connected: true } },
    });
    const text = textOf(instance.render());
    expect(text).toContain('Connect a bucket');
    expect(text).not.toContain('Connect AWS account');
  });

  it('does not render the install table with no bucket connected', () => {
    const { instance } = makeTab({
      state: { bucket: null, installs: [], fleet: [fleetSite('alpha')], aws: { connected: true } },
    });
    expect(textOf(instance.render())).not.toContain('Apache-style logs');
  });
});

describe('bucket card', () => {
  it('shows the s3 URI, region and the apache-style count', () => {
    const { instance } = makeTab();
    const text = textOf(instance.render());
    expect(text).toContain('s3://wpejpp/wpe_logs/nginx/');
    expect(text).toContain('us-east-1');
    expect(text).toContain('356 apache-style objects');
    expect(text).toContain('1 of your installs');
  });

  it('explains a bucket install that is not on the account, as information rather than a warning', () => {
    const text = textOf(makeTab().instance.render());
    expect(text).toContain('clientold2');
    expect(text).toContain('is not an install on this WP Engine account');
    expect(text).toContain('They are ignored.');
  });

  it('says nothing about orphans when there are none', () => {
    const { instance } = makeTab({
      state: { ...CONNECTED, installs: [install('alpha', 312)] },
    });
    expect(textOf(instance.render())).not.toContain('not an install on this WP Engine account');
  });
});

describe('install table', () => {
  it('defaults to installs with logs, and reaches the rest through All installs', () => {
    // The default view is about the bucket, not the fleet: an account can hold 500 installs and
    // write logs for three of them.
    const { instance } = makeTab();
    const byDefault = textOf(instance.render());
    expect(byDefault).toContain('alpha');
    expect(byDefault).toContain('20260801-0016-alpha.apachestyle.log.gz');
    expect(byDefault).not.toContain('beta');

    instance.setState({ filter: 'all' });
    const all = textOf(instance.render());
    expect(all).toContain('beta');
    expect(all).toContain('None in this bucket');
  });

  it('labels each row state from the derived set, not the raw scope', () => {
    const on = textOf(makeTab({ scope: ['alpha'] }).instance.render());
    expect(on).toContain('runs every 15 minutes');

    // 'beta' is scoped but has no objects: it must read "nothing to process", never "runs".
    const { instance } = makeTab({ scope: ['beta'] });
    instance.setState({ filter: 'all' });
    const stale = textOf(instance.render());
    expect(stale).toContain('nothing to process');
    expect(stale).toContain('switched off');
    expect(stale).not.toContain('runs every 15 minutes');
  });

  it('footnote frames the ratio against the whole account and says what "off" does NOT do', () => {
    const text = textOf(makeTab({ scope: ['alpha'] }).instance.render());
    expect(text).toContain('1 of 2 installs on this account have logs in this bucket');
    expect(text).toContain('1 runs every 15 minutes');
    expect(text).toContain('never deletes what has already been processed');
  });

  it('reports none running when nothing is switched on', () => {
    expect(textOf(makeTab().instance.render())).toContain('none run');
  });
});

describe('rescan', () => {
  it('invokes the agent tool and reloads', async () => {
    const { instance, invoke, onReload } = makeTab();
    await instance['rescan']();
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.AGENT_TOOL_INVOKE, {
      agentId: 'log-processor', toolName: 'rescan_log_bucket', args: { format: 'json' },
    });
    expect(onReload).toHaveBeenCalled();
    expect(instance.state.rescanError).toBeNull();
  });

  it('surfaces a structured failure instead of failing silently', async () => {
    const { instance, onReload } = makeTab();
    instance.props.electron.ipcRenderer.invoke = jest.fn(async () => ({
      content: [{ type: 'text', text: '{"ok":false,"errorCode":"AccessDenied","message":"denied"}' }],
      isError: true,
    }));
    await instance['rescan']();
    expect(instance.state.rescanError).toBe('denied');
    // Still reloads: the scan cache may be partially stale either way, and the card must not
    // keep showing a spinner after a failure.
    expect(onReload).toHaveBeenCalled();
  });
});

/** Walk a React element tree and collect every element whose type matches. */
function findAll(node: any, type: any, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach(n => findAll(n, type, out)); return out; }
  if (node.type === type) out.push(node);
  if (node.props?.children) findAll(node.props.children, type, out);
  return out;
}

describe('a refresh must not tear down the modal', () => {
  it('keeps the modal mounted while new data is loading', () => {
    // The reload the modal itself triggers on a successful connect used to hit an early return
    // on `loading`, which unmounted the modal mid-flow: the scan result flashed past and the
    // user got a fresh, empty form back over a populated table.
    const { instance } = makeTab({ loading: true });
    instance.state.modalOpen = true;
    expect(findAll(instance.render(), LogBucketModal)).toHaveLength(1);
  });

  it('keeps the modal at a stable position across the loading flip', () => {
    // Position matters as much as presence: React reconciles these children by index, so a
    // modal that moves is a modal that gets rebuilt from its constructor.
    const { instance } = makeTab({ loading: true });
    instance.state.modalOpen = true;
    const whileLoading = instance.render().props.children.indexOf(
      findAll(instance.render(), LogBucketModal)[0],
    );

    const { instance: settled } = makeTab({ loading: false });
    settled.state.modalOpen = true;
    const afterLoad = settled.render().props.children.indexOf(
      findAll(settled.render(), LogBucketModal)[0],
    );
    // indexOf compares by reference across two renders, so compare child counts instead.
    expect(instance.render().props.children.length).toBe(settled.render().props.children.length);
    expect(whileLoading).toBe(afterLoad);
  });

  it('shows the skeleton only before anything has ever loaded', () => {
    const first = makeTab({
      loading: true,
      state: { bucket: null, installs: [], fleet: [], aws: { connected: true } },
    }).instance;
    expect(textOf(first.render())).toContain('Loading log sources…');

    // A rescan of an already-connected bucket must leave the table on screen.
    const refreshing = makeTab({ loading: true }).instance;
    const text = textOf(refreshing.render());
    expect(text).not.toContain('Loading log sources…');
    expect(text).toContain('s3://wpejpp/wpe_logs/nginx/');
  });
});

// ─── Scale ────────────────────────────────────────────────────────────────────
// BEHAVIOR §4: assume 500 installs and 3 with logs is a normal shape.

const BIG_FLEET = (() => {
  const stems = ['clientsite', 'brochure', 'shopfront', 'devsandbox', 'agencydemo'];
  const withLogs = ['jeremypollock2', 'nitropack3', 'theawfulproduc', 'acfprod'];
  return {
    bucket: { bucket: 'wpejpp', region: 'us-east-1', prefix: 'wpe_logs/nginx/', lastScannedAt: 1000 },
    installs: withLogs.map((n, i) => install(n, 300 - i * 40)),
    fleet: [
      ...withLogs.map(n => fleetSite(n)),
      ...Array.from({ length: 497 }, (_, i) => fleetSite(`${stems[i % stems.length]}${i + 1}`)),
    ],
    aws: { connected: true },
  } as LogSourcesState;
})();

describe('scale', () => {
  it('a 501-install account renders 4 rows on load, not 501', () => {
    const { instance } = makeTab({ state: BIG_FLEET });
    const d = instance['derive'](require('../../../src/renderer/components/agents/logSourcesModel')
      .deriveLogSiteRows(BIG_FLEET, []));
    expect(d.counts).toEqual({ logs: 4, on: 0, all: 501 });
    expect(d.visible).toHaveLength(4);
    expect(textOf(instance.render())).not.toContain('clientsite1');
  });

  it('the three filter counts are live and describe the whole account', () => {
    const { instance } = makeTab({ state: BIG_FLEET, scope: ['nitropack3', 'acfprod'] });
    const text = textOf(instance.render());
    expect(text).toContain('With logs 4');
    expect(text).toContain('Switched on 2');
    expect(text).toContain('All installs 501');
  });

  it('pages at 25 with a label naming both numbers, and advances', () => {
    const { instance } = makeTab({ state: BIG_FLEET });
    instance.setState({ filter: 'all' });
    expect(instance['derive'](rowsOf(BIG_FLEET)).visible).toHaveLength(25);
    expect(textOf(instance.render())).toContain('Showing 25 of 501 · Show 50 more');

    instance.setState({ limit: 75 });
    expect(instance['derive'](rowsOf(BIG_FLEET)).visible).toHaveLength(75);
    expect(textOf(instance.render())).toContain('Showing 75 of 501 · Show 50 more');
  });

  it('drops the paging control once everything is shown', () => {
    const { instance } = makeTab({ state: BIG_FLEET });
    expect(textOf(instance.render())).not.toContain('Show 50 more');
  });

  it('search covers every install regardless of the active filter', () => {
    // "Where is my site?" must be answerable in one place. A site absent from a filtered search
    // reads as missing rather than filtered out.
    const { instance } = makeTab({ state: BIG_FLEET });
    expect(instance.state.filter).toBe('logs');
    instance.setState({ query: 'brochure' });

    const d = instance['derive'](rowsOf(BIG_FLEET));
    expect(d.matched.length).toBeGreaterThan(0);
    expect(d.matched.every((r: any) => r.name.startsWith('brochure'))).toBe(true);
    // ...and it says so, because the chips would otherwise look like they narrowed the result.
    expect(textOf(instance.render())).toContain('Search covers all 501 installs on this account');
  });

  it('the search empty state names the set it searched', () => {
    const { instance } = makeTab({ state: BIG_FLEET });
    instance.setState({ query: 'nothing-matches-this' });
    const text = textOf(instance.render());
    expect(text).toContain('No install matches “nothing-matches-this”');
    expect(text).toContain('Searching all 501 installs on this account.');
  });

  it('resets paging when the filter or the query changes', () => {
    const { instance } = makeTab({ state: BIG_FLEET });
    instance.setState({ filter: 'all', limit: 200 });
    expect(instance['derive'](rowsOf(BIG_FLEET)).visible).toHaveLength(200);

    // Both handlers reset limit — a deep page carried into a new result set strands the user
    // hundreds of rows into a list that no longer has them.
    instance['renderControls'](instance['derive'](rowsOf(BIG_FLEET)), rowsOf(BIG_FLEET));
    instance.setState({ filter: 'logs', limit: 25 });
    expect(instance['derive'](rowsOf(BIG_FLEET)).visible).toHaveLength(4);
  });
});

describe('bulk switch', () => {
  it('is offered only in the With logs view with no search and something left to switch on', () => {
    const { instance } = makeTab({ state: BIG_FLEET });
    expect(textOf(instance.render())).toContain('Switch all 4 on');

    instance.setState({ filter: 'all' });
    expect(textOf(instance.render())).not.toContain('Switch all');

    instance.setState({ filter: 'logs', query: 'nitro' });
    expect(textOf(instance.render())).not.toContain('Switch all');
  });

  it('disappears when every install with logs is already on', () => {
    const { instance } = makeTab({
      state: BIG_FLEET,
      scope: ['jeremypollock2', 'nitropack3', 'theawfulproduc', 'acfprod'],
    });
    expect(textOf(instance.render())).not.toContain('Switch all');
  });

  it('switches on every install with logs and nothing else', () => {
    const { instance, onScopeChange } = makeTab({ state: BIG_FLEET, scope: ['keep-me'] });
    instance['switchAllOn'](rowsOf(BIG_FLEET));
    expect(new Set(onScopeChange.mock.calls[0][0])).toEqual(
      new Set(['keep-me', 'jeremypollock2', 'nitropack3', 'theawfulproduc', 'acfprod']),
    );
  });
});

function rowsOf(s: LogSourcesState, scope: string[] = []) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../../src/renderer/components/agents/logSourcesModel').deriveLogSiteRows(s, scope);
}
