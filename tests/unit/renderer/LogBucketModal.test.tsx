import { LogBucketModal, parseToolJson } from '../../../src/renderer/components/agents/LogBucketModal';
import { IPC_CHANNELS } from '../../../src/common/constants';

// No module mock any more, deliberately. The route out of this modal used to be a module-level
// helper (`openNexusPreferences`) that asked Local to navigate to the route already on screen, so
// every one of these assertions could pass while the button did nothing. It is a prop now, and a
// prop is checkable: the test can see whether the caller was actually asked to open Settings.

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, ...args: unknown[]) {
    const [updater, cb] = args as [any, (() => void) | undefined];
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
    cb?.();
  });
}

const toolResult = (payload: unknown, isError = false) =>
  ({ content: [{ type: 'text', text: JSON.stringify(payload) }], isError });

function makeModal(over: Partial<any> = {}) {
  const onClose = jest.fn();
  const onConnected = jest.fn();
  // Present unless a case explicitly withholds it — `hasOwnProperty`, not `??`, so a test can pass
  // `onOpenAwsSettings: undefined` to exercise the no-destination branch.
  const onOpenAwsSettings = Object.prototype.hasOwnProperty.call(over, 'onOpenAwsSettings')
    ? over.onOpenAwsSettings
    : jest.fn();
  const invoke = jest.fn(async () => over.result ?? toolResult({ ok: true, scan: EMPTY_SCAN }));
  const instance: any = new LogBucketModal({
    electron: { ipcRenderer: { invoke } },
    aws: over.aws ?? { connected: true, label: 'arn:aws:iam::1:user/nexus' },
    fleet: over.fleet ?? [{ id: 'alpha', name: 'alpha', environment: 'production', platform: 'WP Engine' }],
    initial: over.initial,
    onClose,
    onConnected,
    onOpenAwsSettings,
  });
  spySetState(instance);
  return { instance, onClose, onConnected, invoke, onOpenAwsSettings };
}

const EMPTY_SCAN = { totalObjects: 0, apacheStyleObjects: 0, unparsedObjects: 0, installs: [], truncated: false };

const SCAN = {
  totalObjects: 900, apacheStyleObjects: 450, unparsedObjects: 0, truncated: false,
  installs: [
    { installId: 'alpha', objectCount: 312, bytes: 1000, oldest: '2026-05-02', newest: '2026-08-07', sampleKey: 'x' },
    { installId: 'clientold2', objectCount: 138, bytes: 500, oldest: '2026-06-01', newest: '2026-08-07', sampleKey: 'y' },
  ],
};

function textOf(node: any): string {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (node.props) return textOf(node.props.children);
  return '';
}

describe('parseToolJson', () => {
  it('unwraps the AgentToolResult envelope', () => {
    expect(parseToolJson(toolResult({ ok: true }))).toEqual({ ok: true, data: { ok: true } });
  });

  it('reports unparseable text as a message rather than throwing', () => {
    expect(parseToolJson({ content: [{ type: 'text', text: 'boom' }] })).toEqual({ ok: false, message: 'boom' });
  });

  it('reports an empty response', () => {
    expect(parseToolJson({})).toEqual({ ok: false, message: 'The agent returned no response.' });
  });
});

