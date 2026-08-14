import { listFleetHandler, linkSiteHandler, unlinkSiteHandler } from '../../../src/main/mcp/modules/fleet-links';

const GROUPS = [
  {
    wpeSiteId: 'site-A',
    name: 'good-aesthetic.com',
    installs: [
      {
        installId: 'inst-1',
        installName: 'ga-prod',
        environment: 'production',
        domain: 'good-aesthetic.com',
        sandbox: null,
        provenance: { level: 'live', source: 'WPE sync', ageSeconds: 60, caveat: null },
      },
    ],
  },
];

function services(overrides: Record<string, unknown> = {}) {
  return {
    fleetAssembler: { listFleet: jest.fn().mockResolvedValue(GROUPS) },
    siteLinkResolver: { setManualLink: jest.fn(), clearLink: jest.fn() },
    ...overrides,
  } as any;
}

describe('fleet-links tools', () => {
  it('nexus_fleet_list returns grouped installs as JSON', async () => {
    const result = await listFleetHandler.execute({}, services());
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toEqual(GROUPS);
  });

  it('nexus_fleet_list errors cleanly when the assembler is absent', async () => {
    const result = await listFleetHandler.execute({}, services({ fleetAssembler: undefined }));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not available/i);
  });

  it('nexus_link_site records a user link', async () => {
    const svc = services();
    const result = await linkSiteHandler.execute(
      { site: 'local-1', install_id: 'inst-1', install_name: 'ga-prod' },
      svc,
    );
    expect(svc.siteLinkResolver.setManualLink).toHaveBeenCalledWith('local-1', 'inst-1', 'ga-prod');
    expect(result.isError).toBeFalsy();
  });

  it('nexus_link_site rejects a missing install_id', async () => {
    const svc = services();
    const result = await linkSiteHandler.execute({ site: 'local-1' }, svc);
    expect(result.isError).toBe(true);
    expect(svc.siteLinkResolver.setManualLink).not.toHaveBeenCalled();
  });

  it('nexus_unlink_site clears the link', async () => {
    const svc = services();
    const result = await unlinkSiteHandler.execute({ site: 'local-1' }, svc);
    expect(svc.siteLinkResolver.clearLink).toHaveBeenCalledWith('local-1');
    expect(result.isError).toBeFalsy();
  });
});
