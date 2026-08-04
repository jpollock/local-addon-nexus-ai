import { resolveTargetArgs } from '../../../src/main/transport/resolveTargetArgs';
import { classifyWpCliOp } from '../../../src/main/transport/classify';

function services(opts: { localSites?: string[]; wpeInstalls?: string[] } = {}) {
  const sites = Object.fromEntries((opts.localSites ?? []).map((n) => [n, { id: `id-${n}`, name: n }]));
  return {
    siteData: { getSites: () => sites, getSite: (id: string) => Object.values(sites).find((s: any) => s.id === id) ?? null },
    graphService: {
      getDb: () => ({
        prepare: () => ({
          get: (name: string) =>
            (opts.wpeInstalls ?? []).map((s) => s.toLowerCase()).includes(name)
              ? { name: (opts.wpeInstalls ?? []).find((s) => s.toLowerCase() === name) }
              : undefined,
        }),
      }),
    },
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  } as any;
}

describe('resolveTargetArgs', () => {
  it('maps an ssh: target to ssh_target', () => {
    expect(resolveTargetArgs('ssh:box@production', services()))
      .toEqual({ ssh_target: 'ssh:box@production' });
  });

  it('maps a wpe: target to install_name, keeping only the install portion', () => {
    expect(resolveTargetArgs('wpe:acct/myinstall@production', services()))
      .toEqual({ install_name: 'myinstall' });
  });

  it('maps an explicit @local target to site', () => {
    expect(resolveTargetArgs('mysite@local', services({ localSites: ['mysite'] })))
      .toEqual({ site: 'mysite' });
  });

  it('maps a bare name that IS a local site to site', () => {
    expect(resolveTargetArgs('mysite', services({ localSites: ['mysite'] })))
      .toEqual({ site: 'mysite' });
  });

  // THE HAZARD. Deleting the fallback must fail this test.
  it('maps a bare name that is NOT local but IS a WPE install to install_name', () => {
    expect(resolveTargetArgs('myinstall', services({ wpeInstalls: ['myinstall'] })))
      .toEqual({ install_name: 'myinstall' });
  });

  it('is case-insensitive on the WPE fallback lookup', () => {
    expect(resolveTargetArgs('MyInstall', services({ wpeInstalls: ['myinstall'] })))
      .toEqual({ install_name: 'myinstall' });
  });

  it('prefers a local site over a WPE install of the same name', () => {
    expect(resolveTargetArgs('clash', services({ localSites: ['clash'], wpeInstalls: ['clash'] })))
      .toEqual({ site: 'clash' });
  });

  it('falls back to site for an unknown bare name, so the caller reports "not found"', () => {
    expect(resolveTargetArgs('nope', services())).toEqual({ site: 'nope' });
  });

  it('does not throw when the graph DB is unavailable', () => {
    const s = services(); s.graphService = undefined;
    expect(resolveTargetArgs('nope', s)).toEqual({ site: 'nope' });
  });
});

describe('classifyWpCliOp', () => {
  it.each([
    ['plugin list'], ['plugin get'], ['theme list'], ['theme get'], ['core version'],
    ['user list'], ['user get'], ['option get'], ['site health'],
    ['post list'], ['post get'], ['post-type list'], ['db export'],
  ])('classifies %s as a read', (c) => {
    expect(classifyWpCliOp(c.split(' '))).toBe('wpcli_read');
  });

  it.each([['plugin install x'], ['core update'], ['db import f.sql'], ['post delete 1']])(
    'classifies %s as a write', (c) => {
      expect(classifyWpCliOp(c.split(' '))).toBe('wpcli');
    });

  it('fails closed to write for an unknown command', () => {
    expect(classifyWpCliOp(['cron', 'event', 'run'])).toBe('wpcli');
    expect(classifyWpCliOp([])).toBe('wpcli');
  });

  it('is case-insensitive', () => {
    expect(classifyWpCliOp(['PLUGIN', 'LIST'])).toBe('wpcli_read');
  });
});
