import { OtherHostsPanel } from '../../../src/renderer/components/settings/OtherHostsPanel';
import { serializeTree } from './helpers/serializeTree';

// Mock rendererGql at the module level to capture GraphQL operations
jest.mock('../../../src/renderer/utils/rendererGql', () => ({
  rendererGql: jest.fn(),
}));

// Import the mocked function to control its behavior per test
import { rendererGql } from '../../../src/renderer/utils/rendererGql';
const mockedRendererGql = rendererGql as jest.MockedFunction<typeof rendererGql>;

function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  const children = node.props?.children;
  const kids = Array.isArray(children) ? children : [children];
  for (const k of kids) findAll(k, pred, out);
  return out;
}

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
  });
}

const inst = (over: any = {}) => {
  const i = new (OtherHostsPanel as any)({
    externalHosts: over.externalHosts ?? [],
    electron: over.electron ?? { ipcRenderer: { invoke: jest.fn().mockResolvedValue({ success: true, hosts: [] }) } },
    ...over,
  });
  spySetState(i);
  i.mounted = true; // componentDidMount is not called in tests
  return i;
};

describe('host detail', () => {
  const hosts = [{ alias: 'boxa', site: 'one', environment: 'production', domain: 'one.com', wpPath: '/home/u/one', allowRoot: false }];

  beforeEach(() => {
    mockedRendererGql.mockClear();
  });

  it('renders the three capability states, with wpcli gated rather than allowed', () => {
    const i = inst({ externalHosts: hosts });
    i.setState({ screen: { name: 'detail', alias: 'boxa' } });
    const t = JSON.stringify(serializeTree(i.render()));
    expect(t).toContain('Install or update things');
    expect(t).toContain('If you allow it under What agents may do');
    expect(t).toContain('WP Engine only');
  });

  it('attributes the connection limit to Nexus, never to the server', () => {
    const i = inst({ externalHosts: hosts });
    i.setState({ screen: { name: 'detail', alias: 'boxa' } });
    const t = JSON.stringify(serializeTree(i.render()));
    expect(t).toContain('a fixed limit on our side, not something read from your server');
  });

  it('Check it now sends a mutation to nexusHostProbe', async () => {
    // Gap 1: Mock at the transport boundary to verify the real runProbe executes
    const i = inst({ externalHosts: hosts });

    let capturedQuery = '';
    mockedRendererGql.mockImplementation(async (query: string) => {
      capturedQuery = query;
      return {
        nexusHostProbe: {
          success: true,
          error: null,
          multiIssue: { installs: [], issues: [] },
        },
      };
    });

    await i.checkItNow('boxa');

    // Verify the real production code sent a mutation (not a query)
    expect(capturedQuery).toContain('mutation');
    expect(capturedQuery).toContain('nexusHostProbe');
    expect(capturedQuery).not.toContain('query ProbeHost');
  });

  it('Check it now surfaces a newly-discovered install without disturbing followed sites', async () => {
    const i = inst({ externalHosts: hosts });
    const mockGql = jest.fn().mockResolvedValue({
      nexusHostProbe: {
        success: true,
        error: null,
        multiIssue: { installs: ['/home/u/one', '/home/u/brand-new'], issues: [] },
      },
    });
    i.runProbe = async () => ({
      installs: ['/home/u/one', '/home/u/brand-new'],
    });
    await i.checkItNow('boxa');
    expect(i.state.discovered['boxa']).toContain('/home/u/brand-new');
    expect(i.state.discovered['boxa']).not.toContain('/home/u/one');
    // the followed site is untouched
    expect(i.state.hosts).toEqual(hosts);
  });

  it('Check it now surfaces probe failure to the user', async () => {
    const i = inst({ externalHosts: hosts });
    i.runProbe = jest.fn().mockRejectedValue(new Error('Connection failed'));
    await i.checkItNow('boxa');
    expect(i.state.probeError).toBe('Connection failed');
    expect(i.state.checking).toBeNull();
  });

  it('Check it now routes to identityChanged screen when host key changed', async () => {
    // Gap 2: Verify that a changedHostKey issue routes to the identity-changed screen
    const i = inst({ externalHosts: hosts });

    const currentFp = 'SHA256:abc123currentfingerprint';
    const previousFp = 'SHA256:xyz789previousfingerprint';

    mockedRendererGql.mockResolvedValue({
      nexusHostProbe: {
        success: true,
        error: null,
        multiIssue: {
          installs: ['/home/u/one'],
          issues: [
            {
              kind: 'changedHostKey',
              fingerprint: currentFp,
              previousFingerprint: previousFp,
            },
          ],
        },
      },
    });

    await i.checkItNow('boxa');

    // Should route to identityChanged screen
    expect(i.state.screen).toEqual({ name: 'identityChanged', alias: 'boxa' });

    // Should populate identity state with both fingerprints
    expect(i.state.identity['boxa']).toBeDefined();
    expect(i.state.identity['boxa'].current).toBe(currentFp);
    expect(i.state.identity['boxa'].approved).toBe(previousFp);
  });

  it('Following a discovered install calls nexusHostAddSites and reload without re-probing', async () => {
    // Gap 3: Verify following an install does not trigger another probe
    const i = inst({ externalHosts: hosts });
    const discoveredPath = '/home/u/brand-new';

    // Spy on runProbe to ensure it's NOT called during follow
    const runProbeSpy = jest.spyOn(i, 'runProbe');

    // Mock the nexusHostAddSites mutation
    mockedRendererGql.mockResolvedValue({
      nexusHostAddSites: {
        success: true,
        error: null,
      },
    });

    // Set up state as if a probe had already discovered an install
    i.setState({
      discovered: { boxa: [discoveredPath] },
    });

    await i.followDiscoveredInstall('boxa', discoveredPath);

    // Should call nexusHostAddSites mutation
    expect(mockedRendererGql).toHaveBeenCalledWith(
      expect.stringContaining('nexusHostAddSites'),
      expect.objectContaining({
        alias: 'boxa',
        sites: expect.arrayContaining([
          expect.objectContaining({
            path: discoveredPath,
          }),
        ]),
      }),
    );

    // Should call reload (via IPC invoke for GET_EXTERNAL_HOSTS)
    const invoke = i.props.electron.ipcRenderer.invoke as jest.Mock;
    expect(invoke).toHaveBeenCalledWith(expect.stringContaining('get-external-hosts'));

    // MUST NOT re-probe - this is the constraint being tested
    expect(runProbeSpy).not.toHaveBeenCalled();

    runProbeSpy.mockRestore();
  });

  it('the root-mode control persists through SET_EXTERNAL_HOST_ROOT_MODE', async () => {
    const invoke = jest.fn().mockResolvedValue({ success: true });
    const i = inst({ externalHosts: hosts, electron: { ipcRenderer: { invoke } } });
    await i.setRootMode('boxa', true);
    const call = invoke.mock.calls.find((c: any[]) => String(c[0]).includes('root-mode'));
    expect(call).toBeTruthy();
    expect(call.slice(1)).toEqual(['boxa', true]);
  });

  it('the root-mode checkbox renders checked when allowRoot is true', () => {
    const hostsWithRoot = [{ ...hosts[0], allowRoot: true }];
    const i = inst({ externalHosts: hostsWithRoot });
    i.setState({ screen: { name: 'detail', alias: 'boxa' } });
    const tree = i.render();

    // Verify the checkbox props directly by finding it in the tree
    // The checkbox is created with React.createElement('input', { type: 'checkbox', checked: allowRoot, ... })
    const checkboxes: any[] = [];
    const findInputs = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'input' && node.props?.type === 'checkbox') {
        checkboxes.push(node);
      }
      if (node.props?.children) {
        const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
        children.forEach(findInputs);
      }
    };

    findInputs(tree);
    expect(checkboxes.length).toBeGreaterThan(0);
    expect(checkboxes[0].props.checked).toBe(true);
  });

  it('an add affordance exists with a non-empty host list', () => {
    const i = inst({ externalHosts: hosts });
    i.setState({ screen: { name: 'list' } });
    const t = JSON.stringify(serializeTree(i.render()));
    expect(t).toContain('Add a host');
  });

  it('interactive controls are real button elements', () => {
    const i = inst({ externalHosts: hosts });
    i.setState({ screen: { name: 'detail', alias: 'boxa' } });
    const tree = i.render();

    // Find all buttons by walking the React element tree
    const buttons: any[] = [];
    const findButtons = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'button') {
        buttons.push(node);
      }
      if (node.props?.children) {
        const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
        children.forEach(findButtons);
      }
    };

    findButtons(tree);
    // Should have at least: back, check it now, remove
    expect(buttons.length).toBeGreaterThanOrEqual(3);

    // Verify one is the back button
    const backButton = buttons.find(b => {
      const text = String(b.props?.children || '');
      return text.includes('Back to hosts');
    });
    expect(backButton).toBeTruthy();
  });
});
