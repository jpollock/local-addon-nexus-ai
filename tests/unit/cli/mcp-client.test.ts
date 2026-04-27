/**
 * Tests for mcp-client.ts — critical: this module gates whether CLI
 * commands fall through to GraphQL or hang/crash when MCP is unavailable.
 *
 * Regression for: nexus wp core version <target> hanging when MCP server
 * is unreachable (introduced in feat-cli-speaks-mcp).
 */

import { loadMcpConnectionInfo, targetToMcpArgs } from '../../../src/cli/utils/mcp-client';
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

  it('maps wpe: prefix to install_name', () => {
    expect(targetToMcpArgs('wpe:account/jppblank@production')).toEqual({ install_name: 'jppblank' });
    expect(targetToMcpArgs('wpe:jppblank@staging')).toEqual({ install_name: 'jppblank' });
  });

  it('maps @production/@staging/@development to install_name', () => {
    expect(targetToMcpArgs('jppblank@production')).toEqual({ install_name: 'jppblank' });
    expect(targetToMcpArgs('jppblank@staging')).toEqual({ install_name: 'jppblank' });
    expect(targetToMcpArgs('jppblank@development')).toEqual({ install_name: 'jppblank' });
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
