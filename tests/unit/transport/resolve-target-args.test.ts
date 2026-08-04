import { resolveTargetArgs } from '../../../src/main/transport/resolveTargetArgs';
import { classifyWpCliOp } from '../../../src/main/transport/classify';
import { resolveTransport } from '../../../src/main/transport';

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
      .toEqual({ install_name: 'myinstall', install_name_explicit: true });
  });

  // THE MIS-TARGETING HAZARD. resolveTarget reads a bare `install_name` as
  // "possibly a local site name" and looks that up FIRST. Without the explicit
  // flag, `wpe:acct/clash@production` runs against whatever install the local
  // site `clash` is linked to — a different install, silently, on production.
  it('marks a wpe: target explicit even when a local site shares the name', () => {
    expect(resolveTargetArgs('wpe:acct/clash@production', services({ localSites: ['clash'] })))
      .toEqual({ install_name: 'clash', install_name_explicit: true });
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
      .toEqual({ install_name: 'myinstall', install_name_explicit: true });
  });

  it('is case-insensitive on the WPE fallback lookup', () => {
    expect(resolveTargetArgs('MyInstall', services({ wpeInstalls: ['myinstall'] })))
      .toEqual({ install_name: 'myinstall', install_name_explicit: true });
  });

  it('throws when a bare name matches both a local site and a WPE install', () => {
    expect(() => resolveTargetArgs('blog', services({ localSites: ['blog'], wpeInstalls: ['blog'] })))
      .toThrow(/Ambiguous target "blog"/);
  });

  it('error message contains all three disambiguation forms', () => {
    expect(() => resolveTargetArgs('blog', services({ localSites: ['blog'], wpeInstalls: ['blog'] })))
      .toThrow(/blog@local/);
    expect(() => resolveTargetArgs('blog', services({ localSites: ['blog'], wpeInstalls: ['blog'] })))
      .toThrow(/wpe:/);
    expect(() => resolveTargetArgs('blog', services({ localSites: ['blog'], wpeInstalls: ['blog'] })))
      .toThrow(/ssh:/);
  });

  it('maps a bare name that is ONLY a local site to site (unambiguous)', () => {
    expect(resolveTargetArgs('onlylocal', services({ localSites: ['onlylocal'] })))
      .toEqual({ site: 'onlylocal' });
  });

  it('maps a bare name that is ONLY a WPE install to install_name (unambiguous)', () => {
    expect(resolveTargetArgs('onlywpe', services({ wpeInstalls: ['onlywpe'] })))
      .toEqual({ install_name: 'onlywpe', install_name_explicit: true });
  });

  it('falls back to site for an unknown bare name, so the caller reports "not found"', () => {
    expect(resolveTargetArgs('nope', services())).toEqual({ site: 'nope' });
  });

  it('does not throw when the graph DB is unavailable', () => {
    const s = services(); s.graphService = undefined;
    expect(resolveTargetArgs('nope', s)).toEqual({ site: 'nope' });
  });
});

// ---------------------------------------------------------------------------
// The mapper → resolveTarget boundary
// ---------------------------------------------------------------------------

describe('an explicit wpe: target is not hijacked by a same-named local site', () => {
  /**
   * A local site called `clash` that was pulled from a DIFFERENT install. This
   * is ordinary, not exotic: Local sites are routinely named after the install
   * they came from, and `install_copy` / staging pulls make the names diverge.
   */
  function clashServices() {
    const sites = { 'id-clash': { id: 'id-clash', name: 'clash' } };
    const resolveWpeInstall = jest.fn(async () => ({
      installName: 'a-completely-different-install',
      installId: 'i-9',
      remoteSiteId: '',
      primaryDomain: 'other.wpengine.com',
      environment: 'production',
    }));
    return {
      resolveWpeInstall,
      services: {
        localServices: {
          isCAPIAvailable: () => true,
          isSSHKeyAvailable: () => true,
          resolveWpeInstall,
        },
        siteData: { getSites: () => sites, getSite: (id: string) => (sites as any)[id] ?? null },
        graphService: { getDb: () => undefined },
        registryStorage: { get: () => null, set: jest.fn() },
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
      } as any,
    };
  }

  it('routes an explicit wpe: target to that install, not to the install the local site is linked to', async () => {
    const { services: svc, resolveWpeInstall } = clashServices();

    const transport = await resolveTransport(
      resolveTargetArgs('wpe:acct/clash@production', svc), svc, 'wpcli_read',
    );

    expect('content' in transport).toBe(false);
    expect((transport as any).siteRef).toEqual({ kind: 'wpe', installName: 'clash' });
    // The local site was never consulted, so it could not have redirected us.
    expect(resolveWpeInstall).not.toHaveBeenCalled();
  });

  it('leaves a BARE install_name resolving local-first — every MCP tool relies on it', async () => {
    const { services: svc, resolveWpeInstall } = clashServices();

    const transport = await resolveTransport({ install_name: 'clash' }, svc, 'wpcli_read');

    expect((transport as any).siteRef).toEqual({
      kind: 'wpe', installName: 'a-completely-different-install',
    });
    expect(resolveWpeInstall).toHaveBeenCalledWith('id-clash');
  });
});

describe('classifyWpCliOp', () => {
  it.each([
    ['plugin list'], ['plugin get'], ['theme list'], ['theme get'], ['core version'],
    ['user list'], ['user get'], ['option get'], ['site health'],
    ['post list'], ['post get'], ['post-type list'],
  ])('classifies %s as a read', (c) => {
    expect(classifyWpCliOp(c.split(' '))).toBe('wpcli_read');
  });

  // `db export` reads the database but writes the dump to the SSH login
  // directory — the web root on many hosts. It is a write.
  it.each([['plugin install x'], ['core update'], ['db export'], ['db import f.sql'], ['post delete 1']])(
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
