/**
 * Unit tests for wp_search_replace transport integration.
 *
 * Verifies that wp_search_replace accepts ssh_target and install_name,
 * resolves them via resolveTransport, and runs search-replace on
 * local sites, remote WPE installs, and external SSH hosts.
 */

import { searchReplaceHandler } from '../../../src/main/mcp/modules/wp-cli/search-replace';
import * as transportModule from '../../../src/main/transport';
import type { NexusServices } from '../../../src/main/mcp/types';
import type { SiteTransport } from '../../../src/main/transport/types';

function makeServices(overrides: any = {}): NexusServices {
  return {
    vectorStore: {} as any,
    embeddingService: {} as any,
    contentPipeline: {} as any,
    indexRegistry: {} as any,
    fileScanner: {} as any,
    siteData: {
      getSite: jest.fn(),
      getSites: jest.fn().mockReturnValue({}),
      ...overrides.siteData,
    },
    localServices: {
      wpCliRun: jest.fn(),
      getSiteStatus: jest.fn().mockReturnValue('running'),
      ...overrides.localServices,
    } as any,
    logger: { info: jest.fn(), error: jest.fn() } as any,
  } as any;
}

function mockTransport(overrides: Partial<SiteTransport> = {}): SiteTransport {
  return {
    kind: 'external-ssh',
    siteRef: { kind: 'external', alias: 'box' },
    supports: jest.fn().mockReturnValue(true),
    runWpCli: jest.fn().mockResolvedValue({ success: true, stdout: 'Success: Made 3 replacements.' }),
    deleteRemoteFile: jest.fn().mockResolvedValue({ success: true, output: '' }),
    probe: jest.fn().mockResolvedValue({ reachable: true }),
    ...overrides,
  } as any;
}

describe('wp_search_replace — remote transport integration', () => {
  it('runs against an external SSH host', async () => {
    const runWpCli = jest.fn().mockResolvedValue({ stdout: 'Success: Made 3 replacements.', success: true });
    const transport = mockTransport({ runWpCli });
    jest.spyOn(transportModule, 'resolveTransport').mockResolvedValue(transport);

    const services = makeServices();
    const result = await searchReplaceHandler.execute(
      { ssh_target: 'ssh:box@production', search: 'old.test', replace: 'new.test' },
      services
    );

    expect(result.isError).toBeUndefined();
    expect(runWpCli.mock.calls[0][0]).toEqual(
      expect.arrayContaining(['search-replace', 'old.test', 'new.test'])
    );
  });

  it('resolves as a write, so it is refused on production by default', async () => {
    const spy = jest.spyOn(transportModule, 'resolveTransport')
      .mockResolvedValue({ content: [{ text: 'Operation blocked' }], isError: true } as any);

    const services = makeServices();
    await searchReplaceHandler.execute(
      { ssh_target: 'ssh:box@production', search: 'a', replace: 'b' },
      services
    );

    expect(spy).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'wpcli');
  });

  it('defaults to dry-run mode (regression pin)', async () => {
    const runWpCli = jest.fn().mockResolvedValue({ stdout: 'Success: Made 0 replacements.', success: true });
    const transport = mockTransport({ runWpCli });
    jest.spyOn(transportModule, 'resolveTransport').mockResolvedValue(transport);

    const services = makeServices();
    await searchReplaceHandler.execute(
      { ssh_target: 'ssh:box@production', search: 'a', replace: 'b' },
      services
    );

    expect(runWpCli.mock.calls[0][0]).toContain('--dry-run');
  });

  it('respects dry_run=false to apply changes', async () => {
    const runWpCli = jest.fn().mockResolvedValue({ stdout: 'Success: Made 3 replacements.', success: true });
    const transport = mockTransport({ runWpCli });
    jest.spyOn(transportModule, 'resolveTransport').mockResolvedValue(transport);

    const services = makeServices();
    await searchReplaceHandler.execute(
      { install_name: 'acmeprod', search: 'old.com', replace: 'new.com', dry_run: false },
      services
    );

    expect(runWpCli.mock.calls[0][0]).not.toContain('--dry-run');
  });

  it('prefixes dry-run output with "Dry run" notice', async () => {
    const runWpCli = jest.fn().mockResolvedValue({ stdout: 'Success: 0 replacements.', success: true });
    const transport = mockTransport({ runWpCli });
    jest.spyOn(transportModule, 'resolveTransport').mockResolvedValue(transport);

    const services = makeServices();
    const result = await searchReplaceHandler.execute(
      { ssh_target: 'ssh:box@production', search: 'a', replace: 'b', dry_run: true },
      services
    );

    const text = (result.content?.[0] as any)?.text ?? '';
    expect(text).toContain('**Dry run**');
  });

  it('runs against a remote WPE install', async () => {
    const runWpCli = jest.fn().mockResolvedValue({ stdout: 'Success: Made 5 replacements.', success: true });
    const transport = mockTransport({
      kind: 'wpe-ssh',
      siteRef: { kind: 'wpe', installName: 'acmeprod' },
      runWpCli,
    });
    jest.spyOn(transportModule, 'resolveTransport').mockResolvedValue(transport);

    const services = makeServices();
    const result = await searchReplaceHandler.execute(
      { install_name: 'acmeprod', search: 'staging.acme.com', replace: 'acme.com', dry_run: false },
      services
    );

    expect(result.isError).toBeUndefined();
    const text = (result.content?.[0] as any)?.text ?? '';
    expect(text).toContain('Success');
    expect(runWpCli).toHaveBeenCalledWith(['search-replace', 'staging.acme.com', 'acme.com']);
  });
});