describe('submitting the form', () => {
  it('calls set_log_bucket with the typed values and asks for JSON', async () => {
    const { instance, invoke } = makeModal();
    instance.state.bucket = ' wpejpp ';
    instance.state.prefix = ' wpe_logs/nginx/ ';
    instance.state.region = 'us-west-2';
    await instance['submit']();
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.AGENT_TOOL_INVOKE, {
      agentId: 'log-processor',
      toolName: 'set_log_bucket',
      args: { bucket: 'wpejpp', region: 'us-west-2', prefix: 'wpe_logs/nginx/', format: 'json' },
    });
  });

  it('moves to the result phase and tells the caller to reload on success', async () => {
    const { instance, onConnected } = makeModal({ result: toolResult({ ok: true, scan: SCAN }) });
    instance.state.bucket = 'wpejpp';
    await instance['submit']();
    expect(instance.state.phase).toBe('result');
    expect(instance.state.scan).toEqual(SCAN);
    expect(onConnected).toHaveBeenCalled();
  });

  it('returns to the form on failure with every entered value intact', async () => {
    const { instance, onConnected } = makeModal({
      result: toolResult({ ok: false, errorCode: 'NoSuchBucket', message: 'no such bucket', suggestedRegion: 'us-west-2' }, true),
    });
    instance.state.bucket = 'wpejpp';
    instance.state.prefix = 'wpe_logs/nginx/';
    await instance['submit']();

    expect(instance.state.phase).toBe('form');
    expect(instance.state.bucket).toBe('wpejpp');
    expect(instance.state.prefix).toBe('wpe_logs/nginx/');
    expect(instance.state.failure).toMatchObject({ errorCode: 'NoSuchBucket', suggestedRegion: 'us-west-2' });
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('survives an IPC rejection', async () => {
    const { instance } = makeModal();
    instance.props.electron.ipcRenderer.invoke = jest.fn(async () => { throw new Error('ipc gone'); });
    instance.state.bucket = 'wpejpp';
    await instance['submit']();
    expect(instance.state.phase).toBe('form');
    expect(instance.state.failure?.message).toBe('ipc gone');
  });
});

describe('the fix is always the footer primary button', () => {
  it('scans when there is nothing to fix', () => {
    const { instance } = makeModal();
    instance.state.bucket = 'wpejpp';
    expect(instance['footerPrimary']().label).toBe('Scan bucket');
  });

  it('is disabled with no bucket typed', () => {
    expect(makeModal().instance['footerPrimary']().disabled).toBe(true);
  });

  it('becomes the credential action when AWS is not connected at all', () => {
    // Reachable via Change after the key was revoked. A disabled "Scan bucket" would put the
    // blocked step in the primary slot and hide the one thing that unblocks it.
    const noCreds = makeModal({ aws: { connected: false } }).instance;
    noCreds.state.bucket = 'wpejpp';
    expect(noCreds['footerPrimary']()).toMatchObject({ label: 'Open Connected accounts', disabled: false });
  });

  it('offers the region the bucket actually lives in', async () => {
    const { instance, invoke } = makeModal({
      result: toolResult({ ok: false, errorCode: 'NoSuchBucket', message: 'x', suggestedRegion: 'eu-west-1' }, true),
    });
    instance.state.bucket = 'wpejpp';
    await instance['submit']();

    const primary = instance['footerPrimary']();
    expect(primary.label).toBe('Use eu-west-1');
    primary.onClick();
    expect(instance.state.region).toBe('eu-west-1');
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('offers a sibling prefix that does hold apache-style logs', async () => {
    const { instance } = makeModal({
      result: toolResult({ ok: false, errorCode: 'EmptyPrefix', message: 'x', suggestedPrefix: 'wpe_logs/nginx/' }, true),
    });
    instance.state.bucket = 'wpejpp';
    await instance['submit']();

    const primary = instance['footerPrimary']();
    expect(primary.label).toBe('Use wpe_logs/nginx/');
    primary.onClick();
    expect(instance.state.prefix).toBe('wpe_logs/nginx/');
  });

  it('falls back to a plain retry when the backend cannot name an alternative', async () => {
    const { instance } = makeModal({ result: toolResult({ ok: false, errorCode: 'EmptyPrefix', message: 'x' }, true) });
    instance.state.bucket = 'wpejpp';
    await instance['submit']();
    // Explanation kept, button dropped back to retry — never a button that guesses.
    expect(instance['footerPrimary']().label).toBe('Scan again');
    expect(textOf(instance['renderFailure']())).toContain('Only *.apachestyle.log.gz objects are read');
  });

  it('sends a bad credential to Settings, and dismisses itself on the way', async () => {
    const { instance, onClose, onOpenAwsSettings } = makeModal({
      result: toolResult({ ok: false, errorCode: 'InvalidAccessKeyId', message: 'bad key' }, true),
    });
    instance.state.bucket = 'wpejpp';
    await instance['submit']();

    const primary = instance['footerPrimary']();
    expect(primary.label).toBe('Open Connected accounts');
    primary.onClick();
    // Both, and this is the half that used to be missing: the click must actually reach the owner
    // of the Settings tab. It used to call a helper that navigated to the route already on screen.
    expect(onOpenAwsSettings).toHaveBeenCalled();
    // A fixed overlay at z-index 1000 — leaving it up would put Settings behind a modal.
    expect(onClose).toHaveBeenCalled();
  });

  it('drops to a plain Close when nothing can open Settings for it', async () => {
    // The body of every credential failure already names Nexus AI → Settings → Connections, so
    // leaving IS the action. A button still labelled "Open Connected accounts" that only closed
    // the modal would be the same false promise this replaced.
    const { instance, onClose } = makeModal({
      onOpenAwsSettings: undefined,
      result: toolResult({ ok: false, errorCode: 'InvalidAccessKeyId', message: 'bad key' }, true),
    });
    instance.state.bucket = 'wpejpp';
    await instance['submit']();

    const primary = instance['footerPrimary']();
    expect(primary.label).toBe('Close');
    primary.onClick();
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on the result screen', async () => {
    const { instance, onClose } = makeModal({ result: toolResult({ ok: true, scan: SCAN }) });
    instance.state.bucket = 'wpejpp';
    await instance['submit']();
    instance['footerPrimary']().onClick();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('failure copy', () => {
  it('leads with plain language and keeps the raw AWS text secondary', async () => {
    const { instance } = makeModal({
      result: toolResult({ ok: false, errorCode: 'AccessDenied', message: 'User is not authorized to perform s3:ListBucket' }, true),
    });
    instance.state.bucket = 'wpejpp';
    await instance['submit']();
    const text = textOf(instance['renderFailure']());
    expect(text).toContain('The key cannot list this bucket');
    expect(text).toContain('IAM policy does not allow s3:ListBucket');
    expect(text).toContain('User is not authorized to perform s3:ListBucket');
  });
});

describe('scan result', () => {
  it('reports apache-style objects, recognised installs and the date range', async () => {
    const { instance } = makeModal({ result: toolResult({ ok: true, scan: SCAN }) });
    instance.state.bucket = 'wpejpp';
    await instance['submit']();
    const text = textOf(instance['renderResult']());
    expect(text).toContain('450 apache-style objects');
    expect(text).toContain('1 of your installs');   // clientold2 is not on the account
    expect(text).toContain('Logs from 2026-05-02 to 2026-08-07');
    expect(text).toContain('access logs in the same folder are ignored');
  });

  it('lists only installs that exist in the fleet, and explains the rest', async () => {
    const { instance } = makeModal({ result: toolResult({ ok: true, scan: SCAN }) });
    instance.state.bucket = 'wpejpp';
    await instance['submit']();
    const text = textOf(instance['renderResult']());
    expect(text).toContain('alpha');
    expect(text).toContain('clientold2 in the bucket is not on this account');
  });

  it('names an install of yours that has no logs here', async () => {
    const { instance } = makeModal({
      result: toolResult({ ok: true, scan: SCAN }),
      fleet: [
        { id: 'alpha', name: 'alpha', environment: 'production', platform: 'WP Engine' },
        { id: 'beta', name: 'beta', environment: 'staging', platform: 'WP Engine' },
      ],
    });
    instance.state.bucket = 'wpejpp';
    await instance['submit']();
    expect(textOf(instance['renderResult']())).toContain('beta has no logs here');
  });

  it('says the counts are a floor when the listing was truncated', async () => {
    const { instance } = makeModal({ result: toolResult({ ok: true, scan: { ...SCAN, truncated: true } }) });
    instance.state.bucket = 'wpejpp';
    await instance['submit']();
    expect(textOf(instance.render())).toContain('a floor rather than a total');
  });

  it('reports processed days cleared by a bucket change', async () => {
    const { instance } = makeModal({
      result: toolResult({ ok: true, scan: SCAN, cleared: { aggregates: 12, ledger: 14 } }),
    });
    instance.state.bucket = 'wpejpp';
    await instance['submit']();
    expect(textOf(instance.render())).toContain('Cleared 12 processed day(s)');
  });
});

describe('the scanning step', () => {
  it('names the apache-style filter explicitly', () => {
    const { instance } = makeModal();
    instance.state.phase = 'scanning';
    const text = textOf(instance.render());
    expect(text).toContain('Keeping apache-style objects');
    expect(text).toContain('Credential accepted');
  });

  it('blocks both footer buttons while it runs', () => {
    const { instance } = makeModal();
    instance.state.phase = 'scanning';
    expect(instance['footerPrimary']()).toMatchObject({ label: 'Scanning…', disabled: true });
  });
});

describe('pre-filled values', () => {
  it('starts from the connected bucket when re-pointing', () => {
    const { instance } = makeModal({ initial: { bucket: 'wpejpp', region: 'eu-west-1', prefix: 'wpe_logs/nginx/' } });
    expect(instance.state).toMatchObject({ bucket: 'wpejpp', region: 'eu-west-1', prefix: 'wpe_logs/nginx/' });
  });

  it('defaults to us-east-1 for a first connection', () => {
    expect(makeModal().instance.state.region).toBe('us-east-1');
  });
});

describe('prefix hint', () => {
  it.each([
    ['/wpe_logs/nginx', 'wpe_logs/nginx/'],
    // The one that broke a real setup: scans clean, then lists `wpe_logs/nginx20260808`.
    ['wpe_logs/nginx', 'wpe_logs/nginx/'],
  ])('shows what %p will be saved as, without rewriting the field', (typed, saved) => {
    const { instance } = makeModal();
    instance.state.prefix = typed;
    const text = textOf(instance['renderForm']());
    expect(text).toContain('Will be saved as');
    expect(text).toContain(saved);
    // The field still holds exactly what the user typed — the hint is disclosure, not a silent
    // edit under the cursor.
    expect(instance.state.prefix).toBe(typed);
  });

  it('says nothing for a prefix that is already in folder form', () => {
    const { instance } = makeModal();
    instance.state.prefix = 'wpe_logs/nginx/';
    expect(textOf(instance['renderForm']())).not.toContain('Will be saved as');
  });

  it('says nothing for an empty prefix', () => {
    const { instance } = makeModal();
    instance.state.prefix = '';
    expect(textOf(instance['renderForm']())).not.toContain('Will be saved as');
  });
});
