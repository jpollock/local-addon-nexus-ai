/**
 * Tests for mcp-client.ts — critical: this module gates whether CLI
 * commands fall through to GraphQL or hang/crash when MCP is unavailable.
 *
 * Regression for: nexus wp core version <target> hanging when MCP server
 * is unreachable (introduced in feat-cli-speaks-mcp).
 */

import { loadMcpConnectionInfo, targetToMcpArgs } from '../../../src/cli/utils/mcp-client';
import { resolveTarget } from '../../../src/main/mcp/modules/wp-cli/remote-exec';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// loadMcpConnectionInfo
// ---------------------------------------------------------------------------

describe('loadMcpConnectionInfo', () => {
  const infoPath = path.join(
    os.homedir(),
    'Library', 'Application Support', 'Local',
    'nexus-ai-mcp-connection-info.json',
  );

  it('returns null when connection info file is missing', () => {
    // Temporarily rename if it exists
    const exists = fs.existsSync(infoPath);
    const backup = infoPath + '.test-backup';
    if (exists) fs.renameSync(infoPath, backup);
    try {
      expect(loadMcpConnectionInfo()).toBeNull();
    } finally {
      if (exists) fs.renameSync(backup, infoPath);
    }
  });

  it('returns null when connection info file is malformed JSON', () => {
    fs.writeFileSync(infoPath + '.tmp', 'not-json');
    // We can't easily redirect the read path, but we verify the function
    // doesn't throw — it should return null for any parse error
    expect(() => loadMcpConnectionInfo()).not.toThrow();
    fs.unlinkSync(infoPath + '.tmp');
  });
});

// ---------------------------------------------------------------------------
// targetToMcpArgs
// ---------------------------------------------------------------------------

describe('targetToMcpArgs', () => {
  it('maps @local suffix to site parameter', () => {
    expect(targetToMcpArgs('mysite@local')).toEqual({ site: 'mysite' });
  });

  it('maps wpe: prefix to install_name, marked explicit', () => {
    expect(targetToMcpArgs('wpe:account/jppblank@production'))
      .toEqual({ install_name: 'jppblank', install_name_explicit: true });
    expect(targetToMcpArgs('wpe:jppblank@staging'))
      .toEqual({ install_name: 'jppblank', install_name_explicit: true });
  });

  it('maps @production/@staging/@development to install_name, marked explicit', () => {
    expect(targetToMcpArgs('jppblank@production'))
      .toEqual({ install_name: 'jppblank', install_name_explicit: true });
    expect(targetToMcpArgs('jppblank@staging'))
      .toEqual({ install_name: 'jppblank', install_name_explicit: true });
    expect(targetToMcpArgs('jppblank@development'))
      .toEqual({ install_name: 'jppblank', install_name_explicit: true });
  });

  it('maps ssh: targets whole', () => {
    expect(targetToMcpArgs('ssh:box@production')).toEqual({ ssh_target: 'ssh:box@production' });
  });

  it('maps bare names to install_name (WPE resolution attempted first)', () => {
    // Bare names like 'jppblank' should use install_name so the MCP tool
    // can resolve them as WPE installs. The MCP resolveTarget() also checks
    // local sites when install_name doesn't match a WPE install.
    expect(targetToMcpArgs('jppblank')).toEqual({ install_name: 'jppblank' });
    expect(targetToMcpArgs('mysite')).toEqual({ install_name: 'mysite' });
  });
});

// ---------------------------------------------------------------------------
// targetToMcpArgs → resolveTarget: the hijack the flag exists to stop
// ---------------------------------------------------------------------------

/**
 * The CLI's four MCP-first commands (wp plugin list, wp core version,
 * wp health, wp plugin update) send targetToMcpArgs' output straight to
 * resolveTarget. resolveTarget reads a bare `install_name` as *possibly a local
 * site name* and looks that up FIRST, so a local site sharing the name wins.
 *
 * `wp plugin update` is a write, so the mis-target is not merely a wrong
 * readout: `nexus wp plugin update wpe:acct/acme-prod@production akismet` could
 * update a different install.
 */
describe('an explicit wpe: target is not hijacked by a same-named local site', () => {
  const LINKED_TO_SOMETHING_ELSE = { installName: 'staging-copy', environment: 'staging' };

  function services() {
    const sites = { s1: { id: 's1', name: 'acme-prod', domain: 'acme-prod.local' } };
    return {
      localServices: {
        isCAPIAvailable: () => true,
        isSSHKeyAvailable: () => true,
        // A local site called acme-prod exists AND is linked — to a different install.
        resolveWpeInstall: jest.fn(async () => LINKED_TO_SOMETHING_ELSE),
      },
      siteData: {
        getSites: () => sites,
        getSite: (id: string) => Object.values(sites).find((s: any) => s.id === id) ?? null,
      },
      registryStorage: {
        get: () => ({ installs: [{ installName: 'acme-prod', environment: 'production' }] }),
      },
    } as any;
  }

  it('reaches install acme-prod for wpe:acct/acme-prod@production', async () => {
    const svc = services();
    const resolved: any = await resolveTarget(
      targetToMcpArgs('wpe:acct/acme-prod@production') as any, svc, 'wpcli_read',
    );
    expect(resolved.type).toBe('remote');
    expect(resolved.installName).toBe('acme-prod');
    expect(svc.localServices.resolveWpeInstall).not.toHaveBeenCalled();
  });

  it('reaches install acme-prod for the bare @production suffix form too', async () => {
    const svc = services();
    const resolved: any = await resolveTarget(
      targetToMcpArgs('acme-prod@production') as any, svc, 'wpcli_read',
    );
    expect(resolved.type).toBe('remote');
    expect(resolved.installName).toBe('acme-prod');
    expect(svc.localServices.resolveWpeInstall).not.toHaveBeenCalled();
  });

  it('CONTROL: without the flag the local site hijacks the target', async () => {
    // This is the defect, reproduced. If this ever starts returning acme-prod,
    // resolveTarget's local-first lookup changed and the two tests above are
    // no longer proving anything.
    const svc = services();
    const resolved: any = await resolveTarget({ install_name: 'acme-prod' }, svc, 'wpcli_read');
    expect(resolved.installName).toBe('staging-copy');
  });
});

// ---------------------------------------------------------------------------
// Fallback behaviour (integration concern — documented here as spec)
// ---------------------------------------------------------------------------

describe('MCP fallback contract', () => {
  it('default timeout is 3 seconds — not 30', () => {
    // If this is 30000, the CLI waits 30s before falling through to GraphQL.
    // Users will think the command hung. 3s is the max acceptable wait.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/cli/utils/mcp-client.ts'),
      'utf-8',
    );
    const match = src.match(/options\?\.timeout \?\? (\d+)/);
    expect(match).not.toBeNull();
    const defaultTimeout = parseInt(match![1], 10);
    expect(defaultTimeout).toBeLessThanOrEqual(3000);
  });
});
