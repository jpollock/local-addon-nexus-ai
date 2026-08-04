/**
 * Unit tests for wp_site_health transport integration.
 *
 * Verifies that wp_site_health accepts ssh_target and install_name,
 * resolves them via resolveTransport, and runs the health check on
 * local sites, remote WPE installs, and external SSH hosts.
 */

import { siteHealthHandler } from '../../../src/main/mcp/modules/wp-cli/site-health';
import * as transportModule from '../../../src/main/transport';
import type { NexusServices } from '../../../src/main/mcp/types';
import type { SiteTransport } from '../../../src/main/transport/types';

function makeServices(): NexusServices {
  return {
    vectorStore: {} as any,
    embeddingService: {} as any,
    contentPipeline: {} as any,
    indexRegistry: {} as any,
    fileScanner: {} as any,
    siteData: {
      getSite: jest.fn(),
      getSites: jest.fn().mockReturnValue({}),
    },
    localServices: {
      wpCliRun: jest.fn(),
      getSiteStatus: jest.fn().mockReturnValue('running'),
    } as any,
    logger: { info: jest.fn(), error: jest.fn() } as any,
  } as any;
}

function mockTransport(overrides: Partial<SiteTransport> = {}): SiteTransport {
  return {
    kind: 'external-ssh',
    siteRef: { kind: 'external', alias: 'box' },
    supports: jest.fn().mockReturnValue(true),
    runWpCli: jest.fn().mockResolvedValue({ success: true, stdout: '7.0.2' }),
    deleteRemoteFile: jest.fn().mockResolvedValue({ success: true, output: '' }),
    probe: jest.fn().mockResolvedValue({ reachable: true }),
    ...overrides,
  } as any;
}

describe('wp_site_health — remote transport integration', () => {
  it('runs against an external SSH host instead of reporting "site not found"', async () => {
    const runWpCli = jest.fn()
      .mockResolvedValueOnce({ success: true, stdout: '7.0.2' })           // core version
      .mockResolvedValueOnce({ success: true, stdout: '[]' })              // plugin list
      .mockResolvedValueOnce({ success: true, stdout: '[]' })              // theme list
      .mockResolvedValueOnce({ success: true, stdout: 'Test Site' })       // blogname
      .mockResolvedValueOnce({ success: true, stdout: '[]' });             // db size

    const transport = mockTransport({ runWpCli });
    jest.spyOn(transportModule, 'resolveTransport').mockResolvedValue(transport);

    const services = makeServices();
    const result = await siteHealthHandler.execute({ ssh_target: 'ssh:box@production' }, services);

    expect(result.isError).toBeUndefined();
    const text = (result.content?.[0] as any)?.text ?? '';
    expect(text).not.toContain('not found');
    expect(runWpCli).toHaveBeenCalled();
  });

  it('runs against a remote WPE install', async () => {
    const runWpCli = jest.fn()
      .mockResolvedValueOnce({ success: true, stdout: '7.0.2' })
      .mockResolvedValueOnce({ success: true, stdout: '[]' })
      .mockResolvedValueOnce({ success: true, stdout: '[]' })
      .mockResolvedValueOnce({ success: true, stdout: 'Acme Corp' })
      .mockResolvedValueOnce({ success: true, stdout: '[]' });

    const transport = mockTransport({
      kind: 'wpe-ssh',
      siteRef: { kind: 'wpe', installName: 'acmeprod' },
      runWpCli,
    });
    jest.spyOn(transportModule, 'resolveTransport').mockResolvedValue(transport);

    const services = makeServices();
    const result = await siteHealthHandler.execute({ install_name: 'acmeprod' }, services);

    expect(result.isError).toBeUndefined();
    const text = (result.content?.[0] as any)?.text ?? '';
    expect(text).toContain('Site Health:');
    expect(runWpCli).toHaveBeenCalled();
  });
});
