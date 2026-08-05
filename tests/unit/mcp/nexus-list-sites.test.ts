import { nexusListSitesHandler } from '../../../src/main/mcp/modules/wpe/nexus-list-sites';

function getText(result: any): string {
  return result.content[0].text;
}

function makeServices(opts: {
  externalRows?: Array<{ name: string; environment: string | null; domain: string | null }>;
} = {}) {
  const { externalRows = [] } = opts;
  const db = {
    prepare: jest.fn().mockReturnValue({ all: jest.fn().mockReturnValue(externalRows) }),
  };
  return {
    siteData: { getSites: jest.fn().mockReturnValue({}) },
    localServices: {
      getAllSiteStatuses: jest.fn().mockReturnValue({}),
      isCAPIAvailable: jest.fn().mockReturnValue(false),
    },
    graphService: { getDb: jest.fn().mockReturnValue(db) },
  } as any;
}

describe('nexus_list_sites — external hosts', () => {
  it('lists a registered external host', async () => {
    const services = makeServices({
      externalRows: [{ name: 'hostinger-test', environment: 'production', domain: 'example.com' }],
    });

    const result = await nexusListSitesHandler.execute({}, services);

    const text = getText(result);
    expect(text).toContain('External SSH Hosts');
    expect(text).toContain('hostinger-test');
    expect(text).toContain('ssh:hostinger-test@production');
  });

  it('omits the External SSH Hosts section when there are none', async () => {
    const services = makeServices({ externalRows: [] });

    const result = await nexusListSitesHandler.execute({}, services);

    expect(getText(result)).not.toContain('External SSH Hosts');
  });

  it('does not crash when graphService is unavailable', async () => {
    const services = makeServices();
    (services as any).graphService = undefined;

    const result = await nexusListSitesHandler.execute({}, services);

    expect(getText(result)).not.toContain('External SSH Hosts');
  });
});
