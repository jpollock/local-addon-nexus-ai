/**
 * Fleet Tab — WP Engine fleet identity view tests
 *
 * Following the same pattern as sites-tab.test.ts: instantiate and render
 * directly rather than using serializeTree on an element, since we need
 * the rendered output not the props.
 */
import { FleetTab } from '../../../src/renderer/components/tabs/FleetTab';
import { serializeTree } from './helpers/serializeTree';
import type { FleetSiteGroup, FleetInstall, UnresolvedSite } from '../../../src/main/fleet/types';

const install = (over: Partial<FleetInstall> = {}): FleetInstall => ({
  installId: 'i1',
  installName: 'testsite',
  environment: 'production',
  domain: 'testsite.com',
  sandbox: null,
  provenance: {
    level: 'live',
    source: 'WPE sync',
    ageSeconds: 30,
    caveat: null,
  },
  ...over,
});

const group = (over: Partial<FleetSiteGroup> = {}): FleetSiteGroup => ({
  wpeSiteId: 's1',
  name: 'Test Site',
  installs: [install()],
  ...over,
});

const props = (over: any = {}) => ({
  loaded: true,
  failed: false,
  groups: [group()],
  unresolved: [],
  onRetry: jest.fn(),
  ...over,
});

const tree = (over: any = {}) =>
  JSON.stringify(serializeTree(new (FleetTab as any)(props(over)).render()));

describe('FleetTab', () => {
  test('renders site groups with install names', () => {
    const t = tree({
      groups: [
        group({ name: 'My WPE Site', installs: [install({ installName: 'prodinstall' })] }),
      ],
    });
    expect(t).toContain('My WPE Site');
    expect(t).toContain('prodinstall');
  });

  test('renders multiple environments as pills', () => {
    const t = tree({
      groups: [
        group({
          installs: [
            install({ installId: 'i1', environment: 'production' }),
            install({ installId: 'i2', environment: 'staging' }),
            install({ installId: 'i3', environment: 'development' }),
          ],
        }),
      ],
    });
    expect(t).toContain('Prod');
    expect(t).toContain('Staging');
    expect(t).toContain('Dev');
  });

  test('shows sandbox badge when install has attached local site', () => {
    const t = tree({
      groups: [
        group({
          installs: [
            install({
              sandbox: {
                localSiteId: 'local1',
                localSiteName: 'My Local Site',
                linkSource: 'user',
              },
            }),
          ],
        }),
      ],
    });
    expect(t).toContain('Sandbox: My Local Site');
  });

  test('renders provenance labels for all levels', () => {
    const t = tree({
      groups: [
        group({
          installs: [
            install({
              installId: 'i1',
              provenance: { level: 'live', source: 'WPE sync', ageSeconds: 30, caveat: null },
            }),
            install({
              installId: 'i2',
              provenance: {
                level: 'configured',
                source: 'last sync',
                ageSeconds: 7200,
                caveat: 'From last sync',
              },
            }),
            install({
              installId: 'i3',
              provenance: {
                level: 'external-api',
                source: 'WP Engine API',
                ageSeconds: 0,
                caveat: 'From WP Engine API',
              },
            }),
            install({
              installId: 'i4',
              provenance: {
                level: 'scanned',
                source: 'none',
                ageSeconds: null,
                caveat: "We've never reached this site",
              },
            }),
          ],
        }),
      ],
    });
    expect(t).toContain('checked just now');
    expect(t).toContain('from last sync');
    expect(t).toContain('from WP Engine, not yet reached');
    expect(t).toContain("We've never reached this site");
  });

  test('renders header with site count', () => {
    const t = tree({
      groups: [group(), group({ wpeSiteId: 's2', name: 'Site 2' })],
    });
    expect(t).toContain('2 sites');
  });

  test('header shows attention count when installs need visual weight', () => {
    const t = tree({
      groups: [
        group({
          installs: [
            install({
              provenance: {
                level: 'scanned',
                source: 'none',
                ageSeconds: null,
                caveat: 'Never reached',
              },
            }),
          ],
        }),
      ],
    });
    expect(t).toContain('1 need attention');
  });

  test('header says "quiet" when nothing needs attention', () => {
    const t = tree({
      groups: [
        group({
          installs: [
            install({
              provenance: { level: 'live', source: 'WPE sync', ageSeconds: 30, caveat: null },
            }),
          ],
        }),
      ],
    });
    expect(t).toContain('everything else is quiet');
  });

  test('renders unresolved local sites section', () => {
    const unresolved: UnresolvedSite[] = [
      { localSiteId: 'l1', localSiteName: 'Unlinked Site' },
    ];
    const t = tree({ unresolved });
    expect(t).toContain('Unresolved local sites');
    expect(t).toContain('Unlinked Site');
  });

  test('failed read is not rendered as empty fleet', () => {
    const t = tree({ failed: true, groups: [], unresolved: [] }).toLowerCase();
    expect(t).toContain("couldn't read");
    expect(t).not.toContain('no wp engine sites');
  });

  test('failed read wins over not-loaded', () => {
    const t = tree({ failed: true, loaded: false, groups: [], unresolved: [] }).toLowerCase();
    expect(t).toContain("couldn't read");
    expect(t).not.toContain('loading');
  });

  test('not-yet-loaded fleet shows loading state', () => {
    const t = tree({ loaded: false, groups: [], unresolved: [] }).toLowerCase();
    expect(t).toContain('loading');
    expect(t).not.toContain("couldn't read");
  });

  test('genuinely empty fleet says so', () => {
    const t = tree({ groups: [], unresolved: [] }).toLowerCase();
    expect(t).toContain('no wp engine sites');
  });

  test('renders no hardcoded hex colours', () => {
    expect(tree()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  test('snapshot', () => {
    expect(
      serializeTree(
        new (FleetTab as any)(
          props({
            groups: [
              group({
                name: 'Example Site',
                installs: [
                  install({
                    installName: 'examplesite',
                    environment: 'production',
                    domain: 'example.com',
                  }),
                ],
              }),
            ],
          }),
        ).render(),
      ),
    ).toMatchSnapshot();
  });
});
